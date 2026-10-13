import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  StreamSourceError,
  directTransport,
  fetchSourcesWithFailover,
  getSeed,
  relayTransport,
  resolveTransport,
  type FetchLike,
} from '../src/movy.ts';

interface Fixture {
  seed: string;
  mediaId: number;
  ciphertext: string;
}

const FIXTURE_PATH = join(process.cwd(), 'test', 'fixtures', 'streamcrypto.json');
const fixture: Fixture = (JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as Fixture[])[0];

const TITLE = { title: 'Spider-Man: Brand New Day', year: 2026, tmdbId: 969681, imdbId: 'tt22084616', mediaType: 'movie' as const };

test('the direct transport returns status and raw body', async () => {
  const transport = directTransport(async () => new Response('{"a":1}', { status: 200 }));
  assert.deepEqual(await transport.get('https://api.wecollege.net/seed?mediaId=1', 5000), {
    status: 200,
    body: '{"a":1}',
  });
});

test('the direct transport passes the upstream status through unchanged', async () => {
  const transport = directTransport(async () => new Response('rate limited', { status: 429 }));
  assert.deepEqual(await transport.get('https://api.wecollege.net/seed?mediaId=1', 5000), {
    status: 429,
    body: 'rate limited',
  });
});

test('the relay transport posts the target URL with the shared secret', async () => {
  const seen: { url: string; init?: RequestInit }[] = [];
  const transport = relayTransport('https://relay.example/movy-relay', 'shared-secret', async (url, init) => {
    seen.push({ url, ...(init ? { init } : {}) });
    return new Response(JSON.stringify({ status: 200, body: '{"seed":"x"}' }), { status: 200 });
  });

  const result = await transport.get('https://api.wecollege.net/seed?mediaId=969681', 8000);
  assert.deepEqual(result, { status: 200, body: '{"seed":"x"}' });
  assert.equal(seen[0].url, 'https://relay.example/movy-relay');
  assert.equal(seen[0].init?.method, 'POST');
  const headers = seen[0].init?.headers as Record<string, string>;
  assert.equal(headers['x-relay-secret'], 'shared-secret');
  assert.deepEqual(JSON.parse(String(seen[0].init?.body)), { url: 'https://api.wecollege.net/seed?mediaId=969681' });
});

test('a transport never throws: relay problems become status 0', async () => {
  // These all previously surfaced as unhandled errors and a 500 for the device.
  const unreachable = relayTransport('https://relay.example/movy-relay', undefined, async () => {
    throw new Error('relay unreachable');
  });
  assert.deepEqual(await unreachable.get('https://api.wecollege.net/seed?mediaId=1', 1000), { status: 0, body: '' });

  const unhealthy = relayTransport('https://relay.example/movy-relay', undefined, async () =>
    new Response('boom', { status: 500 }));
  assert.deepEqual(await unhealthy.get('https://api.wecollege.net/seed?mediaId=1', 1000), { status: 500, body: '' });

  const malformed = relayTransport('https://relay.example/movy-relay', undefined, async () =>
    new Response('not json', { status: 200 }));
  assert.deepEqual(await malformed.get('https://api.wecollege.net/seed?mediaId=1', 1000), { status: 0, body: '' });
});

test('the relay is used only when configured', () => {
  const fetchImpl: FetchLike = async () => new Response('{}');
  const direct = resolveTransport({}, fetchImpl);
  const relayed = resolveTransport({ UPSTREAM_RELAY_URL: 'https://relay.example/movy-relay' }, fetchImpl);
  assert.notEqual(direct, relayed);
  assert.equal(typeof relayed.get, 'function');
});

test('a 429 seed is reported as a rate limit, not a generic failure', async () => {
  const transport = directTransport(async () => new Response('', { status: 429 }));
  await assert.rejects(
    () => getSeed(4242, { transport }),
    (error: unknown) => error instanceof StreamSourceError && error.status === 429 && /seed request failed/.test(error.message),
  );
});

