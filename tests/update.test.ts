import test from 'node:test';
import assert from 'node:assert/strict';
import {checkForUpdate, compareVersions, findPackageAsset, parseVersion, updateMessage} from '../src/update.ts';
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

test('the installable package is the vpkg, not the manifest asset', () => {
  assert.equal(findPackageAsset(manifest)?.name, 'snas_x86_64.vpkg');
  assert.equal(findPackageAsset({...manifest, assets: []}), undefined);
  assert.equal(findPackageAsset(null), undefined);
});

test('the reported line names the version, its size and the installed build', () => {
  const note = updateMessage({updateAvailable: true, currentVersion: '0.1.0', latest: manifest});
  assert.equal(note, 'Update available: SNAS 0.2.0 · 9.0 MB · you have 0.1.0');
  assert.equal(updateMessage({updateAvailable: false, currentVersion: '0.1.0', latest: manifest}), undefined);
  assert.equal(updateMessage({updateAvailable: true, currentVersion: '0.2.0', latest: null}), undefined);
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
  assert.equal(calls[0], `${WORKER}/v1/app/latest?currentVersion=0.1.0`);
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
