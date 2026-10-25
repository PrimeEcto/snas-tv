# Playback on the 1st-generation Fire TV Stick 4K

Investigation and repair of the report that playback dies a second or two after it starts on a
1st-generation Fire TV Stick 4K while the same title plays on a newer Fire TV.

Two records live in this file: [the 2026-10-16 investigation](#part-1--the-original-investigation)
that first identified the ladder as the suspect, and
[the 0.0.5 investigation](#part-2--the-0.0.5-investigation) that measured the real stream ladder,
replaced the label-based default with a measured, device-aware policy, and gave the app a way to
report what a device actually does. **No physical stick has been attached to any of this work**, so
every device-specific claim below is either measured on the live backend, read from the platform's
own documentation, or marked as unverified.

---

# Part 2 — the 0.0.5 investigation

Recorded 2026-10-16 against `codex/snas-tv-0.0.4`, branch head `11ba8e2`.

## A. Executive diagnosis

**The app chose which rendition to open from the provider's labels, and the labels lie.** On the
backend this app uses, a title whose ladder the provider marks `1080p` can be **2584×1080 H.264 High
Profile Level 5.0** (`avc1.640032`) and `2160p` can be **3832×1600 or 3840×2160 High Profile Level
5.1** (`avc1.640033`). The 1st-generation Fire TV Stick 4K (AFTMM, Fire OS 6, 32-bit, 1.5 GB) is
documented failing to allocate the decoder's output graphic buffers on exactly that model:
`createGraphicBuffer failed` / `dequeueBuffer failed: Out of memory (12)` / `Failed to allocate
output port buffers`, **after reporting the format as supported**
([androidx/media#654](https://github.com/androidx/media/issues/654)). That failure tears down the
media pipeline; when it takes the process with it, no JavaScript handler can run, and the viewer is
returned to the Fire TV menu — which is exactly the reported shape: playback looks fine for a second
or two, the picture freezes, and the app is gone.

`format_supported=YES` is the crux, and it is why this repair is a device *policy* rather than a
capability query: nothing the device says about a format can be trusted by itself here. The published
material about that model's H.264 limits does not agree with itself either — Amazon's device-specific
specification lists AFTMM's H.264 up to **3840×2160 at 60 fps, High 10 Profile Level 5.2**
([device specifications](https://developer.amazon.com/docs/device-specs/device-specifications-fire-tv-streaming-media-player.html)),
Amazon's comparison table describes **1080p60 High Profile Level 4** for an H.264 entry in the same
matrix
([comparison table](https://developer.amazon.com/docs/device-specs/device-specifications-comparison-table.html)),
and 2018 press coverage of the MT8695 platform reported **1080p30**
([CNX Software](https://www.cnx-software.com/2018/10/04/amazon-fire-tv-stick-4k-mediatek-mt8695/)).
What *is* measured on this exact model is the buffer allocation failure, so the policy weighs the two
facts that are true of the unit — how much memory it has, and whether its app runs in a 32-bit
address space — and refuses the tall, wide, high-bitrate rungs while they are scarce. It does not
remove them: the 4K rung stays in the quality menu, and a device the policy got wrong is corrected on
the next launch (D2).

The app's own memory at play time is what makes the allocation failure likely rather than theoretical,
and it is measurable: on the emulator the app's Dalvik heap went from **10 MB at home to 59 MB the
moment a 6 Mbps title opened**, and on the same run it was still climbing (63 MB) twenty seconds
later — Media3's default load control buffers up to 50 seconds of media, on top of a launch that
pre-loads the artwork home is about to paint. On a 1.5 GB 32-bit device, decoded bitmaps also live in
that same Java heap (API 25 predates moving them to native memory).

Confidence: the rendition defect is **confirmed** by code inspection plus live measurement of the
streams; the memory contribution is **measured** on the emulator and **inferred** for the stick; and
*which* ending the viewer's unit actually hits (a decoder abort, a low-memory kill, or a Java
`OutOfMemoryError` on a background thread) is **unconfirmed**, because that requires the device's own
log — which is what `scripts/device-playback-probe.sh` now collects.

## B. Evidence

### The ladder, measured from the live backend

`GET /v1/watch` for five titles, then each title's master playlist (2026-10-16):

| Label | Dune: Part Two, Inception, Moana 2, Game of Thrones | Interstellar |
|---|---|---|
| `2160p` | 3840×2160 `avc1.640033` **L5.1**, 16.1 Mbps | 3832×1600 `avc1.640033` **L5.1**, 16.2 Mbps |
| `1080p` | 1920×1080 `avc1.640028` **L4.0**, 6.1 Mbps | 2584×1080 `avc1.640032` **L5.0**, 6.2 Mbps |
| `720p` | 1280×720 `avc1.4d401f` L3.1, 3.1 Mbps | 1724×720 `avc1.4d4020` L3.2, 3.1 Mbps |
| `480p` | 852×480 `avc1.4d401e` L3.0, 1.3 Mbps | 852×480 `avc1.4d401e` L3.0, 1.3 Mbps |

Two conclusions follow, and both matter:

1. A label is not a resolution. `1080p` is 2584 pixels wide on one ladder and 1920 on another, so a
   policy written against labels — including "prefer 1080p, otherwise the best rung below it" — is a
   policy written against a claim.
2. The `2160p` rung is High Level 5.1 **H.264** on every ladder measured, which is not a format this
   device can be expected to open at all.

Each quality is also a *single-variant* playlist, so once the app hands one URL to ExoPlayer there is
nothing left for adaptive selection to choose between.

### The app's memory while a player is open, measured on the emulator

`dumpsys meminfo com.snas.tv` on the headless `firestick_sim` emulator (Android 15 x86_64, TV profile,
2 GB), with the 0.0.4 APK:

| Moment | TOTAL PSS | Native Heap | Dalvik Heap (alloc / cap) |
|---|---|---|---|
| Home, after launch preloading | 235 MB | 154 MB | 10.8 / 21.6 MB |
| Player open (1080p rung, 6 Mbps) | 300 MB | 142 MB | 58.8 / 83.4 MB |
| Twenty seconds later | 310 MB | 137 MB | 63.2 / 87.8 MB |

Home's 154 MB of native heap is the app before a single frame is decoded; the player then asks the
Java heap for roughly 50 MB more, which on the emulator is free but on the stick is the heap that
also holds every decoded poster on API 25.

Logcat from the same run shows a working hardware-ABI H.264 session
(`allocate(c2.goldfish.h264.decoder)`, `HlsMediaPlaylist … parseMediaPlaylist`,
`allocate(c2.android.aac.decoder)`) and **no** error of any kind — the emulator's software decoder
never produces the stick's failure, so the emulator can prove the app's plumbing and memory, and
cannot prove the decoder policy.

During the same session the *system* killed a background app for memory:
`lowmemorykiller: Kill 'com.google.android.cellbroadcastreceiver' … low watermark is breached`. That
is the emulator, not the stick, and it is not this app's process — but it is a concrete reminder of
what an app carrying this much memory is competing with on a 1.5 GB device.

### The repaired app, measured on the same emulator

The 0.0.5 APK, same walk, same title (`movie:1236045`), with the app's own log:

```
playback:start title=movie:1236045 device=device: sdk_gphone64_x86_64, API 35, x86_64, 64-bit,
  192 MB heap, 2473 MB RAM, 1270 MB free, c2.goldfish.h264.decoder up to 4096x4096
  policy=full: no constraint reported ceiling=2560x1600 L5.1 renditions=3
  ladder=1080p[1920x1080 L4.0 ok] 720p[1280x720 L3.1 ok] 480p[852x480 L3.0 ok]
  killed=- opening=1080p allowed=true buffer=default
```

Read that as the fix working as designed on a *capable* device: the app measured the provider's real
ladder (three renditions, the 2160p rung absent for this title), read the device (64-bit, API 35,
192 MB heap class, 2473 MB, an AVC decoder declaring 4096×4096), concluded `full`, and kept the
1080p rung — the same picture the old build opened, now with evidence behind the choice instead of a
label. The decoder then allocated 1920×1080 (`CCodec … int32_t width = 1920`), audio followed, the
process stayed alive, and the log recorded no error. Memory on this path: 235 MB / 9.9 MB Dalvik at
home → 294–312 MB / 65–70 MB Dalvik during playback, i.e. the platform buffer defaults, because a
device this size is not the one the buffer bound is for.

### The recovery path, measured by killing the process

The mechanism that exists for a device whose decoder *cannot* be caught needs a process death to be
real, so one was arranged on the emulator: the app was launched, a title played, and the process
killed 1.2 s in — the window between arming the record and the surface's first clock report.

What the app had written to storage at that moment, read straight out of its database:

```json
{"quality":"1080p","titleKey":"movie:1236045","url":"moon.zenoak.top/…/index-s1080p-v1-a1.m3u8","at":1792198383960}
```

Note what is *not* there: the CDN path token. The URL is stored as host and file name only.

The app was then launched again and the same title opened:

```
playback:start … killed=1080p opening=720p allowed=true
```

and the decoder allocated 1280×720. That is the whole chain on a device: the rung that was being
opened when the process died is remembered, skipped on the next attempt, the app plays anyway, and
the record is cleared once playback is real (the key is gone from storage after the session starts).
Memory on that run: **35–39 MB Dalvik / 270 MB PSS**, against 65–70 MB / 294–312 MB for the same
title at 1080p — so choosing the rung the device can actually take is itself worth roughly 30 MB of
heap on this title, before the buffer bound applies at all.

### Ten minutes of playback, and what leaving costs

The published Fire TV performance procedure plays for ten minutes and then measures, so that was run
on the same emulator against the live backend (0.0.5, `movie:1236045`, one session, the log cleared
first):

| Moment | TOTAL PSS | Dalvik Heap PSS (alloc) |
|---|---|---|
| Home, after launch preloading | 226 MB | 13 MB (14 MB) |
| 1 min | 307 MB | 77 MB (65 MB) |
| 3 min | 317 MB | 89 MB (65 MB) |
| 5 min | 309 MB | 87 MB (65 MB) |
| 7 min | 293 MB | 78 MB (65 MB) |
| 10 min | 301 MB | 72 MB (65 MB) |
| Left the player | 361 MB | 73 MB (12 MB) |
| Re-entered the same title | 283 MB | 58 MB (55 MB) |

The playback heap settles at **65 MB allocated and stops there** — it rises for the first minutes and
then comes *down*, which is what a bounded buffer looks like; nothing grows without limit over ten
minutes. The process was alive throughout, and the run's final tally of `FATAL` / `AndroidRuntime` /
`Video codec error` / `lowmemorykiller … com.snas.tv` lines was **0**.

Leaving the player releases the Java heap (ART shrinks it back to 24 MB, 12 MB allocated) but not the
native heap: measured at home a few minutes later it was **187 MB native / 357 MB PSS**, against
130 MB while the player was open. On API 35 a decoded bitmap lives in native memory, and this app
paints a home screen built from 135 pre-fetched artworks, so re-rendering home is a consistent
explanation — but this image also renders in software (swiftshader), and that cannot be separated from
it here. The re-entry then measured *lower* than the first session (58 MB versus 65–89 MB allocated),
so nothing accumulates across sessions; what the observation does establish is that on API 25 the same
artwork lands in the Java heap instead, which is the heap the decoder asks for frames from. It stays a
stick measurement, and `meminfo.txt` from the probe is what settles it.

### What the app did before this change

`src/ui/PlayerScreen.tsx` carried `const DEFAULT_QUALITY = '1080p'` and picked the first source whose
label matched, then the best rung *below* 1080p, then the lowest. Nothing read the master playlist the
backend returns beside the sources, and nothing asked the device anything. 0.0.4 had added a
step-down for a *decoder error* — which only helps when the failure arrives as a Java playback error
while the process is still alive. A process that dies mid-allocation cannot step down: the code that
would do it is gone.

## C. Hypotheses, ranked

| # | Hypothesis | Evidence | Confidence | Test | Status |
|---|---|---|---|---|---|
| 1 | The opening rung was chosen from labels, so the app asked the decoder for frames it cannot allocate (`2160p` High L5.1 always, `1080p` High L5.0 on some titles) | Live ladder measurement, 5 titles; `DEFAULT_QUALITY = '1080p'` in the old code path; androidx/media#654 on AFTMM | High | The rung is now chosen from measured renditions and the log names it (`opening=…`, `ladder=…`) | **Confirmed**, fixed |
| 2 | The failure kills the process, so 0.0.4's in-app step-down could never run | The report's shape (brief freeze, then the launcher, no error screen); `onError` cannot run in a dead process | Medium-high — the shape fits, the unit's log is missing | A device run that kills the process mid-open now leaves a record and the next launch skips that rung | **Confirmed as a gap**, fixed by an on-disk record (verified by killing the process on the emulator) |
| 3 | Memory pressure from the app's own foreground footprint makes the allocation fail earlier | Emulator: 235 MB PSS / 154 MB native heap at home, +48 MB of Dalvik the moment a 6 Mbps title opens; artwork pre-loaded and every visited screen left mounted | Medium — measured on a capable device, inferred for the stick | Bounded buffers + the rung the device can take; measured 65–70 MB → 35–39 MB of Dalvik by rung alone | **Contributing**, partly fixed (the buffer bound is untested on a device) |
| 4 | The stream is not supported because it declares H.264 in a container the app misreads, or headers/auth fail | The HLS playlists, headers and segments were read successfully from the live backend and the app played the same URLs on the emulator | Low | Playback works on the emulator with the same sources, headers and Referer | **Rejected** |
| 5 | DRM or entitlement blocks playback | The app uses no DRM; the backend answers `/v1/watch` with plain HLS URLs | — | Code inspection | **Rejected** |
| 6 | The player is created twice, released too early, or leaks between sessions | One surface, mounted once, released on unmount; three sessions on the emulator with no accumulating players and a settled record each time | Low | Player suites + repeated sessions on the emulator | **Rejected** |
| 7 | A Java or JavaScript exception during startup of playback | No uncaught exception in any emulator session; the app now records them if they occur | Low | `crash.log` / `last-crash.txt` | **Rejected for the observed path**, instrumented for the stick |
| 8 | The device's hardware decoder refuses the *profile* outright (software fallback, stutter) | androidx/media#654 reports `format_supported=YES` and an allocation failure, not a profile rejection; no evidence of a software fallback in the app's own logs | Low | `dumpsys media.codec` on the stick | **Not supported** |

## C2. Audit summary

| Subsystem | What was found |
|---|---|
| Rendition selection | **Defect.** Chosen from labels; the master playlist the backend returns was discarded. Fixed. |
| Provider ladder | Measured: two different shapes, both with an H.264 Level 5.1 `2160p` rung. No app-side fix beyond selection. |
| Media buffers | **Defect.** Media3 defaults (50 s, no heap ceiling, no reserve) inherited unchanged. Bounded on constrained devices. |
| Decoder failure handling | Step-down existed (0.0.4) but could not survive a process-level failure. Now backed by an on-disk record. |
| Player surface | `firetv/player/android.tsx` uses react-native-video → Media3 ExoPlayer, SurfaceView, one player, single mount. No duplicate players or leaked release found. |
| Player lifecycle | The player is mounted once and released on unmount; `key` on the screen changes only with the title/episode. No use-after-release found. |
| Artwork memory | 135 pieces of artwork are pre-fetched at launch; every visited screen stays mounted behind the player. Left as designed (see Remaining risks) — the preload is not what the player then allocates, and removing it would re-create the launch stutter it was added to fix. |
| Device capability | **Missing.** Nothing in the app could read memory class, ABI, or decoder limits. Added a native module. |
| Diagnostics | **Missing.** No playback log, no fatal-exception record. Added; see H. The exit record existed but was unreachable from the remote — fixed, see D5. |
| Manifest / build | `minSdkVersion 24`, `targetSdk 35`, `arm64-v8a armeabi-v7a x86_64`, no shrinking, no ProGuard pitfalls found. `MediaCodecInfo.VideoCapabilities` is API 21+, so it exists on the stick. |
| Networking / backend | `/v1/watch` returns sources, headers, a master playlist and subtitles; the Referer header is passed to every request including the new playlist fetch. No redirect/auth defect found. |
| DRM | Not used by this app. Not a factor. |
| Persistence | The library is written to AsyncStorage every 5 s during playback; the attempt record uses the same store. No corruption path found. |

## D. Root cause analysis

### D1 — The opening rendition was chosen from a label (confirmed)

*Where:* `src/ui/PlayerScreen.tsx`, `defaultQuality()` (removed) and `DEFAULT_QUALITY = '1080p'`.

*Behaviour:* the app opened the rung labelled `1080p` on every ladder, and with no 1080p rung the
highest one. On the Interstellar-shaped lattice that is a 2584×1080 High Level 5.0 H.264 stream; with
no 1080p rung it is a 3840×2160/3832×1600 High Level 5.1 one.

*Why it fails:* a frame that wide and that bitrate is what the decoder cannot allocate output
graphic buffers for on this device — the documented AFTMM failure, which arrives *after* the format
is reported as supported, so no capability answer would have prevented it. Nothing in the app could
see the difference between the two ladders anyway, because both said `1080p`.

*Repair:* renditions are now read from the master playlist the backend already returns
(`loadRenditions` in `src/player.ts`, parsed by `parseMasterPlaylist` in `src/ladder.ts`), judged
against a device policy (`src/device-profile.ts`), and the app opens the highest rung that policy
allows (`pickQuality`). On a constrained device that is ≤1920 wide and ≤ H.264 Level 4.1:
Interstellar-class ladders fall to 1724×720 Main Level 3.2, and ladders whose `1080p` really is
1920×1080 High Level 4.0 keep it — the fix refuses what the decoder cannot take without costing
picture quality where it can. A device with room (≥3 GB, 64-bit) is allowed up to 3840×2160 Level 5.1,
and every device is additionally capped by its own decoder's declared maximum width and height.

*How it prevents recurrence:* the decision no longer contains a label that can be wrong, and its
inputs (`describeLadder`) are written to the log so any future report shows what the app saw.

### D2 — The decoder failure the app could not catch (confirmed as a gap, ending unverified)

*Where:* `src/ui/PlayerScreen.tsx`, `onStreamError` (0.0.4's step-down).

*Behaviour:* a rung that fails is stepped down — but only if the failure arrives as a player error.
The report (brief freeze, then the app closes to the Fire TV menu) describes a process that did not
survive, in which case `onError` never runs and the app re-opens the same rung next time.

*Repair:* the rung about to be opened is written to storage **before** the surface mounts and cleared
by the first real clock report from the surface, or by leaving the player
(`src/state/playback-attempt.ts`). A record that outlives its process is therefore proof that this
device did not survive that rung, and the next launch skips it. The viewer can still choose that rung
by hand from the quality menu, which clears the mark and lets the device prove itself again.

### D3 — Memory the player did not need (measured, contributing)

*Where:* `firetv/player/android.tsx` (no `bufferConfig`), `src/ladder.ts` (`bufferFor`).

*Behaviour:* Media3's defaults buffer up to 50 seconds of media with no ceiling on the heap it may
occupy and no reserve left for anything else; measured as a ~48 MB rise in the app's Dalvik heap at
the moment a 6 Mbps title opened.

*Repair:* a constrained device asks for 25 seconds of buffer, 2 seconds before playback, no back
buffer, at most 25% of its memory class in buffered media, and hands the player
react-native-video's `DependingOnMemory` strategy so it stops filling when only a fifth of the heap is
left instead of filling until it is killed. A capable device keeps the platform defaults.

### D4 — The app could not be read from a device (confirmed as a gap)

*Where:* nothing existed.

*Repair:* `SnasDeviceModule.kt` reports the model, API level, ABI list, 32/64-bit process, memory
class, low-RAM flag, total and available RAM, the Java heap limit, and per-MIME decoder capabilities
(hardware or not, maximum width/height/frame rate, whether the decoder declares 3840×2160 and
2584×1080). `playbackLog` in `src/device.ts` writes one line per playback milestone to logcat under
the tag `SNAS`, with URLs redacted to host and file name. `MainApplication` records any uncaught
Java/Kotlin exception to logcat and to `last-crash.txt` in the app's files directory.

A native (SIGSEGV/SIGABRT) failure never reaches that handler: for those, logcat's tombstone is the
record, and the probe script collects it.

### D5 — The exit record was unreachable, so its absence proved nothing (confirmed, fixed)

*Where:* `src/ui/PlayerScreen.tsx`, the `BackHandler` subscription against `exitPlayer`.

*Behaviour:* `playback:exit` was written by `exitPlayer`, which only the on-screen Exit button
called. The remote's back button — how a viewer actually leaves a player, and the only way to leave
one from a couch — called `onExit` directly and logged nothing. Three separate sessions on the
emulator produced three `playback:start` lines and **not one** `playback:exit` line, every one of them
a normal exit.

*Why it mattered:* the one thing a device with no in-process witness can tell you is whether a session
*ended* or was *killed*, and that is exactly the distinction absence of an exit line was supposed to
carry. Before this fix, no exit line meant nothing at all — a clean back-out and a killed process
looked identical, which is the misread that would make a stick log say "died" when the viewer had
simply pressed back.

*Repair:* the back handler now goes through `exitPlayer` (memoised on `onExit`, so the subscription
stays stable), so every route out of the player — remote back, Exit button, an unavailable stream —
writes the same record. Verified on the emulator: the back button now logs
`playback:exit position=2 duration=6491 playing=true` with the process alive, and
`tests/player-events.spec.tsx` gained the regression test that presses the handler (the harness had
only ever *registered* it, which is why this went unnoticed). The test was confirmed to fail against
the old branch — it saw only `playback:start` — before the fix was restored.

## E. Code changes

| File | Change |
|---|---|
| `src/ladder.ts` (new) | Parses a master playlist into renditions (resolution, frame rate, bandwidth, codecs), reads H.264 levels out of codec strings, matches renditions to the sources the backend named, judges each rung against a device policy, picks the opening rung, and describes the ladder for the log. `bufferFor` derives the buffer a device can afford. Pure — no React Native. |
| `src/device-profile.ts` (new) | The policy: constrained when 32-bit, under 2 GB, small heap class, low-RAM, or API ≤ 25; always additionally capped by the device's own decoder limits. Also the one-line device summary used in logs. Pure. |
| `src/device.ts` (new) | The platform half: reads the native module once (never throws, never waits more than 1.5 s), exposes the policy, writes the playback log, and redacts URLs. |
| `src/player.ts` | `loadRenditions` (best-effort master-playlist read, 4 s budget, returns `[]` on any failure); `PlayerBufferConfig` and `PlayerBufferingStrategy` on the shared surface contract. |
| `src/ui/PlayerScreen.tsx` | Opens the policy-chosen rung; arms and settles the attempt record; logs playback start/step-down/unavailable/exit; passes the buffer and the memory strategy to the surface; a hand-picked quality clears its mark. Every exit route (remote back, Exit button, unavailable stream) writes the same exit record. |
| `src/state/playback-attempt.ts` (new) | The crash-safe record: arm, settle, and take a rung that outlived its process. Pure logic over injected storage. |
| `src/state/attempt-storage.ts` (new) | The AsyncStorage-backed implementation of that interface. |
| `firetv/player/android.tsx` | Passes `source.bufferConfig` and the `bufferingStrategy` prop through to react-native-video. |
| `firetv/android/.../SnasDeviceModule.kt` (new) | The device profile and the `SNAS` log. |
| `firetv/android/.../SnasDevicePackage.kt` (new) | Registers it as a `BaseReactPackage` (the New Architecture ignores `createNativeModules`). |
| `firetv/android/.../MainApplication.kt` | Registers the package and records uncaught exceptions. |
| `scripts/device-playback-probe.sh` (new) | Collects a device's playback evidence in one command: the app's log, crash buffers, low-memory killer, codec detail, memory, and the device's own report. |
| `tests/ladder.test.ts`, `tests/device-profile.test.ts`, `tests/playback-attempt.test.ts` (new) | 21 tests over the real measured ladders, the policy across device shapes, and the attempt record. |
| `tests/player-events.spec.tsx` | Updated for the new default and 5 new tests: the constrained start, the measured 1080p rung being kept, a rung remembered as fatal, the record being written before the surface mounts and cleared once it plays, and the remote's back button leaving an exit record. The harness now presses the back handler it registers. |

The version is bumped to **0.0.5** in both `package.json` and `firetv/package.json`, so the build on
the device and the release the updater compares against cannot be confused with 0.0.4.

## F. Build and test results

| Check | Environment | Result | Evidence |
|---|---|---|---|
| Typecheck (shared screens) | host | **PASS** | `npm run typecheck`, exit 0 |
| Typecheck (Fire OS project) | host | **PASS** | `npm --prefix firetv run typecheck`, exit 0 |
| Unit tests | host | **PASS** | `npm run test:unit` — 73 passed, 0 failed (52 before; 21 added) |
| Player tests | host (jest) | **PASS** | `npm run test:player` — 24 passed, 0 failed (19 before; 5 added) |
| Lint on changed files | host | **PASS** | 0 errors, 9 pre-existing `no-inline-styles` warnings in `PlayerScreen.tsx` |
| APK build | host | **PASS** | `bash firetv/scripts/build-apk.sh` → `dist/snas-0.0.5.apk` |
| Lint (whole project) | host | **PASS** | `npm run lint` — 0 errors, 50 pre-existing warnings |
| App launches with the new native module | emulator-5556 | **PASS** | `playback:start` line carries model, API 35, x86_64, 64-bit, 192 MB heap, 2473 MB RAM and the AVC decoder's declared 4096×4096 |
| The provider's real ladder is read and judged | emulator-5556 | **PASS** | `renditions=3 ladder=1080p[1920x1080 L4.0 ok] 720p[…] 480p[…]`, `opening=1080p allowed=true` |
| Playback reaches a first frame | emulator-5556 | **PASS** | `CCodec … int32_t width = 1920`, AAC decoder allocated, process alive, no error in logcat |
| A killed rung is remembered and skipped | emulator-5556 | **PASS** | process killed 1.2 s into playback; the record survived in `RKStorage`; next launch logged `killed=1080p opening=720p` and decoded 1280×720 |
| The attempt record settles on real playback | emulator-5556 | **PASS** | the key is absent from storage after playback begins |
| Buffer bounded on a constrained device | emulator-5556 | **BLOCKED** | this image reports 2473 MB, 64-bit, API 35 — a capable device by the policy's own definition, so it takes the platform defaults by design. The AVD's `hw.ramSize` is not honoured by the emulator binary here, so a constrained device could not be produced. Covered by unit + player tests instead |
| Leaving the player records the exit | emulator-5556 | **PASS** | the remote's back button logged `playback:exit position=2 duration=6491 playing=true`, process alive, no fatal line |
| 10-minute continuous playback | emulator | **PASS** | played 10 min: Dalvik settled at 65 MB allocated and fell back from its 89 MB peak, PSS 226 → 301 MB, process alive, 0 fatal/kill lines |
| Repeated playback sessions | emulator | **PASS** | left the player and re-entered the same title: 58 MB Dalvik allocated versus 65–89 MB in the first session — no accumulation |
| Original failure no longer occurs | **physical stick** | **NOT RUN** | no device attached |
| Decoder-capability policy against the real AVC decoder | **physical stick** | **NOT RUN** | no device attached |

The emulator is an x86_64 Android 15 image with a software decoder. It exercises the app's own paths,
its device probe, its recovery mechanism and its memory; it cannot exercise the stick's hardware
decoder, and it never produced the reported failure. **The stick itself has not run this build.**

## G. Remaining risks

- **The device's own log is still the missing piece.** The repair removes the trigger the evidence
  points at, and the app can now report what it did. If the stick still fails, the log decides
  between a decoder abort, a low-memory kill and a Java `OutOfMemoryError`, and the probe script
  collects all three.
- **The policy is a policy, not a measurement of that unit.** AFTMM's decoder declares more than it
  can allocate, so nothing read from it can be fully trusted; that is why the memory and bit-width
  conditions exist. A second-generation stick or a 4K Fire TV with more RAM is allowed the taller
  rungs, and one of those could still surprise.
- **Launch artwork is still pre-fetched and every visited screen stays mounted.** Neither is what the
  player then allocates, and removing either would cost the launch and navigation behaviour that was
  designed and tested deliberately. If the stick's log shows a low-memory kill rather than a codec
  failure, this is the next thing to shrink, and the probe's `meminfo.txt` will say by how much.
- **The bounded buffer was never exercised on a device.** The only image available is 2473 MB and
  64-bit, and the emulator binary ignored every attempt to shrink its guest RAM, so the
  `maxBufferMs: 25000` / `maxHeapAllocationPercent: 0.25` / `minBufferMemoryReservePercent: 0.2` set
  and the `DependingOnMemory` strategy are covered by unit and player tests and by reading
  react-native-video's mapping into Media3's `DefaultLoadControl` — not by a running player. The
  stick's own `playback:start` line prints `buffer=maxBufferMs=25000 reserve=0.2` when that branch is
  taken, which is what confirms it there.
- **`DependingOnMemory` is new behaviour on a platform nothing here can measure.** It can only pause
  loading, never playback, and it is engaged only on a constrained device — where the alternative was
  filling the heap that the decoder needed. If the stick's log shows rebuffering rather than a crash,
  this is the first thing to revisit.
- **The step-down still spends one failure** when a rung turns out to be bad on a device the policy
  got wrong. The attempt record turns the *next* session into a working one; it cannot save the
  session that discovers the problem.
- **Leaving the player does not return the native heap.** Ten minutes of playback settles the Dalvik
  heap at 65 MB and releases it on exit, but the native heap measured at home afterwards (187 MB) was
  larger than while playing (130 MB), on an image that renders in software and decodes artwork into
  native memory. Re-entry measured lower than the first session, so this is not per-session
  accumulation, but the artwork this app paints is the likely holder and it is unmeasured on the
  stick — where those same bitmaps sit in the Java heap the decoder negotiates against. The probe's
  `meminfo.txt` at home and at play time is what quantifies it.
- **Subtitles, audio-track switching and seeking were not re-exercised on a device** in this round
  beyond the automated suites.
- **The Vega build is unaffected but untested here**: it has no media surface (`supportsPlayback`
  false), so the new modules are inert on it, and the policy's fallback path is what it uses.

## H. Final operating instructions

Build, install, and verify (from the repository root):

```bash
npm run test:unit && npm run test:player && npm run typecheck   # suites
bash firetv/scripts/build-apk.sh                                # → dist/snas-0.0.5.apk
adb connect <stick-ip>:5555                                     # stick: ADB debugging on
adb -s <stick-ip>:5555 install -r dist/snas-0.0.5.apk
adb -s <stick-ip>:5555 shell dumpsys package com.snas.tv | grep -E "versionName|primaryCpuAbi"
```

Confirm the installed build is the one that was built, then watch the app's own account of a
playback session while it happens:

```bash
adb -s <stick-ip>:5555 logcat -c
adb -s <stick-ip>:5555 logcat -s SNAS
```

Expected on a healthy session:

```
playback:start title=movie:157336 device=device: AFTMM, API 25, armeabi-v7a, 32-bit, 192 MB heap, 1536 MB RAM, OMX.MTK.VIDEO.DECODER.AVC up to 1920x1088 policy=constrained: … opening=720p allowed=true
playback:exit position=… duration=… playing=…
```

If playback still fails, collect everything in one command — the app's log, the crash buffers, the
low-memory killer, the codec detail, the memory and the device's own report:

```bash
bash scripts/device-playback-probe.sh <stick-ip>:5555
```

The result lands in `research/firetv/`. Read it in this order:

| File | What it decides |
|---|---|
| `snas-playback.log` (tag `SNAS`) | Which rung the app opened, what it thought the device was, whether it stepped down |
| `crash.log` | A Java/Kotlin `FATAL EXCEPTION` — the app's own error, with a stack |
| `kernel-crash.log` | A native signal (`DEBUG`, `signal 11`, tombstone) — a decoder abort, with no JavaScript involved |
| `lowmemory.log` | `lmkd` / `Killing` naming `com.snas.tv` — the process was killed for its memory |
| `media.log` | `createGraphicBuffer failed`, `dequeueBuffer failed: Out of memory (12)`, `ACodec … Failed to allocate output port buffers` — the documented AFTMM failure |
| `meminfo.txt` | `TOTAL PSS`, `Native Heap`, `Dalvik Heap` at collection, to compare against the emulator's numbers above |
| `device.txt` | Model, API level, ABI list — the facts the policy is written against |

Two device facts worth having by hand, both collected by the script:

```bash
adb -s <stick-ip>:5555 shell dumpsys media.codec | head -80   # the AVC decoder's declared limits
adb -s <stick-ip>:5555 shell dumpsys meminfo com.snas.tv      # memory with a player open
```

---

# Part 1 — the original investigation

Recorded 2026-10-16 against `codex/snas-tv-0.0.3`. Kept as written, because it is the reasoning the
0.0.5 work was built on: the device's documented platform, the stream the app asks for, the app's own
memory profile, and the documented failure on this exact model. Its one unverified assumption — that
the `1080p` label is always the 2584×1080 rendition — is corrected in Part 2, where the L4.0 shape of
that ladder was measured.

## The device

| | |
|---|---|
| Model / codename | Fire TV Stick 4K, 1st gen (2018) — **AFTMM** |
| Platform | Fire OS 6, based on Android 7.1 (**API 25**) |
| SoC | MediaTek MTK8695 + MT7668, quad-core 1.7 GHz |
| Memory | **1.5 GB** DDR4 |
| ABI | **32-bit** (`armeabi-v7a`) |

The APK is installable there (`minSdkVersion 24`) and ships an `armeabi-v7a` slice, so the install is
not the problem. 1.5 GB with a 32-bit userspace is the constraint that everything below runs into.

Source: [Amazon Fire TV device specifications](https://developer.amazon.com/docs/device-specs/device-specifications-fire-tv-streaming-media-player.html),
[Fire OS overview](https://developer.amazon.com/docs/fire-tv/fire-os-overview.html).

## The documented failure on this exact model

[androidx/media #654](https://github.com/androidx/media/issues/654) is filed against **AFTMM on Fire
OS 6.2.9.8**, and its reporter records that **Fire TV Stick 4K Max does not reproduce it**:

```
BufferQueueProducer  dequeueBuffer: createGraphicBuffer failed
ACodec                dequeueBuffer failed: Out of memory (12)
ACodec                Failed to allocate output port buffers after port reconfiguration: (-12)
ACodec                signalError(omxError 0x80001001, internalError -12)
MediaCodec            Codec reported err 0xfffffff4, actionCode 0, while in state 6
MediaCodecVideoRenderer  Video codec error  java.lang.IllegalStateException
ExoPlayerImplInternal    Playback error  ...  format_supported=YES
```

The decoder cannot allocate its output graphic buffers — `-12` is `ENOMEM` — so it signals a fatal
error during port reconfiguration, which is to say at decoder start. That is the shape of the report:
fine on a newer Fire TV, dead the moment playback starts on the stick. `format_supported=YES` also
shows the trap: the device *claims* the format, then fails to allocate for it.

## What 0.0.3 changed, and why it was not enough

Two changes in `src/ui/PlayerScreen.tsx` at that time, both about not treating one rung as the only
rung: a decoder failure walked the ladder down, resuming at the last native position, and the default
never fell back to the tallest rung. Covered by three tests in `tests/player-events.spec.tsx`.

Not changed, and named at the time as worth naming: the app still kept every visited screen mounted
during playback, and still pre-loaded 135 pieces of artwork at launch.

The gap that 0.0.5 closes is the one this analysis could not close from the code alone: the step-down
only runs if the process survives to run it, and the rung the app opened first was still chosen from a
label.

## Confirming it on the stick

The cheapest confirmation needs no tools: open a title on the stick and pick 720p from the player's
quality menu. If 720p plays and the same title at 1080p does not, the ladder is the mechanism. With
0.0.5 the app starts on the rung its own policy allows, and `adb logcat -s SNAS` prints that decision
and the device facts behind it.
