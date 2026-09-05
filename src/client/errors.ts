/**
 * Typed error model for the Beagle worker API (contract §9).
 *
 * The contract's error envelope is `{ error: { message, code } }`. Each machine
 * code maps to a fixed HTTP status and — for Walker — a fixed *disposition*:
 * whether the situation is retryable, terminal-but-safe-to-stop, a fail-closed
 * auth rejection, or a Beagle misconfiguration. That disposition is encoded on
 * the error class so the client's retry loop reads as a single switch and the
 * policy lives in exactly one place.
 *
 * Retry posture (contract §9, as directed for W1):
 *   - JOB_NOT_CLAIMABLE / JOB_NOT_RUNNING (409) → stop, never retry.
 *   - WORKER_NONCE_STORE_UNAVAILABLE (503)      → bounded retry with a fresh nonce.
 *   - WORKER_REQUEST_STALE (401)                → re-read the clock, one retry.
 *   - UNAUTHORIZED (401) / FORBIDDEN (403)      → fail closed, no retry, no probing.
 *   - WORKER_AUTH_NOT_CONFIGURED (500)          → surface as a Beagle misconfig.
 */

export type WorkerErrorCode =
  | "UNAUTHORIZED"
  | "WORKER_REQUEST_STALE"
  | "FORBIDDEN"
  | "WORKER_REQUEST_REPLAYED"
  | "JOB_NOT_CLAIMABLE"
  | "JOB_NOT_RUNNING"
  | "WORKER_AUTH_NOT_CONFIGURED"
  | "WORKER_NONCE_STORE_UNAVAILABLE";

/** How the client should treat an error when it occurs. */
export type ErrorDisposition =
  | "retry-fresh-nonce" // transient; try again with a new nonce (bounded)
  | "retry-after-reclock" // clock skew; re-read time and try once more
  | "stop-safe" // illegal job transition; stop cleanly, nothing to retry
  | "fail-closed" // auth rejection; do not retry, do not probe
  | "beagle-misconfigured" // server-side config fault; not a client error
  | "unexpected"; // anything the contract doesn't enumerate

/** Base class for every error surfaced by the worker client. */
export class WorkerClientError extends Error {
  public readonly disposition: ErrorDisposition;
  public readonly httpStatus: number | undefined;
  public readonly code: string | undefined;

  public constructor(
    message: string,
    opts: {
      disposition: ErrorDisposition;
      httpStatus?: number | undefined;
      code?: string | undefined;
      cause?: unknown;
    },
  ) {
    super(message, opts.cause === undefined ? undefined : { cause: opts.cause });
    this.name = new.target.name;
    this.disposition = opts.disposition;
    this.httpStatus = opts.httpStatus;
    this.code = opts.code;
  }
}

/** Illegal job transition (409 JOB_NOT_CLAIMABLE / JOB_NOT_RUNNING). Safe to stop. */
export class JobTransitionError extends WorkerClientError {
  public constructor(code: "JOB_NOT_CLAIMABLE" | "JOB_NOT_RUNNING", message: string) {
    super(message, { disposition: "stop-safe", httpStatus: 409, code });
  }
}

/** Nonce already used (409). Indicates a reused nonce; not blindly retried. */
export class RequestReplayedError extends WorkerClientError {
  public constructor(message: string) {
    super(message, {
      disposition: "unexpected",
      httpStatus: 409,
      code: "WORKER_REQUEST_REPLAYED",
    });
  }
}

/** Timestamp outside ±300 s (401 WORKER_REQUEST_STALE). Re-clock and retry once. */
export class RequestStaleError extends WorkerClientError {
  public constructor(message: string) {
    super(message, {
      disposition: "retry-after-reclock",
      httpStatus: 401,
      code: "WORKER_REQUEST_STALE",
    });
  }
}

/** Missing/malformed credentials (401) or bad token/signature (403). Fail closed. */
export class AuthRejectedError extends WorkerClientError {
  public constructor(code: "UNAUTHORIZED" | "FORBIDDEN", httpStatus: number, message: string) {
    super(message, { disposition: "fail-closed", httpStatus, code });
  }
}

/** Replay-protection store down (503). Bounded retry with a fresh nonce. */
export class NonceStoreUnavailableError extends WorkerClientError {
  public constructor(message: string) {
    super(message, {
      disposition: "retry-fresh-nonce",
      httpStatus: 503,
      code: "WORKER_NONCE_STORE_UNAVAILABLE",
    });
  }
}

/** Beagle's worker auth is unconfigured (500). Server fault, not a client error. */
export class BeagleMisconfiguredError extends WorkerClientError {
  public constructor(message: string) {
    super(message, {
      disposition: "beagle-misconfigured",
      httpStatus: 500,
      code: "WORKER_AUTH_NOT_CONFIGURED",
    });
  }
}

/** A response the contract does not enumerate (unexpected status, non-JSON body, etc.). */
export class UnexpectedResponseError extends WorkerClientError {
  public constructor(
    message: string,
    opts: { httpStatus?: number | undefined; code?: string | undefined } = {},
  ) {
    super(message, { disposition: "unexpected", httpStatus: opts.httpStatus, code: opts.code });
  }
}

/** The request never produced an HTTP response (DNS, TCP, TLS, socket). */
export class TransportError extends WorkerClientError {
  public constructor(message: string, cause: unknown) {
    super(message, { disposition: "unexpected", cause });
  }
}

/**
 * Map a parsed error envelope to a typed error. `code` and `message` come from
 * Beagle's `{ error: { code, message } }`; `httpStatus` is the response status.
 */
export function classifyErrorResponse(
  httpStatus: number,
  code: string | undefined,
  message: string,
): WorkerClientError {
  switch (code) {
    case "JOB_NOT_CLAIMABLE":
    case "JOB_NOT_RUNNING":
      return new JobTransitionError(code, message);
    case "WORKER_REQUEST_REPLAYED":
      return new RequestReplayedError(message);
    case "WORKER_REQUEST_STALE":
      return new RequestStaleError(message);
    case "UNAUTHORIZED":
      return new AuthRejectedError("UNAUTHORIZED", httpStatus, message);
    case "FORBIDDEN":
      return new AuthRejectedError("FORBIDDEN", httpStatus, message);
    case "WORKER_NONCE_STORE_UNAVAILABLE":
      return new NonceStoreUnavailableError(message);
    case "WORKER_AUTH_NOT_CONFIGURED":
      return new BeagleMisconfiguredError(message);
    default:
      return new UnexpectedResponseError(
        `Unexpected worker API error (status ${httpStatus}${code ? `, code ${code}` : ""}): ${message}`,
        { httpStatus, code },
      );
  }
}
