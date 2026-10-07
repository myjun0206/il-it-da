# Develop OTP Integration and Stabilization

## Basis and preservation

- Date: 2026-10-07.
- Original worktree: `C:/Users/farew/Desktop/il-it-da`.
- Original branch: `feature/owner-staff-email-otp`; HEAD `18049922703c599d17b3967bf197a225c5faee9f`.
- Original index was empty; 17 tracked modified files and 17 untracked files, including `desktop.ini`; stash `72fad7dad0636ee4d5c1d05d85bf342bb50b48b9` (`handoff: local login changes`) preserved.
- Integration worktree: `C:/Users/farew/Desktop/il-it-da-final-integration-20261007`.
- Integration branch: `fix/develop-otp-integration-stabilization`.
- HEAD/base: `3ae3cb978c85413f4e3f7d60aea596c18013a03b`, latest origin/develop verified by fetch and read-only ls-remote. No pending merge or new commit.
- PR #96 (Gong Taehyun), head `163ccc6209fe56f380eda575922ea1bd59fb7cab`, merged as `07c894191d1eaa8af1fb4040e1841e8bed87beaa`.
- PR #97 (Song Chaehyun HQ UI CI supplementation), head `8b67caa2122f668a798f45eb2a71f53684404912`, merged as the base above. Both heads are verified ancestors of origin/develop.
- All five pre-existing usable worktrees were snapshotted to a temp CLIXML before transfer (2747 file hashes including original environment/desktop.ini). Missing historical prunable worktree entries were left alone. No source pull, branch change, stash pop, worktree cleanup, commit, or push.

Final preservation result: the original OTP, both PR #96 worktrees, and the committed UI review worktree match all **2203 recorded hashes**, HEAD, branch, status and stash. Original environment and desktop.ini bytes/attributes are preserved. Exception: the detached `C:/Users/farew/Desktop/il-it-da-ui-notice-failed-20261007` baseline directory disappeared during the task; its git worktree entry is now prunable. No agent command deleted that path, and the actor/cause was not independently determined. It was neither automatically recreated nor pruned. Do not claim all five worktrees still exist or all 2747 files passed the final comparison. The baseline SHA remains `18049922703c599d17b3967bf197a225c5faee9f`.

## Integration and fixes

Tracked OTP differences were exported with `git diff --binary` and mechanically transferred with a three-way apply. New OTP files were copied only from an explicit allowlist. Environment files, desktop.ini, screenshots, temp logs and runtime secrets were not copied. The identical existing hydration hook was not overwritten.

Three conflicts were resolved locally:

1. Signup approval: retain verified-session requirement, no stored/signup password, returned membership status, inline OTP errors, partial-success pending state, and upstream diagnostic request ID.
2. Initial membership POST: retain upstream malformed-body/UUID checks, role/brand isolation and diagnostic headers; run actual email confirmation and initial terms/email/profile validation before any write. Defer profile creation into the service's eligibility-checked ensureProfile callback, retaining the existing approved-profile no-write behavior. Capture verified `user.id` rather than a nullable mutable diagnostic variable in that callback.
3. Protected layout tests: keep upstream strict one-HQShell/role/redirect/hydration assertions without duplicate imports or duplicate equivalent tests.

Actual failures reproduced and repaired:

- HQ store selection: selecting store-b retained store-a because HQShell POSTed to a missing `/api/hq/set-default-store` route. That route was absent in both the original HQ source and latest develop, with no rewrite replacement. The existing contract is tab-local `hqSelectedStoreId`, not a persistent server preference. Remove the unavailable write request and allow selection only inside the authenticated `/api/hq/stores` response. Do not introduce a database write endpoint or treat client selection as authorization; store APIs still enforce their server guards.
- Mobile HQ header: after choosing a long store name, the actual notification button was outside the viewport even though document overflow was false (the shell clips overflow). Reproduced with Playwright trial clicks. Reserve mobile menu space, let the selector shrink, and bound its mobile dropdown inside the viewport; preserve desktop alignment and all notification/profile/navigation handlers.
- Frontend typecheck: the newly merged delayed callback captured `string | null` diagnostic userId. Use the authenticated immutable user.id. Reran the failing complete frontend gate successfully.
- Test environment: Playwright Chromium was absent. Installed the existing pinned version's browser binary, without upgrading dependencies. A new actual-handler VM regression initially lacked process; inject only a non-secret OTP-length setting, not real process secrets. No assertions were weakened to hide failures.

Preserved upstream features: HQShell/shared layout, four hydration-gated pages, HQSidebar, all HQ pages, notices aggregation/row mapping/card/detail count and no HQ mark-read request, signup service brand checks, owner/staff store approval isolation, social/HQ auth and session paths. HQHeader/HQShell differ only by the two targeted fixes above. No RAG core or question/manual workflow production code was changed.

