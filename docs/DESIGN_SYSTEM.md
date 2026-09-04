# Design System

Governed by Decision 012 (configuration-driven templates, not AI-generated UI). Serves two distinct purposes, kept clearly separated throughout this document: **(A)** the Builder App's own visual identity — a concrete design system for Ebere's actual product, built from the Shopify mobile app reference already reviewed — and **(B)** the token vocabulary behind the Blueprint's `theme` schema (`APP_BLUEPRINT.md` §7) that the Runtime Template implements for *generated* apps. These are related but not the same thing: the Builder App has one fixed look; a generated app's look is customer-configured from (B)'s vocabulary and will usually look nothing like (A).

## A. Builder App Visual Identity

Derived from the reviewed reference (Shopify's mobile app: dark canvas with white surface cards, pill-shaped chips, high-contrast black CTAs, tonal-highlight navigation).

### A1. Structural Pattern

Two layers, not a flat single-background app:

- **Canvas layer** — pure black (`#000000`) background, the app's chrome. Navigation drawers, top-level scaffolding.
- **Surface layer** — white, large-radius rounded cards/sheets that sit above the canvas and hold actual screen content. This is where Screens 1–19's content lives.

This split is a real component-hierarchy decision, not just a color choice: every screen has a canvas-level container and a surface-level content container, and components declare which layer they belong to.

### A2. Corner Radius Scale

| Token | Value | Used for |
|---|---|---|
| `radius.sm` | 8dp | Small chips, tags |
| `radius.md` | 16dp | List row containers, secondary buttons |
| `radius.lg` | 24dp | Primary surface cards/sheets |
| `radius.pill` | 999dp (fully rounded) | Selector chips, primary CTA button |

Proposed starting values, not measured pixel-for-pixel from the reference — reasonable defaults to build against and adjust once real screens are in front of you.

### A3. Selected-State Pattern

Binary state shown through fill, not color:

- **Selected**: black pill (`radius.pill`), white bold text, white checkmark icon leading.
- **Unselected**: transparent/light-grey fill, thin grey outline (`border.hairline`, §A6), black text, no icon.

No accent color is used for selection state — this matches the reference's high-contrast, mostly-monochrome approach. If a project-specific accent color is ever needed (e.g. a status/error state), it's an addition to this system, not a replacement of the black/white selection pattern.

### A4. Primary CTA

Full-width, `radius.md`, solid black fill, white bold text, no gradient, no elevation shadow — flat and high-contrast. Disabled state: reduced-opacity black (not a color change) with white text at matching reduced opacity, so it reads as "the same button, inactive" rather than a different control.

### A5. List Rows

Icon (leading) + label + trailing chevron, generous vertical padding (16dp minimum touch target beyond the 48dp Android minimum), thin hairline divider between rows rather than card-per-row — this is the pattern for Screens 6, 7, 10, 13's list-style content.

### A6. Borders

`border.hairline` = 1dp, `#E0E0E0` on white surfaces. Used sparingly — the reference relies primarily on the canvas/surface contrast and fill states rather than borders to establish structure.

### A7. Navigation Drawer

Pure black background, white icon + label per item, no dividers between items. Selected item: subtle dark-grey (`#1A1A1A`) rounded-rectangle highlight behind the item — a tonal shift, not a color accent, consistent with §A3's selection philosophy.

### A8. Bottom Tab Bar

White background, black icons, black active-state icon (no color swap), with the app's "primary action" tab (if one exists — a fast path back to something like a Home or Assistant equivalent) visually elevated slightly above the bar's baseline as a rounded icon.

### A9. Typography

Hierarchy through weight and size, not color — every text token stays near-black/white depending on layer, and hierarchy is established by:

| Token | Weight | Size |
|---|---|---|
| `type.display` | Bold | 28sp |
| `type.title` | Bold | 20sp |
| `type.body` | Regular | 16sp |
| `type.caption` | Regular | 13sp |

### A10. Accessibility Baseline

WCAG AA contrast minimum (4.5:1 for body text, 3:1 for large text) as the concrete target for every Builder App color combination — this is the same bar the correction tiers (§C below) enforce for generated apps, applied here to the Builder App's own fixed palette so it doesn't need runtime correction (it's fixed at design time, not user-configured). Minimum tap target 48dp regardless of visual size.

## B. Generated-App Theme Token Vocabulary

What each `theme` enum in `APP_BLUEPRINT.md` §7 concretely means — this is what the Runtime Template's token lookup implements, given a customer's Blueprint.

### B1. Corners

| Enum value | Radius |
|---|---|
| `sharp` | 0dp |
| `small` | 4dp |
| `medium` | 12dp |
| `large` | 24dp |

### B2. Borders

| Enum value | Meaning |
|---|---|
| `off` | No border on cards/containers; separation via elevation or spacing alone |
| `hairline` | 1dp, low-contrast neutral color derived from the resolved theme's surface tone |
| `standard` | 1.5dp, more visible, higher-contrast neutral |

### B3. Cards

| Enum value | Meaning |
|---|---|
| `minimal` | No visible container — content sits directly on the background, separated by spacing only |
| `outlined` | Border per B2's active setting, no fill differentiation from background |
| `filled` | Solid surface-color fill, no border |
| `elevated` | Surface-color fill plus a subtle shadow/elevation cue |

### B4. Spacing

| Enum value | Base unit |
|---|---|
| `compact` | 8dp |
| `normal` | 12dp |
| `spacious` | 16dp |

Applied as the base multiplier for padding/gaps throughout a generated app's layouts — a component that uses "2 units" of vertical padding resolves to 16dp/24dp/32dp depending on this setting.

### B5. Icons

| Enum value | Meaning |
|---|---|
| `outlined` | Stroke-only icon set |
| `filled` | Solid-fill icon set |
| `rounded` | Filled set with softened/rounded terminals |

Sourced from a single bundled icon library shipped with the Runtime Template (a Material Symbols-based set is the practical default, since it natively ships all three styles as variants of the same icon), not per-project custom icon assets — keeps the Runtime Template self-contained (Decision 021) with no runtime icon-fetching dependency.

### B6. Typography Scale

| Enum value | Meaning |
|---|---|
| `compact` | Base sizes reduced ~10% from `standard` |
| `standard` | The baseline scale (title/body/caption sizes analogous to §A9, but themeable rather than fixed) |
| `large` | Base sizes increased ~10%, improves legibility for content-dense sites |

### B7. Color Tokens

`primary`, `surface`, `background`, `onPrimary` (`APP_BLUEPRINT.md` §7) — resolved through the contrast correction tiers (`APP_BLUEPRINT.md` §14) before ever reaching the Runtime Template, so by the time these values are bundled into a build they're already guaranteed valid; the Runtime Template does not need to re-validate contrast at runtime, only render the resolved tokens.

## C. Template Presets

Concrete token combinations behind each `templatePreset` (`APP_BLUEPRINT.md` §7), consistent with the product handoff's own Complete Example (§37 there):

| Preset | Navigation | Cards | Borders | Corners | Spacing | Icons |
|---|---|---|---|---|---|---|
| `commerce` | Bottom | Outlined | Hairline | Medium | Compact | Rounded |
| `minimal` | Bottom | Minimal | Off | Small | Spacious | Outlined |
| `modern` | Bottom | Elevated | Off | Large | Normal | Filled |
| `dashboard` | Side | Outlined | Standard | Small | Compact | Outlined |
| `professional` | Top | Outlined | Hairline | Small | Normal | Outlined |
| `soft` | Bottom | Filled | Off | Large | Spacious | Rounded |
| `compact` | Bottom | Minimal | Hairline | Small | Compact | Outlined |
| `websiteMatch` | Derived from detected visual characteristics (`DETECTION_PIPELINE.md` §2) rather than a fixed row — the AI theme recommendation (`AI_AGENT_SPEC.md` §7) picks the closest-fitting combination of the above tokens |  |  |  |  |  |

These are proposed starting combinations, reasonable defaults to build the template-preset system against — not values pulled from user testing, since none exists yet.
