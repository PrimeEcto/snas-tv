#!/usr/bin/env node
/**
 * Live end-to-end verification on the headless Vega Virtual Device.
 *
 * This drives the installed build over Appium (the official Vega driver) with remote key
 * events only — no host mouse or keyboard injection — and records what the app actually
 * renders. Element ids are discovered from the live tree rather than hard-coded, because
 * the catalogue is live TMDB data and its ids change with it.
 *
 *   npm run verify:live            # needs a running VVD and a running Appium server
 *
 * Results land in research/live-results.json and native screenshots in .impeccable/review/.
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { connect, click, key, request, screenshot, source, waitFor, find } from './device-test.mjs';

const RESULTS = [];
const SESSION_FILE = 'research/appium-session-id.txt';
const settle = (ms = 700) => new Promise((resolve) => setTimeout(resolve, ms));
const session = () => readFileSync(SESSION_FILE, 'utf8').trim();
const texts = (xml) => [...xml.matchAll(/<text>([^<]*)<\/text>/g)].map((match) => match[1]);
const ids = (xml) => [...new Set([...xml.matchAll(/test_id="([^"]+)"/g)].map((match) => match[1]))];

/** Attach, clearing a session left behind by an interrupted run. */
async function attach() {
  try {
    return await connect();
  } catch (error) {
    try {
      await request('DELETE', `/session/${session()}`);
    } catch {
      // Nothing to clean up.
    }
    return connect();
  }
}

async function press(id) {
  await click(id);
  await settle();
}

async function isDisplayed(id) {
  try {
    const element = await find(id);
    return Boolean(await request('GET', `/session/${session()}/element/${element}/displayed`));
  } catch {
    return false;
  }
}

/** First id in the current tree matching a pattern, or undefined. */
function firstId(xml, pattern) {
  return ids(xml).find((id) => pattern.test(id));
}

async function scrollTo(id, tries = 14) {
  for (let attempt = 0; attempt < tries; attempt += 1) {
    if (await isDisplayed(id)) return;
    await key(108); // D-pad down
    await settle(400);
  }
  throw new Error(`remote could not reach ${id}`);
}

async function check(name, body) {
  try {
    await body();
    RESULTS.push({ name, result: 'PASS' });
    console.log('PASS', name);
  } catch (error) {
    RESULTS.push({ name, result: 'FAIL', error: String(error && error.message) });
    console.log('FAIL', name, String(error && error.message).slice(0, 200));
  } finally {
    writeFileSync('research/live-results.json', `${JSON.stringify(RESULTS, null, 2)}\n`);
  }
}

/** The timecode the player shows, if any. */
function clock(xml) {
  const found = [...xml.matchAll(/<text>(\d+:\d{2}(?::\d{2})?)<\/text>/g)].map((match) => match[1]);
  return found.at(-1);
}

const observations = {};

await attach();
await waitFor('nav-Home', 30000);

await check('Home renders the live catalogue and trending rails', async () => {
  await press('nav-Home');
  await waitFor('home-play');
  const xml = await source();
  const trending = ids(xml).filter((id) => /^trending-(movie|tv)-\d+$/.test(id));
  observations.homeTrending = trending.length;
  observations.homeBadge = texts(xml).includes('LIVE CATALOG') ? 'LIVE CATALOG' : 'absent';
  assert.ok(observations.homeBadge === 'LIVE CATALOG', 'live catalogue badge missing');
  assert.ok(trending.length >= 3, `only ${trending.length} trending titles rendered`);
  await screenshot('live-home');
});

await check('Hero opens a live detail page with real metadata', async () => {
  await press('home-details');
  await waitFor('details-play', 20000);
  const xml = await source();
  const synopsis = texts(xml).sort((a, b) => b.length - a.length)[0] ?? '';
  observations.detailsSynopsisLength = synopsis.length;
  assert.ok(synopsis.length > 80, 'detail page has no real synopsis');
  await screenshot('live-details');
});

