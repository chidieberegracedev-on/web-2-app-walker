import { createHash, createHmac } from "node:crypto";

/**
 * HMAC request signing, per WALKER_BEAGLE_INTEGRATION_CONTRACT.md §2.
 *
 * Canonical string — newline-joined, order fixed:
 *
 *   <METHOD>\n<PATH>\n<workerId>\n<timestamp>\n<nonce>\n<sha256(rawBody) hex>
 *
 * The signature is `sha256=` + HMAC-SHA256(SECRET, canonical) in lowercase hex.
 *
 * The one rule that matters most: the bytes hashed here MUST be the exact bytes
 * placed on the wire. Re-serialising the body between signing and sending (a
 * different key order, added whitespace) changes the digest and Beagle rejects
 * the signature. This module therefore only ever operates on a Buffer the caller
 * has already frozen; it never serialises anything itself. See buildSignedRequest
 * in ../client/auth-client.ts for how that single Buffer is threaded through.
 */

export const SIGNATURE_PREFIX = "sha256=" as const;

/** Lowercase hex SHA-256 of the exact bytes given. */
export function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Lowercase hex HMAC-SHA256 of `canonical` under `secret`. */
export function hmacSha256Hex(secret: string, canonical: string): string {
  return createHmac("sha256", secret).update(canonical, "utf8").digest("hex");
}

export interface CanonicalParts {
  /** HTTP method; upper-cased before signing, as the contract specifies. */
  readonly method: string;
  /** Request path only (no scheme/host, no query string on the worker endpoints). */
  readonly path: string;
  readonly workerId: string;
  /** Unix seconds, as a string — the same value sent in X-Worker-Timestamp. */
  readonly timestamp: string;
  readonly nonce: string;
  /** Lowercase hex SHA-256 of the raw request body (empty-string digest for no body). */
  readonly bodyDigestHex: string;
}

/** Build the exact newline-joined canonical string the contract defines. */
export function buildCanonicalString(parts: CanonicalParts): string {
  return [
    parts.method.toUpperCase(),
    parts.path,
    parts.workerId,
    parts.timestamp,
    parts.nonce,
    parts.bodyDigestHex,
  ].join("\n");
}

export interface SignParams extends Omit<CanonicalParts, "bodyDigestHex"> {
  readonly secret: string;
  /** The exact body bytes that will be sent. Hashed here; never re-serialised. */
  readonly rawBody: Buffer;
}

export interface SignResult {
  /** Value for the X-Worker-Signature header (`sha256=<hex>`). */
  readonly signature: string;
  /** The canonical string that was signed — returned for tests/diagnostics, never logged. */
  readonly canonical: string;
  /** Body digest that went into the canonical string. */
  readonly bodyDigestHex: string;
}

/**
 * Sign one request. Returns the header value plus the canonical string used
 * (exposed so a byte-identity test can prove the signed digest matches the sent
 * body). The secret is used here and nowhere else in the return value.
 */
export function signRequest(params: SignParams): SignResult {
  const bodyDigestHex = sha256Hex(params.rawBody);
  const canonical = buildCanonicalString({
    method: params.method,
    path: params.path,
    workerId: params.workerId,
    timestamp: params.timestamp,
    nonce: params.nonce,
    bodyDigestHex,
  });
  const signature = SIGNATURE_PREFIX + hmacSha256Hex(params.secret, canonical);
  return { signature, canonical, bodyDigestHex };
}
