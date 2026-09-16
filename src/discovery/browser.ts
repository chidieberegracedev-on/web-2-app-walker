import { chromium, type Browser, type BrowserContext } from "playwright";

/**
 * Playwright browser lifecycle (W2).
 *
 * Executable resolution order:
 *   1. explicit `executablePath` argument, else
 *   2. `WALKER_CHROMIUM_EXECUTABLE_PATH` env var, else
 *   3. Playwright's own resolution (works when the installed Playwright version
 *      matches the browser build present, e.g. after `playwright install` on
 *      Railway).
 *
 * The override exists because a pre-provisioned image may ship a chromium build
 * whose revision differs from the pinned Playwright package; pointing directly at
 * the binary sidesteps revision matching (the documented fallback).
 */

export interface LaunchOptions {
  readonly executablePath?: string;
  readonly headless?: boolean;
}

export async function launchBrowser(opts: LaunchOptions = {}): Promise<Browser> {
  const executablePath = opts.executablePath ?? process.env["WALKER_CHROMIUM_EXECUTABLE_PATH"];
  return chromium.launch({
    headless: opts.headless ?? true,
    // --no-sandbox / --disable-dev-shm-usage are required in most container
    // runtimes (root user, small /dev/shm) such as Railway.
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
    ...(executablePath !== undefined && executablePath !== "" ? { executablePath } : {}),
  });
}

export interface ContextOptions {
  /** Overall navigation timeout applied to the context (ms). */
  readonly navigationTimeoutMs: number;
  readonly userAgent?: string;
}

const DEFAULT_UA =
  "WalkerDiscoveryBot/0.1 (+https://web-2-app; website-to-app discovery worker)";

/**
 * A fresh context per job keeps cookies/storage isolated between crawls. The
 * default navigation timeout is set here so every page.goto inherits the per-job
 * page timeout from the injected limits.
 */
export async function newDiscoveryContext(
  browser: Browser,
  opts: ContextOptions,
): Promise<BrowserContext> {
  const context = await browser.newContext({
    userAgent: opts.userAgent ?? DEFAULT_UA,
    viewport: { width: 390, height: 844 }, // mobile-ish viewport — this is a mobile app builder
    ignoreHTTPSErrors: false,
  });
  context.setDefaultNavigationTimeout(opts.navigationTimeoutMs);
  context.setDefaultTimeout(opts.navigationTimeoutMs);
  return context;
}
