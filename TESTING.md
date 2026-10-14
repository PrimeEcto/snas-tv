# SNAS testing record

Two builds have been tested on real running devices: the Fire OS APK (the Fire TV build) on a
headless Android emulator, and the Vega package on Amazon's official virtual device. Actual
observations only; implementation is not counted as a device pass.

---

# Fire OS / Fire TV APK — 2026-10-14

APK `dist/snas-0.0.1.apk` (43,494,875 bytes, `com.snas.tv`, versionName 0.0.1, native `x86_64`,
targetSdk 35) built from this tree and installed on an emulator started by
`scripts/android-device-start.sh`.

## Environment and method

- Pop!_OS 24.04 x86_64 on the i9-11900KF / 32GB / RTX 4070 Super workstation; headless
  throughout — no emulator window, no host mouse or keyboard injection.
- AVD `firestick_sim`: the `tv_1080p` TV profile (1080p, `hw.dPad=yes`, no hardware keyboard) on
  the Google APIs `android-35` x86_64 system image, started with `-no-window -no-audio
  -no-boot-anim -no-snapshot -gpu swiftshader_indirect -memory 2048 -cores 2`, detached so it
  cannot die with the shell that started it and bounded by those flags rather than by the host.
- The emulator was made to behave like the hardware: `hw.screen` is rewritten to `no-touch` and one
  D-pad key is sent after boot, because a device with a touchscreen sits in Android's *touch mode*
  where a view's `requestFocus()` is silently refused. A real Fire TV has no touchscreen and is
  never in touch mode, so without this the app looks like it never focuses anything — an artefact
  that sent an earlier round of testing after a focus bug the app did not have.
- Everything is driven with adb remote key events (`input keyevent KEYCODE_DPAD_*`), read back from
  the accessibility tree (`uiautomator dump`) and native screenshots (`screencap`).
  `scripts/android-journey.sh` is the harness; results land in `research/android/results.json`
  with every screenshot and tree beside it.
- The run starts from a freshly installed app (`pm clear`), so "My List is empty" means an install
  nobody has used, exactly as a first launch on a Fire TV does, and it ends by stopping and starting
  the app to check that the collection survived the process.
- Final run: **13 journeys, 13 passed, 0 failed** (`research/android/results.json`).

## Observed on the device

| Journey | Observed result |
|---|---|
| Launch | Home paints with the **LIVE CATALOG** badge: the device reaches the deployed backend |
| Home | Hero (Spider-Man: Brand New Day, TMDB 8.5, real synopsis) with Play preview / View details / My List, and rails of real 2026 titles |
| Movies | Genre and Sort filters, populated poster grid |
| Series | Genre and Sort filters, populated grid |
| Search | On-screen keyboard and query field render, and the tab opens with the first letter key focused: one Select types a letter and the live backend answers — **20 results for “A”**, 20 real cards |
| My List | Empty on a fresh install, and genuinely so: the empty-state copy with `My List (0)` and `Continue watching (0)`, then `My List (1)` once a title is saved |
| About | TMDB attribution and the live/sample catalog switch |
| Details | Synopsis (374-character description on the title checked), season and episode records (`S1 · E1 — Episode 1`), and Play preview / Resume preview beside Add to My List |
| Save | Select on Add to My List flips the control to **Remove from My List**, and the count rises (0 → 1) with the title listed on My List |
| Relaunch | The app is stopped and started again, and the saved title is still there (`My List (1)`): the collection is on disk, not just in memory |
| Movie playback | Real decoding, not a UI timer — see below |
| Series playback | A series episode decodes too: `Law & Order` → Play episode preview → `SNAS · LIVE · 1080p`, with the same ExoPlayer/HLS/H.264 evidence |
| No source available | A title the upstream has no stream for (`The Tonight Show Starring Johnny Carson`, 1962) keeps the screen usable and says *No playable source came back for this title* instead of hanging or crashing |
| Player controls | One arrow key brings the chrome back after it auto-hides; the remote's play/pause button too |
| Update check | Asked on launch; silent, because no release carries a package this build can install |
| Guest resources | `research/android/meminfo.txt`, `cpuinfo.txt`, `top.txt`, `package.txt` |

Playback evidence, logged while the player was open:

- `ExoPlayerImpl: Init … [AndroidXMedia3/1.8.0]` — the player is AndroidX Media3/ExoPlayer, as
  asked, not a hand-rolled surface.
- `HlsMediaPlaylist … parseMediaPlaylist` — ExoPlayer parsed the HLS playlist the backend returned.
- `CCodec: allocate(c2.goldfish.h264.decoder)` … `read media type: video/avc` and
  `CCodec: allocate(c2.android.aac.decoder)` — real H.264 video and AAC audio decoding.
- The player reads `SNAS · LIVE · 1080p` with a progress bar at `3:49` and `1:22:39 remaining`,
  i.e. a genuine container duration, and the clock restarts from the saved position when a title
  is resumed from Continue watching.
