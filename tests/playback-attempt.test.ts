import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ATTEMPT_KEY,
  parseAttempt,
  armAttempt,
  settleAttempt,
  takeKilledQuality,
  type AttemptStorage,
} from '../src/state/playback-attempt.ts';

/** The smallest storage that behaves like the device's: a map that survives everything but a kill. */
function storage(initial: Record<string, string> = {}): AttemptStorage & {data: Map<string, string>} {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: async (key) => data.get(key) ?? null,
    setItem: async (key, value) => {
      data.set(key, value);
    },
    removeItem: async (key) => {
      data.delete(key);
    },
  };
}

test('an attempt is on disk before the surface mounts, and gone once playback is real', async () => {
  const disk = storage();
  await armAttempt(disk, {
    quality: '1080p',
    titleKey: 'movie:157336',
    url: 'moon.zenoak.top/…/index-s1080p-v1-a1.m3u8',
    at: 1000,
  });
  const armed = parseAttempt(disk.data.get(ATTEMPT_KEY) ?? null);
  assert.equal(armed?.quality, '1080p');
  assert.equal(armed?.titleKey, 'movie:157336');
  await settleAttempt(disk);
  assert.equal(disk.data.size, 0);
});

test('a record that outlived its process names the rung that killed it', async () => {
  const record = {quality: '1080p', titleKey: 'movie:157336', url: 'host/…/a.m3u8', at: 1000};
  const disk = storage({[ATTEMPT_KEY]: JSON.stringify(record)});
  assert.equal(await takeKilledQuality(disk, 60_000), '1080p');
  // Taken, not merely read: the next launch must not blame the same rung for the same death twice.
  assert.equal(disk.data.size, 0);
});

test('a record written moments before the app was stopped is not evidence about the stream', async () => {
  const record = {quality: '2160p', titleKey: 'movie:1', url: 'host/…/b.m3u8', at: 60_000};
  const disk = storage({[ATTEMPT_KEY]: JSON.stringify(record)});
  assert.equal(await takeKilledQuality(disk, 60_500), null);
  assert.equal(disk.data.size, 0);
});

test('an unreadable or empty record leaves the ladder alone', async () => {
  assert.equal(await takeKilledQuality(storage(), 10_000), null);
  assert.equal(await takeKilledQuality(storage({[ATTEMPT_KEY]: 'not json'}), 10_000), null);
  assert.equal(await takeKilledQuality(storage({[ATTEMPT_KEY]: '{"quality":""}'}), 10_000), null);
  assert.equal(parseAttempt(null), null);
});

test('storage that fails costs the app its memory of a crash, never the playback', async () => {
  const broken: AttemptStorage = {
    getItem: async () => {
      throw new Error('no storage');
    },
    setItem: async () => {
      throw new Error('no storage');
    },
    removeItem: async () => {
      throw new Error('no storage');
    },
  };
  await armAttempt(broken, {quality: '720p', titleKey: 'movie:1', url: 'host/a', at: 1});
  await settleAttempt(broken);
  assert.equal(await takeKilledQuality(broken, 10_000), null);
});
