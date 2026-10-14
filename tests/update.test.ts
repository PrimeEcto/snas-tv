import test from 'node:test';
import assert from 'node:assert/strict';
import {checkForUpdate, compareVersions, findPackageAsset, packageFormat, parseVersion, setPackageFormat, updateMessage} from '../src/update.ts';
import type {ReleaseManifest} from '../src/update.ts';

const WORKER = 'https://snas-movy.example.workers.dev';

const manifest: ReleaseManifest = {
  version: '0.2.0',
  tag: 'v0.2.0',
  name: 'SNAS 0.2.0',
  publishedAt: '2026-10-13T12:00:00Z',
  prerelease: false,
  notes: '- Sources and a subtitle menu in one call.',
  assets: [
    {name: 'version.json', size: 220, contentType: 'application/json', path: '/v1/app/asset/version.json'},
    {name: 'snas_x86_64.vpkg', size: 9437184, contentType: 'application/octet-stream', path: '/v1/app/asset/snas_x86_64.vpkg'},
  ],
};

const response = (data: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => data,
});

test('versions compare numerically, and a release outranks its own prerelease', () => {
  assert.ok(compareVersions('0.2.0', '0.1.9') > 0);
  assert.equal(compareVersions('0.2', '0.2.0'), 0);
  assert.equal(compareVersions('v1.0.0', '1.0.0'), 0);
  assert.ok(compareVersions('1.0.0', '1.0.0-rc.1') > 0);
  assert.deepEqual(parseVersion('v2.10.3-beta.1'), {parts: [2, 10, 3], prerelease: 'beta.1'});
});

test('only a package this build could actually install is offered', () => {
  // The running build defaults to APK, so a Vega-only release is not an update it can apply.
  assert.equal(findPackageAsset(manifest), undefined);
  assert.equal(findPackageAsset(manifest, {prefer: 'vpkg'})?.name, 'snas_x86_64.vpkg');
  assert.equal(findPackageAsset({...manifest, assets: []}), undefined);
  assert.equal(findPackageAsset(null), undefined);
  // And the reverse: an APK-only release says nothing to a Vega build.
  const apkOnly: ReleaseManifest = {
    ...manifest,
    assets: [{name: 'snas-0.2.0.apk', size: 41943040, path: '/v1/app/asset/snas-0.2.0.apk'}],
  };
  assert.equal(findPackageAsset(apkOnly, {prefer: 'vpkg'}), undefined);
  assert.equal(findPackageAsset(apkOnly)?.name, 'snas-0.2.0.apk');
});

test('the reported line names the version, its size and the installed build', () => {
  const apk: ReleaseManifest = {
    ...manifest,
    assets: [{name: 'snas-0.2.0.apk', size: 9437184, path: '/v1/app/asset/snas-0.2.0.apk'}],
  };
  const note = updateMessage({updateAvailable: true, currentVersion: '0.1.0', latest: apk});
  assert.equal(note, 'Update available: SNAS 0.2.0 · 9.0 MB · you have 0.1.0');
  // A release with nothing this build can install says nothing at all: a banner the viewer cannot
  // act on (a Vega package on Fire OS, an APK on Vega) is worse than no banner.
  assert.equal(updateMessage({updateAvailable: true, currentVersion: '0.1.0', latest: manifest}), undefined);
  assert.equal(updateMessage({updateAvailable: false, currentVersion: '0.1.0', latest: manifest}), undefined);
  assert.equal(updateMessage({updateAvailable: true, currentVersion: '0.2.0', latest: null}), undefined);
});

test('the Fire TV build installs the APK, the Vega build the package', () => {
  const both: ReleaseManifest = {
    ...manifest,
    assets: [
      {name: 'version.json', size: 220, contentType: 'application/json', path: '/v1/app/asset/version.json'},
      {name: 'snas_x86_64.vpkg', size: 9437184, contentType: 'application/octet-stream', path: '/v1/app/asset/snas_x86_64.vpkg'},
      {name: 'snas-0.2.0.apk', size: 41943040, contentType: 'application/octet-stream', path: '/v1/app/asset/snas-0.2.0.apk'},
    ],
  };
  // The APK is the default because the shipping Fire TV build is an APK.
  assert.equal(findPackageAsset(both)?.name, 'snas-0.2.0.apk');
  assert.equal(findPackageAsset(both, {prefer: 'apk'})?.name, 'snas-0.2.0.apk');
  assert.equal(findPackageAsset(both, {prefer: 'vpkg'})?.name, 'snas_x86_64.vpkg');
  assert.equal(findPackageAsset(both)?.size, 41943040, 'the reported size is the APK, not the manifest');
});

