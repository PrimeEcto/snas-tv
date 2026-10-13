---
name: SNAS
description: Cinematic discovery for an evening on the sofa.
colors:
  ink: "#0C1015"
  surface: "#191F27"
  raised: "#252D37"
  foreground: "#F5F4F0"
  secondary: "#B6BEC9"
  subdued: "#8693A2"
  sand: "#E8B77C"
  divider: "#36414D"
  error: "#F0A6A0"
typography:
  display:
    fontFamily: Amazon Ember
    fontSize: 57px
    fontWeight: 700
    lineHeight: 62px
  headline:
    fontFamily: Amazon Ember
    fontSize: 43px
    fontWeight: 600
  title:
    fontFamily: Amazon Ember
    fontSize: 24px
    fontWeight: 600
  body:
    fontFamily: Amazon Ember
    fontSize: 18px
    lineHeight: 27px
  label:
    fontFamily: Amazon Ember
    fontSize: 17px
    fontWeight: 600
rounded:
  square: 0px
spacing:
  compact: 8px
  group: 12px
  card-gap: 20px
  section: 28px
  safe-edge: 56px
components:
  button-primary:
    backgroundColor: "{colors.foreground}"
    textColor: "{colors.ink}"
    height: 49px
    rounded: "{rounded.square}"
    padding: 0px 22px
  button-secondary:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.foreground}"
    height: 49px
    rounded: "{rounded.square}"
  button-focused:
    backgroundColor: "{colors.sand}"
    textColor: "{colors.ink}"
    rounded: "{rounded.square}"
---

# Design System: SNAS

## Overview

**Creative North Star: "The evening edit"**

Artwork carries the atmosphere; the interface stays precise and quiet. This Operate surface serves a viewer with a television remote in a dim living room. Its identity comes from the SNAS wordmark, cool ink ground, warm sand selection, and couch-distance typography.

**Key Characteristics:**
- Genuine cinematic photography and legibility gradients.
- Angular controls and portrait artwork.
- Clear remote focus and retained browsing position.
- Honest sample-catalog and simulated-playback labels.

## Colors

Sand marks focus, selection and progress. Foreground and secondary colors establish hierarchy. Artwork supplies the remaining color.

**The Focus First Rule.** Color is reinforced with a white frame; it never carries focus alone.

## Typography

Use the Vega platform's Amazon Ember mapping with regular, semibold and bold weights. Frontmatter sizes are logical 1280×720 composition units, not physical television pixels. Titles may wrap to two lines; card names truncate; details retain full titles and synopses.

## Layout

A 1280×720 logical canvas scales uniformly into the device viewport. Safe margins align navigation, hero copy, rails and details. Navigation is 74 units high. Portrait cards have 124×186 artwork in a 138-unit card and a 20-unit gap. Browse uses seven columns; Search uses a 305-unit remote keyboard beside four-column results. Rails scroll horizontally; collections scroll vertically.

## Elevation & Depth

Depth comes from tonal layers and cinematic gradients. No decorative shadows, blur panels or glow. Player menus use a scrim and a solid right-side sheet.

## Shapes

The shipped implementation uses square corners. Rounded clipping caused absent artwork and button fills in the tested headless Vega renderer; angular surfaces preserve reliable controls. Focus borders do not shift the grid. Card focus scales to 1.035 over 130ms.

## Components

### Buttons

Primary actions use light surfaces and ink labels; secondary actions use raised surfaces. Focus switches to sand with a two-unit white frame. Compact controls are 40 units high. Loading page controls retain a focusable position.

### Cards

Portrait artwork maintains 2:3 proportions. Continue Watching uses 16:9 backdrops and a progress line. Failed images show the title and SNAS wordmark. White frames and modest scale mark focus.

### Search

A query display sits above a six-column on-screen keyboard, with Space, Delete, Clear and Search. A hidden native TextInput triggered a reproducible Vega runtime crash and is intentionally absent.

### Navigation and focus

Active destinations use an underline; focus uses a light solid field. Each screen remembers its last focused control. Hidden scopes reject input and programmatic focus requests. Filters, seasons and episode menus use the shared control grammar.

### Player

The backdrop fills the screen. Controls, timeline, elapsed/remaining time and title sit together in a bottom legibility gradient. Choices are explicitly simulated. Remote input reveals controls after inactivity.

## Do's and Don'ts

- **Do** preserve artwork ratios, safe margins and visible focus.
- **Do** keep errors actionable and sample mode distinguishable.
- **Do** use the same control grammar across screens.
- **Don't** invent catalog information, ratings or licensing claims.
- **Don't** add decorative glass, glow or slow navigation choreography.
- **Don't** request focus for a hidden scope or remove a focused page-loading control.
