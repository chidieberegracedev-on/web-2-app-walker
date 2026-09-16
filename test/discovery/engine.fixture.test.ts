import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runDiscovery, positionalPageId, DiscoveryError } from "../../src/discovery/index.js";
import type {
  DiscoveryEngineOptions,
  DiscoveryResult,
  PageResult,
} from "../../src/discovery/index.js";
import type { JobLimits } from "../../src/types.js";
import { startFixtureSite, type RunningFixtureSite } from "./helpers/fixture-site.js";
import { resolveChromiumExecutable } from "./helpers/browser.js";

/**
 * End-to-end render tests: the real DiscoveryEngine (Playwright) against a
 * loopback fixture site. No external egress. Skips cleanly if no chromium can be
 * resolved (e.g. a CI image without the browser).
 */

const exe = resolveChromiumExecutable();
const suite = exe ? describe : describe.skip;

const FULL: JobLimits = { maxPages: 40, maxDepth: 3, pageTimeoutMs: 15000, totalTimeoutMs: 120000 };

let site: RunningFixtureSite;
beforeAll(async () => {
  site = await startFixtureSite();
});
afterAll(async () => {
  if (site) await site.close();
});

function engineOpts(extra: Partial<DiscoveryEngineOptions> = {}): DiscoveryEngineOptions {
  return {
    allowedSchemes: ["http:"],
    ...(exe !== undefined ? { executablePath: exe } : {}),
    ...extra,
  };
}

function run(
  rootPath: string,
  limits: JobLimits,
  extra: Partial<DiscoveryEngineOptions> = {},
): Promise<DiscoveryResult> {
  return runDiscovery({ jobId: "test", rootUrl: site.baseUrl + rootPath, limits }, engineOpts(extra));
}

const pathsOf = (r: DiscoveryResult): string[] =>
  r.pages.map((p) => p.url.replace(site.baseUrl, ""));
const byPath = (r: DiscoveryResult, path: string): PageResult | undefined =>
  r.pages.find((p) => p.url.replace(site.baseUrl, "") === path);

suite("DiscoveryEngine — full crawl", () => {
  it(
    "discovers the in-scope site with positional page-1 = entry, no page id field",
    async () => {
      const r = await run("/", FULL);
      expect(r.pages[0]!.url).toBe(site.baseUrl + "/");
      expect(positionalPageId(0)).toBe("page-1");
      // Positional identity only — pages carry no `id` field.
      expect(Object.prototype.hasOwnProperty.call(r.pages[0], "id")).toBe(false);

      const paths = pathsOf(r);
      for (const p of ["/", "/products", "/account", "/about", "/search", "/deep/1", "/products/1"]) {
        expect(paths).toContain(p);
      }
      expect(r.crawlSummary.crawlComplete).toBe(true);
      expect(r.crawlSummary.stopReason).toBe("completed");
      // Limits echoed verbatim, in ms.
      expect(r.crawlSummary.limitsApplied).toEqual(FULL);
    },
    60000,
  );

  it(
    "classifies external links as external and never crawls them; drops mailto",
    async () => {
      const r = await run("/", FULL);
      const home = byPath(r, "/")!;
      expect(home.links.external.some((u) => u.includes("external.example.com"))).toBe(true);
      expect(pathsOf(r).every((p) => !p.includes("external.example.com"))).toBe(true);
      const allLinks = r.pages.flatMap((p) => [...p.links.internal, ...p.links.external]);
      expect(allLinks.some((u) => u.startsWith("mailto:"))).toBe(false);
    },
    60000,
  );

  it("produces a deterministic, stable page ordering across runs", async () => {
    const a = pathsOf(await run("/", FULL));
    const b = pathsOf(await run("/", FULL));
    expect(a).toEqual(b);
  }, 60000);

  it("surfaces a repeated navigation set across pages", async () => {
    const r = await run("/", FULL);
    const nav = r.siteIndicators.repeatedNavigation;
    expect(nav.length).toBeGreaterThan(0);
    const allNavLinks = nav.flatMap((n) => n.links);
    expect(allNavLinks.some((u) => u.endsWith("/products"))).toBe(true);
  }, 60000);
});

