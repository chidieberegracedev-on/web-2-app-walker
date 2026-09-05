import { AuthClient, type AuthClientOptions } from "./auth-client.js";
import {
  WORKER_VERSION,
  jobContextSchema,
  type FailureCategory,
  type JobContext,
} from "../types.js";
import { UnexpectedResponseError } from "./errors.js";

/**
 * The Beagle worker job endpoints Walker needs for W1: claim and failure
 * (contract §4, §7). Discovery/result/assets are out of scope until later phases.
 */
export class JobClient {
  private readonly auth: AuthClient;

  public constructor(auth: AuthClient) {
    this.auth = auth;
  }

  /** Convenience: build a JobClient straight from config/options. */
  public static create(opts: AuthClientOptions): JobClient {
    return new JobClient(new AuthClient(opts));
  }

  /**
   * Claim a queued job (contract §4). Returns the typed JobContext, including
   * Beagle's per-job `limits` verbatim — so downstream crawl code (W2) reads its
   * bounds from here and cannot hardcode them.
   *
   * Throws JobTransitionError (JOB_NOT_CLAIMABLE) if the job is not `queued`.
   */
  public async claim(jobId: string): Promise<JobContext> {
    const path = `/api/worker/jobs/${encodeURIComponent(jobId)}/claim`;
    const data = await this.auth.execute<unknown>("POST", path, {
      jobId,
      workerVersion: WORKER_VERSION,
    });

    const parsed = jobContextSchema.safeParse(data);
    if (!parsed.success) {
      throw new UnexpectedResponseError(
        `Claim succeeded but the response did not match the contract §4 shape: ${parsed.error.message}`,
      );
    }
    return parsed.data;
  }

  /**
   * Report a terminal failure for a running job (contract §7). `message` is shown
   * to the user, so it must be human-readable copy — never a stack trace.
   *
   * Throws JobTransitionError (JOB_NOT_RUNNING) if the job already resolved.
   * Returns Beagle's response `data` (shape unspecified by the contract for this
   * endpoint, so returned as-is rather than asserted against an invented schema).
   */
  public async reportFailure(
    jobId: string,
    failureCategory: FailureCategory,
    message: string,
  ): Promise<unknown> {
    assertUserFacingMessage(message);
    const path = `/api/worker/jobs/${encodeURIComponent(jobId)}/failure`;
    return this.auth.execute<unknown>("POST", path, {
      jobId,
      workerVersion: WORKER_VERSION,
      failureCategory,
      message,
    });
  }
}

const MAX_MESSAGE_LENGTH = 500;

/**
 * Structurally enforce "human-readable, never a stack trace" (contract §7).
 * We don't try to judge wording — we reject the shapes a stack trace or raw
 * error dump takes: empty, multi-line, or absurdly long.
 */
export function assertUserFacingMessage(message: string): void {
  const trimmed = message.trim();
  if (trimmed === "") {
    throw new UnexpectedResponseError("Failure message must not be empty (contract §7).");
  }
  if (/[\r\n]/.test(message)) {
    throw new UnexpectedResponseError(
      "Failure message must be a single line of user-facing copy, not a multi-line trace (contract §7).",
    );
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    throw new UnexpectedResponseError(
      `Failure message must be short user-facing copy (≤ ${MAX_MESSAGE_LENGTH} chars, contract §7).`,
    );
  }
}
