# Walker ↔ Beagle — Gap Investigation Report

Produced by inspecting `main` at the deployed implementation. Every finding
below is classified as one of:

- **(i) already implemented** — behaviour exists; the exact contract is exported.
- **(ii) documentation-only gap** — capability exists; the contract just didn't describe it.
- **(iii) genuinely missing Beagle capability** — a Beagle implementation/architecture decision; not faked here.
- **(iv) future architectural decision** — flagged for a human; not chosen here.

Self-contained: nothing here requires reading the Beagle repository.

> **Correction (pointer accuracy).** An earlier revision of this report cited the
> resolved gaps as "§G2 / §G3 / §G8 / §G10" of the integration contract. No such
> section numbers exist, so those references did not resolve and the exports read as
> missing. The exports were present all along under **§9a "Resolved gaps"**, with G9
> inside **§5**. The pointers above are corrected; the exported content itself was
> re-audited against the implementation and found accurate — see "Post-audit
> corrections" at the end of this document.

---

## Summary table

| Gap | Topic | Class | Where it's resolved |
|---|---|---|---|
| G1 | Job acquisition | **RESOLVED** (was (iii)) | Decision 024 — `WALKER_BEAGLE_INTEGRATION_CONTRACT.md` **§3a `claim-next`** |
| G2 | `discoveryResult` schema + limit units | **(i)** schema, **(ii)** units | `WALKER_BEAGLE_INTEGRATION_CONTRACT.md` **§9a → "G2 — Complete `discoveryResult` schema, and the limit-unit truth"** |
| G3 | Page identity / linkage | **(ii)** | `WALKER_BEAGLE_INTEGRATION_CONTRACT.md` **§9a → "G3 — Page identity and linkage"** |
| G4 | Recommendation payload schemas | **(i)** | `recommendation-payloads.v1.0.0.schema.json` |
| G5 | Cancellation | **(iii)** | Surfaced below — Beagle-side gap |
| G6 | Progress | **(ii)** for coarse steps, **(iii)** for worker-pushed progress | §G6 + surfaced below |
| G7 | Stuck-job recovery | **(iii)** | Surfaced below — Beagle-side gap |
| G8 | Asset `rank` semantics | **(i)/(ii)** | `WALKER_BEAGLE_INTEGRATION_CONTRACT.md` **§9a → "G8 — Asset `rank` semantics"** |
| G9 | SSRF blocklist wording | **(ii)** | `WALKER_BEAGLE_INTEGRATION_CONTRACT.md` **§5, "Asset-fetch safety rules" → the G9 minimum-floor paragraph** |
| G10 | Worker operational semantics | **(i)** | `WALKER_BEAGLE_INTEGRATION_CONTRACT.md` **§9a → "G10 — Worker operational semantics"** |

---

## G1 — Job acquisition · ✅ RESOLVED by Decision 024

> **Resolved.** Production acquisition is now authenticated pull: `POST /api/worker/jobs/claim-next`
> atomically leases the oldest claimable queued discovery job (`FOR UPDATE SKIP LOCKED`) and returns
> `jobId` + the durable `url` + `limits` in one response. The URL is persisted at
> `jobs.target_url` (migration 005), so it survives a worker restart. The `/start` push is
> **removed**. Live-verified 9/9 on production Postgres. The original finding is kept below for history.

### Original finding (historical)

**What exists.** There is **no** Beagle endpoint that lists or leases claimable
jobs. Walker cannot poll Beagle for "what should I work on". The only production
mechanism is a **fire-and-forget push**: the user-facing `POST /api/projects/{id}/discovery`
inserts a `queued` job and then, *if* `DISCOVERY_WORKER_URL` is set, issues an
un-awaited `fetch` to `${DISCOVERY_WORKER_URL}/start` carrying:

```json
{ "jobId": "<uuid>", "url": "<normalizedUrl>",
  "limits": { "maxPages": 40, "maxDepth": 3, "pageTimeoutMs": 15000, "totalTimeoutMs": 300000 } }
```

The source comments say `// In a real implementation…` and `// Dispatch simulation` — it is
best-effort. There is **no retry, no delivery guarantee, no persisted outbox, no
worker acknowledgement**. If the push is lost, the job sits `queued` with nothing to claim it.

**Why it's a Beagle-side decision.** Reliable dispatch requires a mechanism Beagle
does not have: either a claimable-jobs endpoint Walker polls (`GET /api/worker/jobs?status=queued` +
lease), or a durable outbox with retries behind the push. Do not have Walker invent a
queue. **Decision needed:** poll-based pull vs. durable push. (For Walker W1, a manually
inserted job that Walker then `claim`s is fine — this gap is only about the production trigger.)

---

## G5 — Cancellation · (iii) genuinely missing