suite("DiscoveryEngine — limit enforcement", () => {
  it("honors maxPages and reports the stop reason", async () => {
    const r = await run("/", { ...FULL, maxPages: 3 });
    expect(r.pages.length).toBe(3);
    expect(r.crawlSummary.stopReason).toBe("maxPages");
    expect(r.crawlSummary.crawlComplete).toBe(false);
  }, 60000);

  it("maxDepth=0 crawls only the entry", async () => {
    const r = await run("/", { ...FULL, maxDepth: 0 });
    expect(pathsOf(r)).toEqual(["/"]);
    expect(r.crawlSummary.crawlComplete).toBe(true);
  }, 60000);

  it("maxDepth=1 crawls entry + depth-1 only", async () => {
    const r = await run("/", { ...FULL, maxDepth: 1 });
    const paths = pathsOf(r);
    expect(paths).toContain("/products");
    expect(paths).toContain("/deep/1");
    expect(paths).not.toContain("/products/1"); // depth 2
    expect(paths).not.toContain("/deep/2"); // depth 2
  }, 60000);

  it("respects maxDepth=3 (deep/3 in, deep/4 out)", async () => {
    const paths = pathsOf(await run("/", FULL));
    expect(paths).toContain("/deep/3");
    expect(paths).not.toContain("/deep/4");
  }, 60000);
});

suite("DiscoveryEngine — extraction & indicators", () => {
  it("classifies forms and flags auth/oauth/ecommerce/search", async () => {
    const r = await run("/", FULL);
    const account = byPath(r, "/account")!;
    expect(account.forms.map((f) => f.type)).toContain("login");
    expect(account.indicators.authPresent).toBe(true);
    expect(account.indicators.oauthDomains).toContain("google.com");

    const products = byPath(r, "/products")!;
    expect(products.indicators.ecommercePresent).toBe(true);

    const p1 = byPath(r, "/products/1")!;
    expect(p1.forms.map((f) => f.type)).toContain("cartQuantity");

    const search = byPath(r, "/search")!;
    expect(search.indicators.searchPresent).toBe(true);
  }, 60000);

  it("surfaces asset candidates without fetching bytes; flags non-responsive pages", async () => {
    const r = await run("/", FULL);
    const home = byPath(r, "/")!;
    expect(home.assets.favicon).toContain("/favicon.ico");
    expect(home.assets.appleTouchIcon).toContain("/touch.png");
    expect(home.assets.openGraphImage).toContain("/og.png");
    expect(home.assets.manifestIcons.length).toBe(2);
    expect(home.metadata.viewportPresent).toBe(true);
    expect(home.metadata.canonicalUrl).toBeDefined();

    const about = byPath(r, "/about")!;
    expect(about.assets.favicon).toBeUndefined();
    expect(about.assets.manifestIcons).toEqual([]);
    expect(about.indicators.mobileResponsive).toBe(false); // no viewport meta
  }, 60000);
});

suite("DiscoveryEngine — edge cases", () => {
  it("renders JS-injected content (SPA) and follows JS-added links", async () => {
    const r = await run("/spa", FULL);
    const spa = r.pages[0]!;
    expect(spa.headings).toContain("SPA Rendered");
    expect(pathsOf(r)).toContain("/spa-child");
  }, 60000);

  it("captures a redirect chain and classifies the final destination", async () => {
    const r = await run("/old", FULL);
    const entry = r.pages[0]!;
    expect(entry.url).toBe(site.baseUrl + "/about");
    expect(entry.redirectChain.some((u) => u.endsWith("/old"))).toBe(true);
  }, 60000);

  it("throws a typed DiscoveryError when the entry site is unreachable", async () => {
    await expect(
      runDiscovery(
        { jobId: "t", rootUrl: "http://127.0.0.1:1/", limits: { ...FULL, pageTimeoutMs: 5000, totalTimeoutMs: 10000 } },
        engineOpts(),
      ),
    ).rejects.toMatchObject({ name: "DiscoveryError", category: "unreachableSite" });
  }, 30000);

  it("stops at the cancellation checkpoint (cooperative hook)", async () => {
    let calls = 0;
    const r = await run("/", FULL, {
      shouldCancel: () => {
        calls += 1;
        return calls > 1; // allow one page, then cancel
      },
    });
    expect(r.crawlSummary.stopReason).toBe("cancelled");
    expect(r.pages.length).toBe(1);
    expect(r.crawlSummary.crawlComplete).toBe(false);
  }, 60000);
});

// A non-render sanity check so the file reports something even where chromium is
// unavailable and the render suites are skipped.
describe("DiscoveryError", () => {
  it("carries a failure category", () => {
    expect(new DiscoveryError("unreachableSite", "x").category).toBe("unreachableSite");
  });
});
