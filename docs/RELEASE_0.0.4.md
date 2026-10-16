# SNAS TV 0.0.4

Playback on a constrained Fire TV. The previous build opened every title on the heaviest rendition
the ladder offered and had no route down from it, which is what a 1st-gen Fire TV Stick 4K cannot
take.

- **A rendition the device's decoder refuses is stepped over instead of ending playback.** The app
  now walks the quality ladder down from the rung that failed, resumes at the viewer's exact
  position, and says so quietly on the transport line. Playback only becomes unavailable once the
  lowest rung has failed too.
- **The default quality never falls back to the tallest rung.** With no 1080p rung available the app
  used to start on 2160p — the rendition a constrained decoder is least able to open. It now starts
  below 1080p and leaves the top of the ladder to the quality menu.
- The failure this responds to, and the evidence behind it, are recorded in
  [docs/FIRETV_STICK_PLAYBACK.md](docs/FIRETV_STICK_PLAYBACK.md): the backend's HLS ladder is
  ultrawide H.264, so the rendition labelled `1080p` is 2584×1080 High Level 5.0 and `2160p` is
  3832×1600 High Level 5.1, against a decoder on that model that is documented failing to allocate
  its output buffers at decoder start.

## Installation and compatibility

Install `snas-0.0.4.apk` using `adb install -r snas-0.0.4.apk` on an Android-based Fire TV with
developer access enabled. Package: `com.snas.tv`; version name 0.0.4; version code 4; min SDK 24;
target SDK 35. Includes arm64-v8a, armeabi-v7a and x86_64 native code.

The APK is built with Gradle's Release variant and signed with the repository's **Android debug
certificate**. It is a development/sideload build, not a production-signed Amazon Appstore artifact.
It is not a Vega OS VPKG.

## Verification

`npm run test:player` 19 passed, `npm run test:unit` 52 passed, `npm run typecheck` clean, ESLint on
the changed files reports 0 errors. Three of the player tests are new and cover this change: a failed
rendition steps down and resumes at the last native position, the ladder is walked to its bottom
before playback is called unavailable, and a ladder with no 1080p rung starts below the top.

**No physical Fire TV was attached.** The step-down is driven by a decoder failure that the
emulator's software decoder never produces, so its automatic path has not been watched on a stick;
the device's own log is what confirms which failure that model hits. If a title still fails there,
choose 720p from the player's quality menu: that is the rung this build falls back to, and it is the
cheapest way to confirm the mechanism on the device. Streaming depends on the existing backend and
source availability; a catalog listing does not guarantee playback.
