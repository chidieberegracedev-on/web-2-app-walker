import { newDiscoveryContext, launchBrowser } from "./browser.js";
import { crawl, type CrawlEvent, type CrawlOptions } from "./crawler.js";
import { computeRepeatedNavigation } from "./indicators.js";
import {
  DiscoveryError,
  discoveryJobInputSchema,
  type CrawlSummary,
  type DiscoveryJobInput,
  type DiscoveryResult,
  type SiteIndicators,
} from "./model.js";

/**
 * The W2 DiscoveryEngine.
 *
 * Pure crawl/extract/analyze behind an injected input:
 *
 *   run(input: DiscoveryJobInput, opts?) -> DiscoveryResult
 *
 * `input.rootUrl` and `input.limits` are supplied by the caller. In W2 that
 * caller is a test/dev harness; in production it will be the G1 intake adapter
 * (Beagle pull/claim), which is out of scope here. The engine never talks to
 * Beagle, never fetches asset bytes (W4), never calls AI (W3), and never submits
 * results (W5) — it returns the internal DiscoveryResult model and stops.
 */

export interface DiscoveryEngineOptions {
  /** Explicit chromium binary; else WALKER_CHROMIUM_EXECUTABLE_PATH, else Playwright default. */
  readonly executablePath?: string;
  readonly headless?: boolean;
  /** Schemes eligible for crawling. Omit for the production default (https only). */
  readonly allowedSchemes?: readonly string[];
  /** Cooperative cancellation checkpoint. NOT wired to any real signal in W2 (G5 unbuilt). */
  readonly shouldCancel?: () => boolean | Promise<boolean>;
  readonly onEvent?: (event: CrawlEvent) => void;
  /** Min pages a nav link must appear on to count as repeated navigation. */
  readonly repeatedNavThreshold?: number;
}

export class DiscoveryEngine {
  public async run(
    input: DiscoveryJobInput,
    opts: DiscoveryEngineOptions = {},
  ): Promise<DiscoveryResult> {
    const parsed = discoveryJobInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new DiscoveryError("unknown", `Invalid DiscoveryJobInput: ${parsed.error.message}`);
    }

    const browser = await launchBrowser({
      ...(opts.executablePath !== undefined ? { executablePath: opts.executablePath } : {}),
      ...(opts.headless !== undefined ? { headless: opts.headless } : {}),
    });

    let outcome;
    try {
      const context = await newDiscoveryContext(browser, {
        navigationTimeoutMs: input.limits.pageTimeoutMs,
      });
      try {
        const crawlOpts: CrawlOptions = {
          limits: input.limits,
          ...(opts.allowedSchemes !== undefined ? { allowedSchemes: opts.allowedSchemes } : {}),
          ...(opts.shouldCancel !== undefined ? { shouldCancel: opts.shouldCancel } : {}),
          ...(opts.onEvent !== undefined ? { onEvent: opts.onEvent } : {}),
        };
        outcome = await crawl(context, input, crawlOpts);
      } finally {
        await context.close().catch(() => {});
      }
    } finally {
      await browser.close().catch(() => {});
    }

    const threshold =
      opts.repeatedNavThreshold ?? Math.max(2, Math.ceil(outcome.pages.length / 2));
    const siteIndicators: SiteIndicators = {
      repeatedNavigation: computeRepeatedNavigation(outcome.perPageNavLinks, threshold),
    };

    const crawlSummary: CrawlSummary = {
      pagesDiscovered: outcome.pages.length,
      pagesSkipped: outcome.pagesSkipped,
      crawlComplete: outcome.stopReason === "completed",
      stopReason: outcome.stopReason,
      limitsApplied: input.limits,
    };

    return {
      rootUrl: input.rootUrl,
      crawlSummary,
      pages: outcome.pages,
      siteIndicators,
    };
  }
}

/** Convenience wrapper for one-shot runs. */
export function runDiscovery(
  input: DiscoveryJobInput,
  opts?: DiscoveryEngineOptions,
): Promise<DiscoveryResult> {
  return new DiscoveryEngine().run(input, opts);
}
