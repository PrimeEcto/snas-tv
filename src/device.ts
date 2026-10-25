/**
 * The platform half of the device profile, and the playback log the device can be diagnosed with.
 *
 * `src/device-profile.ts` holds the decision; this file holds the measurement. On the Fire OS build
 * the numbers come from the app's own native module (`SnasDeviceModule.kt`), which reads
 * `ActivityManager`, `Build` and `MediaCodecList`. That is the half React Native does not expose:
 * `Platform.constants` knows the model and the API level, and nothing at all about the memory class,
 * the process bit width, or what the device's AVC decoder will actually accept.
 *
 * Both halves are optional on purpose. Where the native module is absent (the Vega build, the test
 * harness) the profile degrades to what `Platform` can say, and the policy stays on its safe
 * defaults rather than pretending the device is capable.
 */
import {NativeModules, Platform} from 'react-native';
import {CONSTRAINED_POLICY, type VideoPolicy} from './ladder';
import {policyForDevice, type DeviceInfo} from './device-profile';

/** How long the native probe may take before playback stops waiting for it. */
const PROBE_TIMEOUT_MS = 1500;

type NativeProbe = {info?: () => Promise<unknown>; log?: (level: string, message: string) => void};

function probe(): NativeProbe | undefined {
  // Guarded every way round: a missing module, a module without the method, or a mocked
  // `react-native` in a test must all mean "no measurement", never a crash on launch.
  try {
    const modules = NativeModules as unknown as Record<string, NativeProbe> | undefined;
    return modules?.SnasDevice;
  } catch {
    return undefined;
  }
}

/** What `Platform` knows, which needs no native call and no wait. */
function platformSnapshot(): DeviceInfo {
  const constants =
    (Platform as unknown as {constants?: Record<string, unknown>} | undefined)?.constants ?? {};
  const sdkInt = Number(constants.Version);
  return {
    ...(typeof constants.Model === 'string' ? {model: constants.Model} : {}),
    ...(typeof constants.Brand === 'string' ? {brand: constants.Brand} : {}),
    ...(typeof constants.Manufacturer === 'string' ? {manufacturer: constants.Manufacturer} : {}),
    ...(Number.isFinite(sdkInt) ? {sdkInt} : {}),
    ...(typeof constants.Release === 'string' ? {release: constants.Release} : {}),
    probed: false,
  };
}

let measured: DeviceInfo | null = null;
let pending: Promise<DeviceInfo> | null = null;

function coerce(value: unknown): DeviceInfo {
  if (!value || typeof value !== 'object') return {...platformSnapshot()};
  const raw = value as Record<string, unknown>;
  const number = (key: string) =>
    typeof raw[key] === 'number' && Number.isFinite(raw[key]) ? (raw[key] as number) : undefined;
  const text = (key: string) =>
    typeof raw[key] === 'string' && raw[key] ? (raw[key] as string) : undefined;
  const codecs = Array.isArray(raw.codecs)
    ? (raw.codecs as unknown[])
        .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object')
        .map((entry) => ({
          mime: typeof entry.mime === 'string' ? entry.mime : '',
          ...(typeof entry.decoder === 'string' ? {decoder: entry.decoder} : {}),
          ...(typeof entry.hardware === 'boolean' ? {hardware: entry.hardware} : {}),
          ...(typeof entry.maxWidth === 'number' ? {maxWidth: entry.maxWidth} : {}),
          ...(typeof entry.maxHeight === 'number' ? {maxHeight: entry.maxHeight} : {}),
          ...(typeof entry.maxFrameRate === 'number' ? {maxFrameRate: entry.maxFrameRate} : {}),
          present: entry.present === true,
        }))
    : undefined;
  return {
    ...platformSnapshot(),
    ...(text('model') ? {model: text('model')} : {}),
    ...(text('brand') ? {brand: text('brand')} : {}),
    ...(text('manufacturer') ? {manufacturer: text('manufacturer')} : {}),
    ...(number('sdkInt') !== undefined ? {sdkInt: number('sdkInt')} : {}),
    ...(text('release') ? {release: text('release')} : {}),
    ...(Array.isArray(raw.abis) ? {abis: (raw.abis as unknown[]).filter((abi): abi is string => typeof abi === 'string')} : {}),
    ...(text('primaryAbi') ? {primaryAbi: text('primaryAbi')} : {}),
    ...(typeof raw.is64Bit === 'boolean' ? {is64Bit: raw.is64Bit} : {}),
    ...(number('memoryClassMb') !== undefined ? {memoryClassMb: number('memoryClassMb')} : {}),
    ...(number('largeMemoryClassMb') !== undefined ? {largeMemoryClassMb: number('largeMemoryClassMb')} : {}),
    ...(typeof raw.isLowRamDevice === 'boolean' ? {isLowRamDevice: raw.isLowRamDevice} : {}),
    ...(number('totalMemMb') !== undefined ? {totalMemMb: number('totalMemMb')} : {}),
    ...(number('availMemMb') !== undefined ? {availMemMb: number('availMemMb')} : {}),
    ...(number('maxHeapMb') !== undefined ? {maxHeapMb: number('maxHeapMb')} : {}),
    ...(codecs ? {codecs} : {}),
    probed: true,
  };
}

