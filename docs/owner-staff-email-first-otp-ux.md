# Owner and Staff Email-First OTP Signup

## Implementation and boundaries

Worktree: `C:/Users/farew/Desktop/il-it-da`, develop at `55a3b6e7a40b2fc96af64267bbaf67932d57cc94`.

The user confirmed receipt of an actual OTP email in the previous password-signup flow. That is a user-confirmed historical result, not verification of this new six-digit passwordless flow. No actual email, shared DB write, Auth/SMTP setting change, commit or push was performed for this change.

## 039 Pre-Application Review (2026-10-08)

- Actual shared read-only PostgREST OpenAPI GET returned HTTP 200 and UUID format for profiles.id, profiles.user_id and store_memberships.user_id. This is real shared-schema evidence for those three columns, not proof of the Auth-internal catalog or exact SQL grants.
- No direct DB connection URL or SQL execution tool was available. Shared catalog preflight/postflight SQL was prepared but NOT executed remotely. Do not claim that synthetic fixtures prove all shared columns. Execute `docs/sql/owner-staff-email-first-preflight.sql` as read-only SQL; require all 12 dependency rows to be OK and all three roles present. Existing 039 objects require manual review, not automatic replacement.
- Migration now independently checks all referenced types before creating objects, including auth.users.last_sign_in_at, JSON metadata and encrypted_password. A missing profiles.user_id was tested to abort with 55000 and create no flow table.
- sent_at makes sent idempotent for the exact reservation UUID: replay returns the stored expires_at and never resets its 180-second window. Old UUID results cannot acknowledge a new resend.
- inspect returns the server request UUID. The actual verify route calls verifyOtp first, validates the returned session.user and its new access_token through getUser(new JWT), then passes the captured UUID/user to the service RPC. It never substitutes an earlier cookie session. SQL requires the same UUID, successful sent_at, unexpired window and Auth last_sign_in_at at or after that send. Old email_confirmed_at alone is insufficient. SQL is a trusted service-only record, not an independent OTP cryptographic verifier; do not expose its verify action to anon/authenticated.
- complete first validates final fields/terms and authenticated identity, then updateUser success, then the same UUID-bound completion RPC. SQL also requires a verified user for that request and nonempty encrypted_password. A resend between inspection and update/complete refuses completion even if the password was already changed. That partial state remains retryable; it does not authorize profile/membership creation. Repeating completed RPC with the same user/UUID is idempotent; mismatched IDs are refused.
- Actual original verify/complete route modules were executed with injected SDK/RPC only: fresh JWT path, ignored forged client request ID, crossed-resend signOut, Origin refusal, password failure and post-update completion failure were verified. This is handler mock verification, not real provider authentication.
- Core/actual-handler tests: 28/28; whole Auth: 304/304; typecheck and integration pass. Persistent local SQL regression: 2/2 with many lifecycle/protection/privilege assertions, using actual isolated PostgreSQL via PGlite. Both anonymous roles cannot execute/read/write; service_role can. The SQL scenarios test two queued calls and stale IDs, not simultaneous locks in multiple independent PostgreSQL backends. Real multi-connection lock-wait/concurrency acceptance remains unverified.
- Applying 039, changing Auth settings, sending mail and committing/pushing were not performed during this review. Environment-file changes made by the user were preserved.

After authorized application, execute `docs/sql/owner-staff-email-first-postflight.sql` read-only. Require RLS enabled, expected sent/request/verified/completed columns, exactly the five-argument service-only function, empty search_path, expected function body hash, anon/authenticated execution and table CRUD false, service_role true, and no PUBLIC grants/unexpected policies. Compare the returned body MD5 with the normalized reviewed migration function, not an assumed historical checksum. These queries never invoke a signup action or read real account/flow rows.

Reviewed normalized 039 function body MD5: `0bfddc800a7cc3bacb8175c57ea1a202`; postflight matches_reviewed_body must be true. The row-lock acquisition is followed by a fresh clock_timestamp before time-sensitive decisions. Recompute/update this comparison only after reviewing any subsequent function edit.

Reproduce local SQL tests without modifying project dependencies:

