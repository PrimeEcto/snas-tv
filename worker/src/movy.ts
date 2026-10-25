/**
 * movy.sx / api.wecollege.net source client.
 *
 * The site fetches video sources from one "city" per request; each city is a
 * mirror/quality tier. We reproduce the same query shape, including the original
 * quirk that `title` is `encodeURIComponent`-ed before the query string encodes
 * it a second time, and that the seed's `mediaId` is the TMDB id.
 */
import { decryptStreamPayload } from './streamcrypto.ts';
import { clearSiteCache, currentSite, normalize, rememberSite, siteReferer } from './site.ts';

export const STREAM_API_BASE = 'https://api.wecollege.net';


export interface Provider {
  name: string;
  slug: string;
  note: string;
  /** Providers that need an extra query parameter to return results. */
  extra?: Record<string, string | number>;
}

/**
 * Priority order is the app's own "GetStream" list: original-audio mirrors first.
 * `delhi` (Hindi) and `cancun` (Spanish) round out the non-English tiers.
 */
export const PROVIDERS: Provider[] = [
  { name: 'Miami', slug: 'miami', note: 'Original audio. May have 4K' },
  { name: 'Boise', slug: 'boise', note: 'Original audio. May have 4K' },
  { name: 'Vegas', slug: 'vegas', note: 'Original audio' },
  { name: 'Reno', slug: 'reno', note: 'Original audio' },
  { name: 'Oakland', slug: 'oakland', note: 'Original audio' },
  { name: 'Seattle', slug: 'seattle', note: 'Original audio' },
  { name: 'Phoenix', slug: 'phoenix', note: 'Original audio' },
  { name: 'Atlanta', slug: 'atlanta', note: 'Original audio' },
  { name: 'Portland', slug: 'portland', note: 'Original audio' },
  { name: 'Austin', slug: 'austin', note: 'Original audio, multi-language mirror' },
  { name: 'Dallas', slug: 'dallas', note: 'Original audio' },
  { name: 'Tampa', slug: 'tampa', note: 'Original audio' },
  { name: 'Orlando', slug: 'orlando', note: 'Original audio' },
  { name: 'Munich', slug: 'munich', note: 'German audio', extra: { language: 'german' } },
  { name: 'Berlin', slug: 'berlin', note: 'German audio' },
  { name: 'Paris', slug: 'paris', note: 'French audio' },
  { name: 'Delhi', slug: 'delhi', note: 'Hindi audio' },
  { name: 'Cancun', slug: 'cancun', note: 'Spanish audio' },
];

/** Cheapest providers to try first; short because this upstream rate-limits hard. */
export const DEFAULT_PROVIDER_ORDER = ['miami', 'boise', 'vegas', 'reno', 'oakland', 'seattle'];

export interface TitleRef {
  title: string;
  year?: number | string;
  tmdbId: number;
  imdbId?: string;
  mediaType: 'movie' | 'tv';
  seasonId?: number;
  episodeId?: number;
  totalSeasons?: number;
}

export interface VideoSource {
  quality: string;
  url: string;
}

/** OpenSubtitles rows embedded in the source payload (secondary to subtitles.vidy.st). */
export interface EmbeddedSubtitleGroup {
  languageName?: string;
  language?: string;
  subtitles?: { language: string; url: string; lang: string }[];
}

export interface StreamPayload {
  sources: VideoSource[];
  subtitles: EmbeddedSubtitleGroup[];
  thumbnail?: string;
  playlist?: string;
}

export class StreamSourceError extends Error {
  readonly status: number;
  readonly provider: string;
  /** Populated for failover failures so callers can report which mirrors refused. */
  readonly attempts: { provider: string; status: number; reason: string }[];

  constructor(
    message: string,
    status: number,
    provider: string,
    attempts: { provider: string; status: number; reason: string }[] = [],
  ) {
    super(message);
    this.name = 'StreamSourceError';
    this.status = status;
    this.provider = provider;
    this.attempts = attempts;
  }

  /** 429 and 5xx are worth trying on another mirror; 401/403 mean a stale seed. */
  get retryableElsewhere(): boolean {
    return this.status === 429 || this.status >= 500 || this.status === 0;
  }

