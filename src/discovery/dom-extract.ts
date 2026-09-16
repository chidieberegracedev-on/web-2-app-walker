/**
 * The in-page extraction script (W2).
 *
 * `extractInPage` is serialized by Playwright and executed inside the rendered
 * page, so it must be self-contained (no imports, no outer references) and return
 * only serializable data. It reads the post-JavaScript DOM and returns a
 * `RawExtraction`; all interpretation/classification happens Node-side in
 * extract.ts and indicators.ts.
 *
 * We intentionally do NOT pull the whole `lib.dom` into the project (it clashes
 * with @types/node's global fetch/URL/etc.). Instead the browser-only globals
 * this script touches are declared ambiently as `any`; the RETURN type is fully
 * typed, so Node-side callers get complete typing. Asset *bytes* are never
 * fetched here — the manifest (a JSON document) is read only to surface candidate
 * icon URLs, per W2 ("surface, don't fetch"); byte fetching is W4.
 */

// Browser-only globals (present at runtime in the page; typed loosely here).
declare const document: any;
declare const location: any;

export interface RawFormField {
  readonly tag: string;
  readonly type: string | null;
  readonly name: string | null;
  readonly placeholder: string | null;
  readonly autocomplete: string | null;
}

export interface RawForm {
  readonly fields: RawFormField[];
}

export interface RawExtraction {
  readonly finalUrl: string;
  readonly title: string;
  readonly headings: string[];
  /** Absolute hrefs of every anchor with href. */
  readonly links: string[];
  /** Absolute hrefs found specifically inside <nav>/<header> (nav candidates). */
  readonly navLinks: string[];
  readonly forms: RawForm[];
  readonly assets: {
    readonly favicon: string | null;
    readonly appleTouchIcon: string | null;
    readonly openGraphImage: string | null;
    readonly manifestHref: string | null;
    readonly manifestIcons: string[];
  };
  readonly metadata: {
    readonly canonicalUrl: string | null;
    readonly description: string | null;
    readonly viewportPresent: boolean;
  };
  readonly visual: {
    readonly dominantColors: string[];
    readonly cornerRadiiPx: number[];
    readonly paddingsPx: number[];
    readonly cardBoxShadow: number;
    readonly cardBordered: number;
    readonly cardFilled: number;
    readonly cardSamples: number;
  };
  readonly signals: {
    readonly hasPasswordField: boolean;
    readonly hasSearchInput: boolean;
    readonly navTexts: string[];
    readonly anchorHosts: string[];
    readonly scriptSrcs: string[];
    readonly jsonLdTypes: string[];
    readonly priceMatchCount: number;
    readonly addToCartText: boolean;
  };
}

/**
 * Executed inside the page. Kept defensive (each section guarded) so a hostile or
 * malformed page degrades to partial data rather than throwing.
 */
