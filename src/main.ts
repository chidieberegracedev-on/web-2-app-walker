import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { ConfigError, loadConfig, type WalkerConfig } from "./config.js";
import { JobClient } from "./client/job-client.js";
import { WORKER_VERSION } from "./types.js";

/**
 * Walker runtime entrypoint (Railway start command: `npm start` → `node dist/main.js`).
 *
 * This is the process foundation only. It:
 *   1. Loads and validates configuration fail-closed (Beagle secret + base URL
 *      present; no Supabase credential — the boundary tripwire), exiting non-zero
 *      on misconfiguration so Railway surfaces a clear crash instead of a zombie.
 *   2. Wires the W1 JobClient so the worker is ready to talk to Beagle, but does
 *      NOT claim, poll, or execute any job. Production job dispatch (G1) is an
 *      unresolved Beagle-side architectural decision and is deliberately not
 *      implemented here — the worker stays idle and alive, awaiting that design.
 *   3. Runs a minimal health/readiness HTTP server. The listening socket is what
 *      keeps the process alive under Railway — no sleep, no placeholder command —
 *      and gives Railway (and humans) a real liveness signal.
 *   4. Shuts down gracefully on SIGTERM/SIGINT (Railway sends SIGTERM on
 *      redeploy/stop).
 *
 * Explicitly NOT here yet (later phases): /start dispatch, job polling/claim
 * execution, crawling, AI, assets, cancellation, progress, stuck-job recovery.
 */

const DEFAULT_PORT = 8080;

interface LogFields {
  readonly [key: string]: string | number | boolean;
}

function log(msg: string, fields: LogFields = {}): void {
  // Structured, secret-free logging. Config secrets are never passed in here.
  console.log(JSON.stringify({ level: "info", ts: new Date().toISOString(), msg, ...fields }));
}

function parsePort(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return DEFAULT_PORT;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    throw new ConfigError(`PORT must be an integer in 1..65535 (got ${JSON.stringify(raw)}).`);
  }
  return n;
}

function buildHealthServer(config: WalkerConfig, startedAt: number): Server {
  const handler = (req: IncomingMessage, res: ServerResponse): void => {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    if (req.method === "GET" && (path === "/" || path === "/healthz" || path === "/readyz")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          status: "ok",
          worker: config.workerId,
          version: WORKER_VERSION,
          uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
        }),
      );
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { code: "NOT_FOUND", message: "Not found." } }));
  };
  return createServer(handler);
}

async function main(): Promise<void> {
  let config: WalkerConfig;
  try {
    config = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(`[walker] configuration error: ${err.message}`);
      process.exit(1);
    }
    throw err;
  }

  const port = parsePort(process.env["PORT"]);
  const startedAt = Date.now();

  // Wire the worker client so the process is genuinely the Walker worker and
  // ready for future phases. No job is claimed, polled, or executed here.
  const jobs = JobClient.create({ config });
  void jobs; // held intentionally; job dispatch (G1) is not implemented yet.

  const server = buildHealthServer(config, startedAt);

  server.listen(port, "0.0.0.0", () => {
    log(`Walker ${WORKER_VERSION} online`, {
      workerId: config.workerId,
      beagleBaseUrl: config.beagleBaseUrl,
      port,
      state: "idle: awaiting a job-dispatch mechanism (G1 unresolved) — not claiming jobs",
    });
  });

  server.on("error", (err) => {
    console.error(`[walker] http server error: ${err.message}`);
    process.exit(1);
  });

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    log(`received ${signal}; shutting down`);
    server.close(() => {
      log("http server closed; exiting cleanly");
      process.exit(0);
    });
    // Failsafe: don't hang forever if a connection stalls close().
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  console.error(`[walker] fatal: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
