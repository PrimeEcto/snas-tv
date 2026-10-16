# SNAS

A native television streaming application with shared React Native screens for Android-based Fire TV and Amazon Vega. Includes movie/series discovery, remote search, saved titles, episodic details and playback through the existing source backend. Android uses ExoPlayer; Vega provides an interactive player concept.

## Version 0.0.3 — Android Fire TV

The current release work targets `dist/snas-0.0.3.apk` (`com.snas.tv`, version code 3). The interface includes native genre/sort sheets, cinematic title pages, a remote keyboard beside results, a centered transport and seek timeline, and structured settings. See [release notes](docs/RELEASE_0.0.3.md), [audit](docs/UI_UX_AUDIT.md) and [QA record](docs/QA_0.0.3.md).

```bash
npm ci
npm --prefix firetv ci
npm test
npm run typecheck
npm --prefix firetv run typecheck
bash firetv/scripts/build-apk.sh
ANDROID_SERIAL=emulator-5556 bash scripts/android-journey.sh dist/snas-0.0.3.apk
ANDROID_SERIAL=emulator-5556 python3 scripts/android-extended.py
```

The Release variant is signed with the repository's Android debug certificate for development sideloading. It is not an Amazon Appstore production-signed artifact. Physical Fire TV hardware has not been tested. Streaming depends on the configured backend and source availability.

Publishing uses `node scripts/release-app.mjs --apk-only --skip-build` from a clean committed tree and requires an authenticated `gh` account with repository access. It refuses an existing tag or release. The local APK and QA evidence do not imply that a GitHub release has been published.

The Vega instructions below describe the separate original target; its VPKG is not the Android 0.0.3 release artifact.

## Installed environment

- Host: Pop!_OS 24.04 x86_64 (Ubuntu derivative; not separately certified by Amazon).
- Vega SDK: 0.24.12112; CLI: 1.4.4; Vega Studio extension: 0.24.1.
- Target: Vega OS 1.2, React Native for Vega 4.x / RN 0.83 / React 19.2.
- Package: `dist/snas_x86_64.vpkg`, component `com.snas.tv.main`.

This VPKG runs on the x86_64 Vega Virtual Device. It is not an Android APK and does not support Android-based Fire OS. Physical Vega Fire TV packaging needs an appropriate device architecture build; it has not been physically tested.

## Develop and build

```bash
cd /data/SNAS
source /home/primeecto/vega/env
npm ci
npm run typecheck
npm test
npm run build:tv              # low-priority, bounded CPU/memory build
```

The official builder emits its VPKG beneath `build/private/kepler/@amazon-devices/snas/undefined/vega/x86_64/Release/`. The build script copies the result to `dist/snas_x86_64.vpkg`, the final demonstration artifact. The build script uses two Metro workers and a systemd user scope capped at 150% CPU and 4 GB RAM.

## Headless device

The initial visible emulator interfered with the user's mouse. The workflow now stays headless; no GUI or host input injection is used.

```bash
npm run device:start
bash scripts/wait-device.sh
journalctl --user -u snas-vvd -n 20 --no-pager
source /home/primeecto/vega/env
vega device info -d VirtualDevice
vega run-app /data/SNAS/dist/snas_x86_64.vpkg com.snas.tv.main -d VirtualDevice
# Later launches retain app data:
vega device launch-app -d VirtualDevice -a com.snas.tv.main
npm run device:stop
```

The device runs in a user service with 150% CPU quota, 4 GB maximum RAM, low scheduling priority, and no foreground window. Initial service discovery may take longer than the CLI's early “ready” response. Wait until `vega device info` reports the TV profile, x86_64 architecture and developer mode before installation. Do not raise resource limits while the user is working.

## Releases and updates on the device

A Vega app cannot replace its own package: installing a build is a host-side action
(`vega run-app`). The app therefore only *reports* an update (`src/update.ts` asks
`/v1/app/latest` on launch and shows a line when a newer build exists), and the installing
half runs on this machine:

```bash
npm run device:update        # watch the backend and install new releases as they appear
npm run device:update:once    # a single check (add --dry-run to download and verify only)
```

The watcher downloads through the Worker — the GitHub repository is private, so the device
holds no token — verifies the release's SHA-256 from its `version.json`, and then installs
with `vega run-app`. Leave it running while testing and a pushed release reaches the device
without a manual package copy.

To publish one, bump `version` in `package.json` (the app reports that same value, so the tag
and the running build cannot disagree) and release it:

```bash
npm run release:app          # builds, tags v<version>, uploads the vpkg + version.json
npm run release:app -- --skip-build
```

## Fire OS / Fire TV (APK)

The Fire TV build is an Android app that shares this project's screens: Metro in `firetv/`
bundles the same `src/**` the Vega build does, so the two cannot drift apart. It plays through
ExoPlayer (AndroidX Media3) and takes its catalogue, streams and subtitles from the same backend.

