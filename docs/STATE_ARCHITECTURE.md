# State Architecture

Governed by Decision 007 (OAuth/embedded-WebView limitations), Decision 008 (persistent state as a first-class subsystem). This document specifies behavior the **Runtime Template** (Decision 020) must implement — it is a spec for AI Studio's reference implementation, not a new deployable component. Referenced from `APP_BLUEPRINT.md` §10, whose `state` schema (`sessionPersistence`, `authHandling`, `restorationPolicy`) is the configuration surface this document defines the behavior behind.

## 1. Principle

The generated app must behave like one continuous session — Home → Products → Product → Cart → Account → Home should feel like a single visit, not unrelated page loads (product handoff §10). This is a Runtime Template responsibility: the Blueprint only records *policy* (§7 below); the Runtime Template is what actually implements it consistently across every generated app.

## 2. State Categories and Persistence Policy

| Category | Android mechanism | Default policy |
|---|---|---|
| Cookies | WebView `CookieManager` — persistent cookie store, explicitly flushed to disk (`CookieManager.flush()`) after state-changing navigation, not left to rely on implicit flush timing | Persistent across app restarts, matching normal browser behavior, unless `state.sessionPersistence.cookies` is `false` |
| localStorage | WebView `setDomStorageEnabled(true)` | Persistent across app restarts, disk-backed by the WebView's own storage |
| sessionStorage | Same DOM storage setting; scoped by the web platform's own sessionStorage semantics | Cleared per **app session** (§5 defines what that means for this app, not literally "until the OS-level WebView process exits," which the app doesn't fully control) |
| IndexedDB | WebView database/DOM storage settings | Persistent, same posture as localStorage |

Each of these is gated by the corresponding `state.sessionPersistence` flag in the Blueprint (`APP_BLUEPRINT.md` §10) — the flags are booleans an editor (Phase 2) could theoretically expose per-project, though V1 defaults all of them to `true` for any project that has session-dependent features (ecommerce, accounts, dashboards) per the product handoff's stated priority (§10 there).

## 3. Authentication State and OAuth Handoff

Decision 007 requires third-party OAuth flows to open in Chrome Custom Tabs, never the app's own WebView. That requirement alone doesn't guarantee the user ends up logged in inside the WebView afterward — there's a real technical gap worth naming precisely, because getting this wrong would silently defeat the whole point of Decision 007.

**The gap:** Chrome Custom Tabs and the app's in-app WebView use **separate cookie stores**. A session cookie the identity provider (or the customer's own website, completing the OAuth callback) sets during the Custom Tab flow lands in Chrome's cookie jar — not the WebView's `CookieManager` store the rest of the app relies on. Without deliberate handling, the Custom Tab flow can complete successfully while the WebView the user returns to is still logged out.

**Required flow:**

```
WebView navigation intercepted (shouldOverrideUrlLoading)
      ↓
URL matches a domain in state.authHandling.externalAuthDomains?
      ↓ yes
Launch Chrome Custom Tab for that URL instead of loading in WebView
      ↓
OAuth completes in the Custom Tab (using Chrome's own cookie jar —
this is exactly why providers require this: it lets them apply their
normal browser-context security signals)
      ↓
Provider/site redirects to a callback URI the app can intercept
(an Android App Link matching the customer's domain, or an
app-specific redirect the OAuth flow was configured to use)
      ↓
App regains control, and must bring the resulting authenticated
state into the WebView's own cookie store — not assume it's
already there
      ↓
WebView resumes navigation as an authenticated session
```

**The handoff mechanism is not a single assumed default — it is an explicit, per-domain runtime mechanism**, because there is no one technique that works for every identity provider and every customer website's own OAuth integration. The Runtime Template implements three named strategies and selects among them per domain rather than always attempting the same one:

| Strategy | Mechanism | Appropriate when |
|---|---|---|
| **Cookie Injection** | After the Custom Tab flow completes, the Runtime Template programmatically sets the resulting session cookie into the WebView's `CookieManager` for the site's domain | The customer's own backend completes the OAuth exchange server-side and communicates the result via a conventional session cookie — the common case for traditional server-rendered sites |
| **Token-Based Fresh Authenticated Request** | The callback captures a token (e.g. from an OAuth2 implicit/PKCE-style redirect) rather than a cookie; the Runtime Template uses it to make a fresh authenticated request from the WebView itself, letting the site's backend establish a WebView-native session on that request | SPA-style sites, or providers that hand back a bearer token rather than setting a cookie directly |
| **Redirect-Chain Completion** | If the provider's callback lands on the customer's own domain and the site itself completes further steps via redirect, the WebView loads that exact callback URL directly (instead of the Custom Tab), letting the site's own redirect/cookie-setting happen natively in the WebView's own jar from that point forward | The provider's flow ends with a same-domain redirect the site uses to finalize its session — completing that last leg natively in the WebView sidesteps the cross-jar problem entirely for it |

