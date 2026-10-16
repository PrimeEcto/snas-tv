# SNAS TV product and UI audit — 0.0.2 baseline

Audit date: 2026-10-16. Recorded before frontend edits. Scope: the shared React Native UI, Android Fire TV target, Vega adapter, catalog proxy, player, library, updater and build/release paths.

## Verdict

The product has useful working foundations, but the presentation and playback language still describe an older prototype. It is recognizably a streaming app rather than a web wrapper; visible Android system chrome, discontinuous artwork masks, cramped secondary controls and inaccurate states prevent a premium TV experience. Release validation also has known failures. This is an Operate surface: remote usability, factual content and immediate feedback govern the redesign.

| Dimension | Score / 4 | Verified reason |
|---|---:|---|
| Accessibility | 2 | Controls are labeled and focus is framed; small secondary labels, no reduced-motion handling, and crowded player controls remain. |
| Performance | 3 | Cached requests, bounded artwork prefetch and virtualized rails exist; all rails mount together and startup can wait on many images. No physical-stick performance evidence. |
| Appearance | 2 | Coherent ink/sand palette; hero masks break at container boundaries, inconsistent screen spacing and default rectangular keyboard alignment. |
| Platform conformance | 2 | Native D-pad/Back integration; system bars visible over content, landscape requested on application rather than activity, nested filter Back not handled. |
| TV adaptivity | 2 | Uniform 1280×720 canvas; 1080p observed, font scaling/720p not freshly verified, long player action rows can exceed width. |
| **Total** | **11 / 20** | **Significant work required; not a release-readiness certification.** |

Phone Material guidance is intentionally subordinate to the requested Fire TV remote conventions. A television does not need phone bottom navigation, touch gestures, light mode or a floating action button.

## Architecture and product inventory

- Root project: React 19.2 / React Native 0.83, Amazon Vega template and VPKG build. `firetv/`: Android Gradle application with shared `../src` screens, Android focus/key adapters, SVG gradients and Media3 ExoPlayer through react-native-video. APK production is supported; no migration is needed.
- `src/App.tsx`: scaled TV canvas; persistent Home/Movies/Series/Search/My List/About tabs; details stack; full-screen player; library hydration; artwork launch gate; update banner. Visited screens remain mounted under inactive focus scopes.
- `CatalogScreen.tsx`: cinematic hero, continue-watching and eight discovery rails; genre/sort/pagination grids; saved/continue library sections.
- `DetailsScreen.tsx`: title artwork, metadata, full synopsis, save/play, seasons, episodes, cast, related titles and promotional-video metadata. Trailer entries are metadata, not playable buttons.
- `SearchScreen.tsx`: six-column remote keyboard, debounce, paginated real movie/series results and actionable network errors. No native keyboard required.
- `PlayerScreen.tsx`: quality/audio/subtitle/speed/aspect/episode menus; backend source selection; real Android media clock; simulated Vega/failure clock; progress persistence; remote media keys; auto-hide and two-stage Back.
- `catalog/service.ts`: server-side TMDB proxy, normalizers, five-minute promise cache, timeout, genuine bundled sample records, TMDB artwork. Eight live rails are real discovery feeds, not availability promises.
- `state/`: AsyncStorage library, validation, deduplicated saved titles, per-episode progress, remembered preferences and completion pruning.
- `worker/` and Supabase functions: existing source/subtitle/catalog integrations and server-side credentials. These must remain connected; no fictional catalog, profiles, ratings or subscription features are justified.
- Release: paired root/Fire TV package versions, Vega manifest, Android version derived by Gradle, existing APK-only release script and backend update feed. Android release currently uses the repository's **debug signing key**, not production signing.

## Baseline evidence and limits

- Working tree initially clean; branch `main`; origin `https://github.com/PrimeEcto/snas-tv.git`; latest commit `e9e4339`; local versions 0.0.2. Work isolated on `codex/snas-tv-0.0.3` after inspection.
- `npm test`: **45 passed**. Worker tests: **51 passed**. Root typecheck passes. Fire TV typecheck fails on subtitle track types. Lint: **9 errors, 182 warnings**; failing hooks are listed below.
- Installed existing `dist/snas-0.0.2.apk` on headless Android 15 x86_64 emulator `emulator-5556`, TV display 1920×1080, D-pad events only. No host input injection. Baseline journey: `research/v003/baseline-journey.log`; copied screenshots/trees under `research/v003/baseline/` when the run finishes.
- Fresh baseline observations before implementation: launch, live Home, Movies, Series, one-letter real search and empty My List passed. Full journey results and screenshots are preserved separately; source inspection is not counted as a device pass.
- Fresh Home capture shows Android status/navigation bars, title and controls, populated artwork and a hard horizontal mask boundary below the hero. Search capture shows left-aligned letter glyphs inside large key cells and a redundant full-width Search action despite automatic results.
- No physical Fire TV, production signing key or authenticated GitHub CLI was established during baseline. GitHub publication and remote tag conflict checks must be retried before shipping. Do not infer them from local history.

## Prioritized findings

