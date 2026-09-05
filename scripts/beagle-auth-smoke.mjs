#!/usr/bin/env node
// @ts-nocheck
/**
 * Live authentication smoke test for the Walker ↔ Beagle worker contract.
 *
 * Runs the full §9 rejection matrix (the same 12 checks the contract records in
 * §10) against REAL, deployed Beagle over HTTPS, then a live claim + failure
 * round-trip on a provided fixture job. Exits non-zero on any failure.
 *
 * This is deliberately self-contained: it inlines its own HMAC signing with
 * node:crypto (no import of Walker's src/dist), so a green run proves an
 * independent implementation of the contract reaches deployed Beagle — not that
 * Walker agrees with itself.
 *
 *   BEAGLE_BASE_URL   (or BEAGLE_URL)   e.g. https://web-2-app-backend-api.vercel.app
 *   DISCOVERY_WORKER_SECRET             the real production secret
 *   JOB_ID                              a queued fixture job to claim (single-use!)
 *   WORKER_ID                           optional, defaults to walker-1
 *
 * IMPORTANT: the fixture job is single-use. This script claims it then fails it,
 * driving queued → running → failed (terminal). It cannot be re-run against the
 * same JOB_ID. All auth-matrix probes target a random NONEXISTENT job id so they
 * never consume the fixture.
 *
 * The environment must have egress to Beagle. Walker's own build/CI sandbox does
 * NOT — run this from a permitted environment (e.g. Codespaces).
 */

import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";

// --- environment ------------------------------------------------------------

const BASE = (process.env.BEAGLE_BASE_URL || process.env.BEAGLE_URL || "").replace(/\/+$/, "");
const SECRET = process.env.DISCOVERY_WORKER_SECRET || "";
const JOB_ID = process.env.JOB_ID || "";
const WORKER_ID = process.env.WORKER_ID || "walker-1";
const WORKER_VERSION = "walker-0.1.0";

// Refuse to run if a Supabase credential is present — the same boundary tripwire
// Walker's config guard enforces (rules #4, #7).
const supabaseVars = Object.keys(process.env).filter((k) => k.toUpperCase().includes("SUPABASE"));
if (supabaseVars.length > 0) {
  console.error(`Refusing to run: Supabase credential(s) present: ${supabaseVars.join(", ")}`);
  process.exit(2);
}
if (!BASE || !SECRET) {
  console.error("Missing BEAGLE_BASE_URL (or BEAGLE_URL) and/or DISCOVERY_WORKER_SECRET.");
  process.exit(2);
}

// --- signing (independent of Walker's src) ---------------------------------

const sha256hex = (buf) => createHash("sha256").update(buf).digest("hex");
const freshNonce = () => randomBytes(24).toString("base64url");

function sign(secret, method, path, workerId, ts, nonce, rawBody) {
  const digest = sha256hex(rawBody);
  const canonical = [method.toUpperCase(), path, workerId, ts, nonce, digest].join("\n");
  return "sha256=" + createHmac("sha256", secret).update(canonical, "utf8").digest("hex");
}

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

/**
 * Build headers + body for a signed request, with knobs for each tampering case.
 */
function build({
  secret = SECRET,
  bearer, // defaults to `Bearer ${secret}`
  method = "POST",
  path,
  signPath, // sign over a different path (path-binding test)
  workerId = WORKER_ID,
  ts = String(nowSec()),
  nonce = freshNonce(),
  bodyObj = {},
  signBodyObj, // sign over a different body (body-binding test)
  rawSignature, // force a signature value (malformed test)
  omitAuth = false,
  omitWorkerHeaders = false,
}) {
  const rawBody = Buffer.from(JSON.stringify(bodyObj), "utf8");
  const signBody =
    signBodyObj === undefined ? rawBody : Buffer.from(JSON.stringify(signBodyObj), "utf8");
  const headers = { "Content-Type": "application/json" };
  if (!omitAuth) headers["Authorization"] = bearer ?? `Bearer ${secret}`;
  if (!omitWorkerHeaders) {
    headers["X-Worker-Id"] = workerId;
    headers["X-Worker-Timestamp"] = ts;
    headers["X-Worker-Nonce"] = nonce;
    headers["X-Worker-Signature"] =
      rawSignature ?? sign(secret, method, signPath ?? path, workerId, ts, nonce, signBody);
  }
  return { headers, rawBody, method, url: BASE + path };
}

