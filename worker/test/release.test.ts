import test from 'node:test';
import assert from 'node:assert/strict';

import { checkForUpdate, compareVersions, downloadReleaseAsset, fetchLatestRelease, toManifest } from '../src/release.ts';
import type { FetchLike } from '../src/movy.ts';

const release = {
  tag_name: 'v0.2.0',
  name: 'SNAS 0.2.0',
  published_at: '2026-10-13T12:00:00Z',
  prerelease: false,
  draft: false,
  body: 'Real player.',
  assets: [
    { name: 'snas_x86_64.vpkg', size: 151440, content_type: 'application/octet-stream', url: 'https://api.github.com/asset/1' },
    { name: 'version.json', size: 120, content_type: 'application/json', url: 'https://api.github.com/asset/2' },
  ],
};

test('version comparison handles prefixes, gaps and prereleases', () => {
  assert.ok(compareVersions('0.1.0', '0.1.1') < 0);
  assert.ok(compareVersions('v0.2.0', '0.1.9') > 0);
  assert.equal(compareVersions('v0.2.0', '0.2'), 0, 'a missing part counts as zero');
  assert.equal(compareVersions('1.0.0', 'v1.0.0'), 0);
  assert.ok(compareVersions('1.0.0', '1.0.0-rc.1') > 0);
  assert.ok(compareVersions('1.2', '1.10') < 0);
});

test('manifest exposes proxied asset paths instead of GitHub URLs', () => {
  const manifest = toManifest(release);
  assert.equal(manifest.version, '0.2.0');
  assert.equal(manifest.tag, 'v0.2.0');
  assert.equal(manifest.assets.length, 2);
  assert.equal(manifest.assets[0].path, '/v1/app/asset/snas_x86_64.vpkg');
  assert.ok(!JSON.stringify(manifest).includes('api.github.com'));
});

test('update checks only fire when the device is behind', () => {
  const manifest = toManifest(release);
  assert.equal(checkForUpdate(manifest, '0.1.0').updateAvailable, true);
  assert.equal(checkForUpdate(manifest, '0.2.0').updateAvailable, false);
  assert.equal(checkForUpdate(manifest, '0.3.0').updateAvailable, false);
  assert.deepEqual(checkForUpdate(null, '0.1.0'), { updateAvailable: false, currentVersion: '0.1.0', latest: null });
});

test('the stable channel skips prereleases and beta accepts them', async () => {
  const page = [
    { ...release, tag_name: 'v0.3.0-rc.1', prerelease: true, published_at: '2026-10-14T12:00:00Z' },
    release,
  ];
  const fetchImpl: FetchLike = async () => new Response(JSON.stringify(page), { status: 200 });

  const stable = await fetchLatestRelease({ GITHUB_REPO: 'owner/repo', GITHUB_TOKEN: 'token' }, { fetchImpl });
  assert.equal(stable?.version, '0.2.0');

  const beta = await fetchLatestRelease(
    { GITHUB_REPO: 'owner/repo', GITHUB_TOKEN: 'token' },
    { fetchImpl, channel: 'beta' },
  );
  assert.equal(beta?.version, '0.3.0-rc.1');
});

test('a release is chosen by the package the device can install, not by date alone', async () => {
  const vegaPackage = { ...release, tag_name: 'v0.4.0', published_at: '2026-10-15T12:00:00Z' };
  const fireTvApk = {
    ...release,
    tag_name: 'v0.5.0',
    published_at: '2026-10-16T12:00:00Z',
    assets: [{ name: 'snas-0.5.0.apk', size: 41943040, content_type: 'application/octet-stream', url: 'https://api.github.com/asset/9' }],
  };
  const page = [fireTvApk, vegaPackage];
  const env = { GITHUB_REPO: 'owner/repo', GITHUB_TOKEN: 't' };
  const fetchImpl: FetchLike = async () => new Response(JSON.stringify(page), { status: 200 });

  // Without a format the newest release wins, which is what the host-side installers ask for.
  assert.equal((await fetchLatestRelease(env, { fetchImpl }))?.version, '0.5.0');
  assert.equal((await fetchLatestRelease(env, { fetchImpl, format: 'apk' }))?.version, '0.5.0');
  // A Vega device must still be told about its own package rather than about the newer APK.
  assert.equal((await fetchLatestRelease(env, { fetchImpl, format: 'vpkg' }))?.version, '0.4.0');
  // And a request for a package nothing carries is an empty answer, not the wrong one.
  const onlyApk = [fireTvApk];
  const apkOnly: FetchLike = async () => new Response(JSON.stringify(onlyApk), { status: 200 });
  assert.equal(await fetchLatestRelease(env, { fetchImpl: apkOnly, format: 'vpkg' }), null);
});

