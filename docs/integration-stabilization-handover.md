# Integration And Stabilization Handover

Current integration verification is recorded at the end under **Merged Worktree Verification**. Earlier sections are historical precommit snapshots, not the current merge status. This update exists only in the integration worktree.

## Status And Boundaries

2026-10-05. User-confirmed core escalation/RAG behavior is recorded separately from this local verification. No features were added during stabilization. No git add/commit/push, stash modification, shared DB/037 execution, paid API, threshold/model/manual-data changes were performed.

| Worktree | Branch | HEAD |
| --- | --- | --- |
| C:/Users/myeon/il-it-da | fix/owner-escalation-manual-followup | 420ec1bbe590bfc6e65ee3901ebd8015742f42fd |
| C:/Users/myeon/il-it-da-rag-colloquial | fix/rag-colloquial-intent | 420ec1bbe590bfc6e65ee3901ebd8015742f42fd |

Both are still uncommitted. Backup stash is `stash@{0}` / `9523bdca041e777cf045ac65c6d036bfe8862144`. A third worktree, il-it-da-ui-fix at5dbd55d on fix/staff-profile-menu-ci, is outside this task and was not edited. Existing source worktrees and user runtime inputs remain intact.

Actual integration is **blocked until the user commits**. The checks below are independent worktree checks, not a merged-branch result. Do not claim integration approval before merging and rerunning gates. 037 is already applied with contract2 confirmed by the user; it must not be reapplied for this task.

## Initial Tailwind Findings (Historical)

The later file-scoped cleanup below supersedes this initial Sidebar-only checkpoint. Historical counts are retained, not presented as current results.

- Installed Tailwind4.3.3, Tailwind CSS IntelliSense0.16.0. Extension server identifies source `tailwindcss`, code `suggestCanonicalClasses`. Its default configuration is warning; installed server severity mapping is error1 if configured as error, otherwise warning2.
- IDE `get_errors` returned total244 before and238 after, under the same all-diagnostics query in the current VS Code window. It exposes only the first50 messages and omits source/code/severity fields. Actual IDE severity overrides, a full type breakdown, repeated providers and cross-worktree accumulation therefore remain **unverified**. A folder-scoped empty result is not evidence that an external worktree has zero diagnostics.
- The completely observed narrow scope was components/owner/OwnerSidebar.tsx:7 before,1 after. All7 messages were canonical suggestions: CSS-variable shorthand6, fixed-pixel width suggestion1. No actual CSS conflict/invalid-class error was observed in that slice.
- A later all-diagnostics query reported249 after additional HQ/staff/test files were inspected. The active diagnostic set changed; the exact added providers/locations cannot be recovered from the tool's first50 output. Thus244→238 is an intermediate observation, **not a final fixed-scope reduction claim**. Only Sidebar7→1 is a controlled before/after result. Do not infer duplicated worktrees or a regression count from249 alone.
- Typical suggestions elsewhere include `bg-[var(--color-bg-default)]`→`bg-(--color-bg-default)`, `break-words`→`wrap-break-word`, `lg:ml-[240px]`→`lg:ml-60`. The other238 diagnostics cannot all be classified from the truncated tool output. CLI evidence is listed separately; lint warnings are not Tailwind IDE counts.
- Only the6 validated Sidebar CSS-variable spellings were changed. The installed Tailwind design-system/compiler using the actual globals.css produced identical declarations for the old/new border and text candidates after selector normalization. A regression test repeats this comparison. Layout/colors/hover/focus/mobile behavior were not changed.
- `240px`→`60` was intentionally left: the latter depends on spacing/rem/root font size and is not a guaranteed identity under zoom/custom roots. Other suggestions in functional UI files remain for an isolated follow-up style review rather than mixing a broad replacement into this precommit checkpoint. No lint settings or diagnostic severities were changed, no Tailwind upgrade, no global replacement.
- To finish an exact244-rule/severity/duplicate breakdown, the user should export the Problems list from the same window/range with Source/Code/Severity and full paths. No access tool available here can export vscode.languages.getDiagnostics metadata; do not estimate missing numbers.

