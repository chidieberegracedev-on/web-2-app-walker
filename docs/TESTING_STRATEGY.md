# Testing Strategy

Governed by `00_PRODUCT_HANDOFF.md` §33's testing philosophy. This document defines the categories and ownership; concrete per-phase checklists live in `/testing/PHASE_1_CHECKLIST.md`, `PHASE_2_CHECKLIST.md`, `PHASE_3_CHECKLIST.md`.

## Principle

Compiling — or, in Phase 1's case, simply not crashing — is never the bar. Every phase's Definition of Done (`/phases/`) requires the testing categories below to actually be exercised, not assumed.

## Categories

**Functional** — does the feature do what it's specified to do, per the relevant architecture document (not per general expectation of "an app like this").

**UI** — does the expected interface actually appear, using the actual components/tokens specified in `/ui/`, not a reasonable-looking approximation of them.

**Integration** — do subsystems communicate correctly across the boundaries `SYSTEM_ARCHITECTURE.md` §4 defines as must-not-couple. This is where a violation of those boundaries would actually be caught — e.g. confirming the AI Analysis Module never writes a Blueprint field directly, only ever produces `AIRecommendation`s that the Backend API separately validates and applies.

**Regression** — does the next phase preserve everything the previous phase proved. This is not optional or implicit: each phase document's "Testing Required" section explicitly names the prior phase's capabilities that must be re-verified, not just assumed to still work because nothing about them was intentionally changed.

**Edge cases** — the specific list in `00_PRODUCT_HANDOFF.md` §33: invalid URLs, unreachable websites, redirects, SPAs, huge websites, broken links, external links, no favicon, multiple icons, dark websites, non-responsive websites, authentication, dynamic navigation, unusual route structures. These are assigned to the phase where they first become testable (mostly Phase 1, since they're discovery/Blueprint concerns) and re-verified in later phases' regression testing.

**State** — login, navigation, cookies, storage, background/foreground, session continuity, restoration (`STATE_ARCHITECTURE.md`). Only meaningfully testable once Phase 2's full state depth exists; Phase 1 tests only that basic in-session state doesn't break during a single foreground session.

**Preview/build parity** — the preview should behave as closely as possible to the final generated app (Decision 005). Fully closeable only once Phase 3 produces a real artifact to compare against — Phase 2's testing can confirm the preview and generated-app renderer are literally the same module, but the actual side-by-side behavioral comparison is a Phase 3 activity.

## Ownership

Consistent with the ownership boundary running through this whole repository (Decision 019): tests for the Builder App and Runtime Template (functional, UI, most integration and state tests) are AI Studio-side work, exercised in the Android testing toolchain. Tests for the Backend API, Discovery Worker, AI Analysis Module, and Build Worker (most integration, all discovery/AI/build-pipeline edge cases, reproducibility) are backend-side work, exercised however that stack's tooling handles it — this document doesn't prescribe a specific backend test framework, since that's an implementation detail of tooling not yet chosen, not an architectural decision this repository needs to lock.

## What This Document Does Not Do

It does not specify numeric coverage targets, specific test-framework choices, or CI configuration — those are operational decisions for whoever implements each side of the ownership boundary, not architectural ones this repository needs to freeze. What's locked here is which categories exist and what each one is actually responsible for catching.
