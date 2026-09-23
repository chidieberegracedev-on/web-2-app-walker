# web-2-app-walker

Walker — the **Discovery Worker** (Railway) for the website-to-app builder. It
crawls and renders a customer website, runs the AI analysis, fetches candidate
icon bytes, and submits one completed result to **Beagle** (the deployed Backend
API) through the frozen worker contract. Walker never touches Supabase/Storage
directly and never builds a Blueprint — Beagle owns all of that.

Full context is in [`docs/`](./docs). Start with
[`WALKER_PROJECT_HANDOFF.md`](./docs/WALKER_PROJECT_HANDOFF.md), then the frozen
integration contract — a read-only Beagle snapshot pinned in
[`contracts/beagle/`](./contracts/beagle) (see
[`WALKER_BEAGLE_INTEGRATION_CONTRACT.md`](./contracts/beagle/WALKER_BEAGLE_INTEGRATION_CONTRACT.md)
and [`SYNC_MANIFEST.json`](./contracts/beagle/SYNC_MANIFEST.json) for the pinned
commit and checksums) — then the
[`WALKER_IMPLEMENTATION_PLAN.md`](./docs/WALKER_IMPLEMENTATION_PLAN.md)
(phases W1–W6), and [`WALKER_CLAUDE_CODE_RULES.md`](./docs/WALKER_CLAUDE_CODE_RULES.md).

## Status: Phase W1 — authenticated contact with Beagle

W1 delivers a Walker process that can authenticate to deployed Beagle and drive
the job lifecycle over real HTTP, **before** any crawling or AI exists:

- Fail-closed config guard (`src/config.ts`) — requires `DISCOVERY_WORKER_SECRET`
  and `BEAGLE_BASE_URL`, and **refuses to start if any `SUPABASE_*` variable is
  present** (the boundary tripwire; Walker rules #4/#7).
- HMAC request signing (`src/crypto/`) — the exact canonical string from contract
  §2, the raw body signed once and sent byte-for-byte unchanged, a single-use
  base64url nonce, and a ±300 s timestamp.
- Typed §9 error model + retry posture (`src/client/errors.ts`,
  `src/client/auth-client.ts`).
- `claim()` and `reportFailure()` (`src/client/job-client.ts`) — claim returns a
  typed `JobContext` carrying Beagle's per-job `limits` verbatim.

Not in W1 (later phases): Playwright/crawl, extraction, AI, asset fetching,
`/result` submission, cancellation, progress reporting, stuck-job recovery, and
production job acquisition/dispatch. See the implementation plan.

## Status: Phase W2 — DiscoveryEngine (crawl + extract)

W2 delivers the crawl/extract/analyze engine as a **pure function behind an
injected input**, so production intake (Beagle pull/claim — "G1") can be attached
later without touching the engine:

```
DiscoveryEngine.run(input: DiscoveryJobInput { jobId, rootUrl, limits }) -> DiscoveryResult
```

- Playwright browser lifecycle (`src/discovery/browser.ts`) — headless chromium,
  container-safe args, `executablePath` override.
- Same-origin BFS crawl (`src/discovery/crawler.ts`) — deterministic ordering,
  depth handling, and **all limits read from the injected `JobContext.limits`**
  (maxPages, maxDepth, per-page timeout, total timeout), never hardcoded.
- URL normalization/dedup + baseline scoping (`src/discovery/url.ts`) — https +
  same-registrable-domain at crawl time (full §5 SSRF hardening is W4, at
  asset-fetch).
- Extraction (`src/discovery/dom-extract.ts`, `extract.ts`) — title, headings,
  HTTP status, redirect chain, depth, internal/external links, forms + field
  types, metadata, visual characteristics; asset candidates (favicon / manifest
  icons / apple-touch / OG) **surfaced, not fetched** (bytes are W4).
- Deterministic indicators (`src/discovery/indicators.ts`) — auth, OAuth domains,
  ecommerce, search, account system, mobile-responsive, repeated navigation.
- Cooperative cancellation **checkpoint hook only** — not wired to any real
  signal (G5 is unbuilt on Beagle's side).

**Page identity:** discovered pages carry **no `id`**. Beagle derives
`page-{1-based index}` from `pages[]` position; the engine guarantees one
deterministic ordering and exposes `positionalPageId(index)` so Walker-side code
(W3) derives the same `page-N`.

**Engine ↔ adapter boundary (deliberate):** the engine produces the internal
`DiscoveryResult` model (`src/discovery/model.ts`), shaped using
`docs/DETECTION_PIPELINE.md §4` as guidance — **not** Beagle's frozen wire schema
(still being finalized; `crawlSummary.limits` naming/units unresolved). A future
Beagle **result adapter** (W5) maps this model onto whatever Beagle publishes; a
future **intake adapter** (post-G1) supplies `rootUrl`. Neither exists yet.

Not in W2: production intake / `claim-next` / `/start`; AI (W3); asset byte
fetching (W4); result submission (W5); cancellation/progress/stuck-job wiring.

## Requirements

- Node.js 22 (`.nvmrc`), npm.
- A chromium browser for discovery (W2). Locally: `npx playwright install chromium`
  (or, on a pre-provisioned image, set `WALKER_CHROMIUM_EXECUTABLE_PATH` to the
  browser binary — the tests auto-discover one under `PLAYWRIGHT_BROWSERS_PATH`).
  On Railway the browser + system deps come from the `Dockerfile`
  (`playwright install --with-deps chromium`).

```bash
npm install
npm run typecheck   # strict tsc over src + test
npm test            # vitest — offline unit + loopback-fixture render tests
npm run build       # emit dist/ (tsc)
```

The discovery render tests use a **loopback fixture site** (no external egress).
They skip automatically if no chromium can be resolved. Real-site discovery, like
the W1 live smoke, must run where outbound network is permitted.

## Offline test suite

`npm test` runs entirely offline (no Beagle egress needed):

- **Known-answer signatures** — vectors generated by an independent
  implementation, so the signer is checked against an external reference, not
  itself.
- **Byte identity** — proves the bytes hashed into the signature are exactly the
  bytes handed to `fetch`.
- **§9 rejection matrix** — an independent in-process verifier
  (`test/helpers/conformance-server.ts`) enforces the full contract §9 matrix; a
  real signed claim is accepted by it.
- **Client error mapping / retry posture** — every §9 response maps to the right
  typed error with the directed retry behaviour.
- **Config guard** — including the Supabase tripwire.

## Live smoke (run from a permitted environment)

The live leg must run where outbound HTTPS to Beagle is allowed (e.g. GitHub
Codespaces). Walker's build/CI sandbox has no egress to Beagle by design.

```bash
BEAGLE_BASE_URL=https://web-2-app-backend-api.vercel.app \
DISCOVERY_WORKER_SECRET=<the real secret> \
JOB_ID=<a queued fixture job id> \
node scripts/beagle-auth-smoke.mjs
```

It runs the 12 auth checks over real HTTPS (reporting **SKIP**, not PASS, if the
nonce store is unreachable so a green run can't hide a missing replay defence),
then a live **claim + failure** round-trip on the fixture job. Exits non-zero on
any failure. The fixture job is **single-use**: the run drives it
`queued → running → failed` (terminal), so it cannot be re-run against the same
`JOB_ID`.

## Hard boundaries

- Work only in this repo; never read or modify the Beagle repository.
- Build against the frozen contract exactly; never invent an endpoint or
  behaviour. A gap in the contract is surfaced, not worked around.
- Never connect to Supabase/Postgres/Storage. Walker holds only
  `DISCOVERY_WORKER_SECRET` + Beagle's base URL — never a Supabase credential.
- Walker never constructs or submits a Blueprint.
- The asset-fetch SSRF ruleset (contract §5) is implemented exactly as written
  (W4).
