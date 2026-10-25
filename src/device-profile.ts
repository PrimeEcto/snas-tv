/**
 * What a device says about itself, and what that means for playback.
 *
 * The decision this file makes is deliberately conservative, because the device it is aimed at
 * (AFTMM — 1st-gen Fire TV Stick 4K, Fire OS 6 / API 25, 32-bit, 1.5 GB) *declares* H.264 support
 * for renditions whose decoder output buffers it then fails to allocate. A declaration alone is
 * therefore not enough to trust: the app also weighs the memory the process actually has, whether
 * the process is 32-bit, and whether decoded bitmaps live in the Java heap on that platform.
 *
 * Everything here is pure so the policy can be tested against made-up devices; the platform half
 * lives in `src/device.ts` and the measurement half in the Android module it calls.
 */
import type {VideoPolicy} from './ladder';
import {CONSTRAINED_POLICY} from './ladder';

/** One decoder this device reports for a MIME type, as measured by `MediaCodecList`. */
export interface CodecCapability {
  mime: string;
  decoder?: string;
  /** `MediaCodecInfo.isHardwareAccelerated()`, or the name heuristic on older platforms. */
  hardware?: boolean;
  maxWidth?: number;
  maxHeight?: number;
  maxFrameRate?: number;
  /** Whether a decoder exists at all for this MIME type. */
  present: boolean;
}

/** What the platform could tell us. Every field is optional: none of it is guaranteed. */
export interface DeviceInfo {
  model?: string;
  brand?: string;
  manufacturer?: string;
  sdkInt?: number;
  release?: string;
  abis?: string[];
  primaryAbi?: string;
  /** True only when the platform confirmed a 64-bit process. */
  is64Bit?: boolean;
  memoryClassMb?: number;
  largeMemoryClassMb?: number;
  isLowRamDevice?: boolean;
  totalMemMb?: number;
  availMemMb?: number;
  maxHeapMb?: number;
  codecs?: CodecCapability[];
  /** True when the native probe answered; false when the policy is running on guesses. */
  probed: boolean;
}

/** The codec the app's ladder actually uses, which is the one worth asking about. */
export const AVC = 'video/avc';

/** The AVC decoder this device reports, if it reported any. */
export function avcCapability(info: DeviceInfo | null): CodecCapability | undefined {
  return info?.codecs?.find((codec) => codec.mime === AVC);
}

/**
 * The policy for this device.
 *
 * A device is treated as constrained when any of the following holds, which on the target stick is
 * all of them at once:
 *
 * - the process is 32-bit only, so the whole decoder, media buffers and bitmaps share a single
 *   32-bit address space;
 * - the system reports low-RAM, or less than 2 GB of RAM in total;
 * - `ActivityManager.getMemoryClass()` is small, which is the heap a decoded frame and the media
 *   buffer have to come out of;
 * - the platform is API 25 or older, where decoded bitmaps live in the Java heap rather than in
 *   native memory, so artwork competes with the decoder for the same space;
 * - the device's own AVC decoder reports a maximum frame narrower or shorter than the policy's.
 *
 * The AVC maximums are applied to *both* policies: a device that says it cannot decode 2584×1080
 * is believed about that even when it has memory to spare.
 */
export function policyForDevice(info: DeviceInfo | null): VideoPolicy {
  const base = constrainedReasons(info);
  const avc = avcCapability(info);
  const maxWidth = Math.min(base.width, avc?.maxWidth ?? base.width);
  const maxHeight = Math.min(base.height, avc?.maxHeight ?? base.height);
  const constrained = base.reasons.length > 0;
  return {
    kind: constrained ? 'constrained' : 'full',
    maxWidth,
    maxHeight,
    maxH264Level: constrained ? CONSTRAINED_POLICY.maxH264Level : 51,
    reason: constrained
      ? `constrained: ${base.reasons.join(', ')}`
      : `full: ${base.reasons.length === 0 ? 'no constraint reported' : base.reasons.join(', ')}`,
  };
}

function constrainedReasons(info: DeviceInfo | null): {
  width: number;
  height: number;
  reasons: string[];
} {
  // Nothing measured at all is the one case where the app keeps the safe defaults rather than
  // assuming a modern device: a player that starts too low is a disappointment, one that opens a
  // rendition the decoder cannot allocate is a session that ends.
  const reasons: string[] = [];
  if (!info || !info.probed) reasons.push('no device probe');
  if (!info) return {width: CONSTRAINED_POLICY.maxWidth, height: CONSTRAINED_POLICY.maxHeight, reasons};

  if (info.isLowRamDevice) reasons.push('system reports low RAM');
  if (typeof info.totalMemMb === 'number' && info.totalMemMb < 2048)
    reasons.push(`${info.totalMemMb} MB of RAM`);
  if (typeof info.memoryClassMb === 'number' && info.memoryClassMb < 192)
    reasons.push(`${info.memoryClassMb} MB heap class`);
  if (Array.isArray(info.abis) && info.abis.length > 0 && !info.abis.some(is64))
    reasons.push('32-bit process');
  if (typeof info.sdkInt === 'number' && info.sdkInt <= 25)
    reasons.push(`API ${info.sdkInt} (bitmaps in the Java heap)`);

  const ram = info.totalMemMb ?? 0;
  const constrained = reasons.length > 0;
  // A 4K panel is not evidence of a 4K decoder, but RAM is the closest honest proxy for the buffer
  // pool a tall rendition needs — so a device with room for it is allowed up to 4K, never beyond.
  return {
    width: constrained ? CONSTRAINED_POLICY.maxWidth : ram >= 3072 ? 3840 : 2560,
    height: constrained ? CONSTRAINED_POLICY.maxHeight : ram >= 3072 ? 2160 : 1600,
    reasons,
  };
}

const is64 = (abi: string): boolean => /64/.test(abi);

/** A one-line device summary for the playback log, with no identifiers beyond the model. */
export function deviceSummary(info: DeviceInfo | null): string {
  if (!info) return 'device: unknown';
  const parts = [
    info.model ?? 'model?',
    info.sdkInt !== undefined ? `API ${info.sdkInt}` : 'API?',
    info.primaryAbi ?? info.abis?.[0] ?? 'abi?',
    info.is64Bit === undefined ? 'bits?' : info.is64Bit ? '64-bit' : '32-bit',
    info.memoryClassMb !== undefined ? `${info.memoryClassMb} MB heap` : 'heap?',
    info.totalMemMb !== undefined ? `${info.totalMemMb} MB RAM` : 'RAM?',
    info.availMemMb !== undefined ? `${info.availMemMb} MB free` : 'free?',
  ];
  const avc = avcCapability(info);
  if (avc)
    parts.push(
      avc.present
        ? `${avc.decoder ?? 'avc'}${avc.maxWidth ? ` up to ${avc.maxWidth}x${avc.maxHeight}` : ''}`
        : 'no avc decoder reported',
    );
  return `device: ${parts.join(', ')}`;
}
