# App Blueprint Specification

Governed by Decision 003 (Blueprint as central contract), Decision 006 (no KMP — neutrality lives here), Decision 009 (real per-project apps), Decision 012 (config-driven templates), Decision 013 (status bar as first-class).

## 1. What the Blueprint Is and Isn't

The Blueprint is the single platform-neutral representation of a generated application. Every subsystem — Discovery, AI, Editor, Preview, Runtime, Generator — reads and writes through it, never through each other (System Architecture §4).

**It is:** structured, schema-validated, versioned, persistent, platform-neutral, migratable.

**It is not:** a place for Android view types, Gradle references, WebView API calls, or any platform-specific implementation detail. If a field name would mean nothing to an iOS generator, it doesn't belong in the Blueprint — it belongs in that platform's generator-internal config.

Test for any new field before adding it: *"Could an iOS generator that has never seen Android consume this field and know what to build?"* If not, it's leaking implementation into the contract.

## 2. Top-Level Shape

```
AppBlueprint
├── schemaVersion        — format version of the Blueprint schema itself (e.g. "1.0")
├── blueprintVersion      — integer, increments on every accepted change (Decision 014)
├── projectId
├── discoveryResultRef    — reference, not embedded data (see §3)
├── identity
├── pages
├── routes
├── navigation
├── theme
├── screens               — native (non-website) screens
├── state
├── nativeFeatures
├── deepLinks
├── systemUI
├── buildConfiguration
```

`schemaVersion` and `blueprintVersion` are different things and both matter: `schemaVersion` changes when the *shape* of the Blueprint changes (requires a migration, §9). `blueprintVersion` changes every time a *specific project's* Blueprint content changes (a user edit, an accepted AI recommendation) — this is what Decision 014's version history is built on. A Blueprint version is never mutated in place; edits create a new `blueprintVersion` row.

## 3. Relationship to DiscoveryResult

The Blueprint does not embed the raw `DiscoveryResult` (page HTML, extracted DOM data, etc.) — it references it by ID. `DiscoveryResult` is Discovery's output format and lives in its own store; the Blueprint only carries the *decisions* made from it (which pages became routes, what nav was recommended). This keeps the Blueprint small, keeps re-analysis explicit (a new discovery run produces a new `DiscoveryResult`, not a silent Blueprint mutation), and keeps discovery-internal detail from leaking into the platform-neutral contract.

## 4. Identity

```
identity {
  appName: string                          — required
  shortName?: string                       — optional, for platform display constraints
  icon: {
    source: "detected" | "uploaded"
    activeAssetRef: string                 — references a managed Asset, never a raw external URL
    candidates: [{ assetRef, sourceType: "favicon"|"manifest"|"appleTouchIcon"|"openGraph", rank: number }]
  }
  splash: {
    logoAssetRef: string                   — references icon.activeAssetRef or a distinct splash Asset
    backgroundMode: "solid" | "brandColor" | "themeMatch"
  }
}
```

Candidates are always retained even after one is selected — this is what makes "upload another" / "change later" (product handoff §13) a cheap Blueprint edit rather than a re-discovery.

**Why `assetRef`, not a raw URL:** every icon/logo/splash candidate discovered during crawling is fetched once and stored as a managed Asset (Supabase Storage + Postgres metadata — see `/architecture/SYSTEM_ARCHITECTURE.md` §7) before it's offered as a candidate. Hot-linking the Blueprint directly to a URL on the customer's own website was the earlier approach, and it's fragile: that URL can change, go offline, or block hot-linking entirely, which would silently break the generated app's icon with no clear cause. Referencing a managed asset by ID means the Blueprint's identity data stays valid regardless of what happens to the original site later.

## 5. Pages and Routes

```
pages[] {
  id: string
  sourceUrl: string
  title: string
  detectedType: "home"|"product"|"category"|"cart"|"checkout"|"account"|
                "blog"|"contact"|"about"|"help"|"other"
  detectionConfidence: number (0-1)         — from AI/Analysis, see AI_AGENT_SPEC.md
  role: "primaryNavigation"|"secondaryNavigation"|"contextual"|
        "externalLink"|"hidden"
  order: number
}

routes[] {
  id: string
  kind: "websitePage" | "nativeScreen"
  targetRef: string                         — pages[].id or screens[].id
  path: string                              — app-internal route path, for deep linking (§10)
}
```

`pages` is Discovery-derived and AI-classified. `routes` is the app-navigable set — every route resolves to either a website page or a native screen, never a raw URL, so the Runtime and Generator never need to distinguish "website content" from "native content" at the navigation layer; that distinction is already resolved by `routes[].kind`.

## 6. Navigation

```
navigation {
  type: "bottom" | "top" | "side"
  items: [{ routeId, label, icon, order }]      — primary nav, product handoff Screen 6
  secondary: [{ routeId, label, order }]         — "More" / secondary pages, Screen 7
}
```

Validation: every `routeId` referenced here must exist in `routes[]`. This is enforced server-side (System Architecture §9) before a Blueprint version is accepted — a navigation item pointing at a non-existent route is a common class of AI/editor bug this catches structurally rather than at runtime.