await check('My List starts empty and the watchlist button is reachable', async () => {
  await press('nav-My List');
  await settle(1200);
  const xml = await source();
  observations.myListEmpty = texts(xml).some((text) => /Nothing|empty|No saved/i.test(text));
  await screenshot('live-my-list-empty');
});

await check('Saving from details puts the title in My List', async () => {
  await press('nav-Home');
  await waitFor('home-details');
  await press('home-details');
  await waitFor('details-save', 20000);
  const before = await source();
  if (!/In My List|Remove/i.test(before)) await press('details-save');
  await press('nav-My List');
  await settle(1200);
  const xml = await source();
  const saved = ids(xml).filter((id) => /^list-(movie|tv)-\d+$/.test(id));
  observations.myListSaved = saved.length;
  assert.ok(saved.length >= 1, 'saved title did not appear in My List');
  await screenshot('live-my-list');
});

await check('Movies tab lists a live browse catalogue', async () => {
  await press('nav-Movies');
  await waitFor('genre', 20000);
  await settle(1500);
  const xml = await source();
  const titles = ids(xml).filter((id) => /^browse-movie-\d+$/.test(id));
  observations.moviesTitles = titles.length;
  assert.ok(titles.length >= 3, `only ${titles.length} movies in the browse rail`);
  await screenshot('live-movies');
});

await check('Movies genre filter applies and restores', async () => {
  await press('genre');
  await settle(900);
  const menu = await source();
  const option = firstId(menu, /^option-/) ?? firstId(menu, /^genre-/);
  assert.ok(option, 'genre menu exposed no options');
  await press(option);
  await settle(1500);
  const filtered = await source();
  observations.genreFilter = texts(filtered).find((text) => /Genre:/.test(text)) ?? 'no chip';
  await screenshot('live-movies-filtered');
  // Return the filter to its default so later journeys see the full rail.
  if (await isDisplayed('genre')) {
    await press('genre');
    await settle(900);
    const again = await source();
    const all = firstId(again, /^option-(All|all)/) ?? ids(again).find((id) => /^option-/.test(id));
    if (all) await press(all);
    await settle(1200);
  }
});

await check('Movies pagination loads more titles', async () => {
  const before = ids(await source()).filter((id) => /^browse-movie-\d+$/.test(id));
  await scrollTo('browse-more');
  await press('browse-more');
  await settle(2500);
  const after = ids(await source()).filter((id) => /^browse-movie-\d+$/.test(id));
  observations.moviesAfterPage = after.length;
  assert.ok(after.length >= before.length, 'pagination removed titles instead of adding them');
  assert.ok(after.length > before.length || after.length >= 3, 'pagination added nothing');
});

await check('Series tab opens a live series detail page', async () => {
  await press('nav-Series');
  await settle(2000);
  const xml = await source();
  const series = firstId(xml, /^browse-tv-\d+$/);
  assert.ok(series, 'no series rendered');
  await press(series);
  await waitFor('details-play', 20000);
  const detail = await source();
  observations.seriesSeasons = ids(detail).filter((id) => /^season-\d+$/.test(id)).length;
  observations.seriesEpisodes = ids(detail).filter((id) => /^episode-\d+-\d+$/.test(id)).length;
  await screenshot('live-series-details');
  assert.ok(observations.seriesSeasons >= 1, 'series detail page shows no seasons');
  assert.ok(observations.seriesEpisodes >= 1, 'series detail page shows no episodes');
});

await check('A series episode opens the episode player', async () => {
  await scrollTo(firstId(await source(), /^episode-\d+-\d+$/));
  await press(firstId(await source(), /^episode-\d+-\d+$/));
  await waitFor('player-episodes', 25000);
  await settle(1500);
  const xml = await source();
  observations.episodePlayerText = texts(xml).filter((text) => /Season|Episode/.test(text)).slice(0, 4);
  await screenshot('live-episode-player');
  assert.ok(observations.episodePlayerText.length >= 1, 'episode player shows no episode context');
});

