# Walker — Implementation Plan

Phased build order for the Discovery Worker. Same discipline the rest of the project has used: each phase produces a stable, testable foundation before the next touches it, and no phase starts by attempting the whole thing. Build against the frozen `WALKER_BEAGLE_INTEGRATION_CONTRACT.md` throughout.

The ordering principle here is deliberate: **prove the Beagle connection before building the processing that depends on it.** The single highest risk in a separate-repo worker is discovering, late, that your assumptions about the backend contract were wrong. So the plan front-loads contact with the real deployed Beagle rather than saving integration for the end.

## Phase W1 — Skeleton + Authenticated Contact With Beagle

**Goal:** a Walker process that can authenticate to deployed Beagle and complete the job lifecycle against real HTTP — before any crawling or AI exists.

- Project skeleton (Railway-deployable service, whatever the chosen runtime — Node/TypeScript is the natural fit given Playwright and shared shapes with Beagle, but that's Walker's call to propose).
- The **worker auth client**: construct the HMAC signature exactly per contract §2 (canonical string, raw-body signing, nonce, timestamp). This is the piece most likely to be subtly wrong, so it comes first and gets verified against real Beagle immediately.
- Implement the job lifecycle calls: `claim`, `failure` (the two simplest), against the deployed backend.
- **This is the moment to close the one gap the contract flags:** the full authenticated round-trip. Claim a real job against deployed Beagle and get a real `running` response back.

**Test gate:** Walker authenticates to `https://web-2-app-backend-api.vercel.app` and successfully claims a real (test) job over live HTTPS, and reports a failure that Beagle accepts. Auth failures (bad nonce, stale timestamp, replay) behave exactly as the contract's §9 table says. Do not proceed until Walker can talk to Beagle for real.

## Phase W2 — Discovery (Crawl + Extract)

**Goal:** turn a claimed job's URL into a structured `DiscoveryResult`, no AI yet.

- Headless-browser crawl/render respecting the per-job limits Beagle returns on claim (never hardcode them).
- Extraction per `DETECTION_PIPELINE.md`: links, nav, forms, assets (candidate icons — surface them, don't fetch yet), metadata, visual characteristics.
- Assemble a `DiscoveryResult` matching the contract's shape.
- Deterministic indicator flags (auth present, ecommerce, OAuth domains, etc.) — the deterministic layer that must exist *before* AI, per the AI spec's deterministic-first principle.

**Test gate:** for several structurally different real sites (ecommerce, content/blog, SPA), Walker produces a well-formed `DiscoveryResult` within limits, and the edge cases from `PHASE_1_CHECKLIST.md` in the originals (unreachable, redirects, huge sites, missing icons, non-responsive) are handled — degrading gracefully, not crashing.

## Phase W3 — Internal Page Classification + AI Analysis

**Goal:** the relocated AI pipeline, producing the frozen five recommendation types.

- Port the reference AI logic from Beagle's annotated `lib/ai/` (prompt construction, model call, retry, deterministic fallback) — relocated and adapted, not reinvented.
- **Deterministic-first (AI spec §2):** feed the model the compact structured representation, never a raw-HTML/DB-row dump. This was a specific divergence fixed in Beagle; preserve the fix here.
- **Prompt-injection resistance (AI spec §10):** website-derived text is untrusted data, structurally separated from instructions. Walker is where crawled content actually meets the model, so this defense lives here.
- Internal page classification feeds navigation/homepage recommendations but is submitted as classification data, never as a recommendation (contract §6).
- Generate recommendations conforming to the five frozen types, each with real per-field confidence and `source ∈ {ai, deterministicFallback}` — never `openai` (both Beagle and the DB reject it).

**Test gate:** recommendations validate against the contract's per-type schemas; confidence is genuinely per-field; a forced model failure degrades to deterministic fallback rather than failing the job; an injection attempt in page content does not alter behavior.

## Phase W4 — Asset Fetching + Ingestion

**Goal:** safely fetch candidate icons and hand the bytes to Beagle.

- Implement the asset-fetch safety ruleset (contract §5) **exactly**: https-only, resolved-IP blocklist checks, re-check on every redirect hop, size ceiling, timeouts, magic-byte content-type confirmation, SVG rejection, same-origin enforcement. This is the SSRF surface — it is security-critical and the rules are fixed, not negotiable.
- Upload each valid candidate via `/assets` (base64 in the signed body), receive Beagle-issued `assetRef`s.
- Reference only Beagle-issued `assetRef`s in the final recommendations.

**Test gate:** the safety ruleset is proven against deliberately hostile inputs (internal-IP redirects, DNS-rebinding attempts, oversized files, content-type/magic-byte mismatches, SVG) — each rejected. Valid icons round-trip to real `assetRef`s against deployed Beagle.

## Phase W5 — Full Result Submission + End-to-End

**Goal:** the complete thick-worker round-trip in production.

- Assemble and submit the single completed `/result` — discovery + classifications + recommendations + ingested asset refs.
- Handle every documented response: success envelope, validation errors, `UNKNOWN_ASSET_REF`, `JOB_NOT_RUNNING`, `INVALID_BLUEPRINT`.
- Honor idempotency (a retried result gets `409` and persists nothing twice) and the cancellation checkpoint.

**Test gate — this closes the contract's remaining open item:** a full completed-result submission with real assets, against deployed Beagle, produces a persisted Blueprint version and the expected recommendations. This is the production round-trip the contract §10 explicitly left as Walker's first integration milestone. Plus the regression check — W1–W4 still hold.

## Phase W6 — Railway Deployment + Hardening

**Goal:** Walker runs as a real Railway service processing real jobs.

- Deploy to Railway with the secret and Beagle base URL as environment configuration (never a Supabase credential — hard boundary).
- Job-acquisition model in production (how Walker discovers queued jobs to claim — confirm the mechanism against the contract; if the contract doesn't specify a claim-discovery mechanism, that is exactly the kind of gap to surface, not invent).
- Concurrency, retry/backoff, resource limits, observability.

**Test gate:** Walker running on Railway processes a real job end-to-end against deployed Beagle, and the failure/retry paths behave under real conditions.

## Cross-cutting, every phase

- Build against the frozen contract; if something needed isn't in it, stop and surface (see `WALKER_CLAUDE_CODE_RULES.md`).
- Treat all crawled/fetched content as untrusted throughout.
- Match the live-verification bar the rest of this project has held: real HTTP against deployed Beagle, not just mocks — especially W1 and W5.
