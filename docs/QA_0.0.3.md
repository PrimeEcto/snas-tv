# SNAS TV 0.0.3 QA record — 2026-10-16

## Scope and environment

The audited baseline was commit `e9e4339`, version 0.0.2. Its native journey passed 13/13 before frontend edits. The audit and initial plan were committed as `65d4efe` before implementation. The user also requested the full genre sets including Westerns and a clean concept presentation without preview banners. The first visual pass was rejected by the user as insufficient; the final work replaces its screen compositions and interaction patterns. First-pass evidence is historical and does not approve the replacement design.

The release target is the Android APK, package `com.snas.tv`. Device QA uses a headless Android 35 Google APIs x86_64 emulator, TV 1080p profile, no touch, D-pad key events through adb. Native screenshots and UIAutomator trees are used rather than browser approximations. The emulator is resource capped; no host pointer or keyboard injection is used.

## Automated verification

| Check | Result |
|---|---|
| App unit tests (`npm run test:unit`) | 52 passed |
| Mounted UI/player/focus regressions (`npm run test:player`) | 16 passed |
| Worker tests | 51 passed |
| Root, Fire TV and Worker TypeScript checks | Passed |
| ESLint | 0 errors; 50 warnings, chiefly existing inline styles and test shadowing |
| Gradle Release APK | Built successfully |
| Independent source review | Three reported regressions fixed and independently rechecked |

Mounted tests cover actual player events, preserving the native playback position through Retry/quality/subtitle changes, URI seek identity, Replay, full duration, seek/menu isolation, failure without fabricated watched progress, recovery after controls auto-hide, failed-page retry preserving prior pages, and focus restoration after temporary Android focus changes. Host mocks cannot establish physical remote or native decoder behavior.

## Native verification

Final standard and extended results are recorded in `research/v003/final-standard` and `research/v003/final-extended`. Only completed assertions in their `results.json` files count as passes. Interrupted runs and initial harness failures are retained separately. A moving video prevented UIAutomator from becoming idle before controls auto-hid; the standard harness now waits for decoder readiness and confirms a paused native clock. An expanded-genre assertion incorrectly required scrolling for Series even though all 17 choices fit; it now requires reachability and checks scrolling only when the initial Western row is clipped. Both original harness failures are retained.

| Native suite | Result | Coverage |
|---|---|---|
| Standard journey | 13/13 passed | Launch, all main destinations, live Search, details/save, collection persistence, About, decoded playback, Back, guest resources |
| Extended journey | 33/33 passed | Genre/sort sheets, full-word and empty Search, settings, seasons/episodes, offline recovery, explicit concept player, nested settings and focus restoration, 1080p/720p and 130% font scale |
| Expanded genres and cast | 19/19 passed | Live Movies and Series Westerns, actual Western metadata, additional genre reachability, selected state, Back/reset and three-column cast hierarchy |

These 65 native assertions were completed in bounded resumed runs, not a single uninterrupted session. The first ten standard navigation/persistence assertions preceded the final text, genre and seek-command changes; the expanded suite rechecked the genre changes and cast, and the standard playback leg was repeated on the final installed APK. The extended capture packet precedes the last seek-command/native-focus-theme fix. Final decoded playback and focused-circle screenshots were captured again on the final APK.

The final real stream was Hope: same-app-process decoder logs contain 211 matching lines, and the confirmed paused native clock advanced from 0:22 to 0:43 after playback. Guest PSS was approximately 293 MiB at that sample; this is an emulator snapshot, not a sustained hardware performance result. The installed APK checksum matches the local artifact. Wi-Fi, mobile data, 1.0 font scale and the default 1920×1080 display were restored after testing.

Native screenshots are local evidence alongside XML trees; image files are intentionally excluded from Git. The independent visual review returned `ship`, with no material fixes open in the final supplied native captures. It is recorded in `research/v003/native-visual-review.md`.

## Package and release limits

Version name 0.0.3; version code 3; min SDK 24; target SDK 35. Native libraries include arm64-v8a, armeabi-v7a and x86_64. `aapt2` metadata and `apksigner` verification are retained in `research/v003/apk-badging.txt` and `apk-signature.txt`.

The Release APK is signed with the repository's Android **debug certificate**, SHA-256 `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`. This is a development sideload artifact, not a production-signed Amazon Appstore upload. Final APK: **43,534,923 bytes**; SHA-256 `84b23e60baa913df845c1fde8231d4318d772a3da4e8c8991b6375393ed0c318`. APK SHA-256 and size are also supplied in `dist/version.json`, `dist/SHA256SUMS.txt` and the adjacent `.apk.sha256` file.

No physical Fire TV was connected. Hardware decoding, real-stick memory headroom, 4K, HDMI/CEC, screen-reader output and long-duration playback remain unverified. Vega shared-source TypeScript compatibility passed; a new Vega runtime/package test was not performed for this Android release. The existing backend and source availability remain external dependencies.

GitHub CLI is installed but has no authenticated account. Remote tag/release availability cannot be established until authentication is available. The clean-tree publication command `node scripts/release-app.mjs --apk-only --skip-build` failed at `gh auth status` with “You are not logged into any GitHub hosts.” The attempt is retained in `research/v003/publication.log`; no push, tag or upload occurred. APK, version manifest, release notes and checksum files are available locally in `dist/`. After local GH authentication is available, the same command performs conflict checks and publishes the prepared artifact. A successful local build is not a published release.