## Additional File-Scoped Tailwind Cleanup

2026-10-05, before user commits. Tailwind4.3.3 and IntelliSense0.16.0 were retained. No rules/configuration were changed. The RAG source worktree was not edited in this pass.

### Collection Scope And Limitations

- Enumerated and requested every one of the115 TSX/CSS files under `app/`, `components/`, `lib/`: `app/**/*.tsx`, `components/**/*.tsx`, `lib/**/*.tsx`, `app/**/*.css`. Small disjoint requests produced individual file results; nonempty files were queried separately. At the initial snapshot108 other source paths returned no cached diagnostics. A later global93 observation exposed AppShell1 and signup/start4 within those same115 paths; both were then queried individually and cleaned. Also queried the UI test and this document. This is an IDE-cache observation, not proof that every unopened file was analyzed by the Tailwind extension.
- Initial global count255 equaled the sum of seven nonempty source-file counts. Including the later two files' five pre-edit suggestions gives a260-message fixed nine-file baseline; this is a combined per-file baseline, not a global260 observation. All counts are assigned to paths, not merely the global first50. However, the store-manual page still returned only50 of168 even when requested alone:118 historical messages/positions were unavailable. Their native codes/severities/types must not be invented. The other eight files'92 messages and that page's first50 were individually inspected:142 visible messages, all canonical wording suggestions, no observed CSS conflict/invalid-class message.
- The tool labels every item `compileError` but does not expose actual native Source/Code/Severity/column. Canonical wording identifies the suggestion family; the installed extension identifies it as `tailwindcss` / `suggestCanonicalClasses` with default warning2. Actual configuration overrides and native severity remain unknown. Do not classify these as compiler errors from the wrapper label.
- Deduplication identity must retain normalized absolute worktree path, native Source/Code/Severity, range and message. In this collection native Code/Severity/column are unavailable, so provider-level duplicates cannot be proven or merged. Repeated queries are separate snapshots, never added together. Identical filenames in the two worktrees are different paths. Multiple identical classes on one line, such as followup line94, occupy different source positions and are not automatically duplicates.
- Six corresponding external RAG paths returned empty results in this VS Code window. That worktree is not a registered workspace root here; its full extension coverage and any separate-window accumulation remain unverified. The third UI worktree, ignored/generated files, other windows/providers, and missing metadata are outside this verified IDE scope.

### Same File Set Before And After

These nine paths are the final fixed comparison set (eight newly edited plus the previously edited Sidebar control). Counts are the tool's returned observations, not computed replacement counts. The before/after comparison is260 to89 in this set, with79 stale messages and10 retained current-source suggestions. Do not report IDE Problems0. The last global93 snapshot preceded the last two-file cleanup; use the per-file comparison, not a global reduction percentage.

| Workspace-relative path | Before | After observed | Current-source retained | Stale old-spelling messages |
| --- | ---: | ---: | ---: | ---: |
| app/boss/questions/[id]/BossQuestionDetailView.tsx | 32 | 32 | 1 | 31 |
| app/boss/store-manuals/page.tsx | 168 (first50 visible) | 6 (all visible) | 6 | 0 |
| components/owner/QuestionManualFollowup.tsx | 34 | 34 | 0 | 34 |
| components/owner/OwnerHeader.tsx | 3 | 3 | 0 | 3 |
| components/hq/HQSidebar.tsx | 6 | 1 | 1 | 0 |
| components/staff/StaffSidebar.tsx | 11 | 11 | 1 | 10 |
| components/owner/OwnerSidebar.tsx | 1 | 1 | 1 | 0 |
| components/layout/AppShell.tsx | 1 | 1 | 0 | 1 |
| app/(auth)/signup/start/page.tsx | 4 | 0 | 0 | 0 |
| Total | 260 | 89 | 10 | 79 |

The newly edited eight production files alone are259 before /88 after observed (9 retained,79 stale). The expanded UI test was also queried and returned0 before /0 after; OwnerSidebar's1 before /1 after is a control, not a new change. This separates the actual edited set from the nine-source-file comparison universe.

