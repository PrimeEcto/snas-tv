# SNAS TV
<!-- impeccable:product-schema 1 -->

## Platform
android

## Stack
React 19.2 and React Native 0.83 shared television screens. The Android Fire TV target in `firetv/` uses Gradle, Hermes and Media3 ExoPlayer through react-native-video. The original Amazon Vega target remains a separate VPKG build with its own focus/key adapters and a simulated player.

## Users
Viewers browsing films and series with a D-pad remote from a couch.

## Product Purpose
An understated TV streaming application with genuine TMDB discovery and artwork, a persistent personal library and source-dependent Android playback.

## Operating Context
The release artifact is an APK for Android-based Fire TV / Fire OS, package `com.snas.tv`. Validate native TV layouts and remote interactions on the available Android emulator; physical Fire TV decoder performance, 4K behavior and memory headroom require device testing. The existing Release variant is debug-certificate signed for sideloading, not production-signed for Appstore distribution. An APK does not run on Vega OS.

Catalog and media credentials stay server-side in the existing Supabase/Cloudflare services. No credential ships in the app. Catalog listings describe discovery metadata, not guaranteed source availability or licensed access.

## Capabilities and Constraints
Home, Movies, Series, remote Search, My List, Continue Watching, title details, seasons/episodes, cast, related content, catalog switching, attribution, update notifications and focus restoration. Android playback offers transport, quality, source subtitles, original audio, speed, screen fit and episode progression. A native failure or timeout shows recovery actions without advancing a fake clock or saving unviewed progress. Simulation is an explicit optional preview on Android and the supported preview capability on Vega, always labeled. Startup preloads artwork in a bounded wave with progress; network/catalog failures offer Retry and genuine sample data.

Do not fabricate titles, ratings, availability, playback licensing, test results, compatibility, signing status or publication. Do not replace existing service integrations with mock content. Preserve the user's device library and unrelated work.

## Brand Commitments
SNAS. Cinematic and content-first, with cool ink surfaces, warm sand focus, square artwork, gently rounded text actions, circular icon controls, readable native sans and calm interaction. Apple TV, Netflix and Prime Video inform craft and clarity, without copying branding or proprietary layouts.

## Product Principles
- D-pad-only navigation must remain visible, predictable and reversible.
- Genuine artwork supplies atmosphere; chrome stays quiet.
- Visible controls perform their stated action.
- Persist actual media progress or explicitly requested simulated progress.
- Separate verified behavior from source inspection and blocked tests.

## Accessibility & Inclusion
TV safe areas, couch-distance legibility, contrasting focus frames reinforced by fill, labeled controls and disabled/selected states, native Back, and reduced-motion handling. Test at television resolutions and enlarged system text. This is a TV-only surface; phone layouts and touch gestures are not release targets.

## Evidence on Hand
Current release request and findings: `docs/UI_UX_AUDIT.md`. Design direction: `docs/superpowers/specs/2026-10-16-snas-tv-003-design.md`. Native baseline and release QA records: `research/v003/`; final matrix: `docs/QA_0.0.3.md`. `docs/BRIEF.md` records the earlier Vega-only prototype and is historical context, not the current release's capability specification.
