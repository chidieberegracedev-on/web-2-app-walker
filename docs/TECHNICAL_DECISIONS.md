# Technical Decision Record

Each entry is a locked decision, not a suggestion. Every other document in this repository must remain consistent with these. If a later document appears to require deviating from one of these, that's a signal to come back here and add a new numbered decision (superseding, not silently overriding) — never to quietly drift.

---

### Decision 001 — Builder platform
**Native Android application (Kotlin/Jetpack Compose), Play Store-distributed.**
The builder is the primary user-facing product, not a companion to a web dashboard. Web is an optional future supporting surface, not the primary builder experience. This governs the entire UI implementation approach in `/ui/` and `/phases/`.

### Decision 002 — Website discovery execution
**Fully server-side**, via a dedicated Node/Playwright-class Discovery Worker capable of rendering JavaScript-heavy sites. The Android app never crawls on-device; it calls this worker through the Backend API. Rationale: on-device crawling can't render modern JS-heavy sites reliably, can't be resourced predictably, and would leak the discovery logic into an environment (Android) unsuited to headless browser automation.

### Decision 003 — App Blueprint as the central contract
**Versioned, platform-neutral JSON schema**, and the central **application-state** contract between discovery, AI, editor, preview, runtime, and generators. Subsystems may exchange purpose-specific intermediate artifacts — `DiscoveryResult`, `AIRecommendation`, the Build Manifest — without that being a violation of this decision; what's actually forbidden is a subsystem reading another subsystem's *private implementation state*, or writing to the Blueprint outside the Backend API's validation layer (Decision 016, Decision 018). This is why `DiscoveryResult` flows to the AI Analysis Module without first becoming Blueprint data — it's an intermediate artifact, not a bypass. Full schema in `/architecture/APP_BLUEPRINT.md`; intermediate artifact shapes in `/architecture/SYSTEM_ARCHITECTURE.md` and `/ai/AI_AGENT_SPEC.md`.

### Decision 004 — AI output discipline
**Structured-output only.** AI responses must conform to a defined schema (not freeform text parsed after the fact). Every AI-influenced field carries a confidence value. Engineering validation happens before any AI output is allowed to affect the Blueprint. Low-confidence classifications fall back to deterministic rules rather than an AI guess. The concrete mechanism for this is the `AIRecommendation` artifact (Decision 016). Full detail in `/ai/AI_AGENT_SPEC.md`.

### Decision 005 — Preview/production parity
**The preview must share the same application shell/runtime renderer as the generated Android application wherever practical.** No separate "preview-only" rendering implementation. This is enforced as a shared module, not a convention — see `/architecture/SYSTEM_ARCHITECTURE.md`.

### Decision 006 — Kotlin Multiplatform scope
**Not implemented in V1**, for either the builder or generated apps. Platform neutrality comes from the Blueprint schema (Decision 003), not from shared UI code. Android generation is the first and only generator target until the Blueprint and Android generator are proven; iOS becomes a later generator consuming the same Blueprint.

### Decision 007 — Authentication / embedded WebView limitations
**OAuth and other embedded-auth limitations are designed into the runtime explicitly, not discovered as a bug later.** Third-party OAuth flows (Google, Facebook, etc.) are opened via system/browser authentication surfaces (e.g. Chrome Custom Tabs), never inside the app's own WebView — major identity providers block sign-in inside embedded WebViews as policy, not as an edge case. Full behavior in `/architecture/STATE_ARCHITECTURE.md`.

### Decision 008 — Persistent state as a first-class subsystem
Cookies, local storage, session storage, IndexedDB, authentication state, navigation state, cache, and WebView/app lifecycle are treated as one explicit runtime subsystem, not left to WebView defaults. The generated app must behave like one continuous session across navigation, backgrounding, and process recreation. Full detail in `/architecture/STATE_ARCHITECTURE.md`.

### Decision 009 — Generated application model
**Real per-project Android applications are the long-term product goal** — not a single shared multi-tenant shell app. Shared runtime components and templates are used internally to reduce generation complexity and risk, but the deliverable to the end customer is their own distinct application. This decision directly shapes Decision 010's staged build pipeline.