## 7. Theme

Directly encodes the Screen 8/9 presets — configuration, not generated CSS (Decision 012):

```
theme {
  templatePreset: "websiteMatch"|"minimal"|"modern"|"commerce"|
                  "dashboard"|"professional"|"soft"|"compact"
  mode: "light" | "dark" | "system"
  icons: "outlined" | "filled" | "rounded"
  cards: "minimal" | "outlined" | "filled" | "elevated"
  borders: "off" | "hairline" | "standard"
  corners: "sharp" | "small" | "medium" | "large"
  spacing: "compact" | "normal" | "spacious"
  colorTokens: {
    primary: hexColor
    surface: hexColor
    background: hexColor
    onPrimary: hexColor                     — derived, validated for contrast (§8)
  }
  typographyScale: "compact" | "standard" | "large"
}
```

`colorTokens` are derived from brand/visual detection but always pass through contrast validation before being accepted into a Blueprint, using the correction tiers defined in §14 — a valid selection is accepted unchanged, a minor contrast problem gets a small automatic adjustment the user is told about, and an unsafe configuration falls back to a safe default the user is also told about. A color choice never silently changes and never blocks the build. This is the same validation mechanism used for the status bar (§8).

## 8. System UI (Status Bar)

Decision 013 — first-class, not a WebView afterthought:

```
systemUI {
  statusBar: {
    mode: "matchTheme" | "primaryColor" | "surface" | "custom"
    customColor?: hexColor                  — required if mode == "custom"
    iconAppearance: "automatic" | "light" | "dark"
  }
  edgeToEdge: boolean
}
```

Validation rule: whatever `statusBar` resolves to (theme color, primary color, surface color, or custom) must pass a contrast check against the resolved `iconAppearance`, following the correction tiers in §14 — accepted as-is, auto-adjusted with a user-facing notice, or replaced with a safe fallback and a user-facing notice. If `iconAppearance` is `"automatic"`, the system computes light/dark from the resolved background color rather than leaving it to the generator to guess at build time — the Blueprint always stores a *resolved*, renderable configuration, never an ambiguous one, and the user is never left wondering why their status bar looks different from what they picked.

## 9. Screens (Native, Non-Website)

```
screens[] {
  id: string
  type: "settings"|"about"|"support"|"profile"|"notifications"|
        "onboarding"|"offlineError"
  templateVariant: string                   — e.g. settings: "simpleList"|"grouped"|"cards"
  enabled: boolean
  recommendationReason?: string             — surfaced to user per product handoff Screen 10
  order: number
}
```

Each `type` has its own valid `templateVariant` enum (Settings: simpleList/grouped/cards; About: minimal/information/branded; Support: helpCenter/contact/combined) — these are enumerated per-type in `/ui/COMPONENT_SPEC.md` rather than duplicated here, since that's where the actual visual patterns are defined.

## 10. State

```
state {
  sessionPersistence: {
    cookies: boolean
    localStorage: boolean
    sessionStorage: boolean
    indexedDB: boolean
  }
  authHandling: {
    embeddedAuthDomains: string[]           — domains explicitly allowed inside the app's own WebView
    externalAuthDomains: [{
      domain: string
      handoffStrategy: "cookieInjection" | "tokenRedirect" | "redirectChainCompletion"
    }]                                       — domains that must open via Custom Tabs (Decision 007);
                                                each carries the strategy the Runtime Template uses to
                                                bring the resulting session into the WebView (full
                                                strategy definitions in /architecture/STATE_ARCHITECTURE.md §3)
  }
  restorationPolicy: "resumeLastRoute" | "resumeHome" | "resumeLastRouteWithinSession"
}
```

Full behavior (cookie manager configuration, Custom Tabs handoff mechanics, lifecycle hooks) lives in `/architecture/STATE_ARCHITECTURE.md` — the Blueprint only stores the *policy*, not the implementation. `authHandling` defaults to treating known OAuth-provider domains (Google, Facebook, Apple, etc.) as `externalAuthDomains` automatically during discovery, each seeded with a documented default `handoffStrategy` for that provider (`STATE_ARCHITECTURE.md` §3); a user/AI cannot silently move a known OAuth domain into `embeddedAuthDomains` without an explicit override flag, since that would recreate the exact failure Decision 007 exists to prevent.

## 11. Native Features

```
nativeFeatures[] {
  type: "pushNotifications"|"share"|"fileSelection"|"camera"|"downloads"|
        "deepLinks"|"biometrics"|"offlineMode"|"nativeAccount"|"nativeSettings"
  enabled: boolean
  config?: object                           — feature-specific, schema defined per type
}
```

Introduced deliberately per product handoff §24 — `enabled: false` is the default for every entry except `deepLinks`, which is structurally required the moment `deepLinks[]` (§12) is non-empty.

## 12. Deep Links

```
deepLinks[] {
  pattern: string                           — e.g. "/product/:id"
  routeId: string                           — resolves via routes[]
}
```