Some intermediate queries returned transient empty/stale results. Final per-file observations above show the current line text with old class names in the diagnostic message, proving the mismatch, not a fresh error in the new class. Native severity/provider/version metadata is still unavailable. After a Tailwind language-server refresh, compare this same set again; do not hide or suppress these messages to change counts.

### Changes And Equivalence

Changed268 tokens across eight files: BossQuestionDetailView31, store-manual page162, QuestionManualFollowup34, OwnerHeader3, HQSidebar19, StaffSidebar14, AppShell1, signup/start4. This includes class strings held in menu variables that did not all appear in the IDE suggestions; therefore268 is not an IDE reduction count. The earlier OwnerSidebar six substitutions are separate and unchanged in this pass.

Only a fixed six-file allowlist was mechanically transformed; the later supports variant and the two newly exposed files were edited individually after compiler checks. For each old/new candidate the installed Tailwind design system loaded the actual globals.css and compared full PostCSS output after normalizing only the utility class selector name, preserving nested media/supports conditions, pseudo classes, declaration order and values. All candidate comparisons passed before writes. Covered bg/text/border (including border-t)/outline/ring/placeholder variables, hover/focus variants, numeric opacity modifiers, `break-words` to `wrap-break-word`, and the later verified supports-backdrop-filter spelling. Pixel-class arrays were compared unchanged before/after. The existing UI test repeats these compiler comparisons across the actual application candidates.

No global CSS, shared Button, model/threshold, data/API logic, spacing, responsive breakpoint or focus rule was changed. The six pure-style commit paths were compared against HEAD with both sides normalized only for allowed variable spelling and checkout line endings; all six passed. Functional UI files remain in the feature commit because their pre-existing changes must not be split/reverted automatically.

### Retained Current-Source Suggestions

All ten below have canonical suggestion wording. Native severity is unexposed; default extension severity is warning. They are intentionally retained: literal px is independent of root font/spacing, while the proposed scale unit uses rem/theme spacing. Identity at a16px root is insufficient to guarantee the same size under a custom root/theme. No px conversion was made.

| Path and 1-based source line | Kept | Proposed but not applied |
| --- | --- | --- |
| app/boss/questions/[id]/BossQuestionDetailView.tsx:206 | lg:ml-[240px] | lg:ml-60 |
| app/boss/store-manuals/page.tsx:969 | lg:ml-[240px] | lg:ml-60 |
| app/boss/store-manuals/page.tsx:1054 | min-h-[44px] | min-h-11 |
| app/boss/store-manuals/page.tsx:1080 | md:w-[420px] | md:w-105 |
| app/boss/store-manuals/page.tsx:1191 | md:w-[420px] | md:w-105 |
| app/boss/store-manuals/page.tsx:1265 | md:w-[420px] | md:w-105 |
| app/boss/store-manuals/page.tsx:1373 | lg:left-[240px] | lg:left-60 |
| components/owner/OwnerSidebar.tsx:59 | lg:w-[240px] | lg:w-60 |
| components/hq/HQSidebar.tsx:91 | lg:w-[240px] | lg:w-60 |
| components/staff/StaffSidebar.tsx:53 | lg:w-[240px] | lg:w-60 |

### Stale Messages Still Returned

These locations are not additional unmodified classes. The suggested new class is already present; changing it again or disabling a rule is inappropriate. Refresh/recollect the provider to confirm its new diagnostics. Native metadata and why some files did not refresh are unverified.

| Path | Lines of old-spelling messages (multiplicity where greater than1) | Count |
| --- | --- | ---: |
| app/boss/questions/[id]/BossQuestionDetailView.tsx | 204,208,218(x3),223,226(x2),230,231,232,235,236(x2),250(x2),265(x2),269,275,282(x4),292(x2),302(x4) | 31 |
| components/owner/QuestionManualFollowup.tsx | 76,85,86,87(x4),93,94(x4),95(x2),97,99(x4),100(x4),103,104,110,113,114,115,119,129,131(x2),132 | 34 |
| components/owner/OwnerHeader.tsx | 135,170(x2) | 3 |
| components/staff/StaffSidebar.tsx | 46,53,58,99,108(x2),109(x2),118,124 | 10 |
| components/layout/AppShell.tsx | 161 | 1 |

