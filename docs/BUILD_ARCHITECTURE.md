# Build Architecture

Governed by Decision 009 (real per-project apps), Decision 010 (staged build pipeline), Decision 016 (AI never writes the Blueprint), Decision 017 (build reproducibility), Decision 018 (service boundary discipline), Decision 019 (implementation ownership boundary). Consistent with `/architecture/APP_BLUEPRINT.md` and `/architecture/SYSTEM_ARCHITECTURE.md` §2, §6, §9, §10 — this document is where the Build Manifest concept those introduced gets fully specified, not re-derived differently.

## 1. Purpose and the Build Manifest Principle

**The Blueprint describes what the application should be. The Build Manifest records exactly how a particular build was produced.** Everything in this document exists downstream of that split.

```
Reference Runtime Template (AI-Studio-developed, versioned release — Decision 020)
                    │
Blueprint ──────────┼──── Assets
                    ▼
     Generator Compatibility Validation   (§4)
                    ↓
              Build Manifest              (§5)
                    ↓
              Build Worker                (§7)
        (parameterizes the released Runtime
         Template with Blueprint + Assets +
         build configuration)
                    ↓
                Artifact                  (§9)
```

Restated as the resolved pipeline principle (Decision 020):

```
Reference Runtime Template + Blueprint + Assets + Generator → Customer Android Project → Gradle → APK/AAB
```

Nothing here changes the platform-neutral Blueprint schema itself — build-time facts (which generator, which runtime, which template version) live in the manifest precisely so the Blueprint stays clean enough for a future iOS generator to read with no Android-specific baggage attached (`APP_BLUEPRINT.md` §13).

## 2. Implementation Ownership Boundary

**Anything that runs on Vercel or Railway is not AI Studio's job** (Decision 019). Resolved for this document specifically, since build infrastructure is where that boundary matters most:

| In AI Studio's scope | Out of AI Studio's scope — standard backend/DevOps tooling |
|---|---|
| The Builder App (all 19 screens, Phase 1/2) | Backend API (Vercel) — auth, validation, AI Analysis Module, Blueprint operations, job orchestration, Build Manifest generation |
| The Runtime/Shell Template — a maintained, versioned reference Android/Kotlin/Jetpack Compose codebase covering navigation, WebView runtime, state/session handling, native screen templates, theme rendering, status bar/system UI, deep links, and lifecycle behavior (Decision 020; full behavioral spec in `/architecture/STATE_ARCHITECTURE.md` and `/architecture/ROUTING_ARCHITECTURE.md`) | Discovery Worker (Railway, Node/Playwright) |
| | Build Worker (Railway/CI) — generator execution, Gradle compilation, signing, artifact upload |
| | Supabase configuration, storage buckets, row-level security policies |
| | The Generator — the backend logic that parameterizes a *released* copy of the Runtime Template per customer |

**Resolved (Decision 020, Decision 021):** AI Studio builds and iterates on the Runtime Template as a real, versioned reference implementation — it is where that code actually lives and evolves. AI Studio is not, however, part of the production build pipeline itself: the Build Worker never invokes AI Studio or generates runtime code live. It consumes a specific **released version** of the Runtime Template (identified by `runtimeVersion` in the Build Manifest, §5) and parameterizes that fixed snapshot with a customer's Blueprint, Assets, and build configuration.

**Locked: the Runtime Template is a generic, data-driven shell, not a per-customer codegen target (Decision 021).** It ships with the same Kotlin/Compose code for every customer, reading its navigation/theme/screen configuration from a bundled config resource rather than having that configuration hardcoded or regenerated per build. The Generator's job per customer is producing a unique `applicationId`, app name, icon set, and a serialized Blueprint-derived config bundled as a resource — never generating or modifying the Runtime Template's actual Kotlin logic. This is what keeps the Runtime Template a single maintainable codebase in AI Studio rather than a thing that forks per customer, and is what makes "AI Studio is not part of the production pipeline" actually true in practice rather than aspirational.

### Bundled Configuration and Runtime Independence