test('the relay transport asks for the seed and its target in one invocation', async () => {
  const bodies: { url: string; seedUrl?: string }[] = [];
  const transport = relayTransport('https://relay.example/movy-relay', 'secret', async (_url, init) => {
    const parsed = JSON.parse(String(init?.body)) as { url: string; seedUrl?: string };
    bodies.push(parsed);
    return new Response(JSON.stringify({ status: 200, body: 'ciphertext', seed: 'a-seed' }));
  });

  const result = await transport.seeded({
    seedUrl: 'https://api.wecollege.net/seed?mediaId=969681',
    urlTemplate: 'https://api.wecollege.net/miami/sources?seed={{seed}}',
    timeoutMs: 8000,
  });
  // The seed is never fetched by the Worker itself when a relay is in play: the upstream
  // ties it to the requesting client, so both requests have to share the relay's egress.
  assert.deepEqual(result, { status: 200, body: 'ciphertext', seed: 'a-seed' });
  assert.equal(bodies.length, 1);
  assert.equal(bodies[0].seedUrl, 'https://api.wecollege.net/seed?mediaId=969681');
  assert.equal(bodies[0].url, 'https://api.wecollege.net/miami/sources?seed={{seed}}');
});

test('failover through a relay transport decrypts a real payload end to end', async () => {
  // The relay answers with the captured upstream status/body pair plus the seed it used;
  // nothing touches the network.
  const relay: FetchLike = async (_url, init) => {
    const request = JSON.parse(String(init?.body)) as { url: string; seedUrl?: string };
    if (!request.seedUrl) throw new Error('the relay must be given the seed request too');
    // The Worker hands over the template; substituting the seed is the relay's job,
    // because only the relay's egress may redeem the seed it just fetched.
    assert.ok(request.url.includes('seed={{seed}}'), 'the relay receives the seed placeholder');
    return new Response(JSON.stringify({ status: 200, body: fixture.ciphertext, seed: fixture.seed }));
  };

  const result = await fetchSourcesWithFailover(TITLE, {
    providers: ['miami'],
    transport: relayTransport('https://relay.example/movy-relay', 'secret', relay),
  });
  assert.equal(result.provider.slug, 'miami');
  assert.ok(result.payload.sources.length > 0);
  assert.match(result.payload.sources[0].url, /^https?:\/\//);
});

test('a stale seed is refreshed once and the retry decrypts with the new seed', async () => {
  let seeds = 0;
  let attempts = 0;
  const transport = directTransport(async (input) => {
    const url = String(input);
    if (url.includes('/seed')) {
      seeds += 1;
      return new Response(JSON.stringify({ seed: `seed-${seeds}`, ttlMs: 30000 }), { status: 200 });
    }
    attempts += 1;
    // First sources call rejects the seed; the second one is accepted.
    return attempts === 1
      ? new Response(JSON.stringify({ error: 'STREAMCRYPTO_SEED_INVALID' }), { status: 401 })
      : new Response(fixture.ciphertext, { status: 200 });
  });

  // A distinct media id keeps this test's seeds out of the shared per-isolate cache.
  const sealed = await transport.seeded({
    seedUrl: 'https://api.wecollege.net/seed?mediaId=4242',
    urlTemplate: 'https://api.wecollege.net/miami/sources?seed={{seed}}',
    timeoutMs: 8000,
  });
  assert.equal(seeds, 2);
  assert.equal(attempts, 2);
  assert.equal(sealed.seed, 'seed-2');
  assert.equal(sealed.status, 200);
});

test('when every mirror is rate limited the error carries 429', async () => {
  const transport = directTransport(async () => new Response('', { status: 429 }));
  await assert.rejects(
    () => fetchSourcesWithFailover(TITLE, { providers: ['miami', 'boise'], transport }),
    (error: unknown) => {
      if (!(error instanceof StreamSourceError)) return false;
      assert.equal(error.status, 429);
      assert.equal(error.attempts.length, 2);
      assert.deepEqual(error.attempts.map((attempt) => attempt.status), [429, 429]);
      return true;
    },
  );
});

test('a failing mirror falls through to the next provider and records why', async () => {
  let sourcesCalls = 0;
  // The seed is cached per seed URL, so one request serves both mirrors.
  const transport = directTransport(async (input) => {
    const url = String(input);
    if (url.includes('/seed')) {
      return new Response(JSON.stringify({ seed: fixture.seed, ttlMs: 30000 }), { status: 200 });
    }
    sourcesCalls += 1;
    // miami is down; boise answers with the captured payload.
    if (url.includes('/miami/')) return new Response('nope', { status: 500 });
    return new Response(fixture.ciphertext, { status: 200 });
  });

  const result = await fetchSourcesWithFailover(TITLE, { providers: ['miami', 'boise'], transport });
  assert.equal(result.provider.slug, 'boise');
  assert.equal(sourcesCalls, 2);
  assert.deepEqual(result.attempts, [
    { provider: 'miami', status: 500, reason: 'miami returned HTTP 500' },
  ]);
  assert.ok(result.payload.sources.length > 0);
});
