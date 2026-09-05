import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    // Conformance tests spin up a real loopback HTTP server; keep them serial-safe
    // by isolating per-file rather than sharing a worker.
    pool: "forks",
  },
});