  get staleSeed(): boolean {
    return this.status === 401 || this.status === 403;
  }
}

export interface FetchLike {
  (input: string, init?: RequestInit): Promise<Response>;
}

export interface UpstreamResponse {
  status: number;
  body: string;
}

/** Placeholder a transport replaces with the seed it obtained. */
export const SEED_TOKEN = '{{seed}}';

/**
 * A seed and the request that depends on it, issued as one pair.
 *
 * The referer travels with the request rather than being fixed in the transport: the provider's
 * API answers `403` to anything but its current site host (`src/site.ts` discovers which), so a
 * transport that sent a constant would work until the provider's next move.
 *
 * The upstream binds a seed to the client that asked for it. Measured against the live
 * API: seed-from-relay + sources-from-host and seed-from-host + sources-from-relay both
 * answer `401 STREAMCRYPTO_SEED_INVALID`, while host + host answers 200, with identical
 * headers either way. Since Cloudflare's shared egress IPs are rate-limited with 429,
 * a relayed deployment has to run *both* requests inside one relay invocation, which is
 * exactly what `seeded` exists for. It also means a seed can never be cached across a
 * client boundary: each transport caches only what its own egress may reuse.
 */
export interface SeededRequest {
  /** Where to ask for the seed for this title. */
  seedUrl: string;
  /** The sources URL, with `{{seed}}` where the seed belongs. */
  urlTemplate: string;
  timeoutMs: number;
}

export interface SeededResponse extends UpstreamResponse {
  /** The seed that actually produced `body`; the payload is decrypted with this one. */
  seed: string;
}

/**
 * How the Worker reaches the upstream API. The upstream rate-limits Cloudflare's
 * shared egress IPs with HTTP 429, so in production these calls are delegated to a
 * relay running on a different egress. Decryption stays here either way, so the
 * cipher is implemented in exactly one place.
 */
export interface UpstreamTransport {
  get(url: string, timeoutMs: number): Promise<UpstreamResponse>;
  /** Fetch a seed and the URL built from it in one upstream client context. */
  seeded(request: SeededRequest): Promise<SeededResponse>;
}

/**
 * Talk to `api.wecollege.net` directly from this isolate.
 *
 * `site` pins the referer (an operator's `UPSTREAM_SITE`); without it the provider's current host
 * is discovered and cached by `src/site.ts`.
 */
export function directTransport(fetchImpl: FetchLike, site?: string): UpstreamTransport {
  const referer = (): Promise<string> =>
    siteReferer(site ? { fetchImpl, override: site } : { fetchImpl });

  const plain = async (
    url: string,
    timeoutMs: number,
    host: string,
  ): Promise<UpstreamResponse> => {
    const response = await fetchImpl(url, {
      // Both are load-bearing: `accept` is what the API answers JSON for, and the referer is what
      // Cloudflare in front of it demands — no referer, or the wrong host, is `403`.
      headers: { accept: 'application/json, text/plain, */*', referer: host },
      signal: AbortSignal.timeout(timeoutMs),
    });
    return { status: response.status, body: await response.text() };
  };

  return {
    async get(url: string, timeoutMs: number): Promise<UpstreamResponse> {
      return plain(url, timeoutMs, await referer());
    },

    async seeded({ seedUrl, urlTemplate, timeoutMs }: SeededRequest): Promise<SeededResponse> {
      let host = await referer();
      const fetchSeed = () =>
        fetchSeedOnce(seedUrl, (url, timeout) => plain(url, timeout, host), timeoutMs);
      let seed = cachedSeed(seedUrl) ?? (await fetchSeed());
      let response = await plain(urlTemplate.replaceAll(SEED_TOKEN, seed), timeoutMs, host);
      // 401/403 is a stale seed *or* a host the provider has moved away from: refresh both and try
      // exactly once. This is what makes a domain change self-correcting instead of an outage.
      if (response.status === 401 || response.status === 403) {
        clearSiteCache();
        host = await referer();
        seedCache.delete(seedUrl);
        seed = await fetchSeed();
        response = await plain(urlTemplate.replaceAll(SEED_TOKEN, seed), timeoutMs, host);
      }
      return { ...response, seed };
    },
  };
}

