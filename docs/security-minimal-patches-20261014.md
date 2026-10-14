# Minimal Security Patches, 2026-10-14

## Decision And Version Changes

Official GitHub advisory records, the vendor SheetJS installation guide, actual installed package versions and application imports were reviewed before changes. No blanket audit fix, major upgrade, unrelated package upgrade, database operation or paid chatbot request was performed.

| Package | Before | After | Reason |
| --- | --- | --- | --- |
| next | 16.3.4 | 16.3.8 | Smallest same-minor patch covering the reviewed Next advisories; Node and React peer ranges remain compatible. |
| eslint-config-next | 16.3.4 | 16.3.8 | Keep the Next lint configuration on the matching patch line. |
| handlebars, transitive through @langchain/community -> @langchain/classic | 4.7.9 | 4.7.10 | Same-major patch within the parent's ^4.7.9 range. |
| xlsx | 0.18.5 | 0.20.2 | The manual upload/parser paths read supplied workbook files; 0.20.2 is the minimum release fixing both reviewed SheetJS CVEs. |
| sharp, Next optional dependency | 0.35.4 | 0.35.5 | Minimum patched version within Next 16.3.8's existing ^0.35.4 range; no override or direct dependency was added. |

The package lock records the official SheetJS tarball URL and integrity. The public npm xlsx endpoint is stale; the [official Node installation guide](https://docs.sheetjs.com/docs/getting-started/installation/nodejs/) identifies cdn.sheetjs.com as authoritative. Dependency manifests and lock changes are included; environment files, credentials, private execution modules, logs and ledgers are excluded.

## Official Advisory Evidence

| Official Advisory | CVE | Condition / Applicability | Fixed Release |
| --- | --- | --- | --- |
| [Next ImageResponse](https://github.com/vercel/next.js/security/advisories/GHSA-vcvr-r3jv-pc5j) | No CVE assigned in the official GHSA record at review | Attacker-controlled SVG values passed to Node next/og ImageResponse. No such application import or route found; patched in the framework regardless. | 16.3.6 |
| [Draft-mode cache fill](https://github.com/vercel/next.js/security/advisories/GHSA-3w37-wq28-93x7) | CVE-2026-94544 | Cache Components/use cache plus draft-dependent previews. Not enabled in this application. | 16.3.8 |
| [Pages Router SSG/ISR cache poisoning](https://github.com/vercel/next.js/security/advisories/GHSA-4jqv-mc3x-m676) | CVE-2026-94543 | Self-hosted Pages Router SSG/ISR. Application uses App Router. | 16.3.8 |
| [Development MCP disclosure](https://github.com/vercel/next.js/security/advisories/GHSA-39w2-rjm5-chcv) | CVE-2026-94486 | A malicious site can reach the development server MCP endpoint. Applies to the next dev workflow; not a production endpoint. | 16.3.8 |
| [Metadata dynamicParams bypass](https://github.com/vercel/next.js/security/advisories/GHSA-f87g-xv8r-7p7x) | CVE-2026-94485 | webpack App Router dynamic metadata images. No such metadata-image route found; build uses Turbopack. | 16.3.8 |
| [Catch-all SSG/ISR poisoning](https://github.com/vercel/next.js/security/advisories/GHSA-mcj8-r9mp-w47p) | CVE-2026-94484 | Root catch-all plus shared statically generated/ISR routes. No root catch-all found. | 16.3.8 |
| [Image optimization SSRF](https://github.com/vercel/next.js/security/advisories/GHSA-cjq9-62q9-8jv4) | CVE-2026-94483 | Attacker-controlled allow-listed remote image URL. No images.remotePatterns configured. | 16.3.8 |
| [Handlebars inline precompile](https://github.com/handlebars-lang/handlebars.js/security/advisories/GHSA-xw65-4hp5-5hc7) | CVE-2026-106444 | Precompiled untrusted template embedded inline in HTML. No such app use found. | 4.7.10 |
| [Handlebars AST confusion](https://github.com/handlebars-lang/handlebars.js/security/advisories/GHSA-8r5x-fm3f-whwj) | CVE-2026-106446 | Untrusted AST object passed to compile/precompile; string-only use is not affected. No direct app compile/AST entry point found. | 4.7.10 |
| [Handlebars prototype bypass](https://github.com/handlebars-lang/handlebars.js/security/advisories/GHSA-p8wg-vrv2-v86f) | CVE-2026-106445 | Controlled template plus allowProtoMethodsByDefault=true. No such option found in the app. | 4.7.10 |
| [SheetJS prototype pollution](https://github.com/advisories/GHSA-4r6h-8v6p-xvw6) | CVE-2023-30533 | Reading specially crafted workbooks. Applies to manuals extract-text/extract-manual-file-text. | 0.19.3 from official CDN |
| [SheetJS ReDoS](https://github.com/advisories/GHSA-5pgg-2g8v-p4x9) | CVE-2024-22363 | Workbook parser input. Applies to the manual upload workflow. | 0.20.2 from official CDN |
| [sharp/librsvg](https://github.com/lovell/sharp/security/advisories/GHSA-wq5f-xc86-pv6w) | Upstream CVE-2026-96889; GHSA CVE field unassigned | SVG decoding under affected glibc Linux runtime conditions. Avatars allow only JPEG/PNG/WebP and default SVG optimization is not enabled; compatible patch applied defensively to Next's image dependency. | sharp 0.35.5 |

## Remaining Audit Warnings

The initial audit had 13 package advisories including two Critical package aggregates. After scoped patches there are zero Critical and nine High package aggregates. This is not a claim that npm audit is globally clean.

Remaining packages are axios and ibm-cloud-sdk-core through unused community adapters; source-map-js parsing build-generated maps; brace-expansion/braces and their fast-glob/micromatch/Next ESLint parents operating on repository-owned build/lint patterns. No direct application imports of axios, IBM community adapters, Handlebars, unsafe template compilation, or attacker-supplied source-map/glob pattern routes were found. No arbitrary major downgrade of eslint-config-next or unrelated community-adapter upgrade is performed.

These residual conditions must be reviewed again if those adapters are introduced, source-map/pattern input becomes remotely controllable, or deployment configuration changes. They are documented rather than suppressed; no audit failure is disguised as a clean audit.

## Verification

- SheetJS focused parsing, format fixtures and confirm contracts: 68 tests passed immediately after the patch.
- sharp synthetic PNG resize/encode/decode: passed using the installed 0.35.5 library, without external image requests.
- Post-patch verify:poc passed all seven steps: integration structure/tests, RAG/manual/notification tests, evaluation tests, lint, generated types/application typecheck and production build. Lint has zero errors and 89 pre-existing warnings in this selected worktree.
- Separate authentication/OTP/role regression: 347 tests passed. SheetJS focused parser/approval regression: 68 passed. RAG targeted regression: 205 passed. Staff UI/history regression: 23 passed.
- Desktop 1440px and mobile 390px actual component/build-CSS screenshots were inspected with all external requests blocked. Scope/shortage/support badges are distinct, source titles remain, relevance numbers are absent and no horizontal overflow was detected. These are offline UI fixtures, not new live chatbot calls or the user's personal Chrome acceptance.
- Production tracing must still be checked for private files at the final staged revision. GitHub PR checks and base-branch freshness are required before merge; no failing core check is bypassed.
- Authentication, role denial, manual approval/indexing and escalation tests use injected clients and synthetic data, not remote writes. No new live chatbot question, provider call, embedding or manual approval is authorized by this review.
- Opening/closing final actual checks, long conversation acceptance and the existing-manual-editing E2E remain unverified. Main and Render deployment are excluded.