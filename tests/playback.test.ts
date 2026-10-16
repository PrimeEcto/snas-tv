import test from 'node:test';
import assert from 'node:assert/strict';
import { ASPECT_LABELS, ASPECT_MODES, createPlayback, playbackReducer, progressKey, formatTime, resizeModeFor, validAspect, type PlaybackAction } from '../src/state/playback.ts';
import { emptyLibrary, parseLibrary, toggleSaved, saveProgress, continueWatching } from '../src/state/library.ts';
import type { Title, Episode } from '../src/catalog/types.ts';

const movie: Title = { id: 7, kind: 'movie', title: 'Orbit', year: '2026', overview: '', poster: '', backdrop: '', genres: ['Drama'], rating: 8, runtime: 100 };
const show: Title = { ...movie, kind: 'tv', title: 'Skyline', runtime: 45 };
const episode: Episode = { id: 100, season: 1, number: 2, title: 'Arrival', overview: '', runtime: 50, still: '' };

test('paused playback freezes time and resumed ticks honor playback speed', () => {
  let state = createPlayback(movie, undefined, 120);
  state = playbackReducer(state, { type: 'pause' });
  assert.equal(playbackReducer(state, { type: 'tick', seconds: 10 }).position, 120);
  state = playbackReducer(state, { type: 'play' });
  state = playbackReducer(state, { type: 'speed', value: 1.5 });
  assert.equal(playbackReducer(state, { type: 'tick', seconds: 10 }).position, 135);
});

test('seeks clamp at both ends and completion stops playback', () => {
  const state = createPlayback(movie);
  assert.equal(playbackReducer(state, { type: 'seek', delta: -15 }).position, 0);
  const nearEnd = playbackReducer(state, { type: 'seekTo', position: 5998 });
  const end = playbackReducer(nearEnd, { type: 'tick', seconds: 3 });
  assert.equal(end.position, 6000);
  assert.equal(end.completed, true);
  assert.equal(end.playing, false);
  assert.equal(playbackReducer(end, { type: 'seekTo', position: 100 }).completed, false);
  assert.equal(playbackReducer(state, { type: 'seekTo', position: 9000 }).position, 6000);
});

test('nonfinite timing and unsupported speeds cannot poison playback', () => {
  let state = createPlayback({ ...movie, runtime: NaN }, undefined, Infinity);
  assert.ok(Number.isFinite(state.duration) && state.duration > 0);
  assert.equal(state.position, 0);
  for (const bad of [NaN, Infinity, -Infinity]) {
    assert.equal(playbackReducer(state, { type: 'tick', seconds: bad }).position, 0);
    assert.equal(playbackReducer(state, { type: 'seekTo', position: bad }).position, 0);
    assert.equal(playbackReducer(state, { type: 'seek', delta: bad }).position, 0);
  }
  assert.equal(playbackReducer(state, { type: 'tick', seconds: -3 }).position, 0);
  for (const bad of [0, -1, NaN, Infinity, 100]) {
    assert.equal(playbackReducer(state, { type: 'speed', value: bad }).speed, 1);
  }
  assert.equal(createPlayback(movie, undefined, -5).position, 0);
});

test('episodes use their runtime and movie, show, and episode keys never collide', () => {
  assert.equal(createPlayback(show, episode).duration, 3000);
  const keys = [progressKey(movie), progressKey(show), progressKey(show, episode), progressKey(show, { ...episode, number: 3 }), progressKey(show, { ...episode, season: 2 })];
  assert.equal(new Set(keys).size, 5);
});

test('settings and controls can change independently of play position', () => {
  let state = createPlayback(movie);
  state = playbackReducer(state, { type: 'controls', visible: false });
  state = playbackReducer(state, { type: 'audio', value: 'Spanish' });
  state = playbackReducer(state, { type: 'subtitles', value: 'English' });
  state = playbackReducer(state, { type: 'toggle' });
  assert.equal(state.controls, false);
  assert.equal(state.audio, 'Spanish');
  assert.equal(state.subtitles, 'English');
  assert.equal(state.playing, false);
  assert.equal(state.position, 0);
});

