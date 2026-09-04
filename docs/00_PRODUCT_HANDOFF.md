# Website-to-App Builder — Product Handoff

**Status:** Source of truth for product vision. Architecture decisions that govern implementation live in `/decisions/TECHNICAL_DECISIONS.md` — where the two conflict, the decisions record wins for engineering purposes, and this document should be updated to match.

**Document purpose:** This defines what the product is, what problem it solves, how the user experiences it, and what each screen should accomplish. It intentionally does not prescribe pixel values, colors, or component internals — those live in `/ui/DESIGN_SYSTEM.md`, informed by the Shopify-app visual reference already reviewed.

---

## 1. Product Overview

The product is a smart website-to-mobile-application builder. A user provides an existing website URL. The system analyzes the website and transforms its existing structure into an application configuration. The user is guided through a small number of decisions rather than dropped into an empty builder dashboard.

```
Website URL
  → Website discovery
  → Understand the website
  → Recommend application structure
  → Ask the user a small number of questions
  → Create an App Blueprint
  → Build an initial application
  → Show interactive preview
  → Allow visual editing
  → Build the final application
  → Android initially, iOS as a future build target
```

The platform should feel like it did most of the difficult thinking. The engineering system underneath should actually be doing substantial work.

This flow — paste a URL, get a coherent recommendation, confirm or adjust it, never face a blank dashboard — is the **guided configuration pipeline**, and it's one of the product's core differentiators against a general-purpose app builder. It's referenced by that name in `/architecture/SYSTEM_ARCHITECTURE.md`.

## 2. The Central Product Idea

Not: *"Put your website inside an Android WebView."*

Instead: *"We understand your website and turn its existing structure into an application experience."*

```
Traditional wrapper:          Our system:
URL                            URL
 → WebView                      → Website Discovery
 → Application                  → Website Understanding
                                 → Page Classification
                                 → Navigation Analysis
                                 → Brand/Visual Analysis
                                 → AI Recommendations
                                 → App Blueprint
                                 → Application Shell
                                 → Website Runtime
                                 → Interactive App
```

The generated app should feel like an application constructed around the website, not a website displayed inside an application.

## 3. Core Product Principle — Simple on the Surface, Serious Underneath

The user should never need to understand Kotlin, Gradle, WebViews, cookies, routing, deep links, permissions, signing, native APIs, lifecycle, state restoration, design tokens, or manifests. The platform handles those. The user instead makes decisions like "use this logo," "put Products in the bottom nav," "I prefer the card version."

## 4. Engineering-First, AI-Assisted

AI is a boost, not the foundation. Engineering and deterministic analysis discover facts objectively (URLs, titles, headings, links, nav elements, forms, images, favicon, manifest icons, Open Graph metadata, canonical URLs, route structures, repeated nav patterns, visual characteristics, auth indicators). AI interprets those facts — it does not invent facts the discovery system didn't find.

## 5. What AI Should Do

Page-purpose classification, semantic understanding, navigation recommendations, user-journey interpretation, theme interpretation, template recommendation, native-screen recommendation, explaining recommendations, resolving ambiguous classifications, light personality in onboarding copy.

Example: *"We found 24 pages. We recommend keeping Home, Products, Orders and Account in your main navigation because these sections appear to play the biggest role in your site's user journey."* User can accept or customize.

## 6. What AI Must Not Control

Security, authentication security, permission enforcement, URL truth, routing truth, persistent-state implementation, build correctness, signing, platform configuration, arbitrary code generation, uncontrolled CSS generation, unsupported components. AI output always becomes validated structured configuration (see `/decisions/TECHNICAL_DECISIONS.md`, Decision 004).

## 7. The App Blueprint

The platform-neutral representation of the application, sitting between website understanding and application generation. Full schema lives in `/architecture/APP_BLUEPRINT.md`. Conceptually contains: Identity, Website, Pages, Routes, Navigation, Theme, Screens, State, Native Features, Deep Links, System UI, Build Configuration. Structured, validated, versioned, persistent, platform-neutral, migratable. Android-specific detail never defines the Blueprint.

## 8. Complete User Experience

The app should not open into an empty dashboard. First session should feel closer to Wix/Shopify onboarding than a developer IDE. Full screen-by-screen spec:

### Screen 1 — Welcome / Website Input
Product identity, short explanation, website URL input, primary "Analyze my website" action, reassurance that no coding is required. No sidebar, no advanced settings, no blank canvas.