/**
 * Delegate the upstream HTTP call to a relay that answers `POST { url }` with
 * `{ status, body }`. A shared secret keeps the relay from being an open proxy.
 *
 * The referer is resolved here and sent with the request, and the relay echoes back the one it
 * actually used — its egress can reach the provider's site even when this Worker's cannot, so its
 * answer is the better evidence and is what the player is then told to send to the CDN.
 */
export function relayTransport(
  relayUrl: string,
  secret: string | undefined,
  fetchImpl: FetchLike,
  site?: string,
): UpstreamTransport {
  // Deliberately not a discovery on this egress: the relay can reach the provider's site and
  // discovers it there, so the Worker sends what it already knows (a pinned host, or the last one
  // the relay reported) and lets the relay correct it. Discovering from Cloudflare here would spend
  // two seed timeouts on every cold isolate before the playback request was even sent.
  const referer = async (): Promise<string> => normalize(site) || currentSite();

  // A transport never throws: an unreachable or misbehaving relay becomes status 0,
  // which the caller already treats as "retry another mirror".
  const post = async (
    body: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<{ status: number; body: string; seed: string; referer: string }> => {
    try {
      const response = await fetchImpl(relayUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          ...(secret ? { 'x-relay-secret': secret } : {}),
        },
        body: JSON.stringify(body),
        // The relay has its own upstream round trip (or two) to finish first.
        signal: AbortSignal.timeout(timeoutMs + 5000),
      });
      if (!response.ok) return { status: response.status, body: '', seed: '', referer: '' };
      const payload = (await response.json()) as {
        status?: number;
        body?: string;
        seed?: string;
        referer?: string;
      };
      if (typeof payload.referer === 'string' && payload.referer) rememberSite(payload.referer);
      return {
        status: typeof payload.status === 'number' ? payload.status : 0,
        body: typeof payload.body === 'string' ? payload.body : '',
        seed: typeof payload.seed === 'string' ? payload.seed : '',
        referer: typeof payload.referer === 'string' ? payload.referer : '',
      };
    } catch {
      return { status: 0, body: '', seed: '', referer: '' };
    }
  };

  return {
    async get(url: string, timeoutMs: number): Promise<UpstreamResponse> {
      const { status, body } = await post({ url, referer: await referer() }, timeoutMs);
      return { status, body };
    },

    /** One relay invocation fetches the seed *and* the URL built from it. */
    async seeded({ seedUrl, urlTemplate, timeoutMs }: SeededRequest): Promise<SeededResponse> {
      let host = await referer();
      let result = await post({ seedUrl, url: urlTemplate, referer: host }, timeoutMs);
      if (result.status === 401 || result.status === 403) {
        // Either the seed went stale or the provider moved host: clear both and try once more.
        clearSiteCache();
        host = await referer();
        result = await post({ seedUrl, url: urlTemplate, referer: host }, timeoutMs);
      }
      const { status, body, seed } = result;
      return { status, body, seed };
    },
  };
}

/** Pick the relay when configured, otherwise go direct. */
export function resolveTransport(
  env: { UPSTREAM_RELAY_URL?: string; UPSTREAM_RELAY_SECRET?: string; UPSTREAM_SITE?: string },
  fetchImpl: FetchLike,
): UpstreamTransport {
  const relay = env.UPSTREAM_RELAY_URL?.trim();
  if (!relay) return directTransport(fetchImpl, env.UPSTREAM_SITE);
  return relayTransport(relay, env.UPSTREAM_RELAY_SECRET?.trim(), fetchImpl, env.UPSTREAM_SITE);
}

/** Per-isolate seed cache, mirroring the site's 5s-early expiry behaviour. */
const seedCache = new Map<string, { seed: string; expiresAt: number }>();

export function clearSeedCache(): void {
  seedCache.clear();
}

