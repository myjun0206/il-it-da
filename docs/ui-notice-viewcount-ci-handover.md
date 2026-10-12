# UI Notice View-Count CI Handover

## Target and isolation

- User-confirmed target: Song Chaehyun's staff-final-polish integration, CI run `37467152990`.
- Verified failed integration SHA: `18049922703c599d17b3967bf197a225c5faee9f`.
- This is a develop push CI investigation, not a claim that an open UI PR exists. PR #96 belongs to Gong Taehyun and is not the UI target.
- No current `origin/feature/staff-final-polish` ref was available. The failed integration head must not be described as the latest UI branch tip.
- Untouched failure baseline: `C:/Users/farew/Desktop/il-it-da-ui-notice-failed-20261007`, detached at the failed SHA.
- Review: `C:/Users/farew/Desktop/il-it-da-ui-notice-review-20261007`, branch `fix/ui-notice-viewcount-ci`.
- Review HEAD remains the failed SHA; `MERGE_HEAD` is latest develop `07c894191d1eaa8af1fb4040e1841e8bed87beaa`. Integration used `git merge --no-commit --no-ff origin/develop` without conflicts. It is still pending, not committed.

## Complete locally reproduced failure list

GitHub job metadata confirmed failure at **Run RAG tests**; later steps were skipped. The list below comes from running the entire RAG suite locally at the exact failed SHA, not from claiming access to its raw GitHub test log: **1422 tests, 1417 pass, 5 fail**.

| File and original line | Test name | Direct failure |
| --- | --- | --- |
| `tests/auth/protected-layouts.test.ts:46` | `renders children unchanged (no UI restructuring)` | Fragment-only return regex does not match the intentional HQShell wrapper. |
| `tests/notices/notice-scope.test.ts:535` | `all role pages use shared card and detail metadata` | `TypeError: notices.filter is not a function`; obsolete HQ hook-state fixture slots. |
| `tests/notices/notice-scope.test.ts:553` | `role filter controls compose without resetting the other active filters (component handlers)` | Same obsolete HQ hook-state fixture; rendering fails before handler checks. |
| `tests/notices/notice-scope.test.ts:883` | `HQ notice title opens an in-page dialog with title, content, and date` | Same obsolete HQ hook-state fixture; rendering fails before opening the dialog. |
| `tests/notices/notice-scope.test.ts:909` | `OWNER and STAFF apply the increment only after a successful read request` | `/viewCount=\{notice\.viewCount\}/` expects the old shared-card prop syntax in the HQ page. |

The last test's title concerns owner/staff, but its failing assertion reads HQ source. Valid count data is not lost. Latest develop already aligns the HQShell expectation, readiness mock, HQ state slots, redesigned filter handlers, and direct HQ count rendering assertions. These inherited integration changes are not newly authored UI fixes in this worktree.

## Actual count path and contract

1. `app/api/hq/notices/route.ts` GET requires HQ authorization, scopes notices by the caller's franchise and allowed audiences, and queries `notice_reads` with `notice_id,user_id` only for returned notice IDs. Database errors return an error response, not a fabricated zero.
2. `lib/notices/with-read-status.ts` `withNoticeViewCounts` groups readers by notice ID and uses a Set of user IDs. Duplicate reads do not inflate the count; absent readers produce numeric `0`. The notice table projection itself has no stored `viewCount` column.
3. GET returns `{ notices }` after aggregation. `readRows ?? []` also produces numeric zero when successful read data is null.
4. `app/hq/communication/page.tsx` fetches `/api/hq/notices`, maps through `toNoticeRow`, and preserves `viewCount: notice.viewCount`.
5. The redesigned HQ card renders `조회 {notice.viewCount}` directly rather than invoking the shared NoticeCard with the former prop string.
6. Clicking the card spreads the selected row into NoticeDetailDialog with `isRead: null`. `components/notices/NoticeDetailDialog.tsx` renders the same count. HQ does not POST a mark-read request on opening.

Valid API responses require a numeric count. Missing read records are normalized at the API boundary to zero. A malformed response that omits the count field is outside that contract: the existing page/dialog preserve undefined and do not silently display a genuine zero. No new fallback, database column, or counting rule was introduced.

## New manual changes

