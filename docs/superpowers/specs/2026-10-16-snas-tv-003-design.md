# SNAS TV 0.0.3 design

The supplied release brief delegates product/design decisions and explicitly authorizes proceeding after the audit. The baseline audit is `docs/UI_UX_AUDIT.md`.

Preserve shared React Native architecture, ink #0C1015, sand #E8B77C, factual metadata/artwork and native TV conventions. Replace the prototype composition with a restrained cinema library: 56-unit safe edges, an 80-unit navigation bar, complete bounded backdrop fades, clear 48–52 unit title typography, 18–20 unit body copy, consistent squared controls and larger portrait covers. Avoid decorative glow, glass, invented claims or category labels above headings. Focus uses warm fill plus a contrasting frame; active navigation keeps an underline. Motion is short and honors reduced-motion preferences.

Home gives the hero a controlled height and shows the first discovery rail. Details preserve full synopsis, episode/season/cast/related content and explicitly restore scroll with focus. Browse fills seven columns and retains filters/pagination. Search separates a centered remote keyboard from results, with useful initial/error/empty states. My List distinguishes saved portrait titles from landscape continue-watching progress. About becomes a structured information/settings surface with version, correct target capability, attribution and catalog switching. Player separates transport from options and gives unavailable streams a truthful retry state; preview simulation is explicit and does not create progress accidentally.

Android APK remains the release target; Vega source compatibility remains checked, without promising a newly tested Vega runtime. The existing debug signing configuration must be disclosed. Publication uses gh and requires verified authentication/tag availability; absent credentials are a blocker, never a reason to fake publication.

## User-directed replacement after rejected first pass

The user rejected the first implementation as insufficiently changed and sloppy, specifically citing genre selection, a basic uncentered player, and universal size-only refinement. This supersedes the first pass's squared-control commitment. Keep the recognizable ink/sand color identity and factual integrations; replace the interaction/composition language.

- Home: composed feature artwork with protected subject framing, concise whole-sentence copy, two primary decision actions; first collection fully readable. Personal progress stays landscape and other discovery stays poster-based.
- Browsing: compact All genres / Sort triggers, stable grid and a focus-trapped native right sheet with a two-column genre chooser. Select commits; Back dismisses and restores the trigger. No inline expanding chip strip.
- Player: centered large circular transport, timeline and elapsed/duration alignment; small utility controls for Audio, Subtitles and Settings. Quality, fit and speed live in structured settings menus rather than a button wall. Context and exit form an aligned upper band. Errors replace playback controls with a centered recovery composition; raw backend/native error strings do not ship as UI copy.
- Control hierarchy: restrained six-unit button corners, circular icon controls, text navigation tabs, selected list rows and genuine card focus frames. Distinct selected and focused treatments. No invented availability claims.
- Search: purposeful two-zone keyboard/results with modest initial guidance and actual catalog suggestions, not a giant marketing empty state.
- My List: local section controls near heading, compact centered empty state, full landscape resume cards when populated.
- Settings: left-side section navigation with right-side explanation and actual selected catalog choice; legal/remote guidance in their own sections.
- Details: deliberate split artwork/decision composition, compact season selection and meaningful episode fallbacks rather than identical show backdrops.

Shared integration contracts owned by root: `IconButton` in controls.tsx, props `id,label,icon,onPress,onFocus?,size?,primary?,caption?,selected?,disabled?`; `TVOverlay` in TVOverlay.tsx, props `visible,onClose,initial,title,subtitle?,children,width?,testID?` renders a native focus-trapped right sheet on a scaled 1280×720 canvas. Other agents may create screen-local components but must not edit shared controls, focus, icons, App, theme or adapters.

The user additionally requested broader genres including Westerns. Retain canonical TMDB movie/TV IDs, expose all 19 movie and 16 series categories, label Western as Westerns in the chooser, and verify remote access to the scrolling lower rows.

The user requested a concept presentation without preview text. Remove repeated preview/no-media banners, simulated option suffixes and placeholder subtitle text. Keep one quiet Concept status and accurate playback capability information in About.
