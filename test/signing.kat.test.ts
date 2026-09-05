import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { signRequest, sha256Hex } from "../src/crypto/signing.js";

/**
 * Known-answer tests for the HMAC signature (contract §2).
 *
 * The expected digests and signatures in fixtures/signing-vectors.json were
 * produced by a SEPARATE implementation (Python's hashlib/hmac), so a pass here
 * means Walker's signer agrees with an independent reference — not merely with
 * itself. To regenerate, run the Python recipe recorded in the repo history for
 * these vectors; the empty-body vector's digest is the canonical SHA-256 of "".
 */

interface Vector {
  name: string;
  secret: string;
  method: string;
  path: string;
  workerId: string;
  timestamp: string;
  nonce: string;
  body: string;
  expectedBodyDigestHex: string;
  expectedSignature: string;
}

const fixturePath = fileURLToPath(new URL("./fixtures/signing-vectors.json", import.meta.url));
const { vectors } = JSON.parse(readFileSync(fixturePath, "utf8")) as { vectors: Vector[] };

describe("signRequest known-answer vectors", () => {
  it("loads a non-empty vector set", () => {
    expect(vectors.length).toBeGreaterThanOrEqual(3);
  });

  for (const v of vectors) {
    it(`matches the independent reference: ${v.name}`, () => {
      const rawBody = Buffer.from(v.body, "utf8");
      const result = signRequest({
        secret: v.secret,
        method: v.method,
        path: v.path,
        workerId: v.workerId,
        timestamp: v.timestamp,
        nonce: v.nonce,
        rawBody,
      });
      expect(result.bodyDigestHex).toBe(v.expectedBodyDigestHex);
      expect(result.signature).toBe(v.expectedSignature);
    });
  }

  it("empty body hashes to the canonical SHA-256 of the empty string", () => {
    expect(sha256Hex(Buffer.alloc(0))).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("the canonical string is exactly the six newline-joined fields", () => {
    const v = vectors[0]!;
    const result = signRequest({
      secret: v.secret,
      method: v.method,
      path: v.path,
      workerId: v.workerId,
      timestamp: v.timestamp,
      nonce: v.nonce,
      rawBody: Buffer.from(v.body, "utf8"),
    });
    expect(result.canonical).toBe(
      [v.method, v.path, v.workerId, v.timestamp, v.nonce, v.expectedBodyDigestHex].join("\n"),
    );
    expect(result.canonical.split("\n")).toHaveLength(6);
  });
});