## 13. Build Configuration

Kept platform-neutral at the top level, with platform-specific detail nested — this is the one section of the Blueprint most tempted to leak implementation detail, so the boundary is enforced structurally:

```
buildConfiguration {
  packageId: string                         — reverse-domain identifier, platform-neutral concept
  versionName: string
  versionCode: number
  stage: "3A" | "3B" | "3C"                 — Decision 010
  android: {
    minSdk: number
    targetSdk: number
    signingRef?: string                     — reference ID only; the actual key never enters the Blueprint (Decision 010, System Architecture §9)
  }
  ios?: {                                   — absent until an iOS generator exists (Decision 006)
    bundleId: string
    minimumOSVersion: string
  }
}
```

`signingRef` is a pointer the Build Worker resolves internally — this is the concrete mechanism behind "signing credentials never touch the client" (System Architecture §10). The Blueprint can be read by the Builder App, the Backend API, and any generator without ever exposing a real credential.

**Boundary with the Build Manifest (Decision 017):** `buildConfiguration` here is product-level and platform-neutral-by-target — it describes what the user configured (package identity, version, which stage they're targeting). It deliberately does **not** include which specific generator, runtime, or template version actually produced a given build — those are build-time facts, not product decisions, and belong in the Build Manifest that the Backend API generates at build-trigger time (`/architecture/SYSTEM_ARCHITECTURE.md` §6), not in this schema. Keeping them separate is what makes rebuilds reproducible: the Blueprint can be read by a future iOS generator with no Android-specific version baggage attached.

## 14. Validation Rules Summary

Enforced server-side (Backend API) before any Blueprint version is accepted, regardless of whether the change came from AI or a user edit:

1. Every `routeId` referenced in `navigation`, `deepLinks`, or elsewhere must exist in `routes[]`.
2. Every `routes[].targetRef` must exist in `pages[]` or `screens[]`, matching `kind`.
3. `theme.colorTokens` and `systemUI.statusBar` must pass contrast validation using the correction tiers below — never a silently overridden save, and never a save blocked by a color choice.
4. `state.authHandling.embeddedAuthDomains` cannot silently include a recognized OAuth-provider domain (§10).
5. `buildConfiguration.android.signingRef` must be null/absent for `stage: "3A"` and required for `stage: "3B"`/`"3C"`.
6. Every enum field (theme presets, screen template variants, nav type, etc.) is validated against its defined set — an AI or client sending an out-of-enum value is rejected, not coerced.

**Contrast & system-UI color correction tiers** (rule 3, applies to `theme.colorTokens.primary`/`onPrimary`/`surface`/`background`, `systemUI.statusBar.customColor`, `systemUI.statusBar.iconAppearance`, and any future system-UI color combination):

| Result | Behavior |
|---|---|
| Valid | Accepted unchanged |
| Minor contrast problem, safe automatic fix exists | Adjusted automatically; user is informed |
| Invalid/unsafe, no safe automatic fix | Replaced with a safe fallback; user is informed |

The user is never blocked from building because of a color choice, and never silently overridden — every automatic adjustment surfaces a short, specific notice, e.g. *"We adjusted your status bar color for readability. Your selected color didn't provide enough contrast with the system icons, so we made a small accessibility adjustment. You can change it later."* This notice is returned by the Backend API's validation response at save time — it is not stored as a permanent Blueprint field, since the Blueprint only ever holds the final valid, renderable configuration (§1). Full validation-lifecycle detail lives in `/ai/AI_AGENT_SPEC.md`. If a correction/audit history ever becomes a real product need, it should be modeled as its own artifact (e.g. a `CorrectionLog` referencing the Blueprint version it applied to) rather than added to this schema — the same pattern `AIRecommendation` already follows to keep proposal history out of the Blueprint itself (`SYSTEM_ARCHITECTURE.md` §3).

## 15. Versioning and Migration Strategy

- **`blueprintVersion`** (per-project content version): append-only. Every accepted change — AI-recommended or user-edited — writes a new row rather than mutating the existing one. This gives the Phase 2 editor undo/history for free and gives Decision 014's "persistent Projects" real teeth.
- **`schemaVersion`** (format version): changes only when the Blueprint's *shape* changes — a new required field, a renamed key, a restructured section. Each `schemaVersion` bump ships with an explicit migration function that upgrades older stored Blueprints on read. Old `blueprintVersion` history is migrated forward, never discarded, so version history remains readable after a schema change.
- A generator or the Preview renderer always declares which `schemaVersion` range it supports. The Backend API rejects attempting to build against a Blueprint whose schema version the target generator doesn't understand yet, rather than letting a generator guess at unfamiliar fields.

## 16. Why This Shape

Every section above maps directly to a screen in the product handoff (identity → Screens 4-5, pages/navigation → Screens 6-7, theme → Screens 8-9, screens → Screens 10-11, systemUI → Screen 12) and a decision in the technical record. That mapping is intentional: the Blueprint schema should never need a field the product doesn't actually ask the user about, and the product should never promise a screen the Blueprint has nowhere to store.
