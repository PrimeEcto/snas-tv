import test from 'node:test';
import assert from 'node:assert/strict';
import {policyForDevice, deviceSummary, type DeviceInfo} from '../src/device-profile.ts';
import {CONSTRAINED_POLICY} from '../src/ladder.ts';

/** A 1st-gen Fire TV Stick 4K as its own platform describes it: 32-bit, 1.5 GB, Fire OS 6. */
const stick4k: DeviceInfo = {
  probed: true,
  model: 'AFTMM',
  manufacturer: 'Amazon',
  sdkInt: 25,
  release: '7.1.2',
  abis: ['armeabi-v7a', 'armeabi'],
  primaryAbi: 'armeabi-v7a',
  is64Bit: false,
  memoryClassMb: 192,
  largeMemoryClassMb: 512,
  isLowRamDevice: false,
  totalMemMb: 1536,
  availMemMb: 640,
  codecs: [
    {mime: 'video/avc', present: true, decoder: 'OMX.MTK.VIDEO.DECODER.AVC', hardware: true, maxWidth: 1920, maxHeight: 1088, maxFrameRate: 30},
  ],
};

/** A newer Fire TV: more RAM, a 64-bit process, a smaller heap class. */
const modernFireTv: DeviceInfo = {
  probed: true,
  model: 'AFTKA',
  sdkInt: 28,
  abis: ['arm64-v8a', 'armeabi-v7a'],
  primaryAbi: 'arm64-v8a',
  is64Bit: true,
  memoryClassMb: 256,
  isLowRamDevice: false,
  totalMemMb: 2048,
  codecs: [{mime: 'video/avc', present: true, decoder: 'c2.mtk.avc.decoder', hardware: true, maxWidth: 1920, maxHeight: 1088}],
};

test('the first-generation Fire TV Stick 4K is held to a 1080p-class policy', () => {
  const policy = policyForDevice(stick4k);
  assert.equal(policy.kind, 'constrained');
  assert.equal(policy.maxH264Level, 41);
  assert.equal(policy.maxWidth, 1920);
  // The reasons are the evidence the app logs: each one is a real property of that device.
  assert.match(policy.reason, /32-bit process/);
  assert.match(policy.reason, /1536 MB of RAM/);
  assert.match(policy.reason, /API 25/);
});

test('a device that has said nothing is treated as constrained rather than capable', () => {
  assert.equal(policyForDevice(null).kind, 'constrained');
  assert.deepEqual(policyForDevice(null), CONSTRAINED_POLICY);
  const unprobed: DeviceInfo = {probed: false, model: 'AFTMM', sdkInt: 25};
  assert.equal(policyForDevice(unprobed).kind, 'constrained');
  assert.match(policyForDevice(unprobed).reason, /no device probe/);
});

test('a newer, roomier device is not constrained, and its own H.264 limit still applies', () => {
  const policy = policyForDevice(modernFireTv);
  assert.equal(policy.kind, 'full');
  // 2 GB is not 4K headroom, and the device's own decoder says 1920×1088: both are honoured.
  assert.equal(policy.maxWidth, 1920);
  assert.equal(policy.maxH264Level, 51);
});

test('a decoder that reports no H.264 at all does not become a licence to try anyway', () => {
  const policy = policyForDevice({...stick4k, codecs: [{mime: 'video/avc', present: false}]});
  assert.equal(policy.kind, 'constrained');
  assert.equal(policy.maxWidth, CONSTRAINED_POLICY.maxWidth);
});

test('the device summary names the facts a report needs and nothing private', () => {
  const summary = deviceSummary(stick4k);
  assert.match(summary, /AFTMM/);
  assert.match(summary, /API 25/);
  assert.match(summary, /armeabi-v7a/);
  assert.match(summary, /32-bit/);
  assert.match(summary, /192 MB heap/);
  assert.match(summary, /1536 MB RAM/);
  assert.match(summary, /up to 1920x1088/);
  assert.equal(deviceSummary(null), 'device: unknown');
});
