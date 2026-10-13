# PROJECT SNAS — BUILD A PREMIUM, FULLY INTERACTIVE AMAZON FIRE TV STREAMING SERVICE CONCEPT

## YOUR ROLE

Act as a senior product designer, streaming-platform architect, React Native developer, Amazon Vega OS specialist, and quality assurance engineer.

Your task is to independently design, implement, test, and refine **SNAS**, a premium streaming service concept built as a real, runnable television application.

This is not a request for a static mockup, a simple website disguised as a TV interface, or an application filled with decorative buttons that do nothing.

I want a substantial, professionally crafted streaming service that looks convincing enough to imagine being released to the public.

It must include a genuinely populated catalog of real movies and television shows, high-quality artwork, detailed content pages, functional navigation, search, a personal watchlist, persistent simulated playback progress, and a convincing interactive player.

Most importantly, you must **build the application, run it in the official Amazon Vega Virtual Device, test the experience yourself, identify problems, fix them, and repeat the testing process**.

Do not stop after producing source code or a successful compilation.

---

# 1. DESIGN VISION AND BRAND IDENTITY

Use Apple TV as a reference for the quality, restraint, cinematic presentation, and ease of use I want.

Do not copy Apple TV's branding, assets, exact layouts, or distinctive interface elements. Instead, understand the principles behind its excellent presentation and use them to develop an original identity for SNAS.

SNAS should feel like a serious, premium entertainment product designed by an exceptionally good product design team.

### The experience should feel

- Cinematic and immersive without becoming visually overwhelming.
- Premium, modern, understated, and immediately recognizable.
- Carefully art-directed, with excellent typography, spacing, proportions, and alignment.
- Content-first, allowing movie and series artwork to establish the atmosphere.
- Effortless to navigate using a television remote.
- Responsive, fluid, and polished in every interaction.
- Consistent across the home screen, browsing, details, search, and playback.
- Complete and established rather than looking like a newly generated demo.

Develop a cohesive brand identity for SNAS, including its wordmark, colors, typography, iconography, selected and unselected states, motion language, and overall visual character.

Choose the visual direction creatively. Do not simply recolor Netflix, Disney+, Prime Video, or Apple TV.

### Design principles

**Refinement over spectacle.**

The product should look premium because every decision feels deliberate, not because the interface is covered in effects.

Use cinematic photography, restrained gradients where they genuinely improve legibility, subtle transitions, careful layering, and tasteful depth.

Avoid excessive glassmorphism, neon, synthetic-looking gradients, oversized navigation, pointless decorative elements, generic AI-generated interface styling, crowded information, and cheap template aesthetics.

Do not try to make every component special. Create a strong visual hierarchy and let the important moments stand out.

The finished application should feel like a coherent commercial product rather than a collection of individually designed screens.

---

# 2. TARGET PLATFORM, SDK, AND DEVELOPMENT ENVIRONMENT

Before implementing the UI, inspect the current repository, development environment, installed tools, and target platform.

The primary target is **Amazon Vega OS on Fire TV**, using the official Vega development stack and Vega Virtual Device for testing.

Use the current supported Vega application architecture and an appropriate Vega-compatible React Native implementation. Start from the official Vega application template or a verified working example when appropriate.

Do not blindly build a conventional Android/Kotlin application and assume it will run under Vega OS.

### Understand the platform distinction

Amazon Fire TV includes different platform generations and operating-system configurations. Vega OS and Android-based Fire OS do not use interchangeable application packages.

Before proceeding:

1. Read the current official Amazon Vega SDK documentation.
2. Determine which platform the project is targeting.
3. Check the current Vega SDK version and the supported React Native runtime.
4. Check the application manifest requirements, dependencies, package format, and target OS requirements.
5. Verify that the build target is compatible with Vega Virtual Device.
6. If an intended physical Fire TV device uses Android-based Fire OS rather than Vega OS, document that distinction. Do not claim that the Vega application is compatible with an incompatible device.

The primary deliverable remains the Vega OS application and its corresponding package. An additional Android APK is optional only if it would address a separately identified Fire OS compatibility requirement.

Consult the current official documentation rather than relying on outdated examples.

Useful official references:

