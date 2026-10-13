import test from 'node:test';
import assert from 'node:assert/strict';

import { cacheKey, createCache } from '../src/cache.ts';
import type { FetchLike } from '../src/movy.ts';

const ok = (rows: unknown): FetchLike => async () =>
  new Response(JSON.stringify(rows), { status: 200, headers: { 'content-type': 'application/json' } });

test('cacheKey drops empty parts and stays query-string safe', () => {
  assert.equal(cacheKey(['sources', 969681, 'movie', undefined, null, 'miami']), 'sources:969681:movie:miami');
  assert.equal(cacheKey(['sources', 'Miami BAY']), 'sources:miami-bay');
  assert.equal(cacheKey([]), '');
});

test('with no Supabase credentials the cache is a silent no-op', async () => {
  let called = false;
  const cache = createCache({}, { fetchImpl: async () => { called = true; return new Response('[]'); } });
  assert.equal(await cache.get('anything'), null);
  await cache.set('anything', { big: 'value' }, 60);
  assert.equal(called, false, 'a no-op cache must not touch the network');
});

test('a stored row is returned while it is unexpired', async () => {
  const now = 1_700_000_000_000;
  const cache = createCache(
    { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service-role' },
    {
      fetchImpl: ok([{ value: { provider: 'miami' }, stored_at: new Date(now - 1000).toISOString(), expires_at: new Date(now + 60_000).toISOString() }]),
      now: () => now,
    },
  );
  const hit = await cache.get<{ provider: string }>('sources:969681');
  assert.equal(hit?.value.provider, 'miami');
  assert.equal(hit?.expiresAt, now + 60_000);
});

test('expired rows, empty results and failures are all treated as misses', async () => {
  const now = 1_700_000_000_000;
  const env = { SUPABASE_URL: 'https://example.supabase.co/', SUPABASE_SERVICE_ROLE_KEY: 'service-role' };

  const expired = createCache(env, {
    fetchImpl: ok([{ value: {}, stored_at: new Date(now - 10_000).toISOString(), expires_at: new Date(now - 1).toISOString() }]),
    now: () => now,
  });
  assert.equal(await expired.get('key'), null);

  const empty = createCache(env, { fetchImpl: ok([]), now: () => now });
  assert.equal(await empty.get('key'), null);

  const malformed = createCache(env, {
    fetchImpl: async () => new Response('not json', { status: 200 }),
    now: () => now,
  });
  assert.equal(await malformed.get('key'), null);

  const unhappy = createCache(env, {
    fetchImpl: async () => { throw new Error('network down'); },
    now: () => now,
  });
  assert.equal(await unhappy.get('key'), null);

  const notFound = createCache(env, { fetchImpl: async () => new Response('{}', { status: 404 }), now: () => now });
  assert.equal(await notFound.get('key'), null);
});

test('writes are an upsert and never reject', async () => {
  const requests: { url: string; init?: RequestInit }[] = [];
  const env = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service-role' };
  const cache = createCache(env, {
    fetchImpl: async (url, init) => {
      requests.push({ url, ...(init ? { init } : {}) });
      return new Response(null, { status: 201 });
    },
    now: () => 1_700_000_000_000,
    namespace: 'movy',
  });

  await cache.set('subfile:abc', { text: 'WEBVTT' }, 3600);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].init?.method, 'POST');
  assert.match(requests[0].url, /\/rest\/v1\/movy_stream_cache$/);
  const headers = requests[0].init?.headers as Record<string, string>;
  assert.match(headers.prefer, /merge-duplicates/);
  const body = JSON.parse(String(requests[0].init?.body)) as { key: string; expires_at: string };
  assert.equal(body.key, 'movy:subfile:abc');
  assert.equal(body.expires_at, new Date(1_700_000_000_000 + 3_600_000).toISOString());

  const failing = createCache(env, { fetchImpl: async () => { throw new Error('nope'); } });
  await failing.set('key', { a: 1 }, 5);
});
