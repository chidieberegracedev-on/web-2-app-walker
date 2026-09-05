import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash, createHmac } from "node:crypto";
import {
  startConformanceServer,
  type RunningConformanceServer,
} from "./helpers/conformance-server.js";
import { JobClient } from "../src/client/job-client.js";
import type { WalkerConfig } from "../src/config.js";

/**
 * The full §9 rejection matrix, enforced by an independent verifier (the
 * conformance server), plus a happy-path claim proving Walker's real signed
 * request is accepted by that verifier. Tampered requests are crafted here with
 * node:crypto directly — independent of the client on both ends.
 *
 * This mirrors the 12 checks the live smoke runs against real Beagle.
 */

const SECRET = "conformance-secret";
let srv: RunningConformanceServer;

beforeAll(async () => {
  srv = await startConformanceServer({ secret: SECRET });
});
afterAll(async () => {
  await srv.close();
});

function config(): WalkerConfig {
  return { workerSecret: SECRET, beagleBaseUrl: srv.baseUrl, workerId: "walker-1" };
}

// --- independent request crafting (no src/ code) --------------------------

interface CraftParams {
  secret?: string;
  method?: string;
  path: string;
  workerId?: string;
  timestamp?: string;
  nonce?: string;
  body?: string;
  /** Sign over this path/body instead of the sent one (path/body binding tests). */
  signPath?: string;
  signBody?: string;
  /** Force a specific signature header value (malformed-signature test). */
  rawSignature?: string;
  /** Omit signature-related headers entirely (unsigned / bearer-only tests). */
  omitWorkerHeaders?: boolean;
  omitAuthorization?: boolean;
}

function computeSig(
  secret: string,
  method: string,
  path: string,
  workerId: string,
  timestamp: string,
  nonce: string,
  body: string,
): string {
  const digest = createHash("sha256").update(Buffer.from(body, "utf8")).digest("hex");
  const canonical = [method.toUpperCase(), path, workerId, timestamp, nonce, digest].join("\n");
  return "sha256=" + createHmac("sha256", secret).update(canonical, "utf8").digest("hex");
}

async function craft(p: CraftParams): Promise<{ status: number; json: unknown }> {
  const secret = p.secret ?? SECRET;
  const method = p.method ?? "POST";
  const workerId = p.workerId ?? "walker-1";
  const timestamp = p.timestamp ?? Math.floor(Date.now() / 1000).toString();
  const nonce = p.nonce ?? "nonce_" + "x".repeat(20);
  const body = p.body ?? "{}";

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (!p.omitAuthorization) headers["Authorization"] = `Bearer ${secret}`;
  if (!p.omitWorkerHeaders) {
    headers["X-Worker-Id"] = workerId;
    headers["X-Worker-Timestamp"] = timestamp;
    headers["X-Worker-Nonce"] = nonce;
    headers["X-Worker-Signature"] =
      p.rawSignature ??
      computeSig(secret, method, p.signPath ?? p.path, workerId, timestamp, nonce, p.signBody ?? body);
  }

  const res = await fetch(srv.baseUrl + p.path, { method, headers, body });
  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, json };
}

function code(json: unknown): string | undefined {
  if (json && typeof json === "object" && "error" in json) {
    const e = (json as { error?: { code?: unknown } }).error;
    if (e && typeof e.code === "string") return e.code;
  }
  return undefined;
}

// --- happy path: real client against the independent verifier ---------------

describe("happy path", () => {
  it("a real signed claim is accepted and returns a contract §4 JobContext", async () => {
    const jobs = JobClient.create({ config: config() });
    const ctx = await jobs.claim("job-happy-1");
    expect(ctx.status).toBe("running");
    expect(ctx.jobId).toBe("job-happy-1");
    expect(ctx.claimedBy).toBe("walker-1");
    expect(ctx.limits).toEqual({
      maxPages: 40,
      maxDepth: 3,
      pageTimeoutMs: 15000,
      totalTimeoutMs: 300000,
    });
  });

  it("a real signed failure is accepted", async () => {
    const jobs = JobClient.create({ config: config() });
    const data = (await jobs.reportFailure(
      "job-happy-2",
      "unreachableSite",
      "We couldn't reach that website.",
    )) as { jobId?: string; status?: string };
    expect(data.status).toBe("failed");
  });
});

// --- the 12-case §9 rejection matrix ---------------------------------------

