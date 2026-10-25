import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createHandler } from '../src/index.ts';
import type { FetchLike } from '../src/movy.ts';

interface Fixture {
  seed: string;
  mediaId: number;
  ciphertext: string;
  plaintext: string;
}

// The suite runs from the worker directory (`npm test`), where the fixture lives.
const FIXTURE_PATH = join(process.cwd(), 'test', 'fixtures', 'streamcrypto.json');
const fixture: Fixture = (JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as Fixture[])[0];

const SUBTITLE_ROWS = [
  { id: 'en'.padEnd(24, 'x'), url: 'https://subtitles.vidy.st/download?id=en-track', display: 'English', language: 'en', format: 'srt', downloadCount: 25107, isTrusted: true, isHearingImpaired: false, source: 'opensubtitles' },
  { id: 'es'.padEnd(24, 'y'), url: 'https://subtitles.vidy.st/download?id=es-track', display: 'Spanish', language: 'es', format: 'srt', downloadCount: 47224, isTrusted: false, isHearingImpaired: false, source: 'opensubtitles' },
  { id: 'de'.padEnd(24, 'z'), url: 'https://subtitles.vidy.st/download?id=de-track', display: 'German', language: 'de', format: 'ssa', downloadCount: 900, isTrusted: false, isHearingImpaired: false, source: 'opensubtitles' },
];

const SRT = '1\n00:00:01,000 --> 00:00:02,000\nHello.\n';

