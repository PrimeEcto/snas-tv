/**
 * Which rendition of a stream this device is allowed to open, and which one it starts on.
 *
 * The backend labels its renditions `2160p`/`1080p`/`720p`/`480p`, but those labels are not the
 * picture. Across five titles measured on 2026-10-16, `1080p` was 1920×1080 High Level 4.0 on four of
 * them and 2584×1080 High Level 5.0 (`avc1.640032`) on the fifth, and `2160p` was 3840×2160 or
 * 3832×1600 High Level 5.1 (`avc1.640033`) every time. A 1st-generation Fire TV Stick 4K (AFTMM,
 * Fire OS 6, 32-bit, 1.5 GB) declares H.264 support and then fails to allocate output buffers for a
 * frame that wide — MediaTek reports `createGraphicBuffer failed` / `dequeueBuffer failed: Out of
 * memory (12)` and a fatal codec error. That is why the app must look at what a rendition really
 * contains, not at its label.
 *
 * Everything here is pure: the master playlist is a string, the device is a plain object, and the
 * decision is a function of the two. That is what lets the policy be tested without a device, and
 * what lets `src/device.ts` supply the device half in whatever form the platform can provide.
 *
 * The ladder matters twice: once when a title is opened (which rung to start on) and once when a
 * decoder error arrives (which rung to step down to). Both go through `pickQuality`.
 */
import type {PlayerBufferConfig, WatchSource} from './player';

/** One `#EXT-X-STREAM-INF` entry of a master playlist, with the fields that decide playability. */
export interface Rendition {
  /** Absolute URI resolved against the playlist, when a base was supplied. */
  uri: string;
  /** Last path segment, which is how a rendition is matched to a source the backend named. */
  name: string;
  width?: number;
  height?: number;
  frameRate?: number;
  bandwidth?: number;
  /** Codec strings such as `avc1.640032` / `mp4a.40.2`. */
  codecs: string[];
}

/**
 * What this device may be handed.
 *
 * `maxH264Level` is a level number in the decimal form the codec string uses (41 = Level 4.1),
 * which is why `codecLevel` returns 50 rather than 5 for `avc1.640032`.
 */
export interface VideoPolicy {
  /** `constrained` is a device the app deliberately keeps off the tall rungs. */
  kind: 'constrained' | 'full';
  maxWidth: number;
  maxHeight: number;
  maxH264Level: number;
  /** Why this policy was chosen, for the report the app can log. */
  reason: string;
}

/**
 * The policy for a device that has not said anything about itself.
 *
 * Being wrong conservatively costs some sharpness; being wrong optimistically costs the whole
 * session on a device like the stick, so the default is the safe one.
 */
export const CONSTRAINED_POLICY: VideoPolicy = {
  kind: 'constrained',
  maxWidth: 1920,
  maxHeight: 1088,
  maxH264Level: 41,
  reason: 'constrained: no device probe',
};

/** A device that reports room for the tall rungs. */
export const FULL_POLICY: VideoPolicy = {
  kind: 'full',
  maxWidth: 3840,
  maxHeight: 2160,
  maxH264Level: 51,
  reason: 'the device reports the memory and decoder for a 4K rendition',
};

/** Highest first, which is the order both the quality menu and the start decision read. */
export function orderByQuality(sources: WatchSource[]): WatchSource[] {
  return [...sources].sort(
    (a, b) =>
      (Number.parseInt(b.quality, 10) || 0) -
      (Number.parseInt(a.quality, 10) || 0),
  );
}

/** The pixel figure a label such as `1080p` or `4K` claims, or 0 when it claims nothing. */
export function labelPixels(quality: string): number {
  const digits = /(\d{3,4})/.exec(quality);
  if (digits) return Number.parseInt(digits[1], 10);
  return /4k|uhd/i.test(quality) ? 2160 : 0;
}

