/**
 * GitHub Releases proxy for the Fire TV app's on-launch update check.
 *
 * The repository is private, so the device cannot read releases itself and must not
 * carry a GitHub token. This Worker holds a fine-grained read-only token and exposes
 * only what the updater needs: the latest release manifest and the release assets,
 * streamed through so the token never leaves the server.
 *
 * A release carries the Fire TV app as `snas-<version>.apk` and/or the Vega virtual
 * device package as `snas_<arch>.vpkg`; the manifest lists both, with the APK first so
 * a client that prefers it does not have to reorder anything.
 */
import type { FetchLike } from './movy.ts';

export interface ReleaseEnv {
  /** Fine-grained PAT with Contents: read on the private repository. */
  GITHUB_TOKEN?: string;
  /** "owner/name" of the private repository. */
  GITHUB_REPO?: string;
}

export interface ReleaseAsset {
  name: string;
  size: number;
  contentType?: string;
  /** Worker-proxied download path the device can fetch without a token. */
  path: string;
}

export interface ReleaseManifest {
  version: string;
  tag: string;
  name: string;
  publishedAt: string;
  prerelease: boolean;
  notes: string;
  assets: ReleaseAsset[];
}

export interface UpdateCheck {
  updateAvailable: boolean;
  currentVersion?: string;
  latest: ReleaseManifest | null;
}

interface GithubAsset {
  name?: string;
  size?: number;
  content_type?: string;
  url?: string;
}

interface GithubRelease {
  tag_name?: string;
  name?: string;
  published_at?: string;
  prerelease?: boolean;
  draft?: boolean;
  body?: string;
  assets?: GithubAsset[];
}

const GITHUB_API = 'https://api.github.com';

/** "v1.2.3" / "1.2.3-beta.1" -> [1, 2, 3] with a prerelease marker. */
export function parseVersion(value: string): { parts: number[]; prerelease: string } {
  const cleaned = value.trim().replace(/^v/i, '');
  const [core, ...rest] = cleaned.split('-');
  const parts = core.split('.').map((piece) => {
    const parsed = Number.parseInt(piece, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  });
  return { parts, prerelease: rest.join('-') };
}

/** Negative when `a` is older than `b`, 0 when equal, positive when newer. */
export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a);
  const right = parseVersion(b);
  for (let index = 0; index < Math.max(left.parts.length, right.parts.length); index += 1) {
    const difference = (left.parts[index] ?? 0) - (right.parts[index] ?? 0);
    if (difference !== 0) return difference;
  }
  // A release outranks its own prerelease ("1.0.0" > "1.0.0-rc.1").
  if (left.prerelease && !right.prerelease) return -1;
  if (!left.prerelease && right.prerelease) return 1;
  return left.prerelease.localeCompare(right.prerelease);
}

function githubHeaders(env: ReleaseEnv): Record<string, string> {
  return {
    // GitHub rejects requests without a User-Agent.
    'user-agent': 'snas-movy-worker',
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    ...(env.GITHUB_TOKEN ? { authorization: `Bearer ${env.GITHUB_TOKEN.trim()}` } : {}),
  };
}

/** Installable packages come before manifests and notes, APK before Vega packages. */
function assetRank(name: string): number {
  const lower = name.toLowerCase();
  if (lower.endsWith('.apk')) return 0;
  if (lower.endsWith('.vpkg')) return 1;
  if (lower === 'version.json') return 2;
  return 3;
}

/** Convert a raw GitHub release into the manifest shape the device consumes. */
export function toManifest(release: GithubRelease): ReleaseManifest {
  const tag = release.tag_name ?? '';
  return {
    version: tag.replace(/^v/i, ''),
    tag,
    name: release.name ?? tag,
    publishedAt: release.published_at ?? '',
    prerelease: release.prerelease === true,
    notes: release.body ?? '',
    assets: (release.assets ?? [])
      .filter((asset): asset is GithubAsset & { name: string } => Boolean(asset?.name))
      .map((asset) => ({
        name: asset.name,
        size: asset.size ?? 0,
        ...(asset.content_type ? { contentType: asset.content_type } : {}),
        // Proxied, so the manifest never carries a GitHub URL or the token.
        path: `/v1/app/asset/${encodeURIComponent(asset.name)}`,
      }))
      .sort((a, b) => assetRank(a.name) - assetRank(b.name) || a.name.localeCompare(b.name)),
  };
}

/**
 * Latest release for the repository. `channel: 'beta'` accepts prereleases;
 * the default `stable` channel skips them.
 */
export async function fetchLatestRelease(
  env: ReleaseEnv,
  options: { channel?: 'stable' | 'beta'; fetchImpl?: FetchLike; timeoutMs?: number } = {},
): Promise<ReleaseManifest | null> {
  const releases = await fetchReleaseList(env, options);
  const latest = selectRelease(releases, options.channel ?? 'stable');
  return latest ? toManifest(latest) : null;
}

