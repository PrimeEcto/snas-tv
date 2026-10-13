import test from 'node:test';
import assert from 'node:assert/strict';
import {Catalog, demoTitles, imageUrl} from '../src/catalog/index.ts';

// The app holds no TMDB credential: every live request goes to the SNAS catalogue proxy,
// which owns the key server-side. These tests exercise that proxy contract only.
const PROXY = 'https://proxy.example/functions/v1/tmdb';
const response = (data: unknown, status = 200) => ({ok: status >= 200 && status < 300, status, json: async () => data});
const film = {id: 12, title: 'A Real Result', release_date: '2024-01-01', overview: 'Provider synopsis.', poster_path: '/abc.jpg', backdrop_path: null, genre_ids: [18], vote_average: 0, vote_count: 0};

test('no configured backend produces a populated, searchable, paginated sample catalog', async () => {
  const catalog = new Catalog();
  assert.equal(catalog.mode, 'demo');
  assert.ok(demoTitles.length >= 40);
  assert.ok(demoTitles.some(t => t.kind === 'tv'));
  const rails = await catalog.home();
  assert.ok(rails.length >= 8);
  assert.ok(rails.every(r => r.items.length > 0));
  const first = await catalog.discover('movie', undefined, undefined, 1);
  const second = await catalog.discover('movie', undefined, undefined, 2);
  assert.equal(first.page, 1);
  assert.equal(second.page, 2);
  assert.ok(second.items.length > 0);
  assert.ok(!second.items.some(t => first.items.some(x => x.id === t.id)));
  const result = await catalog.search('interstellar');
  assert.equal(result.items[0].id, 157336);
  const detail = await catalog.detail(result.items[0]);
  assert.equal(detail.title, 'Interstellar');
  assert.deepEqual(detail.episodes, []);
  const series = demoTitles.find(t => t.id === 66732)!;
  const episodes = await catalog.season(series, 1);
  assert.ok(episodes.length >= 8);
  assert.equal(episodes[0].title, 'Chapter One: The Vanishing of Will Byers');
  assert.equal(episodes[0].runtime, 48);
});

test('an unavailable backend and network failures never silently become demo results', async () => {
  const unauthorized = new Catalog(PROXY, async () => response({error:'catalog refused the request'}, 401));
  assert.equal(unauthorized.mode, 'live');
  await assert.rejects(unauthorized.search('Dune'), /refused|sample/i);
  const offline = new Catalog(PROXY, async () => {throw new Error('offline');});
  await assert.rejects(offline.home(), /network|connect|unavailable/i);
});

test('live search omits people and malformed records and preserves missing metadata', async () => {
  const catalog = new Catalog(PROXY, async () => response({page:1,total_pages:3,results:[{...film,media_type:'movie'}, {id:15,name:'An Actor',media_type:'person'}, {title:'No ID',media_type:'movie'}]}));
  const page = await catalog.search('real');
  assert.equal(page.items.length, 1);
  assert.equal(page.totalPages, 3);
  assert.equal(page.items[0].rating, null);
  assert.equal(page.items[0].runtime, null);
  assert.equal(page.items[0].backdrop, null);
  assert.equal(page.items[0].poster, '/abc.jpg');
  assert.deepEqual(page.items[0].genres, ['Drama']);
  assert.equal(imageUrl(null, 'w500'), undefined);
  assert.equal(imageUrl('/abc.jpg', 'w500'), 'https://image.tmdb.org/t/p/w500/abc.jpg');
  assert.equal(imageUrl('https://malicious.example/abc.jpg', 'w500'), undefined);
});

test('cache deduplicates requests while page and query remain independent', async () => {
  let requests = 0;
  const catalog = new Catalog(PROXY, async (url) => {
    requests++;
    const parsed = new URL(url);
    const p = Number(parsed.searchParams.get('page'));
    const q = parsed.searchParams.get('query');
    if (q !== 'real' || ![1,2].includes(p)) throw new Error('wrong request');
    return response({page:p,total_pages:2,results:[{...film,id:p,media_type:'movie'}]});
  });
  const [a,b] = await Promise.all([catalog.search('real'),catalog.search('real')]);
  assert.deepEqual(a,b);
  assert.equal(requests,1);
  const page2 = await catalog.search('real',2);
  assert.equal(page2.items[0].id,2);
  assert.deepEqual(await catalog.search('real'),a);
  assert.equal(requests,2);
  assert.deepEqual((await catalog.search('   ')).items, []);
});

test('discover sends kind, genre, sort and clamped pagination through documented query parameters', async () => {
  const catalog = new Catalog(PROXY, async url => {
    const parsed = new URL(url);
    assert.equal(parsed.pathname, '/functions/v1/tmdb/discover/movie');
    assert.equal(parsed.searchParams.get('with_genres'), '878');
    assert.equal(parsed.searchParams.get('sort_by'), 'vote_average.desc');
    assert.equal(parsed.searchParams.get('page'), '500');
    // No credential of any kind is ever attached by the device.
    assert.equal(parsed.searchParams.get('api_key'), null);
    assert.equal(parsed.searchParams.get('access_token'), null);
    return response({page:500,total_pages:800,results:[film]});
  });
  const result = await catalog.discover('movie','Science Fiction','vote_average.desc',999);
  assert.equal(result.totalPages,500);
  assert.equal(result.items[0].kind,'movie');
});

test('live details and season endpoints retain actual episode identity and credits', async () => {
  const catalog = new Catalog(PROXY, async url => {
    const path = new URL(url).pathname;
    if (path === '/functions/v1/tmdb/tv/66732') return response({id:66732,name:'Stranger Things',first_air_date:'2016-07-15',genres:[{id:18,name:'Drama'}],number_of_seasons:2,seasons:[{season_number:0},{season_number:1},{season_number:2}],credits:{cast:[{name:'Winona Ryder'}]},recommendations:{results:[]},episode_run_time:[48]});
    if (path === '/functions/v1/tmdb/tv/66732/season/1') return response({episodes:[{id:62085,season_number:1,episode_number:1,name:'Chapter One: The Vanishing of Will Byers',runtime:48,overview:'Will disappears.',still_path:'/episode.jpg'}]});
    throw new Error('wrong endpoint');
  });
  const title = demoTitles.find(t=>t.id===66732)!;
  const detail = await catalog.detail(title);
  assert.deepEqual(detail.seasonNumbers,[1,2]);
  assert.deepEqual(detail.cast,['Winona Ryder']);
  assert.equal(detail.episodes[0].id,62085);
  assert.equal(detail.episodes[0].runtime,48);
  assert.equal(detail.episodes[0].still,'/episode.jpg');
});
