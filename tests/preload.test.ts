import test from 'node:test';
import assert from 'node:assert/strict';
import { homeArtwork, preloadArtwork, preloadHome, type PreloadProgress } from '../src/catalog/preload.ts';
import { demoTitles } from '../src/catalog/service.ts';
import type { Catalog } from '../src/catalog/service.ts';
import type { Rail, Title } from '../src/catalog/types.ts';

const title = (id: number, poster: string | null, backdrop: string | null): Title => ({
  id, kind: 'movie', title: `Title ${id}`, year: '2026', overview: '', poster, backdrop, genres: [], rating: null, runtime: null,
});
const posterUrl = (name: string) => `https://image.tmdb.org/t/p/w342/${name}`;
const backdropUrl = (name: string) => `https://image.tmdb.org/t/p/w1280/${name}`;
const rail = (id: string, items: Title[]): Rail => ({ id, title: id, items });

test('the featured backdrop leads the home artwork and other rails contribute their posters', () => {
  const featured = title(157336, '/featured-poster.jpg', '/featured-backdrop.jpg');
  const artwork = homeArtwork([
    rail('spotlight', [title(42, '/other-poster.jpg', '/other-backdrop.jpg'), featured]),
    rail('series', [title(7, '/series-poster.jpg', '/series-backdrop.jpg')]),
  ]);
  // The hero's backdrop, then each rail's poster in order — including the hero's own poster, which
  // its rail card paints separately from the full-bleed backdrop behind it.
  assert.deepEqual(artwork, [
    backdropUrl('featured-backdrop.jpg'),
    posterUrl('other-poster.jpg'),
    posterUrl('featured-poster.jpg'),
    posterUrl('series-poster.jpg'),
  ]);
});

test('without the featured id the first item of the first rail is used, and an empty catalogue falls back to the sample record', () => {
  const first = title(42, '/first-poster.jpg', '/first-backdrop.jpg');
  assert.equal(homeArtwork([rail('spotlight', [first, title(7, '/p.jpg', '/b.jpg')])])[0], backdropUrl('first-backdrop.jpg'));
  // The sample records are bundled with the app, so an unreachable backend still has a hero to draw.
  const demo = demoTitles[0];
  assert.deepEqual(homeArtwork([]), demo.backdrop ? [backdropUrl(demo.backdrop.slice(1))] : []);
});

test('continue watching and the wide rail contribute backdrops while titles without a path are skipped', () => {
  const resumed = title(9, '/resumed-poster.jpg', '/resumed-backdrop.jpg');
  const artwork = homeArtwork([
    rail('spotlight', [title(11, '/hero-poster.jpg', '/hero-backdrop.jpg'), title(10, null, null)]),
    rail('continue', [resumed, title(12, '/wide-poster.jpg', '/wide-backdrop.jpg')]),
  ], [resumed, title(13, null, null)]);
  assert.deepEqual(artwork, [
    backdropUrl('hero-backdrop.jpg'),
    backdropUrl('resumed-backdrop.jpg'),
    posterUrl('hero-poster.jpg'),
    backdropUrl('wide-backdrop.jpg'),
  ]);
});

test('the same artwork is never listed twice, whatever rail it arrives from', () => {
  const shared = title(42, '/same-poster.jpg', '/same-backdrop.jpg');
  assert.deepEqual(homeArtwork([rail('spotlight', [shared, shared]), rail('more', [shared])], [shared]), [
    backdropUrl('same-backdrop.jpg'),
    posterUrl('same-poster.jpg'),
  ]);
});

test('an empty list resolves immediately and never calls prefetch', async () => {
  let calls = 0;
  const prefetch = async () => { calls += 1; };
  assert.deepEqual(await preloadArtwork([], { prefetch }), { done: 0, total: 0 });
  assert.deepEqual(await preloadArtwork(['', ''], { prefetch }), { done: 0, total: 0 });
  assert.equal(calls, 0);
  // No prefetch at all is the no-op default, which is what a platform without Image.prefetch gets.
  assert.deepEqual(await preloadArtwork(['only'], { perImageMs: 5 }), { done: 1, total: 1 });
});

