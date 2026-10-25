import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONSTRAINED_POLICY,
  FULL_POLICY,
  affordable,
  bufferFor,
  codecLevel,
  describeLadder,
  matchRendition,
  orderByQuality,
  parseMasterPlaylist,
  pickQuality,
  renditionLevel,
  sourceFrame,
  urlName,
  type VideoPolicy,
} from '../src/ladder.ts';
import {loadRenditions, type WatchSource} from '../src/player.ts';

/**
 * The real master playlist the backend serves for `Interstellar` (TMDB 157336), read from
 * `moon.zenoak.top` on 2026-10-16: a cinemascope H.264 ladder whose `1080p` label is 2584×1080 High
 * Level 5.0 and whose `2160p` label is 3832×1600 High Level 5.1.
 */
const CINEMASCOPE_MASTER = `#EXTM3U
#EXT-X-STREAM-INF:PROGRAM-ID=1,BANDWIDTH=6168323,RESOLUTION=2584x1080,FRAME-RATE=23.974,CODECS="avc1.640032,mp4a.40.2",VIDEO-RANGE=SDR
sd/98/index-s1080p-v1-a1.m3u8
#EXT-X-STREAM-INF:PROGRAM-ID=1,BANDWIDTH=16152957,RESOLUTION=3832x1600,FRAME-RATE=23.974,CODECS="avc1.640033,mp4a.40.2",VIDEO-RANGE=SDR
sd/98/index-s2160p-v1-a1.m3u8
#EXT-X-STREAM-INF:PROGRAM-ID=1,BANDWIDTH=1330890,RESOLUTION=852x480,FRAME-RATE=23.974,CODECS="avc1.4d401e,mp4a.40.2",VIDEO-RANGE=SDR
sd/98/index-s480p-v1-a1.m3u8
#EXT-X-STREAM-INF:PROGRAM-ID=1,BANDWIDTH=3136330,RESOLUTION=1724x720,FRAME-RATE=23.974,CODECS="avc1.4d4020,mp4a.40.2",VIDEO-RANGE=SDR
sd/98/index-s720p-v1-a1.m3u8`;

/** The other shape the same backend serves: a 16:9 ladder (Dune, Inception, Moana 2, GoT). */
const SIXTEEN_NINE_MASTER = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=16100000,RESOLUTION=3840x2160,FRAME-RATE=23.974,CODECS="avc1.640033,mp4a.40.2"
index-s2160p-v1-a1.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=6100000,RESOLUTION=1920x1080,FRAME-RATE=23.974,CODECS="avc1.640028,mp4a.40.2"
index-s1080p-v1-a1.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=3100000,RESOLUTION=1280x720,FRAME-RATE=23.974,CODECS="avc1.4d401f,mp4a.40.2"
index-s720p-v1-a1.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=1300000,RESOLUTION=852x480,FRAME-RATE=23.974,CODECS="avc1.4d401e,mp4a.40.2"
index-s480p-v1-a1.m3u8`;

const BASE = 'https://moon.zenoak.top/vd/TOKEN/master.m3u8';

/** The four sources `/v1/watch` returns, whose file names are what the master playlist names. */
const sources: WatchSource[] = ['2160p', '1080p', '720p', '480p'].map((quality) => ({
  quality,
  url: `https://moon.zenoak.top/vd/TOKEN/index-s${quality}-v1-a1.m3u8`,
}));

test('the H.264 level in a codec string is the decimal the string carries', () => {
  assert.equal(codecLevel('avc1.640032'), 50); // High, Level 5.0 — the rung labelled 1080p
  assert.equal(codecLevel('avc1.640033'), 51); // High, Level 5.1 — the rung labelled 2160p
  assert.equal(codecLevel('avc1.4d401f'), 31); // Main, Level 3.1 — the rung labelled 720p
  assert.equal(codecLevel('hev1.1.6.L93.B0'), undefined);
});

test('a master playlist is read into renditions with their real frames and codecs', () => {
  const renditions = parseMasterPlaylist(CINEMASCOPE_MASTER, BASE);
  assert.equal(renditions.length, 4);
  const top = renditions.find((r) => r.name === 'index-s2160p-v1-a1.m3u8')!;
  assert.equal(top.width, 3832);
  assert.equal(top.height, 1600);
  assert.equal(renditionLevel(top), 51);
  assert.equal(top.bandwidth, 16152957);
  // Resolved against the playlist, which names a path the source URLs do not share.
  assert.equal(top.uri, 'https://moon.zenoak.top/vd/TOKEN/sd/98/index-s2160p-v1-a1.m3u8');
  assert.equal(urlName(sources[1].url), 'index-s1080p-v1-a1.m3u8');
});

test('a rendition is matched to its source by file name, not by path', () => {
  const renditions = parseMasterPlaylist(CINEMASCOPE_MASTER, BASE);
  const matched = matchRendition(sources[2], renditions);
  assert.equal(matched?.width, 1724);
  assert.equal(sourceFrame(sources[2], matched).measured, true);
  // Unmatched, a label is all the app has, and a label is a height.
  assert.deepEqual(sourceFrame(sources[1], undefined), {
    width: 1920,
    height: 1080,
    measured: false,
  });
});