### Screen 2 — Website Analysis
Progress indicator with meaningful, real steps (connecting, discovering pages, detecting navigation, finding brand assets, detecting visual style, understanding user journeys, checking mobile behavior). No fake technical jargon.

### Screen 3 — Website Discovery Summary
Human-readable summary: pages found, primary sections, other pages, detected nav, auth indicators, major site type. Not a developer crawl report.

### Screen 4 — Logo / App Identity
Detected logo, proposed app name, icon/splash preview, "use this logo" / "upload another," reassurance it can change later.

### Screen 5 — App Name
Detected/proposed name, editable field. Default to what the system discovered.

### Screen 6 — Navigation Recommendation
Recommended primary navigation with explanation of *why*, secondary pages noted. Select/deselect/reorder.

### Screen 7 — App Structure / Page Selection
Page list with type, suggested role (primary nav, secondary nav, contextual, external link, hidden), search for large sites, reordering. Human language, not routing terminology.

### Screen 8 — Recommended App Style
"Website Match" as the recommended template, plus alternatives (Minimal, Modern, Commerce, Dashboard, Professional, Soft, Compact). Recommended is visually flagged as best match; user is never locked in.

### Screen 9 — Design Customization
Preset categories, not raw CSS: Navigation (bottom/top/side), Icons (outlined/filled/rounded), Cards (minimal/outlined/filled/elevated), Borders (off/hairline/standard), Corners (sharp/small/medium/large), Spacing (compact/normal/spacious), Theme (light/dark/system).

### Screen 10 — Native Screen Recommendations
Optional additions (Settings, About, Support, Profile, Notifications, Onboarding, Offline/Error) with a stated reason each.

### Screen 11 — Native Screen Template Selection
Pattern previews per screen type (e.g. Settings: Simple List / Grouped / Cards).

### Screen 12 — System UI / Status Bar
Match theme / match primary color / match surface / custom, with automatic contrast validation and light/dark icon selection, shown live in the phone preview. Belongs to the app shell, not the website.

### Screen 13 — Final Review
Summary of name, logo, splash, nav, pages, template, theme, native screens, status bar, features, build target. Feels like "everything is ready," not a config dump. Fully editable from here.

### Screen 14 — Building Application
The "magic moment" — real progress steps (creating structure, configuring routes, preparing navigation, applying theme, adding logo, configuring session, preparing native screens, connecting pages, configuring system UI, preparing preview).

### Screen 15 — Application Ready / Preview
Interactive phone-frame preview — navigable, tappable, scrollable — not a static image. Uses the same shell/runtime renderer as the generated app (see `/decisions/TECHNICAL_DECISIONS.md`, Decision 005).

### Screen 16 — Visual Editor
Structure on one side, interactive phone preview centered, contextual inspector alongside. Direct manipulation, not a chat panel. Phase 2 scope.

### Screen 17 — Structure Editor
Home, nav items, website pages, native screens, secondary pages, add screen, reorder. Phase 2 scope.

### Screen 18 — Contextual Design Editor
Only exposes settings relevant to the selected object (nav → type/destinations/icons/order; card → style; Settings screen → layout pattern). Phase 2 scope.

### Screen 19 — Add Screen
Website page, Settings, About, Support, Profile, Notifications, Onboarding, other supported templates, with system-recommended defaults. Phase 2 scope.

## 9. Website Runtime

Android uses an Android WebView implementation (iOS will use WKWebView later). The runtime preserves a coherent session — see Decision 008 for the full state model, and Decision 007 for the OAuth/embedded-auth constraint that shapes this.

## 10. Persistent Application Memory / State

The app should feel like one continuous session, not unrelated page visits — cookies, local storage, session storage, IndexedDB, auth state, nav state, cache, app lifecycle, restoration behavior all treated as an explicit architectural subsystem. Especially important for ecommerce, dashboards, logged-in services, carts, preferences.

## 11. Generated App Shell

Platform-controlled: navigation, Settings, About, Support, onboarding, loading/error states, status bar integration, splash, native capabilities, deep links. The website remains the customer's actual web experience inside it.

## 12. Theme Boundary

**Application shell theme** (our system controls): navigation, native settings/dialogs/screens, status bar, splash, app-level loading/error states.
**Website theme** (the website controls): the platform does not have source access and does not forcibly repaint the site. It may integrate with an existing light/dark system where technically possible.

