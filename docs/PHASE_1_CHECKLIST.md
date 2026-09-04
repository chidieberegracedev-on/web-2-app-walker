# Phase 1 Checklist

Concrete, checkable items against `/phases/PHASE_1.md`'s Definition of Done. Categories per `/testing/TESTING_STRATEGY.md`.

## Discovery (backend/infra)
- [ ] Valid, reachable website completes discovery within the Phase 1 default limits (`SYSTEM_ARCHITECTURE.md` §8: 40 pages, depth 3, 15s/page, 5min job)
- [ ] Invalid/malformed URL rejected with the specified human-readable error (`SYSTEM_ARCHITECTURE.md` §9), not a raw error
- [ ] Unreachable website (DNS failure, timeout, connection refused) produces the same human-readable error, distinct job outcome from "succeeded with partial results"
- [ ] Site requiring login mid-crawl does not fail the job — completes with whatever was reachable, consistent with `00_PRODUCT_HANDOFF.md` §22
- [ ] Redirect chains resolved correctly, final destination used for classification
- [ ] SPA (client-side-routed) site renders correctly via Playwright before extraction — verify against a real React/Vue-style site, not just server-rendered HTML
- [ ] Site exceeding 40 pages/depth 3 completes with the "some pages may be missing" notice rather than silently truncating without indication
- [ ] Site with no favicon/manifest icons handled — Screen 4 shows the "couldn't find a clear brand icon, upload one" state, not a crash or blank icon
- [ ] Site with multiple icon candidates ranks them and surfaces the top candidate, others remain selectable
- [ ] Dark-themed website doesn't break visual-characteristic detection or the resulting theme recommendation
- [ ] Non-mobile-responsive website still completes discovery; `mobileResponsive` indicator correctly false
- [ ] External links correctly classified as external (`DETECTION_PIPELINE.md` §2–3), not treated as internal pages
- [ ] OAuth/identity-provider domains correctly detected and seeded into `externalAuthDomains` with a default `handoffStrategy`

## AI Recommendations (backend/infra)
- [ ] Every recommendation type in `AI_AGENT_SPEC.md` §7 produces a schema-valid `AIRecommendation` for a representative real site
- [ ] Malformed/schema-invalid AI response triggers the retry-once-then-fallback behavior (`AI_AGENT_SPEC.md` §11), verified by forcing a malformed response in a test environment
- [ ] Low-confidence recommendation correctly falls back to deterministic default or "ask the user" rather than being presented as if confident
- [ ] Two recommendations targeting the same field correctly supersede (older auto-rejected with the specified reason), never both shown as active
- [ ] Prompt-injection attempt embedded in website content (e.g. a page containing "ignore previous instructions...") does not alter AI behavior — verify against a deliberately adversarial test page

## Blueprint (backend/infra)
- [ ] A completed Screens 1–13 flow produces a schema-valid, versioned Blueprint
- [ ] Every validation rule in `APP_BLUEPRINT.md` §14 verified individually (dangling route references rejected, out-of-enum values rejected, signingRef absence enforced pre-3A, etc.)
- [ ] Contrast-correction tiers verified for all three outcomes: valid-unchanged, auto-adjusted-with-notice, fallback-with-notice — not just the failure case
- [ ] Icon/logo/splash fields reference managed `assetRef`s, never a raw external URL, for both discovered and uploaded assets

## Builder App / Runtime Template v0.1 (AI Studio)
- [ ] Screens 1–15 complete end-to-end for at least three structurally different real sites (e.g. an ecommerce site, a content/blog site, a SPA)
- [ ] Screen 15 preview is navigable and tappable, correctly reflects the configured navigation type/items, theme tokens, native screens (all variants), and status bar
- [ ] Anonymous discovery (Screens 1–3) → auth prompt at the Screen 3→4 transition → ownership transfer verified, no loss of discovery results across that transition
- [ ] Job progress screens (2 and 14) correctly map `job.progress_step` to the specified human-readable copy, never a raw internal status string
- [ ] Project List correctly resumes a returning user to the right screen per `BUILDER_UX_FLOW.md` §7

## Explicit Non-Regression Check
- [ ] No build was attempted anywhere in this phase's testing — confirming the phase boundary itself held, not just the features within it
