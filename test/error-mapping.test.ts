import { describe, expect, it } from "vitest";
import { AuthClient, type FetchLike } from "../src/client/auth-client.js";
import { JobClient } from "../src/client/job-client.js";
import {
  AuthRejectedError,
  BeagleMisconfiguredError,
  JobTransitionError,
  NonceStoreUnavailableError,
  RequestReplayedError,
  RequestStaleError,
  TransportError,
  UnexpectedResponseError,
} from "../src/client/errors.js";
import type { WalkerConfig } from "../src/config.js";

/**
 * Client-side half of the §9 matrix: prove the client maps each response to the
 * right typed error and applies the directed retry posture (409 stop; 503 bounded
 * retry with a fresh nonce; 401 stale re-clock once; 401/403 fail closed; 500
 * misconfig). Uses a scripted fetch so each case is deterministic.
 */

const config: WalkerConfig = {
  workerSecret: "s",
  beagleBaseUrl: "https://beagle.example",
  workerId: "walker-1",
};

interface Scripted {
  status: number;
  body: unknown;
}

function scriptedFetch(responses: Scripted[]): {
  fetchImpl: FetchLike;
  nonces: string[];
  calls: number;
} {
  const nonces: string[] = [];
  let i = 0;
  const fetchImpl: FetchLike = async (_url, init) => {
    nonces.push(init.headers["X-Worker-Nonce"]!);
    const r = responses[Math.min(i, responses.length - 1)]!;
    i += 1;
    return { status: r.status, text: async () => JSON.stringify(r.body) };
  };
  return {
    fetchImpl,
    nonces,
    get calls() {
      return i;
    },
  };
}

function client(responses: Scripted[]): {
  auth: AuthClient;
  jobs: JobClient;
  script: ReturnType<typeof scriptedFetch>;
} {
  const script = scriptedFetch(responses);
  const auth = new AuthClient({ config, fetchImpl: script.fetchImpl, retryBackoffMs: 0 });
  return { auth, jobs: new JobClient(auth), script };
}

const err = (code: string, message = "x"): Scripted["body"] => ({ error: { code, message } });

describe("terminal / fail-closed responses are not retried", () => {
  it("409 JOB_NOT_CLAIMABLE → JobTransitionError, one call", async () => {
    const { jobs, script } = client([{ status: 409, body: err("JOB_NOT_CLAIMABLE") }]);
    await expect(jobs.claim("j")).rejects.toBeInstanceOf(JobTransitionError);
    expect(script.calls).toBe(1);
  });

  it("409 JOB_NOT_RUNNING → JobTransitionError (stop-safe)", async () => {
    const { jobs, script } = client([{ status: 409, body: err("JOB_NOT_RUNNING") }]);
    await expect(
      jobs.reportFailure("j", "unknown", "Something went wrong for the user."),
    ).rejects.toMatchObject({ disposition: "stop-safe", code: "JOB_NOT_RUNNING" });
    expect(script.calls).toBe(1);
  });

  it("401 UNAUTHORIZED → AuthRejectedError, one call, fail-closed", async () => {
    const { jobs, script } = client([{ status: 401, body: err("UNAUTHORIZED") }]);
    await expect(jobs.claim("j")).rejects.toMatchObject({ disposition: "fail-closed" });
    expect(script.calls).toBe(1);
  });

  it("403 FORBIDDEN → AuthRejectedError, one call", async () => {
    const { jobs, script } = client([{ status: 403, body: err("FORBIDDEN") }]);
    await expect(jobs.claim("j")).rejects.toBeInstanceOf(AuthRejectedError);
    expect(script.calls).toBe(1);
  });

  it("500 WORKER_AUTH_NOT_CONFIGURED → BeagleMisconfiguredError, one call", async () => {
    const { jobs, script } = client([{ status: 500, body: err("WORKER_AUTH_NOT_CONFIGURED") }]);
    await expect(jobs.claim("j")).rejects.toBeInstanceOf(BeagleMisconfiguredError);
    expect(script.calls).toBe(1);
  });

  it("409 WORKER_REQUEST_REPLAYED → RequestReplayedError, not retried", async () => {
    const { jobs, script } = client([{ status: 409, body: err("WORKER_REQUEST_REPLAYED") }]);
    await expect(jobs.claim("j")).rejects.toBeInstanceOf(RequestReplayedError);
    expect(script.calls).toBe(1);
  });
});

