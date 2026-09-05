import { randomBytes } from "node:crypto";

/**
 * Single-use request nonce, per contract §2: 16–64 chars, charset [A-Za-z0-9_-].
 *
 * 24 random bytes encode to exactly 32 base64url characters with no padding
 * (24 is divisible by 3), which sits comfortably inside the length window and
 * uses only the permitted alphabet. base64url ("base64url" encoding) emits `-`
 * and `_` instead of `+` and `/` and omits `=`, so no post-processing is needed.
 *
 * Uniqueness is the caller's contract to keep: generate a fresh nonce for every
 * request, and — critically — a *new* one on every retry (a replay of a used
 * nonce is refused with 409, contract §9). This function never returns the same
 * value twice in practice (192 bits of entropy); it does not itself track usage.
 */
export function generateNonce(): string {
  return randomBytes(24).toString("base64url");
}

/** Contract §2 nonce shape, used by tests and defensive checks. */
export const NONCE_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;