/** The seed request for a media id; also the cache key, since the URL *is* the request. */
export function seedUrlFor(mediaId: number, base: string = STREAM_API_BASE): string {
  return `${new URL(base).origin}/seed?mediaId=${mediaId}`;
}

function cachedSeed(seedUrl: string, now = Date.now()): string | undefined {
  const cached = seedCache.get(seedUrl);
  return cached && cached.expiresAt - 5000 > now ? cached.seed : undefined;
}

/**
 * One seed request, stored for reuse. Only ever called from the same client context that
 * will use the seed, because the upstream ties a seed to the client that asked for it.
 */
async function fetchSeedOnce(
  seedUrl: string,
  get: (url: string, timeoutMs: number) => Promise<UpstreamResponse>,
  timeoutMs: number,
): Promise<string> {
  const { status, body } = await get(seedUrl, timeoutMs);
  if (status < 200 || status >= 300) {
    throw new StreamSourceError(`seed request failed (HTTP ${status})`, status, 'seed');
  }
  let parsed: { seed?: string; ttlMs?: number } | null = null;
  try {
    parsed = JSON.parse(body) as { seed?: string; ttlMs?: number };
  } catch {
    parsed = null;
  }
  if (!parsed?.seed) throw new StreamSourceError('seed request returned no seed', 0, 'seed');
  seedCache.set(seedUrl, { seed: parsed.seed, expiresAt: Date.now() + (parsed.ttlMs ?? 30000) });
  return parsed.seed;
}

export function buildSourceParams(ref: TitleRef, provider: Provider): Record<string, string> {
  const params: Record<string, string> = {
    // Double-encoded on purpose: the site encodes, then the query encoder encodes again.
    title: encodeURIComponent(ref.title),
    mediaType: ref.mediaType,
  };
  if (ref.year !== undefined && ref.year !== null && `${ref.year}` !== '') params.year = `${ref.year}`;
  if (ref.totalSeasons) params.totalSeasons = `${ref.totalSeasons}`;
  if (ref.episodeId !== undefined) params.episodeId = `${ref.episodeId}`;
  if (ref.seasonId !== undefined) params.seasonId = `${ref.seasonId}`;
  params.tmdbId = `${ref.tmdbId}`;
  if (ref.imdbId) params.imdbId = ref.imdbId;
  for (const [key, value] of Object.entries(provider.extra ?? {})) params[key] = `${value}`;
  return params;
}

export function buildSourcesUrl(
  provider: Provider,
  params: Record<string, string>,
  seed: string,
): string {
  const query = new URLSearchParams({ ...params, enc: '2', seed });
  return `${STREAM_API_BASE}/${provider.slug}/sources?${query.toString()}`;
}

/**
 * Fetch (or reuse) a seed for this media id.
 *
 * Only useful when the caller will use the seed from this same client context — inside
 * `directTransport`'s own `seeded`, or from a script running on one host. Anything that
 * crosses an egress boundary must go through `UpstreamTransport.seeded` instead.
 */
export async function getSeed(
  mediaId: number,
  options: {
    transport?: UpstreamTransport;
    fetchImpl?: FetchLike;
    now?: number;
    timeoutMs?: number;
    base?: string;
  } = {},
): Promise<string> {
  const transport = options.transport ?? directTransport(options.fetchImpl ?? fetch);
  const seedUrl = seedUrlFor(mediaId, options.base ?? STREAM_API_BASE);
  const cached = cachedSeed(seedUrl, options.now ?? Date.now());
  if (cached) return cached;
  return fetchSeedOnce(
    seedUrl,
    (url, timeoutMs) => transport.get(url, timeoutMs),
    options.timeoutMs ?? 8000,
  );
}

/**
 * Fetch and decrypt one provider's payload.
 *
 * The seed and the sources request travel together through `transport.seeded`, so the
 * pair always shares one client context, and the payload is decrypted with the very seed
 * that produced it. A stale seed is retried once inside the transport, where the cache
 * and the egress both live.
 */
