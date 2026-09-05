# Detection Pipeline

Governed by Decision 002 (discovery is fully server-side). Covers the Discovery Worker's deterministic pipeline, from a submitted URL through to a structured `DiscoveryResult` — the artifact `/ai/AI_AGENT_SPEC.md` picks up from. Website-category and page-type *interpretation* belongs to that document (§7–8 there); this document is strictly what can be established without AI.

## 1. Pipeline Stages

```
URL → Crawl → Render → Extract → Normalize → Deterministic Classification → DiscoveryResult
```

(AI Interpretation, Recommendation Generation, Validation, User Review, and Blueprint are the continuation of this pipeline, fully specified in `/ai/AI_AGENT_SPEC.md`.)

| Stage | Input | Output | Responsibility | Failure behavior | Security boundary |
|---|---|---|---|---|---|
| **Crawl** | Entry URL, Phase 1 default limits (`SYSTEM_ARCHITECTURE.md` §8: 40 pages, depth 3) | Prioritized queue of in-scope URLs | Discover reachable pages within the entry domain, respecting depth/count limits | Unreachable entry URL → job fails immediately with a human-readable error (`SYSTEM_ARCHITECTURE.md` §9); an individual unreachable linked page is skipped and logged, not job-failing | Only same-origin (and explicitly allow-listed) URLs are queued — the crawler does not follow arbitrary external links into a full web crawl |
| **Render** | A queued URL | Rendered DOM (post-JavaScript-execution) | Load the page in a headless browser (Playwright) so JS-heavy/SPA sites produce their real content, not just server-delivered HTML | Per-page timeout (15s default) → page skipped, logged, does not fail the job | Website JavaScript executes **only** inside this sandboxed worker process, for rendering purposes only — this is expected and necessary (`SYSTEM_ARCHITECTURE.md` §10), and the rendered output is treated as untrusted data by every stage after this one |
| **Extract** | Rendered DOM | Raw structured fields (§2) | Pull out links, headings, forms, images, metadata, etc. without interpreting what any of it *means* | Missing/malformed expected elements (no favicon, no title) → field is simply absent in the output, not an error | Extracted text/attributes are treated as data, never executed or evaluated as code from this point forward |
| **Normalize** | Raw structured fields | Canonicalized fields (absolute URLs, deduplicated links, consistent casing) | Make extraction output consistent across wildly different site markup conventions | Malformed URLs are dropped from the link set rather than passed through | — |
| **Deterministic Classification** | Normalized fields across all crawled pages | Indicator flags per page and per site (§3) | Apply rule-based detection (auth indicators, ecommerce indicators, nav repetition, etc.) — no AI involved | A page with insufficient signal simply carries fewer/weaker flags, not a forced classification | — |
| **DiscoveryResult assembly** | All of the above, for every crawled page | The complete `DiscoveryResult` (§4) | Package everything into the structured artifact the AI Analysis Module and Backend API consume | Job-level timeout (5 min default) → assemble and return whatever was completed, with a "some pages may be missing" flag, rather than discarding partial work | Delivered to the Backend API only via the authenticated worker callback (`SYSTEM_ARCHITECTURE.md` §10) |

## 2. What Gets Extracted (Raw Fields)

Per page, without interpretation:

- **Structure:** URL, route pattern, title, headings (h1–h3), page depth from entry URL, HTTP status, redirect chain
- **Navigation:** outbound links (internal/external classified by domain), position in any detected repeated navigation structure across pages
- **Forms:** presence and field types (search fields, cart/quantity fields, login fields, generic contact-style fields)
- **Assets:** images present, favicon, manifest icons, Apple touch icon, Open Graph image
- **Metadata:** Open Graph tags, canonical URL, meta description, declared viewport (mobile-responsiveness signal)
- **Visual characteristics:** dominant color sampling, corner-radius patterns on major UI elements, spacing density, card/border treatment observed in the rendered layout — feeds `/ui/DESIGN_SYSTEM.md` template matching and the theme recommendation in `AI_AGENT_SPEC.md` §7

## 3. Deterministic Indicator Flags

Rule-based, no AI — computed once and stored per page and/or per site in `DiscoveryResult`, then consumed by `AI_AGENT_SPEC.md` §7–8:

