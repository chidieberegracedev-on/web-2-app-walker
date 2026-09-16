/**
 * URL normalization, deduplication, and crawl scoping (W2).
 *
 * Scoping is deliberately conservative at crawl time: same registrable domain,
 * and (by default) https only. This is the baseline requested for W2 — the full
 * §5 SSRF ruleset (resolved-IP blocklist, redirect re-checks, etc.) is W4, at
 * asset-fetch. Nothing here resolves DNS or inspects IPs.
 */

/**
 * A small, pragmatic multi-label public-suffix set. This is NOT the full Public
 * Suffix List — it covers the common multi-part TLDs so that, e.g., `a.co.uk`
 * and `b.co.uk` are treated as different registrable domains while `x.example.com`
 * and `y.example.com` share one. Correct registrable-domain resolution for exotic
 * suffixes is out of scope for W2 scoping; same-host comparison is the safe
 * fallback the callers can also rely on.
 */
const MULTI_LABEL_SUFFIXES = new Set<string>([
  "co.uk", "org.uk", "gov.uk", "ac.uk", "me.uk", "ltd.uk", "plc.uk", "net.uk",
  "com.au", "net.au", "org.au", "edu.au", "gov.au",
  "co.nz", "net.nz", "org.nz", "govt.nz",
  "co.jp", "or.jp", "ne.jp", "ac.jp", "go.jp",
  "com.br", "com.cn", "com.mx", "com.tr", "com.sg", "com.hk", "com.tw",
  "co.in", "co.za", "co.kr", "co.il",
]);

/** True for an IPv4 dotted-quad or a bracketed/─plain IPv6 literal host. */
export function isIpHost(host: string): boolean {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true;
  // IPv6 in URL host form (may be bracketed by the URL parser-stripped form).
  return host.includes(":");
}

/**
 * The registrable domain (eTLD+1) for a host, using the pragmatic suffix set
 * above. IPs and single-label hosts (e.g. `localhost`) return the host itself.
 */
export function registrableDomain(host: string): string {
  const h = host.toLowerCase().replace(/\.$/, "");
  if (h === "" || h === "localhost" || isIpHost(h)) return h;
  const labels = h.split(".");
  if (labels.length <= 2) return h;
  const lastTwo = labels.slice(-2).join(".");
  const lastThree = labels.slice(-3).join(".");
  // If the last two labels form a known multi-label suffix, keep three labels.
  if (MULTI_LABEL_SUFFIXES.has(lastTwo)) return lastThree;
  return lastTwo;
}

export interface NormalizeResult {
  /** Canonical absolute URL string, or null if it could not be parsed. */
  readonly normalized: string | null;
  /** The parsed URL, or null. */
  readonly url: URL | null;
}

/**
 * Normalize a possibly-relative URL against `base`:
 *  - resolve to absolute
 *  - lowercase scheme + host
 *  - drop the fragment
 *  - drop a default port (80/443)
 *  - remove a trailing slash on non-root paths
 * Query strings are preserved (distinct queries are usually distinct pages).
 * Returns null for anything unparseable.
 */
export function normalizeUrl(raw: string, base?: string): NormalizeResult {
  let url: URL;
  try {
    url = base === undefined ? new URL(raw) : new URL(raw, base);
  } catch {
    return { normalized: null, url: null };
  }
  url.hash = "";
  if (
    (url.protocol === "http:" && url.port === "80") ||
    (url.protocol === "https:" && url.port === "443")
  ) {
    url.port = "";
  }
  if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
    url.pathname = url.pathname.replace(/\/+$/, "");
  }
  return { normalized: url.toString(), url };
}

export interface ScopeOptions {
  /** Schemes eligible for crawling. Production default: https only. */
  readonly allowedSchemes?: readonly string[];
}

const DEFAULT_ALLOWED_SCHEMES = ["https:"] as const;

/**
 * Decide whether a normalized link is in crawl scope: allowed scheme AND same
 * registrable domain as `scopeUrl`. Callers use this to build the internal
 * frontier; out-of-scope links are still recorded as external, just not crawled.
 */
export function isInCrawlScope(candidate: URL, scopeUrl: URL, opts: ScopeOptions = {}): boolean {
  const schemes = opts.allowedSchemes ?? DEFAULT_ALLOWED_SCHEMES;
  if (!schemes.includes(candidate.protocol)) return false;
  return registrableDomain(candidate.hostname) === registrableDomain(scopeUrl.hostname);
}

/** Same-registrable-domain test for classifying a link internal vs external. */
export function isSameRegistrableDomain(a: URL, b: URL): boolean {
  return registrableDomain(a.hostname) === registrableDomain(b.hostname);
}
