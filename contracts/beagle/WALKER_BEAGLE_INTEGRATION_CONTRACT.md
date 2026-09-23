# Walker ↔ Beagle Integration Contract

**Status: verified against deployed Beagle over HTTPS.** Worker authentication has been
exercised end-to-end on `https://web-2-app-backend-api.vercel.app` (Walker W1, 14/14 — §10).
Every shape below is implemented and tested in Beagle; §10 records exactly which run observed what.

- **Beagle** — the Next.js/TypeScript Backend API on Vercel. System of record.
- **Walker** — the Discovery Worker on Railway. Not built yet; this is what it builds against.

**Companion artifacts (self-contained, copyable into the Walker repo):**
- `contracts/recommendation-payloads.v1.0.0.schema.json` — frozen machine-readable payload schema (G4).
- `contracts/WALKER_CONTRACT_GAPS.md` — gap classification report + the four open items (G1 dispatch, G5 cancellation, G6 fine-grained progress, G7 stuck-job recovery), which remain **genuinely missing Beagle capabilities / future decisions**, not Walker responsibilities.
- §9a below exports the resolved gaps (G2 discovery schema + units, G3 page identity, G8 rank, G10 operational semantics); §5 covers G9.

## 1. Ownership boundary

Walker is a **thick** worker.

| Walker owns | Beagle owns |
|---|---|
| Crawl, render, extraction | Auth, RLS, project ownership |
| Internal page classification | Job lifecycle and state transitions |
| AI analysis (model calls, prompts, retry/fallback) | Contract validation of everything submitted |
| Fetching icon bytes | Storing asset bytes; issuing managed asset IDs |
| Generating recommendations | Recommendation lifecycle (accept/reject/modify, supersession) |
| | Blueprint construction, validation and persistence |

**Walker never connects to Postgres or Storage directly.** Every write goes through the authenticated endpoints below, executed by Beagle with the service-role client after verification. Beagle makes no model-provider call on a request path.

Beagle builds the Blueprint itself and does not accept one from Walker — Decision 016 makes the Backend API the only writer of Blueprint content.

## 2. Authentication

Every worker request carries a bearer token **and** an HMAC signature.

```
Authorization:       Bearer <DISCOVERY_WORKER_SECRET>
X-Worker-Id:         walker-1
X-Worker-Timestamp:  <unix seconds>
X-Worker-Nonce:      <16-64 chars, [A-Za-z0-9_-], single use>
X-Worker-Signature:  sha256=<hex HMAC-SHA256>
```

Canonical string — newline-joined, order fixed:

```
<METHOD>\n<PATH>\n<workerId>\n<timestamp>\n<nonce>\n<sha256(rawBody) hex>
```

```js
const digest    = sha256Hex(rawBody);
const canonical = [method.toUpperCase(), path, workerId, timestamp, nonce, digest].join('\n');
const signature = 'sha256=' + hmacSha256Hex(SECRET, canonical);
```

Rules Walker must honour:

- Sign the **exact bytes** sent. Beagle verifies against the raw body; re-serialising changes whitespace or key order and breaks the signature.
- Method and path are signed, so a captured signature cannot be replayed against another endpoint or another `jobId`.
- Timestamp must be within **±300 s**.
- Nonce must be unique per request. Beagle records it; a reuse is refused.
- Missing/empty/whitespace `DISCOVERY_WORKER_SECRET` on Beagle authenticates **nothing** (fail-closed).

## 3. Job lifecycle

```
queued ──claim──> running ──result───> succeeded
                     │
                     └────failure───> failed

cancelling ──> cancelled   (user-initiated; Walker stops at its next checkpoint)
```

- Transitions are applied with the expected status in the `WHERE` clause, so concurrent workers produce exactly one winner.
- Terminal states are immutable: a late failure cannot overwrite a success.
- **Idempotency** — `result` flips `running → succeeded` *before* writing any dependent rows. A retry finds no running job, gets `409 JOB_NOT_RUNNING`, and persists nothing twice.