test('a constrained device is never handed the cinemascope Level 5.0 rung', () => {
  const renditions = parseMasterPlaylist(CINEMASCOPE_MASTER, BASE);
  const decision = pickQuality(sources, renditions, CONSTRAINED_POLICY);
  // 1080p is 2584×1080 High Level 5.0 and 2160p is 3832×1600 High Level 5.1: both are beyond a
  // 1080p-class H.264 decoder, and the 720p rung is Main Level 3.2.
  assert.equal(decision.quality, '720p');
  assert.equal(decision.allowed, true);
  assert.equal(affordable(sources[1], matchRendition(sources[1], renditions), CONSTRAINED_POLICY), false);
  assert.equal(affordable(sources[0], matchRendition(sources[0], renditions), CONSTRAINED_POLICY), false);
});

test('a real 1080p Level 4.0 rung is kept on a constrained device', () => {
  const renditions = parseMasterPlaylist(SIXTEEN_NINE_MASTER, BASE);
  const decision = pickQuality(sources, renditions, CONSTRAINED_POLICY);
  // The whole point of measuring: this ladder's 1080p is a 1080p-class frame, and refusing it would
  // trade picture quality for nothing.
  assert.equal(decision.quality, '1080p');
  assert.equal(decision.allowed, true);
});

test('a device with room takes the 4K rung, and a decoder that cannot takes 1080p', () => {
  const renditions = parseMasterPlaylist(SIXTEEN_NINE_MASTER, BASE);
  assert.equal(pickQuality(sources, renditions, FULL_POLICY).quality, '2160p');
  const capped: VideoPolicy = {...FULL_POLICY, maxWidth: 1920, maxHeight: 1088};
  assert.equal(pickQuality(sources, renditions, capped).quality, '1080p');
});

test('a rung this device was killed by is stepped over, and the ladder still has a bottom', () => {
  const renditions = parseMasterPlaylist(CINEMASCOPE_MASTER, BASE);
  const withKilled = pickQuality(sources, renditions, CONSTRAINED_POLICY, {skip: ['720p']});
  assert.equal(withKilled.quality, '480p');
  const exhausted = pickQuality(sources, renditions, CONSTRAINED_POLICY, {
    skip: ['2160p', '1080p', '720p', '480p'],
  });
  // Skipping is a preference: with every rung skipped the ladder is tried again from its most
  // capable usable rung rather than the viewer being left with nothing.
  assert.equal(exhausted.quality, '720p');
  assert.equal(exhausted.allowed, true);
});

test('with no master playlist the labels are the only evidence and stay conservative', () => {
  // The provider's labels claim a 1080p rung, and without the playlist the app cannot see that it
  // is 2584 pixels wide — so on a constrained device only a 720p label is opened unmeasured.
  assert.equal(pickQuality(sources, [], CONSTRAINED_POLICY).quality, '720p');
  const twoRung: WatchSource[] = [sources[0], sources[1]];
  const decision = pickQuality(twoRung, [], CONSTRAINED_POLICY);
  assert.equal(decision.quality, '1080p');
  assert.equal(decision.allowed, false);
  assert.equal(pickQuality(sources, [], FULL_POLICY).quality, '2160p');
});

test('the ladder is ordered highest first and every rung is described for the log', () => {
  const renditions = parseMasterPlaylist(CINEMASCOPE_MASTER, BASE);
  assert.deepEqual(
    orderByQuality([sources[3], sources[0], sources[2], sources[1]]).map((s) => s.quality),
    ['2160p', '1080p', '720p', '480p'],
  );
  const line = describeLadder(sources, renditions, CONSTRAINED_POLICY);
  assert.match(line, /1080p\[2584x1080 L5\.0 no\]/);
  assert.match(line, /720p\[1724x720 L3\.2 ok\]/);
});

test('a constrained device buffers less, and the reserve keeps the heap for the rest of the app', () => {
  const config = bufferFor(CONSTRAINED_POLICY);
  assert.equal(config.maxBufferMs, 25000);
  assert.equal(config.minBufferMs, 10000);
  assert.equal(config.minBufferMemoryReservePercent, 0.2);
  assert.equal(config.maxHeapAllocationPercent, 0.25);
  // A capable device keeps Media3's own defaults rather than being made worse.
  assert.deepEqual(bufferFor(FULL_POLICY), {});
});

test('an unreadable master playlist costs the app a measurement, never the playback', async () => {
  const failing = async () => {
    throw new Error('offline');
  };
  assert.deepEqual(await loadRenditions(BASE, {}, {fetcher: failing as never}), []);
  const refuser = async () => ({ok: false, status: 403, text: async () => 'denied'});
  assert.deepEqual(await loadRenditions(BASE, {}, {fetcher: refuser as never}), []);
  assert.deepEqual(await loadRenditions('', {}, {}), []);

  const server = async () => ({ok: true, status: 200, text: async () => CINEMASCOPE_MASTER});
  const renditions = await loadRenditions(BASE, {referer: 'https://www.movy.sx/'}, {fetcher: server as never});
  assert.equal(renditions.length, 4);
  assert.equal(renditions[0].width, 2584);
});
