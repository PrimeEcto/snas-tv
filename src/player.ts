/**
 * The device's view of the SNAS backend, and the media contract both builds implement.
 *
 * `loadWatch` is the only place the app asks the Worker for playable material. It is
 * deliberately dependency-free (plain fetch) so the Vega and Android builds share it, and
 * it never throws into the UI: a device with no network must launch exactly as it does now.
 *
 * Playback itself is platform-specific and lives behind the `snas-player` alias that Metro
 * resolves per build: `firetv/player/android.tsx` renders an ExoPlayer (AndroidX Media3)
 * surface for Fire OS devices, and `firetv/player/vega.tsx` is the no-op the Vega build
 * keeps. The shared screens therefore contain no platform imports at all.
 */
import backend from './backend.json';
import {parseMasterPlaylist, type Rendition} from './ladder';

export interface WatchSource {
  quality: string;
  url: string;
}

export interface WatchSubtitle {
  id: string;
  language?: string;
  label?: string;
  format?: string;
}

export interface SubtitleGroup {
  language: string;
  label?: string;
  subtitles: WatchSubtitle[];
}

export interface WatchResult {
  provider: string;
  note?: string;
  sources: WatchSource[];
  /** Headers the CDN requires (a missing Referer is answered with 403), beside the URLs. */
  headers: Record<string, string>;
  playlist?: string;
  thumbnail?: string;
  subtitleGroups: SubtitleGroup[];
  subtitleCount: number;
  cached?: boolean;
}

export interface WatchTitle {
  id: number;
  kind: 'movie' | 'tv';
  title: string;
  year?: string;
}

export interface WatchEpisode {
  season: number;
  number: number;
}

export interface PlayerProgress {
  position: number;
  duration: number;
}

/** Props every player surface accepts, so the shared screens stay platform-free. */
/**
 * Media3's load control, as far as a screen may set it.
 *
 * The platform default buffers up to 50 seconds of media, which on this backend's 6 Mbps 1080p
 * rendition is around 38 MB held in the Java heap — measured on the emulator as a ~48 MB rise in
 * the app's Dalvik heap the moment the player opened. On a 32-bit device whose heap also holds the
 * decoded artwork that is memory the decoder's own buffers cannot have, so a constrained device
 * asks for less.
 */
export interface PlayerBufferConfig {
  minBufferMs?: number;
  maxBufferMs?: number;
  bufferForPlaybackMs?: number;
  bufferForPlaybackAfterRebufferMs?: number;
  backBufferDurationMs?: number;
  /** Fraction of the app's memory class the buffered media may occupy. */
  maxHeapAllocationPercent?: number;
  /** Fraction of the heap the player leaves free: below it, loading pauses instead of pressing on. */
  minBufferMemoryReservePercent?: number;
}

/** How the surface treats memory while buffering; the Android surface maps these to Media3. */
export type PlayerBufferingStrategy =
  | 'Default'
  | 'DependingOnMemory'
  | 'DisableBuffering';

export interface PlayerSurfaceProps {
  uri: string;
  headers?: Record<string, string>;
  /** The buffer this device can afford. Absent means the platform's own default. */
  bufferConfig?: PlayerBufferConfig;
  /**
   * The bitrate ceiling for adaptive playback, in bits per second.
   *
   * Only meaningful with a master playlist: the player then picks among the renditions it carries
   * and may not climb past this one. Absent means no ceiling, which is only safe for a pinned
   * rendition — a ceiling below the one rendition on offer would leave nothing to select.
   */
  maxBitRate?: number;
  /** `DependingOnMemory` stops loading when the heap is nearly spent rather than being killed for it. */
  bufferingStrategy?: PlayerBufferingStrategy;
  /** WebVTT served by the Worker, attached as a text track when present. */
  subtitleUri?: string;
  paused: boolean;
  /** Playback speed, 1 being real time. */
  rate?: number;
  /** When this number changes the surface seeks to it, in seconds. */
  seekTo?: number;
  /** A new command may seek to the same position again, such as Replay. */
  seekId?: number;
  resizeMode?: 'contain' | 'cover' | 'stretch';
  onProgress?: (progress: PlayerProgress) => void;
  onEnded?: () => void;
  onError?: (message: string) => void;
  style?: unknown;
}

type Fetcher = (
  url: string,
  options?: {headers?: Record<string, string>; signal?: AbortSignal},
) => Promise<{ok: boolean; status: number; json: () => Promise<unknown>}>;

type TextFetcher = (
  url: string,
  options?: {headers?: Record<string, string>; signal?: AbortSignal},
) => Promise<{ok: boolean; status: number; text: () => Promise<string>}>;

const base = (): string => (backend.workerBase ?? '').trim().replace(/\/+$/, '');

/** One track as WebVTT, converted server-side, so no Referer is needed on the device. */
export function subtitleUrl(id: string, tmdbId: number, mediaType: 'movie' | 'tv'): string {
  return `${base()}/v1/subtitle/${encodeURIComponent(id)}.vtt?tmdbId=${tmdbId}&type=${mediaType}`;
}

