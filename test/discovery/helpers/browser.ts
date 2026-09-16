import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Resolve a chromium executable for tests, robust to the pinned Playwright
 * package's browser build differing from what a pre-provisioned image ships.
 * Order: WALKER_CHROMIUM_EXECUTABLE_PATH env → glob under PLAYWRIGHT_BROWSERS_PATH
 * → undefined (let Playwright resolve, e.g. after `playwright install`).
 */
export function resolveChromiumExecutable(): string | undefined {
  const fromEnv = process.env["WALKER_CHROMIUM_EXECUTABLE_PATH"];
  if (fromEnv !== undefined && fromEnv !== "" && existsSync(fromEnv)) return fromEnv;

  const root = process.env["PLAYWRIGHT_BROWSERS_PATH"] ?? "/opt/pw-browsers";
  try {
    const dirs = readdirSync(root).filter((d) => d.startsWith("chromium-"));
    for (const dir of dirs.sort().reverse()) {
      const candidate = join(root, dir, "chrome-linux", "chrome");
      if (existsSync(candidate)) return candidate;
    }
  } catch {
    /* directory not present in this environment */
  }
  return undefined;
}
