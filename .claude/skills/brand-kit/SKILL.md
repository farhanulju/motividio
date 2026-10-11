---
name: brand-kit
description: Build or refresh a reusable brand kit (brands/<slug>/brand.md + real screenshots, logos, colors, fonts) from a company's website so videos use real product UI and branding instead of generic output. Use when a video is for a named brand/product without an existing brands/<slug>/brand.md, or when the user asks to research/capture a brand.
---

# brand-kit — the brand's memory

1. **Capture**: `npm run capture -- <url> --brand <slug> --pages /,<2–4 pages that show the product: /features, /product, /pricing, /docs> --mobile`
   - Look for pages that show *real UI*: product tours, docs, changelog, feature pages, press/media kit (`/press`, `/brand`, `/media`).
   - If the site blocks headless capture, use the built-in browser to view pages and ask the user for screenshots / a press kit.
2. **Inspect**: Read `brands/<slug>/extracted.json` and look at `screens/*.png` and `logos/*` (Read the images).
   - Choose the primary logo: prefer SVG, full wordmark; note an icon-only mark. If none is good, find `/press` or ask the user — never draw a fake logo.
   - Verify palette by eye: extracted colors are hints; pick the ones that actually define the brand (usually 1 bg, 1 ink, 1–2 accents).
   - Fonts: map to Google Fonts if available; otherwise nearest-match and note it. Self-hosted brand fonts go in `brands/<slug>/fonts/` only if the user supplies them.
3. **Research copy** (optional, built-in browser / WebFetch): taglines, feature names, real numbers, launch announcement text. Verbatim only.
4. **Write** `brands/<slug>/brand.md` from `templates/brand.md` — every section filled, UI kit with exact radii/shadows/colors from screens.
5. **Rebuildable UI**: list 2–4 hero screens and what each shows; these become HTML rebuilds or animated PNG layers in the film.
6. Tell the user in 3 lines: palette, type, logo found (or missing), best screens.

Brand kits are long-lived memory: future films reuse them. Update in place; never duplicate.