### Final Executable Checks

The modified source worktree's final check:frontend passed5/5: typecheck, lint0 errors/65 unsuppressed warnings, production build and frontend101/101. Final test:owner-followup-ui passed9/9 using the newly built production CSS, including actual owner/HQ/staff components with mocked external/auth boundaries. Compiler comparisons retain all variant/opacity conditions, including AppShell/signup/start candidates. Those two added paths were verified by compiler/HEAD comparison, not by direct page workflow screenshots. Screenshots remain temporary. This is not a real authenticated manual-editor/HQ/staff session or a full dark-theme browser run; CSS equivalence, not CLI success, is the evidence that these spellings retain color/focus behavior. The unchanged RAG worktree's earlier gates remain historical, not rerun results from this pass.

## Real Errors Fixed

RAG check:frontend initially failed on2 actual ESLint errors: `@next/next/no-assign-module-variable` in the POST VM tests. Local variables were renamed to routeModule/chatModule while preserving the VM's CommonJS `module` property. The same narrow lint then passed and the full gate passed. No production RAG behavior was changed by that rename.

CLI lint finished with0 errors/65 warnings in both roots. These are independent from IDE Tailwind canonical suggestions. They were not suppressed. Node MODULE_TYPELESS_PACKAGE_JSON warnings remain; adding package type solely to hide those warnings would change module semantics and was not done.

## Earlier Verification Before Commit

| Check | Escalation worktree | RAG worktree |
| --- | --- | --- |
| typecheck | PASS via check:frontend | PASS via check:frontend |
| test:rag | 1,363/1,363 | 1,393/1,393 after lint repair |
| test:auth | 241/241 | 241/241 |
| test:integration | 79/79 | 79/79 |
| test:rag-eval | 239/239 | 239/239; no model calls |
| check:integration | errors0/warnings0; existing014/015 gap info2 | same |
| check:frontend | 5/5, frontend101/101, lint errors0/warnings65 | 5/5, frontend100/100, lint errors0/warnings65 |
| mock UI | 9/9: owner workflows plus HQ/staff shells, canonical CSS equivalence | UI not changed |

Dev servers were observed at3000 (source) and3001 (RAG), using `.next/dev`. Installed Next16.3.4 build cleanup excludes `cache|dev|lock|trace`, so each build used its own worktree output and preserved dev. No running server was stopped. Production builds passed; real authenticated page rendering remains unverified here.

Mock browser views used actual owner/HQ/staff Sidebar components and actual owner question/followup components; auth/header/API boundaries were mocked. Owner1280/390/320 widths and HQ/staff1280/390 widths passed keyboard selection/menu expansion, completion/editor visibility, horizontal overflow, disabled/update/clipboard/error behavior. Screenshots are OS-temporary artifacts, not commit candidates. They are not authenticated HQ/staff dashboard screenshots. Shared Button/global CSS were not modified.

Credential/JWT pattern scan found0 matches in the selected64/20 candidate files at scan time. Env files were never read; git ls-files listed no env files, and .env*/.next/node_modules are ignored. Pattern scans are not a guarantee of secret absence: inspect the staged diff locally before committing. No secret values were printed.

## Commit Candidate Decisions

Include the source/features, registered regressions, placeholder general examples and reusable server-only diagnostics. The local CLI/default mock mode makes no paid calls; live modes are explicit development/operator actions. Keep the generic diagnostics README and query/store placeholder examples.

Exclude without deleting or reverting:

- `.env*`, `.next/`, node_modules, temp screenshots/output/logs, any local JSON/HAR/cURL carrying session headers.
- RAG `examples/rag-diagnostics/mega-isu.json`: user runtime store ID; use committed mega-isu.example.json instead.
- RAG current snapshot SQL: latte-candidates.readonly.sql, latte-current-materials.readonly.sql, latte-search-readiness.readonly.sql, latte-selected-chunks.readonly.sql, family-pack-materials.readonly.sql. These are local investigative snapshots, not migrations or automated deployment inputs.
- RAG docs/rag-colloquial-search-investigation.md: long local trace/ID/history record. The reusable examples/rag-diagnostics/README.md is the proposed committed guide. Preserve the local investigation file for follow-up.