### Decision 010 — Build pipeline staging
Because of Decision 009, the build pipeline is real infrastructure, staged deliberately rather than attempted whole:
- **3A:** Blueprint → Build Manifest → generated Android project → debug/unsigned APK. Proves the generator works.
- **3B:** Release signing → AAB/APK → artifact management. Proves it's distributable.
- **3C:** Play Store publishing automation. A separate future milestone — Play Console API integration and per-developer-account handling is its own significant scope and is explicitly not part of Phase 3's definition of done.

See Decision 017 for the build-reproducibility requirements (generator/runtime/template version tracking) that apply across all three stages.

### Decision 011 — Visual editor phasing
**Phase 2 only.** Phase 1 delivers discovery, the Blueprint, and a basic non-editable runtime preview. The structure editor, contextual design editor, and drag/reorder UI are not attempted until the Blueprint and basic preview are proven — this is real, nontrivial Compose UI work and shouldn't be built on an unstable foundation.

### Decision 012 — Template system model
**Configuration-driven, not AI-generated UI.** Templates are structured design-token configurations (navigation type, icon style, card/border/corner treatment, spacing, typography scale, color scheme, screen patterns). AI fills validated properties within this schema; it never generates arbitrary CSS/layout. Full detail in `/ui/DESIGN_SYSTEM.md`.

### Decision 013 — Status bar / system UI
**First-class Application Shell feature**, not an afterthought of the WebView. Covers theme-matched/primary-color/surface/custom status bar, automatic contrast validation, light/dark icon selection, correct edge-to-edge and safe-area handling, and live preview inside the device frame before build.

### Decision 014 — Projects as persistent entities
The builder supports persistent **Projects**, not disposable one-off URL conversions. Blueprint versions are stored remotely (Supabase) and are the durable record of a project's state over time — not just the currently-open editor session.

### Decision 015 — Builder authentication timing
Users can experience initial discovery (Screens 1–3) before creating an account. Discovery is expensive — it triggers a real crawl job — so its result is preserved as a temporary, anonymously-owned Project rather than held only in the Builder App's memory. Authentication becomes necessary at the point of saving or persisting that project past the current session (Decision 014); at that point, **ownership of the temporary Project transfers to the newly authenticated account** rather than requiring the user to redo discovery. Final placement of the auth prompt is subject to product/security review once Phase 1 is being built — this decision sets the default flow, not a hard constraint.

### Decision 016 — AI Recommendation Boundary
**AI never writes directly to the Blueprint.** AI produces a versioned, schema-validated `AIRecommendation` artifact carrying its source, confidence, target, and suggested change (full shape in `/ai/AI_AGENT_SPEC.md`). The Backend API validates each recommendation and only applies *accepted* ones — via explicit user acceptance or an engineering-approved auto-accept threshold — to create a new Blueprint version. This makes Decision 004's "AI must not control X" an enforced mechanism rather than a stated intention, and gives the accept/reject/modify UX (product handoff Screens 6, 8, 10) a concrete artifact to operate on.

### Decision 017 — Build Reproducibility
Every generated build records the `blueprintVersion`, `generatorVersion`, `runtimeVersion`, and `templateVersion` used to produce it, as part of a **Build Manifest** created by the Backend API immediately before a build is dispatched to the Build Worker (Decision 010). These version fields live in build metadata, not in the platform-neutral Blueprint itself — the Blueprint describes what the app should be; the manifest records which generator built it. Rebuilding an existing Blueprint version must be reproducible against its recorded generator/runtime versions, so updating the generator for new projects never silently changes an existing customer's already-built app.

### Decision 018 — Service Boundary Discipline
V1 uses a modular backend rather than unnecessary microservices. Discovery and Build remain independently deployable long-running workers (Railway) because their workloads genuinely exceed Vercel's execution limits. AI Analysis remains a module inside the Backend API until workload or scaling requirements justify extracting it into its own service — there is no architectural benefit to a separate AI service today, and adding one now would just be another network hop and another deployment to keep in sync for no functional gain.

### Decision 019 — Implementation Ownership Boundary
**Anything that runs on Vercel or Railway is not AI Studio's job.** AI Studio (Kotlin/Compose, Android-native tooling) builds the Builder App (Decision 001) and, by the same reasoning, any Kotlin/Compose source that ships as part of a *generated* Android application. The Backend API, Discovery Worker, Build Worker, generator/build-orchestration logic, and all Supabase/infrastructure configuration are implemented through standard backend/DevOps tooling, entirely outside AI Studio's scope. This boundary is what eventually separates an AI Studio-facing implementation guide from a backend implementation guide — full detail in `/architecture/BUILD_ARCHITECTURE.md` §2.

