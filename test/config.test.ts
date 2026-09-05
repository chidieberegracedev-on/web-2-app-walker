import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "../src/config.js";

const base = {
  DISCOVERY_WORKER_SECRET: "a-secret",
  BEAGLE_BASE_URL: "https://web-2-app-backend-api.vercel.app",
};

describe("loadConfig", () => {
  it("loads a valid environment", () => {
    const cfg = loadConfig({ ...base });
    expect(cfg.workerSecret).toBe("a-secret");
    expect(cfg.beagleBaseUrl).toBe("https://web-2-app-backend-api.vercel.app");
    expect(cfg.workerId).toBe("walker-1");
  });

  it("honours WORKER_ID when set", () => {
    const cfg = loadConfig({ ...base, WORKER_ID: "walker-7" });
    expect(cfg.workerId).toBe("walker-7");
  });

  it("strips a trailing slash from the base URL", () => {
    const cfg = loadConfig({ ...base, BEAGLE_BASE_URL: "https://x.example/" });
    expect(cfg.beagleBaseUrl).toBe("https://x.example");
  });

  it("throws when the secret is missing", () => {
    expect(() => loadConfig({ BEAGLE_BASE_URL: base.BEAGLE_BASE_URL })).toThrow(ConfigError);
  });

  it("throws when the secret is blank/whitespace", () => {
    expect(() => loadConfig({ ...base, DISCOVERY_WORKER_SECRET: "   " })).toThrow(ConfigError);
  });

  it("throws when the base URL is missing", () => {
    expect(() => loadConfig({ DISCOVERY_WORKER_SECRET: base.DISCOVERY_WORKER_SECRET })).toThrow(
      ConfigError,
    );
  });

  it("rejects a non-https base URL", () => {
    expect(() => loadConfig({ ...base, BEAGLE_BASE_URL: "http://x.example" })).toThrow(
      /https/,
    );
  });

  it("never echoes the secret value in an error message", () => {
    try {
      loadConfig({ ...base, BEAGLE_BASE_URL: "not-a-url" });
      throw new Error("expected loadConfig to throw");
    } catch (e) {
      expect((e as Error).message).not.toContain("a-secret");
    }
  });

  describe("Supabase boundary tripwire", () => {
    it("refuses to start if SUPABASE_URL is present", () => {
      expect(() => loadConfig({ ...base, SUPABASE_URL: "https://x.supabase.co" })).toThrow(
        /Supabase/,
      );
    });

    it("refuses to start if SUPABASE_SERVICE_ROLE_KEY is present, even empty", () => {
      expect(() => loadConfig({ ...base, SUPABASE_SERVICE_ROLE_KEY: "" })).toThrow(/Supabase/);
    });

    it("is case-insensitive", () => {
      expect(() => loadConfig({ ...base, supabase_anon_key: "x" })).toThrow(/Supabase/);
    });

    it("catches NEXT_PUBLIC_SUPABASE_* names (substring match, not just prefix)", () => {
      expect(() => loadConfig({ ...base, NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co" })).toThrow(
        /Supabase/,
      );
    });

    it("names every offending variable", () => {
      try {
        loadConfig({ ...base, SUPABASE_URL: "u", SUPABASE_ANON_KEY: "k" });
        throw new Error("expected throw");
      } catch (e) {
        const msg = (e as Error).message;
        expect(msg).toContain("SUPABASE_ANON_KEY");
        expect(msg).toContain("SUPABASE_URL");
      }
    });

    it("does not false-positive on unrelated vars", () => {
      expect(() => loadConfig({ ...base, DATABASE_URL: "x", MY_SUPA: "y", POSTGRES_URL: "z" })).not.toThrow();
    });
  });
});