Escalation docs/sql are reusable operator readiness/catalog checks and can be included. scripts/verify-manual-postgres.mjs is a disposable local test, not a shared DB deployment command. Migration037 is included as the formal versioned contract artifact but is **not executed again**.

## Exact User Staging And Commit Commands

These commands are guidance only and were **not executed**. Current lists contain64 escalation files,6 pure-style files and20 RAG files. A retains the new CSS comparison regression and the spelling changes in already-functional UI files; B contains only HEAD-verified pure-style paths. RAG runtime exclusions remain unchanged.

Run them after reviewing the lists. They assume no pre-existing staged changes; first inspect `git diff --cached --name-only`. If there are unrelated staged paths, do not commit them together or reset them automatically. Avoid git add . and git commit -a. Every list path was checked with literal filesystem semantics and the PowerShell blocks were parsed, not executed. Copy only inside the fences: `$_`, `.tsx` and `.test.ts` contain no Markdown escaping. Stop on a failed Git command; review the staged diff locally before committing.

### A. Escalation Functionality

```powershell
Set-Location C:/Users/myeon/il-it-da
git branch --show-current
git diff --cached --name-only
$escalationFiles = @(
  'app/api/boss/question-logs/[id]/context/route.ts'
  'app/api/manuals/[id]/items/route.ts'
  'app/api/manuals/[id]/route.ts'
  'app/api/manuals/batch-update/route.ts'
  'app/api/manuals/preview/confirm/route.ts'
  'app/api/manuals/route.ts'
  'app/api/manuals/search-readiness/reindex/route.ts'
  'app/api/manuals/upload/route.ts'
  'app/api/rag/upload/route.ts'
  'app/api/store-manuals/[id]/items/route.ts'
  'app/api/store-manuals/[id]/route.ts'
  'app/api/store-manuals/batch-create/route.ts'
  'app/api/store-manuals/batch-update/route.ts'
  'app/api/store-manuals/preview/confirm/route.ts'
  'app/api/store-manuals/route.ts'
  'app/api/store-manuals/search-readiness/reindex/route.ts'
  'app/api/webhooks/index-manual/route.ts'
  'app/boss/questions/[id]/BossQuestionDetailView.tsx'
  'app/boss/questions/repeated/RepeatedQuestionView.tsx'
  'app/boss/store-manuals/page.tsx'
  'app/hq/manuals/common/page.tsx'
  'app/hq/manuals/onboarding/page.tsx'
  'components/manuals/ManualSearchReadinessPanel.tsx'
  'components/owner/QuestionManualFollowup.tsx'
  'docs/owner-escalation-manual-followup.md'
  'docs/sql/owner-manual-postdeploy.readonly.sql'
  'docs/sql/owner-manual-schema-inspection.readonly.sql'
  'docs/integration-stabilization-handover.md'
  'lib/manuals/detect-manual-item.ts'
  'lib/manuals/index-saved-manuals.ts'
  'lib/manuals/manual-save-result.ts'
  'lib/manuals/manual-selection.ts'
  'lib/manuals/manual-write-contract.ts'
  'lib/manuals/save-manuals-with-batch.ts'
  'lib/manuals/save-store-manual-edit.ts'
  'lib/manuals/validate-manual-edit.ts'
  'lib/owner/question-manual-context.ts'
  'lib/rag/index-approved-manual.ts'
  'lib/rag/index-manual.ts'
  'lib/rag/manual-indexing/persist-chunks.ts'
  'lib/rag/manual-indexing/pipeline.ts'
  'lib/rag/manual-indexing/reembed-approved-manuals.ts'
  'lib/rag/manual-indexing/supabase-deps.ts'
  'lib/rag/save-manual-sections.ts'
  'lib/types/manual.ts'
  'package.json'
  'package-lock.json'
  'scripts/verify-manual-postgres.mjs'
  'supabase/migrations/037_owner_manual_safe_edit.sql'
  'tests/manuals/atomic-manual-index.test.ts'
  'tests/manuals/manual-confirm-flow.test.ts'
  'tests/manuals/manual-preview-api.test.ts'
  'tests/manuals/manual-readiness-api.test.ts'
  'tests/manuals/manual-save-entrypoint.test.ts'
  'tests/manuals/manual-upload-idempotency-api.test.ts'
  'tests/manuals/manual-write-contract.test.ts'
  'tests/manuals/save-store-manual-edit.test.ts'
  'tests/manuals/store-manual-extract.test.ts'
  'tests/manuals/validate-manual-edit.test.ts'
  'tests/owner/question-followup-ui.test.mjs'
  'tests/owner/question-manual-context.test.ts'
  'tests/rag/manual-indexing/persist-chunks.test.ts'
  'tests/rag/save-manual-sections.test.ts'
  'tsconfig.test.json'
)
$escalationFiles | ForEach-Object { git --literal-pathspecs add -- $_ }
git diff --cached --check
git diff --cached --stat
git diff --cached
git commit -m "fix: complete owner escalation and atomic manual followup"
git rev-parse HEAD
```

