import { z } from "zod";

/**
 * Shared types for the Beagle worker contract.
 *
 * These mirror the contract exactly (WALKER_BEAGLE_INTEGRATION_CONTRACT.md §4,
 * §7). W1 only needs claim and failure; the crawl/result shapes are deliberately
 * out of scope until W2/W5.
 */

/** The Walker build identifier sent on every worker request (contract §4/§7). */
export const WORKER_VERSION = "walker-0.1.0" as const;

/**
 * Per-job crawl limits, returned by Beagle on claim (contract §4). Units are
 * milliseconds for the two timeouts (`pageTimeoutMs`, `totalTimeoutMs`) — the
 * same durations older specs wrote in seconds (15s / 5min). Walker must use
 * these verbatim and never hardcode them (handoff §2; W2 depends on this).
 */
export const jobLimitsSchema = z
  .object({
    maxPages: z.number().int().positive(),
    maxDepth: z.number().int().nonnegative(),
    pageTimeoutMs: z.number().int().positive(),
    totalTimeoutMs: z.number().int().positive(),
  })
  .strict();

export type JobLimits = z.infer<typeof jobLimitsSchema>;

/**
 * The claim response payload (contract §4, inside the `data` envelope). Beagle
 * gives Walker everything needed to run the job without reading the database.
 */
export const jobContextSchema = z
  .object({
    jobId: z.string().min(1),
    projectId: z.string().min(1),
    status: z.literal("running"),
    claimedBy: z.string().min(1),
    limits: jobLimitsSchema,
  })
  .strict();

export type JobContext = z.infer<typeof jobContextSchema>;

/**
 * Closed set of failure categories Beagle accepts (contract §7). Kept as a
 * const tuple so the union type and a runtime guard stay in lockstep.
 */
export const FAILURE_CATEGORIES = [
  "unreachableSite",
  "renderTimeout",
  "aiUnavailable",
  "assetIngestionFailed",
  "infrastructure",
  "unknown",
] as const;

export type FailureCategory = (typeof FAILURE_CATEGORIES)[number];

export const failureCategorySchema = z.enum(FAILURE_CATEGORIES);