## 3a. `POST /api/worker/jobs/claim-next` — job acquisition (Decision 024)

**This is how Walker gets work.** Authenticated pull: Walker polls, Beagle atomically
leases the oldest claimable queued discovery job and returns it **with its URL and limits in
the same response**. Acquisition and URL delivery are one mechanism — there is no window in
which Walker holds a `jobId` but not the URL, and the URL survives a worker restart because it
lives in the database, not in a message.

```jsonc
POST /api/worker/jobs/claim-next
{ "workerVersion": "walker-0.2.0" }      // no jobId — Walker does not know one yet
```

**200 — a job was leased:**

```jsonc
{ "data": {
  "claimed": true,
  "job": {
    "jobId":     "<uuid>",
    "projectId": "<uuid>",
    "url":       "https://example.com",   // durable, normalized (origin-only)
    "status":    "running",
    "claimedBy": "walker-1",
    "limits": { "maxPages": 40, "maxDepth": 3, "pageTimeoutMs": 15000, "totalTimeoutMs": 300000 }
  }
} }
```

**200 — queue empty (NOT an error):**

```jsonc
{ "data": { "claimed": false, "job": null } }
```

Poll on a backoff; `claimed: false` is the normal idle answer.

- **Atomicity.** Backed by `claim_next_discovery_job()`, a single
  `UPDATE … WHERE id = (SELECT … FOR UPDATE SKIP LOCKED LIMIT 1)`. Selection and locking are
  one operation, so two workers polling simultaneously can never receive the same job — the
  second skips the locked row and takes the next. Strictly stronger than list-then-claim.
- **Ordering.** Oldest `created_at` first.
- **Skipped:** jobs already `running`/terminal, non-`discovery` types, and any job whose
  durable `url` is NULL (rows predating migration 005). A job Walker could not act on is
  never handed out.
- **Minimal fields only.** Exactly the six keys above. No project names, no ownership
  columns, no other jobs — nothing that could leak one project's data to a worker handling
  another's.
- **`503 JOB_QUEUE_UNAVAILABLE`** if the queue itself is unreachable. Distinct from an empty
  queue on purpose: an outage must never look like "no work".
- Auth is the **existing** §2 HMAC mechanism, unchanged — same canonical string, same replay
  protection, no new secret, no inbound-to-Walker endpoint.

### `/start` push — REMOVED

The fire-and-forget `POST ${DISCOVERY_WORKER_URL}/start` is **gone**, not demoted. It carried
the only copy of the URL with no retry and no delivery guarantee, so a lost push stranded the
job. Decision 024 also rules out an inbound-to-Walker endpoint — the only thing that push
could target — so retaining it even as a "wake hint" would mean calling an endpoint that by
design does not exist. **Walker must not implement a `/start` receiver.**

## 4. `POST /api/worker/jobs/{jobId}/claim`

```jsonc
{ "jobId": "<uuid>", "workerVersion": "walker-0.1.0" }
```

Claims one **known** jobId. Secondary to §3a — use `claim-next` for normal acquisition; this
remains for a job whose id Walker already has (a fixture, or a re-drive).

`200` — everything Walker needs to run the job without reading the database:

```jsonc
{ "data": { "jobId": "…", "projectId": "…", "url": "https://example.com",
            "status": "running", "claimedBy": "walker-1", "projectExists": true,
            "limits": { "maxPages": 40, "maxDepth": 3, "pageTimeoutMs": 15000, "totalTimeoutMs": 300000 } } }
```

`url` is the same durable value `claim-next` returns; it is `null` only for jobs predating
migration 005 (which `claim-next` skips entirely).

`409 JOB_NOT_CLAIMABLE` — not `queued` (already claimed, or terminal).

## 5. `POST /api/worker/jobs/{jobId}/assets`

Upload one icon. Repeat per candidate. Bytes travel base64 in the JSON body so one signature covers the whole request.