Use literal pathspecs: [id] is a directory name, not a pattern. Capture this commit SHA as ESCALATION_SHA.

### B. Isolated Pure-Style Files

All six files below were clean before their style changes and passed the HEAD-normalized comparison. This is the pure-style file checkpoint, not every spelling change in A's already-functional files.

```powershell
Set-Location C:/Users/myeon/il-it-da
git branch --show-current
git diff --cached --name-only
$styleFiles = @(
  'components/owner/OwnerSidebar.tsx'
  'components/owner/OwnerHeader.tsx'
  'components/hq/HQSidebar.tsx'
  'components/staff/StaffSidebar.tsx'
  'components/layout/AppShell.tsx'
  'app/(auth)/signup/start/page.tsx'
)
$styleFiles | ForEach-Object { git --literal-pathspecs add -- $_ }
git diff --cached --check
git diff --cached --stat
git diff --cached
git commit -m "style: canonicalize equivalent Tailwind spellings"
git rev-parse HEAD
```

Capture this SHA as STYLE_SHA. Do not include functional UI files in this style commit.

### C. RAG Functionality And Reusable Diagnostics

```powershell
Set-Location C:/Users/myeon/il-it-da-rag-colloquial
git branch --show-current
git diff --cached --name-only
$ragFiles = @(
  'app/api/rag/query/route.ts'
  'app/api/staff/chat/route.ts'
  'lib/manuals/detect-manual-item.ts'
  'lib/rag/answer-prompt.ts'
  'lib/rag/manual-menu-intent.ts'
  'lib/rag/openai-embeddings.ts'
  'lib/rag/resolve-rag-answer.ts'
  'lib/rag/search-manual-chunks.ts'
  'lib/rag/search-query.ts'
  'lib/rag/trace-identifiers.ts'
  'scripts/diagnose-rag.ts'
  'tests/rag/answer-prompt.test.ts'
  'tests/rag/resolve-rag-answer.test.ts'
  'tests/rag/search-query.test.ts'
  'tests/support/alias-hooks.mjs'
  'examples/rag-diagnostics/README.md'
  'examples/rag-diagnostics/questions.json'
  'examples/rag-diagnostics/mega-isu.example.json'
  'examples/rag-diagnostics/burger-sindaebang.json'
  'examples/rag-diagnostics/burger-noryangjin.json'
)
$ragFiles | ForEach-Object { git --literal-pathspecs add -- $_ }
git diff --cached --check
git diff --cached --stat
git diff --cached
git commit -m "fix: preserve RAG intent evidence and verified followup context"
git rev-parse HEAD
```

Capture this SHA as RAG_SHA. Confirm the two burger examples still contain placeholders before staging; if the user has since added real runtime values, exclude those runtime files and make separate sanitized templates instead. The VM lint repair is in this functionality test file and changes no model/API behavior.