- The position advanced while the stream was playing, read from the player's own `player-position`
  node: `0:03` and then `0:16` after twelve seconds of playback, with the remote's play/pause button
  doing the pausing. Two readings of the media's own clock, not of a UI timer.
- The video area's pixels keep changing between screenshots (mean 11.0 then 3.2 of 255 across two
  four-second windows); a frozen frame measures ~0.
- The chrome itself was measured rather than eyeballed: 0 accent-coloured pixels with the bar
  hidden, **518** one arrow press later, and 0 again after the auto-hide. An earlier "controls never
  come back" reading was the harness's own dump taking longer than the six-second auto-hide.

## Defects found and corrected in this build

1. **The app died at startup** with `TypeError: Cannot read property 'useState' of null` inside
   React Native's own `useWindowDimensions`. The bundle contained two copies of React: the shared
   `src/**` screens resolved React from the parent project while React Native used the Fire OS
   project's copy, so hooks read a null dispatcher. `firetv/metro.config.js` now resolves React,
   React Native and every `react-native-*` specifier for the whole graph from one place; the bundle
   went from 1348 to 684 modules and the app launches.
2. **The Fire TV build could not place focus itself.** React Native gates `ref.focus()` on an
   Android feature flag that is off by default (`enableImperativeFocus`), so every focus request the
   shared screens make was a silent no-op: nothing was focused when a screen opened and Android's
   geometric focus search chose instead. That is why the Search tab kept the highlight on its tab and
   sent the next Down press to the results list rather than the letter grid. `MainApplication` now
   installs that one flag — after `loadReactNative`, keeping React Native's own release values for
   every other flag — and the same build focuses the hero's Play control on launch, before a key is
   pressed at all.
3. **The Fire TV build was offered a Vega package.** The launch update check reported
   `Update available: SNAS 0.1.0 · 0.3 MB` — a 0.3 MB `.vpkg`, which Fire OS cannot install. The
   check is now format-aware (an APK build looks for an APK), and a release with nothing this build
   can install produces no banner at all instead of a standing claim the viewer can never act on.
4. **Android never delivered a single remote key to JavaScript.** The `snas-tv` adapter for Fire OS
   was written for a native key-event module that did not exist, so the remote's play/pause,
   rewind and fast-forward buttons did nothing, and once the player's chrome auto-hid after six
   seconds nothing could bring it back — the screen had no way to hear a key. `MainActivity` now
   reports every key to the device event emitter (`RemoteKeys.kt`) and the adapter maps the D-pad
   and media key codes onto the event names the shared screens already switch on.
4. Harness defects that produced false failures, fixed rather than worked around: `KEYCODE_UP` and
   `KEYCODE_CENTER` are not Android key codes and are accepted silently as nothing (they are
   `KEYCODE_DPAD_*`); a fixed number of presses cannot walk a geometric focus search, so tab and
   control navigation now observes focus at every step; a generic `PORT` in the environment was
   being handed to the emulator, which refuses to start.
6. **Passes that meant nothing**, which is the more dangerous failure, so each assertion now needs
   its own evidence rather than a screen that merely rendered: Search recorded a pass for a query
   that was never typed, "My List is empty" passed with two titles left over from an earlier run, and
   the playback exit accepted anything showing "Play preview" — a detail page shows one too. The
   journey now installs a freshly cleared app so the empty state means something, checks the typed
   letter *and* the backend's answer, checks the saved title after a relaunch, and checks that the
   player is gone and Home's hero is on screen. The clock is read from the player's
   `player-position` node (the chrome also shows a "remaining" count, and reading that one made a
   playing stream look frozen) and with the picture paused, because while the video decodes
   `uiautomator dump` waits for the screen to go idle and its dump outlasts the six seconds the
   control bar stays up.

## Not verified here, and why

- **No physical Fire TV was available.** Both Fire TV Stick generations named in the brief — the
  1st-gen 4K stick and the 4K Fire TV — are the target, and neither could be attached to this
  environment. The emulator is an x86_64 Android 15 image with a TV profile, and it decodes in
  software, so its frame timing says nothing about a stick's hardware decoder. Decode speed, memory
  headroom, startup time and 4K behaviour on those devices remain unverified.
- The journey types a single letter over the on-screen keyboard; typing a whole word with a remote
  was not exercised.
- Playback depends on the movy.sx backend returning a source for the chosen title, and the backend
  is reached from Cloudflare's egress. Status of the streaming path, its rate limits and the relay
  that works around them are recorded in `docs/BACKEND.md`, not here.
- The Fire OS build has no dedicated D-pad-only pass over every rail; the harness walks focus
  observed-step by observed-step, which is stronger than a fixed script but not exhaustive.

---

# Vega OS package — 2026-10-13

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
