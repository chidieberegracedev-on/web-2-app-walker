import { generateNonce } from "../crypto/nonce.js";
import { signRequest } from "../crypto/signing.js";
import type { WalkerConfig } from "../config.js";
import {
  TransportError,
  UnexpectedResponseError,
  classifyErrorResponse,
  type WorkerClientError,
} from "./errors.js";

/**
 * Signed transport for the Beagle worker API (contract §2, §9).
 *
 * Two responsibilities, kept separate:
 *  1. buildSignedRequest — freeze the body to a single Buffer, hash THAT buffer,
 *     sign, and return the exact bytes + headers to send. Nothing downstream
 *     re-serialises the body, so the signed digest always matches the wire bytes.
 *  2. execute — send a signed request and apply the §9 retry posture, generating
 *     a fresh nonce and timestamp on every attempt (so a retry never replays a
 *     nonce, and a re-clock is inherent in each attempt).
 */

/** Injectable fetch, so tests can point at a loopback server or a mock. */
export type FetchLike = (
  input: string,
  init: { method: string; headers: Record<string, string>; body?: Buffer },
) => Promise<{
  status: number;
  text: () => Promise<string>;
}>;

export interface AuthClientOptions {
  readonly config: WalkerConfig;
  readonly fetchImpl?: FetchLike;
  /** Clock, injectable for deterministic tests. Returns ms since epoch. */
  readonly now?: () => number;
  /** Base backoff before a nonce-store retry (ms). Small by default; 0 in tests. */
  readonly retryBackoffMs?: number;
  /** Max retries after WORKER_NONCE_STORE_UNAVAILABLE (bounded). */
  readonly maxNonceStoreRetries?: number;
  /** Max retries after WORKER_REQUEST_STALE (contract: one). */
  readonly maxStaleRetries?: number;
}

export interface SignedRequest {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  /** The exact body bytes to send. Empty Buffer for a bodiless request. */
  readonly rawBody: Buffer;
}

const DEFAULT_BACKOFF_MS = 200;
const DEFAULT_NONCE_STORE_RETRIES = 2;
const DEFAULT_STALE_RETRIES = 1;

const sleep = (ms: number): Promise<void> =>
  ms <= 0 ? Promise.resolve() : new Promise((r) => setTimeout(r, ms));

export class AuthClient {
  private readonly config: WalkerConfig;
  private readonly fetchImpl: FetchLike;
  private readonly now: () => number;
  private readonly retryBackoffMs: number;
  private readonly maxNonceStoreRetries: number;
  private readonly maxStaleRetries: number;

  public constructor(opts: AuthClientOptions) {
    this.config = opts.config;
    this.fetchImpl = opts.fetchImpl ?? defaultFetch;
    this.now = opts.now ?? Date.now;
    this.retryBackoffMs = opts.retryBackoffMs ?? DEFAULT_BACKOFF_MS;
    this.maxNonceStoreRetries = opts.maxNonceStoreRetries ?? DEFAULT_NONCE_STORE_RETRIES;
    this.maxStaleRetries = opts.maxStaleRetries ?? DEFAULT_STALE_RETRIES;
  }

