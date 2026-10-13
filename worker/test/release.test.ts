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
