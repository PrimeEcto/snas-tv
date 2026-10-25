/**
 * Where the provider's site lives today — the `Referer` its API will accept.
 *
 * The provider moves host names (it was `movy.bz`, it is `movy.sx`), and the API gates on the
 * *current* one: measured on 2026-10-25, `https://www.movy.sx/` and `https://movy.sx/` were
 * answered `200` while the old `https://www.movy.bz/`, an unrelated host and a CDN host were all
 * answered Cloudflare's `403 Attention Required!`. A referer written into the source therefore
 * works until the next move and then takes playback down with it — which is exactly how the
 * outage this file responds to began.
 *
 * So the host is discovered, not written down:
 *
 *   1. an operator can pin it (`UPSTREAM_SITE`), and then nothing is fetched at all;
 *   2. otherwise the known seed domains are asked where they point — following redirects and
 *      reading the page's own canonical/`og:url` — which is how `movy.bz` still answers today:
 *      `301 https://www.movy.sx/`;
 *   3. the answer is cached briefly, and a request the API rejects (`401`/`403`) clears the cache,
 *      so a move is picked up on the next playback rather than after the cache expires.
 *
 * Total failure never throws: the last good origin is reused, and if there never was one the
 * bootstrap default stands in. A referer that is a move out of date still beats no referer — the
 * API's gate is on its presence and its host, and the next 403 is what corrects it.
 */

/** The domains this app's provider has served from, newest first. A move adds one here. */
export const SITE_SEEDS = ['https://movy.sx/', 'https://movy.bz/'];

/** What to send before anything has been discovered: the host measured on 2026-10-25. */
export const DEFAULT_SITE = 'https://www.movy.sx/';

/** How long a discovered host is trusted before it is re-checked. */
export const SITE_TTL_MS = 30 * 60 * 1000;

/**
 * How long a failed discovery is remembered.
 *
 * Without this, a site that is unreachable would cost two seed timeouts on every playback request
 * before the request to the API was even made.
 */
export const SITE_RETRY_MS = 60 * 1000;

/** How long one seed may take to answer. Discovery must not delay a playback request for long. */
const SEED_TIMEOUT_MS = 5000;

export type SiteFetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface SiteOptions {
  fetchImpl?: SiteFetch;
  /** `UPSTREAM_SITE`: pins the host, and no request is made. */
  override?: string;
  seeds?: string[];
  now?: number;
}

let cached: { origin: string; at: number } | null = null;
let failedAt = 0;

export function clearSiteCache(): void {
  cached = null;
  failedAt = 0;
}

/** Remember a host another component resolved (the relay discovers it on its own egress). */
export function rememberSite(origin: string, now = Date.now()): void {
  const normalized = normalize(origin);
  if (normalized) cached = { origin: normalized, at: now };
}

/** The origin currently being sent as the referer, or the bootstrap default. */
export function currentSite(): string {
  return cached?.origin ?? DEFAULT_SITE;
}

/**
 * `https://host/` for a URL or bare host, or `''` when it is not a usable https origin.
 *
 * Accepts a bare host because an operator setting `UPSTREAM_SITE` should not have to remember the
 * scheme, and always returns the origin with a trailing slash: the provider's gate is on the
 * origin, and a referer is a URL.
 */
export function normalize(value: string | undefined | null): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== 'https:' || !url.hostname.includes('.')) return '';
    return `${url.origin}/`;
  } catch {
    return '';
  }
}

/** The origin of a URL the platform already resolved, or `''`. */
function originOf(value: string | undefined): string {
  return normalize(value);
}

/**
 * The home the page declares for itself, from `<link rel="canonical">` or `og:url`.
 *
 * Both are read because sites emit one or the other, and a site that answers `200` on an old host
 * while serving a redirect in JavaScript can only be followed this way. Attribute order is not
 * assumed: the tag is found first and its `href`/`content` read from it.
 */
export function declaredOrigin(html: string, base: string): string {
  if (!html) return '';
  const canonicalTag = /<link\b[^>]*\brel=["']canonical["'][^>]*>/i.exec(html)?.[0];
  const canonical = canonicalTag ? /\bhref=["']([^"']+)["']/i.exec(canonicalTag)?.[1] : undefined;
  const ogTag = /<meta\b[^>]*\bproperty=["']og:url["'][^>]*>/i.exec(html)?.[0];
  const og = ogTag ? /\bcontent=["']([^"']+)["']/i.exec(ogTag)?.[1] : undefined;
  for (const candidate of [canonical, og]) {
    if (!candidate) continue;
    try {
      return originOf(new URL(candidate, base).toString());
    } catch {
      // A malformed declaration is worth no more than a missing one.
    }
  }
  return '';
}

/** Ask each seed where it points, newest first, and take the first usable answer. */
async function discover(seeds: string[], fetchImpl: SiteFetch): Promise<string> {
  for (const seed of seeds) {
    try {
      const response = await fetchImpl(seed, {
        redirect: 'follow',
        headers: { accept: 'text/html,application/xhtml+xml' },
        signal: AbortSignal.timeout(SEED_TIMEOUT_MS),
      });
      if (!response.ok) continue;
      const html = await response.text().catch(() => '');
      // The page's declaration first: a site that has moved but still answers on the old host says
      // so here, and the redirect chain has already been followed when it did not.
      const declared = declaredOrigin(html, response.url || seed);
      if (declared) return declared;
      const landed = originOf(response.url);
      if (landed) return landed;
    } catch {
      // An unreachable or slow seed costs this candidate only.
    }
  }
  return '';
}

/**
 * The referer to send upstream, resolving the provider's current host when it is not known.
 *
 * Never throws and never blocks for longer than one seed's timeout per candidate: a playback
 * request that cannot discover the host still goes out with the last known good one.
 */
export async function siteReferer(options: SiteOptions = {}): Promise<string> {
  const override = normalize(options.override);
  if (override) return override;

  const now = options.now ?? Date.now();
  if (cached && now - cached.at < SITE_TTL_MS) return cached.origin;
  if (failedAt && now - failedAt < SITE_RETRY_MS) return cached?.origin ?? DEFAULT_SITE;

  const fetchImpl: SiteFetch = options.fetchImpl ?? ((input, init) => fetch(input, init));
  const found = await discover(options.seeds ?? SITE_SEEDS, fetchImpl);
  if (found) {
    cached = { origin: found, at: now };
    failedAt = 0;
    return found;
  }
  // Nothing answered: a stale host is still more useful than none, and the next 403 re-resolves.
  failedAt = now;
  return cached?.origin ?? DEFAULT_SITE;
}
