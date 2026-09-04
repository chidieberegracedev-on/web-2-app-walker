# Routing Architecture

Governed by Decision 003 (Blueprint as the routing source of truth), Decision 007 (external-auth handling, a special case of external-domain behavior), Decision 020 (Runtime Template implements this). Like `STATE_ARCHITECTURE.md`, this specifies behavior the **Runtime Template** implements — not a new deployable component. Covers the `routes[]`, `navigation`, and `deepLinks[]` sections of `APP_BLUEPRINT.md` (§5, §6, §12).

## 1. Principle

Every navigable destination in a generated app resolves through the Blueprint's `routes[]` table as either a `websitePage` or a `nativeScreen` (`APP_BLUEPRINT.md` §5). The routing layer never re-decides "is this website content or native" at the point of navigation — that distinction is resolved once, when the route was created, and every downstream consumer (nav bar, deep links, back-stack) just reads `routes[].kind`.

## 2. Route Resolution

- A `nativeScreen` route renders via the Runtime Template's native screen templates — the specific `templateVariant` for that screen type (`APP_BLUEPRINT.md` §9: e.g. Settings → simpleList/grouped/cards).
- A `websitePage` route renders via the WebView runtime, loading the `sourceUrl` of the `pages[]` entry the route's `targetRef` points to.
- Both cases are just "render this route" from the navigation shell's perspective — the shell doesn't special-case WebView vs. native screen rendering logic beyond dispatching to the right renderer for `routes[].kind`.

## 3. Navigation Stack and Back Behavior

Two distinct stacks exist, and conflating them is the most likely source of a confusing back-button experience:

- **App-level nav stack**: switching between top-level destinations (the bottom/top/side nav items, per `theme.navigation.type` — `APP_BLUEPRINT.md` §7). Each top-level destination is its own stack entry.
- **Within-page WebView history**: clicking a link inside a `websitePage` route navigates the WebView internally (e.g. Products → a specific product), which has its own browser-style history independent of the app-level stack.

**Default back-button behavior**: Android system back first unwinds the *current route's* WebView history (if the WebView isn't already at that route's root URL) before popping the app-level nav stack. Concretely: on a Products page, having tapped into a specific product, back returns to the Products listing (WebView history), not to whatever the previous top-level tab was. Only once the WebView is back at that route's entry point does back fall through to app-level nav stack behavior (returning to the previously active top-level tab, or exiting the app from the initial/home tab). This matches the mental model users already have from every other app with embedded web content, and avoids the common bug where back button unexpectedly jumps between unrelated top-level sections mid-way through browsing one of them.

## 4. External Links

A link whose domain doesn't match the site's own root domain (`DETECTION_PIPELINE.md` §3's `external link` indicator) does not silently load inside the app's WebView. **Default: opens via Chrome Custom Tabs**, consistent with the mechanism already required for OAuth (`STATE_ARCHITECTURE.md` §3) — reusing the same code path rather than introducing a second "how do we leave the site" mechanism. This gives the user normal browser chrome (address bar, back-to-app affordance) for content the platform has no control over and shouldn't try to render as if it were part of the generated app.

This is the general policy `pages[].role: "externalLink"` (`APP_BLUEPRINT.md` §5) formalizes at the Blueprint level — a page explicitly marked as an external link in the navigation/page-selection screens (product handoff Screens 6–7) follows this same external-open behavior when the user taps it from within the app's own navigation, not just when encountered as an inline link inside website content.

## 5. Deep Links

Product handoff §23: App → Deep Link → Application Route → Website Route. `APP_BLUEPRINT.md` §12 defines the schema (`pattern` → `routeId`). The Android implementation detail worth being explicit about, because it's a real constraint rather than a pure implementation choice:

**Android App Links** (the mechanism that lets tapping a real `https://` link open the app directly instead of a browser) require **domain verification** — the target website must serve a `/.well-known/assetlinks.json` file proving the app is authorized to handle that domain's links. Since this platform generates apps for third-party customer websites it does not control server access to, App Link verification is **not something the platform can configure unilaterally** — it requires the customer to add a file to their own site. This is a real dependency on customer action, not solvable purely in the Runtime Template or Generator.

Two consequences worth stating plainly rather than glossing over:

- **If a customer completes App Link verification** (a one-time setup step, likely surfaced as an optional advanced step in Phase 2's editor, not blocking Phase 1/2 core flow): tapping a real `https://customersite.com/product/123` link anywhere on the device (email, SMS, another app) opens the generated app directly, resolved through `deepLinks[]` to the matching `routeId`.
- **If a customer hasn't verified**: the generated app can still register a **custom URI scheme** (e.g. an app-specific scheme derived from `buildConfiguration.packageId`) with no domain-verification dependency — but this only handles deep links the platform itself generates (e.g. a share action from inside the app, or a marketing link the customer deliberately constructs using the custom scheme), not organic `https://` links from outside the app. This is a real capability gap, not a bug — it's flagged here so it isn't mistaken for something the Generator failed to implement.

V1 default: implement both — register the custom scheme unconditionally (it costs nothing and needs no customer action), and treat App Links verification as an optional, customer-driven enhancement rather than a Phase 1/2 requirement.

## 6. Route Table Construction

At build time, the Generator reads `routes[]`, `navigation`, and `deepLinks[]` from the Blueprint and turns them into the Runtime Template's actual navigation configuration. **Locked (Decision 021):** the Runtime Template is a data-driven shell, not a per-customer codegen target — it reads this configuration from a bundled resource at app runtime rather than the Generator emitting different Kotlin navigation code per customer. The Generator's routing-specific work per customer is producing a serialized route table (routes, nav structure, deep link patterns) as part of the bundled config export (`BUILD_ARCHITECTURE.md` "Bundled Configuration and Runtime Independence"), not modifying the Runtime Template's actual navigation logic.

## 7. Validation

Enforced upstream, not re-specified here: every `routeId` referenced by `navigation` or `deepLinks[]` must exist in `routes[]` (`APP_BLUEPRINT.md` §14, rule 1). This document assumes that guarantee already holds by the time the Runtime Template receives a route table — the Runtime Template is not expected to defensively handle a malformed route reference, since the Backend API's validation layer is what's responsible for never producing one.

## 8. Security Boundary

- Deep link targets resolve **only** to `routes[]` entries already defined in the Blueprint at build time. A deep link pattern can never be used to construct or reach an arbitrary, unvalidated destination at runtime — there is no dynamic "resolve this URL to whatever route matches" logic operating on live, unvalidated input; the route table is fixed at build time from a validated Blueprint.
- External-domain navigation (§4) always exits to Custom Tabs rather than ever being rendered inside the app's own WebView chrome in a way that could be mistaken for the customer's own site — this also means the app never presents untrusted third-party content under the visual trust of the generated app's own shell.
