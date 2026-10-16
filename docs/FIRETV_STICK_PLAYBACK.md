# Playback on the 1st-gen Fire TV Stick 4K

Investigation of the report that playback dies the moment it starts on a 1st-gen Fire TV Stick 4K
while the same title plays on a newer Fire TV. Recorded 2026-10-16 against `codex/snas-tv-0.0.3`.

## What was checked

- The device's documented platform, from Amazon's own specification table.
- The stream the app actually asks for, read from the live backend and its HLS playlists.
- The app's own memory profile while a player is open, from the emulator `dumpsys meminfo` in
  `research/android/meminfo.txt`.
- Known Media3 behaviour on this exact model.

Physical hardware was not attached, so the last step — the device's own log — is still outstanding.
That is stated plainly at the end rather than implied away.

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

## The stream the app hands it

`GET /v1/watch` returns four renditions, each its own single-variant playlist. The master playlist
for the same title declares what those labels really are:

```
#EXT-X-STREAM-INF:BANDWIDTH=6168323,RESOLUTION=2584x1080,FRAME-RATE=23.974,CODECS="avc1.640032,mp4a.40.2"
sd/98/index-s1080p-v1-a1.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=16152957,RESOLUTION=3832x1600,FRAME-RATE=23.974,CODECS="avc1.640033,mp4a.40.2"
sd/98/index-s2160p-v1-a1.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=1330890,RESOLUTION=852x480,FRAME-RATE=23.974,CODECS="avc1.4d401e,mp4a.40.2"
sd/98/index-s480p-v1-a1.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=3136330,RESOLUTION=1724x720,FRAME-RATE=23.974,CODECS="avc1.4d4020,mp4a.40.2"
sd/98/index-s720p-v1-a1.m3u8
```

The ladder is cinemascope **H.264**, not 16:9, and the labels describe it loosely:

| Label | Real frame | Pixels | Codec string | Meaning |
|---|---|---|---|---|
| `2160p` | 3832×1600 | 6.13 Mpx | `avc1.640033` | H.264 **High, Level 5.1** |
| `1080p` | 2584×1080 | 2.79 Mpx | `avc1.640032` | H.264 **High, Level 5.0** |
| `720p` | 1724×720 | 1.24 Mpx | `avc1.4d4020` | H.264 **Main, Level 3.2** |
| `480p` | 852×480 | 0.41 Mpx | `avc1.4d401e` | H.264 **Main, Level 3.0** |

`avc1.640032` is profile 0x64 (High), constraint 0x00, level 0x32 = **50**. The "1080p" rung is wider
than 1920 and carries a level-five bitstream; the "2160p" rung is level 5.1 and **four and a half
times the pixels of the 720p rung**.

