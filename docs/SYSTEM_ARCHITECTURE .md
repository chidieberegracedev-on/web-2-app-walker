# System Architecture

**Status: v1.0 — locked.** Governed by `/decisions/TECHNICAL_DECISIONS.md`. This document answers: how should this actually be engineered?

## 1. Component Map

**Four runtime components** — Builder App, Backend API, Discovery Worker, Build Worker — with Supabase providing the managed persistence, auth, and realtime layer that all of them read and write through. Supabase is not counted as a fifth deployable component; it's the shared managed layer underneath the four.

```
┌───────────────────────────────────────────────────────────────┐
│  BUILDER APP  (Android · Kotlin · Jetpack Compose · Play Store)│
│  Screens 1-19, project management, interactive preview render  │
└───────────────────┬───────────────────────────────────────────┘
                     │ HTTPS / REST + realtime subscriptions
                     ▼
┌───────────────────────────────────────────────────────────────┐
│  BACKEND API  (Vercel — auth, validation, short-lived work)    │
│  Auth · Validation · AI Analysis Module · Blueprint Operations │
│  · Job Orchestration · Build Manifest generation                │
└──────────────┬────────────────────────────┬────────────────────┘
               │                             │
               ▼                             ▼
     ┌──────────────────┐          ┌──────────────────┐
     │ DISCOVERY WORKER  │          │   BUILD WORKER    │
     │ (Railway,         │          │  (Railway/CI,      │
     │  Node/Playwright)  │          │   stages 3A/3B/3C)  │
     └─────────┬─────────┘          └─────────┬──────────┘
               │ authenticated callback         │ authenticated callback
               ▼                                 ▼
     ┌─────────────────────────────────────────────────────┐
     │                       SUPABASE                        │
     │  Users · Projects · Blueprints · Jobs · Assets ·       │
     │  AIRecommendations · Realtime                          │
     └─────────────────────────────────────────────────────┘
```

The Builder App never talks to Discovery or Build directly — everything routes through the Backend API, which owns auth, request validation, and job orchestration. This keeps API keys, signing credentials, and worker internals off the client entirely (Decision 004, Decision 010, Decision 018).

**AI Analysis is a module inside the Backend API, not a fifth deployed service.** It calls a model provider with structured output and returns within the timeframe a normal Vercel request allows — there's no workload reason to extract it into its own service yet, and doing so now would just be an extra network hop with no functional benefit (Decision 018). Discovery and Build remain genuinely independent long-running workers because their workloads — headless browser rendering, Gradle compilation — legitimately exceed what a request/response function can do.

## 2. Component Responsibilities

**Builder App (Android)**
Owns: all 19 builder screens, local UI state, rendering the interactive preview using the shared shell/runtime renderer module (Decision 005), triggering discovery/build jobs, displaying job progress, project list/management.
Does not own: crawling, AI inference, Blueprint validation logic (it can display validation errors but the source of truth for "is this Blueprint valid" is server-side), signing, compilation.

**Backend API (Vercel)**
Owns: authentication, request routing, Blueprint CRUD against Supabase, job creation/status, rate limiting, the **AI Analysis Module** (turns a `DiscoveryResult` into `AIRecommendation` artifacts, §3), validation of both AI output and user edits before they're allowed to touch a stored Blueprint, and **Build Manifest** generation (§6) before dispatching to the Build Worker.
Does not own: long-running work. Vercel functions have execution-time limits — this layer creates jobs and returns quickly; it does not itself run headless browsers or compile Android projects.

**Discovery Worker (Railway, Node/Playwright)**
Owns: rendering a target URL, DOM inspection, link/nav/asset/metadata extraction, producing a structured `DiscoveryResult`, and delivering it back via an **authenticated service-to-service callback** (§9) — never a bare public webhook. Runs as a persistent worker process, pulling jobs from a queue (§5).
Does not own: interpretation. It reports what it found, not what it means.

**Build Worker (Railway/CI, stages 3A/3B/3C)**
Owns: consuming a Build Manifest (§6, not the raw Blueprint) to generate an Android project, compile it, and — from stage 3B onward — sign it. Isolated environment with Android SDK/Gradle; signing keys live only here, never in the Backend API layer or the client. Reports back via the same authenticated-callback pattern as Discovery.

