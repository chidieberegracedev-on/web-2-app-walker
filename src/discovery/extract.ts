import type { RawExtraction, RawForm } from "./dom-extract.js";
import {
  type CardTreatment,
  type CornerRadiusPattern,
  type FormType,
  type PageAssets,
  type PageMetadata,
  type PageResult,
  type SpacingDensity,
  type VisualCharacteristics,
} from "./model.js";
import { computePageIndicators } from "./indicators.js";
import { isSameRegistrableDomain, normalizeUrl } from "./url.js";

/**
 * Node-side shaping (W2): turn a RawExtraction plus navigation facts (final URL,
 * HTTP status, redirect chain, depth) into a PageResult. Pure and deterministic.
 */

export interface ShapePageParams {
  readonly raw: RawExtraction;
  readonly finalUrl: string;
  readonly httpStatus: number;
  readonly redirectChain: string[];
  readonly depth: number;
  /** The crawl scope origin, used to classify links internal vs external. */
  readonly scopeUrl: URL;
}

export interface ShapedPage {
  readonly page: PageResult;
  /** Normalized, in-scope nav links for site-level repeated-nav detection. */
  readonly navLinks: string[];
}

const HTTP_SCHEMES = new Set(["http:", "https:"]);

function classifyLinks(
  rawLinks: readonly string[],
  base: string,
  scopeUrl: URL,
): { internal: string[]; external: string[] } {
  const internal = new Set<string>();
  const external = new Set<string>();
  for (const raw of rawLinks) {
    const { normalized, url } = normalizeUrl(raw, base);
    if (normalized === null || url === null) continue;
    if (!HTTP_SCHEMES.has(url.protocol)) continue; // drop mailto:, tel:, javascript:
    if (isSameRegistrableDomain(url, scopeUrl)) internal.add(normalized);
    else external.add(normalized);
  }
  return { internal: [...internal], external: [...external] };
}

function classifyForm(form: RawForm): FormType {
  const types = form.fields.map((f) => (f.type ?? f.tag).toLowerCase());
  const names = form.fields.map((f) => `${f.name ?? ""} ${f.placeholder ?? ""} ${f.autocomplete ?? ""}`.toLowerCase());
  const anyName = (needle: string): boolean => names.some((n) => n.includes(needle));

  if (types.includes("password")) return "login";
  if (types.includes("search") || anyName("search")) return "search";
  if (anyName("quantity") || anyName("qty")) return "cartQuantity";
  if (types.includes("email") && (types.includes("textarea") || anyName("message") || anyName("subject")))
    return "contact";
  return "generic";
}

function median(nums: readonly number[]): number | null {
  if (nums.length === 0) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? ((sorted[mid - 1]! + sorted[mid]!) / 2) : sorted[mid]!;
}

function cornerPattern(medRadius: number | null): CornerRadiusPattern | undefined {
  if (medRadius === null) return undefined;
  if (medRadius <= 1) return "sharp";
  if (medRadius <= 6) return "small";
  if (medRadius <= 16) return "medium";
  return "large";
}

function spacing(medPadding: number | null): SpacingDensity | undefined {
  if (medPadding === null) return undefined;
  if (medPadding <= 8) return "compact";
  if (medPadding <= 16) return "normal";
  return "spacious";
}

function cardTreatment(raw: RawExtraction): CardTreatment | undefined {
  const s = raw.visual;
  if (s.cardSamples === 0) return undefined;
  const ratio = (n: number): number => n / s.cardSamples;
  if (ratio(s.cardBoxShadow) >= 0.3) return "elevated";
  if (ratio(s.cardBordered) >= 0.3) return "outlined";
  if (ratio(s.cardFilled) >= 0.3) return "filled";
  return "minimal";
}

function buildVisual(raw: RawExtraction): VisualCharacteristics {
  const corners = cornerPattern(median(raw.visual.cornerRadiiPx));
  const density = spacing(median(raw.visual.paddingsPx));
  const treatment = cardTreatment(raw);
  return {
    dominantColors: raw.visual.dominantColors,
    ...(corners !== undefined ? { cornerRadiusPattern: corners } : {}),
    ...(density !== undefined ? { spacingDensity: density } : {}),
    ...(treatment !== undefined ? { cardTreatment: treatment } : {}),
  };
}

function buildAssets(raw: RawExtraction): PageAssets {
  const a = raw.assets;
  return {
    manifestIcons: a.manifestIcons,
    ...(a.favicon !== null ? { favicon: a.favicon } : {}),
    ...(a.appleTouchIcon !== null ? { appleTouchIcon: a.appleTouchIcon } : {}),
    ...(a.openGraphImage !== null ? { openGraphImage: a.openGraphImage } : {}),
  };
}

function buildMetadata(raw: RawExtraction): PageMetadata {
  const m = raw.metadata;
  return {
    viewportPresent: m.viewportPresent,
    ...(m.canonicalUrl !== null ? { canonicalUrl: m.canonicalUrl } : {}),
    ...(m.description !== null ? { description: m.description } : {}),
  };
}

export function shapePage(params: ShapePageParams): ShapedPage {
  const { raw, finalUrl, httpStatus, redirectChain, depth, scopeUrl } = params;
  const base = finalUrl;

  const { internal, external } = classifyLinks(raw.links, base, scopeUrl);
  const allLinks = [...internal, ...external];
  const indicators = computePageIndicators(raw, allLinks);

  const forms = raw.forms.map((form) => ({
    type: classifyForm(form),
    fields: form.fields.map((f) => (f.type ?? f.tag).toLowerCase()),
  }));

  // In-scope nav links (normalized), used only for site-level repeated navigation.
  const navLinks = (() => {
    const out = new Set<string>();
    for (const raw2 of raw.navLinks) {
      const { normalized, url } = normalizeUrl(raw2, base);
      if (normalized === null || url === null) continue;
      if (!HTTP_SCHEMES.has(url.protocol)) continue;
      if (isSameRegistrableDomain(url, scopeUrl)) out.add(normalized);
    }
    return [...out];
  })();

  const page: PageResult = {
    url: finalUrl,
    title: raw.title,
    headings: raw.headings,
    httpStatus,
    redirectChain,
    depth,
    links: { internal, external },
    forms,
    assets: buildAssets(raw),
    metadata: buildMetadata(raw),
    visualCharacteristics: buildVisual(raw),
    indicators,
  };

  return { page, navLinks };
}