/** The last path segment of a URL, ignoring any query string. */
export function urlName(url: string): string {
  const withoutQuery = url.split('?')[0] ?? '';
  const parts = withoutQuery.split('/');
  return parts[parts.length - 1] ?? '';
}

/**
 * Parse the fields of a master playlist into renditions.
 *
 * Tolerant by design: a playlist the app cannot read costs it the ability to judge a rung, so a
 * missing RESOLUTION or a malformed attribute must leave a usable (if less informed) rendition
 * behind rather than throwing into the player.
 */
export function parseMasterPlaylist(text: string, base?: string): Rendition[] {
  if (typeof text !== 'string' || !text) return [];
  const lines = text.split(/\r?\n/);
  const renditions: Rendition[] = [];
  let pending: Omit<Rendition, 'uri' | 'name'> | null = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith('#EXT-X-STREAM-INF:')) {
      pending = attributes(line.slice('#EXT-X-STREAM-INF:'.length));
      continue;
    }
    if (!line || line.startsWith('#')) continue;
    if (!pending) continue;
    const uri = resolve(line, base);
    renditions.push({...pending, uri, name: urlName(uri || line)});
    pending = null;
  }
  return renditions;
}

/** The comma-separated attribute list of a playlist tag, with quoted values unwrapped. */
function attributes(list: string): Omit<Rendition, 'uri' | 'name'> {
  const values: Record<string, string> = {};
  // A quoted value may itself contain commas (CODECS="avc1.640032,mp4a.40.2"), so quoted runs are
  // matched first rather than splitting the whole string on commas.
  const pattern = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(list))) {
    values[match[1]] = match[2].replace(/^"|"$/g, '').trim();
  }
  const resolution = /^(\d+)x(\d+)$/.exec(values.RESOLUTION ?? '');
  const bandwidth = Number.parseInt(values.BANDWIDTH ?? values['AVERAGE-BANDWIDTH'] ?? '', 10);
  const frameRate = Number.parseFloat(values['FRAME-RATE'] ?? '');
  return {
    ...(resolution
      ? {
          width: Number.parseInt(resolution[1], 10),
          height: Number.parseInt(resolution[2], 10),
        }
      : {}),
    ...(Number.isFinite(frameRate) && frameRate > 0 ? {frameRate} : {}),
    ...(Number.isFinite(bandwidth) && bandwidth > 0 ? {bandwidth} : {}),
    codecs: (values.CODECS ?? '')
      .split(',')
      .map((codec) => codec.trim().toLowerCase())
      .filter(Boolean),
  };
}

