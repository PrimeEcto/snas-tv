#!/usr/bin/env node
/**
 * Watch for a new release and install it on the Vega device.
 *
 * A Vega app cannot replace its own package — installation is a host-side action — so the
 * app only reports that a newer build exists (src/update.ts) and this script is the half
 * that acts on it. Leave it running while you test: when a release is pushed, the device
 * is updated and relaunched without a manual package copy.
 *
 *   node scripts/device-watch.mjs                     # poll every 60s and install
 *   node scripts/device-watch.mjs --once              # a single check
 *   node scripts/device-watch.mjs --dry-run           # download and verify, do not install
 *   node scripts/device-watch.mjs --once --current-version 0.2.0 --dry-run
 *   node scripts/device-watch.mjs --device <serial>   # pass a device to `vega run-app`
 *
 * It reads the backend from src/backend.json and the installed version from package.json,
 * downloads through the Worker (the repository is private, so the device never holds a
 * token), verifies the release's SHA-256, and then runs `vega run-app`.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const backend = JSON.parse(readFileSync(join(ROOT, 'src', 'backend.json'), 'utf8'));
const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const APP_ID = JSON.parse(readFileSync(join(ROOT, 'app.json'), 'utf8')).name;

const args = process.argv.slice(2);
const flag = (name, fallback = '') => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] && !args[index + 1].startsWith('--') ? args[index + 1] : fallback;
};
const once = args.includes('--once');
const dryRun = args.includes('--dry-run');
const intervalSeconds = Math.max(15, Number(flag('interval', '60')) || 60);
const device = flag('device');

/** The version to compare against; defaults to the one this checkout builds. */
let currentVersion = flag('current-version', manifest.version);

const base = (backend.workerBase ?? '').trim().replace(/\/+$/, '');
if (!base) {
  console.error('src/backend.json has no workerBase to poll.');
  process.exit(2);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const stamp = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

async function check() {
  const response = await fetch(`${base}/v1/app/latest?currentVersion=${encodeURIComponent(currentVersion)}`);
  if (!response.ok) throw new Error(`update check failed (HTTP ${response.status})`);
  return response.json();
}

async function download(path, destination) {
  const response = await fetch(`${base}${path}`);
  if (!response.ok) throw new Error(`download failed (HTTP ${response.status}) for ${path}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  writeFileSync(destination, bytes);
  return bytes;
}

/** Install with the SDK's own host-side command; relays its output untouched. */
function install(packagePath) {
  const command = ['run-app', packagePath, APP_ID];
  if (device) command.push('--device', device);
  execFileSync('vega', command, { cwd: ROOT, stdio: 'inherit' });
}

async function update(check_) {
  const release = check_.latest;
  const asset = release?.assets?.find((candidate) => /\.(vpkg|apk)$/i.test(candidate.name));
  if (!asset) {
    console.warn(`${stamp()}  release ${release?.version ?? '?'} carries no installable package`);
    return;
  }

  mkdirSync(join(ROOT, 'dist'), { recursive: true });
  const packagePath = join(ROOT, 'dist', asset.name);
  console.log(`${stamp()}  downloading SNAS ${release.version} (${(asset.size / 1048576).toFixed(1)} MB)`);
  const bytes = await download(asset.path, packagePath);

  // The release carries version.json with the SHA-256; verify before touching the device.
  const checksumPath = join(ROOT, 'dist', 'version.json');
  const checksumAsset = release.assets.find((candidate) => candidate.name === 'version.json');
  let verified = false;
  if (checksumAsset) {
    try {
      const raw = await download(checksumAsset.path, checksumPath);
      const expected = JSON.parse(raw.toString('utf8'));
      const actual = createHash('sha256').update(bytes).digest('hex');
      if (expected.sha256 && expected.sha256 !== actual) {
        throw new Error(`SHA-256 mismatch: expected ${expected.sha256.slice(0, 16)}…, got ${actual.slice(0, 16)}…`);
      }
      verified = Boolean(expected.sha256);
    } catch (error) {
      console.error(`${stamp()}  ${error instanceof Error ? error.message : 'checksum step failed'}`);
      return;
    }
  }
  console.log(`${stamp()}  package ${packagePath} (${verified ? 'SHA-256 verified' : 'no checksum published'})`);

  if (dryRun) {
    console.log(`${stamp()}  dry run: skipping vega run-app`);
    return;
  }
  console.log(`${stamp()}  installing and launching ${APP_ID}`);
  install(packagePath);
  currentVersion = release.version;
  console.log(`${stamp()}  now running ${currentVersion}`);
}

console.log(`watching ${base} for builds newer than ${currentVersion}${dryRun ? ' (dry run)' : ''}`);

for (;;) {
  try {
    const check_ = await check();
    if (check_.updateAvailable && check_.latest) {
      await update(check_);
      if (once) break;
    } else if (once) {
      console.log(`${stamp()}  up to date${check_.latest ? ` (latest ${check_.latest.version})` : ' (no release published yet)'}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'update check failed';
    console.error(`${stamp()}  ${message}`);
    if (once) process.exitCode = 1;
  }
  if (once) break;
  await sleep(intervalSeconds * 1000);
}
