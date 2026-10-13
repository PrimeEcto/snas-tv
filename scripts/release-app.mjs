#!/usr/bin/env node
/**
 * Publish an app release that the Fire TV app can pick up on its next launch.
 *
 * The Vega SDK is local-only, so this runs on the developer machine rather than in CI:
 *
 *   node scripts/release-app.mjs                   # build, tag and release package.json's version
 *   node scripts/release-app.mjs --skip-build      # release the existing dist/snas_x86_64.vpkg
 *   node scripts/release-app.mjs --dry-run         # show what would happen
 *
 * The version comes from package.json, which is also what the app reports at runtime, so
 * the tag and the running build can never disagree.
 *
 * The release carries the package plus a `version.json` manifest with its SHA-256, and
 * the backend's /v1/app/latest endpoint serves it to the device from the private
 * repository (the device never holds a GitHub token).
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGE_PATH = join(ROOT, 'dist', 'snas_x86_64.vpkg');
const MANIFEST_PATH = join(ROOT, 'dist', 'version.json');
const PLATFORM = 'x86_64';

const args = process.argv.slice(2);
const requested = (args.find((arg) => !arg.startsWith('-')) ?? '').replace(/^v/, '');
const skipBuild = args.includes('--skip-build');
const dryRun = args.includes('--dry-run');

// package.json is the single source of truth: the app reports that version at runtime for
// its own update check (src/update.ts), so a tag that disagreed with it would make the
// device believe a build it is already running is still pending.
const declared = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
const version = requested || declared;

if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) {
  console.error('Usage: node scripts/release-app.mjs [version] [--skip-build] [--dry-run]');
  console.error(`package.json declares "${declared}"; bump it to change the version.`);
  process.exit(2);
}

if (requested && requested !== declared) {
  console.error(`Refusing to release ${requested}: package.json declares ${declared}.`);
  console.error('Bump the version in package.json (and rebuild) so the app reports what it runs.');
  process.exit(2);
}

const run = (command, commandArgs, options = {}) => {
  console.log(`$ ${command} ${commandArgs.join(' ')}`);
  if (dryRun) return '';
  return execFileSync(command, commandArgs, { cwd: ROOT, stdio: 'inherit', ...options });
};

const tag = `v${version}`;

// Never cut a release from a dirty tree: the tag must describe what actually shipped.
if (!dryRun) {
  const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' }).trim();
  if (dirty) {
    console.error('Refusing to release from a dirty working tree. Commit or stash changes first.');
    console.error(dirty.split('\n').slice(0, 10).join('\n'));
    process.exit(1);
  }
}

if (!skipBuild) run('npm', ['run', 'build:tv']);

if (!dryRun && !existsSync(PACKAGE_PATH)) {
  console.error(`Expected a built package at ${PACKAGE_PATH}. Run \`npm run build:tv\` first.`);
  process.exit(1);
}

// Hash the package so the device can verify what it downloaded.
let manifest = { version, tag, platform: PLATFORM, package: 'snas_x86_64.vpkg', size: 0, sha256: '' };
if (!dryRun) {
  const bytes = readFileSync(PACKAGE_PATH);
  manifest = {
    ...manifest,
    size: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    builtAt: new Date().toISOString(),
  };
  writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
}

console.log(`\nRelease ${tag}: ${manifest.size} bytes, sha256 ${manifest.sha256.slice(0, 16) || '(dry run)'}…`);

// `gh release create` creates and pushes the tag when it does not exist yet.
const notes = [
  `SNAS ${version} for the Vega ${PLATFORM} virtual device.`,
  '',
  `- Package: \`snas_x86_64.vpkg\` (${manifest.size} bytes)`,
  `- SHA-256: \`${manifest.sha256 || 'computed at release time'}\``,
  '',
  'The app checks `/v1/app/latest` on launch and offers this build when it is newer.',
].join('\n');

run('gh', [
  'release', 'create', tag,
  PACKAGE_PATH,
  MANIFEST_PATH,
  '--title', `SNAS ${version}`,
  '--notes', notes,
  '--latest',
]);

console.log(`\nPublished ${tag}. The app will see it through /v1/app/latest.`);
if (dryRun) console.log('(dry run: nothing was built, tagged or uploaded)');
