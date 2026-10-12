# Song HQ UI Quality Gate Review

## Verified basis

- Repository: https://github.com/myjun0206/il-it-da
- Failed run: https://github.com/myjun0206/il-it-da/actions/runs/37721252852
- Job: https://github.com/myjun0206/il-it-da/actions/runs/37721252852/job/113129151594
- Event: develop push by songc6125-code, failure in Run RAG tests; later required steps skipped.
- Exact failed SHA and latest remote develop: `484a0e6620c16458aa629be13d2290ed620792d6`.
- Review worktree: `C:/Users/farew/Desktop/il-it-da-song-hq-notice-ci-20261008`.
- Branch: `fix/song-hq-notice-ci-20261008`, uncommitted review on the failed SHA.
- Source UI commit: `07a9c85bee06d7b02ae645f03dff0d882509d503` (Song, polish HQ/staff UI).

GitHub run/job metadata was read successfully. Public Actions log download returned HTTP 403; no authenticated gh executable was available. The user was asked for the full Run RAG tests log from the job URL above. Raw GitHub failure messages/test names were NOT obtained. The complete list below is the local reproduction at the exact run SHA, not a claim to have read the cloud log or its first chronological failure.

## Reproduction and complete failure list

Lockfile npm ci, Node 24, then the workflow's exact `npm run test:rag` before any code edit: **1459 tests, 1452 pass, 7 fail, exit 1**.

| Original location | Test | Reproduced first error |
| --- | --- | --- |
| tests/auth/protected-layouts.test.ts:140 | selects only returned accessible stores without an unavailable server-write endpoint | TypeError: effects[1] is not a function |
| tests/manuals/manual-readiness-api.test.ts:308 | HQ 화면은 상태 패널을 쓰고, 점주 지점 화면은 패널 없이 저장 안내 안에서 재처리한다 | AssertionError: missing `<ManualSearchReadinessPanel` |
| tests/manuals/manual-readiness-api.test.ts:333 | HQ 지점 매뉴얼 화면은 프랜차이즈별 지점 요약과 선택 지점 ID를 사용한다 | AssertionError: obsolete window.location.search regex |
| tests/manuals/manual-readiness-api.test.ts:380 | HQ brand_id 누락은 고유 franchise 이름으로만 복구하고, 조회 실패를 빈 지점 목록으로 숨기지 않는다 | AssertionError: obsolete setStoreListError regex |
| tests/notices/notice-scope.test.ts:818 | all role pages use shared card and detail metadata | TypeError: Cannot read properties of null (reading 'trim') |
| tests/notices/notice-scope.test.ts:836 | role filter controls compose without resetting the other active filters (component handlers) | Same trim error |
| tests/notices/notice-scope.test.ts:1162, call at 1163 | HQ notice title opens an in-page dialog with title, content, and date | Same trim error |

The photo's app/hq/communication/page.tsx:235-236 stack was reproduced: storeSearchQuery.trim receives null because a seeded fake state array omits the new store-search slot. The real page initializes that state to an empty string. This is not a production null-state defect. The fixture also lacked a later detail state and used all instead of the exact target-filter sentinel __all__.

## Minimal changes

1. tests/notices/notice-scope.test.ts: match the real 19 HQ useState slots and target sentinel. No filter/count/detail/ownership assertions removed or loosened. All 112 notice tests pass unchanged otherwise.
2. tests/auth/protected-layouts.test.ts: the latest UI intentionally removed global header default-store selection; HQShell now has one auth-loading effect. Test the actual authenticated shell/menu/child and no legacy store write, then test store selection at its current owning page. New actual-page mocks require search-first card selection, scoped fetches, URL store/detail navigation, foreign-store/manual exclusion and visible-error retry.
3. tests/manuals/manual-readiness-api.test.ts: require the exact useSearchParams/store.id/loadError/reloadKey contract, including same-store manual filtering and role alert. Do not accept arbitrary old-or-new alternatives.
4. app/hq/manuals/common/page.tsx: a real preserved feature had been deleted with no replacement. Restore only the existing ManualSearchReadinessPanel import/render, both exact API URLs and readinessRevision key. Keep Song's header, category/title/item cards, actions, error/retry, saveNotice and layout unchanged.
5. app/hq/manuals/stores/page.tsx: after RAG repair, the previously skipped frontend gate exposed react-hooks/set-state-in-effect at line 79. selectedManualId was a duplicate of the URL parameter with no independent setter. Derive it directly from searchParams and remove only the redundant state/effect. Store/manual URLs, cards, filters, fetches and server authorization remain unchanged. The test verifies immediate URL detail selection and cross-store manual ID rejection.
6. This report.

No shared component-harness change was necessary: its useRef/useState cursor behavior is retained. No production notice API/UI patch, whole-file overwrite, ours/theirs choice, test deletion/skip, disabled rule, dependency upgrade, merge, commit or push.

## Required workflow validation

All results are local Windows/Node 24 checks, not a newly triggered cloud CI run.

| Check | Result |
| --- | --- |
| npm ci | 511 packages, lockfile unchanged |
| Notice-focused tests | 112/112 |
| HQ/manual contract-focused tests | 73/73 |
| npm run test:rag incl. test TypeScript compile | 1461/1461 |
| npm run test:auth | 275/275 |
| npm run test:rag-eval | 239/239 |
| Example CSV conversion | 3 input / 3 output |
| Converted and original JSON validation | 3 items / 0 errors each |
| npm run check:frontend | 5/5: lint, typecheck, production build, whitespace/conflict, frontend structure 102/102 |
| git diff --check | Pass |

The temporary extra failure in the new selection test was fixed by exercising the actual search-first UI, not weakening selection assertions. Lint was repaired without suppressing the rule or adding a timer. Existing warnings/audit findings were not bulk-fixed.

Frontend build used only process-local localhost Supabase placeholders; no original env file was copied. Browser/component APIs are injected mocks, not actual provider/DB acceptance. No DB/Auth/SMTP writes, actual mail or paid model call.

## UI and original-work preservation

Latest origin/develop was rechecked as the same failed SHA. Diff against it leaves app/hq/communication, HQHeader/HQSidebar/HQShell, app/api/hq, notices components/helpers and component-harness unchanged. Thus Song's shared notice cards, server search/sort/pagination, scope/target filters, count forwarding, detail dialog and role/franchise guards remain in their original integrated implementation. Header default-store removal is inherited from Song's latest UI, not introduced by this review; current URL-based store/manual selection is exercised directly.

The only application deltas are the existing readiness panel reattachment and removal of redundant URL-derived state. No unrelated UI/styles/page files were reverted. No merge conflict occurred because this review starts directly at latest develop; the dirty original is not merged into it.

Original worktree: `C:/Users/farew/Desktop/il-it-da`, develop HEAD `55a3b6e7a40b2fc96af64267bbaf67932d57cc94`. Before work, branch/HEAD/index/status/stash, 574 source/untracked/environment/desktop.ini hashes and attributes, and port 3000 server PID 31024 were snapshotted. Verify them against the temp preservation CLIXML before declaring the task complete. Fetch updates shared remote refs only; no original pull, checkout, stash movement or file edit. Email-first/039/CSS work remains only in the original and was not copied or replaced here. The original server must not be stopped.