# Walker — Project Handoff

Walker is the **Discovery Worker**: the Railway-hosted service that does the heavy, long-running processing for the website-to-app builder. This document is Walker's own source of truth. The 19 original project documents in `docs/` give the full product and architecture context; this document tells a fresh session what Walker specifically is, what it owns, and what it must never do.

**Read order for a new session:** this document → `WALKER_BEAGLE_INTEGRATION_CONTRACT.md` (the frozen API contract) → `WALKER_IMPLEMENTATION_PLAN.md` → `WALKER_CLAUDE_CODE_RULES.md`. The 19 originals are reference; these four are operational.

## 1. What Walker Is

The system has three tracks (see the architecture docs for the full picture):

- **Android Builder App** — the user-facing client (Kotlin/Compose, built in AI Studio). Not Walker's concern.
- **Beagle** — the backend/system-of-record (Next.js/TypeScript on Vercel). **Already built and deployed.** Owns auth, the database, jobs, the recommendation contract, Blueprint construction and persistence.
- **Walker** — *this repo.* The Discovery Worker on Railway. Not yet built. Does the crawling, AI analysis, and asset fetching that must not run inside a Vercel request.

Walker is a **thick worker**: it owns end-to-end processing and reports one completed result. It is the reason heavy work was moved off Beagle's request path — long-running crawls, model calls, retries, and asset fetching belong here, not in a serverless function.

## 2. What Walker Owns

- **Crawl and render** a customer website (JavaScript-heavy sites included — this needs a real headless browser, e.g. Playwright), within the limits Beagle hands back on job claim (40 pages / depth 3 / 15s per page / 5min total — the defaults, delivered per-job so Walker never hardcodes them).
- **Extract** structured data — links, nav, forms, assets, metadata, visual characteristics — per `DETECTION_PIPELINE.md` in the originals.
- **Internal page classification** — determine each page's type. This is *internal machinery*, not a user-facing recommendation (see §4 boundary below).
- **AI analysis** — the OpenAI calls, prompt construction, retry, and deterministic fallback. This logic was prototyped inside Beagle and is being relocated here; Beagle's `lib/ai/` files are the reference implementation, annotated with what moves. Walker owns this path now; Beagle makes no model call.
- **Asset fetching** — fetch candidate icon/logo bytes from the customer site, enforcing the safety ruleset in the contract (§5). This is where the SSRF surface lives, and it lives *only* here — Beagle never fetches a remote URL.
- **Generate recommendations** conforming to the frozen five-type contract, and submit the completed result to Beagle.

## 3. What Beagle Owns (and Walker must not touch)

Auth, RLS, project ownership, job lifecycle/state transitions, contract validation of everything Walker submits, recommendation lifecycle (accept/reject/modify/supersession), **Blueprint construction and persistence**, and asset *storage* (Walker sends bytes; Beagle stores them and issues the managed ID).

Beagle is the only writer of Blueprint content (Decision 016). Walker produces recommendations *against* the contract; it never constructs or submits a Blueprint, and never writes to the database or Storage directly.

## 4. The Boundaries That Matter Most

These are the ones a fresh session is most likely to cross by accident:

- **Walker never connects to Postgres or Supabase Storage directly.** Every write goes through Beagle's authenticated HTTP endpoints. Walker receives Beagle's base URL and `DISCOVERY_WORKER_SECRET` — and *no Supabase credential ever*. If a task seems to need one, that's the signal something is being done on the wrong side of the boundary.
- **Page classification is internal.** It populates the Blueprint's `pages[].detectedType`/`detectionConfidence` via the result submission — it never becomes an `ai_recommendations` row and is never part of the accept/reject/modify contract. The five user-facing recommendation types are `navigationItem`, `homepageSelection`, `themePreset`, `nativeScreen`, `assetSelection` — closed set, frozen.
- **Walker never builds a Blueprint.** It submits discovery data, classifications, recommendations, and asset refs; Beagle constructs the Blueprint.
- **The SSRF surface is Walker's, and the rules are fixed by the contract.** Walker implements the asset-fetch safety ruleset (§5 of the contract) exactly as written — it does not get to relax it.

## 5. Current State (snapshot at handoff)

- **Walker:** not implemented. This repo is greenfield. This handoff pack + the 19 originals are everything.
- **Beagle:** built, deployed, production at `https://web-2-app-backend-api.vercel.app`. The worker-facing boundary is complete and its auth path is production-verified (12/12 live smoke test — see contract §10).
- **Database:** live Supabase project, four migrations applied, `project-assets` Storage bucket created (private, 2 MB, image-MIME allowlist).
- **Beagle config Walker depends on:** `DISCOVERY_WORKER_SECRET` is set in Beagle's Vercel production environment. Walker must be given the *same* secret value plus the base URL. All worker endpoints fail closed until the secret is present on both sides.
- **What has NOT been round-tripped in production yet:** a full `/result` submission with real ingested assets. The auth/claim path is verified; the completed-result path is contract-tested and schema-verified but its first real production round-trip is appropriately Walker's own first integration milestone.

## 6. Execution Model

Walker is a job processor, not a request/response service. Conceptually: Beagle creates a `discovery` job → Walker claims it → Walker does everything (crawl → extract → classify → AI → fetch assets) → Walker submits one completed result (or reports failure). The job lifecycle, idempotency rules, and the exact endpoints are all in the frozen contract; Walker builds to those, never around them.

Because Walker is long-running and does real network work against arbitrary customer sites, it must be resilient: honor the per-job limits, respect the cancellation checkpoint, apply the retry/fallback posture from the AI spec, and treat every fetched byte as untrusted.

## 7. The One Rule Above All Others

If Walker needs a Beagle capability, endpoint, or behavior that the frozen contract does not describe: **stop and surface it.** Do not invent an endpoint, do not assume undocumented behavior, do not reach into the Beagle repository, and never modify Beagle from here. The contract is the boundary; a gap in it is a decision to be made deliberately, not filled in by guessing. This is what keeps two independently-built repos from drifting.
