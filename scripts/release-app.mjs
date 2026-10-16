#!/usr/bin/env node
/**
 * Publish an app release that the Fire TV app can pick up on its next launch.
 *
 * Both build toolchains are local-only (the Vega SDK and the Android SDK), so this runs on
 * the developer machine rather than in CI:
 *
 *   node scripts/release-app.mjs                   # build, tag and release package.json's version
 *   node scripts/release-app.mjs --skip-build      # release what is already in dist/
 *   node scripts/release-app.mjs --apk-only        # Fire TV APK only, no Vega package
 *   node scripts/release-app.mjs --vpkg-only       # Vega virtual device package only
 *   node scripts/release-app.mjs --dry-run         # show what would happen
 *
 * The version comes from package.json, which is also what the app reports at runtime, so
 * the tag and the running build can never disagree.
 *
 * The release carries `snas-<version>.apk` (Fire OS / Fire TV) and/or `snas_<arch>.vpkg`
 * (Vega virtual device) plus a `version.json` manifest with their SHA-256 digests, and the
 * backend's /v1/app/latest endpoint serves them from the private repository: the device
 * never holds a GitHub token.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VPKG_PATH = join(ROOT, 'dist', 'snas_x86_64.vpkg');
const MANIFEST_PATH = join(ROOT, 'dist', 'version.json');
const APK_BUILD_SCRIPT = join(ROOT, 'firetv', 'scripts', 'build-apk.sh');
const PLATFORM = 'x86_64';
const REPOSITORY = 'PrimeEcto/snas-tv';
const head = execFileSync('git', ['rev-parse', 'HEAD'], {cwd: ROOT, encoding: 'utf8'}).trim();
const branch = execFileSync('git', ['branch', '--show-current'], {cwd: ROOT, encoding: 'utf8'}).trim();

const args = process.argv.slice(2);
const requested = (args.find((arg) => !arg.startsWith('-')) ?? '').replace(/^v/, '');
const skipBuild = args.includes('--skip-build');
const dryRun = args.includes('--dry-run');
const apkOnly = args.includes('--apk-only');
const vpkgOnly = args.includes('--vpkg-only');

if (apkOnly && vpkgOnly) {
  console.error('--apk-only and --vpkg-only cannot be combined.');
  process.exit(2);
}

// package.json is the single source of truth: the app reports that version at runtime for
// its own update check (src/update.ts), so a tag that disagreed with it would make the
// device believe a build it is already running is still pending.
const declared = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
const version = requested || declared;

if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) {
  console.error('Usage: node scripts/release-app.mjs [version] [--skip-build] [--dry-run] [--apk-only|--vpkg-only]');
  console.error(`package.json declares "${declared}"; bump it to change the version.`);
  process.exit(2);
}

if (requested && requested !== declared) {
  console.error(`Refusing to release ${requested}: package.json declares ${declared}.`);
  console.error('Bump the version in package.json (and rebuild) so the app reports what it runs.');
  process.exit(2);
}

// The Fire OS project carries its own version, which Android writes into the APK. If it
// disagrees, the APK would report a different version than the release tag claims.
const fireProject = join(ROOT, 'firetv', 'package.json');
if (existsSync(fireProject)) {
  const fireVersion = JSON.parse(readFileSync(fireProject, 'utf8')).version;
  if (fireVersion !== version) {
    console.error(`Refusing to release ${version}: firetv/package.json declares ${fireVersion}.`);
    console.error('Bump both versions together so the APK and the tag agree.');
    process.exit(2);
  }
}

const APK_NAME = `snas-${version}.apk`;
const APK_PATH = join(ROOT, 'dist', APK_NAME);
const wantApk = !vpkgOnly;
const wantVpkg = !apkOnly;

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

// A release tag must never silently reuse another commit or a pre-existing published release.
if (!dryRun) {
  run('gh', ['auth', 'status']);
  run('gh', ['repo', 'view', REPOSITORY, '--json', 'nameWithOwner']);
  for (const path of [`repos/${REPOSITORY}/releases/tags/${tag}`, `repos/${REPOSITORY}/git/ref/tags/${tag}`]) {
    const probe = spawnSync('gh', ['api', path, '--silent'], {cwd:ROOT, encoding:'utf8'});
    if (probe.status === 0) {
      console.error(`Refusing to overwrite existing ${tag}: ${path}. Inspect it before publishing.`);
      process.exit(1);
    }
    if (!/HTTP 404/.test(probe.stderr ?? '')) {
      console.error('Could not establish release/tag availability; nothing was published.');
      console.error(probe.stderr || probe.error?.message || 'GitHub request failed');
      process.exit(1);
    }
  }
  if (!branch) {
    console.error('Create a branch before publishing so the source commit can be pushed.');
    process.exit(1);
  }
}

if (wantApk && !skipBuild) {
  if (existsSync(APK_BUILD_SCRIPT)) {
    // Capped build: the Fire OS APK is produced outside this script's own means.
    run('bash', [join('firetv', 'scripts', 'build-apk.sh')]);
  } else if (!existsSync(APK_PATH)) {
    console.error(`Neither ${APK_BUILD_SCRIPT} nor ${APK_PATH} exists.`);
    console.error('Build the Fire TV APK first, or pass --vpkg-only for a Vega-only release.');
    process.exit(1);
  }
}
if (wantVpkg && !skipBuild) run('npm', ['run', 'build:tv']);

/** Size and digest of one artifact, so the device can verify what it downloaded. */
const describe = (path) => {
  if (dryRun) return { size: 0, sha256: '' };
  const bytes = readFileSync(path);
  return { size: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') };
};

const artifacts = [];
const uploads = [];

if (wantApk) {
  if (!dryRun && !existsSync(APK_PATH)) {
    console.error(`Expected the Fire TV package at ${APK_PATH}.`);
    process.exit(1);
  }
  const info = describe(APK_PATH);
  artifacts.push({ name: APK_NAME, kind: 'apk', target: 'fire-tv', ...info });
  uploads.push(APK_PATH);
}

if (wantVpkg) {
  if (!dryRun && !existsSync(VPKG_PATH)) {
    console.error(`Expected a built package at ${VPKG_PATH}. Run \`npm run build:tv\` first.`);
    process.exit(1);
  }
  const info = describe(VPKG_PATH);
  artifacts.push({ name: 'snas_x86_64.vpkg', kind: 'vpkg', target: `vega-${PLATFORM}`, ...info });
  uploads.push(VPKG_PATH);
}

if (artifacts.length === 0) {
  console.error('Nothing to release: no artifact was selected.');
  process.exit(1);
}

// Keep the original top-level keys when a Vega package is present, so the host-side
// installer (scripts/device-watch.mjs) keeps reading the same manifest it always has.
const manifest = {
  version,
  tag,
  commit: head,
  ...(wantVpkg
    ? { platform: PLATFORM, package: 'snas_x86_64.vpkg', size: artifacts.find((a) => a.kind === 'vpkg')?.size ?? 0, sha256: artifacts.find((a) => a.kind === 'vpkg')?.sha256 ?? '' }
    : {}),
  apk: wantApk ? APK_NAME : undefined,
  artifacts,
  ...(dryRun ? {} : { builtAt: new Date().toISOString() }),
};
if (manifest.apk === undefined) delete manifest.apk;

if (!dryRun) writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
uploads.push(MANIFEST_PATH);

for (const artifact of artifacts) {
  console.log(`\n${artifact.name}: ${artifact.size} bytes, sha256 ${artifact.sha256.slice(0, 16) || '(dry run)'}…`);
}

const notes = [
  wantApk ? `SNAS ${version} for Fire TV (Fire OS, Android) — install \`${APK_NAME}\` with \`adb install -r\`.` : null,
  wantVpkg ? `SNAS ${version} for the Vega ${PLATFORM} virtual device — \`snas_x86_64.vpkg\`.` : null,
  '',
  ...artifacts.map((artifact) => `- \`${artifact.name}\` (${artifact.size} bytes) · SHA-256 \`${artifact.sha256 || 'computed at release time'}\``),
  '',
  'The app checks `/v1/app/latest` on launch and offers this build when it is newer.',
]
  .filter((line) => line !== null)
  .join('\n');

const releaseBody = join(ROOT, 'docs', `RELEASE_${version}.md`);
const notesPath = join(ROOT, 'dist', 'release-notes.md');
if (!dryRun) writeFileSync(notesPath, `${existsSync(releaseBody) ? readFileSync(releaseBody, 'utf8') : ''}\n${notes}\n`);
if (!dryRun) {
  const sumsPath = join(ROOT, 'dist', 'SHA256SUMS.txt');
  writeFileSync(sumsPath, artifacts.map(artifact => `${artifact.sha256}  ${artifact.name}`).join('\n') + '\n');
  uploads.push(sumsPath);
}
// Push only this source branch, then bind the new tag to its exact commit.
run('git', ['push', 'origin', `HEAD:refs/heads/${branch}`]);
run('gh', [
  'release', 'create', tag,
  ...uploads,
  '--repo', REPOSITORY,
  '--target', head,
  '--title', `SNAS TV ${version}`,
  '--notes-file', notesPath,
  '--latest',
]);

console.log(`\nPublished ${tag}. The app will see it through /v1/app/latest.`);
if (dryRun) console.log('(dry run: nothing was built, tagged or uploaded)');
