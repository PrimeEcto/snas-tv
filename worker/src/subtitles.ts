/**
 * subtitles.vidy.st client — the OpenSubtitles-backed source movy.sx itself uses.
 *
 * Found in the site's Next.js chunk `1_fhyxtq1vcbw.js`:
 *   https://subtitles.vidy.st/search?id=<tmdbId>[&season=<n>&episode=<n>]
 *
 * That endpoint always returns many languages (20–50 for a popular film), which is
 * what the TV app's subtitle menu needs. Each row's `url` points at
 * `https://subtitles.vidy.st/download?id=...`, which streams the subtitle text as
 * `text/plain; charset=utf-8` (usually SRT, sometimes SSA). Because SRT files from
 * the wild carry ASS/SSA override blocks like `{\3c&H00C5D2&\fnArabic Typesetting\b1}`,
 * conversion strips them: a TV player renders that as visible garbage.
 */
import type { FetchLike } from './movy.ts';

export const SUBTITLE_API_BASE = 'https://subtitles.vidy.st';

/** Path the API layer serves converted subtitles from. */
export const SUBTITLE_PROXY_PATH = '/v1/subtitle';

export interface SubtitleRecord {
  id: string;
  url: string;
  display: string;
  language: string;
  format: string;
  downloadCount: number;
  isTrusted: boolean;
  isHearingImpaired: boolean;
  source: string;
  release?: string;
  flagUrl?: string;
  encoding?: string;
}

export interface SubtitleGroup {
  languageName: string;
  language: string;
  subtitles: SubtitleRecord[];
}

/** SRT/ASS timestamp start, used to recognise cue timing lines. */
const TIMESTAMP_LINE = /^\d{1,2}:\d{2}:\d{2},\d{1,3}\s*-->\s*\d{1,2}:\d{2}:\d{2},\d{1,3}/;

/** Assumed/trusted releases first, then the most downloaded. */
const byTrustThenPopularity = (a: SubtitleRecord, b: SubtitleRecord): number =>
  Number(b.isTrusted) - Number(a.isTrusted)
  || b.downloadCount - a.downloadCount
  || a.display.localeCompare(b.display);

/** Normalise one raw search row, dropping anything without a usable id and url. */
function toRecord(raw: unknown): SubtitleRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  const id = typeof value.id === 'string' ? value.id : '';
  const url = typeof value.url === 'string' ? value.url : '';
  if (!id || !url) return null;
  return {
    id,
    url,
    display: typeof value.display === 'string' ? value.display : '',
    language: typeof value.language === 'string' ? value.language : '',
    format: (typeof value.format === 'string' ? value.format : '').toLowerCase(),
    downloadCount: typeof value.downloadCount === 'number' ? value.downloadCount : 0,
    isTrusted: value.isTrusted === true,
    isHearingImpaired: value.isHearingImpaired === true,
    source: typeof value.source === 'string' ? value.source : '',
    ...(typeof value.release === 'string' ? { release: value.release } : {}),
    ...(typeof value.flagUrl === 'string' ? { flagUrl: value.flagUrl } : {}),
    ...(typeof value.encoding === 'string' ? { encoding: value.encoding } : {}),
  };
}

/**
 * Search OpenSubtitles (via the site's own proxy) for a title, or for a single
 * episode when both `season` and `episode` are supplied.
 */
export async function searchSubtitles(
  tmdbId: number,
  options: { season?: number; episode?: number; fetchImpl?: FetchLike; timeoutMs?: number } = {},
): Promise<SubtitleRecord[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  let url = `${SUBTITLE_API_BASE}/search?id=${tmdbId}`;
  if (options.season !== undefined && options.episode !== undefined) {
    url += `&season=${options.season}&episode=${options.episode}`;
  }

  const response = await fetchImpl(url, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(options.timeoutMs ?? 8000),
  });
  if (!response.ok) throw new Error(`subtitle search failed (HTTP ${response.status})`);

  const body: unknown = await response.json();
  if (!Array.isArray(body)) return [];
  return body
    .map(toRecord)
    .filter((record): record is SubtitleRecord => record !== null)
    .sort(byTrustThenPopularity);
}

/**
 * Group subtitle rows by language for a menu, ordering languages alphabetically and
 * keeping the best release first inside each language.
 */
export function groupSubtitles(records: SubtitleRecord[]): SubtitleGroup[] {
  const groups = new Map<string, SubtitleGroup>();
  for (const record of records) {
    if (!record.url || !record.id) continue;
    const code = record.language || record.display || 'unknown';
    const group = groups.get(code);
    if (group) {
      group.subtitles.push(record);
      continue;
    }
    groups.set(code, {
      languageName: record.display || record.language || 'Unknown',
      language: code,
      subtitles: [record],
    });
  }

  return [...groups.values()]
    .map((group) => ({ ...group, subtitles: [...group.subtitles].sort(byTrustThenPopularity) }))
    .sort((a, b) => a.languageName.localeCompare(b.languageName));
}

/** Only plain SRT and already-WebVTT files can be served to the player directly. */
export function canServeAsVtt(format: string): boolean {
  const normalized = format.trim().toLowerCase();
  return normalized === 'srt' || normalized === 'vtt';
}

/** Replace the comma in `HH:MM:SS,mmm` timestamps, leaving cue text alone. */
function normalizeTimestamp(line: string): string {
  return line.replace(/(\d{1,2}:\d{2}:\d{2}),(\d{1,3})/g, '$1.$2');
}

/** Strip ASS/SSA override blocks and leftover styling escapes from cue text. */
function stripOverrides(line: string): string {
  return line.replace(/\{[^}]*\}/g, '');
}

/**
 * Convert SRT (or normalise VTT) into WebVTT text the player can consume.
 * Tolerant on input, deterministic on output: one `WEBVTT` header, LF line endings,
 * no cue counters, dotted timestamps and no styling blocks.
 */
export function srtToVtt(input: string): string {
  const normalized = input.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');
  const kept: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    // SRT cue counters are bare numbers sitting directly above a timestamp.
    if (/^\d+$/.test(trimmed) && TIMESTAMP_LINE.test((lines[index + 1] ?? '').trim())) continue;
    if (/^WEBVTT/i.test(trimmed)) continue;
    const cleaned = stripOverrides(line);
    kept.push(TIMESTAMP_LINE.test(cleaned.trim()) ? normalizeTimestamp(cleaned) : cleaned);
  }

  const body = kept
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+/, '')
    .replace(/\n+$/, '');

  return body ? `WEBVTT\n\n${body}\n` : 'WEBVTT\n';
}
