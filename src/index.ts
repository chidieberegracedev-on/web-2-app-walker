/**
 * Walker — Discovery Worker public surface (W1).
 *
 * W1 scope is authenticated contact with deployed Beagle: config guard, HMAC
 * signing, and the claim/failure job-lifecycle calls. No crawling, AI, assets,
 * result submission, or job-acquisition loop yet — those are W2+.
 */
export { loadConfig, ConfigError, type WalkerConfig } from "./config.js";
export {
  signRequest,
  buildCanonicalString,
  sha256Hex,
  hmacSha256Hex,
  SIGNATURE_PREFIX,
  type CanonicalParts,
  type SignParams,
  type SignResult,
} from "./crypto/signing.js";
export { generateNonce, NONCE_PATTERN } from "./crypto/nonce.js";
export { AuthClient, type AuthClientOptions, type FetchLike, type SignedRequest } from "./client/auth-client.js";
export { JobClient, assertUserFacingMessage } from "./client/job-client.js";
export * from "./client/errors.js";
export {
  WORKER_VERSION,
  FAILURE_CATEGORIES,
  jobContextSchema,
  jobLimitsSchema,
  failureCategorySchema,
  type JobContext,
  type JobLimits,
  type FailureCategory,
} from "./types.js";