## Integration After User Commits

No integration branch or merge was performed yet. Once the user supplies ESCALATION_SHA, STYLE_SHA and RAG_SHA, proceed in a new worktree so the two source worktrees' remaining excluded local files are preserved. Proposed branch: integration/owner-escalation-rag. Use commit SHAs, not assumptions about current branch tips.

Planned operations after user confirmation:

```powershell
git -C C:/Users/myeon/il-it-da worktree add C:/Users/myeon/il-it-da-integration -b integration/owner-escalation-rag STYLE_SHA
git -C C:/Users/myeon/il-it-da-integration merge --no-commit RAG_SHA
```

These are plans, not executable placeholder commands to run now. Do not automatically commit a merge. A successful no-commit merge will have staged changes and needs separate user approval for the final commit; the instruction not to execute git add/commit remains in effect until explicitly changed.

Conflict review:

- detect-manual-item.ts currently has the identical getNumberedManualItemHeading addition in both roots; preserve exactly one copy and the existing split rules.
- Preserve original package scripts/test registrations and Playwright lockfile additions; RAG has no package change to overwrite them.
- Preserve latest owner/HQ editor UI, atomic manual-write contract and RAG menu/verified-history guards. Do not revert updated tests to source-name-only checks.
- Keep the six pure-style files reviewable in STYLE_SHA. A's already-functional UI paths also have compiler-equivalent spelling changes; preserve their current functional changes and the expanded regression test. RAG's older UI classes must not overwrite either set during a merge.
- Do not run 037, reindex, SQL snapshots, eval:rag live calls or shared fixture edits during integration.

After resolving, run all requested gates in the integration worktree: typecheck, test:rag, test:auth, test:integration, test:rag-eval, check:integration, check:frontend(build), diff and untracked-file whitespace checks. Also run test:owner-escalation and test:owner-followup-ui as focused gates. Use a fresh dev port only if needed and do not terminate source servers. Combined results are currently unverified.

## Minimal Real Checks And PR Draft

Remaining user checks after integration: actual HQ/owner/staff authenticated desktop/mobile navigation; owner question→selected child editor→save/search status→return/manual completion; stock/family-pack/latte grounded answers; ambiguous recipe clarification without numbers; explicit B→referential followup within the same owned store conversation; different-store/brand exclusion; loading/error/409/disabled states and dark theme. Paid/chat checks require separate operator approval and are not part of these local gates.

PR title: **Integrate owner escalation followup and safe RAG intent/evidence handling**

PR description:

- Preserve existing role/store/franchise boundaries and escalation/logging contracts.
- Add atomic versioned manual edits and explicit saved-vs-search-ready owner/HQ UI.
- Keep RAG original question, grounded evidence, menu clarification and verified latest-user followup context; no threshold/model changes.
- Include development-only safe diagnostics and placeholder examples; exclude runtime DB snapshots, env files and personal/session outputs.
- Isolate the six pure-style paths in their own commit; retain all ten pixel-size suggestions. Include the equivalent spellings in A's already-functional UI paths and the expanded compiler comparison regression without pretending those files are style-only.
- 037 already applied and contract2 confirmed; no reapplication/reindex/data migration in this PR procedure.
- Attach individual gate results now; attach actual integration gate results only after user commits and merge.
- Disclose IDE metadata/118 historical truncated messages, the fixed-set260 to89 observations (79 stale messages plus10 retained current-source suggestions), and real authenticated UI verification rather than claiming zero Problems or fully verified live quality.

## Merged Worktree Verification

2026-10-05. User supplied and authorized the following commits:

| Commit | SHA | Parent |
| --- | --- | --- |
| Escalation | aad70395816ab63312cc71b390e826d6e785d547 | 420ec1bbe590bfc6e65ee3901ebd8015742f42fd |
| Style | 74627fdad8a4adff428f795c44335288817dc6d8 | aad70395816ab63312cc71b390e826d6e785d547 |
| RAG | 64740f593ecf598ead30dd974abc4b6fceb337f0 | 420ec1bbe590bfc6e65ee3901ebd8015742f42fd |

