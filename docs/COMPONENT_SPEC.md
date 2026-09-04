# Component Spec

Fulfills the deferral in `APP_BLUEPRINT.md` §9: `screens[].templateVariant` enums are enumerated here, not duplicated in the schema doc. Also defines the Builder App's reusable component set, built from `/ui/DESIGN_SYSTEM.md` §A tokens and used throughout the flow in `/ui/BUILDER_UX_FLOW.md`.

## 1. Builder App Components

### Primary CTA Button
Full-width, `radius.md`, black fill, white bold `type.body` text. States: default, pressed (slightly darker fill, no shape change), disabled (reduced opacity, non-interactive), loading (text replaced by a small centered spinner, button retains its size so layout doesn't shift).

### Selector Chip
Pill-shaped (`radius.pill`), two states per `DESIGN_SYSTEM.md` §A3 — selected (black fill, white text + leading checkmark) and unselected (transparent fill, hairline border, black text). Used for Screen 2's "What can we help you do?"-style multi-select and every accept/reject recommendation surface (§3 below).

### List Row
Leading icon (optional), label (`type.body`), trailing chevron (optional — omitted for rows that are toggles rather than navigational), hairline divider below except the last row in a group. Minimum 48dp touch target regardless of visual content height.

### Card (Surface Container)
`radius.lg`, white fill, no border by default (relies on the canvas/surface contrast, `DESIGN_SYSTEM.md` §A1) — the container most Builder App screen content sits inside.

### Nav Drawer Item
Icon + label, white on black, `radius.md` dark-grey tonal highlight for the selected item (`DESIGN_SYSTEM.md` §A7). No trailing chevron — drawer items are always leaf destinations, not nested.

### Progress Step Indicator
Used on Screens 2 and 14: a vertical list of steps, each rendered in one of three states — completed (checkmark, `type.caption` weight text), active (subtle pulsing/highlighted, `type.body` weight), pending (dimmed, `type.caption` weight). Maps directly to the current `job.progress_step` (`BUILDER_UX_FLOW.md` §3) — the active step is whichever one matches the job's current value; everything before it is completed, everything after is pending.

### Phone Preview Frame
The device-frame container for Screen 15/16's interactive preview — a fixed-aspect-ratio frame (not a literal skeuomorphic phone illustration; a clean rounded-rectangle bezel is enough) that hosts the Runtime Template's actual rendered output, including a rendering of the configured status bar (`APP_BLUEPRINT.md` §8) so the user sees exactly what Screen 12's choice produces, live.

### Recommendation Card
Combines a Selector Chip (for the accept/reject state) with a `type.caption` reason line beneath it, rendering the confidence-tier behavior from `BUILDER_UX_FLOW.md` §6 (pre-selected for high confidence, unselected for medium, absent for low). Tapping the chip toggles `accepted`/`rejected`; a distinct "edit" affordance (not part of the chip itself) opens whatever input is appropriate for that recommendation's `type` and sets `status: modified` on change.

## 2. Component States (General)

Applied consistently across every component above, not redefined per-component:

| State | Rule |
|---|---|
| Default | As specified per component |
| Pressed | Subtle fill/opacity shift, never a shape or size change (avoids layout jank) |
| Disabled | Reduced opacity, non-interactive, no color hue change |
| Loading | Content replaced or supplemented with a spinner; container size preserved |
| Error | Reserved for form-style inputs only (e.g. a URL field on Screen 1) — a thin red outline plus inline caption text; this is the one place a color accent outside the black/white/grey system is used, since an error genuinely needs to be distinguishable at a glance |

## 3. Native Screen Template Variants (Generated Apps)

The concrete visual patterns behind `screens[].templateVariant` (`APP_BLUEPRINT.md` §9), built from the Blueprint's resolved theme tokens (`DESIGN_SYSTEM.md` §B) rather than the Builder App's own fixed identity (§A) — a generated app's Settings screen looks like *that customer's* theme, not like Shopify's reference.

### Settings
- **`simpleList`** — a single flat List Row group, no section headers. Appropriate for apps with few configurable settings.
- **`grouped`** — List Rows clustered under section headers (e.g. "Account," "Notifications," "About"), each section visually separated by spacing rather than a card boundary.
- **`cards`** — each settings group rendered as its own Card (per the active `theme.cards` token), stacked with spacing between them rather than one continuous list.

### About
- **`minimal`** — app name, version number, and the app's icon, centered, nothing else.
- **`information`** — adds a short description, links (privacy policy, terms, website), and basic legal/attribution text below the minimal layout.
- **`branded`** — a larger hero-style treatment: bigger logo placement, brand color background (using `theme.colorTokens.primary`), description and links below — appropriate when a customer's brand identity is a bigger part of the app experience than a purely functional utility.

### Support
- **`helpCenter`** — an FAQ-style List Row group (question as label, tapping expands or navigates to an answer), appropriate when a customer's site already has substantial help content to surface.
- **`contact`** — a direct contact form or contact-info display (email, phone, hours) with no FAQ list.
- **`combined`** — both `helpCenter` and `contact` content on one screen, separated by section headers or a simple tab switch — appropriate for customers with both real help content and a preference for direct contact being visible too.

Each variant renders using the resolved `theme.cards`/`theme.borders`/`theme.corners`/`theme.spacing` tokens exactly as any other part of the generated app would — native screens are not a visually distinct subsystem from the rest of the app, just a different content source (Runtime Template-provided rather than website-provided).

## 4. Composition Rules

- A screen is always a canvas-layer scaffold (Builder App) or the Runtime Template's equivalent theme-resolved background (generated app) containing one or more surface-layer containers.
- List Rows are grouped inside a Card when the content benefits from visual separation from surrounding screen content (e.g. Screen 6's navigation list); grouped without a Card wrapper when the screen's overall layout already provides enough separation (e.g. Screen 13's review sections, already separated by headers).
- The Phone Preview Frame is the only component that renders live, interactive Runtime Template output inside the Builder App — every other Builder App component is Builder-App-native UI, never a reused generated-app component rendered directly, even though both draw from token systems defined in the same document family.
