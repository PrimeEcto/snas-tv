# SNAS
<!-- impeccable:product-schema 1 -->

## Platform
Vega OS television application (native React Native; neither Android Fire OS nor a browser wrapper).

## Stack
Official Amazon Vega template and supported SDK runtime, as explicitly delegated in the project brief.

## Users
Television viewers browsing movies and series with a D-pad remote from a couch.

## Product Purpose
A runnable, premium streaming concept with genuine entertainment metadata and artwork, live TMDB discovery, persistent personal lists, and an honest simulated player.

## Operating Context
Develop and test in the official Vega Virtual Device at television resolution. No licensed movie or episode playback; the player advances a simulated timeline. The catalogue credential is held server-side by the SNAS backend (a Supabase edge function environment), never by the app, and an unreachable backend must preserve a usable genuine sample catalog.

## Capabilities and Constraints
Home, Movies, Series, Search, My List, Continue Watching, title details, seasons and episodes, related content, focus restoration, audio/subtitle/settings menus, seeking and episode progression. Never fabricate ratings, catalog records, emulator results, licensing, or compatibility. Keep every credential in a server-side environment or a git-ignored local file; nothing sensitive ships in the app package or the repository.

## Brand Commitments
SNAS. Cinematic, understated, content-first; Apple TV as a craft reference, with an original identity. Restrained gradients for legibility, consistent focus cues, readable typography, calm transitions.

## Evidence on Hand
The authoritative project brief is docs/BRIEF.md. Empty repository at start. Real metadata source: TMDB, reached through the backend catalogue proxy with explicit attribution, plus genuine demo records.

## Product Principles
- Remote navigation must remain predictable and visible.
- Artwork and content establish atmosphere.
- Every visible control has a meaningful effect.
- Persist actual simulated user progress.
- Document observed test results and exact blockers.

## Accessibility & Inclusion
Couch-distance legibility, strong contrast, visible focus on all controls, D-pad-only access to every flow.
