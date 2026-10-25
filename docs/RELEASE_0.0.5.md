# SNAS TV 0.0.5

Playback on a 1st-generation Fire TV Stick 4K, and the app's ability to be diagnosed on one. The
0.0.4 build reacted to a decoder that refused a rendition; this build stops the app from asking for
one it cannot decode in the first place, bounds the memory a constrained device hands the player, and
remembers a rendition whose opening took the process down.

## What changed

- **The opening rendition is chosen from what the stream really contains.** Across five titles
  measured on 2026-10-16, the backend's `1080p` label was 1920×1080 H.264 High Level 4.0 on four of
  them and 2584×1080 High Level 5.0 on the fifth, and `2160p` was High Level 5.1 every time. The app
  now reads the master playlist it already receives, judges every rung against the device, and opens
  the highest one the device can take — so a cinemascope Level 5.0 rung is stepped over before the
  decoder is asked to allocate for it, while a genuine 1080p Level 4.0 rung is kept as before.
- **A 1080p-class or 32-bit or low-memory device is held to a policy**: at most 1920 wide, at most
  H.264 Level 4.1, and additionally capped by the device's own decoder limits. Devices with room are
  not degraded.
- **The media buffer is bounded where it has to be**: 25 seconds instead of 50, no back buffer, at
  most a quarter of the memory class in buffered media, and a fifth of the heap left free — the
  player stops filling instead of filling until the process is killed for it.
- **A rendition that took the process down with it is remembered.** The rung about to be opened is
  written to storage before the surface mounts and cleared once playback is real, so a record that
  outlives its process is proof that this device did not survive that rung; the next launch skips it.
  Choosing it by hand from the quality menu clears the mark and lets the device prove itself again.
- **The app can now be read from a device**: a native module reports model, API level, ABI, 32/64-bit
  process, memory class, RAM, decoder limits and hardware/software decoding; every playback milestone
  is logged to logcat under the tag `SNAS` with URLs redacted; uncaught Java/Kotlin exceptions are
  written to logcat and to `last-crash.txt`. `scripts/device-playback-probe.sh` collects all of it,
  plus the crash buffers, the low-memory killer, the codec detail and the device's own report, in one
  command.

## Installation and compatibility

Install `snas-0.0.5.apk` with `adb install -r snas-0.0.5.apk` on an Android-based Fire TV with
developer access enabled. Package `com.snas.tv`; version name 0.0.5; version code 5; min SDK 24;
target SDK 35. Includes `arm64-v8a`, `armeabi-v7a` and `x86_64` native code.

The APK is built with Gradle's Release variant and signed with the repository's **Android debug
certificate**. It is a development/sideload build, not a production-signed Amazon Appstore artifact.
It is not a Vega OS VPKG.

## Verification

`npm run test:unit` 73 passed, `npm run test:player` 24 passed, `npm run typecheck` clean,
`npm --prefix firetv run typecheck` clean, `npm run lint` 0 errors (50 pre-existing warnings). The
build is `dist/snas-0.0.5.apk`, 43,552,383 bytes, SHA-256
`66eec8f81de4f02d96eb4ecca9a6e56af09f7baff946bda34a1d54f668286d41`, and the JavaScript inside it was
checked for the new code rather than assumed.

On the emulator the app read the device, read the provider's real ladder, kept the 1080p rung a
capable device can decode, and played; and the recovery path was exercised for real by killing the
process 1.2 s after playback started, which left the attempt record behind — the next launch logged
`killed=1080p opening=720p` and decoded 1280×720.

Ten minutes of continuous playback then settled the playback heap at 65 MB allocated, falling back
from its 89 MB peak with the process alive and no fatal or kill line; leaving the player and
re-entering the same title measured *lower* than the first session (58 MB versus 65–89 MB allocated),
so nothing accumulates across sessions. Leaving the player also now writes its own record: the
remote's back button logs `playback:exit position=2 duration=6491 playing=true`. Before this build
only the on-screen Exit button wrote that line, so a normal back-out looked identical to a killed
process in the log — the one distinction a device with no in-process witness has to rely on.

**No physical Fire TV was attached.** The decoder policy has therefore not been exercised against the
stick's own AVC decoder, and the bounded-buffer branch was not reached on the emulator (it reports
2473 MB, 64-bit, API 35 — a capable device by the policy's own definition). The full record, including
the commands that produce the missing evidence, is in
[docs/FIRETV_STICK_PLAYBACK.md](FIRETV_STICK_PLAYBACK.md).
