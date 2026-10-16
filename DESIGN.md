---
name: SNAS
description: Cinematic discovery and focused remote control for television.
colors:
  ink: "#0C1015"
  surface: "#191F27"
  raised: "#252D37"
  foreground: "#F5F4F0"
  secondary: "#B6BEC9"
  subdued: "#95A1AF"
  sand: "#E8B77C"
  divider: "#36414D"
  error: "#F0A6A0"
typography:
  display:
    fontFamily: sans-serif
    fontSize: 46px
    fontWeight: 700
    lineHeight: 50px
    letterSpacing: -1px
  headline:
    fontFamily: sans-serif
    fontSize: 36px
    fontWeight: 600
    lineHeight: 43px
  title:
    fontFamily: sans-serif
    fontSize: 24px
    fontWeight: 600
  body:
    fontFamily: sans-serif
    fontSize: 19px
    lineHeight: 28px
  label:
    fontFamily: sans-serif
    fontSize: 18px
    fontWeight: 600
rounded:
  artwork: 0px
  control: 6px
  icon-control: 28px
spacing:
  compact: 8px
  action-gap: 12px
  card-gap: 18px
  section: 28px
  safe-edge: 56px
components:
  button-primary:
    backgroundColor: "{colors.foreground}"
    textColor: "{colors.ink}"
    height: 52px
    rounded: "{rounded.control}"
    padding: 0px 22px
  button-secondary:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.foreground}"
    height: 52px
    rounded: "{rounded.control}"
    padding: 0px 22px
  button-focused:
    backgroundColor: "{colors.sand}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
  icon-primary:
    backgroundColor: "{colors.foreground}"
    textColor: "{colors.ink}"
    size: 56px
    rounded: "{rounded.icon-control}"
  query-display:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.foreground}"
    height: 56px
    rounded: "{rounded.control}"
    padding: 0px 18px
---

# Design System: SNAS

## Overview

**Creative North Star: "The evening edit"**

Genuine artwork carries the atmosphere; precise alignment, readable type and clear remote focus carry the interface. Cool ink surfaces and warm sand feedback suit a television viewed from the sofa. The native Android TV implementation is the current release surface; the shared Vega target remains a separate platform.

Control shapes express their role: rectangular text actions, circular icon actions, square artwork and spacious sheet choices. Browsing, search, title details, settings and playback each have a composition suited to their task. Genre selection uses a dedicated sheet; playback has centered transport and a separate utility hierarchy.

**Key Characteristics:**
- Genuine cinematic photography with integrated legibility masks.
- Quiet ink surfaces, ivory text and sand focus.
- Role-specific controls and distinct screen compositions.
- Predictable D-pad navigation, native sheets and restored focus.
- Honest sample-catalog states and a quiet Concept label.

## Colors

### Primary

Warm sand identifies focused actions, selected indicators and media progress. Ivory is the primary text color and the resting fill of a primary action.

### Neutral

Ink is the canvas. Surface and raised tones separate sheets, secondary actions, query fields and selected rows. Secondary text carries descriptions and metadata; subdued text carries supporting labels. Divider defines low-emphasis structure. Muted coral identifies failures and sample fallback notices.

**The Focus First Rule.** Reinforce focus with shape or a visible frame as well as color. Shared buttons use sand fill, ink content and an ivory frame; artwork uses an ivory frame and modest scale. Header text destinations use an ivory focus field with a sand border. Persistent selection uses an underline, check or radio marker and remains distinct from temporary focus.

## Typography

The Android surface uses the native sans-serif family; the current UI does not request a custom font. The original Vega target may supply its platform font mapping. Frontmatter dimensions describe logical composition units, not physical TV pixels.

Home's display title uses the display role. Main collection, Search and Settings headings use the headline role. Details uses a bold title (43 units, 49 line height). Section titles use the title role. Synopses and descriptions use body text; Home's compact synopsis is slightly smaller (18 units, 25 line height). Buttons use the label role. Metadata is generally 17 units; card metadata is 15 units. The player clock uses tabular numerals.

Card names truncate to one line, while title details retain the full title. Home retains a short synopsis in full and shortens longer text at a word boundary with an ellipsis; details provides the full story when the longer synopsis needs it. Hero synopses use ivory for readability over imagery.

## Layout

The shared canvas is 1280×720 logical units and scales uniformly into the viewport. Native overlays independently use the same canvas calculation. The outer safe inset is 56 units and the shell navigation is 80 units high. The wordmark anchors the left; text destinations occupy the center group; Search and Settings use circular controls at the right.

Portrait cards are 148 units wide with 134×201 artwork and an 18-unit gap. Wide cards are 278 units wide with 264×149 artwork. Collections use seven poster columns; Search uses four result columns beside a 408-unit keyboard region. Rails scroll horizontally and collections scroll vertically. Focused items are brought into view.