```jsonc
{
  "jobId": "<uuid>",
  "sourceUrl": "https://example.com/apple-touch-icon.png",
  "sourceType": "favicon | manifest | appleTouchIcon | openGraph",
  "rank": 1,
  "contentType": "image/png | image/jpeg | image/webp | image/x-icon | image/vnd.microsoft.icon | image/gif",
  "bytesBase64": "<base64, no data: prefix>",
  "sha256": "<hex sha256 of decoded bytes>"
}
```

`201` → `{ "data": { "assetRef": "<uuid>", "sourceType": "…", "rank": 1, "byteSize": 123, "sha256": "…" } }`

Beagle validates **before** anything reaches Storage: ≤ 2 MB; digest recomputed over decoded bytes; declared content type confirmed against actual magic bytes. `assetRef` is Beagle-issued — Walker cannot mint one, so a recommendation can only reference bytes that really landed.

Errors: `413 ASSET_TOO_LARGE` · `400 ASSET_DIGEST_MISMATCH` · `415 ASSET_TYPE_MISMATCH` · `409 JOB_NOT_RUNNING` · `502 ASSET_STORAGE_FAILED`.

SVG is unsupported by design: it is XML, can carry script, and would be served from Storage.

### Asset-fetch safety rules (Walker implements; Beagle never fetches)

| Rule | Value |
|---|---|
| Schemes | `https:` only — no `http:`, `data:`, `file:`, `blob:` |
| Blocked destinations | `127.0.0.0/8`, `10/8`, `172.16/12`, `192.168/16`, `169.254/16` (incl. cloud metadata), `::1`, `fc00::/7`, `fe80::/10` |
| DNS | Check **resolved IP** against the blocklist, and re-check on **every** redirect hop |
| Redirects | Max 3 |
| Size | 5 MB fetch ceiling; 2 MB upload ceiling |
| Timeouts | 10 s connect, 20 s total |
| Content type | Real image type, confirmed by magic bytes — never the header alone |
| Origin | Same registrable domain as the crawled site |

**G9 — this table is a MINIMUM security floor, not a ceiling.** Walker MUST enforce at least
every restriction above. Walker MAY tighten it — add further private/reserved/metadata
ranges (e.g. `100.64.0.0/10` CGNAT, `192.0.0.0/24`, `198.18.0.0/15`, `::ffff:0:0/96`
IPv4-mapped, other cloud metadata addresses), reject additional schemes, or lower the size
and timeout ceilings — and MUST normalize equivalent address forms before checking (decimal/
octal/hex IPv4, zero-compressed and IPv4-mapped IPv6, trailing-dot and case-folded hosts),
so an equivalent encoding of a blocked address is also blocked. Walker MUST NEVER loosen any
documented restriction: never allow a listed range, never permit a non-`https:` scheme,
never raise a documented ceiling. Beagle independently re-enforces the receiving half
(size, magic-byte content type, digest) and cannot see Walker's fetch, so a loosened fetch
rule is an unreviewable hole — treat the floor as inviolable.

## 6. `POST /api/worker/jobs/{jobId}/result`

The single terminal success submission.

```jsonc
{
  "jobId": "<uuid>",
  "workerVersion": "walker-0.1.0",
  "discoveryResult": { "rootUrl": "…", "crawlSummary": {…}, "pages": [...], "siteIndicators": {…} },
  "pageClassifications": [ { "pageId": "page-1", "detectedType": "home", "confidence": 0.95 } ],
  "recommendations": [
    { "type": "navigationItem", "target": "page-2",
      "recommendation": { "role": "primaryNavigation", "order": 2, "label": "Shop" },
      "confidence": 0.82, "reason": "Appears throughout your site's navigation.", "source": "ai" }
  ],
  "ingestedAssets": [ { "assetRef": "<uuid from §5>", "sourceType": "appleTouchIcon", "rank": 1 } ]
}
```

`201` → `{ data: { jobId, status: "succeeded", discoveryResultId, blueprintId, blueprintVersion, recommendationCount, supersededCount, recommendations[], unresolvedAssetRequirements[], notices[] } }`