Per Decision 021, the essential configuration and required assets are bundled into the generated app **at build time**, not fetched at runtime. Concretely, the Generator exports a **runtime-relevant subset** of the Blueprint — navigation, theme, routes, deep links, system UI, state policy, native screen config — as a bundled resource the Runtime Template reads on launch. This is deliberately not a raw dump of the full Blueprint record:

- **Security boundary worth naming explicitly:** anything bundled into an APK is effectively public — compiled Android apps are straightforwardly decompilable, so whatever the Generator embeds can be read by anyone with the artifact. The bundled config export must exclude anything backend-only or sensitive — `buildConfiguration.android.signingRef`, internal database identifiers, and any other field that's meaningful only to the Backend API — never a `SELECT *` of the Blueprint record into the APK.
- **The generated app does not call the platform's backend to start or render its core experience.** Once built, it's a self-contained Android app: navigation, theme, native screens, and initial routing all work from the bundled config with zero dependency on Vercel/Supabase being reachable. Its only genuine runtime network dependency is the customer's own website, loaded via the WebView runtime — which is the entire point of the product, not an exception to this principle.
- **Not solved now, deliberately:** optional remote configuration (updating a live project's behavior without a full rebuild) is a real future capability but is out of scope for V1 — introducing a backend dependency into the generated app's core startup path now would work against the reliability property this decision exists to guarantee.

## 3. Build Stages

### Phase 3A — Prove the generator works

```
Blueprint → Build Manifest → Generator → Debug/unsigned APK
```

No signing, no store artifacts, no distribution concerns. The Build Manifest is generated here too, not skipped — Decision 017 scopes reproducibility to "every generated build," and 3A's whole purpose is proving the generator produces a working app from a Blueprint, which is exactly the kind of result you want pinned to a recorded generator/runtime/template version from day one rather than treated as too early to bother tracking.

**Definition of done:** given a validated Blueprint, the Build Worker reliably parameterizes the current Runtime Template release (Decision 020) into a customer Android project and produces an installable debug APK that reflects the Blueprint's navigation, theme, and content configuration, with build status/logs/errors visible to the user per `SYSTEM_ARCHITECTURE.md` §9's error model. Nothing about signing, versioning for release, or Play Store readiness is in scope here.

### Phase 3B — Prove it's distributable

```
Blueprint → Build Manifest → Generator → Release build → Signing → APK/AAB → Artifact storage
```

Adds release signing (§6), proper AAB generation alongside APK, and durable artifact management (§9) — this is what turns "the generator works" into "a customer could actually ship this."

**Definition of done:** a signed, installable release build is produced and stored durably, with `buildConfiguration.android.signingRef` (`APP_BLUEPRINT.md` §13) resolved and enforced (Blueprint validation rule: signingRef required at this stage — `APP_BLUEPRINT.md` §14), and the build is reproducible against its recorded Build Manifest (§8).

### Phase 3C — Publishing automation (future milestone, explicitly out of current scope)

```
Release artifact → Play Console integration → Store publishing
```

**Phase 3C is not part of the definition of done for the initial build pipeline.** Play Console API integration and per-developer-account handling (whose developer account does a generated app publish under — the platform's, or the customer's own) is a distinct, later product/business decision with its own scope, called out here so it never quietly gets treated as implied by "the build pipeline is done" once 3A/3B ship.

## 4. Generator Compatibility Validation

Before a Build Manifest is created, the Backend API checks that the Blueprint is actually buildable by what's currently available:

- **Schema compatibility:** the Blueprint's `schemaVersion` must fall within the range the target `generatorVersion` declares support for (`APP_BLUEPRINT.md` §15 already establishes this rule; this is where it's actually invoked).
- **Version compatibility:** each `generatorVersion` declares which `runtimeVersion`(s) and `templateVersion`(s) it's compatible with. A request that would pair an incompatible combination (e.g. an old runtime forced against a generator that assumes a newer one) is rejected with a clear error before a Build Manifest is ever created — not silently mixed.

A failure here is a **build-request rejection**, distinct from a build-execution failure (§10) — it means the build was never dispatched to a worker at all, which matters for how it's surfaced to the user (immediate, synchronous "this can't be built yet" rather than a job that ran and then failed).