- `tests/notices/notice-scope.test.ts`: five behavior tests in the existing file, with no test removal or production-code change.
- Three cases execute the actual GET handler with an injected in-memory admin/auth adapter, then the actual page fetch/effect, row conversion, rendered card, click handler, detail props, and rendered dialog: empty reads -> 0; duplicate/unique reads -> 2; null read data -> 0.
- Fixtures have no stored count field and include a foreign-brand notice/read. Assertions verify exact count, actual own-brand API output, query scoping, no foreign content, preserved detail count, and `isRead: null`.
- A fourth case checks unauthorized GET returns 403 before any query. A fifth preserves the existing malformed-response omission behavior instead of inventing zero.
- This handover document is the only other newly authored file. The separately staged develop integration spans existing upstream changes, including previously merged PR #96 work; neither PR #96 worktree was edited.

## Local verification

Node 24 on Windows; these are local results, not a newly triggered cloud CI run.

| Check | Result |
| --- | --- |
| `npm ci` in baseline and review | Pass, 510 packages each |
| Focused `tests/notices/notice-scope.test.ts` | 100/100 pass |
| `npm run test:rag` including TypeScript test compilation | 1435/1435 pass |
| `npm run test:rag-eval` | 239/239 pass |
| `npm run test:auth` | 246/246 pass |
| CI example CSV conversion | 3 input / 3 output |
| Converted example JSON validation | 3 items / 0 errors |
| Original example JSON validation | 3 items / 0 errors |
| `npm run check:frontend` | 5/5 gates pass: lint, typecheck, build, whitespace/conflict check, frontend structure tests (102/102) |
| Develop integration `git diff --check` | Pass |

Build used process-only `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:1` and a non-secret placeholder anon key; previous process values were restored. Tests injected auth/data rather than accessing shared Supabase. No provider email, paid model call, shared database write, commit, or push was performed. Dependency installation reported the existing 12 audit findings (11 high, 1 critical); no unrelated dependency repair was attempted.

## Preservation and review state

The primary OTP worktree and both existing PR #96 worktrees were snapshotted before this investigation. Preservation comparison uses the same `git status --short` and stash `%H %s` formats as the snapshot, plus HEAD, branch, and SHA256 for the 35 / 547 / 546 recorded files respectively. Do not confuse directory-collapsed versus expanded untracked status, or an added stash reflog label, with a file change.

The review worktree intentionally remains in a pending merge. Separate the inherited staged develop integration from the unstaged notice behavior-test additions and this untracked handover when reviewing. Do not commit or push without separate authorization.

## Commit and push readiness recheck (2026-10-07)

Exact worktree: `C:/Users/farew/Desktop/il-it-da-ui-notice-review-20261007`.

```text
HEAD       18049922703c599d17b3967bf197a225c5faee9f
MERGE_HEAD 07c894191d1eaa8af1fb4040e1841e8bed87beaa
```

Read-only `git ls-remote --heads origin` confirmed develop is still `07c894191d1eaa8af1fb4040e1841e8bed87beaa`, identical to the verified integration basis. Neither `feature/staff-final-polish` nor `fix/ui-notice-viewcount-ci` currently exists as an origin head.

There is **no existing target PR number or live remote head branch** for this local HQ CI review. GitHub's PR records were checked rather than inferred from contributor identity. Song Chaehyun's PR #90 is already merged, targets develop, and has the real head `feature/staff-settings-ui-fixes` at `aba5c5575c7e7e85d0d3c7d622553b3f9257ef74`; it is a separate staff settings/header change, not this HQ integration. PR #96 is the already merged Gong Taehyun RAG work. Do not push the HQ review to either colleague's branch or label it as their PR.

### Requested Git outputs before staging

`git status -sb`:

```text
## fix/ui-notice-viewcount-ci
M  app/(auth)/signup/approval/page.tsx
M  app/api/boss/stores/requests/route.ts
M  app/api/rag/query/route.ts
M  app/api/signup/store-membership/route.ts
M  app/boss/stores/add/page.tsx
M  app/hq/approvals/page.tsx
M  app/hq/communication/page.tsx
M  app/hq/manuals/common/page.tsx
M  app/hq/manuals/stores/page.tsx
M  app/staff/stores/add/page.tsx
A  docs/pr96-rag-ci-review-handover.md
A  lib/hq/use-client-ready.ts
M  lib/rag/openai-embeddings.ts
M  lib/signup/store-membership-service.ts
M  lib/supabase/admin.ts
M  lib/supabase/server.ts
M  package.json
A  scripts/check-rag-dependencies.mjs
M  tests/auth/protected-layouts.test.ts
M  tests/auth/store-brand-authority.test.ts
MM tests/notices/notice-scope.test.ts
M  tests/owner/owner-store-request.test.ts
M  tests/support/component-harness.ts
?? docs/ui-notice-viewcount-ci-handover.md
```

