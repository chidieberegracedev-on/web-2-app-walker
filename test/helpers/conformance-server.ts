import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * An INDEPENDENT re-implementation of Beagle's worker-auth verification, used to
 * prove Walker's client produces requests a contract-faithful verifier accepts,
 * and that the §9 rejection matrix is enforced exactly. It shares no code with
 * src/ — it recomputes signatures with node:crypto directly, so agreement is
 * meaningful.
 *
 * It is intentionally strict and minimal: it verifies auth per contract §2/§9
 * and, for a valid claim, returns a contract §4-shaped JobContext. It is not a
 * general Beagle emulator.
 */

export interface ConformanceServerOptions {
  readonly secret: string;
  /** Skew window in seconds (contract: ±300). */
  readonly skewSeconds?: number;
  /** Override server clock (ms) for deterministic skew tests. */
  readonly now?: () => number;
}

const SIG_RE = /^sha256=[0-9a-f]{64}$/;
const NONCE_RE = /^[A-Za-z0-9_-]{16,64}$/;

function send(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(text);
}

function errorBody(code: string, message: string): { error: { code: string; message: string } } {
  return { error: { code, message } };
}

function readRawBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function hexEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export interface RunningConformanceServer {
  readonly baseUrl: string;
  readonly seenNonces: Set<string>;
  close: () => Promise<void>;
}

export async function startConformanceServer(
  opts: ConformanceServerOptions,
): Promise<RunningConformanceServer> {
  const skew = opts.skewSeconds ?? 300;
  const now = opts.now ?? Date.now;
  const seenNonces = new Set<string>();

  const server: Server = createServer((req, res) => {
    void handle(req, res);
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const rawBody = await readRawBody(req);
    const method = (req.method ?? "GET").toUpperCase();
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname;

    const bearer = req.headers["authorization"];
    const workerId = header(req, "x-worker-id");
    const timestamp = header(req, "x-worker-timestamp");
    const nonce = header(req, "x-worker-nonce");
    const signature = header(req, "x-worker-signature");

    // 1. Presence of ALL credential/signature headers → else 401 UNAUTHORIZED.
    if (!bearer || !workerId || !timestamp || !nonce || !signature) {
      send(res, 401, errorBody("UNAUTHORIZED", "Missing credential or signature headers."));
      return;
    }

    // 2. Bearer token must match → else 403 FORBIDDEN (does not distinguish from bad sig).
    const expectedBearer = `Bearer ${opts.secret}`;
    if (!hexEqual(pad(bearer), pad(expectedBearer))) {
      send(res, 403, errorBody("FORBIDDEN", "Rejected."));
      return;
    }

    // 3. Nonce and signature must be well-formed → else 403 FORBIDDEN.
    if (!NONCE_RE.test(nonce) || !SIG_RE.test(signature)) {
      send(res, 403, errorBody("FORBIDDEN", "Rejected."));
      return;
    }

    // 4. Timestamp skew → else 401 WORKER_REQUEST_STALE.
    const ts = Number(timestamp);
    const nowSec = Math.floor(now() / 1000);
    if (!Number.isFinite(ts) || Math.abs(nowSec - ts) > skew) {
      send(res, 401, errorBody("WORKER_REQUEST_STALE", "Timestamp outside the allowed window."));
      return;
    }

    // 5. Signature must verify over the EXACT raw bytes → else 403 FORBIDDEN.
    const digest = createHash("sha256").update(rawBody).digest("hex");
    const canonical = [method, path, workerId, timestamp, nonce, digest].join("\n");
    const expectedSig =
      "sha256=" + createHmac("sha256", opts.secret).update(canonical, "utf8").digest("hex");
    if (!hexEqual(signature, expectedSig)) {
      send(res, 403, errorBody("FORBIDDEN", "Rejected."));
      return;
    }

    // 6. Replay: a valid request whose nonce was already used → 409.
    if (seenNonces.has(nonce)) {
      send(res, 409, errorBody("WORKER_REQUEST_REPLAYED", "Nonce already used."));
      return;
    }
    seenNonces.add(nonce);

    // Authenticated. Route the two W1 endpoints.
    const claimMatch = /^\/api\/worker\/jobs\/([^/]+)\/claim$/.exec(path);
    const failureMatch = /^\/api\/worker\/jobs\/([^/]+)\/failure$/.exec(path);

    if (method === "POST" && claimMatch) {
      const jobId = decodeURIComponent(claimMatch[1]!);
      send(res, 200, {
        data: {
          jobId,
          projectId: "project-under-test",
          status: "running",
          claimedBy: workerId,
          limits: { maxPages: 40, maxDepth: 3, pageTimeoutMs: 15000, totalTimeoutMs: 300000 },
        },
      });
      return;
    }

    if (method === "POST" && failureMatch) {
      const jobId = decodeURIComponent(failureMatch[1]!);
      send(res, 200, { data: { jobId, status: "failed" } });
      return;
    }

    send(res, 404, errorBody("NOT_FOUND", "No such worker endpoint."));
  }

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  return {
    baseUrl,
    seenNonces,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  };
}

function header(req: IncomingMessage, name: string): string | undefined {
  const v = req.headers[name];
  if (Array.isArray(v)) return v[0];
  return v;
}

/** Pad two strings to equal length so timingSafeEqual can run on unequal inputs. */
function pad(s: string): string {
  return s.padEnd(256, " ").slice(0, 256);
}