async function send(req) {
  const res = await fetch(req.url, {
    method: req.method,
    headers: req.headers,
    body: req.rawBody.length > 0 ? req.rawBody : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: res.status, json, text };
}

const codeOf = (r) => (r.json && r.json.error && r.json.error.code) || undefined;

// --- result accounting ------------------------------------------------------

let pass = 0;
let fail = 0;
let skip = 0;
const rows = [];

function record(name, outcome, detail) {
  rows.push({ name, outcome, detail });
  if (outcome === "PASS") pass++;
  else if (outcome === "SKIP") skip++;
  else fail++;
  const tag = outcome === "PASS" ? "✓ PASS" : outcome === "SKIP" ? "‒ SKIP" : "✗ FAIL";
  console.log(`${tag}  ${name}${detail ? `  — ${detail}` : ""}`);
}

/** Assert a specific HTTP status and (optionally) error code. */
function expectStatus(name, r, status, code) {
  const okStatus = r.status === status;
  const okCode = code === undefined || codeOf(r) === code;
  if (okStatus && okCode) {
    record(name, "PASS", `${r.status}${code ? ` ${code}` : ""}`);
  } else {
    record(name, "FAIL", `expected ${status}${code ? ` ${code}` : ""}, got ${r.status} ${codeOf(r) ?? ""}`.trim());
  }
}

// --- the run ----------------------------------------------------------------

async function main() {
  console.log(`Beagle auth smoke → ${BASE}`);
  console.log(`worker id: ${WORKER_ID}   fixture job: ${JOB_ID || "(none provided)"}\n`);

  // A random job id that does not exist — auth-matrix probes target this so the
  // single-use fixture is never consumed by an auth check.
  const ghost = randomUUID();
  const claimPath = (id) => `/api/worker/jobs/${encodeURIComponent(id)}/claim`;
  const failPath = (id) => `/api/worker/jobs/${encodeURIComponent(id)}/failure`;
  const P = claimPath(ghost);
  const pathname = new URL(BASE + P).pathname;

  // 1. unsigned
  expectStatus("1. unsigned", await send(build({ path: P, omitAuth: true, omitWorkerHeaders: true })), 401, "UNAUTHORIZED");

  // 2. bearer without signature
  expectStatus("2. bearer without signature", await send(build({ path: P, omitWorkerHeaders: true })), 401, "UNAUTHORIZED");

  // 3. wrong bearer (valid signature under real secret, wrong bearer token)
  {
    const ts = String(nowSec());
    const nonce = freshNonce();
    const sig = sign(SECRET, "POST", pathname, WORKER_ID, ts, nonce, Buffer.from("{}"));
    const r = await send({
      url: BASE + P,
      method: "POST",
      rawBody: Buffer.from("{}"),
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer definitely-not-the-secret",
        "X-Worker-Id": WORKER_ID,
        "X-Worker-Timestamp": ts,
        "X-Worker-Nonce": nonce,
        "X-Worker-Signature": sig,
      },
    });
    expectStatus("3. wrong bearer", r, 403, "FORBIDDEN");
  }

  // 4. wrong-secret signature (correct bearer, signature under a wrong secret)
  {
    const ts = String(nowSec());
    const nonce = freshNonce();
    const sig = sign("the-wrong-secret", "POST", pathname, WORKER_ID, ts, nonce, Buffer.from("{}"));
    const r = await send({
      url: BASE + P,
      method: "POST",
      rawBody: Buffer.from("{}"),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SECRET}`,
        "X-Worker-Id": WORKER_ID,
        "X-Worker-Timestamp": ts,
        "X-Worker-Nonce": nonce,
        "X-Worker-Signature": sig,
      },
    });
    expectStatus("4. wrong-secret signature", r, 403, "FORBIDDEN");
  }

  // 5. malformed signature
  expectStatus("5. malformed signature", await send(build({ path: P, rawSignature: "sha256=not-hex" })), 403, "FORBIDDEN");

  // 6. stale timestamp
  expectStatus("6. stale timestamp", await send(build({ path: P, ts: String(nowSec() - 3600) })), 401, "WORKER_REQUEST_STALE");

  // 7. future timestamp
  expectStatus("7. future timestamp", await send(build({ path: P, ts: String(nowSec() + 3600) })), 401, "WORKER_REQUEST_STALE");

  // 8. short nonce
  expectStatus("8. short nonce", await send(build({ path: P, nonce: "short" })), 403, "FORBIDDEN");

  // 9. path-bound signature (signed for a different path)
  expectStatus("9. path-bound signature", await send(build({ path: P, signPath: "/api/worker/jobs/OTHER/claim" })), 403, "FORBIDDEN");

  // 10. body-bound signature (signed for a different body)
  expectStatus("10. body-bound signature", await send(build({ path: P, bodyObj: { a: 1 }, signBodyObj: { a: 2 } })), 403, "FORBIDDEN");

  // 11. nonce replay — SKIP if the nonce store is unreachable (503 on first leg).
  {
    const sharedReq = build({ path: P, nonce: freshNonce(), bodyObj: { jobId: ghost, workerVersion: WORKER_VERSION } });
    const first = await send(sharedReq);
    if (first.status === 503 && codeOf(first) === "WORKER_NONCE_STORE_UNAVAILABLE") {
      record("11. nonce replay", "SKIP", "nonce store unreachable (503) — replay defence unverifiable");
    } else if (first.status === 401 || first.status === 403) {
      record("11. nonce replay", "FAIL", `first (valid) request was auth-rejected: ${first.status} ${codeOf(first) ?? ""}`.trim());
    } else {
      const second = await send(sharedReq); // identical bytes, same nonce
      expectStatus("11. nonce replay", second, 409, "WORKER_REQUEST_REPLAYED");
    }
  }

  // 12. valid signed request passes auth (reaches app/db, not 401/403).
  {
    const r = await send(build({ path: P, bodyObj: { jobId: ghost, workerVersion: WORKER_VERSION } }));
    if (r.status === 401 || r.status === 403) {
      record("12. valid request reaches app", "FAIL", `valid request was auth-rejected: ${r.status} ${codeOf(r) ?? ""}`.trim());
    } else {
      record("12. valid request reaches app", "PASS", `${r.status} ${codeOf(r) ?? "(past auth)"}`.trim());
    }
  }

  // --- live round-trip on the single-use fixture ----------------------------
  if (!JOB_ID) {
    record("13. claim fixture", "SKIP", "no JOB_ID provided");
    record("14. fail fixture", "SKIP", "no JOB_ID provided");
  } else {
    // 13. claim
    const claimBody = { jobId: JOB_ID, workerVersion: WORKER_VERSION };
    const claim = await send(build({ path: claimPath(JOB_ID), bodyObj: claimBody }));
    const ctx = claim.json && claim.json.data;
    const limitsOk =
      ctx &&
      ctx.status === "running" &&
      ctx.limits &&
      typeof ctx.limits.maxPages === "number" &&
      typeof ctx.limits.pageTimeoutMs === "number" &&
      typeof ctx.limits.totalTimeoutMs === "number";
    if (claim.status === 200 && limitsOk) {
      record("13. claim fixture", "PASS", `running; limits ${JSON.stringify(ctx.limits)}`);
    } else {
      record("13. claim fixture", "FAIL", `expected 200 running+limits, got ${claim.status} ${codeOf(claim) ?? ""} ${claim.text.slice(0, 160)}`.trim());
    }

    // 14. fail — only if the claim succeeded (never fail a job we didn't claim).
    if (claim.status === 200 && limitsOk) {
      const fail1 = await send(
        build({
          path: failPath(JOB_ID),
          bodyObj: {
            jobId: JOB_ID,
            workerVersion: WORKER_VERSION,
            failureCategory: "unreachableSite",
            message: "Smoke test: controlled failure to verify the worker failure path.",
          },
        }),
      );
      if (fail1.status >= 200 && fail1.status < 300) {
        record("14. fail fixture", "PASS", `${fail1.status} accepted (job → failed)`);
      } else {
        record("14. fail fixture", "FAIL", `expected 2xx, got ${fail1.status} ${codeOf(fail1) ?? ""} ${fail1.text.slice(0, 160)}`.trim());
      }
    } else {
      record("14. fail fixture", "SKIP", "claim did not succeed; not reporting failure on an unclaimed job");
    }
  }

  // --- summary --------------------------------------------------------------
  console.log(`\nSummary: ${pass} passed, ${fail} failed, ${skip} skipped.`);
  if (skip > 0) {
    console.log("Note: a SKIP on the replay check means replay protection could not be verified.");
  }
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("\nSmoke run crashed before completing:", err?.message ?? err);
  process.exit(3);
});