- Vega SDK overview: https://developer.amazon.com/docs/vega/0.24/vega-overview
- Vega SDK installation: https://developer.amazon.com/docs/vega/0.24/install-vega-sdk
- Vega Studio commands: https://developer.amazon.com/docs/vega/0.24/vega-studio-commands
- Running applications in Vega Virtual Device: https://developer.amazon.com/docs/vega/0.24/run-apps
- Vega application starter tutorial: https://developer.amazon.com/docs/vega/0.24/hello-world

Check the documentation for the current release before installing or configuring anything.

### Install and validate the Vega SDK

Visual Studio Code already has the Vega Studio extension installed.

Do not waste time reinstalling the existing extension unless it is broken or incompatible.

Your task is to install or configure the SDK and the other necessary developer tools.

Proceed as follows:

1. Inspect the installed Vega Studio extension and determine whether a compatible Vega SDK is already available.
2. Check the host operating system, architecture, disk space, required dependencies, and installation location.
3. Read the official installation instructions and follow the supported setup procedure.
4. Install the required Vega Developer Tools and Vega Virtual Device if they are missing.
5. Run the available Vega SDK validation command.
6. Confirm that the CLI is accessible and that Vega Studio recognizes the SDK.
7. Start the virtual device and verify that it boots successfully.
8. Build a minimal template application if necessary to confirm that the complete toolchain works before undertaking the larger project.

The documented SDK installation supports particular native macOS and Ubuntu configurations. Check the exact compatibility of the actual host environment instead of assuming that every Linux distribution is supported.

If the environment is unsupported, investigate a safe, documented workaround. Do not blindly execute installers, make destructive system changes, disable security protections, or silently switch to an unrelated emulator.

The agent is responsible for making the best practical effort to get the supported development environment working.

**Do not stop at SDK installation. The goal is to use the SDK to test SNAS itself.**

---

# 3. NON-NEGOTIABLE REQUIREMENT: SELF-TEST THE APPLICATION

This requirement is just as important as the design.

You must independently launch, inspect, navigate, and test the application using Vega Virtual Device through Vega Studio or the supported Vega CLI.

A successful build is not proof that the application works.

A collection of source files is not proof that the UI is usable.

A screenshot of the home screen is not proof that navigation works.

You must run the actual app.

## The testing workflow

Use the following development loop throughout the project:

1. Implement a meaningful portion of the application.
2. Build it using the supported Vega toolchain.
3. Launch it in Vega Virtual Device.
4. Wait for the application and its initial screen to render.
5. Interact with it using the virtual remote, keyboard controls, or supported test automation.
6. Inspect the actual rendered interface.
7. Exercise the relevant interactions and identify defects.
8. Examine logs and error output when something fails.
9. Fix the underlying problems.
10. Rebuild and repeat the test.

Continue until the application meets the acceptance criteria in this prompt.

### Test the interface visually

Do not rely solely on compilation, linting, or unit tests.

Actually inspect the running application at television resolution.

Check for:
- Misaligned components and inconsistent spacing.
- Clipped or overlapping text.
- Missing, broken, distorted, or poorly cropped artwork.
- Unexpected blank areas.
- Cards that disappear or render incorrectly during scrolling.
- Focus indicators that are difficult to see.
- Unreadable metadata.
- Animations that feel sluggish or disruptive.
- Content that extends beyond the visible screen.
- Incorrect layering, opacity, or gradient treatment.
- Screens that look significantly worse in motion than in a static screenshot.

Capture screenshots of important screens wherever the available tools permit. Review those screenshots and use them to identify visual improvements.

If the agent has computer-use capabilities, use them to operate the visible emulator as a real user would. Otherwise, use the emulator's documented interaction methods and any available automated testing facilities.

### Test with the TV remote

Verify the complete experience using D-pad navigation and the Select, Back, and other relevant remote inputs.

Test:
- Moving between navigation destinations.
- Moving horizontally through content rails.
- Moving vertically between rows.
- Opening a title.
- Opening and closing menus.
- Entering and submitting a search query.
- Adding and removing watchlist items.
- Entering playback.
- Opening playback controls.
- Playing, pausing, and seeking.
- Exiting playback.
- Returning to the correct previous screen.
- Restoring focus and scroll position.
- Resuming partially watched content.
- Selecting a television episode and moving to the next episode.

