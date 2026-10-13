/**
 * tmdb — the SNAS catalogue proxy.
 *
 * The Fire TV app ships no TMDB credential and has no field to enter one. It asks this
 * function for catalogue data instead, and the key stays here in the function's own
 * environment variables — `TMDB_API_KEY` (a v3 key) or `TMDB_READ_TOKEN` (a v4 read
 * access token) — which is exactly where anyone else helping to test picks it up.
 * Nothing in the repository holds the credential.
 *
 *   GET /functions/v1/tmdb/search/multi?query=dune&page=1
 *   GET /functions/v1/tmdb/discover/movie?with_genres=28&sort_by=popularity.desc
 *   GET /functions/v1/tmdb/movie/969681?append_to_response=credits,recommendations,videos
 *
 * Only the read-only endpoints the app actually calls are reachable (ALLOWED below), the
 * caller's query string is passed through untouched except for credential keys, and
 * TMDB's JSON is returned verbatim so the client keeps its existing parsing.
 *
 * Deploy:
 *   supabase secrets set --env-file .env
 *   supabase functions deploy tmdb --no-verify-jwt
 */

const TMDB_BASE = 'https://api.themoviedb.org/3';
const UPSTREAM_TIMEOUT_MS = 12000;

/** Read-only TMDB routes this proxy will ever forward. Anything else is not found. */
const ALLOWED: RegExp[] = [
  /^trending\/(movie|tv)\/(day|week)$/,
  /^movie\/(popular|top_rated|now_playing|upcoming)$/,
  /^tv\/(popular|top_rated|on_the_air|airing_today)$/,
  /^discover\/(movie|tv)$/,
  /^search\/(multi|movie|tv)$/,
  /^movie\/\d+$/,
  /^tv\/\d+$/,
  /^tv\/\d+\/season\/\d+$/,
];

/** Query keys a caller must never be able to set, because the server owns them. */
const RESERVED_PARAMS = new Set(['api_key', 'apiKey', 'access_token', 'authorization']);

/** Cheap per-isolate guard: 120 requests a minute per caller address. */
const WINDOW_MS = 60_000;
const WINDOW_LIMIT = 120;
const hits = new Map<string, { count: number; resetAt: number }>();

function limited(address: string): boolean {
  const now = Date.now();
  const entry = hits.get(address);
  if (!entry || entry.resetAt <= now) {
    hits.set(address, { count: 1, resetAt: now + WINDOW_MS });
    if (hits.size > 5000) hits.clear();
    return false;
  }
  entry.count += 1;
  return entry.count > WINDOW_LIMIT;
}

function headers(): Record<string, string> {
  return {
    'content-type': 'application/json; charset=utf-8',
    // The app caches in memory too; this only helps anything else in front of it.
    'cache-control': 'public, max-age=300',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type',
    'access-control-allow-methods': 'GET, OPTIONS',
  };
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: headers() });
}

/**
 * Strip the invocation prefix, leaving the TMDB path the caller asked for.
 *
 * The edge runtime hands the function its own name as the first segment (`/tmdb/...`) and
 * some clients reach it through `/functions/v1/tmdb/...`, so both are peeled off here.
 */
function upstreamPath(url: URL): string {
  const segments = url.pathname.split('/').filter(Boolean);
  while (segments.length > 0 && ['functions', 'v1', 'tmdb'].includes(segments[0])) {
    segments.shift();
  }
  return segments.join('/');
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: headers() });
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return json({ error: 'only GET is supported' }, 405);
  }

  const address =
    request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    request.headers.get('cf-connecting-ip') ||
    'unknown';
  if (limited(address)) return json({ error: 'too many requests' }, 429);

  const key = Deno.env.get('TMDB_API_KEY')?.trim() ?? '';
  const token = Deno.env.get('TMDB_READ_TOKEN')?.trim() ?? '';
  if (!key && !token) {
    // Configuration problem, not a caller problem: say so plainly rather than 401.
    return json({ error: 'TMDB credential is not configured on the server' }, 503);
  }

  const url = new URL(request.url);
  const path = upstreamPath(url);
  if (!ALLOWED.some((pattern) => pattern.test(path))) {
    return json({ error: `unsupported catalogue path: /${path}` }, 404);
  }

  const query = new URLSearchParams(url.searchParams);
  for (const reserved of RESERVED_PARAMS) query.delete(reserved);
  if (!query.has('language')) query.set('language', 'en-US');
  if (key) query.set('api_key', key);

  const target = `${TMDB_BASE}/${path}?${query.toString()}`;
  try {
    const upstream = await fetch(target, {
      // A v3 key travels in the query string; a v4 token travels as a bearer header.
      headers: {
        accept: 'application/json',
        ...(key ? {} : { authorization: `Bearer ${token}` }),
      },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    const body = await upstream.text();
    // 401 is TMDB rejecting the server's own key; report that as a server fault so the
    // app never blames the person holding the remote.
    const status = upstream.status === 401 ? 502 : upstream.status;
    return new Response(body, { status, headers: headers() });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'catalogue unavailable';
    return json({ error: `catalogue unavailable: ${message}` }, 502);
  }
});