The app's default is `DEFAULT_QUALITY = '1080p'`, so the rendition it opens with is the 2.79 Mpx
level-5.0 one — and because each quality is a *single-variant* playlist, ExoPlayer's adaptive
selection has nothing to choose between once that URL is handed over. Media3 also does not step down
to another HLS variant after a real decoder failure
([androidx/media #1656](https://github.com/androidx/media/issues/1656) shows a variant reported as
supported while the device codec rejected its profile), so a failure on the chosen rung was, before
this change, the end of playback.

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

## The app's own footprint makes it worse

`research/android/meminfo.txt`, taken on the emulator with a player open:

- **TOTAL PSS 282 MB**, of which **Native Heap 179 MB allocated of a 217 MB cap** and
  `TOTAL RSS 403 MB`.
- `App Summary` puts 30 MB in private-other and 17 MB in system — the graphics/media path that the
  decoder's output buffers come out of.

And the app is heavier at play time than it needs to be:

- Every visited destination stays mounted behind the player — `App.tsx:377-409` renders `Movies`,
  `Series`, `Search`, `My List` and `About` guarded only by `visited.includes(...)`, so they are all
  still alive when the player opens.
- `src/catalog/preload.ts` fetches **135 pieces of artwork** into the platform image cache before
  home paints, and that cache is not evicted when the picture starts.

A 1.5 GB device with a 32-bit userspace and a fixed graphic-buffer carve-out has to satisfy the
decoder's buffer request out of whatever is left. On the emulator that was a 2048 MB image with room
to spare; on the stick it is not.

## The mechanism, as it stands

Two candidate endings, one shared trigger:

1. **Decoder cannot allocate output buffers** → MediaCodec reports a fatal error → ExoPlayer playback
   error → the surface calls `onError`. The app already had a recovery screen for this, but only
   *after* playback had already stopped, with no way to reach a rung the device can decode.
2. **Process death** from memory pressure — an LMK kill or a native codec crash — which JS can never
   observe, because `onError` cannot run in a process that is gone.

Which one it is on this stick is decided by the log, not by inference. Both are driven by the same
thing: the app opens with the heaviest rendition the ladder has, and has no route down.

## What changed in this tree

Two changes in `src/ui/PlayerScreen.tsx`, both about not treating one rung as the only rung:

- **A decoder failure now walks the ladder down.** `onStreamError` steps to the next lower rendition
  the session has not already lost, resumes at the last native position, and says so quietly on the
  transport line. Only when the lowest rung has also failed does playback become unavailable with the
  Try again action. On this stick the first step lands on 1724×720 Main Level 3.2, which is a
  different allocation problem entirely.
- **The default never falls back to the tallest rung.** `defaultQuality` prefers the 1080p rung, then
  the best rung *below* it, then the lowest. A ladder with no 1080p rung used to start on 2160p —
  the rung a constrained decoder is least able to open.

Covered by three tests in `tests/player-events.spec.tsx` (`steps down the ladder`, `walked to the
bottom`, `no 1080p rung starts below the top`). `npm run test:player` 19 passed, `npm run test:unit`
52 passed, `npm run typecheck` clean, `eslint` on the changed files 0 errors.

Not changed, and worth naming: the app still keeps every visited screen mounted during playback, and
still preloads 135 images at launch. Both are memory the decoder could otherwise have.

## Confirming it on the stick

The cheapest confirmation needs no tools at all: **open a title on the stick and pick 720p from the
player's quality menu.** If 720p plays and the same title at 1080p does not, the mechanism above is
confirmed and the new step-down is the right fix. (The 1080p rung is what the app now tries first, so
this same test also shows whether the automatic fallback reaches 720p on its own.)

With ADB debugging enabled on the stick:

```bash
adb connect <stick-ip>:5555
adb -s <serial> logcat -c
adb -s <serial> logcat | grep -iE "snas|MediaCodec|ACodec|ExoPlayer|codec|lmkd|lowmemorykiller"
```

What to look for, in order of what it proves:

- `createGraphicBuffer failed`, `dequeueBuffer failed: Out of memory (12)`,
  `Failed to allocate output port buffers` — the decoder ran out of buffers, candidate 1.
- `Codec reported err`, `Video codec error`, `Decoder failed: OMX.MTK.VIDEO.DECODER.AVC` — the
  hardware AVC decoder refused the stream.
- `lmkd` / `Killing` / `Low on memory` naming `com.snas.tv`, or a `FATAL EXCEPTION` whose process
  version differs from the app's — candidate 2, process death.

Supporting measurements from the same device:

```bash
adb -s <serial> shell getprop ro.product.cpu.abilist     # expect armeabi-v7a,armeabi
adb -s <serial> shell dumpsys meminfo com.snas.tv        # PSS with a player open
adb -s <serial> shell dumpsys media.codec | head -60     # the stick's declared AVC limits
```

That last one is the direct answer to "what can this decoder actually take", and it is what a
capability query in the app would read. `MediaCodecInfo.VideoCapabilities`
(`isSizeSupported(width, height)`, `areSizeAndRateSupported`) has existed since API 21, so it is
available on this stick — but it is only reachable from native code today, since React Native and
`react-native-video` expose nothing of it to JavaScript.

## Still unverified

- The stick's own log: which of the two endings actually happens, and which rung is the first to play.
- Whether the step-down reaches 720p automatically on that device (it does on the emulator's
  software decoder, which never fails this way, so the emulator cannot prove the device path).
- What `dumpsys media.codec` reports for `video/avc` on AFTMM. Amazon's published table claims H.264
  up to 4K60 High 10 Level 5.2 for this model; that published figure is not a measurement of a unit's
  decoder, and issue #654 is a case of a device declaring support and then failing to allocate.