Pay particular attention to focus handling. Focus must never disappear, jump unpredictably, or get trapped in an inaccessible part of the interface.

### Test failures and edge cases

Intentionally test conditions such as:

- Missing API credentials.
- An unavailable or invalid API key.
- An API request that fails.
- No search results.
- An image that fails to load.
- Empty categories.
- Missing optional metadata.
- A slow network.
- A request made while another request is in progress.
- Returning from a detail page to a previously scrolled catalog.
- Exiting and reopening the application.
- Repeatedly opening and closing playback.
- A partially watched episode.
- Empty My List and Continue Watching sections.

The application must handle these states intentionally and gracefully.

### Check application health

Use the available Vega logging and debugging tools to investigate crashes, warnings, failed requests, navigation failures, and rendering issues.

Use performance monitoring where available to check responsiveness, especially while scrolling through artwork-heavy content rails.

Do not leave known serious errors unresolved and declare the application complete.

### Keep a real test record

Create a `TESTING.md` file documenting:

- Host environment and SDK version used.
- Build commands and their results.
- The emulator used and whether it booted successfully.
- Whether the app actually launched.
- Which navigation and interaction scenarios were tested.
- Which API scenarios were tested.
- Important defects found and how they were fixed.
- Any features that remain incomplete.
- Any tests that could not be performed.

Clearly distinguish tests that passed from tests that were attempted but could not be completed.

If emulator startup or platform compatibility prevents testing, report the exact blocker, investigate it, and continue with all testing that remains possible. Never fabricate a successful emulator session.

**The definition of done is a working, visually inspected, interactively tested application, not a completed implementation plan.**

---

# 4. REAL MOVIE AND TELEVISION CATALOG

The application must be populated with real entertainment metadata and authentic artwork.

Do not populate it with five hardcoded films and call the catalog complete.

Do not invent hundreds of titles.

Do not use the same few images repeatedly.

Do not create fake ratings or fictional synopses.

## Primary data source: TMDB

Use The Movie Database (TMDB) API as the primary metadata and artwork source.

Official documentation:

- Getting started: https://developer.themoviedb.org/docs/getting-started
- Search and query for details: https://developer.themoviedb.org/docs/search-and-query-for-details
- Finding data: https://developer.themoviedb.org/docs/finding-data
- Movie discovery: https://developer.themoviedb.org/reference/discover-movie
- Television discovery: https://developer.themoviedb.org/reference/discover-tv
- Image configuration and URLs: https://developer.themoviedb.org/docs/image-basics

Use the API's search, discovery, detail, and related endpoints appropriately.

### Populate real content

Include as much relevant real-world catalog content as the API, its coverage, and its usage limits permit.

The app should support discovery of a broad range of movies and television series without requiring the entire catalog to be downloaded on launch.

Implement pagination or incremental loading, sensible caching, and appropriate loading indicators.

Populate the experience with real:

- Movie titles and original titles when relevant.
- Television series and episode information.
- Release dates and premiere dates.
- Posters and cinematic backdrops.
- Descriptions and synopses.
- Genres.
- Runtime and episode duration when available.
- Cast and crew information when available.
- Ratings and vote counts.
- Seasons and episodes.
- Related titles and recommendations where supported.
- Trailers or promotional metadata where available.

Use proper image URL construction based on the provider's documented configuration and image paths.

Fetch appropriately sized posters and backdrops for their intended use. Avoid downloading needlessly enormous images or distorting their aspect ratios.

### Broad category support

Create a substantial catalog with meaningful categories such as:

- Trending movies.
- Trending series.
- Popular films.
- Popular television.
- Highly rated titles.
- Recently released movies.
- Upcoming releases.
- New and returning series.
- Action and adventure.
- Drama and crime.
- Comedy.
- Thriller and horror.
- Science fiction and fantasy.
- Romance.
- Animation and anime where supported.
- Documentaries.
- Family entertainment.
- International cinema.
- Award-winning films.
- Curated thematic collections.
- Genre-specific discoveries.

Treat these as inspiration, not a requirement to add a separate navigation tab for every category.

Build content rows that feel editorially curated. Use real API results, sensible filtering, and appropriate sorting rather than simply repeating the popular endpoint throughout the application.

The home screen should have enough variety to feel like a genuine streaming catalog.

