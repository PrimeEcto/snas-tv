# SNAS TV 0.0.7 — what was run

Recorded 2026-10-25. The APK installed here is `dist/snas-0.0.7.apk` (43,557,843 bytes, SHA-256
`4f2bfe08…6ae68c86`, `versionName=0.0.7`, `versionCode=7`), built from the commit this entry
describes, and the backend it talks to is the deployed Worker from
[RELEASE_0.0.6.md](RELEASE_0.0.6.md).

## The source CDN, measured from this host

| Request | Result |
|---|---|
| `speed.cloudflare.com/__down?bytes=3000000` (control) | 0.289 s, 10.4 MB/s |
| `seg-5-s720p-v1-a1.m4s`, attempt 1 (2,659,451 B) | 27.45 s, 97 KB/s |
| same URL, attempt 2 | 1.59 s, 1.67 MB/s |
| same URL, attempt 3 | 3.45 s, 770 KB/s |
| `seg-5-s720p-v1-a1.m4s`, earlier run, `--max-time 120` | timed out with 2,410,482 B received |

The control proves the local link was fine; the spread is the CDN's.

## The app, on the emulator (`emulator-5556`, Android 15 x86_64)

Installed over the previous build, then `pm clear` so the run starts from a fresh install:

`ANDROID_SERIAL=emulator-5556 bash scripts/android-journey.sh --no-install` —
**13 passed, 0 failed, 0 skipped**.

| Step | Result | Evidence |
|---|---|---|
| launch | PASS | first paint on `versionName=0.0.7`, `versionCode=7` |
| Home / Movies / Series / About | PASS | headings, filters, TMDB attribution |
| Search | PASS | one letter typed, 20 titles returned by the backend |
| My List (empty → saved → relaunch) | PASS | save from details, listed, survives a relaunch |
| Playback | PASS | 200 app-process decoder lines; native clock `0:02 → 0:16`; paused labels `Play/Play` |
| Playback exit | PASS | Back returns to the hero on Home |
| Guest resources | PASS | TOTAL PSS 294 MB, Java heap 30.9 MB |

The `playback:start` line from this run (the emulator reports itself as capable, so it takes the
pinned path by design):

```
playback:start title=movie:1400940 device=device: sdk_gphone64_x86_64, API 35, x86_64, 64-bit,
192 MB heap, 2473 MB RAM, c2.goldfish.h264.decoder up to 4096x4096 policy=full: no constraint
reported ceiling=2560x1600 L5.1 renditions=0 ladder=Vidmoly[unknown level? ok] killed=-
opening=Vidmoly allowed=true mode=pinned cap=- buffer=default
```

An earlier run without `pm clear` reported three My List failures; they were leftover saved state
from the previous install (a saved id the catalog no longer returned), not a regression, and they
pass on a clean install as recorded above.

## What was not exercised

- **The adaptive path on a real player.** The only Android device here is a 64-bit emulator with
  2.4 GB of RAM, so the device probe correctly reports `policy=full` and the app pins its rendition.
  The adaptive path is covered by `tests/ladder.test.ts` and `tests/player-events.spec.tsx` (the
  master URL and 3,565,000 bps ceiling handed to the surface, the fallback when it fails, and the
  ceiling following the quality menu), and the master playlist itself was fetched and parsed from
  the live backend — but ExoPlayer has not carried it on hardware.
- **The stick.** No physical Fire TV was attached, so the stalling that motivated this release is
  untested here by construction.
- **Titles without a ladder.** `vegas` answers with a single `Vidmoly` HLS and no master playlist;
  those titles stay pinned and only gain the larger buffer.