/** The raw release list, one request, shared by the manifest and the asset download. */
async function fetchReleaseList(
  env: ReleaseEnv,
  options: { fetchImpl?: FetchLike; timeoutMs?: number } = {},
): Promise<GithubRelease[]> {
  const repo = env.GITHUB_REPO?.trim();
  if (!repo) return [];
  const fetchImpl = options.fetchImpl ?? fetch;

  const response = await fetchImpl(`${GITHUB_API}/repos/${repo}/releases?per_page=20`, {
    headers: githubHeaders(env),
    signal: AbortSignal.timeout(options.timeoutMs ?? 8000),
  });
  if (!response.ok) {
    throw new Error(`github releases request failed (HTTP ${response.status})`);
  }
  const releases = (await response.json()) as GithubRelease[];
  return Array.isArray(releases) ? releases : [];
}

/** Newest published release, honouring the channel; drafts are never eligible. */
function selectRelease(
  releases: GithubRelease[],
  channel: 'stable' | 'beta',
): GithubRelease | null {
  const usable = releases.filter(
    (release) => !release.draft && !release.tag_name?.startsWith('untagged-') && (channel === 'beta' || !release.prerelease),
  );
  if (usable.length === 0) return null;
  // Most recently published first; GitHub's list endpoint is newest-first already.
  usable.sort((a, b) => (b.published_at ?? '').localeCompare(a.published_at ?? ''));
  return usable[0];
}

/** Compare the device's build against the latest release. */
export function checkForUpdate(manifest: ReleaseManifest | null, currentVersion?: string): UpdateCheck {
  if (!manifest) return { updateAvailable: false, ...(currentVersion ? { currentVersion } : {}), latest: null };
  const updateAvailable = currentVersion
    ? compareVersions(currentVersion, manifest.version) < 0
    : false;
  return {
    updateAvailable,
    ...(currentVersion ? { currentVersion } : {}),
    latest: manifest,
  };
}

/**
 * The bytes a viewer downloads should carry a truthful type. GitHub reports a generic
 * octet-stream for some uploads, and an APK served as octet-stream is treated as an opaque blob
 * by the system installer, so the extension decides whenever the reported type says nothing.
 */
function assetContentType(reported: string | null | undefined, name: string): string {
  const cleaned = (reported ?? '').trim().toLowerCase();
  if (cleaned && cleaned !== 'application/octet-stream') return cleaned;
  if (/\.apk$/i.test(name)) return 'application/vnd.android.package-archive';
  if (/\.json$/i.test(name)) return 'application/json; charset=utf-8';
  return 'application/octet-stream';
}

/**
 * Resolve and stream one release asset, so the device never sees the token.
 *
 * One release-list request is enough: the asset's own API URL is used for the download
 * with `Accept: application/octet-stream`, which GitHub answers with the bytes.
 */
export async function downloadReleaseAsset(
  env: ReleaseEnv,
  assetName: string,
  options: { channel?: 'stable' | 'beta'; fetchImpl?: FetchLike; timeoutMs?: number } = {},
): Promise<Response> {
  const jsonError = (status: number, error: string) =>
    new Response(JSON.stringify({ error }), {
      status,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });

  if (!env.GITHUB_REPO?.trim()) return jsonError(404, 'asset not found');

  const fetchImpl = options.fetchImpl ?? fetch;
  let releases: GithubRelease[];
  try {
    releases = await fetchReleaseList(env, options);
  } catch {
    return jsonError(502, 'github releases unavailable');
  }

  const release = selectRelease(releases, options.channel ?? 'stable');
  const asset = release?.assets?.find(
    (candidate): candidate is GithubAsset & { url: string } =>
      candidate?.name === assetName && Boolean(candidate.url),
  );
  if (!asset) return jsonError(404, 'asset not found');

  const download = await fetchImpl(asset.url, {
    headers: { ...githubHeaders(env), accept: 'application/octet-stream' },
    signal: AbortSignal.timeout(options.timeoutMs ?? 60000),
  });
  if (!download.ok || !download.body) {
    return jsonError(502, `asset download failed (HTTP ${download.status})`);
  }

  const headers = new Headers();
  headers.set('content-type', assetContentType(asset.content_type, assetName));
  const length = asset.size ?? Number(download.headers.get('content-length'));
  if (Number.isFinite(length) && length > 0) headers.set('content-length', `${length}`);
  headers.set('cache-control', 'private, max-age=300');
  headers.set('content-disposition', `attachment; filename="${assetName.replace(/[^\w.-]/g, '_')}"`);
  return new Response(download.body, { status: 200, headers });
}