## Verification results

All results are local. SDK/session/API/browser fixture mocks are not actual provider login, email delivery, shared database verification, or live model/search quality.

| Check | Final result |
| --- | --- |
| npm ci | Pass, existing lockfile; 510 packages |
| CI RAG incl. TypeScript test compile | 1447/1447 |
| Auth | 273/273 |
| RAG evaluation tools, no model calls | 239/239 |
| Owner escalation/manual workflow regression | 440/440 |
| Integration tool regression | 79/79 |
| Frontend quality gate | 5/5: lint, typecheck, production build, whitespace/conflict, structure 102/102 |
| Repository integration | 9 checks; errors 0, warnings 0; existing 014/015 prefix gaps are info |
| Example CSV conversion | 3 -> 3 |
| Converted and original JSON validation | 3 items / 0 errors each |
| Owner + HQ page mock browser | 6/6 |
| Owner header mock browser | 6/6 |
| Owner question/manual follow-up mock browser | 9/9 |
| OTP owner/staff mock browser (Edge) | 2/2 |
| Actual local disabled runtime boundary | Anonymous OTP status 401; HQ stores 403; disabled OTP start 503 EMAIL_OTP_UNAVAILABLE; foreign Origin 403 |

Browser coverage includes real components/CSS with injected auth/data, external network blocked, 320/390/1280px owner/HQ screens, long names, visible/clickable controls, store changes, 0/7 notice count detail propagation, loading/error/empty states, OTP validation/resend wait/resume/leading-zero code/email change/no password storage, exact manual target/edit/save/search-status/retry/question return/manual completion and conflicts. HQ mobile/desktop screenshots were inspected. Screenshots/logs live under temp or ignored `.next`, not source control.

RAG checks preserve menu disambiguation, colloquial query/menu rules and scoped same-conversation family-pack follow-up history. These deterministic/prompt/mock checks do not prove arbitrary live follow-up quality or production retrieval accuracy. No paid evaluation was run.

Build/server use only `http://127.0.0.1:1` Supabase placeholder URL and a non-secret placeholder key; readiness remains false. No environment file was created/copied. Existing lint warnings and npm audit findings (11 high, 1 critical) were not disabled or repaired by bulk upgrades/audit fix.

Final local visual server: `http://localhost:3110`, production build, dummy provider configuration, OTP disabled. Installed NextURL normalizes loopback IP hostnames to localhost; an initial request with Origin `http://127.0.0.1:3110` was correctly rejected by the strict origin check. Use canonical localhost for local POST smoke checks; the origin guard was not weakened. The final-build OTP mock was rerun at canonical localhost, 2/2 pass. These local anonymous/disabled responses do not demonstrate successful actual provider login or email delivery.

## DB and operational boundary

**User-reported fact:** the user applied 038 to the shared database and checked role permissions. This is recorded as the user's confirmation, not an independent Copilot query/result. Neither 037 nor 038 was applied/reapplied in this integration. The transferred migration and diagnostic SQL are preserved artifacts; do not run them as part of staging or assume migration history has been reconciled automatically.

`OWNER_STAFF_EMAIL_OTP_READY` stays false/unset. New signup remains fail-closed until separate operational acceptance. No shared DB writes, Auth/SMTP changes, actual mail, paid AI calls, or real authenticated account flows were performed. The carried disposable-PostgreSQL test file was not rerun; its historical result is not a new integration result.

Actual acceptance still needed: configured-provider login/session/expiry, OTP inbox/expiry/resend and application/approval against real accounts, HQ/social provider regression, actual store data/approval isolation, real manual indexing/retrieval and multi-turn model quality, and complete production device testing. Do not enable OTP readiness based on mock results alone.

## Full change manifest (32 files)

Paths are relative to the integration worktree; all are intentionally unstaged. The four upstream HQ hydration page patches and duplicate hydration hook do not appear because latest develop already contains the identical changes.

