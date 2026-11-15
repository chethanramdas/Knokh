# Golden Sunrise homepage release

## Scope
React 19, Vite, TypeScript and Tailwind v4. Existing store shell, homepage sections,
logo and product cards are retained. No authentication, supplier, payment, API,
or database implementation changes are included in this release. PR #3 continues
separately.

## Implementation
- One shared CSS gradient: `linear-gradient(180deg, #F5A623 0%, #FFD36A 35%, #FFF0C2 72%, #FFFFFF 100%)`.
- A ResizeObserver measures the existing header and top discovery content. Only the
  background's paint height changes; content is not repositioned. The gradient
  ends where the first configured product section starts, with no fixed height.
- Homepage-only supporting tokens, white search controls, data-driven category
  navigation, cream promotional cards and responsive product-card action wrapping.
- Sticky header uses a translucent white surface so dark text remains readable
  even over a dark product image. Keyboard skip link, focus rings, Escape to close
  suggestions and reduced-motion rules are included.
- The approved logo is unchanged. SHA-256:
  `9b999c0bcb9461105831b20d8e5b3a24b573ab33f086b797c5c5daf8d85c51c1`.
- A pre-existing lockfile mismatch omitted XLSX and its dependencies. The lockfile
  was repaired without changing any already locked package versions.
- `npm run typecheck` uses the installed Convex templates and the real schema to
  generate local strict types without requiring production credentials. It does
  not deploy functions or change data.

## Local verification
- Production build: passed.
- Full TypeScript project check: passed.
- ESLint on the two modified TSX files: passed, no warnings/errors.
- Existing unit suite: 22 passed, 0 failed (`npx --yes bun test tests/knokh.test.ts`).
- `npm run test:contrast`: passed. Minimum foreground contrast 7.78:1; secondary
  text 4.53:1; focus ring 4.14:1 across sampled gradient positions. Input boundaries,
  placeholders and the sticky header's worst-case dark backdrop are also checked.
- CSS adds no images, fonts, runtime packages or new service subscriptions.

Browser, responsive, accessibility, functional and production checks are recorded
in the final delivery report after preview verification; this document does not
claim those checks have already happened. LCP/CLS/INP targets require real-user or
lab measurement and are not guaranteed by these code checks.

## Release and rollback
Merge the tested feature PR into `main`. Cloudflare Pages' existing GitHub build
publishes `knokh-preview` to `knokh.com`. Verify the exact commit and live page.
Rollback uses Cloudflare Pages' prior successful deployment or a normal revert of
this release commit. Do not reset databases, seed products, remove user records,
or purge unrelated storage/caches.
