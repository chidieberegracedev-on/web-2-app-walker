import { describe, expect, it } from "vitest";
import { createHash, createHmac } from "node:crypto";
import { AuthClient, type FetchLike } from "../src/client/auth-client.js";
import type { WalkerConfig } from "../src/config.js";

/**
 * Byte-identity: the bytes hashed into the signature MUST be the exact bytes put
 * on the wire (contract §2 — "sign the exact bytes sent"). These tests recompute
 * the signature from the captured/returned body using node:crypto directly and
 * confirm it equals the X-Worker-Signature header, so any re-serialisation
 * between signing and sending would fail them.
 */

const config: WalkerConfig = {
  workerSecret: "byte-identity-secret",
  beagleBaseUrl: "https://beagle.example",
  workerId: "walker-1",
};

/** Independent re-derivation of the signature from raw bytes + headers. */
function recomputeSignature(
  secret: string,
  method: string,
  path: string,
  headers: Record<string, string>,
  rawBody: Buffer,
): string {
  const digest = createHash("sha256").update(rawBody).digest("hex");
  const canonical = [
    method.toUpperCase(),
    path,
    headers["X-Worker-Id"],
    headers["X-Worker-Timestamp"],
    headers["X-Worker-Nonce"],
    digest,
  ].join("\n");
  return "sha256=" + createHmac("sha256", secret).update(canonical, "utf8").digest("hex");
}

describe("byte identity — buildSignedRequest", () => {
  it("signs over exactly the rawBody it returns", () => {
    const client = new AuthClient({ config });
    const req = client.buildSignedRequest("POST", "/api/worker/jobs/j1/claim", {
      jobId: "j1",
      workerVersion: "walker-0.1.0",
    });

    const recomputed = recomputeSignature(
      config.workerSecret,
      "POST",
      "/api/worker/jobs/j1/claim",
      req.headers,
      req.rawBody,
    );
    expect(req.headers["X-Worker-Signature"]).toBe(recomputed);
  });

  it("uses the empty-string digest for a bodiless request", () => {
    const client = new AuthClient({ config });
    const req = client.buildSignedRequest("POST", "/api/worker/jobs/j1/claim");
    expect(req.rawBody).toHaveLength(0);
    const recomputed = recomputeSignature(
      config.workerSecret,
      "POST",
      "/api/worker/jobs/j1/claim",
      req.headers,
      Buffer.alloc(0),
    );
    expect(req.headers["X-Worker-Signature"]).toBe(recomputed);
  });
});

describe("byte identity — execute() sends the signed bytes", () => {
  it("the body handed to fetch reproduces the signature header", async () => {
    let capturedBody: Buffer | undefined;
    let capturedHeaders: Record<string, string> | undefined;

    const capturingFetch: FetchLike = async (_url, init) => {
      capturedBody = init.body ?? Buffer.alloc(0);
      capturedHeaders = init.headers;
      return { status: 200, text: async () => JSON.stringify({ data: { ok: true } }) };
    };

    const client = new AuthClient({ config, fetchImpl: capturingFetch });
    await client.execute("POST", "/api/worker/jobs/j9/claim", {
      jobId: "j9",
      workerVersion: "walker-0.1.0",
    });

    expect(capturedBody).toBeInstanceOf(Buffer);
    expect(capturedHeaders).toBeDefined();

    // The exact bytes fetch received, re-signed, must equal what was sent.
    const recomputed = recomputeSignature(
      config.workerSecret,
      "POST",
      "/api/worker/jobs/j9/claim",
      capturedHeaders!,
      capturedBody!,
    );
    expect(capturedHeaders!["X-Worker-Signature"]).toBe(recomputed);

    // And the body is the literal JSON we serialised once — not re-ordered/re-spaced.
    expect(capturedBody!.toString("utf8")).toBe(
      JSON.stringify({ jobId: "j9", workerVersion: "walker-0.1.0" }),
    );
  });

  it("generates a fresh nonce on every send", () => {
    const client = new AuthClient({ config });
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const req = client.buildSignedRequest("POST", "/api/worker/jobs/j/claim", { n: i });
      const nonce = req.headers["X-Worker-Nonce"]!;
      expect(nonce).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
      expect(seen.has(nonce)).toBe(false);
      seen.add(nonce);
    }
  });

  it("never places the secret in any header except the bearer token", () => {
    const client = new AuthClient({ config });
    const req = client.buildSignedRequest("POST", "/api/worker/jobs/j/claim", { a: 1 });
    expect(req.headers["Authorization"]).toBe(`Bearer ${config.workerSecret}`);
    // The signature must not be the raw secret, and the secret must not leak into
    // the signature/nonce/timestamp headers.
    for (const key of ["X-Worker-Signature", "X-Worker-Nonce", "X-Worker-Timestamp"]) {
      expect(req.headers[key]).not.toContain(config.workerSecret);
    }
  });
});
