# Responsive layout repair — 17 November 2026

## Scope and defects

The existing React/Vite/Tailwind application is retained. No backend, authentication, supplier, price, payment, database or approved-logo changes are included.

Before this release, the signed-in account page measured 851 CSS pixels wide in a 337-pixel browser viewport. Its single implicit grid column inherited the horizontally scrolling navigation's minimum content width. The administration header measured 1507 pixels in a 1348-pixel viewport; ten navigation links competed with branding and identity in one row, and all admin navigation was hidden on narrow screens. The login card imposed a 350-pixel minimum width before page padding.

## Implementation

- Use shrinkable containers and an explicit zero-minimum account grid track. Account navigation scrolls locally; content remains within the page.
- Separate administrator branding/identity and navigation into two rows. Navigation is accessible at every width with local horizontal scrolling. Bound long identity labels and align the main desktop content with the header.
- Remove login's fixed minimum width, use a full-width bounded card with safe page padding and small-viewport height, and label the icon-only submit control.
- Share header sizing across all storefront routes. Mobile actions have 44-pixel targets; the original logo keeps its aspect ratio. Country/currency controls shrink within the mobile menu. Retain the existing bottom navigation and safe-area padding.
- Center the text-only homepage hero on desktop; use fluid type, spacing and full-width narrow-screen CTAs. Keep populated-category layouts, the approved sunrise gradient, and its content-sized fade.
- Keep grid children shrinkable. Product-card buttons wrap on narrow screens across storefront routes, without changing cart/wishlist handlers. Wide data tables keep their own horizontal scroll.
- Disable sticky headers on short viewports to leave space for content. No body-level overflow hiding is used.

## Checks before merge

- TypeScript and production Vite build: passed.
- Existing Vitest suite: 44 tests passed.
- Existing homepage contrast checks: passed, including 4.53:1 minimum muted text contrast across the gradient.
- ESLint on changed TypeScript files: no errors; three existing React Fast Refresh warnings.
- Full-repository lint: remains blocked by 17 legacy errors and 15 warnings, including effect-state patterns in untouched checkout/settings code. Rules were not disabled.
- Browser preview: homepage document width equals viewport width at 337, 449, 539, 674, 770, 899, 1078, 1225 and 1348 CSS pixels.
- Login at 337 pixels: 305-pixel card; no page overflow. Unauthenticated admin route still redirects to sign-in with its return path.
- Product search submits to `/search?q=shirt`; category navigation and mobile menu open/close work. At narrow width the menu's content fits its own width.
- These viewport checks use native browser zoom, not physical-device emulation. Actual Android/iPhone testing, portrait screenshots and a complete device/browser matrix remain unverified. Product interaction testing is limited by the empty real catalog; no sample products or production records were created.

## Release and rollback

Publish through the existing GitHub main → Cloudflare Pages pipeline after checks pass. Confirm the exact commit and live deployment, then remeasure signed-in account/admin layouts and the public homepage. This frontend-only release requires no Convex backend deployment or data migration. To roll back, revert the responsive-layout merge on main and observe the resulting Pages deployment; retain all database data and existing backend configuration.