/**
 * Read the device once, and remember it.
 *
 * Never rejects and never waits longer than `PROBE_TIMEOUT_MS`: a device whose probe hangs must
 * still start playback, on the safe policy.
 */
export function deviceInfo(): Promise<DeviceInfo> {
  if (measured) return Promise.resolve(measured);
  if (pending) return pending;
  const module = probe();
  const info = typeof module?.info === 'function' ? module.info : undefined;
  if (!info) {
    measured = {...platformSnapshot()};
    return Promise.resolve(measured);
  }
  pending = new Promise<DeviceInfo>((resolve) => {
    let settled = false;
    const finish = (value: DeviceInfo) => {
      if (settled) return;
      settled = true;
      measured = value;
      resolve(value);
    };
    const timer = setTimeout(() => finish({...platformSnapshot()}), PROBE_TIMEOUT_MS);
    try {
      info
        .call(module)
        .then((value) => {
          clearTimeout(timer);
          finish(coerce(value));
        })
        .catch(() => {
          clearTimeout(timer);
          finish({...platformSnapshot()});
        });
    } catch {
      clearTimeout(timer);
      finish({...platformSnapshot()});
    }
  }).then((value) => value);
  return pending;
}

/** The device already read, or the safe defaults when nothing has been read yet. */
export function deviceInfoSync(): DeviceInfo {
  return measured ?? {...platformSnapshot()};
}

/** The policy for the device that has been read, or the conservative one until it has been. */
export function videoPolicy(): VideoPolicy {
  if (!measured || !measured.probed) return CONSTRAINED_POLICY;
  return policyForDevice(measured);
}

/**
 * One line into the device's own log, tagged `SNAS`, so a viewer's report can be read from logcat
 * with `adb logcat -s SNAS` without a debugger attached. Never throws, never blocks the player.
 */
export function playbackLog(event: string, detail: Record<string, unknown> = {}): void {
  const line = [event, ...Object.entries(detail).map(([key, value]) => `${key}=${format(value)}`)]
    .join(' ')
    .slice(0, 900);
  const logger = probe()?.log;
  try {
    if (typeof logger === 'function') logger.call(probe(), 'info', line);
  } catch {
    // A log line is never worth a failed playback.
  }
}

function format(value: unknown): string {
  if (value === null || value === undefined) return '-';
  if (typeof value === 'string') return redact(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value).slice(0, 400);
  } catch {
    return 'unprintable';
  }
}

/**
 * A URL as it may appear in a log: host and file name, with query strings and path tokens dropped.
 *
 * Stream URLs in this app carry a CDN path token, and a signed URL would carry its signature in the
 * query; neither belongs in a log the viewer may paste somewhere.
 */
export function redact(value: string): string {
  // Parsed by hand rather than with `URL`: React Native's URL implementation is partial, and a
  // redactor that throws on the URL it is meant to protect is worse than none.
  const match = /^https?:\/\/([^/?#]+)\/([^?#]*)/i.exec(value);
  if (!match) return value;
  const parts = match[2].split('/').filter(Boolean);
  const last = parts[parts.length - 1] ?? '';
  return `${match[1]}/…/${last}`;
}