### Ratings and attribution

Never misrepresent the origin of ratings.

A TMDB vote average must be labeled as a TMDB rating or otherwise attributed appropriately. Do not label it as an IMDb score.

Only include IMDb-specific ratings when a legitimate, authorized data source supplies them.

Use the attribution and branding required by the selected data provider. Read and follow TMDB's API terms, including the applicable non-commercial and commercial licensing requirements. Since this is a concept, do not represent the result as an officially licensed commercial streaming service.

Do not scrape IMDb pages, circumvent authentication, or bypass access restrictions to collect information.

### API configuration

Provide a simple, documented method for configuring API credentials.

Never hardcode a private key into committed source code or expose a privileged server credential in a publicly distributed binary.

Use a configuration mechanism appropriate for a local development concept. Clearly document what must be configured.

If a key is not available, the app must still launch and demonstrate its interface through a curated set of genuine sample records.

Live API mode and demo fallback mode should be distinguishable internally, and the test documentation should state which mode was used.

Do not let missing credentials result in a blank application.

---

# 5. HOME SCREEN: THE SIGNATURE SNAS EXPERIENCE

The home screen is the most important visual component of the product.

It should immediately communicate that SNAS is a premium streaming platform with a substantial entertainment library.

### Featured content

Create a cinematic featured-content area that uses a suitable backdrop, carefully composed text, and clear actions.

Include the selected title's real name, relevant metadata, a short description where appropriate, and a prominent Play or View Details action.

A secondary action such as Add to My List may be included where it makes sense.

Use suitable contrast treatments so that text remains readable against the artwork.

Do not obscure beautiful imagery with an unnecessarily large opaque card.

Consider restrained animated transitions when the featured item changes, provided they do not interfere with navigation or performance.

### Content rails

Below the featured area, provide multiple horizontally navigable content rails.

Examples include Trending Now, Continue Watching, Popular Movies, Critically Acclaimed, Series Worth Discovering, Recently Added, and curated collections.

Choose a suitable number of rows and balance visual density against ease of navigation.

Each rail should have:
- A clear heading.
- Consistent, well-proportioned artwork cards.
- Carefully measured gaps and alignment.
- Smooth horizontal navigation.
- Distinct, readable focus states.
- Appropriate loading and empty states.
- Real titles and metadata.
- Sensible navigation to details.

Do not make the home screen a static promotional poster followed by a handful of cards.

It should feel like a substantial, browsable library.

At the same time, avoid overwhelming users with an unnecessarily long and repetitive page.

Use hierarchy, selective emphasis, and content variety to make browsing inviting.

---

# 6. APPLICATION NAVIGATION AND SCREENS

Build a cohesive navigation structure designed specifically for a TV.

At minimum, implement the following destinations.

## Home

The cinematic landing page, featuring relevant content and personalized sections based on locally stored watchlist and playback data.

## Movies

A dedicated movie-browsing screen with real catalog results, genre discovery, appropriate filters, and sorting options.

## Series

A dedicated television-browsing screen that supports series discovery and the presentation of episodic content.

## Search

A working search screen for movies and television series.

## My List

A persistent watchlist of titles explicitly saved by the user.

## Continue Watching

A section containing titles with simulated playback progress, including the ability to resume where the user left off.

Add other destinations only if they make the experience meaningfully better.

Prefer a restrained, comprehensible navigation system over a huge sidebar filled with unnecessary destinations.

Navigation must be consistent across the application. Returning from a detail page should restore a sensible previous state instead of unexpectedly restarting navigation at the beginning.

---

# 7. MOVIE AND SERIES DETAIL PAGES

Selecting a content card must open a dedicated detail page for that specific movie or series.

The detail page should be dynamically populated using the actual item's metadata.

### Visual design

Use cinematic artwork as a backdrop or dominant visual element where appropriate.

Create a clean information hierarchy with enough space for the synopsis and important metadata.

Include:
- Title and release year.
- Rating and appropriate attribution.
- Genre.
- Runtime or series information.
- Synopsis.
- Relevant cast and crew.
- Available supporting artwork.
- Related titles where appropriate.

Do not force every type of metadata into the same rigid layout. Make films and television series feel appropriately different.

### Working actions

Implement real interactions for:

