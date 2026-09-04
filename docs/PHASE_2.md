# Phase 2 — Application Composition + Runtime

Governed by 00_PRODUCT_HANDOFF.md §31, Decision 011 (visual editor), Decision 005 (preview/production parity), Decision 007–008 (state/OAuth), Decision 019–021 (ownership boundary, Runtime Template model).

## Goal

Turn the Phase 1 Blueprint into a genuinely usable, editable application experience, and bring the Runtime Template up to full production depth on state and routing — the two subsystems Phase 1 deliberately left at a basic level.

## What AI Studio Builds

- **Builder App, Screens 16–19** (`BUILDER_UX_FLOW.md` §8): the Visual Editor shell (structure + live preview + contextual inspector), Structure Editor, Contextual Design Editor, Add Screen. This is real, nontrivial Compose UI work — drag/reorder bound to a live-updating preview — which is exactly why Decision 011 kept it out of Phase 1.
- **Runtime Template, brought to full depth**:
  - Full `STATE_ARCHITECTURE.md` implementation: all four persistence categories working correctly across app lifecycle (§2), the three named OAuth handoff strategies actually implemented and selectable per domain (§3), real restoration-policy behavior across process death (§5), correct pause/resume lifecycle handling (§6)
  - Full `ROUTING_ARCHITECTURE.md` implementation: correct back-stack behavior between WebView history and the app-level nav stack (§3), external-link Custom Tab handling (§4), custom URI scheme deep links registered (§5 — App Links verification stays optional/later even now, per that document)
  - Preview/production parity hardened to what Decision 005 actually requires: by the end of this phase, the preview is not an approximation of the generated app's behavior — it *is* the same renderer module, state handling included
- **AI recommendations inside editing**: re-surfacing relevant `AIRecommendation`s as the user edits in Screens 16–18, not just during the initial Screens 6/8/10 flow — same lifecycle and confidence-tier behavior as Phase 1 (`AI_AGENT_SPEC.md` §5–6), just triggered by edit actions instead of only initial discovery.

## What Backend/Infrastructure Builds

- Backend API: Blueprint validation extended to handle incremental editor changes (not just initial creation) — same validation rules (`APP_BLUEPRINT.md` §14), applied to a stream of smaller edits rather than one large initial write.
- Supabase: no new components — Blueprint version history (already modeled in Phase 1) is what makes the editor's implicit undo/history possible; this phase is where that capability actually gets exercised by real UI.
- **Still no Build Worker.** Stage 3A does not start in this phase either — Phase 2 proves the application is genuinely usable and correctly stateful; it does not yet prove it's buildable into a real artifact. That's Phase 3's entire purpose, and conflating the two would undermine the reason these are separate phases.

## Dependencies on Phase 1

Requires a stable, already-validated Blueprint schema and a working discovery/AI pipeline — the editor edits an existing Blueprint, it doesn't create the concept of one. Also requires Runtime Template v0.1 as the base being deepened, not replaced — the navigation shell, theme rendering, and native screen templates built in Phase 1 are extended with real state/routing behavior here, not rebuilt from scratch.

## Definition of Done

A user can:
- Open the Visual Editor on an existing Blueprint and see the same live preview from Phase 1, now genuinely representative of final app behavior (state included)
- Make structural changes (reorder/add/remove nav items and screens) and design changes (theme/template adjustments) that update the preview in real time
- Complete a real third-party OAuth login inside the preview and see the WebView correctly reflect an authenticated session afterward (`STATE_ARCHITECTURE.md` §3 working end-to-end, not just specified)
- Background and resume the preview without losing session state, per the project's configured `restorationPolicy`
- Navigate using the app's own nav plus in-website links and get correct back-button behavior distinguishing WebView history from app-level navigation (`ROUTING_ARCHITECTURE.md` §3)

Still **not** required: any compiled build artifact, Android App Links verification, iOS/KMP anything.

## What Must NOT Be Attempted Yet

- Any build, at any stage (3A/3B/3C) — this remains entirely Phase 3's scope
- Android App Links verification automation (`ROUTING_ARCHITECTURE.md` §5 — explicitly optional/later even through this phase)
- iOS generation or Kotlin Multiplatform (Decision 006)
- Remote configuration (Decision 021)
- Any expansion of the recommendation types or template presets beyond what `AI_AGENT_SPEC.md` §7 and `DESIGN_SYSTEM.md` §C already define — this phase makes existing recommendations editable, it doesn't add new categories of them

## Testing Required Before Moving to Phase 3

Full checklist in `/testing/PHASE_2_CHECKLIST.md`. At minimum: regression testing confirming every Phase 1 discovery/Blueprint-generation capability still works unchanged (`00_PRODUCT_HANDOFF.md` §33's regression principle — does Phase 2 break Phase 1), the state/session edge cases in that same section (login, navigation, cookies, storage, background/foreground, session continuity, restoration) verified against real third-party OAuth providers, and preview/build parity confirmed by direct comparison against what Phase 3A eventually produces once that phase begins — meaning this checklist has one item that can only be fully closed out retroactively, and that's expected, not a gap in this document.
