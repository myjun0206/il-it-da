# Validated Staff Integration

## Scope

Base: latest origin/develop at integration start. Only the current user's reviewed and validated staff/RAG changes are integrated; no teammate branch is selected or merged. Teammate error-fix/mobile work remains a separate future integration once its branch or PR is agreed.

Included changes:
- Explicit out_of_scope response classification and a distinct work-scope guidance badge.
- Read-only classification of old uncited insufficient responses using their preceding user question. Existing stored rows, statuses, logs and notifications are not rewritten.
- Source titles remain visible; relevance numbers and internal diagnostic explanations are hidden from ordinary staff messages.
- Verified full support is classified independently of retrieval ranking while partial/broad/unsupported scope remains withheld or cautious.
- Recipe citations restore only a heading plus its immediately adjacent criteria line, or a unique complete criteria row. Amount-first wording and an exact source serving are supported; wrong values, units, basis, serving, partial/ambiguous citations and foreign scope remain blocked.
- Referral policy supports who-to-ask questions, not concrete work facts, timing or methods.

Excluded: private trial guards and budgets, fixed live-execution manifests, raw observations, personal logs, account-targeted SQL, environment files, credentials, one-off scripts, unrelated user edits, and long follow-up/conversation improvements. The original dirty worktree is retained separately.

## API And Storage Contract

New API responses carry responseKind=out_of_scope. The existing database response_kind constraint remains unchanged; no remote migration or backfill is applied. Legacy stored responses are classified by the authenticated history DTO on read only, without inferring badge state from assistant wording, score or source presence alone.

Real shortages retain the manager-confirmation badge and escalation behavior. Clarifications retain the question-confirmation badge. Explicit out-of-scope responses never receive a manual-support badge or owner escalation solely because their stored status is insufficient.

## Verification And Limits

Additional chatbot POSTs, provider calls, manual registration and embeddings are not part of this integration. The prior actual execution counters, E1/E2 history and original failure evidence remain in the original ignored local data and are not committed here.

Opening-time and closing final actual rechecks, long conversations, and the end-to-end existing-manual editing workflow remain unverified. The user must visually review saved recipe/location/shortage/out-of-scope conversations; reading saved history does not require a new question.

Integration gates must run against this clean selected worktree, not just against the original dirty development tree. Commit/push/PR/merge target develop only after the selected code, regressions, build, privacy boundaries and core screens pass. Main and Render deployment are excluded.

The selected worktree passed verify:poc 7/7, authentication/role regression 347/347 and the focused source/UI/parser regressions. Minimum compatible security patches and remaining conditional audit warnings are documented in security-minimal-patches-20261014.md. Desktop/mobile component screenshots were checked offline with zero network requests. No live chatbot POST, remote manual write, account mutation or embedding was performed during integration.