/**
 * Fail-closed configuration for Walker.
 *
 * Walker receives exactly two things from its environment (contract §11,
 * handoff §5): DISCOVERY_WORKER_SECRET and Beagle's base URL. It must refuse to
 * start without them.
 *
 * It must ALSO refuse to start if any Supabase credential is present. Walker
 * never connects to Postgres/Storage directly and never holds a Supabase secret
 * (Walker rules #4, #7; handoff §4). Treating a stray SUPABASE_* variable as a
 * hard startup failure turns that boundary from a promise into a tripwire: if
 * someone wires Walker up with the wrong secret set, it stops loudly instead of
 * quietly holding a credential it should never have.
 */

export interface WalkerConfig {
  /** Shared HMAC key + bearer token (contract §2). */
  readonly workerSecret: string;
  /** Beagle base URL, normalised without a trailing slash. */
  readonly beagleBaseUrl: string;
  /** Worker identity for X-Worker-Id (defaults to "walker-1"). */
  readonly workerId: string;
}

/**
 * Token that must never appear in any environment variable name Walker sees.
 * Matched as a case-insensitive SUBSTRING, not just a prefix, so credential
 * names like NEXT_PUBLIC_SUPABASE_URL are caught too — the boundary is "Walker
 * holds no Supabase credential of any name", not "no name starting with
 * SUPABASE". A false positive on some unrelated var that merely contains the
 * token is an acceptable, loud, easily-renamed failure for a security tripwire.
 */
const FORBIDDEN_TOKEN = "SUPABASE";

export class ConfigError extends Error {
  public override readonly name = "ConfigError";
}

type EnvLike = Record<string, string | undefined>;

/** Names of any forbidden Supabase-credential variables present in `env`. */
function findForbiddenVars(env: EnvLike): string[] {
  return Object.keys(env)
    .filter((key) => key.toUpperCase().includes(FORBIDDEN_TOKEN))
    .sort();
}

function requireNonEmpty(env: EnvLike, key: string): string {
  const raw = env[key];
  if (raw === undefined || raw.trim() === "") {
    throw new ConfigError(`Missing required environment variable: ${key}`);
  }
  return raw.trim();
}

function normaliseBaseUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ConfigError(`BEAGLE_BASE_URL is not a valid URL: ${raw}`);
  }
  if (url.protocol !== "https:") {
    throw new ConfigError(
      `BEAGLE_BASE_URL must use https: (got ${url.protocol})`,
    );
  }
  // Strip any trailing slash so path joining is unambiguous.
  return url.origin + url.pathname.replace(/\/+$/, "");
}

/**
 * Load and validate configuration. Throws ConfigError (never leaking the secret
 * value in the message) if anything is missing or if the boundary is violated.
 */
export function loadConfig(env: EnvLike = process.env): WalkerConfig {
  const forbidden = findForbiddenVars(env);
  if (forbidden.length > 0) {
    throw new ConfigError(
      `Refusing to start: Walker must never hold a Supabase credential, but ` +
        `these variables are set: ${forbidden.join(", ")}. Every write goes ` +
        `through Beagle's authenticated endpoints (Walker rules #4, #7).`,
    );
  }

  const workerSecret = requireNonEmpty(env, "DISCOVERY_WORKER_SECRET");
  const beagleBaseUrl = normaliseBaseUrl(requireNonEmpty(env, "BEAGLE_BASE_URL"));
  const workerId = env["WORKER_ID"]?.trim() || "walker-1";

  return { workerSecret, beagleBaseUrl, workerId };
}
