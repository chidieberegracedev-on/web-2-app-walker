import { describe, expect, it } from "vitest";
import {
  computeOauthDomains,
  computePageIndicators,
  computeRepeatedNavigation,
} from "../../src/discovery/indicators.js";
import type { RawExtraction } from "../../src/discovery/dom-extract.js";

/** Minimal RawExtraction with overridable signals/metadata. */
function raw(overrides: {
  signals?: Partial<RawExtraction["signals"]>;
  viewportPresent?: boolean;
}): RawExtraction {
  return {
    finalUrl: "https://example.com/",
    title: "",
    headings: [],
    links: [],
    navLinks: [],
    forms: [],
    assets: { favicon: null, appleTouchIcon: null, openGraphImage: null, manifestHref: null, manifestIcons: [] },
    metadata: { canonicalUrl: null, description: null, viewportPresent: overrides.viewportPresent ?? true },
    visual: {
      dominantColors: [],
      cornerRadiiPx: [],
      paddingsPx: [],
      cardBoxShadow: 0,
      cardBordered: 0,
      cardFilled: 0,
      cardSamples: 0,
    },
    signals: {
      hasPasswordField: false,
      hasSearchInput: false,
      navTexts: [],
      anchorHosts: [],
      scriptSrcs: [],
      jsonLdTypes: [],
      priceMatchCount: 0,
      addToCartText: false,
      ...overrides.signals,
    },
  };
}

describe("computePageIndicators", () => {
  it("flags auth from a password field", () => {
    expect(computePageIndicators(raw({ signals: { hasPasswordField: true } }), []).authPresent).toBe(true);
  });
  it("flags auth from nav text", () => {
    expect(computePageIndicators(raw({ signals: { navTexts: ["sign in"] } }), []).authPresent).toBe(true);
  });
  it("flags ecommerce from add-to-cart text", () => {
    expect(computePageIndicators(raw({ signals: { addToCartText: true } }), []).ecommercePresent).toBe(true);
  });
  it("flags ecommerce from JSON-LD Product", () => {
    expect(computePageIndicators(raw({ signals: { jsonLdTypes: ["Product"] } }), []).ecommercePresent).toBe(true);
  });
  it("flags ecommerce from a /cart link", () => {
    expect(computePageIndicators(raw({}), ["https://example.com/cart"]).ecommercePresent).toBe(true);
  });
  it("does not over-flag ecommerce on a plain page", () => {
    expect(computePageIndicators(raw({ signals: { priceMatchCount: 1 } }), ["https://example.com/about"]).ecommercePresent).toBe(false);
  });
  it("flags search from a search input", () => {
    expect(computePageIndicators(raw({ signals: { hasSearchInput: true } }), []).searchPresent).toBe(true);
  });
  it("flags account system only when auth is also present", () => {
    expect(computePageIndicators(raw({ signals: { navTexts: ["account"] } }), []).accountSystemPresent).toBe(false);
    expect(
      computePageIndicators(raw({ signals: { hasPasswordField: true, navTexts: ["account"] } }), []).accountSystemPresent,
    ).toBe(true);
  });
  it("reports mobileResponsive from viewport meta", () => {
    expect(computePageIndicators(raw({ viewportPresent: false }), []).mobileResponsive).toBe(false);
    expect(computePageIndicators(raw({ viewportPresent: true }), []).mobileResponsive).toBe(true);
  });
});

describe("computeOauthDomains", () => {
  it("detects known identity providers from anchor hosts and script srcs", () => {
    const r = raw({
      signals: {
        anchorHosts: ["accounts.google.com", "example.com"],
        scriptSrcs: ["https://connect.facebook.net/en_US/sdk.js"],
      },
    });
    expect(computeOauthDomains(r)).toEqual(["facebook.com", "google.com"]);
  });
  it("returns empty when no providers present", () => {
    expect(computeOauthDomains(raw({ signals: { anchorHosts: ["example.com"] } }))).toEqual([]);
  });
});

describe("computeRepeatedNavigation", () => {
  it("groups links by how many pages they appear on, above threshold", () => {
    const perPage = [
      ["https://x.com/a", "https://x.com/b"],
      ["https://x.com/a", "https://x.com/b"],
      ["https://x.com/a", "https://x.com/c"],
    ];
    const result = computeRepeatedNavigation(perPage, 2);
    // /a appears on 3 pages; /b on 2; /c on 1 (dropped).
    expect(result).toEqual([
      { appearsOnPageCount: 3, links: ["https://x.com/a"] },
      { appearsOnPageCount: 2, links: ["https://x.com/b"] },
    ]);
  });
  it("returns nothing when nothing meets the threshold", () => {
    expect(computeRepeatedNavigation([["https://x.com/a"]], 2)).toEqual([]);
  });
});
