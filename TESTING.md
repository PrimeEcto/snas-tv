# SNAS testing record

Test date: 2026-10-13. Actual observations only; implementation is not counted as a device pass.

## Environment and build

- Pop!_OS24.04 x86_64; user's i9-11900KF,32GB RAM,RTX4070Super.
- Official Vega SDK0.24.12112,CLI1.4.4,existing Vega Studio0.24.1 retained.
- RN0.83 / React19.2 / React Native for Vega4; manifest VegaOS1.2.
- Official VVD reports tv,x86_64,vvrp-tv-x64,OS1.2,inDeveloperMode=true.
- `npm run typecheck`: passed (research/typecheck.log).
- `npm test`: 19 tests passed (research/unit-tests.log).
- `npm run build:tv`: passed; native manifest validation zero errors; `dist/snas_x86_64.vpkg` produced.
- Package installed and SNAS actually launched in the official VVD. Reproducible logs: research/snas-build.log, snas-launch.log, final-launch.log.
- Vega Studio UI project discovery was not inspected; foreground tooling avoided after the user's resource/input constraint.

## Headless testing method

After the initial visible VVD grabbed the user's mouse, all subsequent work stayed inline. Official `--no-gui` mode, systemd user CPU quota150%,4GB maximum RAM,Nice15. Two Metro workers and similarly capped builds. Appium2.2.2 / official Vega driver3.34.1 with Node22, CPU50%,1GB RAM. Commands and screenshots target the guest only; no host mouse/keyboard injection.

Native Appium screenshots at1920×1080 are in `.impeccable/review/`. QMP screendump was black and was not used as app evidence. No browser rendering is represented as a Vega test.

## Passed device observations

The first interaction record (`research/e2e.log`) independently verified:

- Native Home rendered genuine Interstellar artwork, metadata and populated portrait rails.
- Native Movies rendered a substantial real catalog with correct poster proportions.
- Movie details displayed the matching synopsis, runtime, director and cast.
- Home → details → Back navigation worked using native remote key events.
- Watchlist addition appeared in My List.
- Player pause froze the visible time; seeking advanced it.
- Audio, subtitle and speed menus opened, accepted choices and closed.
- Player Exit returned to the prior application surface.
- Native genre navigation reached Science Fiction using D-pad scrolling.

Screenshots are real emulator compositor captures, not static mocks. Tests used both native D-pad events and Appium element activation. The complete D-pad-only matrix remains separate from mixed-input journey evidence.

## Catalog and state tests

- No backend configured: populated genuine sample catalog, broad rails, local search, distinct movie/TV types, two movie pages, actual season/episode records.
- Provider normalization, empty queries, omitted people/malformed titles, accurate rating attribution, missing fields.
- Request deduplication/cache boundaries and genre/sort/page query parameters.
- An unavailable backend and offline failures do not silently claim live success, and the device attaches no credential of any kind; the tests assert the catalogue-proxy request contract.
- A real invalid-token TMDB request returned the intended actionable credential error (research/live-api-error.log). That check predates the proxy, under which the device sends no credential at all.
- All52 demo poster URLs returned HTTP200 (research/artwork-validation.json).
- Pause/resume/speed, clamped seeks, completion, distinct movie/series/episode keys,95% removal, ordering and schema validation.
- Regression tests prove genuine string years and null artwork survive serialization; episodes without still images also survive.

Successful live discovery/search from the device has not been tested. The credential model changed after this session: the app holds no TMDB key and reads the catalogue through the Supabase `tmdb` proxy, whose routes were verified over HTTP — search, discover, trending, movie detail with its IMDb id, TV season episodes and unknown paths returning 404 — rather than on the device. API success tests use controlled provider responses and are not called live-network passes.

## Defects found and corrected