```text
app/(auth)/signup/approval/page.tsx
app/(auth)/signup/profile/page.tsx
app/api/auth/login/route.ts
app/api/auth/signup/route.ts
app/api/auth/signup/owner-staff/resend/route.ts
app/api/auth/signup/owner-staff/start/route.ts
app/api/auth/signup/owner-staff/status/route.ts
app/api/auth/signup/owner-staff/verify/route.ts
app/api/signup/store-membership/route.ts
app/page.tsx
components/hq/HQHeader.tsx
components/hq/HQShell.tsx
lib/auth/auth-callback.ts
lib/auth/auth-email-settings.ts
lib/auth/owner-staff-signup-server.ts
lib/auth/owner-staff-signup.ts
lib/auth/server-role-guard-core.ts
lib/signup/store-membership-service.ts
docs/owner-staff-email-otp-handover.md
docs/develop-otp-integration-stabilization-handover.md
docs/sql/owner-staff-email-otp-migration-draft.sql
docs/sql/owner-staff-email-otp-postflight.sql
docs/sql/owner-staff-email-otp-preflight.sql
supabase/migrations/038_owner_staff_email_otp.sql
tests/auth/auth-callback.test.ts
tests/auth/protected-layouts.test.ts
tests/auth/require-server-role.test.ts
tests/auth/signup-profile-membership.test.ts
tests/auth/owner-staff-signup-postgres.test.mjs
tests/auth/owner-staff-signup-ui.test.mjs
tests/auth/owner-staff-signup.test.ts
tests/owner/owner-pages-ui.test.mjs
```

## Exact staging commands (prepared, not executed)

```powershell
$wt = 'C:/Users/farew/Desktop/il-it-da-final-integration-20261007'
$files = @(
  'app/(auth)/signup/approval/page.tsx'
  'app/(auth)/signup/profile/page.tsx'
  'app/api/auth/login/route.ts'
  'app/api/auth/signup/route.ts'
  'app/api/auth/signup/owner-staff/resend/route.ts'
  'app/api/auth/signup/owner-staff/start/route.ts'
  'app/api/auth/signup/owner-staff/status/route.ts'
  'app/api/auth/signup/owner-staff/verify/route.ts'
  'app/api/signup/store-membership/route.ts'
  'app/page.tsx'
  'components/hq/HQHeader.tsx'
  'components/hq/HQShell.tsx'
  'lib/auth/auth-callback.ts'
  'lib/auth/auth-email-settings.ts'
  'lib/auth/owner-staff-signup-server.ts'
  'lib/auth/owner-staff-signup.ts'
  'lib/auth/server-role-guard-core.ts'
  'lib/signup/store-membership-service.ts'
  'docs/owner-staff-email-otp-handover.md'
  'docs/develop-otp-integration-stabilization-handover.md'
  'docs/sql/owner-staff-email-otp-migration-draft.sql'
  'docs/sql/owner-staff-email-otp-postflight.sql'
  'docs/sql/owner-staff-email-otp-preflight.sql'
  'supabase/migrations/038_owner_staff_email_otp.sql'
  'tests/auth/auth-callback.test.ts'
  'tests/auth/protected-layouts.test.ts'
  'tests/auth/require-server-role.test.ts'
  'tests/auth/signup-profile-membership.test.ts'
  'tests/auth/owner-staff-signup-postgres.test.mjs'
  'tests/auth/owner-staff-signup-ui.test.mjs'
  'tests/auth/owner-staff-signup.test.ts'
  'tests/owner/owner-pages-ui.test.mjs'
)
git -C $wt add -- $files
git -C $wt diff --cached --check
git -C $wt diff --cached --stat
git -C $wt status -sb
```

Do not use `git add .`, apply SQL, enable readiness, commit or push as part of this preparation. Recheck origin/develop before later authorization; no commit/push command has been executed or supplied here.

## Develop PR draft

**Title:** Integrate owner/staff email OTP and stabilize HQ selection/mobile UI

**Base:** develop

**Proposed head:** fix/develop-otp-integration-stabilization (local only; not pushed)

### Summary

- Integrate preserved owner/staff password-signup OTP work on top of merged PR #96/#97 without reverting HQ UI, brand isolation, social/HQ login or owner manual follow-up.
- Keep signup fail-closed, require confirmed email/initial terms and eligible store before profile/membership writes, return pending approval, and remove stored signup passwords.
- Restore tab-local HQ store selection without a nonexistent server-write endpoint; retain server store authorization and fix mobile notification/menu access with long store names.
- Add actual-handler and mock-browser regressions without deleting tests, weakening assertions, disabling rules, or upgrading dependencies.

### Verification

RAG 1447, Auth 273, evaluation tools 239, owner workflow 440, integration tools 79: all pass. Frontend 5/5; CSV/JSON and repository checks pass. Mock browsers: owner/HQ pages 6, header 6, follow-up 9, OTP 2: all pass.

### Deployment boundary

The user reports shared 038/role verification complete; this PR/session does not reapply 037/038. OTP readiness remains false/unset. No environment/desktop.ini/runtime-secret/temp artifacts are included. Real provider login/email, real DB workflow and live RAG/search acceptance remain outstanding and must not be inferred from mocks.