- Play.
- Resume, where progress exists.
- Add to My List.
- Remove from My List.
- Browse seasons and episodes.
- Open related content.
- Return to the previous screen.

For television series, show available seasons and episodes, with episode titles, descriptions, durations, and thumbnails where supported by the data source.

Episode selection must change the selected episode and the information displayed.

Opening different titles must always produce the correct corresponding content.

No generic placeholder detail pages shared between unrelated titles.

---

# 8. INTERACTIVE SIMULATED PLAYER

The player must look and behave like an actual streaming player, despite not playing a movie or episode.

Do not require real streaming rights, actual video files, or an external streaming subscription.

This is a UI and interaction concept. Simulate playback honestly and coherently.

### Player presentation

Create an immersive playback screen designed for a television.

Use an appropriately composed cinematic background, restrained on-screen controls, readable time indicators, and a clear sense of focus.

When controls are hidden, the screen should feel cinematic. When the user interacts with the remote, controls should become easy to understand and operate.

Avoid a clumsy desktop video-player layout stretched to fill a TV screen.

### Required controls

Implement:

- Play.
- Pause.
- A simulated timeline and progress indicator.
- Elapsed time and remaining time, or a clearly defined equivalent.
- Seeking backward and forward.
- D-pad navigation among player controls.
- Audio-track selection menu.
- Subtitle selection menu.
- Playback settings menu.
- Exit playback.
- Resume playback.
- Episode information for television content.
- Episode selection.
- Next-episode behavior.
- Continue Watching integration.

Menus should open, respond, and close properly.

If subtitles and alternate audio tracks are not actually available, present clearly simulated choices appropriate for the selected title rather than pretending a real media stream exists.

### Simulated playback engine

Implement a consistent playback state machine.

Maintain appropriate state such as:

- Selected content.
- Selected episode.
- Current playback position.
- Total simulated duration.
- Playing or paused status.
- Control-overlay visibility.
- Selected audio track.
- Selected subtitle option.
- Relevant playback settings.

When the user presses Play, progress should advance over time.

When the user presses Pause, progress should stop.

When the user seeks, the time and progress indicator should update accurately.

When the user exits, the playback position should be saved.

When the user opens the title again, offer or perform the appropriate resume behavior.

For episodes, choosing a different episode must update the selected episode and its simulated playback state. Next Episode should advance logically through the available episode list.

Persist progress locally and update Continue Watching accordingly.

The player must not be a static image with unresponsive controls. Every visible control should have a meaningful, testable effect.

No actual copyrighted film or television playback is required.

---

# 9. SEARCH, WATCHLIST, AND PERSONALIZATION

## Search

Implement genuine catalog search using the provider's documented endpoints.

Search should return real movies and television series and make their content types clear.

Support remote-friendly text input, submission, useful result browsing, loading states, errors, and empty results.

Avoid making search dependent on preloaded, hardcoded titles.

Debounce requests where appropriate and avoid sending unnecessary repeated requests.

If possible, preserve the search query and results when returning from a detail page.

## My List

Allow the user to add titles to and remove titles from a personal watchlist.

Persist changes between application sessions.

Provide a polished empty state that encourages discovery without looking broken.

Watchlist state must be consistent between the home screen, detail pages, and My List.

## Continue Watching

Build this from simulated playback progress rather than static demo cards.

Store the content identifier, playback position, total simulated duration, and episode identity where applicable.

Allow users to resume playback.

Remove or update an item when it is completed, according to a sensible and consistent rule.

## Local persistence

Use an appropriate persistence mechanism supported by the target Vega runtime.

Persist watchlist entries, relevant playback progress, and other useful local preferences.

Verify persistence by exiting and reopening the application in the emulator.

Do not claim persistence works unless you have tested it.

---

# 10. DESIGN POLISH, ANIMATION, AND TV USABILITY

The difference between a basic demo and a premium product is the quality of the details.

Pay attention to the entire interaction experience.

### Motion

Use purposeful transitions for screen changes, card focus, content changes, and the appearance of player controls.

Animations should feel coordinated, calm, and responsive.

Avoid excessive bouncing, slow cinematic transitions during ordinary navigation, unnecessary parallax, and decorative motion that competes with content.

Maintain responsiveness under repeated rapid remote input.

### Focus states