```bash
bash firetv/scripts/build-apk.sh                  # capped build, no Gradle daemon; writes dist/snas-<version>.apk
bash scripts/android-device-start.sh              # headless TV-profile emulator on port 5556
ANDROID_SERIAL=emulator-5556 bash scripts/android-journey.sh   # installs, then journeys every tab
ANDROID_SERIAL=emulator-5556 bash scripts/android-journey.sh --no-install
bash scripts/android-device-stop.sh               # when finished
```

The emulator is started with the AVD's touchscreen removed, headless, and with its own memory and
core limits rather than the host's. A real Fire TV has no touchscreen and is never in Android's
touch mode, and the app is written for that device: an emulator that keeps a touchscreen silently
refuses the app's focus requests and looks like an app that never focuses anything. What was
observed, and what could not be observed without physical hardware, is in `TESTING.md`; results,
screenshots and accessibility trees land in `research/android/`.

Updates work the same way as on Vega. The APK asks `/v1/app/latest` on launch, and the host-side
installer pushes a release onto a device without anyone copying a package by hand:

```bash
npm run device:update:once -- --device emulator-5556   # an adb serial installs the APK with adb
npm run device:update -- --device VirtualDevice        # the Vega device installs with vega run-app
```

A release carrying no APK says nothing to a Fire TV, and a release carrying no `.vpkg` says nothing
to a Vega device: the check only reports a build the device could actually install.

Publishing the APK works the same way as the Vega package — bump `version` in `package.json` and in
`firetv/package.json` (Android writes that one into the APK, and the script refuses a release whose
tag disagrees with it), build, then release:

```bash
bash firetv/scripts/build-apk.sh
npm run release:app -- --skip-build --apk-only
npm run release:app -- --skip-build                 # APK and Vega package together
```

One release can carry both artifacts, which is what `--skip-build` without `--apk-only` does once
`dist/` holds both builds.

## TMDB catalogue

SNAS needs no credential of any kind, and there is no field to enter one. The catalogue is served by the SNAS backend; the committed, non-secret `src/backend.json` holds the endpoints the app builds against:

- `tmdbProxy` — the Supabase `tmdb` function, an allow-listed read-only TMDB proxy that keeps the TMDB key in its own environment variables. The app never sees the key.
- `workerBase` — the `snas-movy` Worker that returns playable sources and the subtitle menu.

No third-party credential ships in the app package or appears in this repository.

When the backend is unreachable, About offers an explicit fallback to a snapshot of 52 genuine films and series with real season records. Snapshot provenance is in `src/catalog/SOURCES.md`; its categories are curated, not current popularity rankings.

Live mode uses API v3 trending/discovery/search/details/credits/recommendations/videos/seasons, page loading, five-minute bounded caching, in-flight deduplication, ten-second request cancellation, and accurate TMDB rating labels. A backend error remains an actionable error until sample mode is chosen.

This product uses the TMDB API but is not endorsed or certified by TMDB.

## Remote controls

Arrows move focus; Select activates; Back returns. Search has an on-screen keyboard accessible entirely by D-pad. Player controls support pause/play, ±10-second seeks, audio/subtitle choices, screen fit, speed, episode selection and next episode. Back closes a menu, then hides controls, then exits. Dedicated Exit returns immediately. Continue Watching uses real simulated progress, with completed entries removed at 95%.

Screen fit exists because these streams are wider than the television: the backend's HLS ladder is cinemascope (2592×1080 at 1080p, 3840×1600 at 2160p), so a fit that preserves the picture leaves bars above and below it on a 16:9 panel. **Fill** is the default and uses the whole screen, trimming the sides; **Original** keeps the film's own shape with bars; **Stretch** distorts it to fit. The choice is remembered with the other preferences, and while a stream is still being opened the player shows a spinner rather than a timeline that has not started yet.

SNAS opens on a launch screen before anything else mounts. `src/catalog/preload.ts` collects the artwork home is about to paint — the hero backdrop first, then every poster and wide-thumbnail — and fetches it five at a time, so the first screen appears with its images already cached instead of asking for a hundred and thirty-five in one burst as the rails mount. The wave is bounded (a 30-second budget, 15 seconds per image) and a failure or a slow network ends it rather than holding the launch.

Watchlist, progress per episode, and preferences use the Vega-supported AsyncStorage port. Destinations mount on first visit, then stay mounted behind details and playback so queries and browsing state return to their previous position.

## Automation and evidence

The official Appium 2.2.2 / Vega driver 3.34.1 test tools are installed locally under `research/automation`. They use Node 22 and the SDK's VDA path, never the user's host mouse.

```bash
source /home/primeecto/vega/env
vega exec vda shell 'touch /tmp/automation-toolkit.enable'
bash scripts/appium-start.sh
# scripts/device-test.mjs exposes screenshot/source/remote/element helpers.
# scripts/e2e.mjs is the recorded journey script; read its initial-state comment.
systemctl --user stop snas-appium.service
```

See `TESTING.md` for actual results and limitations. Device screenshots are in `.impeccable/review/`. No browser preview is represented as a Vega test.
