# 040 Auth-Delete Signup-State Cleanup — Application Preparation

**Status: draft only. Not applied to the shared database. Do not execute the 040 migration or cleanup SQL without an explicit operator decision after reviewing the results below.**

## Source and Version Record

- `origin/develop` was fetched; fetched `origin/develop` is `a3421619d8a32b2aaeeaf175452b8e70ef9bd384` (PR #101 merge).
- Review worktree: `C:/Users/farew/Desktop/il-it-da-current-membership-review-20261008`.
- Review branch: `fix/current-email-first-membership-review-20261008`, HEAD `a3421619d8a32b2aaeeaf175452b8e70ef9bd384`.
- The original checkout remains on `develop` at `55a3b6e7a40b2fc96af64267bbaf67932d57cc94`, with its pre-existing changes, `.env.local`, stash and 3000 server preserved.
- Existing migrations 038 and 039 are unchanged and must not be reapplied. The highest numbered migration in fetched develop is 039; prefix 040 is available. The draft intentionally remains under `docs/sql/`, not `supabase/migrations/`, until reviewed and approved.

## What the Draft Does

`040_auth_delete_signup_state_cleanup.draft.sql` adds one AFTER DELETE trigger to `auth.users` and a new `SECURITY DEFINER` function in `public`. It does not alter or replace the existing 038/039 tables/functions and does not run a backfill.

For the deleted row's normalized email, the function:

1. Takes the same email advisory transaction lock key (`39`) as the 039 prepare RPC.
2. Checks whether any Auth row still has that normalized email. If one exists, it leaves both 038/039 records untouched.
3. If none exists, deletes only that normalized email's 039 flow and 038 cooldown/request row.
4. Does not delete profiles, memberships, stores, manuals, question logs, notices, or another Auth user.

The function uses an empty fixed search path, schema-qualifies application tables, and revokes direct execution from PUBLIC, anon and authenticated. It does not drop or replace existing functions/triggers; a collision with its exact function or trigger name aborts before object creation. The new trigger can coexist with existing Auth triggers, which the preflight lists for review.

## Hard Delete, Soft Delete, and Failure Behavior

Supabase's official [`auth.admin.deleteUser(id, shouldSoftDelete)` reference](https://supabase.com/docs/reference/javascript/auth-admin-deleteuser) says `shouldSoftDelete: true` leaves a hashed identifier and is not reversible; the default is `false` for backward compatibility. This trigger fires only on a physical PostgreSQL `DELETE`. An Auth soft-delete/update does not fire it, and the 039 RPC still sees the remaining `auth.users` row. Confirm that the dashboard action named “permanently delete” maps to a physical DELETE in the isolated project before adopting this trigger.

Under PostgreSQL trigger semantics, if the trigger raises an error, the Auth `DELETE` statement fails and its FK cascades and trigger-side 038/039 deletes roll back with that statement/transaction. The user remains in Auth and the signup state remains. The application should report the Auth deletion failure; do not manually clear records to mask it. Exact Supabase Auth service transaction behavior and lock-wait behavior must be verified in an authorized isolated Supabase project. PGlite is not proof of those service internals.

Existing FK expectations to inspect in the actual project's catalog before application:

- The supplied target catalog has no `profiles.id -> auth.users.id` FK. Its absence is informational, not an application blocker. Do not create this FK for 040.
- `profiles.user_id -> auth.users.id`: ON DELETE CASCADE.
- `store_memberships.user_id -> auth.users.id`: ON DELETE CASCADE.
- `stores.boss_id -> profiles.id`: ON DELETE SET NULL, preserving the store row.

The trigger does not touch `stores` or manuals. The actual post-migration FK list and production behavior must be checked; the isolated regression uses synthetic FK definitions only.

## Exact SQL Files

All paths below are absolute paths in the review worktree:

- 040 migration draft: `C:\Users\farew\Desktop\il-it-da-current-membership-review-20261008\docs\sql\040_auth_delete_signup_state_cleanup.draft.sql`
- Read-only preflight: `C:\Users\farew\Desktop\il-it-da-current-membership-review-20261008\docs\sql\040_auth_delete_signup_state_preflight.readonly.sql`
- Read-only postflight: `C:\Users\farew\Desktop\il-it-da-current-membership-review-20261008\docs\sql\040_auth_delete_signup_state_postflight.readonly.sql`
- Already-deleted account preview: `C:\Users\farew\Desktop\il-it-da-current-membership-review-20261008\docs\sql\preview-deleted-owner-staff-signup-state.readonly.sql`
- Already-deleted account cleanup draft: `C:\Users\farew\Desktop\il-it-da-current-membership-review-20261008\docs\sql\cleanup-deleted-owner-staff-signup-state.draft.sql`

## Operator Sequence

Run each phase as a separate SQL Editor execution and retain each result before moving on. Do not concatenate phases into one script/tab where a later COMMIT can obscure the result set. Verify the SQL Editor is connected to the same project ref as the application environment without sharing any keys.

1. **Preflight:** run the complete `040_auth_delete_signup_state_preflight.readonly.sql` by itself. It is a read-only catalog query. It returns groups for `column_contract`, `related_foreign_keys`, `expected_account_delete_fk_contracts`, `existing_auth_users_triggers_review_required`, `execution_role_and_privileges`, and `new_object_names_available`.
2. **Stop and review** if any expected column does not match, `all_match` is not true for the three required FK relationships, a required role is missing, schema USAGE/public CREATE/PLpgSQL USAGE is false, Auth SELECT/full-row visibility/TRIGGER is false, state-table SELECT/DELETE or RLS access is false, either object name is occupied, or an existing Auth trigger is not understood. The three required FK checks cover profile user ID and membership user ID CASCADE plus store boss/profile SET NULL. All other FKs remain visible in `related_foreign_keys`; do not add an absent profile-ID FK. The trigger inventory includes Supabase internal triggers; never drop/replace them.
3. **Operator review gate:** the draft contains `auth_trigger_inventory_reviewed boolean := false`. Leave it false until every Auth trigger from preflight is reviewed against the target project's supported Supabase configuration and the deploy owner approves coexistence. In the one reviewed copy only, change it to true immediately before the authorized run. If it remains false, DDL aborts with `AUTH_DELETE_TRIGGER_INVENTORY_REVIEW_REQUIRED`. Do not override a name collision or apply over an unknown managed trigger.
4. **Apply only after explicit approval:** run the entire `040_auth_delete_signup_state_cleanup.draft.sql` once as its own transaction. Do not copy it into an applied migration or reapply 038/039. If execution fails, let its transaction roll back and preserve the Auth account/state for diagnosis. Confirm the dashboard action performs a hard deletion (the Admin API soft-delete option keeps a hashed identity and this AFTER DELETE trigger does not handle it).
5. **Postflight:** in a separate execution, run `040_auth_delete_signup_state_postflight.readonly.sql`. Confirm the new trigger exists/enabled with AFTER DELETE definition; function owner, `SECURITY DEFINER`, empty search_path, normalized body checksum and state-table RLS access are as reviewed; PUBLIC/anon/authenticated cannot execute; and the catalog still shows expected FK actions. Archive the returned checksum with the approved migration; do not assume one from this draft.
6. **Historical deleted test account:** 040 does not run retroactively. First rerun `preview-deleted-owner-staff-signup-state.readonly.sql` with the exact normalized email, matching 039 `request_id`, and old user ID from the flow diagnostics. Require `no_auth_rows`, `no_profile_rows`, `no_membership_rows`, `exactly_one_039_request_match`, and `flow_user_ids_match_confirmed_old_user` all true. If any result differs, stop. Review the full 038/039 arrays and verify the SQL Editor project ref.
7. Only after reviewing that preview, fill the exact three identifiers in `cleanup-deleted-owner-staff-signup-state.draft.sql`. Its `p_confirm_delete` defaults to false and therefore performs no deletion. The guarded run repeats the no-Auth/no-profile/no-membership checks, requires exactly the matching email+request ID+old Auth ID in 039, and only then removes one 039 row plus the same-email 038 cooldown row. Set confirmation true only for this one reviewed test account. The script commits before its final count SELECT so the result is visible. Require all remaining counts to be zero; never use an unfiltered delete.

## Isolated Verification and Remaining Acceptance

PostgreSQL's [CREATE TRIGGER requirements](https://www.postgresql.org/docs/current/sql-createtrigger.html#SQL-CREATETRIGGER-NOTES) require table TRIGGER and function EXECUTE privileges, not Auth table ownership or superuser status. This draft creates its function under the migration executor, which is also its SECURITY DEFINER owner and has EXECUTE as creator. Auth DELETE and `current_user_is_auth_owner_or_superuser` are informational only. The executor still needs schema/language creation access; its function needs schema USAGE, Auth SELECT with full-row visibility, and state-table SELECT/DELETE with RLS access at runtime. Preserve those grants after deployment. A true `can_create_auth_delete_trigger` result covers DDL access only, not all runtime requirements.

The supplied real preflight reports the three required FKs and state-table access present, Auth owner/superuser false, and Auth TRIGGER true. The isolated fixture now deliberately omits the profile-ID Auth FK and installs 040 as a non-owner, non-superuser role granted Auth SELECT/TRIGGER but no Auth DELETE. BYPASSRLS in the synthetic fixture models the already-confirmed state-table access; it is not a recommendation to grant new privileges in the shared project.

The PGlite test `tests/auth/email-first-signup-sql.test.mjs` passed 3/3 with synthetic users/schema: 039 lifecycle, 039 catalog guard, and the 040 draft trigger flow. The 040 test verifies: an existing Auth trigger remains and executes; an injected state-delete failure rolls back Auth DELETE and FK cascades; a second Auth row matching the same normalized email blocks cleanup; deletion of the last matching Auth row cleans only the target 038/039 records; a later start returns `new` and accepts a different user ID; existing Auth/profile/membership remains blocked; stores/manuals/another user's data remain; and pre/postflight SQL executes in the isolated catalog.

Not proven by PGlite: actual shared FK/privilege/trigger catalog, Supabase Dashboard delete's hard-vs-soft behavior, Auth API transaction atomicity, concurrent Auth delete/signup lock ordering, production owner permissions, or service failure behavior. No shared DB was queried or changed during this preparation. Do not apply until the read-only preflight results and an isolated Supabase test are reviewed.

After approved application, manually test: hard-delete one dedicated test owner, verify only that old user's profile/membership/auth are gone and its 038/039 state is cleared; re-register the same email; verify a new Auth user ID and fresh pending store application; confirm no old approval/store membership transfers; approve through the normal authorized path; log out and log in; verify pre-approval and post-approval access. Repeat staff flow separately. Do not automate actual email sends.