## 5. The Build Manifest

Full shape (first introduced as a stub in `SYSTEM_ARCHITECTURE.md` §6):

```
BuildManifest {
  id, projectId
  blueprintVersion        — which Blueprint content this build is for
  generatorVersion        — which version of the Android generator produced this build
  runtimeVersion          — which version of the shared shell/runtime renderer is embedded
  templateVersion         — which version of the design-token template engine was applied
  buildStage              — "3A" | "3B" | "3C"
  requestedArtifactType   — "debugApk" | "signedAab" | "signedApk"
  assetRefs[]             — resolved managed Asset IDs needed for this build
  status                  — "queued" | "running" | "succeeded" | "failed" | "cancelled"
  createdAt, completedAt
}
```

Created by the Backend API immediately after generator compatibility validation passes (§4), and immediately before dispatch to the Build Worker. It is never mutated by the Build Worker directly — the worker reports outcomes via the authenticated callback (`SYSTEM_ARCHITECTURE.md` §10), and the Backend API updates the manifest's `status` and `completedAt`.

**Why a separate artifact from the Blueprint's `buildConfiguration`:** the Blueprint field describes user-facing, product-level build configuration (package identity, target stage) that's meaningful regardless of which generator eventually reads it. The manifest describes which specific generator/runtime/template combination actually executed — a fact about one build event, not about the product. This split is what makes §8's reproducibility guarantee possible.

## 6. Signing Isolation and Key Management

- Signing keys exist only inside the Build Worker's isolated environment, resolved from `buildConfiguration.android.signingRef` (a pointer, never a literal key — `APP_BLUEPRINT.md` §13). The Backend API can request a signed build but cannot itself sign one, hold a key, or return one in any API response or log output.
- **V1 default, flagged as a deferred decision rather than assumed:** the platform generates and manages a signing identity per project on the customer's behalf for 3A/3B, since there's no Play Store publishing (3C) yet to make "whose developer account is this signed for" an urgent question. Whether the long-term product has the platform continue managing signing keys on the customer's behalf, or transitions each project to the customer's own Play Console signing identity once 3C exists, is a real product/business decision — deliberately not resolved here, consistent with 3C being out of scope for the current definition of done (§3).
- Signing operations happen inside the same sandboxed build environment as compilation (§7), never as a separate step that would require passing a compiled artifact back out to be signed elsewhere and re-ingested.

## 7. Build Worker Infrastructure and Sandboxing