```powershell
$tools = Join-Path $env:TEMP 'ilitda-email-first-sql-tools'
npm install --prefix $tools --no-save --package-lock=false @electric-sql/pglite
node --test tests/auth/email-first-signup-sql.test.mjs
node --import ./tests/support/register-alias-hooks.mjs --test tests/auth/email-first-signup.test.ts
```

Existing CSS documentation/test changes, stash, desktop.ini and environment secrets were preserved. Only the requested public length setting in .env.local was changed from 8 to 6; the original OWNER_STAFF_EMAIL_OTP_READY value was not changed. The local dev process uses readiness false and new policy readiness false until operator acceptance. No random/temporary password is generated.

## Flow

1. Select owner/staff and required terms. On the basic-info screen, enter email and request a code; no name, phone or password is sent at this stage.
2. The service-only new preparation RPC rejects existing profiles, brand profiles, memberships, social identities and role mismatches. It serializes the email and enforces a 60-second resend reservation. Existing confirmed password accounts are treated as legacy, not silently logged in/reset by this route.
3. Official `signInWithOtp` is used. New accounts use `shouldCreateUser: true` with owner/staff metadata; incomplete existing accounts use `shouldCreateUser: false` with no metadata updates. No existing role/password is changed at send time. A successful send receipt finalizes a server deadline of 180 seconds for the same reservation UUID. A failed or stale send does not open/extend verification.
4. The screen displays email, six-digit code/remaining time/verify, name, phone, password, password confirmation. Absolute deadline and resend availability are persisted, not a fresh countdown; reload does not extend expiry. Email changes clear code, verified state, both deadlines and prior store/application drafts. Passwords and codes remain only in memory/request bodies, never browser storage or logs.
5. `verifyOtp(type: email)` is called only for exactly six digits before the server deadline. The result must match the prepared user, email and role. A service-only verified record is written before accepting onboarding. At expiry, verification is rejected even if the provider is misconfigured with a longer lifetime. Direct SDK verification alone is not accepted as completed app signup.
6. After email verification, the user enters remaining information. Client and server validate name/phone/password/confirmation/role/terms. A real verified session and the service record are required before authenticated `updateUser({password,data})`. The data update has no role field. The new complete RPC records completion without creating a profile or store request.
7. Status restores verified/incomplete or completed information from the authenticated user and service record, not a browser verified flag. Completed legacy/session state can proceed without resetting an existing password.
8. The existing store-selection/application workflow continues. Initial email membership POST requires complete/legacy state plus email/terms/profile validation and existing store/brand eligibility; only then may the profile and pending membership be created. Existing approved social profiles and HQ/social login/signup paths are preserved. Approval and store access retain their existing server guards.

There is no separate continue-signup button or password-signup resume explanation. Retrying the normal code request resumes incomplete accounts server-side without creating duplicates or changing their role.

## Operator steps (not executed)

The current application does NOT certify shared Auth configuration. New send/verify/complete APIs fail closed until the new policy readiness flag is explicitly set after these steps.