Every interactive element must have a visible focus state suitable for a television.

Explore a restrained combination of scale, border, tonal emphasis, or elevation where appropriate.

Keep cards readable and avoid clipping focused cards at screen edges.

Focus states should be consistent across catalog rails, navigation, menus, detail-page actions, and the player.

### Typography and spacing

Use a clear typographic hierarchy with excellent legibility at television viewing distances.

Choose readable metadata sizes and restrained text density.

Use a consistent spacing system and align corresponding elements across screens.

Long descriptions and titles should be handled with appropriate wrapping, truncation, or scrolling without overlapping other elements.

### Artwork

Treat imagery as a major part of the design.

Use cinematic backdrops for featured content and details, portrait artwork for movie and series cards, and appropriate episode imagery when available.

Maintain correct aspect ratios and intentional image cropping.

Use restrained overlays where necessary for readability.

Loading artwork should not cause severe layout shifts. Provide a visually appropriate fallback when an image fails.

### Performance

Optimize the experience for the actual target device class.

Avoid rendering an unnecessarily large number of expensive components simultaneously.

Use appropriate list virtualization, caching, image sizing, and efficient React Native rendering patterns.

Avoid unnecessary re-renders and memory growth while scrolling between screens.

Test the actual application on Vega Virtual Device instead of assuming performance from a desktop preview.

---

# 11. TECHNICAL IMPLEMENTATION AND CODE QUALITY

Build the real application, not just a design proposal.

Use the current supported Vega project structure and the libraries that are compatible with the selected SDK version.

Before adding third-party packages, verify that they support the Vega React Native runtime.

Prefer dependable, maintainable solutions to complex custom implementations when established components are available.

Amazon's Vega UI component library may provide useful components for carousels or seek bars. Evaluate its current compatibility and capabilities before choosing whether to use it. Do not introduce experimental dependencies simply because they exist.

### Architecture

Keep responsibilities appropriately separated:

- Catalog API access.
- Metadata normalization.
- Image URL handling.
- Search and discovery.
- Navigation and focus management.
- Local persistence.
- Watchlist state.
- Playback simulation.
- Detail-page data.
- Error and loading states.
- Reusable visual components.

Use reusable components for content cards, rails, metadata, buttons, menus, and other recurring elements.

Keep the implementation straightforward enough to debug and extend.

Avoid a monolithic component containing the entire application.

### Reliability

Handle network failures, missing values, malformed responses, and repeated user interactions gracefully.

Use suitable request cancellation or stale-response protection when needed.

Prevent navigation actions from causing duplicate screens or inconsistent state.

Do not ignore rejected requests or suppress serious errors merely to keep the UI looking populated.

### Security

Do not commit credentials or sensitive configuration.

Do not run unreviewed installation scripts blindly or make unnecessary system-wide changes.

Document required configuration and ensure that the app can enter demo mode without private credentials.

---

# 12. IMPLEMENTATION ORDER

Work in stages, but continue through every stage. Do not stop when the first stage works.

## Stage 1 — Environment and application setup

Inspect the repository, verify the Vega development environment, install missing SDK components safely, and validate Vega Virtual Device.

Create or adapt the correct Vega application project and ensure a minimal app can build and launch.

## Stage 2 — Brand and visual foundation

Establish the SNAS identity, typography, color system, screen geometry, reusable components, focus styles, and navigation framework.

Build a polished initial home screen with genuine artwork early in the process so visual decisions can be evaluated in the emulator.

## Stage 3 — Live catalog integration

Integrate the metadata API, implement discovery and search, populate content rails, support pagination, and establish reliable image loading.

Add appropriate demo fallback behavior.

## Stage 4 — Complete navigation and content pages

Build Movies, Series, Search, My List, Continue Watching, movie details, series details, seasons, and episodes.

Verify that all navigation destinations work with the D-pad.

## Stage 5 — Player and persisted state

Implement the simulated playback engine, controls, seeking, menus, episode navigation, playback restoration, and Continue Watching updates.

Verify that state changes are genuine and consistent.

## Stage 6 — Visual refinement

Run the application in Vega Virtual Device and refine the interface based on what actually renders.

Correct layout issues, spacing, typography, imagery, focus behavior, transitions, and performance problems.

Do not limit this stage to reviewing source code.