  /**
   * Build a fully-signed request. The body (if any) is serialised exactly once,
   * here, and the resulting Buffer is both hashed for the signature and returned
   * as `rawBody` for sending — they are the same bytes by construction.
   */
  public buildSignedRequest(method: string, path: string, body?: unknown): SignedRequest {
    const rawBody =
      body === undefined ? Buffer.alloc(0) : Buffer.from(JSON.stringify(body), "utf8");

    const url = this.config.beagleBaseUrl + path;
    const pathname = new URL(url).pathname;
    const timestamp = Math.floor(this.now() / 1000).toString();
    const nonce = generateNonce();

    const { signature } = signRequest({
      secret: this.config.workerSecret,
      method,
      path: pathname,
      workerId: this.config.workerId,
      timestamp,
      nonce,
      rawBody,
    });

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.config.workerSecret}`,
      "X-Worker-Id": this.config.workerId,
      "X-Worker-Timestamp": timestamp,
      "X-Worker-Nonce": nonce,
      "X-Worker-Signature": signature,
    };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    return { url, method, headers, rawBody };
  }

  /**
   * Send one signed request and return the parsed `data` envelope on success.
   * Applies the §9 retry posture; throws a typed WorkerClientError otherwise.
   */
  public async execute<T>(method: string, path: string, body?: unknown): Promise<T> {
    let staleRetriesLeft = this.maxStaleRetries;
    let nonceStoreRetriesLeft = this.maxNonceStoreRetries;

    for (;;) {
      const req = this.buildSignedRequest(method, path, body);

      let status: number;
      let text: string;
      try {
        const res = await this.fetchImpl(req.url, {
          method: req.method,
          headers: req.headers,
          ...(req.rawBody.length > 0 ? { body: req.rawBody } : {}),
        });
        status = res.status;
        text = await res.text();
      } catch (cause) {
        // No HTTP response at all — surfaced, not auto-retried (contract §9 does
        // not define a transport-retry posture, and W1 stays within it).
        throw new TransportError(
          `Request to ${redactPath(req.url)} failed before a response was received.`,
          cause,
        );
      }

      if (status >= 200 && status < 300) {
        return parseDataEnvelope<T>(status, text);
      }

      const err = toTypedError(status, text);
      switch (err.disposition) {
        case "retry-after-reclock":
          if (staleRetriesLeft > 0) {
            staleRetriesLeft -= 1;
            continue; // next attempt re-reads the clock and mints a fresh nonce
          }
          throw err;
        case "retry-fresh-nonce":
          if (nonceStoreRetriesLeft > 0) {
            const attempt = this.maxNonceStoreRetries - nonceStoreRetriesLeft + 1;
            nonceStoreRetriesLeft -= 1;
            await sleep(this.retryBackoffMs * attempt);
            continue; // next attempt mints a fresh nonce
          }
          throw err;
        default:
          throw err;
      }
    }
  }
}

/** Default fetch bound to the global implementation (Node 22 has fetch built in). */
const defaultFetch: FetchLike = async (input, init) => {
  const res = await fetch(input, init as RequestInit);
  return { status: res.status, text: () => res.text() };
};

/** Parse a `{ data: T }` success envelope, or fail with an unexpected-shape error. */
function parseDataEnvelope<T>(status: number, text: string): T {
  const json = tryParseJson(text);
  if (json === undefined || typeof json !== "object" || json === null || !("data" in json)) {
    throw new UnexpectedResponseError(
      `Expected a { data } envelope on ${status} but got an unrecognised body.`,
      { httpStatus: status },
    );
  }
  return (json as { data: T }).data;
}

/** Parse a `{ error: { code, message } }` envelope and classify it. */
function toTypedError(status: number, text: string): WorkerClientError {
  const json = tryParseJson(text);
  if (
    json !== undefined &&
    typeof json === "object" &&
    json !== null &&
    "error" in json &&
    typeof (json as { error: unknown }).error === "object" &&
    (json as { error: unknown }).error !== null
  ) {
    const envelope = (json as { error: { code?: unknown; message?: unknown } }).error;
    const code = typeof envelope.code === "string" ? envelope.code : undefined;
    const message =
      typeof envelope.message === "string" ? envelope.message : `HTTP ${status}`;
    return classifyErrorResponse(status, code, message);
  }
  return new UnexpectedResponseError(
    `Non-envelope error response (HTTP ${status}).`,
    { httpStatus: status },
  );
}

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** Strip query string from a URL for safe inclusion in error text. */
function redactPath(url: string): string {
  try {
    const u = new URL(url);
    return u.origin + u.pathname;
  } catch {
    return "the worker endpoint";
  }
}
