# SNAS TV 0.0.7

A 1st-generation Fire TV Stick 4K played a title for 20–30 seconds and then froze and resumed over
and over, while a stronger Fire TV played the same title without trouble. The app was not choosing a
bad rendition and the decoder was not failing: the CDN delivers one segment at wildly different
speeds, and a player holding a single pinned rendition has no answer to that. This release lets the
player adapt — down when the CDN crawls, back up when it recovers — and gives it a buffer long
enough to ride out a stall.

## What was measured

From this host, on 2026-10-25, three consecutive requests for the **same** 6-second 720p segment
(2,659,451 bytes, 3.1 Mbps) of `Interstellar`:

| Attempt | Time | Throughput |
|---|---|---|
| 1 | 27.45 s | 97 KB/s (776 kbps) |
| 2 | 1.59 s | 1.67 MB/s (13.4 Mbps) |
| 3 | 3.45 s | 770 KB/s (6.2 Mbps) |

A control download from `speed.cloudflare.com` (3 MB) took 0.289 s (10.4 MB/s), so the local link
was healthy throughout; the spread is the CDN's, not this network's. Earlier in the same session one
720p segment timed out at 120 s after 2,410,482 of 2,659,451 bytes — the tail of that transfer ran at
roughly 20 KB/s.

That is the whole failure. Media3's load control on this device was capped at 25 seconds of media;
at 1080p (≈6 Mbps) a 25-second buffer drains against a 0.78 Mbps crawl in about half a minute. The
viewer sees a title that plays, stops, plays, stops — exactly the report. A pinned rendition cannot
do anything but stall, because there is no smaller track to fall back to.

Fetching the segment as four parallel ranged requests (the "FastStream" idea) was tried and measured
at 10.3 s for the same data, against 1.6–27 s serially: no reliable gain. HLS already pipelines
segment requests, and extra connections contend for the same congested egress.

## What changed

- **Constrained devices open the master playlist and adapt within a ceiling.** `src/ladder.ts` gains
  `planPlayback` and `adaptiveCeiling`; the player surface takes a `maxBitRate`
  (`src/player.ts`, `firetv/player/android.tsx`), which Media3 applies to its track selector while
  leaving adaptive selection on. The ceiling is the chosen rung's own bandwidth plus 15%, so the
  player can drop to 480p during a crawl and climb back to 720p, but never pulls the ~5.8 Mbps
  ultrawide 1080p rung this device's link cannot sustain.
- **The opening rung respects the same ceiling.** `pickQuality` takes `adaptive`, so a device whose
  decoder would allow 1080p opens at 720p when it is going to adapt — a rung the player can actually
  return to.
- **The quality menu is a ceiling, not a pin.** Choosing 1080p raises the adaptive ceiling to 1080p
  and still permits falling below it; choosing 480p can never play 720p.
- **A failed adaptive attempt falls back to the pinned rendition** rather than stepping down the
  ladder: `playback:adaptive-off` is logged with the reason, playback resumes at the same position,
  and only a second failure walks the ladder down. A provider whose master playlist ExoPlayer will
  not open therefore costs one request, not the session.
- **The buffer is longer but still bounded**: 15 s to start, 40 s maximum (≈16 MB at 720p), 3 s to
  begin playback, 5 s after a rebuffer, with the same 0.25 heap share and 0.2 reserve, so the larger
  buffer still cannot crowd out the decoder.
- **The decision is in the log**: `playback:start` now carries `mode=adaptive|pinned` and the
  ceiling in bits per second, beside the device facts and the ladder it judged.

## What this cannot fix

The CDN is the limit, and no client change makes a 0.78 Mbps crawl deliver 3.1 Mbps. What the app
can do is spend a stall on a smaller picture instead of a frozen one, and start with enough buffer
that a short crawl is invisible. If the stick's own Wi-Fi is the weak half of the path, nothing in
this release helps: 5 GHz and a wired adapter remain the fixes on that side.

Adaptive playback also needs a ladder to adapt in. The `miami` provider returns a four-rung master
for the titles measured; the `vegas` provider returns a single `Vidmoly` rendition with no playlist,
and for those titles only the larger buffer applies.

## Installation and compatibility

Install `snas-0.0.7.apk` with `adb install -r snas-0.0.7.apk` on an Android-based Fire TV with
developer access enabled. Package `com.snas.tv`; version name 0.0.7; version code 7; min SDK 24;
target SDK 35. Includes `arm64-v8a`, `armeabi-v7a` and `x86_64` native code.

The APK is built with Gradle's Release variant and signed with the repository's **Android debug
certificate**. It is a development/sideload build, not a production-signed Amazon Appstore artifact.
It is not a Vega OS VPKG.

## Verification

`npm run test:unit` 82 passed (two new ladder tests: the adaptive opening rung and ceiling, and the
pinned/adaptive split), `npm run test:player` 26 passed (three new or rewritten: the master-plus-
ceiling hand-off, the adaptive-failure fallback, and the ceiling-follows-choice behaviour of the
quality menu), `npm run typecheck` and `npm --prefix firetv run typecheck` clean, `npm run lint`
0 errors.

On the emulator (`emulator-5556`, Android 15 x86_64), against the live backend:
`ANDROID_SERIAL=emulator-5556 bash scripts/android-journey.sh` — **13 passed, 0 failed, 0 skipped**,
including native playback with app-process decoder lines and a clock moving `0:02 → 0:16`. The
emulator reports itself as capable (`policy=full`), so that run exercised the pinned path and logged
`mode=pinned`; the adaptive path is covered by the tests above and by the playlist/segment checks in
[docs/QA_0.0.7.md](QA_0.0.7.md), but ExoPlayer has not yet carried it on hardware.

**No physical Fire TV was attached.** Whether this ends the stalling on the stick is the one thing
that needs the stick itself; the log line to read is in
[FIRETV_STICK_PLAYBACK.md](FIRETV_STICK_PLAYBACK.md#part-3--the-0007-investigation-and-what-to-read-on-the-stick).
