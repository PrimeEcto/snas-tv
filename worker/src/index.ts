/**
 * SNAS backend — Cloudflare Worker API in front of movy.sx.
 *
 * The device never talks to movy.sx or OpenSubtitles directly. It asks this Worker for
 * a title and gets back playable source URLs plus a multi-language subtitle menu:
 *
 *   GET /v1/watch?tmdbId=969681&type=movie&title=...      sources + subtitles in one call
 *   GET /v1/sources?tmdbId=...&type=tv&season=1&episode=2 sources only
 *   GET /v1/subtitles?tmdbId=...&season=1&episode=2       OpenSubtitles menu, grouped
 *   GET /v1/subtitle/<id>.vtt?tmdbId=...                  one track, SRT converted to WebVTT
 *   GET /v1/providers                                     mirror list for a server picker
 *   GET /v1/app/latest?currentVersion=0.1.0&format=apk     update manifest (private repo)
 *   GET /v1/app/asset/<name>                              release asset, proxied
 *
 * Upstream is aggressively rate-limited, so every expensive answer is cached in
 * Supabase for a short TTL and provider failover happens server-side.
 */
import { DEFAULT_PROVIDER_ORDER, PROVIDERS, StreamSourceError, clearSeedCache, fetchSourcesWithFailover, qualityRank, resolveTransport, type FetchLike, type StreamPayload, type TitleRef, type VideoSource } from './movy.ts';
import { canServeAsVtt, groupSubtitles, searchSubtitles, srtToVtt, type SubtitleGroup, type SubtitleRecord } from './subtitles.ts';
import { cacheKey, createCache, type Cache } from './cache.ts';
import { checkForUpdate, downloadReleaseAsset, fetchLatestRelease, type ReleaseEnv } from './release.ts';

export interface Env extends ReleaseEnv {
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  /**
   * Optional: the SNAS catalogue proxy, which resolves title/year/imdb when the device
   * only sends a TMDB id. The TMDB credential lives in that function's environment and
   * nowhere else — this Worker holds no TMDB key of its own.
   */
  TMDB_PROXY_URL?: string;
  /** Comma-separated allow-list; defaults to "*" because this API is read-only. */
  ALLOWED_ORIGINS?: string;
  /**
   * Upstream fetch relay. The upstream rate-limits Cloudflare's shared egress IPs
   * (HTTP 429 on /seed), so production points this at a relay on a different egress.
   */
  UPSTREAM_RELAY_URL?: string;
  UPSTREAM_RELAY_SECRET?: string;
}

export interface HandlerDeps {
  fetchImpl?: FetchLike;
  now?: () => number;
}

const SERVICE = 'snas-movy';
const VERSION = '1.0.0';

/** Source URLs expire, so they are only reused briefly. */
const SOURCES_TTL_SECONDS = 600;
const SUBTITLES_TTL_SECONDS = 6 * 60 * 60;
const SUBTITLE_FILE_TTL_SECONDS = 24 * 60 * 60;
const RELEASE_TTL_SECONDS = 300;

/**
 * The stream CDN answers `403` to a request that carries no `Referer` from the site and
 * `200 application/vnd.apple.mpegurl` with one, so a source URL on its own is not
 * playable. Returned once beside the sources instead of repeated on every ladder rung.
 * Measured against the live CDN; the value does not depend on the User-Agent.
 */
const PLAYER_HEADERS: Record<string, string> = { referer: 'https://www.movy.sx/' };

const json = (body: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...extraHeaders,
    },
  });

const fail = (status: number, error: string, detail?: string): Response =>
  json({ error, ...(detail ? { detail } : {}) }, status, { 'cache-control': 'no-store' });

function corsHeaders(env: Env): Record<string, string> {
  const configured = env.ALLOWED_ORIGINS?.trim();
  const origin = !configured || configured === '*' ? '*' : configured;
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, OPTIONS',
    'access-control-allow-headers': 'content-type, authorization',
    'access-control-max-age': '86400',
  };
}

function withCors(response: Response, env: Env): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(corsHeaders(env))) headers.set(name, value);
  return new Response(response.body, { status: response.status, headers });
}