## 13. App Icon

Discovers favicon, manifest icons, Apple touch icon, Open Graph imagery, ranks candidates, shows the best one. User accepts, uploads another, or replaces later.

## 14. Splash Screen

Uses detected logo, app name, and selected shell theme. Platform can auto-generate a simple branded splash; user can modify it.

## 15. Status Bar

First-class feature (see Decision 013): theme-matched, primary-color, surface/background, or custom; automatic contrast; light/dark icon selection; correct edge-to-edge and safe-area handling; visible live in the preview. Avoids illegible icon/background combinations and header clashes.

## 16. Design Template Engine

Templates are structured configuration, not screenshots or freeform AI-generated UI (Decision 012). A template controls navigation type, icon style, card/border/corner treatment, spacing density, typography scale, color scheme, screen patterns, system UI behavior. AI recommendations fill this structured configuration; user can override any field.

## 17. Builder UX Philosophy

Guide first, edit second. The system creates an initial application; the user then edits it. Reduces cognitive load, makes the product feel intelligent.

## 18. AI Personality

Subtle, not a chatbot. Appears as short "smart recommendation" / "looks good" style callouts explaining what was found and why it matters. Helpful, not theatrical.

## 19. Security

Website content is treated as untrusted. Crawled content stays sandboxed. AI cannot bypass security controls. Generated configuration is always validated. Build secrets and signing credentials never touch the client. User credentials are collected only when necessary. Native permissions are explicit. External links are handled deliberately.

## 20. Error Handling

Human-readable, never a stack trace. E.g. *"We couldn't reach this website. Check the URL and try again,"* *"We couldn't find a clear brand icon — you can upload one instead,"* *"This website contains many pages — we recommend starting with the main sections,"* *"Some parts of this website require functionality that isn't currently supported in the app runtime."*

## 21. Large Website Handling

Not every site is small. V1 needs concrete crawl limits/depth and prioritized, user-selectable scope (see `/architecture/SYSTEM_ARCHITECTURE.md` for numbers).

## 22. Authentication

The platform detects signs of auth/account systems but never attempts to break or bypass authentication. If login blocks analysis, the system communicates that clearly. Generated apps preserve legitimate sessions where supported, subject to the OAuth/embedded-webview constraint in Decision 007.

## 23. Deep Links

Blueprint eventually supports App → Deep Link → Application Route → Website Route, so links to specific pages can open directly inside the generated app.

## 24. Native Features

Potential (introduced deliberately, not all at once): push notifications, share, file selection, camera, downloads, deep links, permissions, biometrics where appropriate, offline states, native account/profile, native settings.

## 25–26. Platform Architecture

Generated apps: Kotlin + Android-native APIs first; KMP is not implemented for the builder or generated apps in V1 (Decision 006) — platform neutrality comes from the Blueprint schema, not shared UI code. The recommendation system speaks in platform-neutral terms ("bottom navigation," "Settings screen"), never platform-specific ones ("Android NavigationBar").

## 27. Android First

First production target, because the builder itself is built in AI Studio (strong with Kotlin), and Android is the fastest path to validating the whole product. Goal: Android first, not Android only.

## 28. iOS Strategy

The Blueprint must remain reusable for iOS. A future iOS generator consumes the same Blueprint. Users should not need a Mac to use the platform even once iOS ships.

## 29. Build Pipeline

Staged per Decision 010: 3A (Blueprint → Android project → debug/unsigned APK) → 3B (release signing → AAB/APK → artifact management) → 3C (Play Store publishing automation, a separate future milestone). Build status, logs, errors, versioning, signing, and artifact management are required from 3A onward at the "does it work" level, hardened progressively.

## 30–32. Three-Phase Development Strategy

**Phase 1 — Foundation + Discovery:** builder shell, welcome screen, URL input, website analysis, page discovery, asset detection, logo detection, metadata extraction, basic page classification, initial AI recommendation, navigation recommendation, app name recommendation, initial questionnaire, App Blueprint, basic persistence, basic (non-editable) preview. Does not attempt production build infra, every native feature, iOS generation, every template, every edge case. Success = a user can enter a website and get a coherent, editable application-structure representation.

**Phase 2 — Application Composition + Runtime:** navigation editor, theme system, template system, design tokens, native screen templates, routing, persistent session/state, website runtime, interactive preview, status bar config, splash config, app identity, AI recommendations inside editing, error states, deeper testing. Success = a user can customize the generated Blueprint, interact with it, and experience a coherent runtime.