Created C:/Users/myeon/il-it-da-integration on integration/owner-escalation-rag from the style SHA after confirming neither path nor branch existed. Executed only the authorized `merge --no-ff --no-commit` of the RAG SHA. The merge succeeded without conflicts. HEAD remains the style SHA and MERGE_HEAD is the RAG SHA; there is no merge commit yet.

No conflict-resolution files or manual staging for conflict repair are needed. Git merge automatically staged19 changed/added RAG paths relative to the style HEAD; no git add command was executed. The shared detect-manual-item helper is already present identically in both parents and therefore is not an additional changed path. It occurs exactly once; checkout CRLF/LF was normalized only for comparison. All six pure-style files and package.json/package-lock.json remain identical to the style commit.

Installed510 packages using `npm ci --ignore-scripts --no-audit --no-fund`, without changing dependency manifests. Deprecation notices for node-domexception, ESLint9 and @langchain/community were not hidden or addressed with unrelated upgrades. Confirmed `.env.local` is untracked and ignored by `.gitignore` `.env*`, then copied it from the original source worktree without printing values. No runtime investigation files were copied. No source dev server was stopped.

### Combined Gates

Every command below ran in the integration worktree, not in either source worktree. No tests were skipped or failed in the reported test suites.

| Command | Result |
| --- | --- |
| npm run typecheck | PASS, Next typegen and tsc --noEmit |
| npm run test:rag | 1,422/1,422 |
| npm run test:auth | 241/241 |
| npm run test:integration | 79/79 |
| npm run test:rag-eval | 239/239, offline tool regressions |
| npm run check:integration | PASS, errors0/warnings0, existing014/015 prefix-gap info2 |
| npm run check:frontend | 5/5, frontend101/101, production build PASS, lint errors0/warnings65 |
| npm run test:owner-escalation | 440/440 |
| npm run test:owner-followup-ui | 9/9, newly built production CSS and mocked owner/HQ/staff components |
| node scripts/check-git-whitespace.mjs | PASS, worktree and staged diff |
| Untracked-file whitespace | PASS, zero nonignored untracked files before this tracked document update |

The UI tests exercise desktop/mobile selection, editor targeting, disclosures, copy/retry/error/409 states, manual completion and Sidebar responsiveness. Auth/API are mocked, screenshots are temporary, and external requests are blocked. This is not real authenticated dashboard/manual-editor evidence or a complete dark-theme/live RAG acceptance run. CLI PASS is not an IDE Problems0 claim; the earlier native diagnostic metadata limitations still apply.

### User Finalization

This report is the only additional unstaged tracked edit after the automatic merge. Inspect it and the automatically staged merge locally. The following are user-only commands and were not executed by the assistant:

```powershell
Set-Location C:/Users/myeon/il-it-da-integration
git status -sb
git diff -- docs/integration-stabilization-handover.md
git diff --cached --stat
git --literal-pathspecs add -- 'docs/integration-stabilization-handover.md'
git diff --cached --check
git diff --cached
```

The user retains control of the final merge commit and any push. Do not accidentally run a second merge or overwrite an existing integration worktree. No conflict repair remains pending.

### Remaining Real Acceptance

- Actual authenticated HQ/owner/staff desktop/mobile navigation and dark theme.
- Owner question to exact child editor, explicit saved/search-ready state, return to question and manual completion; loading/error/disabled/409 behavior with real sessions.
- Stock shortage, family-pack and latte grounded answers; ambiguous recipes clarify without unsupported amounts. Explicit pack kind followed by a referential question uses only the same owned store conversation.
- Different-store/brand isolation and session/role boundaries under real accounts.
- Live chat/model checks require separate operator approval. No paid calls, shared DB changes, 037 reapplication, reindexing or manual/QA-data changes were performed by this verification. The user-confirmed applied037/contract2 state was not independently rechecked against the shared DB.

Original source HEADs/branches, excluded investigation files and backup stash are preserved. Final preservation checks compare the pre-merge snapshot of status, untracked file hashes and stash identity without exposing runtime contents or environment values.