**Supabase**
Owns: Users/auth, Projects, Blueprint versions, Jobs, **Assets** (managed logo/icon/splash files in Storage, with metadata in Postgres — §7), **AIRecommendations** (§3), and realtime channels the Builder App subscribes to for job-status *signals* (§5 — signals, not authoritative state).

## 3. Data Flow — The Guided Configuration Pipeline

This is the mechanism behind the product's core differentiator: paste a URL, get a coherent recommendation, confirm or adjust it — never a blank dashboard. Naming it explicitly here because it's the thing every other section in this document exists to support.

```
 1. User submits URL in Builder App
 2. Builder App → Backend API: create discovery job
 3. Backend API → Supabase: job row (status: queued)
 4. Backend API → Discovery Worker: enqueue job
 5. Discovery Worker renders site, extracts DiscoveryResult
 6. Discovery Worker → Backend API: authenticated callback delivering DiscoveryResult
 7. Backend API validates job ownership/state, → Supabase: store DiscoveryResult, update job status
 8. Backend API's AI Analysis Module: DiscoveryResult in → AIRecommendation artifacts out
    (structured, schema-validated, confidence-scored — never freeform text)
 9. Backend API validates each AIRecommendation; auto-accepted or user-accepted ones
    are merged into a draft Blueprint (rejected/modified ones remain visible as
    AIRecommendation records, not silently discarded)
10. Backend API → Supabase: store draft Blueprint (blueprintVersion 1), store
    AIRecommendation records
11. Supabase realtime → Builder App: "job state changed" signal
12. Builder App fetches the authoritative job/Blueprint state from Backend API
    (never treats the realtime payload itself as final truth — see §5) and
    renders Screens 3-13
```

Every arrow between 5-10 is a validation boundary — a worker or the AI module can return malformed or low-confidence data and the pipeline must degrade gracefully (deterministic fallback per Decision 004), not propagate garbage into a stored Blueprint.

**The `AIRecommendation` artifact** (full schema in `/ai/AI_AGENT_SPEC.md`, not yet written) is what makes Decision 016 concrete:

```
AIRecommendation {
  recommendationId, projectId, discoveryResultId
  type            — e.g. "navigationItem", "themePreset", "nativeScreen"
  target          — what this recommendation is about (a page id, a Blueprint field)
  recommendation  — the suggested value, schema-validated against that field's type
  confidence      — 0-1
  reason          — human-readable, surfaced to the user (product handoff §5)
  source          — "ai" | "deterministicFallback"
  status          — "pending" | "accepted" | "rejected" | "modified"
}
```

AI never writes to the Blueprint directly (Decision 016). It writes `AIRecommendation` rows. The Backend API is the only writer of Blueprint content, whether the source of a change was an accepted recommendation or a direct user edit.

## 4. What Must Not Be Coupled

Per the revised Decision 003: the Blueprint is the central *application-state* contract, but subsystems are allowed to exchange purpose-specific intermediate artifacts — `DiscoveryResult`, `AIRecommendation`, the Build Manifest — without that being a violation of "everything goes through the Blueprint." What's actually forbidden is a subsystem reading another subsystem's *private implementation state*, or writing to the Blueprint outside the Backend API's validation layer.

- **Discovery ≠ AI.** Discovery never calls the AI Analysis Module directly; it only ever produces a `DiscoveryResult` and hands it to the Backend API. This is what keeps the AI layer swappable/upgradable later without touching the crawler.
- **AI ≠ Blueprint writes.** AI produces `AIRecommendation` artifacts (§3); it never writes Blueprint fields directly (Decision 016). Without this as an enforced mechanism, "AI must not control X" (Decision 004) is just a sentence.
- **Blueprint ≠ Android implementation.** Nothing in the Blueprint schema references Android APIs, view types, or Gradle concepts (Decision 003, Decision 006). This keeps the door open for an iOS generator later without a Blueprint migration.
- **Preview ≠ a second implementation.** The Builder App's preview renderer and the generated app's runtime renderer are the same module, imported into both contexts, not two things that stay in sync by convention (Decision 005).
- **Build ≠ Backend API, and Build ≠ raw Blueprint.** The Build Worker never receives the Blueprint directly — the Backend API first resolves it into a Build Manifest (§6). The Backend API creates that manifest and dispatches the build but does not itself run Gradle or hold signing keys (Decision 010).

