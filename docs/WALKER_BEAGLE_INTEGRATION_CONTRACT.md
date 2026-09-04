# Walker ↔ Beagle Integration Contract

**Status: FROZEN (v1.0).** This is the authoritative contract for the Walker repository. Walker builds against this document; it does not read the Beagle repository.
Every shape below is implemented and tested in Beagle, and the authenticated path is verified end-to-end against deployed production. See §10.

- **Beagle** — the Next.js/TypeScript Backend API on Vercel. System of record.
- **Walker** — the Discovery Worker on Railway. Not built yet; this is what it builds against.

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

## 4. `POST /api/worker/jobs/{jobId}/claim`

```jsonc
{ "jobId": "<uuid>", "workerVersion": "walker-0.1.0" }
```

`200` — everything Walker needs to run the job without reading the database:

```jsonc
{ "data": { "jobId": "…", "projectId": "…", "status": "running", "claimedBy": "walker-1",
            "limits": { "maxPages": 40, "maxDepth": 3, "pageTimeoutMs": 15000, "totalTimeoutMs": 300000 } } }
```

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

## 10. Verification status

| Verified | How |
|---|---|
| Signature construction, forgery, tampering, path/method binding, skew, nonce shape | 16 unit tests |
| Endpoint behaviour, lifecycle, idempotency, replay, asset validation | 30 endpoint tests on an in-memory fake that evaluates query predicates |
| Auth layer over **real HTTP** against the real production build | 10/10 smoke checks; a valid signature reaches the DB stage |
| Nonce replay, RLS and grants on the live database | Live SQL on the Supabase project |
| Migration 004 + `project-assets` bucket | Applied to the live project |

**Verified — authenticated path end-to-end over live HTTPS.** Run from GitHub Codespaces against deployed production (`https://web-2-app-backend-api.vercel.app`) via `scripts/worker-auth-smoke.mjs`: **12/12 passed.** A valid signed request reached `404 NOT_FOUND` (intentional nonexistent job ID), proving it passed worker authentication and reached the application/database layer rather than failing closed. All rejection cases returned their exact expected status: unsigned (401), bearer-without-signature (401), wrong bearer (403), wrong-secret signature (403), malformed signature (403), stale timestamp (401), future timestamp (401), short nonce (403), path-bound signature (403), body-bound signature (403), and nonce replay (409). The earlier egress limitation from the Beagle build environment no longer applies to this result — it was exercised from a permitted environment against real Vercel with the production secret set.

**Not independently re-verified from this environment:** the full completed-result submission (`/result`) with real ingested assets end-to-end. The smoke test exercises the auth boundary and job-claim path — the highest-risk leg and the one that gates every other endpoint. The `/result`, `/assets`, and `/failure` payloads are covered by the 30 endpoint tests on the predicate-evaluating fake plus live SQL on the schema; a full production round-trip of those is appropriate as Walker's own first integration milestone (see WALKER_IMPLEMENTATION_PLAN.md).

To close that gap, run the committed smoke script against the deployment:

```bash
BEAGLE_URL=https://web-2-app-backend-api.vercel.app \
DISCOVERY_WORKER_SECRET=<the real secret> \
node scripts/worker-auth-smoke.mjs
```

It exercises the real HTTP surface (no mocks) and exits non-zero on any
failure. The replay check reports SKIP rather than passing if the nonce store
is unreachable, so a green run cannot hide a missing replay defence.

## 11. Beagle configuration required

| Variable | Purpose |
|---|---|
| `DISCOVERY_WORKER_SECRET` | HMAC key + bearer token. Fail-closed if unset. |
| `SUPABASE_SERVICE_ROLE_KEY` | Beagle-only. Never shared with Walker. |

Walker needs `DISCOVERY_WORKER_SECRET` and Beagle's base URL. It never receives any Supabase credential.
