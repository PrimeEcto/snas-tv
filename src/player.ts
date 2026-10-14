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
export interface PlayerSurfaceProps {
  uri: string;
  headers?: Record<string, string>;
  /** WebVTT served by the Worker, attached as a text track when present. */
  subtitleUri?: string;
  paused: boolean;
  /** Playback speed, 1 being real time. */
  rate?: number;
  /** When this number changes the surface seeks to it, in seconds. */
  seekTo?: number;
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

const base = (): string => (backend.workerBase ?? '').trim().replace(/\/+$/, '');

/** One track as WebVTT, converted server-side, so no Referer is needed on the device. */
export function subtitleUrl(id: string, tmdbId: number, mediaType: 'movie' | 'tv'): string {
  return `${base()}/v1/subtitle/${encodeURIComponent(id)}.vtt?tmdbId=${tmdbId}&type=${mediaType}`;
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
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