- Environment: Android SDK, Gradle, JDK, running in a containerized/ephemeral environment per build — not a long-lived shared filesystem or shared Gradle daemon across different projects' builds. The worker also needs read access to fetch the specific Runtime Template release identified by the Build Manifest's `runtimeVersion` (Decision 020) — wherever that release is published (an internal package registry, a tagged repository, or Supabase Storage are all reasonable options; not decided here) — before the Generator can parameterize it.
- **Sandboxing extends the same untrusted-content posture already established for Discovery** (`SYSTEM_ARCHITECTURE.md` §10): a generated project's build process should not be able to read another project's source, secrets, or artifacts, even though the generator itself is trusted code (unlike arbitrary crawled website content). The isolation here is about blast-radius containment (a bug in one build shouldn't corrupt or leak into another), not about distrust of the generator's own logic.
- Resource limits: a build-level timeout (concrete default TBD once 3A is actually being tested against real generated projects — flagged as an operational tuning parameter the same way Phase 1 crawl limits were, `SYSTEM_ARCHITECTURE.md` §8, rather than guessed at here), plus memory/CPU limits per build container to prevent one runaway build from starving others.

## 8. Queueing, Concurrency, and Cancellation

Builds use the same `Job` model already defined for discovery (`SYSTEM_ARCHITECTURE.md` §5), `type: "build"`, referencing the `BuildManifest` as `result_ref`.

- **Queueing:** FIFO per Build Worker pool by default. A priority scheme (e.g. paid tiers building faster) is a plausible future need but not required for the current definition of done — noted so it isn't silently designed in or designed out.
- **Concurrency:** multiple Build Worker instances process the queue in parallel, each build fully isolated in its own container (§7). Concurrency limits per user/project exist to prevent one account from monopolizing worker capacity — exact limits are an operational tuning parameter, not an architectural one.
- **Cancellation:** user-initiated from the Builder App → Backend API marks the job `cancelling` → the Build Worker checks for cancellation at safe checkpoints (or is terminated directly if mid-compile) → job and `BuildManifest.status` both resolve to `cancelled`. Any partial artifact is discarded, never stored — a cancelled build never produces a downloadable result, avoiding ambiguity about whether a stored artifact reflects a completed or interrupted build.

## 9. Artifact Storage and Retention

- Build artifacts (APK/AAB) are stored the same way managed Assets are (`SYSTEM_ARCHITECTURE.md` §7) — Supabase Storage for the file, Postgres metadata (size, checksum, `buildManifestId`, content type) referencing it by ID. Never a raw public URL handed back to the client; access goes through the Backend API, which can issue a time-limited signed download URL.
- **Retention default:** every successful build's artifact is retained, referenced by its `BuildManifest`, consistent with Decision 014's persistent-version-history philosophy — a user should be able to look back at a prior successful build, not just the most recent one. Storage-cost management (e.g. eventually pruning artifacts for very old, superseded Blueprint versions) is a real future concern, deliberately not solved now — the same posture already taken toward large-website crawl scoping (`SYSTEM_ARCHITECTURE.md` §8): don't design the pruning policy before there's real usage data to design it against.

## 10. Reproducibility and Rebuilds

This is Decision 017 made operational. Rebuilding an existing `blueprintVersion` **reuses its originally recorded `BuildManifest` versions by default** — same generator, same runtime, same template — producing a functionally identical artifact rather than silently picking up whatever the platform's current generator happens to be. A user explicitly choosing to rebuild against the *current* generator/runtime/template is a distinct, deliberate action that creates a **new** `BuildManifest` with current versions, not something that happens automatically just because time has passed. This is the concrete mechanism that prevents the failure mode Decision 017 exists to avoid: *"I rebuilt my app and suddenly the navigation changed."*

## 11. Failure Handling

Extends the error table in `SYSTEM_ARCHITECTURE.md` §9 with build-specific failure categories, since "build failed" isn't one thing:

| Failure category | What it means | Retry behavior | User-facing result |
|---|---|---|---|
| Generator compatibility rejection (§4) | Blueprint isn't buildable by any available generator/runtime/template combination | Not applicable — never dispatched | Immediate, synchronous "this can't be built yet" — not a job that ran and failed |
| Infrastructure failure | Worker crashed, container failed to start, transient network issue talking to Supabase | Automatic, one retry | Job stays `queued`/`running` from the user's view; only surfaces as an error if the retry also fails |
| Generator/compile failure | The generator produced invalid Kotlin, or Gradle compilation failed against otherwise-valid generator output | No automatic retry — retrying a deterministic failure just fails the same way | Human-readable build log summary (`SYSTEM_ARCHITECTURE.md` §9), logged for engineering review since this indicates a generator bug, not a user error |
| Signing failure (3B+) | Signing key resolution or the signing step itself failed | No automatic retry | Distinct, more urgent alert path — this is an operational/credentials issue, not a routine build failure, and should be treated with the same seriousness as any other secrets-handling incident |

A build's failure category is recorded on the `Job` and `BuildManifest` records regardless of which one the user sees, since generator/compile failures in particular are the signal that tells engineering when a generator version needs fixing.

## 12. What This Document Deliberately Leaves Open

Consistent with the pattern already established for Phase 1 crawl limits and build timeouts: concrete numeric defaults (build timeout seconds, concurrency limits, artifact retention window) are operational tuning parameters, decided once there's real build volume to tune against — not guessed at here to make the document look more finished than the underlying uncertainty actually is. What's locked is the *shape* of the system (manifest-first, sandboxed, reproducible, staged); what's open is calibration.