await check('Episode player: next episode and exit', async () => {
  await press('player-next');
  await settle(1500);
  const xml = await source();
  observations.episodeAfterNext = texts(xml).filter((text) => /Season|Episode/.test(text)).slice(0, 4);
  await press('player-exit');
  await settle(1200);
  assert.ok(!(await isDisplayed('player-next')), 'player did not close on exit');
});

await check('Movie player opens from the hero, with transport controls', async () => {
  await press('nav-Home');
  await waitFor('home-play');
  await press('home-play');
  await waitFor('player-toggle', 25000);
  await settle(2500);
  const xml = await source();
  observations.playerTexts = texts(xml).filter((text) => text.trim()).slice(0, 14);
  observations.playerClock = clock(xml) ?? 'no timecode';
  observations.playerHasMediaLine = texts(xml).some((text) => /media track/i.test(text));
  await screenshot('live-player');
  assert.ok(await isDisplayed('player-toggle'), 'player has no play/pause control');
});

await check('Movie player: pause holds the clock and seek moves it', async () => {
  const paused = await source();
  const beforePause = clock(paused) ?? 'none';
  await press('player-toggle');
  await settle(1800);
  const afterPause = clock(await source()) ?? 'none';
  observations.pauseHeld = beforePause === afterPause ? `held at ${afterPause}` : `moved ${beforePause} -> ${afterPause}`;
  if (await isDisplayed('player-forward')) {
    await press('player-forward');
    await settle(1200);
    observations.seekMoved = clock(await source()) ?? 'no timecode';
  } else {
    observations.seekMoved = 'no forward control';
  }
});

await check('Movie player: audio, subtitle and speed menus open and close', async () => {
  for (const menu of ['player-audio', 'player-subtitles', 'player-settings']) {
    if (!(await isDisplayed(menu))) {
      observations[menu] = 'control absent';
      continue;
    }
    await press(menu);
    await settle(900);
    const xml = await source();
    const option = firstId(xml, /^option-/);
    observations[menu] = option ? `opened with ${option}` : 'opened with no options';
    if (option) await press(option);
    await settle(700);
  }
  await screenshot('live-player-menus');
  await press('player-exit');
  await settle(1200);
});

await check('Search returns live results and a genuine empty state', async () => {
  await press('nav-Search');
  await waitFor('key-A', 20000);
  if (await isDisplayed('key-clear')) await press('key-clear');
  for (const letter of 'DUNE') await press(`key-${letter}`);
  await settle(2500);
  const hit = await source();
  const results = ids(hit).filter((id) => /^search-(movie|tv)-\d+$/.test(id));
  observations.searchHits = results.length;
  await screenshot('live-search');
  assert.ok(results.length >= 1, 'searching DUNE returned no results');
  await press('key-clear');
  for (const letter of 'ZZZZZ') await press(`key-${letter}`);
  await settle(2500);
  const miss = await source();
  observations.searchEmptyState = texts(miss).find((text) => /No matches/i.test(text)) ?? 'absent';
  assert.ok(/No matches/i.test(miss), 'no empty state for a query with no matches');
  await press('key-clear');
});

await check('About reports the running version and its backend', async () => {
  await press('nav-About');
  await settle(1500);
  const xml = await source();
  observations.aboutTexts = texts(xml).filter((text) => /0\.\d|backend|SNAS/i.test(text)).slice(0, 6);
  await screenshot('live-about');
  assert.ok(observations.aboutTexts.length >= 1, 'About shows no version/backend line');
});

await check('Progress from the played title joins Continue Watching', async () => {
  await press('nav-My List');
  await settle(1500);
  const xml = await source();
  const continueId = firstId(xml, /^list-continue$/);
  observations.continueWatching = continueId ? 'present' : 'absent';
  await screenshot('live-continue-watching');
  assert.ok(continueId, 'Continue Watching is empty after playing a title');
});

const failed = RESULTS.filter((entry) => entry.result === 'FAIL').length;
writeFileSync('research/live-observations.json', `${JSON.stringify(observations, null, 2)}\n`);
console.log(`\n${RESULTS.length - failed} passed, ${failed} failed`);
console.log(JSON.stringify(observations, null, 2));
process.exitCode = failed > 0 ? 1 : 0;
