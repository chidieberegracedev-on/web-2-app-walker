/**
 * Walker DiscoveryEngine (W2) — public surface.
 *
 * The engine is a pure crawl/extract/analyze pipeline behind an injected
 * `DiscoveryJobInput`. It produces the internal `DiscoveryResult` model and
 * nothing else. The boundary to the future Beagle intake (G1) and result
 * submission (W5) adapters is deliberate: those map to/from this model and do
 * not exist here.
 */
export { DiscoveryEngine, runDiscovery, type DiscoveryEngineOptions } from "./engine.js";
export {
  DiscoveryError,
  positionalPageId,
  discoveryJobInputSchema,
  type DiscoveryJobInput,
  type DiscoveryResult,
  type CrawlSummary,
  type CrawlStopReason,
  type PageResult,
  type PageLinks,
  type PageForm,
  type FormType,
  type PageAssets,
  type PageMetadata,
  type VisualCharacteristics,
  type CornerRadiusPattern,
  type SpacingDensity,
  type CardTreatment,
  type PageIndicators,
  type SiteIndicators,
  type RepeatedNavigation,
} from "./model.js";
export type { CrawlEvent } from "./crawler.js";
export {
  normalizeUrl,
  registrableDomain,
  isInCrawlScope,
  isSameRegistrableDomain,
  isIpHost,
} from "./url.js";
