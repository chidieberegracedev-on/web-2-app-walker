# Builder UX Flow

Governed by Decision 011 (visual editor is Phase 2), Decision 014 (persistent Projects), Decision 015 (auth timing). Specifies the actual flow behind the 19 screens described at product level in `00_PRODUCT_HANDOFF.md` §8, using the tokens/components in `/ui/DESIGN_SYSTEM.md` and `/ui/COMPONENT_SPEC.md`.

## 1. Screen Flow Map

```
[Returning user with existing Projects] → Project List (§7) → select a Project → Screen 13 or 16
[New session / new Project]
  ↓
Screen 1 (Welcome / URL input)
  ↓
Screen 2 (Analysis — live progress, §3)
  ↓
Screen 3 (Discovery Summary)
  ↓
  ── anonymous → authenticated transition point (§5) ──
  ↓
Screen 4 (Logo/Identity) → Screen 5 (App Name)
  ↓
Screen 6 (Navigation Recommendation) → Screen 7 (Page Selection)
  ↓
Screen 8 (App Style) → Screen 9 (Design Customization)
  ↓
Screen 10 (Native Screen Recommendations) → Screen 11 (Template Selection)
  ↓
Screen 12 (Status Bar / System UI)
  ↓
Screen 13 (Final Review) ── back-edit to any prior screen ──
  ↓
Screen 14 (Building — live progress, §3)
  ↓
Screen 15 (Preview) ── Phase 1 boundary; below is Phase 2 ──
  ↓
Screen 16 (Visual Editor) ↔ Screen 17 (Structure) ↔ Screen 18 (Design Editor) ↔ Screen 19 (Add Screen)
  ↓
Build (Phase 3 — see §9)
```

Screens 4–12 are not strictly linear in the sense of forbidding back navigation — Screen 13's Final Review explicitly allows jumping back to any of them (product handoff §8, Screen 13) — but the sequence above is the default forward path a new project follows.

## 2. Phase Boundary in the Flow

