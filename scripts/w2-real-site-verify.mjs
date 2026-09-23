#!/usr/bin/env node
// @ts-nocheck
/**
 * W2 real-site verification harness — run from an egress-permitted environment
 * (e.g. GitHub Codespaces), OUTSIDE production execution.
 *
 * Drives the built W2 DiscoveryEngine over the injected DiscoveryJobInput path
 * against real public websites, and prints RAW EVIDENCE per site (no self-graded
 * pass/fail). It never touches Beagle, never submits results, never runs in
 * production. It only crawls/renders and reports what the engine observed.
 *
 * Prerequisites (in Codespaces):
 *   npm ci
 *   npx playwright install chromium      # matches the pinned playwright version
 *   npm run build                        # emits dist/ (this harness imports dist)
 *
 * Run (defaults chosen to stress SPA / ecommerce / content that the loopback
 * fixture cannot — OVERRIDE with your own authorized targets):
 *   node scripts/w2-real-site-verify.mjs \
 *     "spa=https://vitejs.dev" \
 *     "ecommerce=https://<a store you are authorized to crawl>" \
 *     "content=https://blog.rust-lang.org"
 *
 * Tuning env (all optional):
 *   MAX_PAGES (default 12)  MAX_DEPTH (default 2)
 *   PAGE_TIMEOUT_MS (15000)  TOTAL_TIMEOUT_MS (120000)
 *   WALKER_CHROMIUM_EXECUTABLE_PATH (else Playwright resolves its own build)
 *
 * Be a good citizen: pick sites you are authorized to crawl, keep limits small,
 * and remember this fetches only HTML/DOM — it surfaces asset candidates without
 * fetching their bytes (that is W4).
 */

import { runDiscovery, DiscoveryError } from "../dist/discovery/index.js";

const num = (name, def) => {
  const v = process.env[name];
  const n = v === undefined ? def : Number(v);
  return Number.isFinite(n) ? n : def;
};

const limits = {
  maxPages: num("MAX_PAGES", 12),
  maxDepth: num("MAX_DEPTH", 2),
  pageTimeoutMs: num("PAGE_TIMEOUT_MS", 15000),
  totalTimeoutMs: num("TOTAL_TIMEOUT_MS", 120000),
};

// Targets: "label=url" pairs from argv, else a representative default set.
const DEFAULTS = [
  "spa=https://vitejs.dev",
  "ecommerce=https://www.shopify.com",
  "content=https://blog.rust-lang.org",
];
const targets = (process.argv.slice(2).length ? process.argv.slice(2) : DEFAULTS).map((arg) => {
  const eq = arg.indexOf("=");
  return eq === -1 ? { label: "site", url: arg } : { label: arg.slice(0, eq), url: arg.slice(eq + 1) };
});

const pathOf = (u) => {
  try {
    return new URL(u).pathname;
  } catch {
    return u;
  }
};

function pageEvidence(p) {
  return {
    url: p.url,
    path: pathOf(p.url),
    httpStatus: p.httpStatus,
    depth: p.depth,
    redirectChain: p.redirectChain,
    links: { internal: p.links.internal.length, external: p.links.external.length },
    externalSample: p.links.external.slice(0, 5),
    forms: p.forms.map((f) => f.type),
    indicators: p.indicators,
    assets: {
      favicon: p.assets.favicon ?? null,
      appleTouchIcon: p.assets.appleTouchIcon ?? null,
      openGraphImage: p.assets.openGraphImage ?? null,
      manifestIconCount: p.assets.manifestIcons.length,
    },
    metadata: p.metadata,
  };
}

async function verify({ label, url }) {
  const events = [];
  const t0 = Date.now();
  try {
    const dr = await runDiscovery(
      { jobId: `verify-${label}`, rootUrl: url, limits },
      { onEvent: (e) => events.push(e) },
    );
    const durationMs = Date.now() - t0;
    const skips = events.filter((e) => e.kind === "pageSkipped");
    return {
      label,
      entryUrl: url,
      ok: true,
      rootUrl: dr.rootUrl,
      durationMs,
      crawlSummary: dr.crawlSummary,
      pagesSaved: dr.pages.length,
      pagesSkipped: dr.crawlSummary.pagesSkipped,
      stopReason: dr.crawlSummary.stopReason,
      crawlComplete: dr.crawlSummary.crawlComplete,
      siteIndicators: dr.siteIndicators,
      skips: skips.map((e) => ({ url: e.url, reason: e.reason })),
      pages: dr.pages.map(pageEvidence),
    };
  } catch (err) {
    const durationMs = Date.now() - t0;
    return {
      label,
      entryUrl: url,
      ok: false,
      durationMs,
      error:
        err instanceof DiscoveryError
          ? { type: "DiscoveryError", category: err.category, message: err.message }
          : { type: "Unexpected", message: err instanceof Error ? err.message : String(err) },
    };
  }
}

async function main() {
  console.error(`W2 real-site verification — limits ${JSON.stringify(limits)}`);
  const results = [];
  for (const t of targets) {
    console.error(`\n--- ${t.label}: ${t.url} ---`);
    const r = await verify(t);
    results.push(r);
    // Human-readable one-liner to stderr; full raw evidence goes to stdout JSON.
    if (r.ok) {
      console.error(
        `  saved=${r.pagesSaved} skipped=${r.pagesSkipped} stop=${r.stopReason} ` +
          `complete=${r.crawlComplete} ${r.durationMs}ms rootUrl=${r.rootUrl}`,
      );
    } else {
      console.error(`  ERROR ${r.error.type}: ${r.error.category ?? ""} ${r.error.message}`);
    }
  }
  // Raw evidence as JSON on stdout for judging.
  process.stdout.write(JSON.stringify({ limits, results }, null, 2) + "\n");
}

main().catch((err) => {
  console.error("harness crashed:", err?.message ?? err);
  process.exit(1);
});
