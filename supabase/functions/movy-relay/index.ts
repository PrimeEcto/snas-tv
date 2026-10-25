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

/**
 * The provider's site host — the `Referer` its API now gates on.
 *
 * Measured on 2026-10-25: `api.wecollege.net/seed` answers Cloudflare's `403 Attention Required!`
 * to any request without a referer, `200` with the *current* site host, and `403` again with the
 * host it served from before the last move (`movy.bz`). The host is therefore discovered rather
 * than written down: the Worker sends what it resolved, and when it sends nothing this relay
 * resolves it on its own egress and echoes back the value it used, so the player can be told the
 * same host for the CDN. This copy of the logic exists because the relay is deployed on its own
 * and cannot import the Worker's modules.
 */
const SITE_SEEDS = ['https://movy.sx/', 'https://movy.bz/'];
const DEFAULT_SITE = 'https://www.movy.sx/';
const SITE_TTL_MS = 30 * 60 * 1000;
let site: { origin: string; at: number } | null = null;

function normalizeSite(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return '';
  const trimmed = value.trim();
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(withScheme);
    return parsed.protocol === 'https:' && parsed.hostname.includes('.') ? `${parsed.origin}/` : '';
  } catch {
    return '';
  }
}

/** The home a page declares for itself, from `canonical` or `og:url`. */
function declaredSite(html: string, base: string): string {
  const tag = /<link\b[^>]*\brel=["']canonical["'][^>]*>/i.exec(html)?.[0];
  const link = tag ? /\bhref=["']([^"']+)["']/i.exec(tag)?.[1] : undefined;
  const ogTag = /<meta\b[^>]*\bproperty=["']og:url["'][^>]*>/i.exec(html)?.[0];
  const og = ogTag ? /\bcontent=["']([^"']+)["']/i.exec(ogTag)?.[1] : undefined;
  for (const candidate of [link, og]) {
    if (!candidate) continue;
    try {
      return normalizeSite(new URL(candidate, base).toString());
    } catch {
      // A malformed declaration is worth no more than a missing one.
    }
  }
  return '';
}

/** Ask each known seed domain where it points, and take the first usable answer. */
async function discoverSite(): Promise<string> {
  for (const seed of SITE_SEEDS) {
    try {
      const response = await fetch(seed, {
        redirect: 'follow',
        headers: { accept: 'text/html,application/xhtml+xml' },
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) continue;
      const html = await response.text().catch(() => '');
      const declared = declaredSite(html, response.url || seed);
      if (declared) return declared;
      const landed = normalizeSite(response.url);
      if (landed) return landed;
    } catch {
      // An unreachable or slow seed costs this candidate only.
    }
  }
  return '';
}

/** The referer to send upstream: what the Worker resolved, or this relay's own discovery. */
async function siteReferer(requested: unknown): Promise<string> {
  const pinned = normalizeSite(Deno.env.get('UPSTREAM_SITE'));
  if (pinned) return pinned;
  const supplied = normalizeSite(requested);
  if (supplied) return supplied;
  if (site && Date.now() - site.at < SITE_TTL_MS) return site.origin;
  const found = await discoverSite();
  if (found) {
    site = { origin: found, at: Date.now() };
    return found;
  }
  return site?.origin ?? DEFAULT_SITE;
}

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

async function fetchText(url: string, referer: string): Promise<{ status: number; body: string }> {
  const upstream = await fetch(url, {
    headers: { accept: 'application/json, text/plain, */*', referer },
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
  const raw = await upstream.text();
  return {
    status: upstream.status,
    body: raw.length > MAX_BODY_BYTES ? raw.slice(0, MAX_BODY_BYTES) : raw,
  };
}

/** One seed request; cached here so several mirrors can share it. */
async function fetchSeed(
  seedUrl: string,
  referer: string,
): Promise<{ seed?: string; status: number; body: string }> {
  const cached = seeds.get(seedUrl);
  if (cached && cached.expiresAt > Date.now()) return { seed: cached.seed, status: 200, body: '' };

  const { status, body } = await fetchText(seedUrl, referer);
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

  let payload: { url?: unknown; seedUrl?: unknown; referer?: unknown };
  try {
    payload = (await request.json()) as { url?: unknown; seedUrl?: unknown; referer?: unknown };
  } catch {
    return json({ error: 'invalid JSON body' }, 400);
  }

  const target = resolveTarget(payload.url, 'url');
  if (typeof target === 'string') return json({ error: target }, 400);

  const requestedReferer = payload.referer;

  // Plain fetch: no seed involved.
  if (payload.seedUrl === undefined) {
    try {
      const referer = await siteReferer(requestedReferer);
      const { status, body } = await fetchText(target.toString(), referer);
      // The upstream status (including 429) is passed through so the Worker can decide.
      return json({ status, body, referer });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'upstream fetch failed';
      return json({ error: message, status: 0, body: '' }, 502);
    }
  }

  const seedUrl = resolveTarget(payload.seedUrl, 'seedUrl');
  if (typeof seedUrl === 'string') return json({ error: seedUrl }, 400);

  try {
    let referer = await siteReferer(requestedReferer);
    let { seed, status } = await fetchSeed(seedUrl.toString(), referer);
    if (!seed) {
      // The seed itself failed (429, 401, a network fault): report it as such, never as
      // a provider failure, so the Worker's attempts stay diagnosable.
      return json({ seedStatus: status, status, body: '', seed: '', referer });
    }

    let upstream = await fetchText(target.toString().replaceAll(SEED_TOKEN, seed), referer);
    // 401/403 is a stale seed *or* a host the provider has moved away from: refresh both and retry
    // once, so a domain change corrects itself here rather than surfacing as an outage.
    if (upstream.status === 401 || upstream.status === 403) {
      site = null;
      referer = await siteReferer(undefined);
      seeds.delete(seedUrl.toString());
      const refreshed = await fetchSeed(seedUrl.toString(), referer);
      if (refreshed.seed) {
        seed = refreshed.seed;
        upstream = await fetchText(target.toString().replaceAll(SEED_TOKEN, seed), referer);
      } else {
        return json({
          seedStatus: refreshed.status,
          status: refreshed.status,
          body: '',
          seed: '',
          referer,
        });
      }
    }

    return json({ status: upstream.status, body: upstream.body, seed, referer });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'upstream fetch failed';
    return json({ error: message, status: 0, body: '' }, 502);
  }
});