describe("§9 rejection matrix (independent verifier)", () => {
  const P = "/api/worker/jobs/matrix/claim";

  it("1. unsigned → 401 UNAUTHORIZED", async () => {
    const r = await craft({ path: P, omitWorkerHeaders: true, omitAuthorization: true });
    expect(r.status).toBe(401);
    expect(code(r.json)).toBe("UNAUTHORIZED");
  });

  it("2. bearer without signature → 401 UNAUTHORIZED", async () => {
    const r = await craft({ path: P, omitWorkerHeaders: true });
    expect(r.status).toBe(401);
    expect(code(r.json)).toBe("UNAUTHORIZED");
  });

  it("3. wrong bearer → 403 FORBIDDEN", async () => {
    // Correct signature under the real secret, but a wrong bearer token.
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonce = "nonce_wrongbearer_0001";
    const sig = computeSig(SECRET, "POST", P, "walker-1", timestamp, nonce, "{}");
    const res = await fetch(srv.baseUrl + P, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer not-the-secret",
        "X-Worker-Id": "walker-1",
        "X-Worker-Timestamp": timestamp,
        "X-Worker-Nonce": nonce,
        "X-Worker-Signature": sig,
      },
      body: "{}",
    });
    expect(res.status).toBe(403);
    expect(code(await res.json())).toBe("FORBIDDEN");
  });

  it("4. wrong-secret signature → 403 FORBIDDEN", async () => {
    const r = await craft({ path: P, secret: "the-wrong-secret", nonce: "nonce_wrongsecret_01" });
    // craft() puts the wrong secret in BOTH bearer and signature; bearer check
    // fires first — still 403, which is the point (403 is indistinguishable).
    expect(r.status).toBe(403);
    expect(code(r.json)).toBe("FORBIDDEN");
  });

  it("5. malformed signature → 403 FORBIDDEN", async () => {
    const r = await craft({ path: P, rawSignature: "sha256=not-hex", nonce: "nonce_malformed_001x" });
    expect(r.status).toBe(403);
    expect(code(r.json)).toBe("FORBIDDEN");
  });

  it("6. stale timestamp → 401 WORKER_REQUEST_STALE", async () => {
    const stale = (Math.floor(Date.now() / 1000) - 3600).toString();
    const r = await craft({ path: P, timestamp: stale, nonce: "nonce_stale_000000001" });
    expect(r.status).toBe(401);
    expect(code(r.json)).toBe("WORKER_REQUEST_STALE");
  });

  it("7. future timestamp → 401 WORKER_REQUEST_STALE", async () => {
    const future = (Math.floor(Date.now() / 1000) + 3600).toString();
    const r = await craft({ path: P, timestamp: future, nonce: "nonce_future_00000001" });
    expect(r.status).toBe(401);
    expect(code(r.json)).toBe("WORKER_REQUEST_STALE");
  });

  it("8. short nonce → 403 FORBIDDEN", async () => {
    const r = await craft({ path: P, nonce: "short" });
    expect(r.status).toBe(403);
    expect(code(r.json)).toBe("FORBIDDEN");
  });

  it("9. path-bound signature (valid for another path) → 403 FORBIDDEN", async () => {
    const r = await craft({
      path: P,
      signPath: "/api/worker/jobs/OTHER/claim",
      nonce: "nonce_pathbound_0001",
    });
    expect(r.status).toBe(403);
    expect(code(r.json)).toBe("FORBIDDEN");
  });

  it("10. body-bound signature (valid for another body) → 403 FORBIDDEN", async () => {
    const r = await craft({
      path: P,
      body: '{"jobId":"matrix"}',
      signBody: '{"jobId":"tampered"}',
      nonce: "nonce_bodybound_0001",
    });
    expect(r.status).toBe(403);
    expect(code(r.json)).toBe("FORBIDDEN");
  });

  it("11. nonce replay → 200 then 409 WORKER_REQUEST_REPLAYED", async () => {
    const shared = "nonce_replay_00000001";
    const first = await craft({ path: P, nonce: shared });
    expect(first.status).toBe(200);
    const second = await craft({ path: P, nonce: shared });
    expect(second.status).toBe(409);
    expect(code(second.json)).toBe("WORKER_REQUEST_REPLAYED");
  });

  it("12. valid signed claim → 200 running", async () => {
    const r = await craft({ path: P, nonce: "nonce_valid_000000001" });
    expect(r.status).toBe(200);
    expect((r.json as { data: { status: string } }).data.status).toBe("running");
  });
});