1. Hidden native TextInput crashed RN0.83's native controller. A minimal native runtime control worked; removing the hidden input stopped the reproducible crash. Search now uses an entirely remote-operated keyboard.
2. Rounded native clipping made buttons/artwork absent in the tested renderer. Square corners restored visible surfaces and focus frames.
3. Persistence validator expected numeric years and non-null artwork, while genuine catalog records use string years and nullable images. Failing regression test reproduced data loss; schema fixed;19 tests pass.
4. Filters and final-page loading could remove the focused control. Focus returns to the active filter trigger; page-loading footer retains a meaningful Back to first title action.
5. Hidden scopes could receive imperative focus requests. Active-scope guard added; only content owns initial focus; preferred TV focus API used where available.
6. Excess startup work: destinations now mount on first visit and remain mounted for restoration. Percentage progress inside auto-sized cards replaced with explicit dimensions.
7. MemoryHigh3GB caused reclamation stalls despite a4GB maximum. MemoryHigh now equals the unchanged hard maximum.

## Environment failures and investigation

- `--no-gl-accel` headless mode did not expose a useful compositor; normal headless rendering used.
- Early CLI “ready” appeared before package-manager services were usable; device-info readiness check added.
- Inconsistent native service state was investigated with guest journals; fresh userdata control preserved prior data in research/vvd-data-backup.
- Later launches hit LCM AppNotResponding / Lifecycle Callback / Creating surfaces. A documented development-only timeout override allowed diagnosis; it was cleared before a clean headless restart of VVD.
- Appium startup and session timeout races were identified; readiness must be awaited and long sessions explicitly configured.
- Native SDK logs include SVG parent-null repaint messages during hidden/unmounted transitions. These were observed, not suppressed.

## Final verification status

The clean headless VVD restart restored normal startup. SNAS subsequently launched repeatedly through the normal lifecycle with the diagnostic watchdog override cleared. The final release was installed and launched successfully (`research/final-install-launch.log`). The complete matrix below reflects successful observations from `research/e2e.log`, `research/e2e-continuation.log`, `research/e2e-last.log`, and `research/e2e-results.json`.

| Journey | Observed result |
|---|---|
| Home, Movies, movie metadata and Back | Pass |
| Watchlist toggle and collection | Pass |
| Pause, seek, audio/subtitle/speed selection, Exit | Pass |
| Remote genre selection and page loading | Pass |
| DUNE keyboard search, detail/Back preserves query | Pass |
| ZZZZZ no-results state | Pass |
| Stranger Things season 2 and episode selection | Pass |
| Next episode and episode menu selection | Pass |
| Movie and episode progress in Continue Watching | Pass |
| Terminate app, normal relaunch, saved list and progress restored | Pass |

The search assertion initially failed because native XML exports curly quotes as numeric entities; the corrected assertion verified the actual query and result elements. Earlier offscreen/lazy-screen locator failures were retried after waiting for focus/first mount. Failed attempts remain in the original logs. A package reinstall is a distinct operation from app relaunch and resets demo app data in the tested VVD; the persistence pass used terminate/launch without reinstalling.

Remaining unverified coverage: repeated cold-device stress, the complete D-pad-only matrix, slow-network and image-failure scenarios on device, performance profiling, automatic episode completion over a full native runtime, physical Vega Fire TV and successful authenticated live TMDB mode. Next-episode transitions were exercised manually on device; completion behavior has reducer coverage. Physical devices and Android Fire OS compatibility have not been tested. The package targets the x86_64 VVD. These results establish a working native concept, not exhaustive production certification.

## Final artifact and operation

Final screenshots: `.impeccable/review/home.png`, `movies.png`, `details.png`, `search.png`, `series-details.png`, `player.png`, `episode-player.png`, `about.png`, and `continue-watching.png`. The final release smoke check seeded a saved Interstellar and actual preview progress, then confirmed both survived terminate/normal relaunch (`research/final-smoke.log`). The final collection screenshot shows that persisted Continue Watching entry. The TMDB logo uses the approved SVG rasterized unchanged with rsvg-convert at its original aspect ratio to avoid the native embedded-CSS limitation.

Test services are stopped after verification to release their resource allocations; the final service-state check is retained in `research/final-service-status.log`. To repeat testing, use the headless start/readiness commands in README.md. No foreground emulator is required.
