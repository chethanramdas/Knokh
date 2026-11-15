# Dependency audit — supplier working branch

Audit command: `npm audit --omit=dev --json` (2026-11-15).

The audit is **not clean**. These are dependency findings, not proof of exploitation or a complete security assessment.

| Package | Severity | Reported remediation |
| --- | --- | --- |
| @auth/core | critical | @convex-dev/auth 2.0.0 (major upgrade) |
| @convex-dev/auth | critical | @convex-dev/auth 2.0.0 (major upgrade) |
| axios | high | Compatible update reported |
| follow-redirects | high | Compatible update reported |
| hono | moderate | Compatible update reported |
| nanoid | high | Compatible update reported |
| postcss | high | Compatible update reported |
| react-router | high | Compatible update reported |
| source-map-js | high | Compatible update reported |
| vite | high | Compatible update reported |
| xlsx | high | No registry fix reported |
| zod | high | Compatible update reported |

The current authentication package requires a major upgrade to resolve the reported transitive Auth.js advisories. This release does not change working production authentication without dedicated migration and regression tests. XLSX has no registry fix reported by npm; treat imported files as untrusted, enforce existing size/row limits, and plan a separately verified parser replacement or vendor-supported update. Compatible dependency updates also require a tested maintenance release; no audit checks were suppressed.

Release blockers: staging backend deployment and authenticated end-to-end verification; provider credentials/current API contract for automatic supplier operations. No claim of complete production security or sandbox integration is made.

Full-repository lint also reports existing errors in shared UI hooks, payment types and other untouched modules. Changed supplier/import/checkout code and tests are checked separately; no lint rule was disabled to hide those findings.