**Selecting the strategy per domain** is recorded explicitly, not guessed at runtime — `state.authHandling.externalAuthDomains` entries carry a `handoffStrategy` field (`APP_BLUEPRINT.md` §10), so the Runtime Template always knows which mechanism to apply for a given domain rather than probing at runtime. **Determining the default**: discovery seeds a documented provider-lookup table (Google, Facebook, Apple, Microsoft, and a generic fallback) with a reasonable default strategy per known provider — Cookie Injection as the baseline for unrecognized providers, since it's the most broadly compatible option and doesn't depend on a provider exposing a token. Phase 2's editor can allow overriding the detected strategy per project if the automatic default doesn't work correctly for a given site's specific integration — this is exactly the kind of thing static analysis can get right most of the time but not always, so an override path matters.

This is real Phase 2 "website runtime" implementation work, not something to defer indefinitely — a generated app that shows a successful Custom Tab login but returns the user to a logged-out WebView is a worse experience than the plain WebView-OAuth failure Decision 007 exists to prevent in the first place, because it looks like it should have worked.

## 4. Cache Behavior

V1 default: respect the website's own HTTP cache headers via the WebView's normal cache behavior (`LOAD_DEFAULT`) rather than building custom caching logic. This is deliberately the simplest option — a site's own cache-control headers already express the site owner's intent about freshness, and the platform doesn't have special knowledge that should override that. Offline-specific behavior (an explicit "you're offline" native screen, per product handoff §10's native screen list) is separate from cache policy and doesn't require changing how caching itself works.

## 5. Session Continuity and Restoration Policy

Defines what `state.restorationPolicy` (`APP_BLUEPRINT.md` §10) actually means at runtime:

- **`resumeLastRoute`**: while the Android process stays alive (app backgrounded, not killed), the WebView instance and its in-memory navigation position are simply preserved — this is the common case and requires no special handling beyond correct `onPause`/`onResume` behavior (§6). If the OS kills the process (low memory) and later recreates it, the Runtime Template persists just enough to reconstruct where the user was — the last route ID and, if it was a website page, the last URL — to disk, and restores to it on relaunch.
- **`resumeHome`**: always reopens at the app's home route after a cold start, regardless of where the user was — simpler, appropriate for content-browsing apps where "pick up where I left off" matters less.
- **`resumeLastRouteWithinSession`**: like `resumeLastRoute`, but only within a bounded time window (an app-level "session" — e.g. reopened within N minutes of backgrounding) rather than indefinitely; beyond that window, falls back to `resumeHome`. The concrete window length is an operational tuning parameter, not fixed here, consistent with how other numeric defaults in this repository are treated (`SYSTEM_ARCHITECTURE.md` §8, `BUILD_ARCHITECTURE.md` §12).

Regardless of policy, cookies/localStorage/IndexedDB persistence (§2) is unaffected by process death — those are disk-backed by the WebView itself. `restorationPolicy` only governs *navigation position*, not whether the underlying website session survives; the website session surviving is what §2 and §3 already guarantee.

## 6. Lifecycle Behavior

- **Backgrounding**: the WebView should pause appropriately (`WebView.onPause()`, which also suspends JS timers and media) rather than continuing to run at full activity while invisible — standard Android WebView practice, restated here because it's easy to omit and easy to not notice missing until battery/performance complaints show up later.
- **Foregrounding**: `WebView.onResume()`, resuming from wherever `resumeLastRoute`/`resumeLastRouteWithinSession` (§5) left it.
- **Process recreation**: minimal state persisted to disk (§5) is what makes recreation graceful instead of a jarring reset to a blank state.

## 7. Blueprint Fields This Document Governs

Restated as a pointer, not redefined here — schema itself lives in `APP_BLUEPRINT.md` §10:

- `state.sessionPersistence.{cookies, localStorage, sessionStorage, indexedDB}` → §2
- `state.authHandling.{embeddedAuthDomains, externalAuthDomains}` → §3
- `state.restorationPolicy` → §5

## 8. Security Boundary

- Same-origin storage partitioning is enforced by the WebView platform itself — one origin's cookies/localStorage aren't reachable by a different origin's JavaScript. The Runtime Template doesn't need to (and must not attempt to) work around this.
- If any native capability is ever exposed to website JavaScript via a WebView JS bridge (`addJavascriptInterface` or the modern `WebMessageListener` equivalent) — for native features like share or file selection (product handoff §24) — that bridge's surface must be minimal and specific to one capability at a time, never a general "call arbitrary native code" bridge. Website content is untrusted (`SYSTEM_ARCHITECTURE.md` §10); a broad bridge exposed to it is a standard, well-known Android security mistake, and this platform generates apps for arbitrary third-party websites it doesn't control, which makes this more relevant here than in a typical single-site WebView app.