test('a package stays downloadable after a release of the other kind is published', async () => {
  const vegaPackage = { ...release, tag_name: 'v0.4.0', published_at: '2026-10-15T12:00:00Z' };
  const fireTvApk = {
    ...release,
    tag_name: 'v0.5.0',
    published_at: '2026-10-16T12:00:00Z',
    assets: [{ name: 'snas-0.5.0.apk', size: 41943040, content_type: 'application/octet-stream', url: 'https://api.github.com/asset/9' }],
  };
  const env = { GITHUB_REPO: 'owner/repo', GITHUB_TOKEN: 't' };
  const fetchImpl: FetchLike = async (url) => {
    if (url.includes('/releases?')) return new Response(JSON.stringify([fireTvApk, vegaPackage]), { status: 200 });
    return new Response('package-bytes', { status: 200 });
  };

  const response = await downloadReleaseAsset(env, 'snas_x86_64.vpkg', { fetchImpl });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'package-bytes');
});

test('an unconfigured repository yields no manifest rather than an error', async () => {
  assert.equal(await fetchLatestRelease({}, { fetchImpl: async () => { throw new Error('should not be called'); } }), null);
});

test('the token is sent to GitHub but never appears in the manifest', async () => {
  let authorization: string | undefined;
  let userAgent: string | undefined;
  const fetchImpl: FetchLike = async (_url, init) => {
    const headers = init?.headers as Record<string, string>;
    authorization = headers.authorization;
    userAgent = headers['user-agent'];
    return new Response(JSON.stringify([release]), { status: 200 });
  };
  const manifest = await fetchLatestRelease({ GITHUB_REPO: 'owner/repo', GITHUB_TOKEN: 'secret-token' }, { fetchImpl });
  assert.equal(authorization, 'Bearer secret-token');
  assert.ok(userAgent, 'GitHub requires a User-Agent');
  assert.ok(!JSON.stringify(manifest).includes('secret-token'));
});

test('a missing release asset is reported as 404', async () => {
  const fetchImpl: FetchLike = async () => new Response(JSON.stringify([release]), { status: 200 });
  const response = await downloadReleaseAsset({ GITHUB_REPO: 'owner/repo', GITHUB_TOKEN: 't' }, 'nope.bin', { fetchImpl });
  assert.equal(response.status, 404);
});

// The first Fire TV release ships as an APK; the Vega package rides along when present.
const withBoth = {
  ...release,
  tag_name: 'v0.3.0',
  assets: [
    { name: 'version.json', size: 210, content_type: 'application/json', url: 'https://api.github.com/asset/1' },
    { name: 'snas_x86_64.vpkg', size: 151440, content_type: 'application/octet-stream', url: 'https://api.github.com/asset/2' },
    { name: 'snas-0.3.0.apk', size: 41943040, content_type: 'application/octet-stream', url: 'https://api.github.com/asset/3' },
  ],
};

test('the APK is listed first, with its exact name and size', () => {
  const manifest = toManifest(withBoth);
  assert.equal(manifest.version, '0.3.0');
  assert.deepEqual(
    manifest.assets.map((asset) => asset.name),
    ['snas-0.3.0.apk', 'snas_x86_64.vpkg', 'version.json'],
  );
  assert.equal(manifest.assets[0].size, 41943040);
  assert.equal(manifest.assets[0].path, '/v1/app/asset/snas-0.3.0.apk');
  assert.ok(!JSON.stringify(manifest).includes('api.github.com'));
  assert.ok(!JSON.stringify(manifest).includes('owner/repo'));
});

test('the APK is streamed through the Worker without exposing the token', async () => {
  const seen: { url: string; headers: Record<string, string> }[] = [];
  const fetchImpl: FetchLike = async (input, init) => {
    seen.push({ url: input, headers: (init?.headers ?? {}) as Record<string, string> });
    if (input.includes('/releases')) return new Response(JSON.stringify([withBoth]), { status: 200 });
    return new Response('PK-BYTES', { status: 200, headers: { 'content-type': 'application/vnd.android.package-archive' } });
  };

  const response = await downloadReleaseAsset(
    { GITHUB_REPO: 'owner/repo', GITHUB_TOKEN: 'secret-token' },
    'snas-0.3.0.apk',
    { fetchImpl },
  );
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'PK-BYTES');
  assert.equal(response.headers.get('content-type'), 'application/vnd.android.package-archive');
  assert.equal(response.headers.get('content-length'), '41943040');
  assert.match(response.headers.get('content-disposition') ?? '', /snas-0\.3\.0\.apk/);
  assert.equal(seen.length, 2, 'one release-list request, one asset request');
  assert.ok(seen[1].url.endsWith('/asset/3'), 'the asset URL from the release is used');
  assert.equal(seen[1].headers.authorization, 'Bearer secret-token');
  assert.equal(seen[1].headers.accept, 'application/octet-stream');
  for (const [, value] of response.headers) assert.ok(!value.includes('secret-token'));
});

test('an unreachable GitHub is reported as 502 and an unconfigured repo as 404', async () => {
  const broken: FetchLike = async () => new Response('nope', { status: 500 });
  const unavailable = await downloadReleaseAsset({ GITHUB_REPO: 'owner/repo', GITHUB_TOKEN: 't' }, 'snas-0.3.0.apk', { fetchImpl: broken });
  assert.equal(unavailable.status, 502);

  const unconfigured = await downloadReleaseAsset({}, 'snas-0.3.0.apk', { fetchImpl: broken });
  assert.equal(unconfigured.status, 404);
});
