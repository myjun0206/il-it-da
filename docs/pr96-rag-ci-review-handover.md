# PR #96 RAG CI Review Handover

## State (2026-10-07)

- Review worktree: `C:\Users\farew\Desktop\il-it-da-pr96-rag-ci-review-20261007`
- Review branch: `fix/pr96-rag-ci-review`, tracking `origin/feature/rag-api`.
- Actual PR source: `myjun0206/il-it-da:feature/rag-api`; destination: `develop`.
- HEAD / intended first merge parent: `161852dbdad302f2519e8289056d9ada9d2cd406`.
- MERGE_HEAD / intended second merge parent: `d7b3849f2cc53479f53c9cdd18d2dd3b240300ef`.
- A merge commit does not exist yet. `git merge --no-commit --no-ff origin/develop` completed without conflicts and stopped before commit.
- Source of the fixes: detached worktree `C:\Users\farew\Desktop\il-it-da-pr96-rag-ci-20261007`, HEAD `3213a20c2dbde543ace5615115c97195d3f23859`.
- Fetch confirmed PR head remains `161852d`; origin/develop advanced from the earlier `1804992` reference to `d7b3849`. The two latest endpoints match the parents of the earlier CI merge.
- Before applying fixes, the newly merged tracked tree was identical to `3213a20` (`git diff --exit-code 3213a20...` with the full SHA and no revision range returned no differences).
- The ten tracked fix diffs and the hook's new-file diff were exported and applied with `git apply --check` then `git apply`. No whole-file copying or CI merge cherry-pick was performed. The detached source worktree remains intact.
- Develop's integration changes are staged by the merge. The transferred fixes and this report remain unstaged/untracked. Do not commit the current index alone: it does not contain all fixes.

## Why the CI Failed

1. The store-request source assertion expected `select("franchise_id")`, while the route correctly reads `select("store_name, franchise_id")` using the requested store ID. The assertion now requires that exact projection and ID filter. New tests execute the actual POST handler with injected Auth/DB clients and record its queries and submission.
2. The PR membership service silently corrected a conflicting client brand or could create a new store when an existing normalized store name had an incompatible brand. The fix restores rejection without writes, preserves unknown-brand rejection, and still allows explicit selection among actual same-name stores of different brands.
3. The DB mock lacked the PR's `ilike()` name lookup. It now implements pattern matching while keeping the existing authorization/rejection assertions. Tests also cover normalized names and no duplicate store creation.
4. The PR head's HQ layout uses a fragment, but the develop merge uses HQShell. The integration tests now strictly require the actual shell import and exactly one wrapper. The four HQ ready-state effects are replaced by a single hydration snapshot hook without changing page markup, handlers, API calls or role guards.
5. The component harness now implements the hook contract, and the HQ notice fixture removes only the obsolete ready-state state slot. Notice scope, filters and authorization assertions remain.

## Behavior Verification

- Actual POST execution reads the session user's profile and the requested DB store's name/brand, rather than client-provided user, role, approval, name or brand.
- Unauthenticated callers, non-owner roles and pending/rejected owners are denied before store lookup/submission.
- Missing stores, missing brands, DB read failure and invalid IDs cannot submit or fall back to an untrusted name.
- Brand conflicts and unknown brands do not insert/update stores or memberships.
- TypeScript AST inspection found one HQShell in the layout, no duplicate HQShell in the four touched pages, one hook definition and one hook call per page.

## Executed Checks

| Check | Result |
| --- | --- |
| npm ci in review worktree | Passed; existing dependency audit reports 12 vulnerabilities (11 high, 1 critical); no automatic audit fix was performed |
| Store/brand/membership/layout focused tests | 107/107 passed |
| npm run test:rag, including pretest dependency check | 1430/1430 passed |
| npm run test:rag-eval | 239/239 passed; no model calls |
| npm run test:auth | 246/246 passed |
| Example CSV conversion | 3 input / 3 output items |
| Converted and original example JSON validation | 3 items each, 0 errors |
| npm run check:frontend | 5/5 passed: lint, typecheck, production build, PR whitespace check, frontend regression tests (102/102) |
| Staged and unstaged git diff --check | Passed |

Frontend build used a closed localhost Supabase URL and a non-secret placeholder key only in the command's temporary process environment. The prior values were restored afterwards. The original environment file was not copied into this worktree. These results reproduce the CI commands locally, not a newly executed GitHub CI run; actual Supabase/provider/SMTP/mail behavior was not exercised.