test('the running build\'s own format is the one it asks for', () => {
  const both: ReleaseManifest = {
    ...manifest,
    assets: [
      {name: 'snas-0.2.0.apk', size: 41943040, path: '/v1/app/asset/snas-0.2.0.apk'},
      {name: 'snas_x86_64.vpkg', size: 9437184, path: '/v1/app/asset/snas_x86_64.vpkg'},
    ],
  };
  try {
    setPackageFormat('vpkg');
    assert.equal(findPackageAsset(both)?.name, 'snas_x86_64.vpkg');
  } finally {
    setPackageFormat('apk');
  }
  assert.equal(findPackageAsset(both)?.name, 'snas-0.2.0.apk');
});

test('a package for the running architecture beats one for another', () => {
  const multi: ReleaseManifest = {
    ...manifest,
    assets: [
      {name: 'snas_aarch64.vpkg', size: 1048576, path: '/v1/app/asset/snas_aarch64.vpkg'},
      {name: 'snas_x86_64.vpkg', size: 9437184, path: '/v1/app/asset/snas_x86_64.vpkg'},
      {name: 'notes.txt', size: 12, path: '/v1/app/asset/notes.txt'},
    ],
  };
  assert.equal(findPackageAsset(multi, {prefer: 'vpkg', arch: 'x86_64'})?.name, 'snas_x86_64.vpkg');
  assert.equal(findPackageAsset(multi, {prefer: 'vpkg', arch: 'aarch64'})?.name, 'snas_aarch64.vpkg');
  // No package for this architecture at all: any package of the right kind still wins.
  assert.equal(findPackageAsset(multi, {prefer: 'vpkg', arch: 'riscv'})?.name, 'snas_aarch64.vpkg');
  assert.equal(findPackageAsset({...manifest, assets: [{name: 'notes.txt', size: 12, path: '/x'}]}), undefined);
});

test('a malformed manifest resolves to "no update known" rather than a broken banner', async () => {
  const missingVersion = await checkForUpdate(WORKER, '0.1.0', {
    fetchImpl: async () => response({updateAvailable: true, currentVersion: '0.1.0', latest: {assets: []}}),
  });
  assert.equal(missingVersion.updateAvailable, true);
  assert.equal(missingVersion.latest, null);
  assert.equal(updateMessage(missingVersion), undefined);

  // Assets without names or sizes are dropped, so the banner cannot print "NaN MB".
  const messy = await checkForUpdate(WORKER, '0.1.0', {
    fetchImpl: async () =>
      response({
        updateAvailable: true,
        latest: {version: '0.3.0', assets: [{path: '/v1/app/asset/x'}, {name: 'snas-0.3.0.apk'}]},
      }),
  });
  assert.equal(messy.latest?.tag, 'v0.3.0');
  assert.equal(messy.latest?.assets.length, 1);
  assert.equal(findPackageAsset(messy.latest)?.size, 0);
  assert.equal(updateMessage(messy), 'Update available: SNAS 0.3.0 · 0.0 MB · you have 0.1.0');
});

test('a newer release is reported and nothing else is disturbed', async () => {
  const calls: string[] = [];
  const check = await checkForUpdate(WORKER, '0.1.0', {
    fetchImpl: async (url) => {
      calls.push(url);
      return response({updateAvailable: true, currentVersion: '0.1.0', latest: manifest});
    },
  });
  assert.equal(check.updateAvailable, true);
  assert.equal(check.latest?.version, '0.2.0');
  // The format this build can install travels with the check, so the backend answers with the
  // newest APK release rather than the newest release of any kind.
  assert.equal(calls[0], `${WORKER}/v1/app/latest?currentVersion=0.1.0&format=${packageFormat}`);
});

test('a Vega build asks for Vega packages', async () => {
  const calls: string[] = [];
  setPackageFormat('vpkg');
  try {
    await checkForUpdate(WORKER, '0.2.0', {
      fetchImpl: async (url) => {
        calls.push(url);
        return response({updateAvailable: true, currentVersion: '0.2.0', latest: {version: '0.3.0'}});
      },
    });
  } finally {
    setPackageFormat('apk');
  }
  assert.equal(calls[0], `${WORKER}/v1/app/latest?currentVersion=0.2.0&format=vpkg`);
});

test('an unconfigured backend is not contacted at all', async () => {
  let called = false;
  const check = await checkForUpdate('', '0.1.0', {
    fetchImpl: async () => {
      called = true;
      return response({});
    },
  });
  assert.equal(called, false);
  assert.deepEqual(check, {updateAvailable: false, currentVersion: '0.1.0', latest: null});
});

test('failures resolve to "no update known" instead of breaking a launch', async () => {
  const offline = await checkForUpdate(WORKER, '0.1.0', {
    fetchImpl: async () => {
      throw new Error('offline');
    },
  });
  assert.equal(offline.updateAvailable, false);

  const error = await checkForUpdate(WORKER, '0.1.0', {fetchImpl: async () => response({error: 'boom'}, 502)});
  assert.equal(error.updateAvailable, false);

  const unreadable = await checkForUpdate(WORKER, '0.1.0', {fetchImpl: async () => response({latest: null})});
  assert.equal(unreadable.updateAvailable, false);
});
