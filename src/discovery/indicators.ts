import type { RawExtraction } from "./dom-extract.js";
import type { PageIndicators, RepeatedNavigation } from "./model.js";

/**
 * Deterministic indicator flags (W2) — rule-based, no AI (DETECTION_PIPELINE §3).
 * These are *facts about signals present*, not category judgments (that is W3).
 */

/** Known identity-provider host fragments → the provider domain we report. */
const OAUTH_HOST_FRAGMENTS: ReadonlyArray<readonly [fragment: string, domain: string]> = [
  ["accounts.google.com", "google.com"],
  ["apis.google.com", "google.com"],
  ["appleid.apple.com", "apple.com"],
  ["facebook.com", "facebook.com"],
  ["connect.facebook.net", "facebook.com"],
  ["login.microsoftonline.com", "microsoft.com"],
  ["login.live.com", "microsoft.com"],
  ["github.com", "github.com"],
  ["api.twitter.com", "twitter.com"],
  ["linkedin.com", "linkedin.com"],
  ["okta.com", "okta.com"],
  ["auth0.com", "auth0.com"],
];

const AUTH_NAV_TERMS = ["sign in", "signin", "log in", "login", "log-in", "my account", "sign up"];
const ACCOUNT_NAV_TERMS = ["account", "profile", "dashboard", "my account"];
const ECOMMERCE_JSONLD = new Set(["Product", "Offer", "AggregateOffer", "ProductGroup"]);

function anyPathIncludes(links: readonly string[], needles: readonly string[]): boolean {
  for (const link of links) {
    let path: string;
    try {
      path = new URL(link).pathname.toLowerCase();
    } catch {
      continue;
    }
    if (needles.some((n) => path.includes(n))) return true;
  }
  return false;
}

export function computeOauthDomains(raw: RawExtraction): string[] {
  const hosts = [
    ...raw.signals.anchorHosts,
    ...raw.signals.scriptSrcs
      .map((s) => {
        try {
          return new URL(s).hostname.toLowerCase();
        } catch {
          return "";
        }
      })
      .filter((h) => h !== ""),
  ];
  const found = new Set<string>();
  for (const host of hosts) {
    for (const [fragment, domain] of OAUTH_HOST_FRAGMENTS) {
      if (host.includes(fragment)) found.add(domain);
    }
  }
  return [...found].sort();
}

export function computePageIndicators(
  raw: RawExtraction,
  allLinks: readonly string[],
): PageIndicators {
  const navTexts = raw.signals.navTexts;
  const authByNav = navTexts.some((t) => AUTH_NAV_TERMS.some((term) => t.includes(term)));
  const authPresent = raw.signals.hasPasswordField || authByNav;

  const oauthDomains = computeOauthDomains(raw);

  const ecommercePresent =
    raw.signals.addToCartText ||
    raw.signals.priceMatchCount >= 3 ||
    raw.signals.jsonLdTypes.some((t) => ECOMMERCE_JSONLD.has(t)) ||
    anyPathIncludes(allLinks, ["/cart", "/checkout", "/basket", "/add-to-cart"]);

  const searchPresent = raw.signals.hasSearchInput || anyPathIncludes(allLinks, ["/search"]);

  const accountNav = navTexts.some((t) => ACCOUNT_NAV_TERMS.some((term) => t.includes(term)));
  const accountSystemPresent =
    authPresent && (accountNav || anyPathIncludes(allLinks, ["/account", "/profile", "/dashboard"]));

  // Baseline responsiveness signal per DETECTION_PIPELINE §3: viewport meta present.
  const mobileResponsive = raw.metadata.viewportPresent;

  return {
    authPresent,
    oauthDomains,
    ecommercePresent,
    searchPresent,
    accountSystemPresent,
    mobileResponsive,
  };
}

/**
 * Site-level repeated navigation: for each in-scope nav link, count how many
 * pages surface it; keep links appearing on at least `threshold` pages, grouped
 * by that page-count into entries. Deterministic (sorted).
 */
export function computeRepeatedNavigation(
  perPageNavLinks: ReadonlyArray<readonly string[]>,
  threshold: number,
): RepeatedNavigation[] {
  const counts = new Map<string, number>();
  for (const navLinks of perPageNavLinks) {
    for (const link of new Set(navLinks)) {
      counts.set(link, (counts.get(link) ?? 0) + 1);
    }
  }
  const byCount = new Map<number, string[]>();
  for (const [link, count] of counts) {
    if (count >= threshold) {
      const bucket = byCount.get(count) ?? [];
      bucket.push(link);
      byCount.set(count, bucket);
    }
  }
  return [...byCount.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([appearsOnPageCount, links]) => ({
      appearsOnPageCount,
      links: [...links].sort(),
    }));
}