### Decision 020 — Runtime/Shell Template Ownership Model
**The Runtime/Shell Template is a maintained, versioned Android/Kotlin/Jetpack Compose codebase** — the canonical application shell and runtime: navigation, WebView runtime, state/session handling, native screen templates, theme rendering, status bar/system UI, deep links, and lifecycle behavior (full behavioral spec in `/architecture/STATE_ARCHITECTURE.md` and `/architecture/ROUTING_ARCHITECTURE.md`). AI Studio is the primary development environment for building and iterating on this reference implementation during initial product development, consistent with Decision 019.

AI Studio is **not** part of the production build pipeline and does not generate the runtime from scratch per customer. The Build Worker consumes a **versioned release** of the Runtime Template and parameterizes it, together with the customer's Blueprint, Assets, and build configuration, into that customer's actual Android project:

```
Reference Runtime Template + Blueprint + Assets + Generator → Customer Android Project → Gradle → APK/AAB
```

`runtimeVersion` in the Build Manifest (Decision 017) identifies which released version of this template was used, which is what makes a rebuild reproducible even as the reference implementation keeps evolving in AI Studio. This resolves the boundary question originally raised in `BUILD_ARCHITECTURE.md` §2: AI Studio's production-relevant scope is the Builder App plus this reference Runtime Template; everything from "produce a customer's parameterized copy" onward is backend/generator work (Decision 019).

### Decision 021 — Runtime Template Is Generic, Data-Driven, and Self-Contained
The Runtime Template (Decision 020) is **one generic Kotlin/Compose codebase** — reusable rendering and runtime capabilities only (navigation, WebView runtime, native screen templates, theme rendering, state/session handling, routing), with **no customer-specific logic**. Customer-specific behavior is supplied entirely through (a) a bundled, runtime-relevant subset of the Blueprint, and (b) managed assets. The Generator's job is to parameterize/package a released Runtime Template version per customer — producing a unique `applicationId`, app name/icon resources, and a bundled config export — never to generate or hand-modify Kotlin navigation/theme/routing logic per customer. Full mechanics in `/architecture/BUILD_ARCHITECTURE.md`.

The essential configuration and required assets are bundled into each generated application at build time. **The generated app must not require the platform's backend merely to start or render its core experience** — it is a self-contained Android app once built, whose only genuine runtime network dependency is the customer's own website (loaded via WebView — the entire point of the product). Optional remote configuration (updating a project's behavior without a full rebuild) may be considered later but is explicitly out of scope for V1 — building that dependency in now would undermine the reliability property this decision exists to guarantee.

---

## Infrastructure mapping (how the stack maps to Decisions 001–020)

| Decision | Component | Where it runs |
|---|---|---|
| 020 | Runtime/Shell Template (reference implementation) | Developed and versioned in **AI Studio**; released versions consumed (not developed) by the Build Worker at build time |
| 001 | Builder UI | Native Android app (AI Studio/Kotlin/Compose), Play Store |
| 002 | Discovery Worker | Node/Playwright process — **Railway** (persistent process; not Vercel serverless, which has execution-time limits unsuited to headless browser rendering) |
| 003, 014 | Blueprint storage, Projects | **Supabase** (Postgres + auth + realtime) |
| 003, 016 | AIRecommendation records | **Supabase** (Postgres), written only by the Backend API |
| 004, 018 | AI Analysis Module | **Vercel** — a module inside the Backend API, not a separately deployed service; calls a model provider with structured output, short-lived enough to fit Vercel's execution limits |
| 010, 017 | Build Worker + Build Manifest | Build Worker: dedicated build environment (candidate: **Railway** or a container-based CI runner) with Android SDK/Gradle, signing keys never exposed to the client. Build Manifest: generated by the Backend API on **Vercel**, stored in **Supabase** alongside the build job record — not embedded in the Blueprint |
| 007, 015 | Assets (icons, logos, splash) | **Supabase Storage** for files, Postgres for metadata; Blueprint references by managed asset ID, never a raw external URL |
| — | Lightweight API routes / edge functions | **Vercel** |

This mapping exists to prevent an easy mistake: putting the Discovery Worker or the Build Worker on Vercel serverless functions, where they will hit execution-time limits. Both need a persistent-process host.
