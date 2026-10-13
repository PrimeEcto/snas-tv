/**
 * movy-relay — upstream HTTP relay for the SNAS backend.
 *
 * Why this exists: `api.wecollege.net` rate-limits Cloudflare's shared egress IPs, so a
 * Cloudflare Worker always receives HTTP 429 on `/seed` before it can request sources.
 * The same request from an ordinary host, or from this function (Deno, on Supabase's
 * egress), succeeds. So the Worker delegates the HTTP side here and keeps the decryption
 * itself, meaning the stream cipher is implemented in exactly one place.
 *
 * Protocol:
 *   POST /functions/v1/movy-relay
 *   headers: { "x-relay-secret": RELAY_SECRET, "content-type": "application/json" }
 *
 *   Plain fetch — one URL, one response:
 *     { "url": "https://api.wecollege.net/seed?mediaId=969681" }
 *     reply: { "status": 200, "body": "<raw upstream body>" }
 *
 *   Seeded fetch — the seed and the request that depends on it:
 *     { "seedUrl": "https://api.wecollege.net/seed?mediaId=969681",
 *       "url": "https://api.wecollege.net/miami/sources?...&seed={{seed}}" }
 *     reply: { "status": 200, "body": "<raw sources body>", "seed": "<seed used>" }
 *
 * The seeded form is the one that matters. The upstream binds a seed to the client that
 * requested it — a seed fetched here and used from anywhere else answers
 * `401 STREAMCRYPTO_SEED_INVALID` — so both requests must happen inside a single
 * invocation, which is what this function does. The seed it used is returned so the Worker
 * can decrypt with the same one, and a stale seed is refreshed once and retried here.
 *
 * Security: an allow-listed relay, never an open proxy. Only the upstream origins the
 * backend legitimately needs are reachable, and a shared secret must match.
 *
 * Deploy:
 *   supabase secrets set --env-file .env
 *   supabase functions deploy movy-relay
 */

/** Origins this relay will fetch, for a target URL or a seed URL alike. */
const ALLOWED_ORIGINS = new Set([
  'https://api.wecollege.net',
  'https://trailers.wecollege.net',
  'https://subtitles.vidy.st',
]);

const MAX_BODY_BYTES = 4 * 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = 20000;
const SEED_TOKEN = '{{seed}}';

/**
 * Seeds, keyed by their request URL and reused only within this isolate — the only
 * client context whose egress may legitimately reuse them. A 401 clears the entry.
 */
const seeds = new Map<string, { seed: string; expiresAt: number }>();

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

/** Resolve and allow-list a target URL. */
function resolveTarget(raw: unknown, label: string): URL | string {
  if (typeof raw !== 'string') return `${label} is required`;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return `${label} is not a valid absolute URL`;
  }
  if (parsed.protocol !== 'https:' || !ALLOWED_ORIGINS.has(parsed.origin)) {
    return `${label} origin not allowed: ${parsed.origin}`;
  }
  return parsed;
}

async function fetchText(url: string): Promise<{ status: number; body: string }> {
  const upstream = await fetch(url, {
    headers: { accept: 'application/json, text/plain, */*' },
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
  const raw = await upstream.text();
  return {
    status: upstream.status,
    body: raw.length > MAX_BODY_BYTES ? raw.slice(0, MAX_BODY_BYTES) : raw,
  };
}

/** One seed request; cached here so several mirrors can share it. */
async function fetchSeed(seedUrl: string): Promise<{ seed?: string; status: number; body: string }> {
  const cached = seeds.get(seedUrl);
  if (cached && cached.expiresAt > Date.now()) return { seed: cached.seed, status: 200, body: '' };

  const { status, body } = await fetchText(seedUrl);
  if (status < 200 || status >= 300) return { status, body };
  let parsed: { seed?: string; ttlMs?: number } | null = null;
  try {
    parsed = JSON.parse(body) as { seed?: string; ttlMs?: number };
  } catch {
    parsed = null;
  }
  if (!parsed?.seed) return { status: 502, body: '' };
  seeds.set(seedUrl, { seed: parsed.seed, expiresAt: Date.now() + (parsed.ttlMs ?? 30000) });
  if (seeds.size > 5000) seeds.clear();
  return { seed: parsed.seed, status: 200, body };
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method !== 'POST') return json({ error: 'only POST is supported' }, 405);

  // A shared secret keeps the relay from being an open proxy if the URL leaks.
  const expected = Deno.env.get('RELAY_SECRET');
  if (!expected) return json({ error: 'relay is not configured' }, 503);
  if (request.headers.get('x-relay-secret') !== expected) return json({ error: 'unauthorized' }, 401);

  let payload: { url?: unknown; seedUrl?: unknown };
  try {
    payload = (await request.json()) as { url?: unknown; seedUrl?: unknown };
  } catch {
    return json({ error: 'invalid JSON body' }, 400);
  }

  const target = resolveTarget(payload.url, 'url');
  if (typeof target === 'string') return json({ error: target }, 400);

  // Plain fetch: no seed involved.
  if (payload.seedUrl === undefined) {
    try {
      const { status, body } = await fetchText(target.toString());
      // The upstream status (including 429) is passed through so the Worker can decide.
      return json({ status, body });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'upstream fetch failed';
      return json({ error: message, status: 0, body: '' }, 502);
    }
  }

  const seedUrl = resolveTarget(payload.seedUrl, 'seedUrl');
  if (typeof seedUrl === 'string') return json({ error: seedUrl }, 400);

  try {
    let { seed, status } = await fetchSeed(seedUrl.toString());
    if (!seed) {
      // The seed itself failed (429, 401, a network fault): report it as such, never as
      // a provider failure, so the Worker's attempts stay diagnosable.
      return json({ seedStatus: status, status, body: '', seed: '' });
    }

    let upstream = await fetchText(target.toString().replaceAll(SEED_TOKEN, seed));
    // 401/403 means this seed is stale or belongs to another client: refresh and retry once.
    if (upstream.status === 401 || upstream.status === 403) {
      seeds.delete(seedUrl.toString());
      const refreshed = await fetchSeed(seedUrl.toString());
      if (refreshed.seed) {
        seed = refreshed.seed;
        upstream = await fetchText(target.toString().replaceAll(SEED_TOKEN, seed));
      } else {
        return json({ seedStatus: refreshed.status, status: refreshed.status, body: '', seed: '' });
      }
    }

    return json({ status: upstream.status, body: upstream.body, seed });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'upstream fetch failed';
    return json({ error: message, status: 0, body: '' }, 502);
  }
});