The PR whitespace range used the fetched develop and feature/rag-api SHAs above. Local staged and unstaged whitespace checks were also run, because the new merge/fix commit has not been created yet.

## Complete Change List

Relative to the PR HEAD, tracked integration plus fix changes are the following 21 paths. The hook and this handover are two new untracked files, for 23 changed/new paths in total.

```text
app/hq/approvals/page.tsx
app/hq/communication/new/page.tsx
app/hq/communication/page.tsx
app/hq/layout.tsx
app/hq/manuals/common/page.tsx
app/hq/manuals/page.tsx
app/hq/manuals/stores/page.tsx
app/hq/page.tsx
app/hq/settings/page.tsx
app/hq/stores/[id]/page.tsx
app/hq/stores/page.tsx
app/hq/stores/requests/page.tsx
components/hq/HQHeader.tsx
components/hq/HQShell.tsx
lib/hq/selected-store.ts
lib/signup/store-membership-service.ts
tests/auth/protected-layouts.test.ts
tests/auth/store-brand-authority.test.ts
tests/notices/notice-scope.test.ts
tests/owner/owner-store-request.test.ts
tests/support/component-harness.ts
lib/hq/use-client-ready.ts
docs/pr96-rag-ci-review-handover.md
```

The transferred CI fixes themselves are the four HQ pages (approvals, communication, manuals/common, manuals/stores), membership service, five test/harness paths (protected-layouts, store-brand-authority, notice-scope, owner-store-request, component-harness), and the new hook. The other paths above are develop integration changes, not extra CI-fix edits.

## Commands After Explicit Commit/Push Approval

These commands have NOT been executed. They finish the pending merge with the fixes and update the existing PR source branch rather than creating an unrelated pushed review branch.

```powershell
Set-Location 'C:\Users\farew\Desktop\il-it-da-pr96-rag-ci-review-20261007'
git fetch origin develop feature/rag-api
if ($LASTEXITCODE -ne 0) { throw 'Fetch failed; do not commit or push stale endpoints' }
if ((git rev-parse HEAD) -ne '161852dbdad302f2519e8289056d9ada9d2cd406' -or (git rev-parse MERGE_HEAD) -ne 'd7b3849f2cc53479f53c9cdd18d2dd3b240300ef' -or (git rev-parse origin/feature/rag-api) -ne '161852dbdad302f2519e8289056d9ada9d2cd406' -or (git rev-parse origin/develop) -ne 'd7b3849f2cc53479f53c9cdd18d2dd3b240300ef') { throw 'Integration endpoints changed. Reconcile and rerun the full checks before committing.' }
git add -- app/hq/approvals/page.tsx app/hq/communication/page.tsx app/hq/manuals/common/page.tsx app/hq/manuals/stores/page.tsx lib/signup/store-membership-service.ts tests/auth/protected-layouts.test.ts tests/auth/store-brand-authority.test.ts tests/notices/notice-scope.test.ts tests/owner/owner-store-request.test.ts tests/support/component-harness.ts lib/hq/use-client-ready.ts docs/pr96-rag-ci-review-handover.md
if ($LASTEXITCODE -ne 0) { throw 'Staging failed; do not commit a partial index' }
git diff --cached --check
if ($LASTEXITCODE -ne 0) { throw 'Staged whitespace check failed' }
git diff --cached --stat
git status -sb
git commit -m 'fix: integrate develop and restore store brand CI contracts'
if ($LASTEXITCODE -ne 0) { throw 'Merge commit failed; do not push' }
git log -1 --format='%H %P'
git push origin HEAD:feature/rag-api
```

Review the staged diff before running commit. Do not use force-push, a bare `git push`, or cherry-pick the synthetic CI merge. If another contributor has advanced the remote head, stop and coordinate; the ordinary explicit-refspec push must remain fast-forward. Future endpoint changes require repeat integration/CI verification. The full CI command sequence is in `.github/workflows/ci.yml`; `test:auth` is additionally required for this review.

## Preserved Original Work

- Original worktree: `C:\Users\farew\Desktop\il-it-da`.
- Branch remains `feature/owner-staff-email-otp`; HEAD remains `18049922703c599d17b3967bf197a225c5faee9f`.
- Before/after comparison passed for the original porcelain file status, stash OIDs/subjects and all 35 preserved file hashes, including environment files and desktop.ini. The shared remote-tracking refs advanced only through the explicitly authorized fetch.
- No original OTP files, stash or environment files were moved/reverted/rewritten. No commit/push, shared DB/Auth/SMTP changes, real mail or paid calls were performed.