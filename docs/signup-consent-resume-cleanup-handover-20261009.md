# Signup Consent, Resume and Incomplete-Account Cleanup

## Boundaries

Publication preparation uses original `il-it-da`, branch `fix/signup-validation-consent-social-20261009`, based on develop `771a88c`. The user authorized a scoped commit/push and a develop PR, but not automatic merge or external settings changes. Environment files, stash, unrelated cleanup reports and other worktrees are retained. Existing 039 is neither edited nor reapplied.

The user confirmed actual login/signup behavior, completed historical 039 cleanup and 040 application with permanent Auth deletion followed by same-email signup. These are user-operated results, not agent-operated live tests. Do not repeat the cleanup or reapply 039/040. Earlier preparation records are historical; no shared database/Auth/SMTP change, real OTP/research mail, account deletion or scheduler is run by this publication work. Naver/Kakao buttons are hidden on desktop/mobile while their provider code remains; Google/Apple and email paths remain available.

## Optional Research Consent

- Required keys remain service/privacy and role-specific store_connection/store_work. Research consent is a separate browser key/request property/Auth metadata key, never a required term. Default is false; all-consent selects it, but required-only acceptance permits signup.
- The quick-selection UI now has explicit "필수만 선택" and "전체 선택" commands, not an all-consent toggle. Required-only clears optional research acceptance even after selecting all. Individual choices, required-only next-step validation, separate storage and settings withdrawal remain unchanged. Both commands expose pressed state and a live selection summary.
- Visible wording: "서비스 개선을 위한 선택 설문·인터뷰 참여 안내 수신 동의". The yellow draft box is removed. All document definitions still have draft=true and contain review caveats, not a legal-review-complete assertion.
- Code confirms Auth user_metadata can store the choice without a schema migration. Final owner/staff submission stores accepted, server timestamp and server-owned review document version under signupResearchConsent. HQ and social signup pass the choice separately; refusal does not block signup.
- Collected/reused fields: account email/user ID plus choice, version and timestamp. No telephone invitation field, separate mailing list, interview response or recording is collected by this change.
- Purpose: prepare an opt-in for possible service-improvement survey/interview invitations. No sender/queue/campaign exists and nothing claims invitations are already operating.
- Current retention implementation is latest state in Auth metadata: withdrawal changes accepted to false; hard account deletion removes the metadata. Email/account fields follow their general account retention separately. This is NOT immutable consent evidence and user metadata is editable; production evidence retention, backups, contracting operator, contact, channels and legal wording need approval before any sending feature is enabled.
- Actual withdrawal control: environment settings for HQ/owner/staff, backed by authenticated GET/PATCH /api/auth/research-consent. PATCH requires same Origin and a boolean; it changes only the optional metadata key. Failed writes do not look successful. No role, mandatory consent, approval or membership is changed.

## Creation and Resume Boundaries

1. start prepares 039 and asks Supabase for passwordless OTP. Only Auth is created; no profile/membership/service permission is created.
2. verify validates the fresh provider session and bound current 039 request ID. It records email proof, not final signup completion.
3. complete validates name/phone/password/confirmation/required consent and matching verified identity before Auth final metadata/password update and bound 039 completion. A same-password retry persists metadata separately; metadata failure never creates completed state.
4. The store-application endpoint creates/upserts the profile and pending membership after server confirmation of final completion. Normal role/brand/store approval guards remain.
5. An incomplete request can reuse the Auth user with shouldCreateUser=false. The unchanged 039 RPC refreshes nonce/deadline and clears old verification on a fresh request. New windows without a current signup draft require email proof again; same-tab reload can restore nonsecret name/phone using actual server proof. Password and OTP are never restored or put into browser storage/logs.
6. Complete flow with a still-valid email-first account and final metadata, but no profile/membership, returns SIGNUP_INCOMPLETE plus login continuation, not an arbitrary second account/OTP. Login/status restore required terms and route toward pending store application. A deleted-ID stale complete flow remains blocked, as do registered/profile/membership/social/HQ identities; existing manual 039-only diagnostics are not bypassed.

## Incomplete Account Grace Proposal

Default proposal: 24 hours, configurable through INCOMPLETE_SIGNUP_GRACE_HOURS or explicit dry-run --grace-hours. This is a conservative operational proposal, not a measured conversion threshold or legal retention period. It allows a later shift/day to resume and is far longer than the three-minute OTP validity, but removes the ability to resume that exact Auth UUID once actually deleted. Confirm the period using operator usage/support evidence and data-retention review; do not activate automatically.