Screens 1–15 (minus the interactivity depth of the preview itself) are Phase 1 scope. Screens 16–19 — the structure editor, contextual design editor, add-screen flow — are Phase 2 (Decision 011). Concretely: Phase 1's Screen 15 preview is navigable/tappable (product handoff's own requirement for that screen) but has no edit affordance reachable from it; the "Edit" entry point into Screen 16 does not exist until Phase 2 ships. This isn't a UI element that's disabled or hidden — it's simply not built yet, consistent with not designing UI for a feature phase that isn't there (`00_PRODUCT_HANDOFF.md` §36's non-goals).

## 3. Loading and Progress States

Screens 2 and 14 both render live progress against the async `Job` model (`SYSTEM_ARCHITECTURE.md` §5): the Builder App subscribes to the job's Supabase realtime channel as a signal to re-fetch authoritative status, and maps `job.progress_step` to the human-readable copy the product handoff specifies for each screen (discovery steps for Screen 2, build steps for Screen 14). The Builder App never renders a raw technical status string — `progress_step` values are written specifically to be user-facing copy, not internal state names.

Both screens block forward navigation until the job resolves (`succeeded` or a handled failure, §4) — there is no "skip ahead while it's still running" affordance, since Screens 3+ and 15 both require the job's actual output to render meaningfully.

## 4. Error States In Flow

Each error category from `SYSTEM_ARCHITECTURE.md` §9 surfaces at the screen where it's actionable, not as a generic global error dialog:

| Error | Surfaces at | Recovery affordance |
|---|---|---|
| Site unreachable/timeout | Screen 2, blocking | "Try again" returns to Screen 1 with the URL retained |
| No usable icon found | Screen 4 | Non-blocking — Screen 4's "upload another" affordance is already the recovery path, so this isn't an error state so much as an empty state with the same UI |
| AI recommendation fell back to deterministic | Screens 6, 8, 10 | Non-blocking — the recommendation still renders, just without the AI-sourced reasoning copy (`AI_AGENT_SPEC.md` §11); not surfaced as an error to the user at all, since a deterministic fallback is a normal, expected outcome, not a failure |
| Contrast auto-correction applied | Screens 9, 12 | Non-blocking toast/banner using the exact notice pattern from `APP_BLUEPRINT.md` §14 — appears immediately after the affected selection, never retroactively on a later screen |
| Build compile failure | Screen 14, blocking | Human-readable summary (`BUILD_ARCHITECTURE.md` §11) with a "back to editor" path, not a dead end |

The distinction between blocking and non-blocking matters for the flow specifically: a non-blocking notice never prevents reaching Screen 13/15, consistent with the product's stated philosophy that a color or recommendation choice should never be the thing standing between a user and a working app (`APP_BLUEPRINT.md` §14).

## 5. Anonymous → Authenticated Transition

Decision 015 sets the default flow but left exact placement for product/security review — placing it concretely here: the auth prompt appears when the user taps "Continue" out of Screen 3 (Discovery Summary) into Screen 4. This is the natural boundary between "I was just curious what this would find" (Screens 1–3, no commitment) and "I'm actually starting to configure something I want to keep" (Screen 4 onward, where identity/name/nav decisions start accumulating). The temporary anonymous Project created during Screens 1–3 (`SYSTEM_ARCHITECTURE.md` §7) transfers ownership to the account created at this point, so nothing already discovered is lost or repeated.

## 6. Recommendation Accept/Reject/Modify UX

Screens 6, 8, and 10 all render `AIRecommendation` artifacts (`AI_AGENT_SPEC.md` §4) through the same interaction pattern, using the Recommendation Card component (`COMPONENT_SPEC.md` §2):

- **High-confidence** recommendations render pre-selected (the selector chip, `DESIGN_SYSTEM.md` §A3, starts in its selected state) — the user can still tap to deselect, but the default is "accept."
- **Medium-confidence** recommendations render as clearly optional — the chip starts unselected, positioned as a suggestion rather than a default.
- **Low-confidence** cases don't render an AI-sourced card at all — the screen shows the deterministic fallback option directly (`AI_AGENT_SPEC.md` §6), with no confidence-related UI distinguishing it from any other option, since there's nothing meaningfully AI-driven left to show.

Every rendered recommendation shows its `reason` field inline, in the exact tone the product handoff specifies (§5, §18) — never a raw confidence number. Modifying a recommendation (e.g. reordering navigation items the AI suggested) records the modification against that `AIRecommendation`'s `status: modified` without requiring a separate "why did you change this" prompt — the changed value itself is the signal.

## 7. Project Management

A returning user with existing Projects (Decision 014) lands on a Project List rather than Screen 1 — each entry shows the project's app name/icon (once past Screen 4), current status (draft, built, needs attention if a recent build failed), and last-modified time. Selecting a project resumes at Screen 13 (Final Review) if it has a complete Blueprint but hasn't been built yet, or Screen 16 (Editor) if it has already been built at least once — this keeps a returning user from re-walking the full onboarding sequence for a project they've already configured. Starting a new Project always begins at Screen 1 regardless of existing projects.

## 8. Phase 2 Editor Flow (Screens 16–19)

- **Screen 16** is the entry shell: structure on one side, the live interactive preview (sharing the Runtime Template's renderer, Decision 005) centered, contextual inspector alongside — selecting something in either the structure list or directly in the preview opens the matching Screen 18 inspector for that object.
- **Screen 17** (Structure Editor) and **Screen 19** (Add Screen) are both reachable from Screen 16's structure panel, not separate top-level destinations — Add Screen is specifically the action taken from Screen 17 when adding a new entry, not a screen a user navigates to independently.
- **Screen 18** (Contextual Design Editor) only ever shows fields relevant to whatever's currently selected (product handoff §8's own UX direction for this screen) — there's no "edit anything from anywhere" mode; the inspector's content is entirely driven by selection state.

## 9. Phase 3 Build Flow

From Screen 16 (or Screen 13 for a first build), initiating a build follows the job model exactly like discovery (§3) — Screen 14's progress copy, once Phase 3A exists, reflects Build Worker stages rather than Discovery Worker stages, but uses the identical progress-screen pattern rather than a separate build-specific UI. On success, the user reaches a build-result state (not one of the original 19 screens — a new one, downloadable-artifact-focused) showing the artifact (debug APK in 3A, signed APK/AAB in 3B) with a share/download affordance. On failure, the categorized failure message (`BUILD_ARCHITECTURE.md` §11) renders with a path back into Screen 16/18 if the failure is something the user's own configuration could plausibly fix, or a generic "we're looking into it" state if it's a generator/infrastructure failure the user has no ability to act on.