`git diff --stat`:

```text
 tests/notices/notice-scope.test.ts | 116 +++++++++++++++++++++++++++++++++++++
 1 file changed, 116 insertions(+)
```

`git diff --cached --stat` (existing develop integration, not newly authored fixes):

```text
 app/(auth)/signup/approval/page.tsx      |   5 +-
 app/api/boss/stores/requests/route.ts    |  64 ++++++++++---
 app/api/rag/query/route.ts               |  38 +++++---
 app/api/signup/store-membership/route.ts | 135 ++++++++++++++++++---------
 app/boss/stores/add/page.tsx             |   5 +-
 app/hq/approvals/page.tsx                |   7 +-
 app/hq/communication/page.tsx            |   7 +-
 app/hq/manuals/common/page.tsx           |   7 +-
 app/hq/manuals/stores/page.tsx           |   7 +-
 app/staff/stores/add/page.tsx             |  15 ++-
 docs/pr96-rag-ci-review-handover.md      | 111 ++++++++++++++++++++++
 lib/hq/use-client-ready.ts               |  11 +++
 lib/rag/openai-embeddings.ts             |  12 ++-
 lib/signup/store-membership-service.ts   | 155 ++++++++++++++++++++++++-------
 lib/supabase/admin.ts                    |   8 +-
 lib/supabase/server.ts                   |  12 ++-
 package.json                             |   1 +
 scripts/check-rag-dependencies.mjs       |  25 +++++
 tests/auth/protected-layouts.test.ts     |  28 +++++-
 tests/auth/store-brand-authority.test.ts |  64 ++++++++++++-
 tests/notices/notice-scope.test.ts        |  20 ++--
 tests/owner/owner-store-request.test.ts  | 116 ++++++++++++++++++++++-
 tests/support/component-harness.ts       |   3 +
 23 files changed, 706 insertions(+), 150 deletions(-)
```

`git ls-files --others --exclude-standard`:

```text
docs/ui-notice-viewcount-ci-handover.md
```

### Commands to stage only the newly authored files

Prepared for the user; **not executed**:

```powershell
$wt = 'C:/Users/farew/Desktop/il-it-da-ui-notice-review-20261007'
git -C $wt add -- 'tests/notices/notice-scope.test.ts' 'docs/ui-notice-viewcount-ci-handover.md'
git -C $wt diff --cached --check
git -C $wt status -sb
```

This adds only the remaining notice tests and this report. It does **not** remove the already staged 23-file integration. A later merge commit would include that integration as well as the two manually edited files, not a standalone two-file patch. Do not use `git add .`, unstage the merge to manufacture a tests-only merge result, or run commit/push as part of these commands.

## HQ original-to-integration preservation audit

Comparison commits:

- Original UI restoration: `64d74e6883a02a054ceb58b04e524e0984cba10d` (`feat: restore HQ management UI improvements`).
- Original completed shared-shell work: `fd9db9f614a6299f4c534796abd4be9f1a17b5bc` (Song Chaehyun, final duplicate-shell cleanup). This is HEAD's first parent and the primary preservation baseline.
- First develop integration: `18049922703c599d17b3967bf197a225c5faee9f`.
- Latest remote develop and pending merge parent: `07c894191d1eaa8af1fb4040e1841e8bed87beaa`.
- Final candidate: the current review working tree, **not a new committed SHA**. Its staged integration and unstaged tests are listed above.

Every HQ page/layout from the original tree was checked with Git blob identities against both the failed integration and the final working tree. No original HQ page was deleted. Original-to-final changes were inspected directly, not treated automatically as regressions.