export async function extractInPage(): Promise<RawExtraction> {
  const cap = <T>(arr: T[], n: number): T[] => arr.slice(0, n);
  const text = (s: unknown): string => (typeof s === "string" ? s.trim() : "");
  const abs = (href: unknown): string | null => {
    if (typeof href !== "string" || href === "") return null;
    try {
      return new URL(href, location.href).toString();
    } catch {
      return null;
    }
  };

  const qsa = (sel: string): any[] => {
    try {
      return Array.prototype.slice.call(document.querySelectorAll(sel));
    } catch {
      return [];
    }
  };
  const attr = (el: any, name: string): string | null => {
    try {
      const v = el.getAttribute(name);
      return typeof v === "string" ? v : null;
    } catch {
      return null;
    }
  };

  const title = text(document.title);

  const headings = cap(
    qsa("h1, h2, h3")
      .map((el) => text(el.textContent))
      .filter((t) => t !== ""),
    50,
  );

  const anchors = qsa("a[href]");
  const links = cap(
    anchors.map((a) => abs(a.getAttribute("href"))).filter((u): u is string => u !== null),
    2000,
  );
  const navAnchors = qsa("nav a[href], header a[href]");
  const navLinks = cap(
    navAnchors.map((a) => abs(a.getAttribute("href"))).filter((u): u is string => u !== null),
    200,
  );

  const anchorHosts = cap(
    Array.from(
      new Set(
        links
          .map((u) => {
            try {
              return new URL(u).hostname.toLowerCase();
            } catch {
              return "";
            }
          })
          .filter((h) => h !== ""),
      ),
    ),
    200,
  );

  // Forms + fields
  const forms: RawForm[] = cap(
    qsa("form").map((form) => {
      const controls = (() => {
        try {
          return Array.prototype.slice.call(form.querySelectorAll("input, select, textarea"));
        } catch {
          return [];
        }
      })();
      const fields: RawFormField[] = cap(
        controls.map((el: any) => ({
          tag: text((el.tagName || "").toLowerCase()) || "input",
          type: attr(el, "type"),
          name: attr(el, "name"),
          placeholder: attr(el, "placeholder"),
          autocomplete: attr(el, "autocomplete"),
        })),
        100,
      );
      return { fields };
    }),
    50,
  );

  // Assets
  const linkRel = (rel: string): string | null => {
    const el = qsa(`link[rel~="${rel}"]`)[0];
    return el ? abs(attr(el, "href")) : null;
  };
  const favicon = linkRel("icon");
  const appleTouchIcon = linkRel("apple-touch-icon");
  const ogImageEl = qsa('meta[property="og:image"], meta[name="og:image"]')[0];
  const openGraphImage = ogImageEl ? abs(attr(ogImageEl, "content")) : null;
  const manifestEl = qsa('link[rel="manifest"]')[0];
  const manifestHref = manifestEl ? abs(attr(manifestEl, "href")) : null;

  // Manifest icons: read the manifest JSON (same-origin document) to SURFACE
  // candidate icon URLs. This reads text metadata, not image bytes (W4).
  let manifestIcons: string[] = [];
  if (manifestHref !== null) {
    try {
      const resp = await fetch(manifestHref, { credentials: "omit" });
      if (resp.ok) {
        const json: any = await resp.json();
        const icons = Array.isArray(json?.icons) ? json.icons : [];
        manifestIcons = cap(
          icons
            .map((ic: any) => abs(ic?.src))
            .filter((u: string | null): u is string => u !== null),
          50,
        );
      }
    } catch {
      manifestIcons = [];
    }
  }

  // Metadata
  const canonicalEl = qsa('link[rel="canonical"]')[0];
  const canonicalUrl = canonicalEl ? abs(attr(canonicalEl, "href")) : null;
  const descEl = qsa('meta[name="description"]')[0];
  const description = descEl ? text(attr(descEl, "content")) || null : null;
  const viewportPresent = qsa('meta[name="viewport"]').length > 0;

  // Visual characteristics (best-effort heuristics)
  const getStyle = (el: any): any => {
    try {
      return el.ownerDocument.defaultView.getComputedStyle(el);
    } catch {
      return null;
    }
  };
  const pxNum = (v: unknown): number | null => {
    if (typeof v !== "string") return null;
    const m = /(-?\d+(?:\.\d+)?)px/.exec(v);
    return m ? Number(m[1]) : null;
  };

  const bodyStyle = document.body ? getStyle(document.body) : null;
  const dominantColorsSet: Record<string, number> = {};
  const bg = bodyStyle ? text(bodyStyle.backgroundColor) : "";
  if (bg !== "" && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") {
    dominantColorsSet[bg] = (dominantColorsSet[bg] ?? 0) + 1;
  }

  const cardish = cap(
    qsa(
      '[class*="card" i], article, li, section, .panel, [class*="tile" i], button, .btn, [class*="button" i]',
    ),
    120,
  );
  const cornerRadiiPx: number[] = [];
  const paddingsPx: number[] = [];
  let cardBoxShadow = 0;
  let cardBordered = 0;
  let cardFilled = 0;
  let cardSamples = 0;
  for (const el of cardish) {
    const st = getStyle(el);
    if (!st) continue;
    cardSamples += 1;
    const r = pxNum(st.borderTopLeftRadius);
    if (r !== null) cornerRadiiPx.push(r);
    const p = pxNum(st.paddingTop);
    if (p !== null) paddingsPx.push(p);
    const shadow = text(st.boxShadow);
    if (shadow !== "" && shadow !== "none") cardBoxShadow += 1;
    const bw = pxNum(st.borderTopWidth);
    if (bw !== null && bw > 0 && text(st.borderStyle) !== "none") cardBordered += 1;
    const cbg = text(st.backgroundColor);
    if (cbg !== "" && cbg !== "rgba(0, 0, 0, 0)" && cbg !== "transparent" && cbg !== bg) {
      cardFilled += 1;
      dominantColorsSet[cbg] = (dominantColorsSet[cbg] ?? 0) + 1;
    }
  }
  const dominantColors = cap(
    Object.keys(dominantColorsSet).sort((a, b) => (dominantColorsSet[b] ?? 0) - (dominantColorsSet[a] ?? 0)),
    8,
  );

  // Signals
  const hasPasswordField = qsa('input[type="password"]').length > 0;
  const hasSearchInput =
    qsa('input[type="search"], form[role="search"], input[name*="search" i], input[placeholder*="search" i]')
      .length > 0;
  const navTexts = cap(
    navAnchors.map((a) => text(a.textContent).toLowerCase()).filter((t) => t !== ""),
    200,
  );
  const scriptSrcs = cap(
    qsa("script[src]")
      .map((s) => abs(attr(s, "src")))
      .filter((u): u is string => u !== null),
    200,
  );
  let jsonLdTypes: string[] = [];
  try {
    const blocks = qsa('script[type="application/ld+json"]');
    const types: string[] = [];
    for (const b of blocks) {
      try {
        const parsed: any = JSON.parse(text(b.textContent));
        const collect = (node: any): void => {
          if (!node || typeof node !== "object") return;
          const t = node["@type"];
          if (typeof t === "string") types.push(t);
          else if (Array.isArray(t)) for (const x of t) if (typeof x === "string") types.push(x);
          if (Array.isArray(node)) for (const x of node) collect(x);
          if (Array.isArray(node["@graph"])) for (const x of node["@graph"]) collect(x);
        };
        collect(parsed);
      } catch {
        /* ignore one bad block */
      }
    }
    jsonLdTypes = cap(Array.from(new Set(types)), 50);
  } catch {
    jsonLdTypes = [];
  }

  const bodyText = (() => {
    try {
      return text(document.body ? document.body.innerText : "").toLowerCase();
    } catch {
      return "";
    }
  })();
  const priceMatchCount = (() => {
    try {
      const m = bodyText.match(/[$£€]\s?\d/g);
      return m ? m.length : 0;
    } catch {
      return 0;
    }
  })();
  const addToCartText =
    bodyText.includes("add to cart") ||
    bodyText.includes("add to bag") ||
    bodyText.includes("add to basket");

  return {
    finalUrl: location.href,
    title,
    headings,
    links,
    navLinks,
    forms,
    assets: { favicon, appleTouchIcon, openGraphImage, manifestHref, manifestIcons },
    metadata: { canonicalUrl, description, viewportPresent },
    visual: {
      dominantColors,
      cornerRadiiPx: cap(cornerRadiiPx, 120),
      paddingsPx: cap(paddingsPx, 120),
      cardBoxShadow,
      cardBordered,
      cardFilled,
      cardSamples,
    },
    signals: {
      hasPasswordField,
      hasSearchInput,
      navTexts,
      anchorHosts,
      scriptSrcs,
      jsonLdTypes,
      priceMatchCount,
      addToCartText,
    },
  };
}