/** Upstream is never contacted: seed + encrypted payload come from the captured fixture. */
const upstream: FetchLike = async (input) => {
  const url = String(input);
  if (url.includes('/seed?')) {
    return new Response(JSON.stringify({ seed: fixture.seed, ttlMs: 30000 }), { status: 200 });
  }
  if (url.includes('/sources?')) {
    return new Response(fixture.ciphertext, { status: 200, headers: { 'content-type': 'application/json' } });
  }
  if (url.includes('subtitles.vidy.st/search')) {
    return new Response(JSON.stringify(SUBTITLE_ROWS), { status: 200 });
  }
  if (url.includes('subtitles.vidy.st/download')) {
    return new Response(SRT, { status: 200, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  }
  throw new Error(`unexpected upstream request: ${url}`);
};

// The provider's site host is pinned here: discovery is covered by site.test.ts, and these tests are
// about what the handler answers, not about where the site currently lives.
const SITE = 'https://www.movy.sx/';
const handler = createHandler({ UPSTREAM_SITE: SITE }, { fetchImpl: upstream });
const get = (path: string) => handler(new Request(`https://snas-movy.example.workers.dev${path}`));

test('the service root advertises its endpoints', async () => {
  const response = await get('/');
  assert.equal(response.status, 200);
  const body = (await response.json()) as { service: string; ok: boolean; endpoints: string[] };
  assert.equal(body.service, 'snas-movy');
  assert.equal(body.ok, true);
  assert.ok(body.endpoints.includes('/v1/watch'));
});

test('the provider list matches the site mirrors and marks a default order', async () => {
  const body = (await (await get('/v1/providers')).json()) as { providers: { slug: string }[]; default: string[] };
  assert.equal(body.providers.length, 18);
  assert.ok(body.providers.some((provider) => provider.slug === 'miami'));
  assert.equal(body.default[0], 'miami');
});

test('/v1/watch returns playable sources and a multi-language subtitle menu', async () => {
  const response = await get('/v1/watch?tmdbId=969681&type=movie&title=Spider-Man%3A%20Brand%20New%20Day&year=2026&imdb=tt22084616');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), '*');
  const body = (await response.json()) as {
    provider: string;
    sources: { quality: string; url: string }[];
    subtitleGroups: { languageName: string; subtitles: unknown[] }[];
    subtitleCount: number;
    cached: boolean;
  };
  assert.equal(body.provider, 'miami');
  assert.equal(body.cached, false);
  assert.deepEqual(body.sources.map((source) => source.quality), ['2160p', '1080p', '720p', '480p']);
  assert.ok(body.sources.every((source) => /^https?:\/\//.test(source.url)));
  assert.deepEqual(body.subtitleGroups.map((group) => group.languageName), ['English', 'German', 'Spanish']);
  assert.equal(body.subtitleCount, 3);
  // Without this header the CDN answers 403, so the player cannot be left to guess it.
  assert.deepEqual((body as unknown as { headers: Record<string, string> }).headers, {
    referer: 'https://www.movy.sx/',
  });
});

test('/v1/sources serves only sources, with the headers a player must send', async () => {
  const body = (await (await get('/v1/sources?tmdbId=969681&title=Dune&type=movie')).json()) as Record<string, unknown>;
  assert.ok(Array.isArray(body.sources));
  assert.equal(body.subtitleGroups, undefined);
  assert.deepEqual(body.headers, { referer: 'https://www.movy.sx/' });
});

test('/v1/subtitles groups tracks by language', async () => {
  const body = (await (await get('/v1/subtitles?tmdbId=969681&title=Dune')).json()) as {
    groups: { language: string }[];
    count: number;
  };
  assert.equal(body.count, 3);
  assert.equal(body.groups.length, 3);
});

test('the subtitle proxy converts SRT to WebVTT and refuses untranslatable formats', async () => {
  const okResponse = await get(`/v1/subtitle/${'en'.padEnd(24, 'x')}.vtt?tmdbId=969681&title=Dune`);
  assert.equal(okResponse.status, 200);
  assert.match(okResponse.headers.get('content-type') ?? '', /text\/vtt/);
  const text = await okResponse.text();
  assert.ok(text.startsWith('WEBVTT'));
  assert.ok(text.includes('00:00:01.000 --> 00:00:02.000'));

  const ssa = await get(`/v1/subtitle/${'de'.padEnd(24, 'z')}.vtt?tmdbId=969681&title=Dune`);
  assert.equal(ssa.status, 415);

  const missing = await get(`/v1/subtitle/${'q'.padEnd(24, 'q')}.vtt?tmdbId=969681&title=Dune`);
  assert.equal(missing.status, 404);

  const malformed = await get('/v1/subtitle/..%2Fetc%2Fpasswd.vtt?tmdbId=969681&title=Dune');
  assert.equal(malformed.status, 400);
});

test('bad requests are rejected with actionable errors', async () => {
  const noId = await get('/v1/watch?type=movie&title=Dune');
  assert.equal(noId.status, 400);
  assert.match(String(((await noId.json()) as { error: string }).error), /tmdbId/);

  const noTitle = await get('/v1/watch?tmdbId=969681&type=movie');
  assert.equal(noTitle.status, 400);
  assert.match(String(((await noTitle.json()) as { error: string }).error), /title is required/);

  const badType = await get('/v1/watch?tmdbId=969681&type=book&title=Dune');
  assert.equal(badType.status, 400);

  const halfEpisode = await get('/v1/watch?tmdbId=1399&type=tv&season=1&title=Game%20of%20Thrones');
  assert.equal(halfEpisode.status, 400);
  assert.match(String(((await halfEpisode.json()) as { error: string }).error), /season and episode/);
});

test('unknown paths, wrong methods and preflight behave', async () => {
  assert.equal((await get('/v1/nope')).status, 404);
  const post = await handler(new Request('https://x.example/v1/watch', { method: 'POST' }));
  assert.equal(post.status, 405);
  const options = await handler(new Request('https://x.example/v1/watch', { method: 'OPTIONS' }));
  assert.equal(options.status, 204);
  assert.equal(options.headers.get('access-control-allow-methods'), 'GET, OPTIONS');
});

test('a title resolves through the catalogue proxy, which is the only holder of the TMDB key', async () => {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const upstreamCalls: string[] = [];
  const proxied: FetchLike = async (input, init) => {
    const url = String(input);
    if (!url.startsWith('https://proxy.example/tmdb/')) {
      upstreamCalls.push(url);
      return upstream(input, init);
    }
    calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
    // The fixture's ciphertext is bound to media id 969681, so the resolved title has to
    // describe that same title for the decryption below to succeed.
    return new Response(
      JSON.stringify({ title: 'Spider-Man: Brand New Day', release_date: '2026-05-29', external_ids: { imdb_id: 'tt22084616' } }),
      { status: 200 },
    );
  };
  // A trailing slash on the configured URL must not produce a double slash.
  const resolving = createHandler(
    { TMDB_PROXY_URL: 'https://proxy.example/tmdb/', UPSTREAM_SITE: SITE },
    { fetchImpl: proxied },
  );
  const response = await resolving(new Request('https://snas-movy.example.workers.dev/v1/sources?tmdbId=969681&type=movie'));
  assert.equal(response.status, 200);

  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    'https://proxy.example/tmdb/movie/969681?append_to_response=external_ids&language=en-US',
  );
  // Exactly one header, and it carries no credential: the Worker holds no TMDB key.
  assert.deepEqual(calls[0].headers, { accept: 'application/json' });
  // The title the proxy resolved is what the upstream source query was built from.
  const sourceQuery = upstreamCalls.find((url) => url.includes('/miami/sources?'));
  assert.ok(sourceQuery, 'the upstream source query should have been made');
  assert.ok(sourceQuery.includes('title=Spider-Man%253A%2520Brand%2520New%2520Day'));
  assert.ok(sourceQuery.includes('imdbId=tt22084616'));
});

test('the release endpoint reports no update when the repo is unconfigured', async () => {
  const body = (await (await get('/v1/app/latest?currentVersion=0.1.0')).json()) as {
    updateAvailable: boolean;
    latest: unknown;
  };
  assert.equal(body.updateAvailable, false);
  assert.equal(body.latest, null);
});
