# Phase 1 — Foundation + Discovery

Governed by 00_PRODUCT_HANDOFF.md §30, Decision 002 (discovery), Decision 010/011 (build/editor excluded from this phase), Decision 019–021 (ownership boundary, Runtime Template model). Assembles definitions already established elsewhere rather than introducing new scope.

> **⚠ SUPERSEDED IN PART — read with Decision 022.** "What Backend/Infrastructure Builds" below assigns the AI Analysis Module to the Backend API (Vercel). Per **Decision 022**, AI execution — model calls, prompt construction, retry and deterministic-fallback execution, internal page classification, and generation of the frozen five recommendation types — is built and runs in the **Walker Discovery Worker (Railway)**. Beagle validates what Walker submits, owns recommendation persistence and lifecycle, and constructs and persists the Blueprint; it makes no model call. Phase 1's scope, deliverables and Definition of Done are otherwise unchanged — the same work is still Phase 1 work, on the other side of the Vercel/Railway line.

## Goal

Prove the platform can understand a website and produce a coherent, editable application Blueprint with a basic but accurate preview — before any commitment to a compiled build or a full editing experience.

## What AI Studio Builds

- **Builder App, Screens 1–15** (`00_PRODUCT_HANDOFF.md` §8, sequenced in `BUILDER_UX_FLOW.md` §1): welcome/URL input, live analysis progress, discovery summary, identity/name, navigation recommendation, page selection, app style, design customization, native screen recommendations + template selection, status bar configuration, final review, build-progress screen, preview. Screens 16–19 (the editor) are explicitly **not** built in this phase (Decision 011).
- **Runtime Template v0.1** (Decision 020, 021): the first version of the reference implementation, scoped to what Screen 15's preview actually needs to render accurately —
  - Navigation shell (bottom/top/side, per `theme.navigation`)
  - WebView runtime, basic — loads website pages, no requirement yet to survive backgrounding or complete a real third-party OAuth flow
  - Theme token rendering (`DESIGN_SYSTEM.md` §B) — corners, borders, cards, spacing, icons, typography, resolved colors
  - Native screen template rendering — all three types and their variants (`COMPONENT_SPEC.md` §3), since Screens 10–11 configure these and Screen 15 must show them
  - Status bar rendering (`APP_BLUEPRINT.md` §8), live in the preview frame
  - **Explicitly not required yet**: the full session/state depth of `STATE_ARCHITECTURE.md` (restoration across process death, the three OAuth handoff strategies), or the routing depth of `ROUTING_ARCHITECTURE.md` (back-stack nuance, deep links) — those are Phase 2 hardening. A Phase 1 preview that resets state on backgrounding, or whose "external auth" handling is a placeholder rather than a fully working handoff, is acceptable here and is not a Phase 1 defect.

## What Backend/Infrastructure Builds (Vercel, Railway, Supabase)

- **Discovery Worker** (Railway, Node/Playwright) implementing the full pipeline in `DETECTION_PIPELINE.md` — crawl/render/extract/normalize/classify, producing a `DiscoveryResult`, within the Phase 1 default limits (`SYSTEM_ARCHITECTURE.md` §8: 40 pages, depth 3, 15s/page, 5min job).
- **Backend API** (Vercel): auth, the AI Analysis Module (`AI_AGENT_SPEC.md`) producing `AIRecommendation` artifacts for every recommendation type listed there (page classification, navigation, homepage, theme/template, native-screen, logo/asset), Blueprint validation and versioning (`APP_BLUEPRINT.md` §14–15), job orchestration for discovery jobs.
- **Supabase**: Projects, Blueprint versions, `DiscoveryResult` storage, Assets (managed icon/logo/splash — `SYSTEM_ARCHITECTURE.md` §7), `AIRecommendation` records, realtime job-status signaling.
- **No Build Worker at all in this phase.** Not even stage 3A. This is stated explicitly (also in `BUILD_ARCHITECTURE.md` §3) because it's the single most important phase boundary to hold: if the generator or build pipeline is struggling, that must never be able to contaminate the discovery/Blueprint foundation this phase exists to prove.

## Dependencies on Previous Phases

None — this is the first phase. It does, however, establish the two things every later phase depends on: the Blueprint contract (`APP_BLUEPRINT.md`) as a stable schema, and Runtime Template v0.1 as the seed of the codebase Phase 2 deepens rather than replaces.

## Definition of Done

Given a website URL, a user can complete Screens 1–15 and end up with:
- A valid, schema-validated, versioned App Blueprint (`APP_BLUEPRINT.md` §14–15)
- Discovery results and AI recommendations that are traceable and explainable (`AI_AGENT_SPEC.md` §9) — no invented facts, no unexplained suggestions
- A basic interactive preview (navigable, tappable — product handoff's own requirement for Screen 15) that accurately reflects the configuration choices made in Screens 4–12: correct navigation type/items, correct theme tokens, correct native screens with their chosen variants, correct status bar
- Contrast/system-UI corrections, if any occurred, surfaced as visible non-blocking notices (`APP_BLUEPRINT.md` §14), never silent
- All of this survives a normal foreground session without crashing or losing configuration mid-flow

Explicitly **not** required for Phase 1 done: the preview surviving app backgrounding/process death, a real OAuth login completing end-to-end inside the preview, any build artifact, any deep link handling.

## What Must NOT Be Attempted Yet

- Any build, at any stage — 3A/3B/3C do not exist yet (Decision 010)
- The visual editor, Screens 16–19 (Decision 011)
- Full `STATE_ARCHITECTURE.md` implementation — session persistence beyond basic cookies/localStorage working during a live foreground session, the three OAuth handoff strategies, restoration-policy handling across process death
- Full `ROUTING_ARCHITECTURE.md` implementation — back-stack nuance between WebView history and app nav, external-link Custom Tab handling, custom URI scheme deep links
- iOS generation or Kotlin Multiplatform (Decision 006)
- Prioritized/scoped crawling beyond the flat Phase 1 defaults (`SYSTEM_ARCHITECTURE.md` §8) — large-site handling stays deferred
- Remote configuration (Decision 021 — out of scope for V1 generally, not just this phase)

## Testing Required Before Moving to Phase 2

Full checklist in `/testing/PHASE_1_CHECKLIST.md`. At minimum: every edge case in `00_PRODUCT_HANDOFF.md` §33 relevant to discovery and Blueprint generation (invalid/unreachable URLs, redirects, SPAs, huge sites, broken/external links, missing/multiple icons, dark/non-responsive sites, dynamic nav), the full recommendation confidence-tier behavior (`AI_AGENT_SPEC.md` §6), and the contrast-correction visible-notice behavior (`APP_BLUEPRINT.md` §14) all verified against real websites, not just the happy path.