Home places a compact, adaptive hero above the first artwork rail. Its hero has a minimum height of 280 units and grows with its content. Details pairs a 178×267 poster with title, metadata, synopsis and actions, followed by episodes, credits and related titles. Cast credits use aligned three-column rows with actor names and roles on separate lines. Backdrop artwork begins behind the copy region and blends into the ink canvas; an opaque leading mask prevents a visible image edge.

Search separates query entry from discovery results with a divider and a 44-unit column gap. Its remote keyboard has eight columns, a centered final row, and adjacent Space, Delete and Clear actions. My List uses local count tabs and a centered empty state. Settings uses a 292-unit section navigation column and a distinct content pane.

## Elevation & Depth

Depth comes from tonal layers, genuine artwork and legibility gradients. The interface has no decorative shadow or glow vocabulary. A native modal window places a solid surface-colored sheet at the right over a dark scrim. The sheet defaults to 560 units wide; genre selection uses 620 and sorting uses 520. Header and content sit inside generous sheet padding.

## Shapes

Text controls and query fields use gently rounded corners. Icon controls are circles sized for their role, with the central player action larger than neighboring transport controls. Poster frames, backdrop artwork and the sheet silhouette remain square. Hairline dividers organize secondary information. Focus frames occupy reserved space so they do not reflow the layout.

Artwork focus scales from 1 to 1.025 over 120ms. Reduced motion removes this transition; native sheet fades also become immediate. Motion serves focus and state feedback.

## Components

### Buttons

Primary text actions use ivory fill and ink content; secondary actions use the raised tone and ivory content. Both are 52 units high, with 22-unit horizontal padding and a two-unit reserved frame. Compact controls are 44 units high. Focus uses sand and an ivory frame. Selection uses a sand border. Disabled actions reduce opacity and leave the focus order.

### Icon controls

Circular buttons default to 56 units, with translucent surface fill, ivory symbols and optional centered captions. Primary icons use ivory fill. Focus uses sand fill and an ivory frame. Header Search and Settings, sheet Close, and player transport use this family at context-specific sizes. Captions supplement the icon where the action needs an explanation.

### Artwork cards

Portrait cards preserve 2:3 artwork. Continue Watching uses landscape artwork and a sand progress line. Focus adds an ivory frame, slightly enlarges the artwork and brightens its title. A failed image shows a truthful title-and-wordmark fallback. Artwork color comes from the actual title image rather than decorative placeholder gradients.

### Genre and sort choices

Compact labeled triggers sit beside the collection heading. Genre selection opens a native right sheet with two columns of spacious text rows. Movies expose 19 genre categories and series expose 16, including Westerns. The sheet scrolls as remote focus reaches its lower rows. Sorting uses a single column. A selected row has a check and surface fill; focus uses sand with an ivory frame. Selection closes the sheet and returns focus to its trigger. Back dismisses the sheet.

### Search query and keyboard

A rounded query display sits above the eight-column native remote keyboard. It is a display, not an editable HTML field. Character keys use the compact button grammar with centered labels. Query changes drive real results; empty search shows genuine catalog suggestions, and fallback suggestions are labeled.

### Navigation and settings

Header destinations use text with a sand active underline; Search and Settings use icons with accessible labels. My List uses local Saved and Continue Watching tabs with counts. Settings separates Catalog, Remote and About sections. Catalog choices show radio markers and a Selected label. Last focused controls are retained across screen changes; hidden focus scopes reject input and focus requests.

### Player

The player has an aligned top context band, a dominant centered circular Play/Pause action flanked by ten-second transport actions, a focusable timeline with elapsed and full-duration labels, and a restrained lower utility group. Audio, Subtitles and Settings open native sheets. Settings groups quality, screen fit and speed before their individual choices. Episodes use the same sheet family.

The screen clearly distinguishes loading, real playback, an explicitly opened player concept and unavailable playback. Recovery uses a centered message and actionable controls. The concept uses one small top label, with no preview banners or repeated explanatory text. Failed native playback does not silently substitute a concept clock. Remote input reveals hidden controls.

## Do's and Don'ts

### Do:

- **Do** preserve artwork ratios, safe margins and visible remote focus.
- **Do** distinguish selection from focus with checks, radio markers or underlines.
- **Do** use circular controls for icon actions and rounded rectangles for text actions.
- **Do** center transport controls and align title copy, timelines and utility groups deliberately.
- **Do** keep errors actionable and sample mode distinguishable.
- **Do** inspect native TV captures and remote behavior before claiming a layout is verified.

### Don't:

- **Don't** expand genre choices into a permanent wall of filter buttons.
- **Don't** invent catalog information, ratings, source availability or licensing claims.
- **Don't** replace real playback failure with an unlabeled simulated clock.
- **Don't** add decorative glass, glow or slow navigation choreography.
- **Don't** request focus for a hidden scope or remove a focused page-loading control.
