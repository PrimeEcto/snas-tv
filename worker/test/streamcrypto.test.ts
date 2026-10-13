import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { base64UrlToBytes, decryptStreamPayload, initState, keystream } from '../src/streamcrypto.ts';

interface Fixture {
  name: string;
  provider: string;
  seed: string;
  mediaId: number;
  ciphertext: string;
  plaintext: string;
}

// The suite runs from the worker directory (`npm test`), where the fixture lives.
const FIXTURE_PATH = join(process.cwd(), 'test', 'fixtures', 'streamcrypto.json');
const fixtures: Fixture[] = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as Fixture[];

test('fixtures are real captured payloads', () => {
  assert.ok(fixtures.length > 0, 'run `npm run verify:live -- --keep` to capture fixtures');
  for (const fixture of fixtures) {
    assert.equal(fixture.mediaId, 969681);
    assert.ok(fixture.seed.length > 8);
    assert.ok(fixture.ciphertext.length > 0);
    assert.ok(fixture.plaintext.startsWith('{'));
  }
});

test('decrypts every captured payload byte-for-byte', () => {
  for (const fixture of fixtures) {
    const decrypted = decryptStreamPayload(fixture.ciphertext, fixture.seed, fixture.mediaId);
    assert.equal(decrypted, fixture.plaintext, `${fixture.name} did not match`);
  }
});

test('decrypted payload is the documented source shape', () => {
  const parsed = JSON.parse(decryptStreamPayload(fixtures[0].ciphertext, fixtures[0].seed, fixtures[0].mediaId)) as {
    sources?: { quality: string; url: string }[];
    subtitles?: unknown[];
  };
  assert.ok(Array.isArray(parsed.sources));
  assert.ok(parsed.sources!.length > 0);
  for (const source of parsed.sources!) {
    assert.equal(typeof source.quality, 'string');
    assert.match(source.url, /^https?:\/\//);
  }
  assert.ok(Array.isArray(parsed.subtitles));
});

test('a wrong seed is rejected instead of returning garbage', () => {
  const fixture = fixtures[0];
  assert.throws(
    () => decryptStreamPayload(fixture.ciphertext, `${fixture.seed}tampered`, fixture.mediaId),
    /decrypt failed: bad seed or tampered payload/,
  );
  assert.throws(
    () => decryptStreamPayload(fixture.ciphertext, fixture.seed, fixture.mediaId + 1),
    /decrypt failed: bad seed or tampered payload/,
  );
});

test('a missing media id is refused', () => {
  const fixture = fixtures[0];
  assert.throws(() => decryptStreamPayload(fixture.ciphertext, fixture.seed, undefined as unknown as number), /mediaId is required/);
});

test('quoted JSON bodies and unpadded base64url are accepted', () => {
  const fixture = fixtures[0];
  assert.equal(decryptStreamPayload(`"${fixture.ciphertext}"`, fixture.seed, fixture.mediaId), fixture.plaintext);
  const stripped = fixture.ciphertext.replace(/=+$/, '');
  assert.equal(decryptStreamPayload(stripped, fixture.seed, fixture.mediaId), fixture.plaintext);
});

test('the keystream is deterministic and length-exact', () => {
  const first = keystream(initState('seed-value', 42), 37);
  const second = keystream(initState('seed-value', 42), 37);
  assert.equal(first.length, 37);
  assert.deepEqual([...first], [...second]);
  const other = keystream(initState('seed-value', 43), 37);
  assert.notDeepEqual([...first], [...other]);
});

test('base64url decoding matches the site decoding', () => {
  assert.deepEqual([...base64UrlToBytes('bXZtMQ')], [0x6d, 0x76, 0x6d, 0x31]);
  assert.deepEqual([...base64UrlToBytes('bXZtMQ==')], [0x6d, 0x76, 0x6d, 0x31]);
  assert.deepEqual([...base64UrlToBytes('_-8')], [0xff, 0xef]);
});