test('a media surface owns time once it reports, and reports it safely', () => {
  const state = createPlayback(movie);
  // The real file is longer than the metadata runtime said, and its clock wins from then on.
  const loaded = playbackReducer(state, { type: 'media', position: 12, duration: 7200 });
  assert.equal(loaded.duration, 7200);
  assert.equal(loaded.position, 12);
  assert.equal(loaded.completed, false);
  assert.equal(loaded.playing, true);
  // A player that has not read the container yet reports zero duration; the estimate must survive.
  const estimate = playbackReducer(state, { type: 'media', position: 3, duration: 0 });
  assert.equal(estimate.duration, state.duration);
  assert.equal(estimate.position, 3);
  // Positions beyond the reported end are clamped, and reaching it ends playback.
  assert.equal(playbackReducer(state, { type: 'media', position: 99999, duration: 7200 }).position, 7200);
  const ended = playbackReducer(state, { type: 'media', position: 7200, duration: 7200 });
  assert.equal(ended.completed, true);
  assert.equal(ended.playing, false);
  // Nonsense reports cannot move the clock or poison the duration.
  for (const bad of [NaN, Infinity, -Infinity]) {
    assert.equal(playbackReducer(state, { type: 'media', position: bad, duration: bad }).position, 0);
    assert.equal(playbackReducer(state, { type: 'media', position: bad, duration: bad }).duration, state.duration);
  }
  assert.equal(playbackReducer(state, { type: 'media', position: -40, duration: 7200 }).position, 0);
});

test('screen fit is remembered per viewer and maps onto the media layer resize modes', () => {
  let state = createPlayback(movie);
  // These streams are cinemascope, so the default is the one that uses the whole panel.
  assert.equal(state.aspect, 'fill');
  state = playbackReducer(state, { type: 'aspect', value: 'fit' });
  assert.equal(state.aspect, 'fit');
  assert.equal(playbackReducer(state, { type: 'tick', seconds: 5 }).position, 5);
  // A mode the player does not offer cannot be set, and cannot disturb the rest of the state.
  const bad = { type: 'aspect', value: 'zoom' } as unknown as PlaybackAction;
  assert.equal(playbackReducer(state, bad).aspect, 'fit');
  // The three choices are exactly the three modes a player surface accepts, in that order.
  assert.deepEqual(ASPECT_MODES.map(resizeModeFor), ['cover', 'contain', 'stretch']);
  assert.deepEqual(ASPECT_MODES, ['fill', 'fit', 'stretch']);
  assert.equal(ASPECT_MODES.every(mode => ASPECT_LABELS[mode].length > 0), true);
  for (const value of ASPECT_MODES) assert.equal(validAspect(value), true);
  for (const value of ['Fill', '', null, undefined, 1, {}, []]) assert.equal(validAspect(value), false);
  // A preference, so it is written into the library and read back on the next launch.
  const kept = parseLibrary(JSON.stringify({ ...emptyLibrary(), preferences: { audio: 'English', subtitles: 'Off', speed: 1, aspect: 'fit' } }));
  assert.equal(kept.preferences.aspect, 'fit');
  const dropped = parseLibrary(JSON.stringify({ ...emptyLibrary(), preferences: { audio: 'English', subtitles: 'Off', speed: 1, aspect: 'zoom' } }));
  assert.equal(dropped.preferences.aspect, 'fill');
});

test('time formatting handles hours, negative, and nonfinite values', () => {
  assert.equal(formatTime(65), '1:05');
  assert.equal(formatTime(3661), '1:01:01');
  assert.equal(formatTime(-3), '0:00');
  assert.equal(formatTime(Infinity), '0:00');
});

test('watchlist toggles immutably and distinguishes movie and television ids', () => {
  const original = emptyLibrary();
  let library = toggleSaved(original, movie);
  library = toggleSaved(library, show);
  assert.equal(original.watchlist.length, 0);
  assert.equal(library.watchlist.length, 2);
  library = toggleSaved(library, movie);
  assert.deepEqual(library.watchlist.map(t => t.kind), ['tv']);
});