**Page classifications are internal.** They populate the Blueprint's `pages[].detectedType` / `detectionConfidence`. They never become `ai_recommendations` rows and are not part of accept/reject/modify.

**Recommendations must conform to the frozen five-type contract** — `navigationItem`, `homepageSelection`, `themePreset`, `nativeScreen`, `assetSelection`. Per-type targets and payloads are in `lib/recommendations/schema.ts`. `source` must be `ai` or `deterministicFallback`; `openai` is refused by both Beagle and the database. Each recommendation carries its own confidence.

Supersession (§4 of the AI spec) applies: a new recommendation for an existing `(type, target)` moves the prior `pending` one to `rejected` with `superseded by a newer recommendation for the same target`. Nothing is deleted.

Errors: `400 VALIDATION_ERROR` · `400 UNKNOWN_ASSET_REF` (unknown or another project's asset) · `409 JOB_NOT_RUNNING` · `422 INVALID_BLUEPRINT`.

## 7. `POST /api/worker/jobs/{jobId}/failure`

```jsonc
{ "jobId": "<uuid>", "workerVersion": "walker-0.1.0",
  "failureCategory": "unreachableSite | renderTimeout | aiUnavailable | assetIngestionFailed | infrastructure | unknown",
  "message": "We couldn't reach that website." }
```

`message` is shown to the user — human-readable, never a stack trace. `409 JOB_NOT_RUNNING` if the job already resolved.

## 8. Placeholder icons

`identity.icon.activeAssetRef` stays a **required** UUID; the Blueprint contract is unchanged.

When `ingestedAssets` is empty, Beagle creates a real `assets` row with `placeholder: true`. A placeholder may exist, but never silently:

- every Blueprint read returns `unresolvedAssetRequirements[]`;
- `assertBuildableAssets()` refuses a build while one is active. **The Build Worker must call this before dispatch.**

## 9. Error envelope

```jsonc
{ "error": { "message": "…", "code": "MACHINE_CODE" } }
```

| Code | Status | Meaning |
|---|---|---|
| `UNAUTHORIZED` | 401 | Missing/malformed credentials or signature headers |
| `WORKER_REQUEST_STALE` | 401 | Timestamp outside ±300 s |
| `FORBIDDEN` | 403 | Wrong token, bad signature, malformed nonce/signature |
| `WORKER_REQUEST_REPLAYED` | 409 | Nonce already used |
| `JOB_NOT_CLAIMABLE` / `JOB_NOT_RUNNING` | 409 | Illegal transition; safe to stop |
| `WORKER_AUTH_NOT_CONFIGURED` | 500 | Beagle misconfigured — not a client error |
| `WORKER_NONCE_STORE_UNAVAILABLE` | 503 | Replay protection down; retry with a **new** nonce |

`403` deliberately does not distinguish wrong-token from bad-signature, so responses cannot be used to probe which half failed.

## 9a. Resolved gaps (exported from the implementation)

Companion artifacts, copyable into the Walker repo:

- **`contracts/recommendation-payloads.v1.0.0.schema.json`** — the machine-readable, frozen
  JSON Schema for all five recommendation types (G4). Generated from
  `lib/recommendations/schema.ts`; do not hand-edit.
- **`contracts/WALKER_CONTRACT_GAPS.md`** — the gap classification report and the four
  genuinely-open items (G1, G5, G6, G7).

### G2 — Complete `discoveryResult` schema, and the limit-unit truth

> **Machine-readable artifact:** `contracts/discovery-result.v1.0.0.schema.json` — generated
> from `lib/discovery/schema.ts`, cross-checked against the Zod validator with ajv, and
> copyable into the Walker repo. **Enable format assertion** when validating with it
> (`addFormats(ajv)`): `format: "uri"` is annotation-only by default, so without it the
> artifact accepts URLs Beagle rejects.

Exact shape Beagle validates in `POST …/result` (`discoveryResult`), from
`lib/discovery/schema.ts`:

```jsonc
{
  "rootUrl": "https://example.com",          // required, valid URL
  "crawlSummary": {                           // required
    "totalUrlsChecked": 12,                   // required, int ≥ 0
    "totalPagesSaved": 4,                      // required, int ≥ 0
    "durationMs": 900,                         // required, int ≥ 0 (milliseconds)
    "limitsHit": {                            // optional
      "maxPages": false,                      // optional boolean
      "maxDepth": false,                      // optional boolean
      "timeout": false                        // optional boolean — drives crawlComplete
    }
  },
  "pages": [                                  // required array (see G3 for identity)
    {
      "url": "https://example.com/about",     // required, valid URL
      "path": "/about",                       // required, string (used as page identity key)
      "title": "About",                       // optional string
      "description": "…",                     // optional string
      "links": ["https://example.com/"],      // optional array of valid URLs (internal-link graph)
      "assets": [                             // optional
        { "url": "https://example.com/favicon.ico", "type": "favicon" }
      ],
      "detectedType": "about"                 // optional string (deterministic hint; not the classification)
    }
  ],
  "siteIndicators": { "hasEcommerce": true }  // required object, free-form key→any (DETECTION_PIPELINE §3 flags)
}
```

Notes Beagle actually enforces:
- `siteIndicators` is an **open record** (`Record<string, any>`) — Beagle reads specific keys
  (e.g. `hasEcommerce`, `hasShopify`, `hasAuthentication`, `hasAccountSystem`, `hasBlog`) as
  boolean flags; unknown keys are ignored, absent flags are treated as false. Send booleans.
- `pages[]` has **no `id` field** — see G3. Only the first **40** pages are used (`MAX_PAGES`);
  extras are silently dropped, so page references beyond `page-40` cannot resolve.
- `links` are resolved against `rootUrl` and matched by pathname to build the inbound-link graph
  (homepage/nav signals). Only links whose pathname matches a submitted page's `path` count.
- `pages[].assets[].type` is an **unconstrained string** — *not* the four-value `sourceType`
  enum used at asset upload. `"favicon"` above is only an example; any string is accepted here.
  The enum (`favicon | manifest | appleTouchIcon | openGraph`) applies at
  `POST …/assets` and in `ingestedAssets[]`, which are separate, validated surfaces.
- **Submission caps enforced on `POST …/result`:** `recommendations` ≤ **200**,
  `pageClassifications` ≤ **200**, `ingestedAssets` ≤ **50**, each `reason` ≤ **500** chars,
  `navigationItem.order` ≥ **0**. Exceeding any of these fails the whole submission with
  `400 VALIDATION_ERROR`. Note there is **no schema-level cap on `discoveryResult.pages[]`** —
  a 60-page array is accepted, but only the first 40 are ever used (see the `MAX_PAGES` note above).

**Limit units — resolved.** The code is authoritative and uses **milliseconds**. The `claim`
response and the dispatch payload both return:

```json
{ "maxPages": 40, "maxDepth": 3, "pageTimeoutMs": 15000, "totalTimeoutMs": 300000 }
```

`SYSTEM_ARCHITECTURE`/`DETECTION_PIPELINE` describe the same durations as
`perPageTimeoutSeconds` (15 s) and `jobTimeoutSeconds` (300 s = 5 min) — **identical values,
seconds-named prose vs. millisecond-named wire fields.** The wire truth Walker consumes is
`pageTimeoutMs` / `totalTimeoutMs` in **milliseconds**. There is no behavioural discrepancy,
only a naming one; use the `…Ms` fields.

### G3 — Page identity and linkage (Walker does NOT mint page ids)

This is the single most load-bearing implicit rule, and it is not optional.

- Walker submits `discoveryResult.pages[]` with **no id field**. **Beagle mints the identity**
  as `page-{N}`, where **N is the 1-based index of the page in the array Walker submits**
  (`page-1`, `page-2`, …), capped at 40.
- That minted id becomes the Blueprint `pages[].id` verbatim.
- Therefore **`pageClassifications[].pageId` and the `target` of every `navigationItem` /
  `homepageSelection` recommendation MUST be `page-{N}` using that same 1-based submission
  index.** Walker computes them from its own array order; it must not invent UUIDs or slugs.
- The **array order IS the contract.** If Walker reorders `pages[]` between computing its
  classifications/recommendations and submitting, every `page-N` reference silently points at
  a different page. Freeze the order first, then derive all `page-N` references from it.
- A classification whose `pageId` does not match any minted id is **silently ignored** (that
  page keeps its deterministic type). A recommendation targeting a non-existent `page-N`
  **passes submission validation but fails at accept time with 400** (`applyRecommendation`
  can't find the page). Neither fails the `result` call — so a bad index is a latent defect,
  not an immediate error. Keep indices exact.
- `themePreset` targets the literal `"theme"`; `assetSelection` targets `"identity.icon"`;
  `nativeScreen` targets a screen-type enum value (`settings|about|support|profile|
  notifications|onboarding|offlineError`). These are constants, not page ids.

### G8 — Asset `rank` semantics

`rank` appears in three places and means the **same ranking intent** (1 = best icon
candidate, ascending) at three stages — but Beagle does **not** enforce agreement between
them, and their constraints differ:

| Where | Field | Constraint Beagle enforces | Meaning |
|---|---|---|---|
| Asset upload (`POST …/assets`) | `rank` | integer **> 0** | Walker's candidate rank at ingestion time |
| Result `ingestedAssets[]` | `rank` | integer **> 0** | The rank Walker asserts in the final submission |
| `assetSelection.recommendation.candidates[].rank` | `rank` | integer (**any**, incl. 0/negative) | The ranking that lands in the Blueprint if accepted |

The `assetSelection` candidate `rank` is unconstrained because it derives from the Blueprint
icon shape (`z.number().int()`), whereas upload/ingested `rank` is `int().positive()`.
**Recommendation for Walker:** use consistent, positive, ascending `rank`s across all three
(1-based, 1 = preferred). Nothing forces consistency, but the accepted `assetSelection` is
what the app uses, so keep it aligned with what you uploaded. Beagle does not re-sort.

### G10 — Worker operational semantics (as implemented)

- **`X-Worker-Id`** is **free-form**, not allowlisted. It is bound into the HMAC signature and
  recorded (`worker_request_nonces.worker_id`, `claimedBy`) for attribution only; any value
  with a valid signature is accepted. Use a stable per-deployment id (e.g. `walker-prod-1`).
- **`workerVersion`** is validated for **length only** (1–64 chars), not against an allowlist.
  It is recorded for reproducibility. Send a real build identifier.
- **Concurrency.** Safe by construction: `claim` and the terminal transitions apply the
  expected status inside the `WHERE` clause, so exactly one worker wins a race; the loser gets
  `409`. Multiple workers may run against Beagle simultaneously.
- **Retry / idempotency.** Nonces are **single-use** — a retried request needs a **fresh
  nonce** (a byte-identical replay is refused `409 WORKER_REQUEST_REPLAYED`). Safe retries:
  `result` and `failure` guard on `status='running'`, so a retry after a successful terminal
  write returns `409 JOB_NOT_RUNNING` having changed nothing. `assets` may be retried with a
  new nonce; each successful upload mints a **new** `assetRef` (no dedup by content), so retry
  only on a non-2xx and use the `assetRef` from the successful response.
- **Timestamp window** ±300 s; keep Walker's clock in NTP sync.
- **No Beagle-side rate limit** on worker endpoints beyond nonce single-use and the job state
  machine. Walker should self-limit asset uploads (≤50 per job is the `ingestedAssets` ceiling).

## 10. Verification status

| Verified | How |
|---|---|
| Signature construction, forgery, tampering, path/method binding, skew, nonce shape | 16 unit tests |
| Endpoint behaviour, lifecycle, idempotency, replay, asset validation | 30 endpoint tests on an in-memory fake that evaluates query predicates |
| Worker auth over **real HTTP** against a real production build | **12/12** via `scripts/worker-auth-smoke.mjs` — see breakdown below |
| Nonce replay, RLS and grants on the live database | Live SQL on the Supabase project |
| Migration 004 + `project-assets` bucket | Applied to the live project |
| Recommendation payload artifact behaves as Beagle validates | 12 ajv accept/reject cases in `tests/tooling/recommendation-schema.test.ts` |

### Worker-auth smoke run — 12/12 (recorded)

Executed against a **local production build** (`next start`, `http://127.0.0.1:3112`) — the
same compiled server Vercel runs, driven over a real HTTP socket with no mocks and no imports
from the app.

| # | Check | Result |
|---|---|---|
| 1 | no `Authorization` header | 401 `UNAUTHORIZED` |
| 2 | bearer but no signature | 401 `UNAUTHORIZED` |
| 3 | wrong bearer token | 403 `FORBIDDEN` |
| 4 | signature made with wrong secret | 403 `FORBIDDEN` |
| 5 | malformed signature | 403 `FORBIDDEN` |
| 6 | stale timestamp (1 h old) | 401 `WORKER_REQUEST_STALE` |
| 7 | future timestamp (1 h ahead) | 401 `WORKER_REQUEST_STALE` |
| 8 | short nonce | 403 `FORBIDDEN` |
| 9 | signature bound to path (replayed to another endpoint) | 403 `FORBIDDEN` |
| 10 | signature bound to body (tampered payload) | 403 `FORBIDDEN` |
| 11 | nonce replay refused | **SKIP** — nonce store unreachable from the build environment |
| 12 | valid signature accepted by auth | passes auth, reaches the DB stage |

Check 11 reports **SKIP rather than PASS** when the nonce store is unreachable, so a green run
cannot hide a missing replay defence. Replay refusal is separately proven by live SQL (primary-key
collision on `worker_request_nonces`) and by the endpoint tests.

### Deployed-HTTPS verification — Walker W1, 14/14 (AUTHORITATIVE)

Run by the Walker team from GitHub Codespaces against
**`https://web-2-app-backend-api.vercel.app`** — real TLS, real deployment, real Supabase.
**14/14 passed**, including the nonce-replay check that the earlier local run could only SKIP.
This is the authoritative verification of the worker-auth path.

### Local-HTTP smoke — 12 checks (earlier, separate run)

A **different run**, recorded above: `scripts/worker-auth-smoke.mjs` against a local
production build (`next start`, `http://127.0.0.1:3112`). 12 checks, of which check 11
(nonce replay) reported **SKIP** because the build environment could not reach the nonce
store, and check 12 confirmed a valid signature passes auth and reaches the DB stage.

These two runs are **not the same run and are not merged**: different targets (localhost
HTTP vs deployed HTTPS), different check counts (12 vs 14), different replay outcome (SKIP
vs PASS). Both are real; the deployed run supersedes the local one as the verification of
record, and the local one remains the reproducible developer-machine check.

To re-run against the deployment:

```bash
BEAGLE_URL=https://web-2-app-backend-api.vercel.app \
DISCOVERY_WORKER_SECRET=<the real secret> \
node scripts/worker-auth-smoke.mjs
```

### Decision 024 (claim-next) — live-verified on production Postgres

Migration 005 applied to the live project; `claim_next_discovery_job()` exercised directly
against production, **9/9**: oldest-first ordering, durable URL returned with the claim,
`queued → running` transition, two successive claims never returning the same job, jobs with
a NULL `target_url` and non-discovery types both skipped and left `queued`, `service_role`
may EXECUTE, and `anon` is refused.

## 11. Beagle configuration required

| Variable | Purpose |
|---|---|
| `DISCOVERY_WORKER_SECRET` | HMAC key + bearer token. Fail-closed if unset. |
| `SUPABASE_SERVICE_ROLE_KEY` | Beagle-only. Never shared with Walker. |

Walker needs `DISCOVERY_WORKER_SECRET` and Beagle's base URL. It never receives any Supabase credential.
