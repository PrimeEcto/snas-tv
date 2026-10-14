# SNAS

A native Amazon Vega OS streaming concept, built from the official React Native 0.83 template. Genuine movie/series metadata and artwork, discovery, remote search, saved titles, episodic details, and an interactive simulated player. No copyrighted video is played.

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
bash firetv/scripts/build-apk.sh                  # capped build, no Gradle daemon; writes dist/snas-0.0.1.apk
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

Arrows move focus; Select activates; Back returns. Search has an on-screen keyboard accessible entirely by D-pad. Player controls support pause/play, ±10-second seeks, audio/subtitle demonstrations, speed, episode selection and next episode. Back closes a menu, then hides controls, then exits. Dedicated Exit returns immediately. Continue Watching uses real simulated progress, with completed entries removed at 95%.

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
