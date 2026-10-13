/**
 * On-launch update check.
 *
 * The app cannot replace its own package: on Vega OS a build is installed from the host
 * with `vega run-app` (there is no self-update API, and this is not an Appstore build).
 * What the app *can* do is notice that a newer release exists and say so, which is why
 * this module only ever reports. `scripts/device-watch.mjs` is the half that installs:
 * it polls the same endpoint from the development machine and pushes the build.
 *
 * Nothing here may throw into the UI: a device with no network, or a backend that is
 * down, must launch exactly as it does today.
 */
export interface ReleaseAsset {
  name: string;
  size: number;
  contentType?: string;
  /** Worker-proxied path, so the device never needs a GitHub token for a private repo. */
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

type Fetcher = (url: string, options?: {headers?: Record<string, string>; signal?: AbortSignal}) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

/** "v1.2.3" / "1.2.3-beta.1" -> [1, 2, 3] with a prerelease marker. */
export function parseVersion(value: string): {parts: number[]; prerelease: string} {
  const cleaned = value.trim().replace(/^v/i, '');
  const [core, ...rest] = cleaned.split('-');
  const parts = core.split('.').map(piece => {
    const parsed = Number.parseInt(piece, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  });
  return {parts, prerelease: rest.join('-')};
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

/** The installable package inside a release, if it carries one. */
export function findPackageAsset(manifest: ReleaseManifest | null): ReleaseAsset | undefined {
  return manifest?.assets.find(asset => /\.(vpkg|apk)$/i.test(asset.name));
}

/** One line a couch viewer can read, or undefined when there is nothing to say. */
export function updateMessage(check: UpdateCheck): string | undefined {
  if (!check.updateAvailable || !check.latest) return undefined;
  const package_ = findPackageAsset(check.latest);
  const size = package_ ? ` · ${(package_.size / 1048576).toFixed(1)} MB` : '';
  const have = check.currentVersion ? ` · you have ${check.currentVersion}` : '';
  return `Update available: SNAS ${check.latest.version}${size}${have}`;
}

/**
 * Ask the backend whether a newer release exists.
 *
 * An unconfigured backend, a timeout, a malformed reply or an HTTP error all resolve to
 * "no update known", because none of them is a reason to disturb someone's evening.
 */
export async function checkForUpdate(
  workerBase: string,
  currentVersion: string,
  options: {fetchImpl?: Fetcher; timeoutMs?: number} = {},
): Promise<UpdateCheck> {
  const base = workerBase.trim().replace(/\/+$/, '');
  const none: UpdateCheck = {updateAvailable: false, currentVersion, latest: null};
  if (!base || !currentVersion.trim()) return none;

  const fetchImpl = options.fetchImpl ?? (fetch as unknown as Fetcher);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 8000);
  try {
    const response = await fetchImpl(
      `${base}/v1/app/latest?currentVersion=${encodeURIComponent(currentVersion.trim())}`,
      {headers: {Accept: 'application/json'}, signal: controller.signal},
    );
    if (!response.ok) return none;
    const body = (await response.json()) as Partial<UpdateCheck>;
    if (typeof body?.updateAvailable !== 'boolean') return none;
    return {
      updateAvailable: body.updateAvailable,
      currentVersion: typeof body.currentVersion === 'string' ? body.currentVersion : currentVersion,
      latest: (body.latest as ReleaseManifest | null) ?? null,
    };
  } catch {
    return none;
  } finally {
    clearTimeout(timer);
  }
}