test('progress saves episodes separately and removes a title at the 95 percent boundary', () => {
  let library = emptyLibrary();
  const state = createPlayback(movie, undefined, 5699);
  library = saveProgress(library, state, 100);
  assert.equal(library.progress[progressKey(movie)].position, 5699);
  assert.equal(library.progress[progressKey(movie)].updatedAt, 100);
  library = saveProgress(library, { ...state, position: 5700 }, 200);
  assert.equal(library.progress[progressKey(movie)], undefined);
  library = saveProgress(library, createPlayback(show, episode, 100), 300);
  library = saveProgress(library, createPlayback(show, { ...episode, number: 3 }, 50), 400);
  assert.equal(Object.keys(library.progress).length, 2);
  const zero = saveProgress(library, createPlayback(movie), 500);
  assert.equal(zero.progress[progressKey(movie)], undefined);
});

test('continue watching sorts newest first and displays only the latest episode per title', () => {
  let library = emptyLibrary();
  library = saveProgress(library, createPlayback(show, episode, 100), 100);
  library = saveProgress(library, createPlayback(movie, undefined, 100), 200);
  library = saveProgress(library, createPlayback(show, { ...episode, number: 3 }, 100), 300);
  const items = continueWatching(library);
  assert.deepEqual(items.map(p => p.title.kind), ['tv', 'movie']);
  assert.equal(items[0].episode?.number, 3);
});

test('library parsing rejects broken schemas without crashing and roundtrips valid progress', () => {
  for (const json of [null, '', '{', 'null', '[]', '42', '{"watchlist":{},"progress":[],"preferences":null}']) {
    assert.deepEqual(parseLibrary(json), emptyLibrary());
  }
  let library = toggleSaved(emptyLibrary(), movie);
  library = saveProgress(library, createPlayback(show, episode, 100), 200);
  library.preferences = { audio: 'Spanish', subtitles: 'English', speed: 1.5, aspect: 'fit' };
  assert.deepEqual(parseLibrary(JSON.stringify(library)), library);
});

test('library parsing drops corrupt entries and validates preferences and canonical keys', () => {
  const valid = saveProgress(emptyLibrary(), createPlayback(movie, undefined, 100), 200).progress[progressKey(movie)];
  const parsed = parseLibrary(JSON.stringify({
    watchlist: [movie, { ...movie, id: 'bad' }, { ...movie, runtime: 'bad' }, movie],
    progress: { wrongKey: valid, bad: { ...valid, position: null }, worse: { ...valid, duration: 0 } },
    preferences: { audio: 42, subtitles: null, speed: -2, aspect: 'zoom' },
  }));
  assert.equal(parsed.watchlist.length, 1);
  assert.equal(Object.keys(parsed.progress).length, 1);
  assert.equal(parsed.progress[progressKey(movie)].position, 100);
  assert.deepEqual(parsed.preferences, emptyLibrary().preferences);
});

test('real catalog string years and missing artwork survive library persistence', () => {
  const actual = {...movie, year:'2014',poster:null,backdrop:null};
  const lib = toggleSaved(emptyLibrary(), actual);
  const state = {...createPlayback(actual),position:45};
  const restored = parseLibrary(JSON.stringify(saveProgress(lib,state,1000)));
  assert.equal(restored.watchlist.length,1);
  assert.equal(continueWatching(restored)[0].position,45);
});

test('episode progress with no thumbnail survives a restart', () => {
 const show = {...movie,kind:'tv' as const};
 const ep = {...episode,still:null};
 const restored=parseLibrary(JSON.stringify(saveProgress(emptyLibrary(),{...createPlayback(show,ep),position:60},1000)));
 assert.equal(continueWatching(restored)[0].episode!.number,2);
});

test('replay restarts a completed title and advances its clock', () => {
  const finished = playbackReducer(createPlayback(movie), {type:'seekTo',position:999999});
  const replayed = playbackReducer(finished, {type:'replay'});
  assert.equal(replayed.position, 0);
  assert.equal(replayed.completed, false);
  assert.equal(replayed.playing, true);
  assert.equal(playbackReducer(replayed, {type:'tick',seconds:3}).position, 3);
});
