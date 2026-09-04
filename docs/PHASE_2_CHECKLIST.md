# Phase 2 Checklist

Concrete, checkable items against `/phases/PHASE_2.md`'s Definition of Done. Includes explicit Phase 1 regression items, per `/testing/TESTING_STRATEGY.md`.

## Phase 1 Regression (must still pass, unchanged)
- [ ] Every item in `/testing/PHASE_1_CHECKLIST.md` re-verified against the current build — Phase 2 changes to the Runtime Template must not have broken Phase 1's discovery/Blueprint/basic-preview flow
- [ ] Screens 1–15 still function correctly for the same representative sites used in Phase 1 testing

## Visual Editor (AI Studio)
- [ ] Screen 16 correctly opens with structure panel, live preview, and empty/default inspector state
- [ ] Selecting an item in the structure panel opens the matching Screen 18 inspector, showing only fields relevant to that object type (`BUILDER_UX_FLOW.md` §8)
- [ ] Selecting the same item directly in the live preview produces the identical inspector state as selecting it via the structure panel
- [ ] Reordering navigation items in Screen 17 updates the live preview immediately, no separate "apply" step required
- [ ] Screen 19 (Add Screen) correctly offers only supported native screen types with system-recommended defaults
- [ ] Every Blueprint edit made through the editor creates a new `blueprintVersion` (append-only, per `APP_BLUEPRINT.md` §15) — verify version history is genuinely queryable afterward, not just that the current state updated

## State/Session (AI Studio — Runtime Template)
- [ ] Cookies, localStorage, sessionStorage, and IndexedDB each independently verified persistent across app restart, per `state.sessionPersistence` flags
- [ ] Real OAuth login (against at least one real identity provider — Google is the recommended first target given its strict Custom Tabs requirement) completes and the WebView reflects an authenticated session afterward — this is the single highest-risk item in this phase and should not be considered done from a code read alone
- [ ] Each of the three handoff strategies (`STATE_ARCHITECTURE.md` §3) verified against at least one real site using that strategy's corresponding auth pattern
- [ ] App backgrounded and resumed within the same process lifetime — WebView state and navigation position preserved (`resumeLastRoute`)
- [ ] App process killed by the OS and relaunched — navigation position correctly restored or reset per the project's configured `restorationPolicy`, not left ambiguous
- [ ] `resumeLastRouteWithinSession`'s time window behavior verified on both sides of the boundary (resumes within window, falls back to home outside it)

## Routing (AI Studio — Runtime Template)
- [ ] Back button correctly unwinds WebView-internal history before popping the app-level nav stack (`ROUTING_ARCHITECTURE.md` §3), verified on a site with genuine multi-level internal navigation (e.g. category → product)
- [ ] External link (different domain) opens via Custom Tab, never inline in the app's own WebView
- [ ] Custom URI scheme deep link correctly opens the app to the matching route
- [ ] A route referenced by a deep link that doesn't exist in `routes[]` is rejected at build/config time, never reached as a dangling runtime reference

## AI Recommendations In Editing (backend/infra + AI Studio)
- [ ] Editing a Blueprint field that has a relevant `AIRecommendation` correctly re-surfaces it inline, using the same confidence-tier presentation as initial onboarding

## Preview/Production Parity
- [ ] Direct code-level confirmation that the preview renderer and the (still theoretical, pre-Phase-3) generated-app renderer are the same module/dependency, not two implementations that happen to look similar