describe("stale timestamp → re-clock and retry once", () => {
  it("retries once with a fresh nonce, then succeeds", async () => {
    const { jobs, script } = client([
      { status: 401, body: err("WORKER_REQUEST_STALE") },
      {
        status: 200,
        body: {
          data: {
            jobId: "j",
            projectId: "p",
            status: "running",
            claimedBy: "walker-1",
            limits: { maxPages: 40, maxDepth: 3, pageTimeoutMs: 15000, totalTimeoutMs: 300000 },
          },
        },
      },
    ]);
    const ctx = await jobs.claim("j");
    expect(ctx.status).toBe("running");
    expect(script.calls).toBe(2);
    expect(script.nonces[0]).not.toBe(script.nonces[1]);
  });

  it("gives up after one retry if still stale", async () => {
    const { jobs, script } = client([{ status: 401, body: err("WORKER_REQUEST_STALE") }]);
    await expect(jobs.claim("j")).rejects.toBeInstanceOf(RequestStaleError);
    expect(script.calls).toBe(2); // initial + one retry
  });
});

describe("nonce store unavailable → bounded retry with fresh nonce", () => {
  it("retries and succeeds, using a fresh nonce each attempt", async () => {
    const { jobs, script } = client([
      { status: 503, body: err("WORKER_NONCE_STORE_UNAVAILABLE") },
      { status: 503, body: err("WORKER_NONCE_STORE_UNAVAILABLE") },
      {
        status: 200,
        body: {
          data: {
            jobId: "j",
            projectId: "p",
            status: "running",
            claimedBy: "walker-1",
            limits: { maxPages: 40, maxDepth: 3, pageTimeoutMs: 15000, totalTimeoutMs: 300000 },
          },
        },
      },
    ]);
    const ctx = await jobs.claim("j");
    expect(ctx.status).toBe("running");
    expect(script.calls).toBe(3);
    expect(new Set(script.nonces).size).toBe(3); // all fresh
  });

  it("gives up after the bounded number of retries", async () => {
    const { jobs, script } = client([{ status: 503, body: err("WORKER_NONCE_STORE_UNAVAILABLE") }]);
    await expect(jobs.claim("j")).rejects.toBeInstanceOf(NonceStoreUnavailableError);
    expect(script.calls).toBe(3); // initial + 2 bounded retries (default)
    expect(new Set(script.nonces).size).toBe(3);
  });
});

describe("unexpected / transport", () => {
  it("a non-envelope error body → UnexpectedResponseError", async () => {
    const { jobs } = client([{ status: 418, body: { teapot: true } }]);
    await expect(jobs.claim("j")).rejects.toBeInstanceOf(UnexpectedResponseError);
  });

  it("an unknown error code → UnexpectedResponseError (not retried)", async () => {
    const { jobs, script } = client([{ status: 400, body: err("SOMETHING_NEW") }]);
    await expect(jobs.claim("j")).rejects.toBeInstanceOf(UnexpectedResponseError);
    expect(script.calls).toBe(1);
  });

  it("a 2xx with the wrong shape → UnexpectedResponseError", async () => {
    const { jobs } = client([{ status: 200, body: { data: { nope: true } } }]);
    await expect(jobs.claim("j")).rejects.toBeInstanceOf(UnexpectedResponseError);
  });

  it("fetch throwing → TransportError", async () => {
    const throwingFetch: FetchLike = async () => {
      throw new Error("ECONNRESET");
    };
    const auth = new AuthClient({ config, fetchImpl: throwingFetch });
    const jobs = new JobClient(auth);
    await expect(jobs.claim("j")).rejects.toBeInstanceOf(TransportError);
  });
});

describe("reportFailure message guard", () => {
  it("rejects an empty message", async () => {
    const { jobs } = client([{ status: 200, body: { data: {} } }]);
    await expect(jobs.reportFailure("j", "unknown", "   ")).rejects.toBeInstanceOf(
      UnexpectedResponseError,
    );
  });

  it("rejects a multi-line (stack-trace-shaped) message", async () => {
    const { jobs } = client([{ status: 200, body: { data: {} } }]);
    await expect(
      jobs.reportFailure("j", "unknown", "Error: boom\n    at foo (bar.ts:1:1)"),
    ).rejects.toBeInstanceOf(UnexpectedResponseError);
  });

  it("sends the correct failure body for a valid message", async () => {
    let sentBody: string | undefined;
    const capturing: FetchLike = async (_u, init) => {
      sentBody = init.body?.toString("utf8");
      return { status: 200, text: async () => JSON.stringify({ data: { status: "failed" } }) };
    };
    const jobs = new JobClient(new AuthClient({ config, fetchImpl: capturing }));
    await jobs.reportFailure("job-x", "renderTimeout", "This site took too long to load.");
    expect(JSON.parse(sentBody!)).toEqual({
      jobId: "job-x",
      workerVersion: "walker-0.1.0",
      failureCategory: "renderTimeout",
      message: "This site took too long to load.",
    });
  });
});
