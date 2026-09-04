# Phase 3 — Production Build + Distribution

Governed by Decision 009, 010, 016, 017, 018, 019, 020, 021, and the full mechanics already specified in `/architecture/BUILD_ARCHITECTURE.md`. This document applies the phase-doc framing (AI Studio vs. backend, dependencies, DoD, non-goals, testing) on top of that already-locked design — it does not redefine the build pipeline.

## Goal

Turn a Phase 2-validated Blueprint into a real, reliable, distributable Android application — staged deliberately (3A → 3B → 3C) so a struggling generator or build environment never has to be solved all at once.

## What AI Studio Builds

**Almost nothing new.** This is worth stating plainly rather than glossing over, because it's the direct, intended consequence of Decision 019/020/021: AI Studio's production-relevant work — the Builder App and the Runtime Template — was already built in Phases 1 and 2. Phase 3's job is turning an already-proven Runtime Template release into real compiled apps, which is backend/infrastructure work by definition (`BUILD_ARCHITECTURE.md` §2).

The only AI Studio-relevant activity in this phase is **ongoing Runtime Template maintenance** — bug fixes or improvements discovered while integrating with the real Generator/Build Worker for the first time, released as new `runtimeVersion`s the way any other Runtime Template update would be (Decision 020). This is maintenance of existing work, not new scope.

## What Backend/Infrastructure Builds

Fully specified in `BUILD_ARCHITECTURE.md` — restated here at the phase level, not redefined:

- **Generator Compatibility Validation** (§4): schema/version compatibility checks before a build is ever dispatched
- **Build Manifest generation** (§5): the Backend API resolving `blueprintVersion` + `generatorVersion` + `runtimeVersion` + `templateVersion` + stage into a manifest before dispatch
- **The Generator itself**: parameterizing a released Runtime Template snapshot with a customer's Blueprint, Assets, and build config into a real Android project (Decision 021's data-driven-shell model — this is what makes the Generator's job "bundle a config," not "write Kotlin")
- **Build Worker** (§7): Android SDK/Gradle in a sandboxed, ephemeral environment
- **Signing isolation** (§6), **queueing/concurrency/cancellation** (§8), **artifact storage/retention** (§9), **reproducibility** (§10), **build-specific failure handling** (§11) — all already specified, implemented here for the first time

### Stage 3A — Prove the generator works
```
Blueprint → Build Manifest → Generator → Debug/unsigned APK
```
No signing, no distribution concerns. Definition of done (`BUILD_ARCHITECTURE.md` §3): given a validated Blueprint, the Build Worker reliably parameterizes the current Runtime Template release into a customer Android project and produces an installable debug APK reflecting the Blueprint's configuration, with build status/logs/errors visible per `SYSTEM_ARCHITECTURE.md` §9.

### Stage 3B — Prove it's distributable
```
Blueprint → Build Manifest → Generator → Release build → Signing → APK/AAB → Artifact storage
```
Adds release signing, AAB generation, durable artifact management. Definition of done: a signed, installable release build produced and stored durably, reproducible against its recorded Build Manifest.

### Stage 3C — Publishing automation (future milestone, not in this phase's scope)
```
Release artifact → Play Console integration → Store publishing
```
**Explicitly not part of this phase's definition of done.** Restated because it's the single easiest thing to accidentally assume is "just the last step" once 3A/3B ship — it's a distinct, later product/business decision with its own scope (`BUILD_ARCHITECTURE.md` §3).

## Dependencies on Previous Phases

Everything. This phase cannot start meaningfully until: the Blueprint schema is stable and proven against real projects (Phase 1), and the Runtime Template is at full state/routing depth and is genuinely data-driven/self-contained per Decision 021 (Phase 2) — the Generator's entire simplicity depends on the Runtime Template already being a generic shell rather than something that needs per-customer Kotlin changes. Attempting Phase 3 against a Runtime Template that still has hardcoded, non-parameterized behavior would force the Generator to become a code-generation system instead of a configuration-packaging system, which is exactly the complexity Decision 021 exists to avoid.

## Definition of Done

Given an approved, Phase-2-validated Blueprint:
- Stage 3A: a debug APK is reliably produced, installable, and reflects the Blueprint's configuration
- Stage 3B: a signed release build (APK/AAB) is reliably produced, stored durably, and reproducible against its Build Manifest
- Rebuilding an existing Blueprint version by default reproduces the same artifact (same recorded generator/runtime/template versions) — Decision 017's guarantee, verified in practice here for the first time
- Build failures are categorized and surfaced per `BUILD_ARCHITECTURE.md` §11, never a raw stack trace

Stage 3C (Play Store publishing) is explicitly **not** part of this definition of done.

## What Must NOT Be Attempted Yet

- Stage 3C Play Console integration and per-developer-account publishing automation
- iOS generation or Kotlin Multiplatform (Decision 006) — Android remains the only generator target until it's fully proven
- Remote configuration (Decision 021)
- Any expansion of the Runtime Template's actual capabilities beyond what Phase 2 already established — this phase builds what already exists, it doesn't grow scope while doing so
- Resolving the signing-key ownership model for eventual customer-owned Play Console identities (`BUILD_ARCHITECTURE.md` §6) — the V1 default (platform-managed signing) holds through this phase; that later decision is explicitly tied to when 3C becomes real, not before

## Testing Required Before Considering the Build Pipeline Done

Full checklist in `/testing/PHASE_3_CHECKLIST.md`. At minimum: every failure category in `BUILD_ARCHITECTURE.md` §11 deliberately triggered and verified (not just the happy path), reproducibility verified by rebuilding the same Blueprint version twice and confirming identical recorded versions, queueing/concurrency/cancellation verified under real concurrent load rather than only single-build testing, and the full regression check — does everything proven in Phases 1 and 2 still work once a real build artifact exists at the end of the pipeline.
