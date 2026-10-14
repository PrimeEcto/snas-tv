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
 *
 * The Fire OS (Fire TV) build ships as an APK and the Vega build as a `.vpkg`; a release
 * may carry either or both, so `findPackageAsset` picks the one this build can install.
 */
export type PackageFormat = 'apk' | 'vpkg';

/**
 * The package format of the running build.
 *
 * Set once by each entry point: the Fire OS umbrella (`firetv/index.js`) leaves the
 * default, and a Vega entry calls `setPackageFormat('vpkg')`. Tests flip it directly.
 */
export let packageFormat: PackageFormat = 'apk';

export function setPackageFormat(format: PackageFormat): void {
  packageFormat = format;
}
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

/**
 * The installable package inside a release, if it carries one.
 *
 * A release can hold an APK (Fire TV), one or more arch-specific `.vpkg` files (Vega),
 * a `version.json` and notes. Only the running build's own format counts: a Vega package
 * cannot be installed on Fire OS (or the reverse), so offering the other one would announce
 * an update the device could never apply. For a `.vpkg`, an arch-matching build wins.
 */
export function findPackageAsset(
  manifest: ReleaseManifest | null,
  options: {prefer?: PackageFormat; arch?: string} = {},
): ReleaseAsset | undefined {
  const installable = (manifest?.assets ?? []).filter(asset => /\.(vpkg|apk)$/i.test(asset.name));
  if (installable.length === 0) return undefined;

  const prefer = options.prefer ?? packageFormat;
  const preferred = installable.filter(asset => asset.name.toLowerCase().endsWith(`.${prefer}`));
  if (preferred.length === 0) return undefined;

  const arch = options.arch?.trim().toLowerCase();
  if (prefer === 'vpkg' && arch && preferred.length > 1) {
    const exact = preferred.find(asset => asset.name.toLowerCase().includes(`_${arch}.`));
    if (exact) return exact;
  }
  return preferred[0];
}

/**
 * One line a couch viewer can read, or undefined when there is nothing to say.
 *
 * "Nothing to say" includes a release this build cannot install. A Vega `.vpkg` cannot be
 * installed on Fire OS, so announcing it there would leave a banner the viewer can never act
 * on — a standing claim of an update that does not exist for their device.
 */
export function updateMessage(check: UpdateCheck): string | undefined {
  if (!check.updateAvailable || !check.latest) return undefined;
  const package_ = findPackageAsset(check.latest);
  if (!package_) return undefined;
  const size = ` · ${(package_.size / 1048576).toFixed(1)} MB`;
  const have = check.currentVersion ? ` · you have ${check.currentVersion}` : '';
  return `Update available: SNAS ${check.latest.version}${size}${have}`;
}

/**
 * Keep only well-formed fields, so a bad release payload cannot break the banner.
 *
 * The Worker is ours, but a manifest is still remote input: an asset without a name or
 * a size would otherwise reach `findPackageAsset` and produce `NaN MB` on screen.
 */
function normalizeManifest(value: unknown): ReleaseManifest | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<ReleaseManifest>;
  if (typeof raw.version !== 'string' || !raw.version.trim()) return null;

  const assets: ReleaseAsset[] = Array.isArray(raw.assets)
    ? raw.assets
        .filter((asset): asset is ReleaseAsset => Boolean(asset) && typeof asset.name === 'string' && asset.name.length > 0)
        .map(asset => ({
          name: asset.name,
          size: typeof asset.size === 'number' && Number.isFinite(asset.size) ? asset.size : 0,
          ...(typeof asset.contentType === 'string' ? {contentType: asset.contentType} : {}),
          path: typeof asset.path === 'string' ? asset.path : '',
        }))
    : [];

  return {
    version: raw.version.trim(),
    tag: typeof raw.tag === 'string' ? raw.tag : `v${raw.version.trim()}`,
    name: typeof raw.name === 'string' ? raw.name : `SNAS ${raw.version.trim()}`,
    publishedAt: typeof raw.publishedAt === 'string' ? raw.publishedAt : '',
    prerelease: raw.prerelease === true,
    notes: typeof raw.notes === 'string' ? raw.notes : '',
    assets,
  };
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
      latest: normalizeManifest(body.latest),
    };
  } catch {
    return none;
  } finally {
    clearTimeout(timer);
  }
}
