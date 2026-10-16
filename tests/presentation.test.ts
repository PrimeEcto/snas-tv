import test from 'node:test';
import assert from 'node:assert/strict';
import {playbackPhase} from '../src/state/playback-phase.ts';

test('an Android stream failure never turns into simulated playback', () => {
  assert.equal(
    playbackPhase({supported: true, live: false, failed: true, preview: false}),
    'unavailable',
  );
});
test('a timed-out stream stays unavailable until explicitly retried or previewed', () => {
  assert.equal(
    playbackPhase({supported: true, live: false, failed: true, preview: false}),
    'unavailable',
  );
  assert.equal(
    playbackPhase({supported: true, live: false, failed: true, preview: true}),
    'preview',
  );
  assert.equal(
    playbackPhase({
      supported: true,
      live: false,
      failed: false,
      preview: false,
    }),
    'loading',
  );
});
test('a native media clock and the Vega preview remain distinct', () => {
  assert.equal(
    playbackPhase({supported: true, live: true, failed: false, preview: false}),
    'streaming',
  );
  assert.equal(
    playbackPhase({
      supported: false,
      live: false,
      failed: false,
      preview: false,
    }),
    'preview',
  );
});
