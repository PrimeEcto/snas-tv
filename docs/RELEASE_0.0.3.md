# SNAS TV 0.0.3

A coordinated TV interface update across Home, discovery, Search, title details, episodes, My List, Settings and playback.

- Preserves the SNAS ink-and-sand identity, real TMDB artwork/metadata and existing backend integrations.
- Artwork-led Home and poster-led details, with consistent TV safe spacing and readable title hierarchy.
- Full movie and series genre sets, including Westerns, History, Music, Mystery, War, Kids, Reality and more.
- Native genre and sort sheets replace the inline selector; selected choices and remote focus have distinct visual states.
- A dedicated keyboard beside search results, count tabs for saved/resume content and structured Catalog/Remote/About settings.
- A clean concept player with one quiet label and no preview banners.
- Centered circular playback transport, focusable seek timeline, full-duration readout and nested playback settings.
- Android immersive landscape presentation removes system bars from the TV experience.
- Recovery appears immediately after midstream failures, even after controls auto-hide.
- Explicit unavailable-stream recovery and an explicitly opened concept player; failed streams do not generate watched progress.
- Scoped filter Back handling, grid/episode scrolling and focus restoration; failed pagination retries preserve already loaded titles.
- Correct target/version information, TMDB attribution and playback capability wording.
- Retry, quality and subtitle source changes preserve the current playback position; repeated Replay commands each restart completed titles, including when their target is already zero.
- Selecting an already selected season keeps Play available.
- Startup artwork requests respect the overall deadline, including a hanging request.

## Installation and compatibility

Install `snas-0.0.3.apk` using `adb install -r snas-0.0.3.apk` on an Android-based Fire TV with developer access enabled. Package: `com.snas.tv`; version name 0.0.3; version code 3; min SDK 24; target SDK 35. Includes arm64-v8a, armeabi-v7a and x86_64 native code.

The APK is built with Gradle's Release variant and signed with the repository's **Android debug certificate**. It is a development/sideload build, not a production-signed Amazon Appstore artifact. It is not a Vega OS VPKG. Shared Vega source compatibility is checked separately.

No physical Fire TV was attached. Emulator results do not establish decoder performance, 4K behavior or memory headroom on a real stick. Source availability depends on the existing backend; a catalog listing does not guarantee playback.

## Verification

See `docs/QA_0.0.3.md` for the final test matrix, package checksum and remaining limitations. APK checksum is also supplied beside the package and in `version.json`.

Genre IDs were checked against the [official TMDB genre definitions](https://developer.themoviedb.org/openapi/tmdb-api.json).
