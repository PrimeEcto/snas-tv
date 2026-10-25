# SNAS TV 0.0.6 — what was run

Recorded 2026-10-25. The APK installed here is `dist/snas-0.0.6.apk` (43,555,575 bytes,
`versionName=0.0.6`, `versionCode=6`), built from the commit this entry describes, and the backend
it talks to is the deployed Worker and relay described in [RELEASE_0.0.6.md](RELEASE_0.0.6.md).

## The backend, against the live provider

Before the deploy, `/v1/watch` for every title answered `502` with
`seed request failed (HTTP 403)` for all six mirrors. After the Worker and the relay were deployed:

| Request | Result |
|---|---|
| `/v1/watch?tmdbId=157336&type=movie&title=Interstellar&year=2014&fresh=1` | `200`, provider `miami`, sources `2160p, 1080p, 720p, 480p`, master playlist present |
| `/v1/watch?tmdbId=603&type=movie&title=The Matrix&year=1999&fresh=1` | `200`, same ladder, `headers: {"referer":"https://www.movy.sx/"}` |
| `/v1/watch?tmdbId=1399&type=tv&season=1&episode=1&…&fresh=1` | `200`, same ladder — the TV episode path is fixed too |

The host in `headers` is the value `worker/src/site.ts` resolved, and it is the one the CDN requires.

## The app, on the emulator (`emulator-5556`, Android 15 x86_64)

`ANDROID_SERIAL=emulator-5556 bash scripts/android-journey.sh` — 13 passed, 0 failed, 0 skipped:

| Step | Result | Evidence |
|---|---|---|
| Launch | PASS | `versionName=0.0.6`, `versionCode=6`, `primaryCpuAbi=x86_64` |
| Home / Movies / Series / Search / My List / Details / About | PASS | every screen rendered; search returned 20 titles from the live backend |
| Native playback | PASS | 199 app-process decoder lines; the player's own clock advanced `0:01 → 0:15` |
| Playback exit | PASS | remote Back returned to Home; `playback:exit position=20 duration=6120 playing=true` |
| Guest resources | PASS | PSS 292 MB, RSS 416 MB, Dalvik 36 MB, native 167 MB with the player up |

The app's own log line for the session:

```
playback:start title=movie:1400940 device=device: sdk_gphone64_x86_64, API 35, x86_64, 64-bit,
  192 MB heap, 2473 MB RAM, c2.goldfish.h264.decoder up to 4096x4096 policy=full: no constraint
  reported ceiling=2560x1600 L5.1 renditions=0 ladder=Vidmoly[unknown level? ok] killed=-
  opening=Vidmoly allowed=true buffer=default
playback:exit position=20 duration=6120 playing=true
```

That title came back from the provider as a single `Vidmoly` source rather than the HLS ladder, so
`renditions=0` (there was no master playlist to measure) and the label-based path chose it. The
decoder was `c2.goldfish.h264.decoder` plus `c2.android.aac.decoder`, and the process stayed alive.

## Not run

- **No physical Fire TV.** The stick's own decoder still has not run any build; nothing here changes
  that, and the device-side instructions remain in
  [FIRETV_STICK_PLAYBACK.md](FIRETV_STICK_PLAYBACK.md).
- **No simulated domain move against the real provider.** The discovery and the 403-triggered
  re-resolution are covered by the Worker's tests (`worker/test/site.test.ts`,
  `worker/test/transport.test.ts`), not by moving `movy.sx`.
- **The bounded-buffer branch** still cannot be reached on this image (2473 MB, 64-bit, API 35).
