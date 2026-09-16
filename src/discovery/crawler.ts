import type { BrowserContext, Page, Response } from "playwright";
import type { JobLimits } from "../types.js";
import {
  DiscoveryError,
  type CrawlStopReason,
  type DiscoveryJobInput,
  type PageResult,
} from "./model.js";
import { extractInPage } from "./dom-extract.js";
import { shapePage } from "./extract.js";
import { isInCrawlScope, normalizeUrl } from "./url.js";

/**
 * Same-origin BFS crawl (W2). Sequential and deterministic: one page at a time,
 * children enqueued in DOM order, dedup by normalized URL. Enforces the injected
 * limits (maxPages, maxDepth, per-page timeout, total timeout) and checks a
 * cooperative cancellation hook between pages.
 */

export interface CrawlOptions {
  readonly limits: JobLimits;
  /** Schemes eligible for crawling. Production default: https only. */
  readonly allowedSchemes?: readonly string[];
  /** Cooperative cancellation checkpoint. NOT wired to any real signal in W2. */
  readonly shouldCancel?: () => boolean | Promise<boolean>;
  /** Optional structured logger. */
  readonly onEvent?: (event: CrawlEvent) => void;
}

export type CrawlEvent =
  | { readonly kind: "pageCrawled"; readonly url: string; readonly depth: number; readonly httpStatus: number }
  | { readonly kind: "pageSkipped"; readonly url: string; readonly reason: string }
  | { readonly kind: "stopped"; readonly reason: CrawlStopReason };

export interface CrawlOutcome {
  readonly pages: PageResult[];
  /** Per-page in-scope nav links, parallel to `pages`, for repeated-nav detection. */
  readonly perPageNavLinks: string[][];
  readonly pagesSkipped: number;
  readonly stopReason: CrawlStopReason;
}

interface QueueItem {
  readonly url: string;
  readonly depth: number;
}

function isTimeout(err: unknown): boolean {
  return err instanceof Error && /timeout/i.test(err.name + " " + err.message);
}

function buildRedirectChain(response: Response | null): string[] {
  const urls: string[] = [];
  let from = response?.request().redirectedFrom() ?? null;
  while (from) {
    urls.push(from.url());
    from = from.redirectedFrom();
  }
  return urls.reverse();
}

export async function crawl(
  context: BrowserContext,
  input: DiscoveryJobInput,
  opts: CrawlOptions,
): Promise<CrawlOutcome> {
  const { limits } = opts;
  const deadline = Date.now() + limits.totalTimeoutMs;
  const pages: PageResult[] = [];
  const perPageNavLinks: string[][] = [];
  let pagesSkipped = 0;
  let scopeUrl: URL | null = null;

  const entryNorm = normalizeUrl(input.rootUrl);
  if (entryNorm.normalized === null) {
    throw new DiscoveryError("unknown", `Entry URL could not be parsed: ${input.rootUrl}`);
  }

  const visited = new Set<string>([entryNorm.normalized]);
  const queue: QueueItem[] = [{ url: entryNorm.normalized, depth: 0 }];

  let stopReason: CrawlStopReason = "completed";

  while (queue.length > 0) {
    if (opts.shouldCancel && (await opts.shouldCancel())) {
      stopReason = "cancelled";
      break;
    }
    if (pages.length >= limits.maxPages) {
      stopReason = "maxPages";
      break;
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      stopReason = "totalTimeout";
      break;
    }

    const item = queue.shift()!;
    const perPageTimeout = Math.min(limits.pageTimeoutMs, remaining);
    const isEntry = pages.length === 0 && item.depth === 0;

    let page: Page | null = null;
    try {
      page = await context.newPage();
      let response: Response | null;
      try {
        response = await page.goto(item.url, {
          timeout: perPageTimeout,
          waitUntil: "domcontentloaded",
        });
      } catch (navErr) {
        if (isEntry) {
          throw new DiscoveryError(
            isTimeout(navErr) ? "renderTimeout" : "unreachableSite",
            isTimeout(navErr)
              ? "The site took too long to load."
              : "We couldn't reach that website.",
            navErr,
          );
        }
        pagesSkipped += 1;
        opts.onEvent?.({ kind: "pageSkipped", url: item.url, reason: isTimeout(navErr) ? "timeout" : "navError" });
        continue;
      }

      // Give SPA content a brief, bounded chance to hydrate — never fatal.
      const idleBudget = Math.max(0, Math.min(3000, deadline - Date.now()));
      if (idleBudget > 0) {
        await page.waitForLoadState("networkidle", { timeout: idleBudget }).catch(() => {});
      }

      if (response === null && isEntry) {
        throw new DiscoveryError("unreachableSite", "We couldn't reach that website.");
      }

      const finalUrl = page.url();
      if (scopeUrl === null) {
        // Scope is fixed from the ENTRY's final (post-redirect) URL.
        try {
          scopeUrl = new URL(finalUrl);
        } catch {
          throw new DiscoveryError("unknown", `Entry resolved to an unparseable URL: ${finalUrl}`);
        }
      }

      const raw = await page.evaluate(extractInPage);
      const shaped = shapePage({
        raw,
        finalUrl,
        httpStatus: response?.status() ?? 0,
        redirectChain: buildRedirectChain(response),
        depth: item.depth,
        scopeUrl,
      });

      pages.push(shaped.page);
      perPageNavLinks.push(shaped.navLinks);
      opts.onEvent?.({
        kind: "pageCrawled",
        url: finalUrl,
        depth: item.depth,
        httpStatus: shaped.page.httpStatus,
      });

      // Enqueue in-scope children (DOM order preserved via internal[] ordering).
      if (item.depth < limits.maxDepth) {
        for (const link of shaped.page.links.internal) {
          if (visited.has(link)) continue;
          let linkUrl: URL;
          try {
            linkUrl = new URL(link);
          } catch {
            continue;
          }
          const scoped =
            opts.allowedSchemes !== undefined
              ? isInCrawlScope(linkUrl, scopeUrl, { allowedSchemes: opts.allowedSchemes })
              : isInCrawlScope(linkUrl, scopeUrl);
          if (!scoped) continue;
          visited.add(link);
          queue.push({ url: link, depth: item.depth + 1 });
        }
      }
    } catch (err) {
      if (err instanceof DiscoveryError) throw err;
      if (isEntry) {
        throw new DiscoveryError("unknown", "Discovery failed on the entry page.", err);
      }
      pagesSkipped += 1;
      opts.onEvent?.({ kind: "pageSkipped", url: item.url, reason: "extractError" });
    } finally {
      if (page !== null) await page.close().catch(() => {});
    }
  }

  opts.onEvent?.({ kind: "stopped", reason: stopReason });
  return { pages, perPageNavLinks, pagesSkipped, stopReason };
}