## 5. Asynchronous Job Model

Discovery, AI analysis, and builds are all long-running relative to a mobile request/response cycle. All are modeled the same way:

```
Job {
  id, type (discovery | ai_analysis | build),
  project_id, status (queued | running | succeeded | failed),
  progress_step (human-readable, matches Screen 2 / Screen 14 copy),
  result_ref (nullable),
  error (nullable, human-readable — never a raw stack trace)
}
```

**The job row in Supabase is the source of truth, not the realtime event.** The Builder App subscribes to realtime as a *signal* — "something about this job changed, go check" — and always re-fetches the authoritative job/Blueprint state from the Backend API before acting on it. It never interprets a realtime payload itself as confirmation that a job succeeded or failed. This is deliberate: realtime delivery can be delayed, deduplicated, or missed on reconnect, and treating it as authoritative would make those ordinary network conditions into correctness bugs. Polling the Backend API as a fallback if no realtime event arrives within an expected window is a reasonable Phase 1 safety net.

## 6. Build Manifest and Generator Versioning

Per Decision 017. The Build Worker does not receive the Blueprint directly — the Backend API resolves it into a **Build Manifest** immediately before dispatch:

```
BuildManifest {
  id, projectId
  blueprintVersion       — which Blueprint content this build is for
  generatorVersion       — which version of the Android generator produced this build
  runtimeVersion         — which version of the shared shell/runtime renderer is embedded
  templateVersion        — which version of the design-token template engine was applied
  buildStage             — "3A" | "3B" | "3C" (Decision 010)
  requestedArtifactType  — "debugApk" | "signedAab" | "signedApk"
  assetRefs[]            — resolved managed Asset IDs (§7) needed for this build
}
```

Why this is a separate artifact from `buildConfiguration` inside the Blueprint (`APP_BLUEPRINT.md` §13): the Blueprint describes *what the app should be* — product-level, user-facing, platform-neutral. The manifest records *which generator/runtime/template actually built it* — a build-time fact, not a product decision, and one that should never be embedded in the platform-neutral contract an iOS generator will eventually also read. Keeping them separate is what makes rebuilds reproducible: if `runtimeVersion` moves from 2.1 to 3.0, existing projects don't silently pick up the new runtime just because someone rebuilds them — a rebuild without an explicit version bump reuses the recorded manifest versions.

**Phase 1 never invokes the Build Worker at all**, not even stage 3A — Phase 1's scope stops at Blueprint + basic preview (product handoff §30, Decision 011). This is worth stating explicitly here because it's the thing that keeps a struggling generator from being able to contaminate the discovery/Blueprint foundation underneath it.

## 7. Persistence Model

- **Projects** (Decision 014): a user can have multiple. A Project has one active Blueprint plus version history.
- **Blueprint versions**: every accepted change (AI-recommended or user-edited) creates a new version, not an in-place mutation. This is what makes "definition of done" checks and rollback possible, and is required groundwork for Decision 011's editor.
- **DiscoveryResult**: stored once per analysis run, referenced by the Blueprint version(s) derived from it, so re-analysis is explicit rather than implicit.
- **AIRecommendation** records (§3): retained regardless of accept/reject/modify status — this is what lets a user later see "why did it suggest this" even after they changed it, and gives us an audit trail if a recommendation type turns out to be unreliable.
- **Assets**: managed logo/icon/splash files. Discovery-found candidates (favicon, manifest icons, Apple touch icon, Open Graph imagery) are fetched once and stored in Supabase Storage rather than hot-linked from the source website, with metadata (source type, rank, dimensions) in Postgres. The Blueprint references Assets by ID (`APP_BLUEPRINT.md` §4), never by raw external URL — hot-linking to the customer's own site would silently break if that asset moved, was deleted, or blocked hot-linking, which would otherwise surface as a mysteriously broken generated-app icon with no clear cause.
- **Anonymous discovery, then ownership transfer** (extends Decision 015): discovery (Screens 1-3) is a real, resource-consuming job, so its result is preserved as a temporary, anonymously-owned Project rather than held only in the Builder App's memory — losing five minutes of analysis the moment a user is asked to sign in would be a bad experience the product handoff explicitly wants to avoid (§38). The flow:

```
Anonymous session (device-scoped)
      ↓
Temporary Project created, DiscoveryResult + draft Blueprint attached
      ↓
User signs in (required to persist past this point, per Decision 015)
      ↓
Ownership of the temporary Project transfers to the authenticated account
      ↓
Persistent Project — no redo of discovery required
```

## 8. Phase 1 Default Limits

These are **Phase 1 product defaults for the current crawling approach**, not an architectural ceiling — large-site handling (user-selected scope, prioritized routes) is real future work the product handoff (§21) explicitly defers, and these numbers should be expected to change once real sites are tested against them:

- Default max pages per discovery run: **40**
- Default crawl depth: **3** from the entry URL
- Timeout per page render: **15 seconds**, page skipped and logged (not job-failing) if exceeded
- Total job timeout: **5 minutes**, after which the job completes with whatever was discovered plus a "some pages may be missing" notice, rather than failing outright

These exist to bound AI-service cost and headless-browser compute predictably for V1. Don't solve prioritized/scoped crawling now — that's a real, separate problem once these defaults prove too blunt for a specific site category (ecommerce catalogs vs. blogs vs. SPAs will likely need different defaults eventually).

## 9. Error Boundaries

Each component fails independently and reports a typed, human-readable error up the chain:

| Failure | Where caught | User-facing result |
|---|---|---|
| Site unreachable/timeout | Discovery Worker | "We couldn't reach this website. Check the URL and try again." |
| No usable icon found | AI Analysis Module | "We couldn't find a clear brand icon. You can upload one instead." |
| AI output fails schema validation | Backend API | Falls back to deterministic recommendation; user never sees a raw AI error |
| Blueprint fails validation on user edit | Backend API | Inline field-level error in the editor (Phase 2) |
| Build compile failure | Build Worker | Human-readable build log summary, not a raw Gradle stack trace |

## 10. Security Boundaries

- **Worker-to-Backend callbacks are mandatory authenticated service-to-service calls, never bare public webhooks.** Both the Discovery Worker and the Build Worker deliver results this way; the Backend API additionally re-validates job ownership and expected state before accepting a payload. Without this, anyone who discovered the callback endpoint could submit a fake `DiscoveryResult` or a fake build artifact.
- **Website content is executed only inside the isolated Discovery Worker sandbox, for the sole purpose of rendering the target site.** Playwright running the site's own JavaScript to produce an accurate DOM is expected and necessary — that is not a contradiction of the next point.
- **Once past the Discovery Worker, website content is treated as untrusted data everywhere downstream** — sanitized before storage, never executed, never used to construct dynamic queries or file paths without validation. The AI Analysis Module, Backend API, and Build Worker never execute anything derived from a crawled site as code.
- API keys for the AI provider live only in the Backend API's environment, never shipped to the Android client.
- Signing keys live only in the Build Worker's environment (Decision 010) — the Backend API can request a build via the Build Manifest (§6) but cannot itself sign one.
- Row-level security in Supabase scopes every Project/Blueprint read and write to its owning user (or, pre-signup, its anonymous session — §7).

## 11. Open Items for Later Documents

- Exact `DiscoveryResult` and `AppBlueprint` schemas → `/architecture/APP_BLUEPRINT.md` (Blueprint done; `DiscoveryResult` still to formalize in `/ai/DETECTION_PIPELINE.md`)
- Full `AIRecommendation` schema, confidence thresholds, and fallback rules per recommendation type → `/ai/AI_AGENT_SPEC.md`
- WebView cookie/storage/lifecycle handling and the OAuth Custom Tabs mechanism → `/architecture/STATE_ARCHITECTURE.md`
- Routing model (app routes vs. website routes vs. deep links) → `/architecture/ROUTING_ARCHITECTURE.md`
- Build Manifest generation logic, generator/runtime compatibility checks, and the 3A/3B/3C pipeline in full → likely warrants its own `/architecture/BUILD_ARCHITECTURE.md` once Phase 3 documentation begins, rather than continuing to grow inside this file