| File | Original to first integration | Original to final candidate | Preservation result |
| --- | --- | --- | --- |
| `app/hq/page.tsx` | Identical | Identical | Home retained. |
| `app/hq/layout.tsx` | Identical | Identical | One shared HQShell plus server HQ role guard retained. |
| `app/hq/approvals/page.tsx` | Identical | Changed | UI/data/action handlers retained; readiness hook replaced only. |
| `app/hq/communication/page.tsx` | Identical | Changed | Redesigned cards, filters, create/edit/delete/detail/count retained; readiness hook replaced only. |
| `app/hq/communication/new/page.tsx` | Identical | Identical | Notice creation retained. |
| `app/hq/manuals/page.tsx` | Identical | Identical | Manual entry retained. |
| `app/hq/manuals/common/page.tsx` | Changed | Changed | Restored management UI retained; save-result/status messages and readiness refresh added upstream, plus readiness hook replacement. |
| `app/hq/manuals/stores/page.tsx` | Identical | Changed | Store/category/manual selection and display retained; readiness hook replaced only. |
| `app/hq/manuals/onboarding/page.tsx` | Changed | Changed | Preview/save retained; upstream save-result message and redirect to `/hq/manuals/common?saved=1` replace the generic manual landing redirect. No reversal. |
| `app/hq/notifications/page.tsx` | Identical | Identical | Notifications retained. |
| `app/hq/settings/page.tsx` | Identical | Identical | Settings retained without duplicate shell. |
| `app/hq/stores/page.tsx` | Identical | Identical | Store management retained. |
| `app/hq/stores/[id]/page.tsx` | Identical | Identical | Store detail retained. |
| `app/hq/stores/requests/page.tsx` | Identical | Identical | Store request screen retained. |
| `components/hq/HQHeader.tsx` | Identical | Identical | Original store selector, notifications, profile UI and handlers retained. |
| `components/hq/HQSidebar.tsx` | Changed | Changed | Only equivalent Tailwind variable syntax (`border-[var(--color-border)]` -> `border-(--color-border)`, same for text/background). Navigation, responsive layout and handlers retained. |
| `components/hq/HQShell.tsx` | Identical | Identical | Shared header/sidebar, scroll area, pathname menu selection and store-loading/selection handlers retained. |
| `lib/hq/selected-store.ts` | Identical | Identical | Tab-local selected store persistence retained. |
| `app/globals.css`, `app/layout.tsx` | Identical | Identical | Global styles/layout retained. |
| `public/` assets | Identical | Identical | No asset diff or deletion. |

The HQ API tree, `lib/supabase/hq-auth.ts`, `lib/auth/require-server-role.ts`, and `proxy.ts` also have no original-to-final diff. UI fallback/readiness changes do not remove the server authorization boundary. No UI restoration edit was needed; the newly authored CI patch remains tests/mocks only.

### Verification boundary and pre-existing store-selection limitation

An in-memory execution of the **actual** HQShell and HQHeader (using the existing component harness, without writing a new test file) passed:

- Saved accessible store restored; missing/foreign saved ID falls back to the first accessible returned store.
- Mock successful default-store POST updates selected state and sessionStorage; mock 404 preserves both previous values and clears loading.
- Main children and pathname-selected sidebar menu remain present.
- Actual header dropdown opens, invokes the selected-store callback, disables during the pending callback/loading, closes after success, and disables the selector for a single store.

These are component/mock checks, **not actual authenticated browser login, screenshots, a live store list, or real server persistence**. No shared Supabase access or write was used.

Important pre-existing limitation: HQShell POSTs to `/api/hq/set-default-store`, but `app/api/hq/set-default-store/route.ts` is absent from both the original `fd9db9f` tree and the final candidate. No rewrite/proxy replacement supplies that endpoint. Thus preservation of the client handler does not certify that real store switching works. This is not a develop merge omission; it was already missing in the original UI. The CI-only scope was preserved rather than adding an unrequested backend write endpoint or bypassing server authority.

Follow-up preservation regression: protected layouts, HQ approval scope, notice scope, manual onboarding preview UI, manual readiness API, and store-manual authorization ran together with **206/206 pass**. Repository whitespace/conflict checks passed. The primary OTP worktree and both PR #96 worktrees again matched all **1128 recorded file hashes**, HEAD, branch, status and stash. No staging, commit, push, actual login, or shared database write was performed during this readiness recheck.