/**
 * GitHub Releases proxy for the Fire TV app's on-launch update check.
 *
 * The repository is private, so the device cannot read releases itself and must not
 * carry a GitHub token. This Worker holds a fine-grained read-only token and exposes
 * only what the updater needs: the latest release manifest and the release assets,
 * streamed through so the token never leaves the server.
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
        path: `/v1/app/asset/${encodeURIComponent(asset.name)}`,
      })),
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
  const repo = env.GITHUB_REPO?.trim();
  if (!repo) return null;
  const fetchImpl = options.fetchImpl ?? fetch;
  const channel = options.channel ?? 'stable';

  const response = await fetchImpl(`${GITHUB_API}/repos/${repo}/releases?per_page=20`, {
    headers: githubHeaders(env),
    signal: AbortSignal.timeout(options.timeoutMs ?? 8000),
  });
  if (!response.ok) {
    throw new Error(`github releases request failed (HTTP ${response.status})`);
  }
  const releases = (await response.json()) as GithubRelease[];
  if (!Array.isArray(releases)) return null;

  const usable = releases.filter(
    (release) => !release.draft && (channel === 'beta' || !release.prerelease),
  );
  if (usable.length === 0) return null;
  // Most recently published first; GitHub's list endpoint is newest-first already.
  usable.sort((a, b) => (b.published_at ?? '').localeCompare(a.published_at ?? ''));
  return toManifest(usable[0]);
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

/** Resolve and stream one release asset, so the device never sees the token. */
export async function downloadReleaseAsset(
  env: ReleaseEnv,
  assetName: string,
  options: { channel?: 'stable' | 'beta'; fetchImpl?: FetchLike; timeoutMs?: number } = {},
): Promise<Response> {
  const repo = env.GITHUB_REPO?.trim();
  if (!repo) throw new Error('github repository is not configured');
  const fetchImpl = options.fetchImpl ?? fetch;
  const release = await fetchLatestRelease(env, options);
  const asset = release?.assets.find((candidate) => candidate.name === assetName);
  if (!release || !asset) {
    return new Response(JSON.stringify({ error: 'asset not found' }), {
      status: 404,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  }

  // The manifest only carries a proxied path, so ask GitHub for the asset directly.
  const listResponse = await fetchImpl(`${GITHUB_API}/repos/${repo}/releases?per_page=20`, {
    headers: githubHeaders(env),
    signal: AbortSignal.timeout(options.timeoutMs ?? 8000),
  });
  if (!listResponse.ok) {
    return new Response(JSON.stringify({ error: 'github releases unavailable' }), {
      status: 502,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  }
  const releases = (await listResponse.json()) as (GithubRelease & { assets?: GithubAsset[] })[];
  const target = (Array.isArray(releases) ? releases : [])
    .flatMap((entry) => entry.assets ?? [])
    .find((candidate) => candidate.name === assetName && candidate.url);
  if (!target?.url) {
    return new Response(JSON.stringify({ error: 'asset not found' }), {
      status: 404,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  }

  const download = await fetchImpl(target.url, {
    headers: { ...githubHeaders(env), accept: 'application/octet-stream' },
    signal: AbortSignal.timeout(options.timeoutMs ?? 60000),
  });
  if (!download.ok || !download.body) {
    return new Response(JSON.stringify({ error: `asset download failed (HTTP ${download.status})` }), {
      status: 502,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  }

  const headers = new Headers();
  headers.set('content-type', target.content_type ?? 'application/octet-stream');
  headers.set('content-length', `${target.size ?? download.headers.get('content-length') ?? ''}`);
  headers.set('cache-control', 'private, max-age=300');
  headers.set('content-disposition', `attachment; filename="${assetName.replace(/[^\w.-]/g, '_')}"`);
  return new Response(download.body, { status: 200, headers });
}