/** An absolute URI for a playlist entry, leaving anything already absolute alone. */
function resolve(uri: string, base?: string): string {
  if (!base || /^[a-z][a-z0-9+.-]*:\/\//i.test(uri)) return uri;
  try {
    return new URL(uri, base).toString();
  } catch {
    return uri;
  }
}

/** True when a codec string is H.264/AVC. */
export function isH264(codec: string): boolean {
  return /^avc[13]\./.test(codec.toLowerCase());
}

/**
 * The H.264 level of a codec string as the decimal number the string carries.
 *
 * `avc1.640032` is profile 0x64, constraint 0x00, level 0x32 = 50, i.e. Level 5.0 — the last byte
 * is a decimal-looking hex pair, so 0x32 reads as "50" rather than 3.2 or 32.
 */
export function codecLevel(codec: string): number | undefined {
  const match = /^avc[13]\.([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(codec.trim());
  if (!match) return undefined;
  return Number.parseInt(match[3], 16);
}

/** The highest H.264 level carried by a rendition's codec list, when it declares one at all. */
export function renditionLevel(rendition: Rendition | undefined): number | undefined {
  const levels = (rendition?.codecs ?? [])
    .filter(isH264)
    .map(codecLevel)
    .filter((level): level is number => level !== undefined);
  return levels.length ? Math.max(...levels) : undefined;
}

/**
 * The rendition a source URL refers to.
 *
 * Matched on the file name first, because the master playlist and its variants are served from
 * different hosts in this ladder (`moon.zenoak.top/.../master.m3u8` naming `sd/98/index-...m3u8`
 * whose segments live on `mildtrail.top`), and on the quality label second, because a provider that
 * renames the file still tends to keep `720p` in it.
 */
export function matchRendition(
  source: WatchSource,
  renditions: Rendition[],
): Rendition | undefined {
  const name = urlName(source.url);
  if (name) {
    const exact = renditions.find((rendition) => rendition.name === name);
    if (exact) return exact;
  }
  const label = source.quality.trim();
  if (!label) return undefined;
  return renditions.find(
    (rendition) =>
      rendition.name.includes(label) || rendition.uri.includes(label),
  );
}

/**
 * The width and height to judge a source by.
 *
 * With a matched rendition the numbers are measured from the playlist. Without one the label is all
 * there is, and a label is a height: `1080p` is read as 1920×1080. That fallback cannot see the
 * ultrawide shape of this ladder, which is exactly why the master playlist is worth fetching.
 */
export function sourceFrame(
  source: WatchSource,
  rendition: Rendition | undefined,
): {width?: number; height?: number; measured: boolean} {
  if (rendition?.width && rendition?.height) {
    return {width: rendition.width, height: rendition.height, measured: true};
  }
  const pixels = labelPixels(source.quality);
  if (!pixels) return {measured: false};
  return {width: Math.round((pixels * 16) / 9), height: pixels, measured: false};
}

export interface QualityDecision {
  quality: string;
  /** True when the rendition was allowed by the policy, false when nothing was and this is the fallback. */
  allowed: boolean;
}

/**
 * The highest rung this device is allowed to open.
 *
 * `skip` holds qualities already known to be unusable — the surfaced step-down, and any rung whose
 * attempted playback took the process down with it (`src/state/playback-attempt.ts`). Skipping is a
 * preference rather than a prohibition: if every rung is skipped the whole ladder is tried again,
 * because the alternative to re-trying the least-bad rung is playing nothing at all.
 *
 * When no rung satisfies the policy the lowest one is returned rather than none: a device that
 * cannot open the 720p rung has no chance at the 2160p one either, and something must be tried
 * before the viewer is told the title cannot play.
 */
export function pickQuality(
  sources: WatchSource[],
  renditions: Rendition[],
  policy: VideoPolicy,
  options: {skip?: Iterable<string>; adaptive?: boolean} = {},
): QualityDecision {
  const ladder = orderByQuality(sources);
  if (!ladder.length) return {quality: '', allowed: false};
  const skip = new Set(options.skip ?? []);
  const candidates = ladder.filter((source) => !skip.has(source.quality));
  const usable = candidates.length ? candidates : ladder;
  // An adaptive session opens inside the same ceiling it will adapt within, so the rung it starts
  // on is one the player can climb back to. Decoding says 1080p is readable on this device; the
  // link is what makes 720p the right place to start.
  const judged = options.adaptive ? capHeight(policy, ADAPTIVE_MAX_HEIGHT) : policy;
  for (const source of usable) {
    const rendition = matchRendition(source, renditions);
    if (affordable(source, rendition, judged)) {
      return {quality: source.quality, allowed: true};
    }
  }
  return {quality: usable[usable.length - 1].quality, allowed: false};
}

/** The same policy with its height ceiling pulled down, which is all an adaptive cap changes. */
function capHeight(policy: VideoPolicy, height: number): VideoPolicy {
  return policy.maxHeight <= height ? policy : {...policy, maxHeight: height};
}

/** Whether one rung fits the policy. A rung that declares nothing is judged on its label. */
export function affordable(
  source: WatchSource,
  rendition: Rendition | undefined,
  policy: VideoPolicy,
): boolean {
  const frame = sourceFrame(source, rendition);
  if (frame.width && frame.width > policy.maxWidth) return false;
  if (frame.height && frame.height > policy.maxHeight) return false;
  const level = renditionLevel(rendition);
  // An unmeasured rung on a constrained device is not allowed past a 720p label: the point of the
  // constraint is that this device cannot be trusted with the wide rungs, and only the master
  // playlist can show that a tall label is really 3832 pixels across.
  if (level !== undefined && level > policy.maxH264Level) return false;
  if (
    !rendition &&
    policy.kind === 'constrained' &&
    labelPixels(source.quality) > 720
  )
    return false;
  return true;
}

/**
 * The media buffer a device can afford.
 *
 * Media3's defaults — 50 seconds of media, no ceiling on how much of the heap it may take and no
 * reserve left for anything else — are what this app inherited and what was measured on the
 * emulator as a Java heap that went from 10 MB to 59 MB the moment a 6 Mbps title opened. On a
 * constrained device the buffer is bounded instead: 25 seconds is about 19 MB at that bitrate,
 * still far more than a healthy connection needs to avoid stalling, and the player is told to stop
 * filling when only a fifth of the heap is left rather than filling until it is taken down.
 *
 * A device with room keeps the platform defaults: nothing here exists to make capable hardware
 * worse.
 */
export function bufferFor(policy: VideoPolicy): PlayerBufferConfig {
  if (policy.kind !== 'constrained') return {};
  return {
    // 25 seconds was measured against a link that only ever stalled for a moment. Measured again on
    // 2026-10-25, the CDN can crawl for the better part of a minute: one 720p segment came back at
    // 97 KB/s, 1.67 MB/s and 770 KB/s on three consecutive requests for the same URL. A quarter of
    // a minute of buffer drains in a fifth of a minute at that rate and the viewer sees the picture
    // stop, so the ceiling is raised to 40 seconds (~16 MB at 720p, inside the 0.25 heap share) and
    // the player is told to start with a real cushion rather than the minimum.
    minBufferMs: 15000,
    maxBufferMs: 40000,
    bufferForPlaybackMs: 3000,
    bufferForPlaybackAfterRebufferMs: 5000,
    // Nothing behind the playhead is kept: this device has no memory to spend on the past.
    backBufferDurationMs: 0,
    maxHeapAllocationPercent: 0.25,
    minBufferMemoryReservePercent: 0.2,
  };
}

/**
 * The highest rung an adaptive player on a constrained device climbs to.
 *
 * Decoding is not the only limit on this class of device. Measured from this network on 2026-10-25,
 * the CDN answered three consecutive requests for the *same* 6-second 720p segment (3.1 Mbps) at
 * 97 KB/s, 1.67 MB/s and 770 KB/s — a 17x spread, with the slowest well under the rung's own
 * bitrate. A pinned rendition has no answer to that; it either keeps up or it stalls. 720p is the
 * rung that leaves the widest room above 480p for the player to fall back to without giving up the
 * frame the stick can actually show.
 */
export const ADAPTIVE_MAX_HEIGHT = 720;

/** The adaptive ceiling used when no rendition reports a bandwidth, a little above 720p. */
export const ADAPTIVE_FALLBACK_BITRATE = 3_600_000;

/** Whether one measured rendition fits a policy on its own, ignoring labels entirely. */
function renditionFits(rendition: Rendition, policy: VideoPolicy): boolean {
  if (rendition.width && rendition.width > policy.maxWidth) return false;
  if (rendition.height && rendition.height > policy.maxHeight) return false;
  const level = renditionLevel(rendition);
  return level === undefined || level <= policy.maxH264Level;
}

/**
 * A bitrate to assume for a height when the ladder does not declare one.
 *
 * Roughly this backend's own ladder, and deliberately generous at the top: a ceiling that is too
 * low does not make playback safer, it just removes the rung the viewer asked for.
 */
function bitrateForHeight(height: number): number {
  if (height <= 480) return 2_000_000;
  if (height <= 720) return ADAPTIVE_FALLBACK_BITRATE;
  if (height <= 1088) return 7_000_000;
  return 20_000_000;
}

/**
 * The bitrate a constrained player may adapt up to, in bits per second.
 *
 * Taken from the renditions the device is allowed to decode and no taller than `ceilingHeight`
 * (720p by default), with a little headroom so the highest of those rungs is not excluded by its
 * own declared bandwidth. Without a measurement the height's fallback stands in.
 */
export function adaptiveCeiling(
  renditions: Rendition[],
  policy: VideoPolicy,
  ceilingHeight: number = ADAPTIVE_MAX_HEIGHT,
): number {
  const fitting = renditions.filter(
    (rendition) =>
      renditionFits(rendition, policy) &&
      (rendition.height ?? 0) <= ceilingHeight &&
      rendition.bandwidth,
  );
  if (!fitting.length) return bitrateForHeight(ceilingHeight);
  const top = Math.max(...fitting.map((rendition) => rendition.bandwidth ?? 0));
  return Math.max(Math.round(top * 1.15), 1_500_000);
}

/** What the surface is handed for one attempt: an adaptive playlist, or one pinned rendition. */
export interface PlaybackPlan {
  /** The URI the player opens. */
  uri: string;
  /** The ABR ceiling in bits per second, only present when the player is adapting. */
  maxBitRate?: number;
  adaptive: boolean;
  /** The pinned rendition, kept to fall back to when adaptive playback fails. */
  pinned: string;
  /** The rung the UI names for this attempt. */
  quality: string;
}

/**
 * Decide what to hand the player for one attempt.
 *
 * A constrained device does not open a rendition, it opens the master playlist and adapts within a
 * ceiling; every other device keeps the pinned rendition it always had. The fallback matters: if a
 * provider's master playlist is something ExoPlayer will not open, the pinned URL is one request
 * away rather than a dead session.
 */
export function planPlayback(
  sources: WatchSource[],
  renditions: Rendition[],
  policy: VideoPolicy,
  quality: string,
  playlist: string | undefined,
  options: {adaptive?: boolean} = {},
): PlaybackPlan | null {
  const ladder = orderByQuality(sources);
  const pinned = ladder.find((source) => source.quality === quality) ?? ladder[0];
  if (!pinned) return null;
  const adaptive =
    options.adaptive !== false && policy.kind === 'constrained' && Boolean(playlist);
  if (!adaptive) {
    return {
      uri: pinned.url,
      adaptive: false,
      pinned: pinned.url,
      quality: pinned.quality,
    };
  }
  // The chosen rung is the ceiling, not a pin: the menu reads as "up to this", and the player is
  // free to drop below it when the CDN slows down. Picking 480p therefore never plays 720p, and
  // picking 1080p still falls back rather than stalling.
  const ceilingHeight = Math.min(
    policy.maxHeight,
    labelPixels(pinned.quality) || ADAPTIVE_MAX_HEIGHT,
  );
  return {
    uri: playlist as string,
    maxBitRate: adaptiveCeiling(renditions, policy, ceilingHeight),
    adaptive: true,
    pinned: pinned.url,
    quality: pinned.quality,
  };
}

/** A one-line account of a ladder decision, for the playback log on the device. */
export function describeLadder(
  sources: WatchSource[],
  renditions: Rendition[],
  policy: VideoPolicy,
): string {
  return orderByQuality(sources)
    .map((source) => {
      const rendition = matchRendition(source, renditions);
      const frame = sourceFrame(source, rendition);
      const level = renditionLevel(rendition);
      const frame_ = frame.width ? `${frame.width}x${frame.height}` : 'unknown';
      const level_ = level !== undefined ? `L${(level / 10).toFixed(1)}` : 'level?';
      return `${source.quality}[${frame_} ${level_} ${
        affordable(source, rendition, policy) ? 'ok' : 'no'
      }]`;
    })
    .join(' ');
}
