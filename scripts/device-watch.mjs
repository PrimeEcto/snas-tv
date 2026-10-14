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
 *   node scripts/device-watch.mjs --device <serial>   # a Vega device, or an adb serial for Fire TV
 *   node scripts/device-watch.mjs --once --device emulator-5556   # install the Fire TV APK
 *
 * It reads the backend from src/backend.json and the installed version from package.json,
 * downloads through the Worker (the repository is private, so the device never holds a
 * token), verifies the release's SHA-256, and then installs with the platform's own tool:
 * `adb install` for the Fire OS APK, `vega run-app` for the Vega package. Neither platform
 * lets an app replace itself, so this host-side half is what makes a pushed release reach a
 * device without anyone copying a package onto it by hand.
 */

/** Fire OS application id and launch activity; must match firetv/android/app/build.gradle. */
const FIRE_APP_ID = 'com.snas.tv';
const FIRE_ACTIVITY = `${FIRE_APP_ID}/.MainActivity`;
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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

/**
 * A device selector that is not the Vega device is an adb serial, which means Fire OS: the
 * package to install is the APK. The same value asks the backend for that kind of release, so a
 * release the device could never install is not offered in the first place.
 */
const fireTv = device !== '' && !device.includes('VirtualDevice');
const format = fireTv ? 'apk' : 'vpkg';

/**
 * `adb` is not on PATH in a plain shell on this machine, so the SDK's own copy is used when it
 * is there — the same default the device scripts use.
 */
function adbBinary() {
  const candidates = [process.env.ADB, join(process.env.ANDROID_HOME || '/opt/android-sdk', 'platform-tools', 'adb'), 'adb'];
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (candidate === 'adb' || existsSync(candidate)) return candidate;
  }
  return 'adb';
}

async function check() {
  const response = await fetch(
    `${base}/v1/app/latest?currentVersion=${encodeURIComponent(currentVersion)}&format=${format}`,
  );
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

/**
 * Install with the platform's own host-side command; relays its output untouched.
 *
 * The APK goes on over adb and is launched again straight away, so a Fire TV returns to the
 * app rather than to its home screen. `--device` is the adb serial in that case and the Vega
 * device selector otherwise.
 */
function install(packagePath) {
  if (/\.apk$/i.test(packagePath)) {
    const adb = adbBinary();
    const target = device ? ['-s', device] : [];
    execFileSync(adb, [...target, 'install', '-r', packagePath], { cwd: ROOT, stdio: 'inherit' });
    execFileSync(adb, [...target, 'shell', 'am', 'start', '-n', FIRE_ACTIVITY], { cwd: ROOT, stdio: 'inherit' });
    return;
  }
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
      // A release that carries both kinds keeps its digests in `artifacts`, one per file, so the
      // digest for the package actually being installed is the one to check — the top-level
      // `sha256` only describes the Vega package of a Vega-only release.
      const wanted =
        expected.artifacts?.find((artifact) => artifact?.name === asset.name)?.sha256 ??
        (expected.package === asset.name || expected.apk === asset.name ? expected.sha256 : undefined) ??
        (expected.artifacts?.length ? undefined : expected.sha256);
      if (wanted && wanted !== actual) {
        throw new Error(`SHA-256 mismatch: expected ${wanted.slice(0, 16)}…, got ${actual.slice(0, 16)}…`);
      }
      verified = Boolean(wanted);
    } catch (error) {
      console.error(`${stamp()}  ${error instanceof Error ? error.message : 'checksum step failed'}`);
      return;
    }
  }
  console.log(`${stamp()}  package ${packagePath} (${verified ? 'SHA-256 verified' : 'no checksum published'})`);

  if (dryRun) {
    console.log(`${stamp()}  dry run: skipping the install`);
    return;
  }
  console.log(`${stamp()}  installing and launching ${/\.apk$/i.test(asset.name) ? FIRE_APP_ID : APP_ID}`);
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