| ID | Severity / priority | Screen / source | Finding and impact | Required solution |
|---|---|---|---|---|
| A01 | Critical / P0 | PlayerScreen | Stream failures/timeouts enable the simulated clock automatically; periodic saves can create continue-watching progress without watched media. A spinner timing out is not playback. | Explicit unavailable state, Retry and opt-in simulated preview; save/tick only actual media or requested preview. Preserve Vega preview capability. |
| A02 | High / P1 | Android MainActivity, manifest, styles | Status icons and gesture bar overlay TV content in fresh capture. Orientation is attached to application rather than activity. | Immersive activity with system-bar recovery and activity-level landscape. Validate actual native screenshot. |
| A03 | High / P1 | Home / Details artwork | Backdrops extend beyond hero containers; the horizontal mask stops before the image and creates a rectangular seam. Tall hero pushes rail labels below initial viewport. | Shared bounded artwork treatment with complete fades; shorter, deliberate hero, visible collection hierarchy. |
| A04 | High / P1 | App About, Home footer, play actions | Android real streaming described as 'native Vega', 'No movie ... playing', 'Simulated playback', and 'Play preview'. These claims disagree with actual capability. | Platform-aware playback capability and labels; accurate About with version, catalog status, attribution, remote help and existing catalog controls. |
| A05 | High / P1 | Player action row | Episodes adds another full labeled action to an already crowded eight-control row. Long quality labels further expand it. Tiny 13–15 unit clock/status text harms couch reading. | Separate transport and option groups; readable timeline; selected menu option gets focus and accurate explanation. |
| A06 | High / P1 | firetv/player/android.tsx | `language: 'und'` / literal track MIME fail the installed library's types. Gradle does not run tsc, so successful builds hide this failure. | Use library track enum and a valid language value with typed source; require both target typechecks. |
| A07 | High / P1 | CatalogScreen, DetailsScreen, SearchScreen, App, focus | Nine hook dependency errors, unstable request closures, async generation cleanup and omitted autoFocus dependency. Blind dependency insertion could refetch on every render. | Stable callbacks/effects and stale-request guards with explicit dependencies; no blanket lint suppression. |
| A08 | Medium / P2 | Browse filter menu | Back leaves Movies/Series instead of dismissing genre/sort choices. | Active-scope Back handler dismisses the local menu first. |
| A09 | Medium / P2 | Cards / grids / episodes | Seven-column grid has unused width; 13-unit metadata; episode row has no explicit scroll-to-focus. Details hero actions do not restore scroll to top after lower content. | Central card measurements, readable secondary labels, focus-driven scroll on both axes and hero restoration. |
| A10 | Medium / P2 | Search | Initial result panel is mostly unexplained space; oversized generic heading and uncentered keys. Results can remain from prior query while a new request fails. | Clear Search heading, centered consistent keys, explicit initial/no-results/error compositions, stale-results clearing, bounded query length. |
| A11 | Medium / P2 | My List | Empty state duplicates large headings; saved/continue look identical even though resuming benefits from landscape art and progress. Copy calls all activity a preview. | Purposeful quiet empty state, count tabs, progress-aware continue cards; truthful platform copy. |
| A12 | Medium / P2 | Shared buttons / focus | Disabled state has no accessibility state; no shared geometry/type tokens beyond palette; focus animation ignores reduced-motion setting. | Semantic disabled state, practical shared type/space/card tokens, motion preference support without delayed focus. |
| A13 | Medium / P2 | Startup / offline | Genuine fallback data exists but live failure hero displays a sample title before the error explains why. Startup prefetch is bounded but its per-image wait can overshoot the overall budget. | Explicit sample fallback label on live failure; cap each pending image wait to remaining wave budget; retain full preloading behavior requested by earlier product brief. |
| A14 | Medium / P2 | Build / release / docs | Root docs describe Vega-only capabilities; APK release key is debug. Existing runtime journey is 0.0.1 while 0.0.2 release was not installed. | Fresh 0.0.3 installation/journey, truthful platform/signing notes, APK metadata/signature/checksum, tag conflict and upload checks using gh. |

## Strengths to preserve

Real metadata and artwork with explicit TMDB attribution; safe server-side credentials; sample catalog recovery; cached network requests; persisted library validation; native remote event bridge; hidden-screen focus guards; consistent neutral palette and warm focus; real Android player isolated behind platform adapters; reproducible headless scripts and constrained build resources. No framework replacement, paid artwork fabrication or unrelated backend deployment is needed.

## Implementation sequence

1. Regression tests for playback truth and startup deadlines; record failure before fixes.
2. Fix release-blocking state/types/hooks and Android immersive shell.
3. Establish the TV design foundations and shared hero, controls, cards, empty/error states; redesign every primary surface using real data.
4. Build release APK; run unit/worker/lint/both typechecks; D-pad journey, error recovery, long-title/menu/focus and 720p/1080p checks. Batch visual inspection and corrections; independent finish review.
5. Set both app versions and Vega manifest to 0.0.3, inspect package/signature, prepare release notes/checksums, check remote conflicts, commit and publish with gh if authentication permits. Record exact blockers otherwise.