export async function fetchProviderSources(
  provider: Provider,
  ref: TitleRef,
  options: { transport?: UpstreamTransport; fetchImpl?: FetchLike; timeoutMs?: number; base?: string } = {},
): Promise<StreamPayload> {
  const transport = options.transport ?? directTransport(options.fetchImpl ?? fetch);
  const timeoutMs = options.timeoutMs ?? 10000;
  const base = (options.base ?? STREAM_API_BASE).replace(/\/+$/, '');
  const query = new URLSearchParams({ ...buildSourceParams(ref, provider), enc: '2' }).toString();

  const { status, body, seed } = await transport.seeded({
    seedUrl: seedUrlFor(ref.tmdbId, base),
    urlTemplate: `${base}/${provider.slug}/sources?${query}&seed=${SEED_TOKEN}`,
    timeoutMs,
  });
  if (status < 200 || status >= 300) {
    // An empty seed means the seed request failed rather than this mirror, and the
    // relay reports the seed's own status so the message stays accurate.
    if (!seed) throw new StreamSourceError(`seed request failed (HTTP ${status})`, status, 'seed');
    throw new StreamSourceError(`${provider.slug} returned HTTP ${status}`, status, provider.slug);
  }

  const parsed = JSON.parse(decryptStreamPayload(body, seed, ref.tmdbId)) as StreamPayload;
  return {
    sources: Array.isArray(parsed.sources) ? parsed.sources : [],
    subtitles: Array.isArray(parsed.subtitles) ? parsed.subtitles : [],
    ...(parsed.thumbnail ? { thumbnail: parsed.thumbnail } : {}),
    ...(parsed.playlist ? { playlist: parsed.playlist } : {}),
  };
}

export interface FailoverResult {
  provider: Provider;
  payload: StreamPayload;
  /** Every provider tried, in order, with the reason it was skipped. */
  attempts: { provider: string; status: number; reason: string }[];
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Walk providers until one returns playable sources. Rate limits are expected, so
 * failures move on to the next mirror instead of surfacing to the TV app, and a
 * small pause between attempts keeps us from tripping 429 on every mirror at once.
 */
export async function fetchSourcesWithFailover(
  ref: TitleRef,
  options: {
    providers?: string[];
    transport?: UpstreamTransport;
    fetchImpl?: FetchLike;
    timeoutMs?: number;
    staggerMs?: number;
    requireSources?: boolean;
  } = {},
): Promise<FailoverResult> {
  const slugs = options.providers ?? DEFAULT_PROVIDER_ORDER;
  const order = slugs
    .map((slug) => PROVIDERS.find((provider) => provider.slug === slug))
    .filter((provider): provider is Provider => Boolean(provider));
  const attempts: FailoverResult['attempts'] = [];
  const requireSources = options.requireSources ?? true;

  for (const [index, provider] of order.entries()) {
    if (index > 0 && options.staggerMs) await sleep(options.staggerMs);
    try {
      const payload = await fetchProviderSources(provider, ref, {
        ...(options.transport ? { transport: options.transport } : {}),
        ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
        ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
      });
      if (requireSources && payload.sources.length === 0) {
        attempts.push({ provider: provider.slug, status: 200, reason: 'no sources' });
        continue;
      }
      return { provider, payload, attempts };
    } catch (error) {
      const status = error instanceof StreamSourceError ? error.status : 0;
      const reason = error instanceof Error ? error.message : 'unknown failure';
      attempts.push({ provider: provider.slug, status, reason });
    }
  }

  // Report the most actionable status: a rate limit (429) tells the caller to slow
  // down or add a relay, whereas a generic 0 would surface as a plain 502.
  const reported = attempts.some((attempt) => attempt.status === 429)
    ? 429
    : (attempts[attempts.length - 1]?.status ?? 0);
  throw new StreamSourceError(
    `no provider returned sources (tried ${attempts.map((a) => a.provider).join(', ') || 'none'})`,
    reported,
    'failover',
    attempts,
  );
}

/** Quality ranked high→low so a player can pick the best ladder rung. */
export function qualityRank(quality: string): number {
  const digits = /(\d{3,4})/.exec(quality);
  if (digits) return Number(digits[1]);
  if (/auto/i.test(quality)) return 999;
  return 0;
}