/**
 * The backend answered, and said that it — not this title — is the problem.
 *
 * Every title fails at once when the source service is down, and a viewer who is told "this title
 * couldn't play" goes looking for a different title instead of coming back. The distinction is the
 * status: a `5xx` is the service's own failure, a `4xx` or an empty source list is this title's.
 */
export class SourceUnavailableError extends Error {
  constructor(readonly status: number) {
    super('The source service is unavailable right now.');
    this.name = 'SourceUnavailableError';
  }
}

/** Whether a watch response means the source service is down rather than the title unplayable. */
export function sourceUnavailable(status: number): boolean {
  return Number.isFinite(status) && status >= 500;
}

/**
 * The real HLS ladder behind the `/v1/watch` sources, read from the provider's master playlist.
 *
 * The backend labels its renditions `2160p`/`1080p`/`720p`/`480p`, and those labels are not the
 * picture: across five titles measured on 2026-10-16 the `1080p` rung was 1920×1080 High Level 4.0
 * for four of them and 2584×1080 High Level 5.0 for the fifth, and `2160p` was 3840×2160 or
 * 3832×1600 High Level 5.1 for all of them. Without this call the app can only guess from the
 * label, and the guess is what puts a frame on a decoder that cannot allocate for it.
 *
 * Best-effort by design: any failure — no playlist, a timeout, an unreadable body — returns an
 * empty list, and the caller falls back to the label-based policy rather than holding up playback.
 */
export async function loadRenditions(
  playlist: string,
  headers?: Record<string, string>,
  options: {fetcher?: TextFetcher; timeoutMs?: number} = {},
): Promise<Rendition[]> {
  if (!playlist) return [];
  const fetcher = options.fetcher ?? (fetch as unknown as TextFetcher);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 4000);
  try {
    const response = await fetcher(playlist, {
      ...(headers && Object.keys(headers).length ? {headers} : {}),
      signal: controller.signal,
    });
    if (!response.ok) return [];
    const text = await response.text();
    return parseMasterPlaylist(text, playlist);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Ask the backend for sources, the headers to send with them, and the subtitle menu.
 *
 * Returns null when the backend is unconfigured, unreachable, has no source for the title,
 * or answers with an error — the caller decides how to say so.
 */
export async function loadWatch(
  title: WatchTitle,
  episode?: WatchEpisode,
  options: {fetcher?: Fetcher; timeoutMs?: number} = {},
): Promise<WatchResult | null> {
  const root = base();
  if (!root || !Number.isFinite(title.id)) return null;

  // Built by hand rather than with URLSearchParams: React Native's runtime only implements part of
  // that interface, and a missing method would throw before the request was ever sent.
  const parts = [`tmdbId=${encodeURIComponent(String(title.id))}`, `type=${encodeURIComponent(title.kind)}`];
  if (title.title) parts.push(`title=${encodeURIComponent(title.title)}`);
  if (title.year) parts.push(`year=${encodeURIComponent(title.year)}`);
  if (title.kind === 'tv' && episode) {
    parts.push(`season=${encodeURIComponent(String(episode.season))}`, `episode=${encodeURIComponent(String(episode.number))}`);
  }

  const fetcher = options.fetcher ?? (fetch as unknown as Fetcher);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 20000);
  try {
    const response = await fetcher(`${root}/v1/watch?${parts.join('&')}`, {
      headers: {Accept: 'application/json'},
      signal: controller.signal,
    });
    // A 5xx is the backend's own failure and is reported as such; anything else is this title's and
    // is left to the caller's "no playable source" path.
    if (sourceUnavailable(response.status)) throw new SourceUnavailableError(response.status);
    if (!response.ok) return null;
    const body = (await response.json()) as Partial<WatchResult> | null;
    if (!body || typeof body !== 'object') return null;
    const sources = Array.isArray(body.sources) ? body.sources.filter(s => s?.url) : [];
    if (!sources.length) return null;
    return {
      provider: typeof body.provider === 'string' ? body.provider : '',
      ...(typeof body.note === 'string' ? {note: body.note} : {}),
      sources,
      headers: (body.headers ?? {}) as Record<string, string>,
      ...(typeof body.playlist === 'string' ? {playlist: body.playlist} : {}),
      ...(typeof body.thumbnail === 'string' ? {thumbnail: body.thumbnail} : {}),
      subtitleGroups: Array.isArray(body.subtitleGroups) ? body.subtitleGroups : [],
      subtitleCount: typeof body.subtitleCount === 'number' ? body.subtitleCount : 0,
      ...(typeof body.cached === 'boolean' ? {cached: body.cached} : {}),
    };
  } catch (error) {
    // A service failure is the one failure the viewer can act on, so it must not be flattened into
    // the same null as an unplayable title; everything else (offline, timeout, bad JSON) stays one.
    if (error instanceof SourceUnavailableError) throw error;
    return null;
  } finally {
    clearTimeout(timer);
  }
}
