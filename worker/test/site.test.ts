import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_SITE,
  SITE_RETRY_MS,
  SITE_TTL_MS,
  clearSiteCache,
  currentSite,
  declaredOrigin,
  normalize,
  rememberSite,
  siteReferer,
  type SiteFetch,
} from '../src/site.ts';

/** A Response whose final URL is what a redirect chain would have landed on. */
function page(url: string, html = '', status = 200): Response {
  const response = new Response(html, { status });
  Object.defineProperty(response, 'url', { value: url });
  return response;
}

test.beforeEach(() => clearSiteCache());
test.afterEach(() => clearSiteCache());

test('a seed that redirects to the new host yields that host', async () => {
  // movy.bz answered `301 https://www.movy.sx/` on 2026-10-25; the redirect chain is followed by
  // fetch, so the final URL is the host the API will accept.
  const fetchImpl: SiteFetch = async () => page('https://www.movy.sx/', '<html></html>');
  assert.equal(await siteReferer({ fetchImpl }), 'https://www.movy.sx/');
});

test('a page that declares its own home is believed over the host it was served on', async () => {
  // A provider that has moved but still answers 200 on the old domain can only be followed this way.
  const html = '<head><link rel="canonical" href="https://www.movy.xyz" data-next-head=""></head>';
  const fetchImpl: SiteFetch = async () => page('https://movy.bz/', html);
  assert.equal(await siteReferer({ fetchImpl }), 'https://www.movy.xyz/');
});

test('og:url is read when there is no canonical link', () => {
  assert.equal(
    declaredOrigin('<meta property="og:url" content="https://www.movy.sx" />', 'https://movy.bz/'),
    'https://www.movy.sx/',
  );
});

test('the discovered host is cached, so playback does not pay for it twice', async () => {
  let calls = 0;
  const fetchImpl: SiteFetch = async () => {
    calls += 1;
    return page('https://www.movy.sx/');
  };
  assert.equal(await siteReferer({ fetchImpl }), 'https://www.movy.sx/');
  assert.equal(await siteReferer({ fetchImpl }), 'https://www.movy.sx/');
  assert.equal(calls, 1);
  assert.equal(currentSite(), 'https://www.movy.sx/');
});

test('a pinned host is used without asking anyone', async () => {
  let calls = 0;
  const fetchImpl: SiteFetch = async () => {
    calls += 1;
    return page('https://wrong.example/');
  };
  assert.equal(await siteReferer({ fetchImpl, override: 'www.movy.sx' }), 'https://www.movy.sx/');
  assert.equal(calls, 0);
});

test('a failed discovery keeps the last known host rather than sending nothing', async () => {
  rememberSite('https://www.movy.sx/', 0);
  const fetchImpl: SiteFetch = async () => {
    throw new Error('offline');
  };
  assert.equal(await siteReferer({ fetchImpl }), 'https://www.movy.sx/');
});

test('with nothing discovered at all the bootstrap host stands in', async () => {
  const fetchImpl: SiteFetch = async () => new Response('nope', { status: 403 });
  assert.equal(await siteReferer({ fetchImpl }), DEFAULT_SITE);
});

test('a failed discovery is not repeated on every playback request', async () => {
  let calls = 0;
  const fetchImpl: SiteFetch = async () => {
    calls += 1;
    throw new Error('offline');
  };
  assert.equal(await siteReferer({ fetchImpl, now: 1000 }), DEFAULT_SITE);
  assert.equal(await siteReferer({ fetchImpl, now: 1000 + SITE_RETRY_MS - 1 }), DEFAULT_SITE);
  // Two seed domains asked once, not twice: a dead site must not cost a timeout per request.
  assert.equal(calls, 2);
});

test('a stale cache is re-resolved and a move is picked up', async () => {
  rememberSite('https://www.movy.sx/', 0);
  const fetchImpl: SiteFetch = async () => page('https://www.movy.xyz/');
  assert.equal(await siteReferer({ fetchImpl, now: SITE_TTL_MS + 1 }), 'https://www.movy.xyz/');
});

test('a host is normalised to an https origin, and anything else is refused', () => {
  assert.equal(normalize('movy.sx'), 'https://movy.sx/');
  assert.equal(normalize('https://www.movy.sx/watch/123?x=1'), 'https://www.movy.sx/');
  assert.equal(normalize('http://movy.sx/'), '');
  assert.equal(normalize('not a host'), '');
  assert.equal(normalize(''), '');
  assert.equal(normalize(undefined), '');
});
