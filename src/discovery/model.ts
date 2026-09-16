import { z } from "zod";
import { jobLimitsSchema, type JobLimits, type FailureCategory } from "../types.js";

/**
 * Walker's INTERNAL discovery model (W2).
 *
 * Shaped using `docs/DETECTION_PIPELINE.md §4` as guidance, but this is Walker's
 * own engine output — deliberately NOT the frozen Beagle wire schema. Beagle is
 * still finalizing the field-exact `DiscoveryResult` it validates (the contract's
 * §6 shows only an abbreviated shape, and the `crawlSummary.limits` naming/units
 * question — ms vs seconds — is unresolved). So:
 *
 *   - This model is the seam. The DiscoveryEngine produces it and nothing else.
 *   - A future Beagle *result adapter* (W5) will map this model onto whatever
 *     Beagle publishes. That adapter does not exist yet and is not implied here.
 *   - We invent no Beagle validation rules and add no Beagle-issued identifiers
 *     (no discoveryResultId, no projectId) to this output — those are Beagle's.
 *
 * PAGE IDENTITY: pages carry NO `id` field. Beagle derives `page-{1-based index}`
 * from the position of each entry in `pages[]`. The engine guarantees a single
 * deterministic ordering; `positionalPageId()` computes the same `page-N` from an
 * index for any Walker-side code (W3) that must reference a page.
 */

/** Injected input for one discovery run. `limits` come from Beagle's claim (W1). */
export interface DiscoveryJobInput {
  readonly jobId: string;
  readonly rootUrl: string;
  readonly limits: JobLimits;
}

export const discoveryJobInputSchema = z
  .object({
    jobId: z.string().min(1),
    rootUrl: z.string().url(),
    limits: jobLimitsSchema,
  })
  .strict();

/** Why the crawl stopped — drives `crawlComplete` and future user-facing notices. */
export type CrawlStopReason = "completed" | "maxPages" | "totalTimeout" | "cancelled";

export interface CrawlSummary {
  readonly pagesDiscovered: number;
  readonly pagesSkipped: number;
  readonly crawlComplete: boolean;
  readonly stopReason: CrawlStopReason;
  /**
   * The exact limits injected for this run, echoed verbatim (ms units, as Beagle
   * delivers them on claim). NOTE: the originals' DiscoveryResult used seconds
   * field names (perPageTimeoutSeconds/jobTimeoutSeconds); the naming/units the
   * Beagle result schema will require is unresolved, so the result adapter (W5)
   * owns any renaming/conversion — the engine keeps the authoritative ms values.
   */
  readonly limitsApplied: JobLimits;
}

export type FormType = "search" | "login" | "cartQuantity" | "contact" | "generic";

export interface PageForm {
  readonly type: FormType;
  readonly fields: string[];
}

export interface PageLinks {
  readonly internal: string[];
  readonly external: string[];
}

export interface PageAssets {
  readonly favicon?: string;
  readonly manifestIcons: string[];
  readonly appleTouchIcon?: string;
  readonly openGraphImage?: string;
}

export interface PageMetadata {
  readonly canonicalUrl?: string;
  readonly description?: string;
  readonly viewportPresent: boolean;
}

export type CornerRadiusPattern = "sharp" | "small" | "medium" | "large";
export type SpacingDensity = "compact" | "normal" | "spacious";
export type CardTreatment = "minimal" | "outlined" | "filled" | "elevated";

export interface VisualCharacteristics {
  readonly dominantColors: string[];
  readonly cornerRadiusPattern?: CornerRadiusPattern;
  readonly spacingDensity?: SpacingDensity;
  readonly cardTreatment?: CardTreatment;
}

export interface PageIndicators {
  readonly authPresent: boolean;
  readonly oauthDomains: string[];
  readonly ecommercePresent: boolean;
  readonly searchPresent: boolean;
  readonly accountSystemPresent: boolean;
  readonly mobileResponsive: boolean;
}

/** One crawled page. NO `id` — identity is positional (see positionalPageId). */
export interface PageResult {
  readonly url: string;
  readonly title: string;
  readonly headings: string[];
  readonly httpStatus: number;
  readonly redirectChain: string[];
  readonly depth: number;
  readonly links: PageLinks;
  readonly forms: PageForm[];
  readonly assets: PageAssets;
  readonly metadata: PageMetadata;
  readonly visualCharacteristics: VisualCharacteristics;
  readonly indicators: PageIndicators;
}

export interface RepeatedNavigation {
  readonly links: string[];
  readonly appearsOnPageCount: number;
}

export interface SiteIndicators {
  readonly repeatedNavigation: RepeatedNavigation[];
}

/** Engine output. Free of Beagle-issued identifiers by design. */
export interface DiscoveryResult {
  readonly rootUrl: string;
  readonly crawlSummary: CrawlSummary;
  readonly pages: PageResult[];
  readonly siteIndicators: SiteIndicators;
}

/**
 * The `page-{1-based index}` identity Beagle derives from `pages[]` order.
 * The engine never stores this on a page; callers compute it from the array
 * index so Walker and Beagle always agree.
 */
export function positionalPageId(indexZeroBased: number): string {
  return `page-${indexZeroBased + 1}`;
}

/**
 * A discovery failure the engine could not degrade past (e.g. the entry site is
 * unreachable). `category` reuses the shared failure vocabulary so the future
 * result/failure adapter (W5) can map it onto Beagle's /failure call — the engine
 * itself never calls Beagle.
 */
export class DiscoveryError extends Error {
  public readonly category: FailureCategory;
  public constructor(category: FailureCategory, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "DiscoveryError";
    this.category = category;
  }
}
