# Final Email-First Signup and HQ CI Integration

## Single integrated candidate

- Base: latest develop `484a0e6620c16458aa629be13d2290ed620792d6`.
- Worktree: `C:/Users/farew/Desktop/il-it-da-final-combined-20261008`.
- Branch: `fix/develop-email-first-hq-integration-20261008`.
- Preserved original: `C:/Users/farew/Desktop/il-it-da`, develop HEAD `55a3b6e7a40b2fc96af64267bbaf67932d57cc94`, uncommitted email-first/039/CSS work and original server untouched.
- CI review input: `fix/song-hq-notice-ci-20261008` on the base above. Inputs remain in their original worktrees; no original pull/checkout/stash movement.

Original tracked differences were applied with a three-way patch, and a strict allowlist copied new email-first API/library/039/preflight/postflight/tests. Environment, desktop.ini, caches, logs and runtime secrets were excluded. The only transfer conflict was a historical CSS report: both sides intended to eliminate invalid Tailwind examples. It was resolved as a precise explanatory sentence, not a whole-file ours/theirs choice. The generated-CSS regression passed immediately afterward. The CI patch then applied without conflicts.

## Combined implementation

- Owner/staff email-only OTP request, six digits, absolute 180-second deadline, reload-safe resend/expiry and email-change reset, final information/password validation and incomplete-account retry.
- Official passwordless OTP plus authenticated password setup; existing profiles/memberships/social/HQ accounts protected. Current request IDs, successful sent acknowledgement, fresh verifyOtp JWT/getUser validation, service-only verified/completed records and delayed pending membership creation.
- Reviewed 039 plus read-only preflight/postflight, type/role guards, one-shot sent, post-lock clock and reviewed body MD5. SQL remains a deployment artifact and was NOT applied to shared DB in this integration.
- Latest Song HQ/staff UI retained. Fix the HQ notice state fixture exactly; exercise current shell and URL-based store/manual navigation, scoped/foreign-data filtering and error retry; remove redundant manualId state/effect instead of disabling lint.
- Reattach the existing HQ common-manual readiness/reindex panel without reverting new UI. **Owner store-manual readiness panel stays removed**: app/boss/store-manuals/page.tsx is identical to latest develop, no ManualSearchReadinessPanel, save-message-based retry retained.
- Preserve CSS fix and generated-Tailwind regression. No source-scan rule disabling or placeholder class example.

Production notice page/filter/count/detail/API, HQHeader/HQSidebar/HQShell and authorization code are unchanged from the latest develop input. The only HQ page differences are common readiness reattachment and directly URL-derived detail selection. Owner readiness is not restored. No global file replacement or feature rollback.

## One-codebase validation

| Check | Result |
| --- | --- |
| npm ci | Pinned lockfile, 511 packages; no dependency upgrade |
| Notice/HQ/manual/email-first focused suite | 264/264 |
| CI npm run test:rag and test TypeScript compile | 1464/1464 |
| Entire Auth | 306/306 |
| RAG evaluation tools | 239/239 |
| Owner escalation/manual follow-up | 440/440 |
| Integration tool tests | 79/79 |
| Actual isolated PostgreSQL 039 regression | 2/2, synthetic local data only |
| Frontend gate | 5/5: lint, typecheck, production build, whitespace/conflict and frontend 103/103 |
| Repository integration | 9 checks; errors/warnings 0; historical prefix gaps are info |
| CI CSV conversion and both JSON validations | 3 -> 3; 0 errors |
| Owner desktop/staff mobile browser | 2/2 on this candidate, all OTP/API/network operations mocked |
| git diff --check | Pass |

Browser dev runs separately at localhost:3101 with dummy provider configuration and both readiness flags false. The original localhost:3000 server is preserved. No live mail or shared data mutation. Local/mock acceptance does not prove provider inbox delivery, configured project OTP 6/180 or arbitrary live RAG quality. Existing audit findings/warnings are not hidden or bulk-fixed.

## Operational and Git boundary

The user reports shared 039/schema/grants checks completed; do not reapply it. This task makes no DB/Auth/SMTP change. Public/local secret environment values are never committed. New policy readiness is not automatically enabled in an environment file.

All local mandatory checks passed before staging/commit/push. The user explicitly authorized commit, normal push and a develop-target PR for this integrated candidate; automatic PR merge and force-push are prohibited. Earlier copied handovers describe their historical individual phases and are not claims that this final integration is still uncommitted/unpushed. The PR/run links and actual cloud outcome are reported after execution, not inferred from local passes.

Original file/hash/status/stash/server checks use the temporary final-combined preservation snapshot before final completion. No original or CI review input is reset, reverted or committed by this task.