## Stage 7 — Self-testing and final quality assurance

Run the full interaction checklist, review logs, resolve defects, rebuild, and rerun tests.

Verify the installed application persists state between launches and handles API failures.

Complete `TESTING.md`, confirm the final package exists, and provide exact instructions for reproducing the build and running the app.

**You are expected to use the tools available to you to execute these stages, not merely explain how someone else could execute them.**

---

# 13. ACCEPTANCE CRITERIA

The project is complete only when the following requirements have been addressed.

### Platform and build

- [ ] A valid Vega application project exists.
- [ ] The actual host environment and SDK compatibility have been checked.
- [ ] Vega Studio recognizes the project and SDK.
- [ ] The application builds successfully using the supported toolchain.
- [ ] A runnable Vega package is produced.
- [ ] Vega Virtual Device starts successfully.
- [ ] The SNAS application actually launches in the emulator.

### Design and presentation

- [ ] SNAS has a cohesive and distinctive brand identity.
- [ ] The home screen looks like a polished streaming service.
- [ ] Real cinematic artwork is used appropriately.
- [ ] Typography, spacing, alignment, and focus states are consistent.
- [ ] Content cards render correctly without obvious cropping or layout defects.
- [ ] The interface remains readable at television resolution.
- [ ] Transitions feel smooth and purposeful.

### Data and catalog

- [ ] Live catalog integration works when credentials are configured.
- [ ] Real metadata and artwork appear in the application.
- [ ] Search retrieves genuine movie and television results.
- [ ] Browsing supports meaningful categories and incremental loading.
- [ ] Detail pages show the correct metadata for their selected titles.
- [ ] API attribution and rating labels are accurate.
- [ ] Missing credentials and API failures do not leave the app unusable.

### Interactions

- [ ] D-pad navigation works throughout the interface.
- [ ] Select and Back actions behave correctly.
- [ ] Movie and series detail pages open and close correctly.
- [ ] My List supports additions and removals.
- [ ] The simulated player supports Play, Pause, and seeking.
- [ ] Audio, subtitle, and playback menus respond to navigation.
- [ ] Episode selection and Next Episode work.
- [ ] Playback progress is saved and restored.
- [ ] Continue Watching reflects actual simulated progress.
- [ ] Local state persists after restarting the app.

### Self-testing

- [ ] The running app has been inspected visually in Vega Virtual Device.
- [ ] Remote navigation has been exercised manually or through supported automation.
- [ ] Important user journeys have been tested end to end.
- [ ] Relevant loading, empty, and error states have been exercised.
- [ ] Important defects found during testing have been fixed and retested.
- [ ] `TESTING.md` records actual results.
- [ ] Any remaining limitations are documented honestly.

A checklist item is not considered passed simply because the corresponding code exists.

If a test cannot be executed because a tool or environment is unavailable, record it as blocked or unverified rather than passing it.

---

# 14. FINAL DELIVERABLES

When finished, provide:

1. **The complete SNAS application source code**, organized and ready for further development.
2. **The built Vega application package**, if the supported build environment permits producing it.
3. **A working emulator setup**, with the steps and commands needed to launch the application again.
4. **A configuration guide** explaining how to supply TMDB credentials and use live catalog mode.
5. **A `TESTING.md` report** recording the build, emulator launch, actual test results, defects fixed, and remaining limitations.
6. **A concise README** with installation, setup, build, launch, and development instructions.
7. **Screenshots of the actual running application**, captured from Vega Virtual Device where supported.
8. **A clear list of any outstanding issues** that prevent the concept from being considered fully functional.

Do not respond with only a design description, source snippets, a Figma-like mockup, or instructions for the user to complete the work.

Make sure the source code and generated packages actually exist in the project workspace.

## FINAL DIRECTIVE

Build SNAS as though you are creating the first public demonstration of a premium streaming platform.

The visual design must be genuinely refined. The catalog must contain real content. The interactions must behave coherently. The player must feel convincing. The navigation must be designed for a real television remote.

Most importantly, **run the application, operate it, inspect it, find problems, and fix them yourself using Amazon's Vega development tools and virtual device.**

Do not confuse an impressive screenshot with a finished application.

Do not confuse compiling with working.

Deliver the best complete, runnable, and self-tested concept that the available environment makes possible.