The pure candidate predicate requires an explicit signup_flow=email_first marker, owner/staff role, email-only identities, matching 039 flow, no completed_at/completed_user_id, no foreign verified ID, no profile or membership, no unknown lookup, no recent Auth update/login/flow progress and no active resend/OTP window. Final name/phone/required-consent metadata without a completion record is held for review instead of deleting a partial successful final submission. Unknown timestamps/provider/social state are not candidates.

Read-only operator dry-run, from original checkout:

```powershell
node --import ./tests/support/register-alias-hooks.mjs scripts/preview-incomplete-signups.ts --dry-run --email "TEST_EMAIL"
```

The program has NO execute/delete mode. It reads configuration without printing keys, uses Admin listUsers and public SELECT/count queries, and outputs hashed account/email refs plus eligibility/reasons. No live dry-run was run by this implementation. It never calls prepare/start, deleteUser or a row mutation; do not use --force/cron/scheduler to activate a nonexistent execute mode.

## Future Deletion Workflow: Not Implemented or Enabled

1. Operator reviews dry-run candidates and approves a grace period, impact and exact accounts. Preserve actor/audit/storage references and check the actual FK catalog first.
2. Obtain fresh Admin user, identity, metadata, 039, profile/membership and progress reads immediately before deletion. Any change from the approved snapshot means skip.
3. Rechecking alone does NOT remove the race between these reads and the supported Admin deleteUser(id, false), which runs on a separate connection. Before enabling a worker, add an operator-approved shared cleanup lease/claim or signup maintenance window that all start/resend/verify/complete paths honor. Do not change/reapply 039 to improvise this, and do not claim current dry-run is an atomic deletion protocol.
4. Do not hold 039's advisory lock across the external Auth deletion API: an installed 040 trigger needs that same key on the Auth connection and may deadlock/timeout. Resolve the coordinated protocol and retry semantics in an isolated project before an execute mode exists.
5. Use only the supported Admin hard-delete API, not direct auth.users SQL or beforeunload/tab cleanup. If Auth deletion fails, preserve flow/state and skip further cleanup.
6. 040 was applied and its permanent-delete/same-email signup path was confirmed by the user. This does not implement a cleanup worker, solve its read/delete race or authorize further deletions. The existing single COMPLETED-flow cleanup SQL is not an uncompleted-account worker template. Do not delete an email-wide flow that has been replaced by a new account/request.
7. Keep the applied 040 and its reviewed FK effects; do not reapply it. It handles physical Auth deletes, not soft deletes or historical backfill. New UUIDs must never inherit old profile, approval, store/brand rights or ownership; stores/manuals must remain under reviewed FK preservation rules. Broader concurrency/access/retention acceptance is not inferred from the reported successful signup test.

## Verification Map

| Scenario | Evidence type |
| --- | --- |
| Request then abandon/re-request; verified then reopen/reverify | Actual original components with mocked HTTP plus unchanged 039 in isolated PGlite |
| Partial input refresh/abandon | Browser draft restoration and blank password/no stored OTP assertions |
| Final completion before store application | Actual route mock, completed-account lookup gates and browser login/store continuation |
| Existing/HQ/social/approved identities | Auth/signup/profile/store-role regression suites and no privilege mutation paths |
| Optional refusal/acceptance and required terms | Server metadata assertions and browser required-only/all-consent checks |
| Expiry/resend/repeated click/cross-request | Browser held-request/cooldown cases and provider/039 nonce-race tests |
| Mobile/dark/full-document/keyboard | 320px/desktop browser cases, focus-cycle and screenshot/overflow checks |
| Grace and unsafe cleanup candidates | Pure mocked candidate cases; no real deletion/schedule |

Live delivery, real resumed-provider OTP sessions, Auth metadata consent writes/withdrawal and future cleanup concurrency are NOT certified by mocked tests. Final command results are reported in the session; no passing result is inferred from merely having a test file.

## OTP Feedback and Email Templates Follow-Up

Wrong six-digit values use "인증번호가 틀립니다. 다시 확인해 주세요." below the input; expiration keeps the separate deadline message. Supabase's generic otp_expired/invalid message is interpreted against a freshly checked same-request server deadline. Outages, rate limits, unknown responses and changed requests are not misrepresented as wrong numbers. This cannot prove the provider's internal rejection cause when provider TTL/settings differ.

Manual Confirm signup and Magic Link HTML/subjects, shared expiry impact and actual delivery acceptance are in `docs/auth-email/otp-manual-configuration-20261009.md`. No template/SMTP/Auth configuration is applied automatically. Both start and resend still use the email-first signInWithOtp helper. Resend retains code/deadline on failure and clears code/errors only after a valid successful server deadline.