**Phase 3 — Production Build + Distribution:** staged per Decision 010 above, through eventual iOS generation architecture and macOS/Xcode build infra. Success = the platform reliably turns an approved Blueprint into a distributable application.

## 33. Testing Philosophy

Compiling is not "done." Coverage required: functional, UI, integration, regression (does Phase N+1 break Phase N), edge cases (invalid/unreachable URLs, redirects, SPAs, huge sites, broken/external links, missing/multiple icons, dark or non-responsive sites, auth, dynamic nav, unusual routes), state (login, nav, cookies, storage, background/foreground, session continuity, restoration), and preview/build parity.

## 34. Technical Separation

Discovery, AI, Recommendation, Blueprint, UI, Routing, State, Preview, and Build must remain distinct subsystems, not one giant component. See `/architecture/SYSTEM_ARCHITECTURE.md` for enforced module boundaries.

## 35. Future Expansion

iOS, PWA generation, additional platforms, richer native capabilities, advanced analytics, publishing workflows, app updates, reusable templates, template marketplace, org/team features, version history, app duplication, multiple apps per user, more advanced AI. None of this should distract from Phases 1–3.

## 36. Non-Goals for V1

Replacing general-purpose app builders; converting every site to 100% native UI; unrestricted AI code generation; exposing developer complexity to users; every native feature immediately; iOS production support as a prerequisite for Android validation; a blank-canvas editor; AI freely inventing application architecture.

## 37. Complete Example

`https://examplestore.com` → discovers Home, Products, Product details, Cart, Checkout, Account, Orders, About, Help; detects ecommerce behavior, auth, catalog, cart, orders, light/rounded/compact/outlined visual system, logo, manifest icon → recommends main nav (Home, Products, Orders, Account), secondary (Cart, About, Help), template (Commerce/Light/Compact/Outlined), native screens (Settings, About, Support) → user accepts logo, switches Settings to Cards, reorders nav, sets status bar to Match Theme → system builds Blueprint → nav → theme → status bar → native screens → persistent session → interactive preview → user edits nav, preview updates live → **Build Android App** → APK/AAB. Same Blueprint later powers iOS.

## 38. What the User Should Feel

Start: *"This looks easy."* → Scanning: *"Whoa, it actually understands my website."* → Recommendations: *"It knows what would make sense."* → Configuration: *"I can change what I care about without technical stuff."* → Building: *"It's actually creating my app."* → Preview: *"That's my website as an app."* → Editing: *"I can actually control it."* → End: *"I didn't need to know how any of this worked."*

## 39. Final Product Architecture

```
                         USER
                          │
                          ▼
                 ┌─────────────────┐
                 │  BUILDER APP    │  (native Android/Kotlin)
                 └────────┬────────┘
                          │ URL
                          ▼
                 ┌─────────────────┐
                 │ DISCOVERY ENGINE│  (server-side, Node/Playwright)
                 └────────┬────────┘
                          │ Structured Findings
                          ▼
                 ┌─────────────────┐
                 │ ANALYSIS ENGINE │
                 └────────┬────────┘
                 ┌────────┴────────┐
                 ▼                 ▼
           Rules/Heuristics       AI (structured output)
                 └────────┬────────┘
                          ▼
                RECOMMENDATION ENGINE
                          ▼
                  APP BLUEPRINT (versioned, platform-neutral)
             ┌────────────┼────────────┐
             ▼            ▼            ▼
          Preview      Editor       Generator
             └────────────┼────────────┘
                          ▼
                   GENERATED APP
                 ┌────────┴────────┐
                 ▼                 ▼
              Android             iOS (future)
              APK/AAB              IPA
```

## 40. The Most Important Architectural Rule

Discovery discovers. Engineering analyzes. AI interprets and recommends. The Blueprint stores the decision. The user confirms or modifies it. The runtime executes it. The generator builds it. No single subsystem is responsible for everything.

## 41. Final Product Principle

The user gives us a website. We give them an application. Everything between — discovery, understanding, recommendation, configuration, routing, state, theme, native screens, system UI, preview, generation, build — should mostly stay invisible to them.

> **Simple on the surface. Serious underneath.**

---

*This document defines product intent. Where implementation reality requires deviation, `/decisions/TECHNICAL_DECISIONS.md` is authoritative, and this file should be revised to match rather than silently diverged from.*