test('every url is fetched exactly once and progress rises monotonically to the total', async () => {
  const seen: string[] = [];
  const progress: PreloadProgress[] = [];
  const result = await preloadArtwork(['a', 'b', 'b', '', 'c'], {
    concurrency: 2,
    perImageMs: 5,
    onProgress: next => progress.push(next),
    prefetch: async url => { seen.push(url); },
  });
  assert.deepEqual(result, { done: 3, total: 3 });
  assert.deepEqual([...seen].sort(), ['a', 'b', 'c']);
  assert.equal(seen.length, 3);
  assert.deepEqual(progress[0], { done: 0, total: 3 });
  assert.deepEqual(progress[progress.length - 1], { done: 3, total: 3 });
  for (let i = 1; i < progress.length; i++) assert.ok(progress[i].done >= progress[i - 1].done);
  for (const step of progress) assert.equal(step.total, 3);
});

test('no more images are in flight at once than the concurrency allows', async () => {
  const urls = Array.from({ length: 12 }, (_, index) => `u${index}`);
  let inFlight = 0;
  let peak = 0;
  const prefetch = () => new Promise<void>(resolve => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    setTimeout(() => { inFlight -= 1; resolve(); }, 2);
  });
  assert.deepEqual(await preloadArtwork(urls, { concurrency: 3, perImageMs: 50, prefetch }), { done: 12, total: 12 });
  assert.ok(peak <= 3, `expected at most 3 in flight, saw ${peak}`);
  assert.ok(peak > 1, `expected the wave to run in parallel, saw a peak of ${peak}`);
});

test('concurrency is clamped to the number of images actually waiting', async () => {
  let inFlight = 0;
  let peak = 0;
  const prefetch = () => new Promise<void>(resolve => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    setTimeout(() => { inFlight -= 1; resolve(); }, 2);
  });
  assert.deepEqual(await preloadArtwork(['a', 'b'], { concurrency: 50, perImageMs: 50, prefetch }), { done: 2, total: 2 });
  assert.equal(peak, 2);
});

test('images that reject or throw synchronously are counted as done instead of failing the launch', async () => {
  const result = await preloadArtwork(['reject', 'throw', 'ok'], {
    perImageMs: 20,
    prefetch: url => {
      if (url === 'throw') throw new Error('synchronous failure');
      if (url === 'reject') return Promise.reject(new Error('offline'));
      return Promise.resolve(true);
    },
  });
  assert.deepEqual(result, { done: 3, total: 3 });
});

test('an image that never settles is abandoned after its own timeout', async () => {
  const started = Date.now();
  const result = await preloadArtwork(['forever'], { concurrency: 1, perImageMs: 5, prefetch: () => new Promise(() => {}) });
  assert.deepEqual(result, { done: 1, total: 1 });
  assert.ok(Date.now() - started < 500, 'the permanently pending image was waited on far too long');
});

test('the budget stops the wave from starting further images, counting the rest as done', async () => {
  let clock = 0;
  const seen: string[] = [];
  const result = await preloadArtwork(['u0', 'u1', 'u2', 'u3', 'u4', 'u5'], {
    concurrency: 1,
    budgetMs: 25,
    perImageMs: 5,
    now: () => clock,
    prefetch: async url => { seen.push(url); clock += 10; },
  });
  // Each image advances the injected clock by 10ms, so the third one lands past the 25ms budget.
  assert.deepEqual(seen, ['u0', 'u1', 'u2']);
  assert.deepEqual(result, { done: 3, total: 6 });
});

test('home preloading fetches the artwork the catalogue rails describe', async () => {
  const catalog = {
    home: async () => [rail('spotlight', [title(42, '/p.jpg', '/b.jpg'), title(43, null, '/b2.jpg')])],
  } as unknown as Catalog;
  const urls: string[] = [];
  const result = await preloadHome(catalog, [], { prefetch: async url => { urls.push(url); } });
  assert.deepEqual(result, { done: 2, total: 2 });
  assert.deepEqual(urls, [backdropUrl('b.jpg'), posterUrl('p.jpg')]);
});

test('an unreachable catalogue ends the launch wave instead of failing it', async () => {
  const catalog = {
    home: async () => { throw new Error('the catalogue backend is unavailable'); },
  } as unknown as Catalog;
  let calls = 0;
  const result = await preloadHome(catalog, [title(9, '/p.jpg', '/b.jpg')], { prefetch: async () => { calls += 1; } });
  assert.deepEqual(result, { done: 0, total: 0 });
  assert.equal(calls, 0);
});

test('a hanging image cannot extend launch beyond the remaining overall budget', async () => {
  const result = await Promise.race([
    preloadArtwork(['never'], {budgetMs:10, perImageMs:500, prefetch:() => new Promise(() => {})}),
    new Promise<string>(resolve => setTimeout(() => resolve('launch still blocked'), 100)),
  ]);
  assert.deepEqual(result, {done:1,total:1});
});