function integerParam(params: URLSearchParams, name: string): number | undefined {
  const raw = params.get(name);
  if (raw === null || raw.trim() === '') return undefined;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

interface ResolvedTitle extends TitleRef {
  /** Set when the title had to be resolved from TMDB rather than the request. */
  resolvedFromTmdb?: boolean;
}

/** Optional TMDB lookup so a device can ask with only a TMDB id. */
async function resolveTitleFromTmdb(
  tmdbId: number,
  mediaType: 'movie' | 'tv',
  fetchImpl: FetchLike,
  proxyUrl: string,
): Promise<{ title: string; year?: string; imdbId?: string; totalSeasons?: number } | null> {
  try {
    const base = proxyUrl.trim().replace(/\/+$/, '');
    const url = `${base}/${mediaType}/${tmdbId}?append_to_response=external_ids&language=en-US`;
    const response = await fetchImpl(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as {
      title?: string;
      name?: string;
      release_date?: string;
      first_air_date?: string;
      number_of_seasons?: number;
      external_ids?: { imdb_id?: string };
    };
    const title = body.title ?? body.name;
    if (!title) return null;
    const date = body.release_date ?? body.first_air_date ?? '';
    return {
      title,
      ...(date ? { year: date.slice(0, 4) } : {}),
      ...(body.external_ids?.imdb_id ? { imdbId: body.external_ids.imdb_id } : {}),
      ...(body.number_of_seasons ? { totalSeasons: body.number_of_seasons } : {}),
    };
  } catch {
    return null;
  }
}

/**
 * Resolve the upstream query parameters from the request, falling back to TMDB when
 * the device did not send a title.
 */
async function resolveTitle(
  params: URLSearchParams,
  env: Env,
  fetchImpl: FetchLike,
): Promise<ResolvedTitle | Response> {
  const tmdbId = integerParam(params, 'tmdbId');
  if (!tmdbId) return fail(400, 'tmdbId is required and must be a positive integer');

  const rawType = (params.get('type') ?? 'movie').toLowerCase();
  if (rawType !== 'movie' && rawType !== 'tv') return fail(400, "type must be 'movie' or 'tv'");
  const mediaType = rawType as 'movie' | 'tv';

  const seasonId = mediaType === 'tv' ? integerParam(params, 'season') : undefined;
  const episodeId = mediaType === 'tv' ? integerParam(params, 'episode') : undefined;
  if (mediaType === 'tv' && (seasonId === undefined) !== (episodeId === undefined)) {
    return fail(400, 'season and episode must be supplied together');
  }

  let title = params.get('title')?.trim() ?? '';
  let year = params.get('year')?.trim();
  let imdbId = params.get('imdb')?.trim();
  let totalSeasons = integerParam(params, 'totalSeasons');

  let resolvedFromTmdb = false;
  if (!title && env.TMDB_PROXY_URL) {
    const resolved = await resolveTitleFromTmdb(tmdbId, mediaType, fetchImpl, env.TMDB_PROXY_URL);
    if (resolved) {
      resolvedFromTmdb = true;
      title = resolved.title;
      year = year ?? resolved.year;
      imdbId = imdbId ?? resolved.imdbId;
      totalSeasons = totalSeasons ?? resolved.totalSeasons;
    }
  }
  if (!title) {
    return fail(400, 'title is required (or configure TMDB_PROXY_URL so it can be resolved)');
  }

  return {
    title,
    tmdbId,
    mediaType,
    ...(resolvedFromTmdb ? { resolvedFromTmdb: true } : {}),
    ...(year ? { year } : {}),
    ...(imdbId ? { imdbId } : {}),
    ...(totalSeasons ? { totalSeasons } : {}),
    ...(seasonId !== undefined ? { seasonId } : {}),
    ...(episodeId !== undefined ? { episodeId } : {}),
  };
}

function parseProviders(params: URLSearchParams): string[] {
  const requested = params.get('providers') ?? params.get('provider');
  if (!requested) return DEFAULT_PROVIDER_ORDER;
  const known = new Set(PROVIDERS.map((provider) => provider.slug));
  const slugs = requested
    .split(',')
    .map((slug) => slug.trim().toLowerCase())
    .filter((slug) => known.has(slug));
  return slugs.length > 0 ? slugs : DEFAULT_PROVIDER_ORDER;
}

function orderSources(sources: VideoSource[]): VideoSource[] {
  return [...sources].sort((a, b) => qualityRank(b.quality) - qualityRank(a.quality));
}

interface SourcesResult {
  provider: string;
  note: string;
  sources: VideoSource[];
  thumbnail?: string;
  playlist?: string;
  attempts: { provider: string; status: number; reason: string }[];
  cached: boolean;
}

async function loadSources(
  ref: TitleRef,
  providers: string[],
  cache: Cache,
  transport: ReturnType<typeof resolveTransport>,
  fresh: boolean,
): Promise<SourcesResult> {
  const key = cacheKey(['sources', ref.tmdbId, ref.mediaType, ref.seasonId, ref.episodeId, providers.join('+')]);
  if (!fresh) {
    const hit = await cache.get<Omit<SourcesResult, 'cached'>>(key);
    if (hit) return { ...hit.value, cached: true };
  }

  const result = await fetchSourcesWithFailover(ref, { providers, transport, staggerMs: 150 });
  const payload: StreamPayload = result.payload;
  const value = {
    provider: result.provider.slug,
    note: result.provider.note,
    sources: orderSources(payload.sources),
    ...(payload.thumbnail ? { thumbnail: payload.thumbnail } : {}),
    ...(payload.playlist ? { playlist: payload.playlist } : {}),
    attempts: result.attempts,
  };
  // Cache only successful answers; a 429-heavy failure should be retried next time.
  await cache.set(key, value, SOURCES_TTL_SECONDS);
  return { ...value, cached: false };
}

async function loadSubtitleRecords(
  tmdbId: number,
  mediaType: 'movie' | 'tv',
  season: number | undefined,
  episode: number | undefined,
  cache: Cache,
  fetchImpl: FetchLike,
  fresh: boolean,
): Promise<{ records: SubtitleRecord[]; cached: boolean }> {
  const key = cacheKey(['subs', tmdbId, mediaType, season, episode]);
  if (!fresh) {
    const hit = await cache.get<SubtitleRecord[]>(key);
    if (hit) return { records: hit.value, cached: true };
  }
  const records = await searchSubtitles(tmdbId, {
    ...(mediaType === 'tv' && season !== undefined && episode !== undefined ? { season, episode } : {}),
    fetchImpl,
  });
  if (records.length > 0) await cache.set(key, records, SUBTITLES_TTL_SECONDS);
  return { records, cached: false };
}

function sourcesPayload(result: SourcesResult): Record<string, unknown> {
  return {
    provider: result.provider,
    note: result.note,
    sources: result.sources,
    // The player must send these with every request for the URLs above.
    headers: { ...PLAYER_HEADERS },
    ...(result.thumbnail ? { thumbnail: result.thumbnail } : {}),
    ...(result.playlist ? { playlist: result.playlist } : {}),
    attempts: result.attempts,
    cached: result.cached,
  };
}

export function createHandler(env: Env, deps: HandlerDeps = {}) {
  const fetchImpl: FetchLike = deps.fetchImpl ?? ((input, init) => fetch(input, init));
  const now = deps.now ?? Date.now;
  const transport = resolveTransport(env, fetchImpl);
  const sourcesCache = createCache(env, { fetchImpl, table: 'movy_stream_cache', now });
  const subtitleCache = createCache(env, { fetchImpl, table: 'movy_subtitle_cache', now });

  return async function handle(request: Request): Promise<Response> {
    if (request.method === 'OPTIONS') return withCors(new Response(null, { status: 204 }), env);
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return withCors(fail(405, 'only GET is supported'), env);
    }

    const url = new URL(request.url);
    const params = url.searchParams;
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const fresh = params.get('fresh') === '1' || params.get('fresh') === 'true';

    try {
      if (path === '/' || path === '/health') {
        return withCors(
          json({
            service: SERVICE,
            version: VERSION,
            ok: true,
            time: new Date(now()).toISOString(),
            endpoints: ['/v1/watch', '/v1/sources', '/v1/subtitles', '/v1/subtitle/<id>.vtt', '/v1/providers', '/v1/app/latest', '/v1/app/asset/<name>'],
          }),
          env,
        );
      }

      if (path === '/v1/providers') {
        return withCors(
          json(
            {
              providers: PROVIDERS.map((provider) => ({ ...provider })),
              default: DEFAULT_PROVIDER_ORDER,
            },
            200,
            { 'cache-control': 'public, max-age=86400' },
          ),
          env,
        );
      }

      if (path === '/v1/sources' || path === '/v1/watch') {
        const ref = await resolveTitle(params, env, fetchImpl);
        if (ref instanceof Response) return withCors(ref, env);
        const providers = parseProviders(params);

        let result: SourcesResult;
        try {
          result = await loadSources(ref, providers, sourcesCache, transport, fresh);
        } catch (error) {
          if (error instanceof StreamSourceError) {
            const status = error.status === 429 ? 503 : 502;
            return withCors(
              json(
                {
                  error: 'no stream provider is available right now',
                  detail: error.message,
                  attempts: error.attempts,
                },
                status,
                { 'cache-control': 'no-store' },
              ),
              env,
            );
          }
          throw error;
        }

        if (path === '/v1/sources') {
          return withCors(json(sourcesPayload(result), 200, { 'cache-control': `public, max-age=${SOURCES_TTL_SECONDS}` }), env);
        }

        // /v1/watch: sources plus the subtitle menu in one round trip. A subtitle
        // failure must not cost the device its playback sources.
        let groups: SubtitleGroup[] = [];
        let subtitleError: string | undefined;
        try {
          const subtitles = await loadSubtitleRecords(
            ref.tmdbId,
            ref.mediaType,
            ref.seasonId,
            ref.episodeId,
            subtitleCache,
            fetchImpl,
            fresh,
          );
          groups = groupSubtitles(subtitles.records);
        } catch (error) {
          subtitleError = error instanceof Error ? error.message : 'subtitle lookup failed';
        }

        return withCors(
          json(
            {
              ...sourcesPayload(result),
              subtitleGroups: groups,
              subtitleCount: groups.reduce((total, group) => total + group.subtitles.length, 0),
              ...(subtitleError ? { subtitleError } : {}),
              tmdbId: ref.tmdbId,
              type: ref.mediaType,
            },
            200,
            { 'cache-control': `public, max-age=${SOURCES_TTL_SECONDS}` },
          ),
          env,
        );
      }

      if (path === '/v1/subtitles') {
        const ref = await resolveTitle(params, env, fetchImpl);
        if (ref instanceof Response) return withCors(ref, env);
        const subtitles = await loadSubtitleRecords(
          ref.tmdbId,
          ref.mediaType,
          ref.seasonId,
          ref.episodeId,
          subtitleCache,
          fetchImpl,
          fresh,
        );
        const groups = groupSubtitles(subtitles.records);
        return withCors(
          json(
            {
              tmdbId: ref.tmdbId,
              type: ref.mediaType,
              groups,
              count: groups.reduce((total, group) => total + group.subtitles.length, 0),
              cached: subtitles.cached,
            },
            200,
            { 'cache-control': `public, max-age=${SUBTITLES_TTL_SECONDS}` },
          ),
          env,
        );
      }

      if (path.startsWith('/v1/subtitle/')) {
        const rawId = decodeURIComponent(path.slice('/v1/subtitle/'.length)).replace(/\.vtt$/i, '');
        if (!/^[\w-]{8,256}$/.test(rawId)) return withCors(fail(400, 'invalid subtitle id'), env);
        const ref = await resolveTitle(params, env, fetchImpl);
        if (ref instanceof Response) return withCors(ref, env);
        const subtitles = await loadSubtitleRecords(
          ref.tmdbId,
          ref.mediaType,
          ref.seasonId,
          ref.episodeId,
          subtitleCache,
          fetchImpl,
          fresh,
        );
        const record = subtitles.records.find((candidate) => candidate.id === rawId);
        if (!record) return withCors(fail(404, 'subtitle track is no longer available'), env);
        if (!canServeAsVtt(record.format)) {
          return withCors(fail(415, `subtitle format '${record.format}' cannot be served as WebVTT`), env);
        }

        const fileKey = cacheKey(['subfile', rawId]);
        const cachedFile = fresh ? null : await subtitleCache.get<string>(fileKey);
        if (cachedFile) {
          return withCors(
            new Response(cachedFile.value, {
              status: 200,
              headers: { 'content-type': 'text/vtt; charset=utf-8', 'cache-control': 'public, max-age=86400' },
            }),
            env,
          );
        }

        const download = await fetchImpl(record.url, { signal: AbortSignal.timeout(15000) });
        if (!download.ok) return withCors(fail(502, `subtitle download failed (HTTP ${download.status})`), env);
        const text = await download.text();
        const vtt = record.format === 'vtt' ? text : srtToVtt(text);
        await subtitleCache.set(fileKey, vtt, SUBTITLE_FILE_TTL_SECONDS);
        return withCors(
          new Response(vtt, {
            status: 200,
            headers: { 'content-type': 'text/vtt; charset=utf-8', 'cache-control': 'public, max-age=86400' },
          }),
          env,
        );
      }

      if (path === '/v1/app/latest') {
        // `format=apk|vpkg` is what the asking device can install; without it the newest release is
        // returned, which is what the host-side installers want.
        const format = params.get('format')?.trim().toLowerCase();
        const manifest = await fetchLatestRelease(env, {
          channel: params.get('channel') === 'beta' ? 'beta' : 'stable',
          ...(format === 'apk' || format === 'vpkg' ? { format } : {}),
          fetchImpl,
        });
        const check = checkForUpdate(manifest, params.get('currentVersion')?.trim() || undefined);
        return withCors(json(check, 200, { 'cache-control': `public, max-age=${RELEASE_TTL_SECONDS}` }), env);
      }

      if (path.startsWith('/v1/app/asset/')) {
        const name = decodeURIComponent(path.slice('/v1/app/asset/'.length));
        if (!/^[\w.-]{1,120}$/.test(name)) return withCors(fail(400, 'invalid asset name'), env);
        const asset = await downloadReleaseAsset(env, name, {
          channel: params.get('channel') === 'beta' ? 'beta' : 'stable',
          fetchImpl,
        });
        return withCors(asset, env);
      }

      return withCors(fail(404, `unknown path ${path}`), env);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unexpected failure';
      return withCors(fail(500, 'backend failure', message), env);
    }
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return createHandler(env)(request);
  },
};

/** Exposed for tests and for `wrangler dev` reloads. */
export { clearSeedCache };
