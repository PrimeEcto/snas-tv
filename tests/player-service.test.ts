import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SourceUnavailableError,
  loadWatch,
  sourceUnavailable,
  type WatchResult,
} from '../src/player.ts';

const TITLE = {id: 157336, kind: 'movie' as const, title: 'Interstellar', year: 2014};

/** A fetcher that answers with one canned response, so no request leaves the process. */
const answering = (status: number, body: unknown) =>
  async () => ({ok: status >= 200 && status < 300, status, json: async () => body});

test('a 5xx from the source service is reported as the service being down', async () => {
  // What the live backend answered for every title on 2026-10-25 while the provider's API refused
  // the seed request: 502 with an error object, and no sources for any title.
  await assert.rejects(
    () =>
      loadWatch(TITLE, undefined, {
        fetcher: answering(502, {
          error: 'no stream provider is available right now',
          detail: 'no provider returned sources',
        }),
      }),
    (error: unknown) =>
      error instanceof SourceUnavailableError &&
      error.status === 502 &&
      /source service is unavailable/.test(error.message),
  );
});

test('a 503 is the service being down too', async () => {
  await assert.rejects(
    () => loadWatch(TITLE, undefined, {fetcher: answering(503, {error: 'busy'})}),
    (error: unknown) => error instanceof SourceUnavailableError && error.status === 503,
  );
});

test('a title with no source is still just an unplayable title', async () => {
  // A 4xx, an empty list and a broken body all mean "this title", never "the service is down":
  // telling a viewer to come back later for a title that will never play is its own failure.
  assert.equal(await loadWatch(TITLE, undefined, {fetcher: answering(404, {error: 'not found'})}), null);
  assert.equal(await loadWatch(TITLE, undefined, {fetcher: answering(200, {sources: []})}), null);
  assert.equal(await loadWatch(TITLE, undefined, {fetcher: answering(200, null)}), null);
});

test('a network failure stays a plain no-result rather than a service outage', async () => {
  const offline = async () => {
    throw new Error('Network request failed');
  };
  assert.equal(await loadWatch(TITLE, undefined, {fetcher: offline}), null);
});

test('a real answer is returned with its sources, headers and playlist', async () => {
  const result = (await loadWatch(TITLE, undefined, {
    fetcher: answering(200, {
      provider: 'miami',
      note: 'Original audio',
      sources: [{quality: '1080p', url: 'https://cdn.example/a.m3u8'}],
      headers: {referer: 'https://www.movy.sx/'},
      playlist: 'https://cdn.example/master.m3u8',
      subtitleGroups: [],
    }),
  })) as WatchResult;
  assert.equal(result.sources.length, 1);
  assert.equal(result.headers.referer, 'https://www.movy.sx/');
  assert.equal(result.playlist, 'https://cdn.example/master.m3u8');
});

test('the boundary between a down service and an unplayable title is 5xx', () => {
  assert.equal(sourceUnavailable(500), true);
  assert.equal(sourceUnavailable(502), true);
  assert.equal(sourceUnavailable(503), true);
  assert.equal(sourceUnavailable(429), false);
  assert.equal(sourceUnavailable(404), false);
  assert.equal(sourceUnavailable(200), false);
  assert.equal(sourceUnavailable(Number.NaN), false);
});
