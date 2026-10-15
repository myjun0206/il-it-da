# Manual Lifecycle and Chat Stability

## Scope and Runtime

The integration worktree is based on commit `14ec0c3` with uncommitted lifecycle, retrieval, validation, accounting and regression changes. Nothing was committed, pushed, remotely merged or deployed.

Port 3002 now runs ordinary production Next.js, without `--import`, a manual-test preload, historical request slots, phase files, actor-ID allowlists or ledger-based admission. Port 3000 remains the preserved environment.

```powershell
npm run build
npm run start -- --port 3002 --hostname localhost
```

The local launcher only forwards the standard child process's output to an append-only private log. It removes trial environment keys and `NODE_OPTIONS`; it does not wrap HTTP, fetch, authentication or database operations. Ordinary application authentication, role checks, approved memberships, tenant/store scope and upload idempotency remain enforced by the application.

The original trial ledger is frozen and unchanged. New provider usage is recorded by non-gating application logging: service, model, HTTP status, token counts and estimated cost only. Logging failure cannot reject a request. Unknown provider usage is recorded as unknown, not invented as zero. Costs use current configured model-rate assumptions, not a provider billing invoice.

## Actual Failure Classification

| Layer | Evidence | Resolution |
| --- | --- | --- |
| Local trial admission | Normal bodyless DELETE/query-store parsing caused MANUAL_ORIGIN_OR_STORE, then historical stopped state rejected later requests | Removed the trial preload from ordinary 3002 execution, not merely resumed its ledger |
| Registration/index lifecycle | Saved or replayed batches did not consistently report current chunk readiness; batch-status write errors could be ignored | Replays read current chunks; batch write/count failures are errors; failed orphan batch hashes can be released after confirming zero linked manuals |
| Retrieval/intent | 10:56 closing-order question used colloquial acceptance wording missed by the shared intent route; scoped POS guidance was absent from the supplied top candidates | Recall, requested support and verified procedure rendering now share the same closing-order intent helper |
| JSON validation | Actual 10:56 model output parsed successfully | Retained strict JSON/schema validation; did not reclassify malformed output as missing manuals |
| Semantic validation | 10:56 failure was support_semantics / supportAssessment.requirements[0].evidence[0].target / source_target_mismatch. An earlier recipe failure was question_target_mismatch for ICE versus Korean temperature spelling | Narrow temperature normalization and source-anchored surface normalization; incorrect targets/relations/quotes/quantities remain rejected |
| Persistence/alerts | System failures must not create insufficient-question alerts; real shortages must persist and notify only approved owners | Existing system-error/no-save/no-alert separation retained and verified through API regression and real shortage records |

The reproduced closing-order request returned HTTP 500 / GENERATION_UNPARSABLE after embedding and generation completed. It was an application evidence-validation failure, not a trial block. Its old model answer did not provide the missing branch POS procedure and is not treated as an accepted answer. Raw execution records and identifiers remain private and are not published.

## Lifecycle Contract

1. Approved HQ users register common manuals within their brand. Approved store owners register store manuals within an approved store membership.
2. Preview/confirm idempotency prevents duplicate submissions. A different normal user must authenticate independently; no shared trial actor list is required.
3. Parent/topic rows and approved child rows are distinct. `saved` is not `ready`; parents can be `parent_only` and failed/unindexed children remain visibly incomplete.
4. Replaying a completed registration reads present chunk/embedding flags rather than assuming an old result. Reindex missing children through the normal readiness UI; do not reupload to create duplicate content.
5. Normal scoped deletion removes manuals and their chunks through the verified FK contract. Existing conversation text remains historical context, not current evidence. Question source links can become NULL under the existing FK.
6. Empty completed batches can release their content hash on a later registration. Confirmed failed partial batches whose linked manuals are all gone can also release the hash and claim once. Actual `processing` batches are not automatically stolen or expired without proof that execution ended.
7. Retrieval always uses current approved scoped manuals/chunks. No old candidate cache or fixed manual/chunk/upload UUID is used as current evidence. Conversation context may identify the topic but every new answer must cite currently supplied evidence.
8. With no current manuals, the response is ordinary insufficient. With an empty search result but approved documents still present, the response is preparation guidance without generation/escalation. A real query/provider/validation outage remains a system error, not a fabricated missing-manual result.
9. Provider authentication/rate errors are separated as PROVIDER_AUTH_FAILED / PROVIDER_RATE_LIMITED, with 502/503 and distinct staff messages. Independent later questions are not blocked by a settled generation failure.

## Free Verification

Full RAG gate: 1691 passed; release boundary: 2 passed; application TypeScript and production build passed. Final staff UI error presentation: 23 passed.

The regressions cover deleted/no evidence, changed manual and chunk IDs, combined versus split temperature sections, reordered candidates, stale citation rejection, indexing transitions, sequential context/topic changes, partial-save/retry, current replay readiness, duplicate submissions, same-brand different-user re-registration, foreign-store denial, semantic/numeric/injection boundaries, normal/clarification/insufficient/out-of-scope/system-error distinction, saved-message behavior, alert recipients, provider errors and a failed logging sink.

These are free fake-boundary tests; they do not mean the shared database was repeatedly deleted/reseeded or that another account was automatically impersonated.

## Real UI Verification

Authenticated staff UI restored an existing conversation through the history list. Four questions were submitted sequentially once, on the ordinary no-preload production process.

| Question | HTTP / Classification | Current Evidence / Answer | Persistence / Owner Alerts |
| --- | --- | --- | --- |
| Closing-order acceptance | 200 / answered | Current Soongsil store instruction: check POS order status, ask the responsible person if unclear. No invented cutoff time or unconditional permission | Saved; 0 alerts |
| Iced vanilla-latte recipe | 200 / answered | Current HQ recipe: ICE 20oz, milk 220ml, espresso 2 shots about 60ml, syrup 20ml, ice about 70% | Saved; 0 alerts |
| Milk storage location | 200 / answered | Current Soongsil location: refrigerator right shelf | Saved; 0 alerts |
| Delivery order omission procedure | 200 / insufficient | Generic order policy did not establish the requested concrete delivery procedure | Saved; exactly 6 alerts linked to this question, all 6 approved Soongsil owners |

Saved messages and question logs were independently read back. Current source references matched the registered scope; real source and conversation identifiers remain in private audit records only.

The optimized production backend was validated in the UI. A subsequent provider-error wording change passed the staff UI regression suite; paid questions were not repeated merely for that message change.

Provider token accounting was independently verified. Historical trial ledgers, provider logs, backups and local launchers remain Git-ignored; ordinary service usage is recorded separately without admission gates.

## Preservation and Limitations

Before/after hashes matched for existing manuals, chunks, upload batches, profiles, memberships, stores and franchises. No destructive lifecycle repetition or permission mutation was performed. Original backups remain unchanged.

Still not verified live: a second account signing in and repeating the lifecycle, an actual restore INSERT, and active-job lease takeover/recovery. Other approved accounts exist, but only the shared authenticated staff session was used; no password/identity bypass was performed. Approval of an account in DB alone is not proof of a separate authenticated UI test. Owner alert links were verified in DB, not by automatically signing into an owner UI.

Partial readiness is not globally blocked when other valid current evidence is available. The empty-search preparation check does not claim every background indexing race is eliminated. Processing jobs are deliberately not reset automatically. These boundaries must remain explicit rather than be called complete based only on passing test counts.