| Indicator | Detected from |
|---|---|
| Authentication present | Login-style forms, "sign in"/"account" nav items, auth-cookie-setting behavior observed during render |
| OAuth/external-auth present | Links or redirects to known identity-provider domains (Google, Facebook, Apple, Microsoft, etc.) — this list directly seeds `state.authHandling.externalAuthDomains` in the Blueprint (`APP_BLUEPRINT.md` §10, Decision 007), each entry defaulted to that provider's documented `handoffStrategy` (`STATE_ARCHITECTURE.md` §3) |
| Ecommerce present | Cart/checkout forms, product-schema markup, repeated price-pattern text |
| Search present | A search-type input field, a `/search` route pattern |
| Account/profile system | Account-style nav items combined with an authentication indicator |
| Mobile-responsive | Viewport meta tag present, layout doesn't overflow at narrow widths during render |
| Repeated navigation | The same link set appears across a threshold number of distinct crawled pages — this is the core signal for "primary navigation" recommendation |
| External link | Outbound link's domain doesn't match the entry URL's domain |

These flags are facts, not conclusions — "ecommerce present: true" is not the same as "this is an ecommerce site," which is a category judgment `AI_AGENT_SPEC.md` §8 makes by weighing several flags together, including cases where flags conflict.

## 4. The DiscoveryResult Artifact

```
DiscoveryResult {
  discoveryResultId: string
  projectId: string
  rootUrl: string
  crawlSummary: {
    pagesDiscovered: number
    pagesSkipped: number            — timed out or unreachable, per-page
    crawlComplete: boolean          — false if the job-level timeout was hit first
    limits: { maxPages, maxDepth, perPageTimeoutSeconds, jobTimeoutSeconds }  — the
                                       actual Phase 1 defaults in effect for this run
  }
  pages: [{
    url, title, headings[], httpStatus, redirectChain[],
    depth, links: { internal[], external[] },
    forms: [{ type, fields[] }],
    assets: { favicon?, manifestIcons[], appleTouchIcon?, openGraphImage? },
    metadata: { canonicalUrl?, description?, viewportPresent: boolean },
    visualCharacteristics: { dominantColors[], cornerRadiusPattern?,
                              spacingDensity?, cardTreatment? },
    indicators: { authPresent, oauthDomains[], ecommercePresent,
                  searchPresent, accountSystemPresent, mobileResponsive }
  }]
  siteIndicators: {
    repeatedNavigation: [{ links[], appearsOnPageCount }]
  }
}
```

This is stored once per analysis run in Supabase and referenced — never embedded — by the Blueprint (`APP_BLUEPRINT.md` §3, §16's "why this shape" principle applies equally here: `DiscoveryResult` should never need a field the deterministic pipeline can't actually produce, and the pipeline should never produce a field this schema has nowhere to put).

## 5. Relationship to Phase 1 Default Limits

The 40-page / depth-3 / 15s-per-page / 5-minute defaults are defined once, in `SYSTEM_ARCHITECTURE.md` §8, and referenced here rather than restated with different numbers — this pipeline is the thing that actually enforces them, and `crawlSummary.limits` in the `DiscoveryResult` records exactly which limits were in effect for a given run, so a later change to the defaults doesn't retroactively confuse why an old `DiscoveryResult` looks the way it does.

## 6. What This Stage Deliberately Does Not Do

> **⚠ SUPERSEDED IN PART — read with Decision 022.** The final bullet below described this pipeline when AI executed as a module inside the Backend API on Vercel. Per **Decision 022**, AI execution now lives in Walker alongside this deterministic pipeline, so the deterministic stage hands its `DiscoveryResult` to Walker's own AI execution layer in-process rather than stopping at a service boundary. **The separation this section exists to protect still holds in full:** the deterministic stage still establishes facts without AI, AI still never invents a fact this pipeline did not produce (`AI_AGENT_SPEC.md` §1–§2), page classification remains internal machinery rather than a recommendation, and neither stage writes the Blueprint — Walker submits discovery data, classifications and recommendations to Beagle through the frozen Worker API, and Beagle validates and persists them (Decision 016). What changed is the process boundary, not the ordering or the discipline.

- Does not decide what a page *means* (that's `AI_AGENT_SPEC.md` §7's page classification, built on top of these raw indicators)
- Does not decide a site's overall category (§8 there)
- Does not rank or select a logo/icon candidate (§7 there) — it only surfaces the candidates
- Does not call the AI Analysis Module — per `SYSTEM_ARCHITECTURE.md` §4's coupling rule, Discovery hands a completed `DiscoveryResult` to the Backend API and stops; the Backend API decides when and how to invoke AI interpretation