1. Keep `OWNER_STAFF_EMAIL_FIRST_OTP_POLICY_READY` false/unset. Retain an operator backup of Auth config/templates and review the impact of a project-wide expiration change. Confirm that external auth hooks/triggers do not auto-create approved profiles/memberships before final onboarding.
2. Review and execute `supabase/migrations/039_owner_staff_email_first_signup.sql` once in an authorized environment after the existing 038. Do not reapply 037/038. If any 039 objects already exist, stop for compatibility review rather than dropping/repairing them automatically. The migration intentionally does not use create-or-replace or silently overwrite unknown objects.
3. Refresh PostgREST schema after applying the new function (`notify pgrst, 'reload schema';` in the authorized SQL editor). Check the five-argument `prepare_owner_staff_email_first_signup(text,text,text,uuid,uuid)` signature; RLS must be enabled on owner_staff_email_signup_flows, anon/authenticated denied, service_role allowed. Verify NULL/role, simultaneous sends, reservation UUID, no-send expiry, verify deadline and verified-only completion against synthetic users before live use.
4. In Supabase Authentication / Sign In / Providers / Email, set **Email OTP length 6** and **Email OTP expiration 180 seconds**. Keep email provider enabled, signup allowed and Confirm email enabled. The public settings endpoint used by the app does not expose all length/expiry fields, so verify them in the dashboard/config; readiness is an operator declaration, not independent provider proof.
5. Check the **Magic Link or OTP** template used by signInWithOtp and the **Confirm signup** template potentially used for new users. Owner/staff code mail must contain `{{ .Token }}` and state its three-minute validity. Review role/flow conditional rendering so other HQ/social/invitation/recovery consumers keep their existing appropriate content. Do not assume the earlier password-signup Confirm signup template alone covers passwordless resends. Preserve required links for non-signup consumers rather than globally removing them.
6. Review Site URL / redirect allowlist and SMTP limits/delivery without changing them implicitly. Supabase's expiration setting also affects Magic Links and other email confirmation, recovery, change and invitation links; obtain acceptance for this global impact. Changing the length may invalidate previously issued eight-digit requests; users must obtain a new code after deployment.
7. Set `NEXT_PUBLIC_SIGNUP_EMAIL_OTP_LENGTH=6`, rebuild/restart all instances. After 039, templates and provider 6/180 are verified, explicitly enable both `OWNER_STAFF_EMAIL_OTP_READY=true` and `OWNER_STAFF_EMAIL_FIRST_OTP_POLICY_READY=true` in the authorized environment. Do not enable readiness just because local mock tests pass.
8. Manually test one authorized new owner and one staff, unfinished retry, existing password/social account rejection, six-digit receipt, code after 180 seconds, resend wait, reload, email change, final password save, pending application and approval isolation. Do not use automated repeated email sends.

The old prepare_owner_staff_signup and request table from 038 remain untouched. The new table stores email/role/timestamps, reservation ID and verified/completed user IDs, never password/token. It contains sensitive identifiers, is service-only and needs an operator retention policy.

## Verification

- New core tests: 17/17 (email-only send, existing account refusal, no duplicate account/metadata update on resume, malformed code, expiry before provider, leading zeros, verified record, SDK-only session refusal, final fields/terms and no role mutation).
- Entire Auth regression: 293/293, including HQ/social/session/role and initial membership tests. Initial verified-but-incomplete signup is refused with no profile/request writes; completed owner and staff signup returns pending, not approved.
- Typecheck passes; check:frontend 5/5 including frontend 103/103; check:integration 9 checks, 0 errors/0 warnings; diff whitespace passes. No assertions were weakened or existing legacy tests deleted.
- Original dev mock browser: owner desktop 1280px and staff mobile 390px, 2/2. Email alone, invalid/long email, provider error, no extra request fields, 03:00, stored absolute deadline, reload/00:00 expiry, resend timer reset, leading zero/wrong code, email change, final information/password confirmation, verified-to-store navigation and no password/code storage passed. Screenshots are ignored .next artifacts, not commit data. This browser test covers verification/info-to-store navigation, while store request/pending and approval/access are API/role regressions, not a live full shared-DB E2E acceptance.
- Actual disposable PostgreSQL via PGlite in a temp tool folder: 039 syntax, NULL/role, 60-second throttle, failed-send closed deadline, successful receipt, verified-only complete, expired verify, existing-profile rejection, anon 42501/service-role allowed passed with synthetic schema/users. No shared PostgreSQL/Supabase schema was applied or copied; production concurrency/schema compatibility still needs operator acceptance.
- New real provider mail, actual six-digit/180-second Supabase expiry and new shared RPC deployment are NOT verified. The user's previous real receipt is not reused as proof of the new flow.

## Official References

- https://supabase.com/docs/guides/auth/auth-email-passwordless
- https://supabase.com/docs/guides/auth/passwords
- https://supabase.com/docs/guides/auth/auth-email-templates

These document automatic user creation and shouldCreateUser, email verifyOtp sessions, authenticated updateUser password changes, Token templates and the shared expiration impact. Installed SDK types and existing SSR cookie/session policy are used; no homemade password or successful-response bypass was introduced.