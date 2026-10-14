/**
 * Artwork preloading, so the first screen after launch is already painted.
 *
 * The catalogue screens mount a whole rail at once — up to twelve cards, each one an `Image` — and
 * home mounts eight of those rails together. Left alone, the first paint after launch asks the
 * network for a hundred posters in a single burst, and the device shows it: the frames drop exactly
 * while the viewer is looking at the hero.
 *
 * These functions collect the artwork a screen is about to show and fetch it in a small, bounded
 * wave *before* those cards are mounted, so the images are already in the platform cache when they
 * appear. The launch screen (`ui/BootScreen.tsx`) reports the wave's progress.
 *
 * `prefetch` is injected rather than imported: on a device it is React Native's `Image.prefetch`, in
 * a test it is a stub, and this way the Vega and the Android build share one file without either
 * importing the other's platform module.
 */
import {demoTitles, imageUrl} from './service';
import type {Catalog} from './service';
import type {Rail, Title} from './types';

/** The two artwork sizes the catalogue screens actually paint. */
export const POSTER_SIZE = 'w342';
export const BACKDROP_SIZE = 'w1280';

/** Home's hero title, which the screen falls back to when a rail does not carry it. */
const FEATURED_ID = 157336;
/** The one rail whose cards are wide, so its artwork is a backdrop rather than a poster. */
const WIDE_RAIL = 'continue';

export const DEFAULT_CONCURRENCY = 5;
const DEFAULT_PER_IMAGE_MS = 15000;
/** The whole wave gives up after this long; the viewer must never wait longer than this to see home. */
const DEFAULT_BUDGET_MS = 30000;

export interface PreloadProgress {
  done: number;
  total: number;
}

export type Prefetch = (url: string) => Promise<unknown>;

export interface PreloadOptions {
  /** How many images may be in flight at once. */
  concurrency?: number;
  /** A single image slower than this is skipped rather than waited on. */
  perImageMs?: number;
  /** The wave stops starting new images after this long, so a slow network cannot hold up the launch. */
  budgetMs?: number;
  onProgress?: (progress: PreloadProgress) => void;
  prefetch?: Prefetch;
  now?: () => number;
}

const noop: Prefetch = () => Promise.resolve(false);

function artwork(title: Title | undefined, backdrop: boolean): string | undefined {
  if (!title) return undefined;
  return imageUrl(backdrop ? title.backdrop : title.poster, backdrop ? BACKDROP_SIZE : POSTER_SIZE);
}

/**
 * Every image the home screen is about to paint, hero first and deduplicated.
 *
 * `continueTitles` is the library's continue-watching list, which home shows as its one wide rail
 * and which the catalogue rails do not necessarily contain.
 */
export function homeArtwork(rails: Rail[], continueTitles: Title[] = []): string[] {
  const urls: string[] = [];
  const hero = rails[0]?.items.find(title => title.id === FEATURED_ID) ?? rails[0]?.items[0] ?? demoTitles[0];
  const heroArtwork = artwork(hero, true);
  if (heroArtwork) urls.push(heroArtwork);
  for (const title of continueTitles) {
    const url = artwork(title, true);
    if (url) urls.push(url);
  }
  for (const rail of rails) {
    const wide = rail.id === WIDE_RAIL;
    for (const title of rail.items) {
      const url = artwork(title, wide);
      if (url) urls.push(url);
    }
  }
  return [...new Set(urls)];
}

/** One image, bounded by its own timeout, with every failure counted as finished rather than thrown. */
async function one(url: string, prefetch: Prefetch, perImageMs: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.resolve(prefetch(url)).catch(() => undefined),
      new Promise<void>(resolve => {
        timer = setTimeout(resolve, perImageMs);
      }),
    ]);
  } catch {
    // A prefetch that throws synchronously is a failed image, not a failed launch.
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Fetch `urls` in a bounded wave, reporting progress as each image settles.
 *
 * Resolves with how many were attempted: an image that fails, or the ones the budget cut short, are
 * counted as done so the launch screen always finishes and the app opens with whatever arrived.
 */
export async function preloadArtwork(urls: string[], options: PreloadOptions = {}): Promise<PreloadProgress> {
  const list = [...new Set(urls.filter(url => typeof url === 'string' && url.length > 0))];
  const total = list.length;
  const {onProgress, prefetch = noop, now = Date.now} = options;
  const perImageMs = Math.max(1, options.perImageMs ?? DEFAULT_PER_IMAGE_MS);
  const deadline = now() + Math.max(1, options.budgetMs ?? DEFAULT_BUDGET_MS);
  const asked = Math.max(1, Math.floor(options.concurrency ?? DEFAULT_CONCURRENCY) || DEFAULT_CONCURRENCY);
  const lanes = Math.max(1, Math.min(asked, total || 1));
  let done = 0;
  let next = 0;
  let stopped = false;

  onProgress?.({done, total});
  if (!total) return {done, total};

  const lane = async () => {
    while (!stopped) {
      const index = next++;
      if (index >= total) return;
      await one(list[index], prefetch, perImageMs);
      done += 1;
      onProgress?.({done, total});
      if (now() >= deadline) {
        stopped = true;
        return;
      }
    }
  };

  await Promise.all(Array.from({length: lanes}, lane));
  stopped = true;
  return {done, total};
}

/**
 * Load the catalogue and preload everything home will paint.
 *
 * The catalogue read is the same cached promise `HomeScreen` asks for a moment later, so the rails
 * are not fetched twice; an unreachable backend simply ends the wave early and the screen shows its
 * own error, which is where that message already belongs.
 */
export function preloadHome(catalog: Catalog, continueTitles: Title[] = [], options: PreloadOptions = {}): Promise<PreloadProgress> {
  return catalog.home().then(
    rails => preloadArtwork(homeArtwork(rails, continueTitles), options),
    () => ({done: 0, total: 0}),
  );
}
