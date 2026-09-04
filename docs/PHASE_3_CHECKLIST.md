# Phase 3 Checklist

Concrete, checkable items against `/phases/PHASE_3.md`'s Definition of Done. Includes explicit Phase 1/2 regression items, per `/testing/TESTING_STRATEGY.md`.

## Phase 1/2 Regression (must still pass, unchanged)
- [ ] Every item in `/testing/PHASE_1_CHECKLIST.md` and `/testing/PHASE_2_CHECKLIST.md` re-verified — a working build pipeline must not have come at the cost of the discovery, Blueprint, editor, state, or routing behavior already proven

## Generator Compatibility Validation (backend/infra)
- [ ] A Blueprint whose `schemaVersion` the current generator doesn't support is rejected synchronously, before a Build Manifest is created, with a clear message — never dispatched to the Build Worker to fail there instead
- [ ] An incompatible generator/runtime/template version combination is rejected the same way

## Stage 3A — Debug Build (backend/infra)
- [ ] A validated Blueprint reliably produces an installable debug APK for each of the representative sites used in Phase 1/2 testing
- [ ] The produced APK's navigation, theme, native screens, and status bar match the Blueprint exactly — direct comparison against the Phase 2 preview, closing out the preview/parity checklist item deferred from Phase 2
- [ ] Build status/progress/logs surface correctly through the same job-progress UI pattern as discovery (`BUILDER_UX_FLOW.md` §9)
- [ ] Build compile failure (deliberately induced, e.g. a malformed generator output in a test scenario) produces the categorized failure message from `BUILD_ARCHITECTURE.md` §11, not a raw Gradle stack trace

## Stage 3B — Signed Release Build (backend/infra)
- [ ] Signing key resolution works correctly via `signingRef`, never exposing a real credential in any API response, log, or client-visible location — verify by inspecting actual logs/responses, not just reading the code that's supposed to prevent it
- [ ] Signed APK and AAB both produced correctly and are installable/valid
- [ ] Artifact stored durably and retrievable via a time-limited signed download URL, never a raw public link
- [ ] Signing failure (deliberately induced, e.g. a missing/invalid key reference in a test scenario) triggers the distinct, more urgent alert path specified in `BUILD_ARCHITECTURE.md` §11, verified as actually distinguishable from a routine build failure

## Reproducibility (backend/infra)
- [ ] Rebuilding the same `blueprintVersion` twice, with no explicit "use latest generator" action, produces builds recorded against identical `generatorVersion`/`runtimeVersion`/`templateVersion` — verify the Build Manifest, not just that the resulting APK looks the same
- [ ] Explicitly requesting a rebuild against the current generator/runtime/template creates a new Build Manifest with updated versions, and this is a distinct, deliberate action distinguishable from a default rebuild
- [ ] Bundled config export inspected directly (e.g. by decompiling a test APK) to confirm no backend-only fields (`signingRef`, internal database IDs) are present — this is a security check, not just a functional one, per the bundled-config principle in `BUILD_ARCHITECTURE.md`

## Queueing, Concurrency, Cancellation (backend/infra)
- [ ] Multiple builds submitted concurrently complete correctly and independently — no cross-contamination between build sandboxes (verify one project's build cannot read another's source/secrets/artifacts)
- [ ] A build cancelled mid-compile correctly resolves to `cancelled` status with no artifact stored, never a partial/corrupt artifact left retrievable
- [ ] Queue behavior verified under a load higher than one build at a time, not just sequential single builds

## Runtime Independence (AI Studio + backend/infra)
- [ ] A generated app installed on a device with no network connectivity to the platform's backend still launches and renders its core shell/navigation/theme correctly from bundled config — only the actual customer-website content (via WebView) requires network access, and that failure is distinguishable from a "the app itself is broken" failure

## Explicit Non-Regression Check
- [ ] No Play Console/Play Store publishing automation (3C) was attempted anywhere in this phase's testing, confirming that boundary held