**What exists.** Nothing. `grep` for `cancelling`/`cancelled` across `app/` and `lib/`
returns no handler. The `jobs.status` CHECK *permits* those values (migration 001), but
no code path ever sets or reads them. `POST /api/worker/jobs/{jobId}/failure` sets
`failed`, never `cancelled`. The only job-status `GET` is user-facing
(`/api/projects/{id}/discovery/{jobId}`, requires a project-owner JWT) — Walker, which
authenticates only by worker signature, cannot call it.

**Consequence.** Walker has **no way to learn a job entered `cancelling`** and **no way to
drive it to `cancelled`**. User-initiated cancellation (BUILD_ARCHITECTURE §8 posture) is
unreachable for discovery today.

**Beagle-side gap.** Requires (a) something to set `cancelling`, and (b) a worker-facing
read (poll or the claim/heartbeat response) that surfaces it, plus a transition to
`cancelled` — none exist. Do not expect Walker to invent this.

---

## G6 — Progress · (ii) for what exists, (iii) for worker-pushed detail

**What exists.** `jobs.progress_step` is written by Beagle at four coarse checkpoints only:
`Initialize crawl` (on create) → `Analysing your site...` (on claim) → `Completed` (on result)
/ `Failed` (on failure). It is **synthesized by Beagle**, not streamed from Walker. There is
**no worker progress endpoint** — Walker cannot push fine-grained steps ("Crawling page 12 of 40").
The user reads progress via the user-facing discovery `GET`.

**Class.** The coarse contract is implemented (ii — just document it). Fine-grained,
Walker-driven progress for Screen 2 is **not implemented (iii)** and is future Beagle work
(a signed `POST …/progress` that updates `progress_step`, rate-limited, non-terminal).

---

## G7 — Stuck-job recovery · (iii) genuinely missing

**What exists.** No lease, heartbeat, `last_seen`, timeout, stale-detection, or reclaim.
`claim` only accepts `status='queued'`; terminal states are immutable; a crashed worker
leaves the row in `running` **forever**, and no second worker can ever claim it.

**Beagle-side requirement (future).** Options to decide: a claim lease with expiry +
a reaper that returns expired `running` jobs to `queued`; or a heartbeat the worker pings
and a sweep that reclaims silent jobs. **Do not** implement Walker-side self-recovery — a
worker cannot safely resurrect its own row under the current immutable-terminal model.

---

## The four genuinely-open items (for a human)

1. ~~**G1 dispatch**~~ — **RESOLVED**: Decision 024 chose authenticated pull; implemented as `claim-next`.
2. **G5 cancellation** — no set/read/transition path exists. *(Beagle capability)*
3. **G6 fine-grained progress** — coarse only today; worker-pushed progress unbuilt. *(Beagle capability)*
4. **G7 stuck-job recovery** — no lease/heartbeat/reaper. *(Beagle capability)*

G1 (Decision 024), G2, G3, G4, G8, G9, G10 are fully resolved and exported — see the referenced artifacts.

---

## Post-audit corrections (implementation re-verified)

Every claim in the exported sections was re-checked by executing the real Zod
schemas (`lib/discovery/schema.ts`, `lib/worker/schema.ts`,
`lib/recommendations/schema.ts`, `lib/blueprint/schema.ts`) rather than by
re-reading this report. The implementation is authoritative.

**Confirmed correct as written** (no change needed):

| Claim | Verified against code |
|---|---|
| `pages[]`: `url`, `path` required; `title`, `description`, `links`, `assets`, `detectedType` optional | ✅ |
| `siteIndicators` required; `crawlSummary.limitsHit` optional | ✅ |
| Limits are **milliseconds** (`pageTimeoutMs` 15000, `totalTimeoutMs` 300000) | ✅ |
| `page-{1-based index}` minting; becomes Blueprint `pages[].id` | ✅ |
| Screen types = `settings, about, support, profile, notifications, onboarding, offlineError` | ✅ |
| Upload / `ingestedAssets` `rank` = integer **> 0** (0 and negatives rejected) | ✅ |
| `assetSelection.candidates[].rank` **unconstrained** (0 and −5 both accepted) | ✅ |
| `ingestedAssets` max 50; `pageClassifications` max 200 | ✅ |
| `homepageSelection.path` omissible (defaulted) | ✅ |
| `X-Worker-Id` free-form; `workerVersion` length-only 1–64 | ✅ |

**Omissions found and now added to §9a G2:**

1. `pages[].assets[].type` is an **unconstrained string**, not the four-value
   `sourceType` enum used at asset upload. The earlier example (`"type": "favicon"`)
   implied an enum. Verified: `type: "literally-anything"` is accepted.
2. The submission caps were only stated for assets. Now stated together:
   `recommendations` ≤ 200, `pageClassifications` ≤ 200, `ingestedAssets` ≤ 50,
   each `reason` ≤ 500 chars (501 rejected), and `navigationItem.order` ≥ 0
   (−1 rejected).

No claim in the exported sections contradicted the implementation.
