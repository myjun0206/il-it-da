import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

const tools = process.env.EMAIL_FIRST_SQL_TEST_TOOLS_PATH ?? path.join(tmpdir(), "ilitda-email-first-sql-tools/package.json");
const { PGlite } = createRequire(tools)("@electric-sql/pglite");
const migration = readFileSync("supabase/migrations/039_owner_staff_email_first_signup.sql", "utf8");
const authDeleteCleanupDraft = readFileSync("docs/sql/040_auth_delete_signup_state_cleanup.draft.sql", "utf8");
const deletedStatePreview = readFileSync("docs/sql/preview-deleted-owner-staff-signup-state.readonly.sql", "utf8");
const deletedStateCleanupDraft = readFileSync("docs/sql/cleanup-deleted-owner-staff-signup-state.draft.sql", "utf8");
const setup = `
create role anon; create role authenticated; create role service_role bypassrls; create schema auth;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,last_sign_in_at timestamptz,raw_app_meta_data jsonb,raw_user_meta_data jsonb,encrypted_password text);
create table auth.identities(user_id uuid,provider text);
create table public.profiles(id uuid,user_id uuid);
create table public.store_memberships(user_id uuid);`;
const userId = "11111111-1111-4111-8111-111111111111";
const otherId = "22222222-2222-4222-8222-222222222222";

test("039 reauthenticates abandoned email-first signup without a profile, membership or previous-request reuse", async () => {
  const db = new PGlite();
  const email = "abandoned@example.invalid";
  try {
    await db.exec(setup);
    await db.exec(migration);
    const rpc = async (action, requestId = null) => (await db.query(
      "select public.prepare_owner_staff_email_first_signup($1,'owner',$2,$3::uuid,$4::uuid) result",
      [email, action, userId, requestId],
    )).rows[0].result;
    const first = await rpc("start");
    assert.equal(first.kind, "new");
    await db.query("insert into auth.users values($1,$2,null,null,$3::jsonb,$4::jsonb,'')", [userId, email, JSON.stringify({ provider: "email" }), JSON.stringify({ role: "owner", signup_flow: "email_first" })]);
    await rpc("sent", first.requestId);
    assert.equal((await rpc("start")).kind, "rate_limited");
    await db.query("update public.owner_staff_email_signup_flows set available_at=now()-interval '1 second' where email=$1", [email]);
    const second = await rpc("start");
    assert.equal(second.kind, "resume");
    assert.notEqual(second.requestId, first.requestId);
    await rpc("sent", second.requestId);
    await db.query("update auth.users set email_confirmed_at=clock_timestamp(),last_sign_in_at=clock_timestamp() where id=$1", [userId]);
    assert.equal((await rpc("verify", second.requestId)).emailVerified, true);
    assert.equal((await rpc("complete", second.requestId)).kind, "unavailable");
    await db.query("update public.owner_staff_email_signup_flows set available_at=now()-interval '1 second' where email=$1", [email]);
    const reopened = await rpc("start");
    assert.equal(reopened.kind, "resume");
    assert.notEqual(reopened.requestId, second.requestId);
    assert.equal((await rpc("inspect")).emailVerified, false);
    assert.equal((await rpc("verify", second.requestId)).kind, "unavailable");
    await rpc("sent", reopened.requestId);
    await db.query("update auth.users set last_sign_in_at=clock_timestamp() where id=$1", [userId]);
    assert.equal((await rpc("verify", reopened.requestId)).emailVerified, true);
    assert.equal((await db.query("select count(*)::int count from public.profiles")).rows[0].count, 0);
    assert.equal((await db.query("select count(*)::int count from public.store_memberships")).rows[0].count, 0);
    await db.query("update auth.users set encrypted_password='synthetic-hash' where id=$1", [userId]);
    assert.equal((await rpc("complete", reopened.requestId)).kind, "complete");
    assert.equal((await rpc("start")).kind, "complete");
    assert.equal((await db.query("select count(*)::int count from public.profiles")).rows[0].count, 0);
    assert.equal((await db.query("select count(*)::int count from public.store_memberships")).rows[0].count, 0);
  } finally { await db.close(); }
});

test("039 local PostgreSQL request lifecycle, protection and privileges", async () => {
  const db = new PGlite();
  try {
    await db.exec(setup);
    const preflight = await db.exec(readFileSync("docs/sql/owner-staff-email-first-preflight.sql", "utf8"));
    assert.equal(preflight[1].rows.length, 12);
    assert.ok(preflight[1].rows.every((row) => row.result === "OK"));
    await db.exec(migration);
    const rpc = async (email, action, uid = null, requestId = null, role = "owner") =>
      (await db.query("select public.prepare_owner_staff_email_first_signup($1,$2,$3,$4::uuid,$5::uuid) result", [email, role, action, uid, requestId])).rows[0].result;
    const account = async (id, email, role = "owner", provider = "email") => db.query(
      "insert into auth.users values($1,$2,now()-interval '1 day',now()-interval '1 day',$3::jsonb,$4::jsonb,'')",
      [id, email, JSON.stringify({ provider }), JSON.stringify({ role })],
    );
    assert.equal((await rpc(null, "start")).kind, "unavailable");
    assert.equal((await rpc("bad", "start")).kind, "unavailable");
    assert.equal((await rpc("invalid@example.invalid", "start", null, null, "hq")).kind, "unavailable");
    const parallel = await Promise.all([rpc("new@example.invalid", "start"), rpc("new@example.invalid", "start")]);
    assert.deepEqual(parallel.map((row) => row.kind).sort(), ["new", "rate_limited"]);
    const first = parallel.find((row) => row.kind === "new");
    assert.equal((await rpc("new@example.invalid", "inspect", null, null, "staff")).kind, "role_mismatch");
    assert.equal((await rpc("new@example.invalid", "resend")).kind, "rate_limited");
    assert.equal((await rpc("unknown@example.invalid", "resend")).kind, "unavailable");
    await account(userId, "new@example.invalid");
    await db.query("update auth.users set email_confirmed_at=now()-interval '1 day' where id=$1", [userId]);
    const sent = await rpc("new@example.invalid", "sent", null, first.requestId);
    const rows = await db.query("select sent_at,expires_at from public.owner_staff_email_signup_flows where email=$1", ["new@example.invalid"]);
    assert.equal(new Date(rows.rows[0].expires_at) - new Date(rows.rows[0].sent_at), 180000);
    assert.equal((await rpc("new@example.invalid", "sent", null, first.requestId)).expiresAt, sent.expiresAt);
    assert.equal((await rpc("new@example.invalid", "verify", userId, first.requestId)).kind, "unavailable");
    await db.query("update auth.users set last_sign_in_at=clock_timestamp() where id=$1", [userId]);
    assert.equal((await rpc("new@example.invalid", "verify", userId, otherId)).kind, "unavailable");
    assert.equal((await rpc("new@example.invalid", "verify", otherId, first.requestId)).kind, "unavailable");
    assert.equal((await rpc("new@example.invalid", "verify", userId, first.requestId)).emailVerified, true);
    assert.equal((await rpc("new@example.invalid", "complete", userId, first.requestId)).kind, "unavailable");
    await db.query("update public.owner_staff_email_signup_flows set available_at=now()-interval '1 second' where email=$1", ["new@example.invalid"]);
    const resent = await rpc("new@example.invalid", "resend");
    assert.notEqual(resent.requestId, first.requestId);
    assert.equal((await rpc("new@example.invalid", "inspect")).emailVerified, false);
    assert.equal((await rpc("new@example.invalid", "sent", null, first.requestId)).kind, "unavailable");
    assert.equal((await rpc("new@example.invalid", "verify", userId, first.requestId)).kind, "unavailable");
    assert.equal((await rpc("new@example.invalid", "complete", userId, first.requestId)).kind, "unavailable");
    await rpc("new@example.invalid", "sent", null, resent.requestId);
    await db.query("update public.owner_staff_email_signup_flows set expires_at=now()-interval '1 second' where email=$1", ["new@example.invalid"]);
    assert.equal((await rpc("new@example.invalid", "verify", userId, resent.requestId)).kind, "unavailable");
    await db.query("update public.owner_staff_email_signup_flows set expires_at=now()+interval '180 seconds' where email=$1", ["new@example.invalid"]);
    await db.query("update auth.users set last_sign_in_at=clock_timestamp(),encrypted_password='synthetic-hash' where id=$1", [userId]);
    assert.equal((await rpc("new@example.invalid", "verify", userId, resent.requestId)).emailVerified, true);
    assert.equal((await rpc("new@example.invalid", "complete", userId, resent.requestId)).kind, "complete");
    const completed = await db.query("select completed_at from public.owner_staff_email_signup_flows where email=$1", ["new@example.invalid"]);
    assert.equal((await rpc("new@example.invalid", "complete", userId, resent.requestId)).kind, "complete");
    assert.deepEqual((await db.query("select completed_at from public.owner_staff_email_signup_flows where email=$1", ["new@example.invalid"])).rows, completed.rows);
    assert.equal((await rpc("new@example.invalid", "complete", userId, first.requestId)).kind, "unavailable");
    await account(otherId, "social@example.invalid", "owner", "google");
    assert.equal((await rpc("social@example.invalid", "start")).kind, "exists");
    await db.query("update auth.users set raw_app_meta_data='{}',raw_user_meta_data='{\"role\":\"hq\"}' where id=$1", [otherId]);
    assert.equal((await rpc("social@example.invalid", "start")).kind, "exists");
    await db.query("update auth.users set raw_app_meta_data='{\"provider\":\"email\"}',raw_user_meta_data='{\"role\":\"owner\"}' where id=$1", [otherId]);
    await db.query("insert into public.profiles values($1,$2)", [userId, otherId]);
    assert.equal((await rpc("social@example.invalid", "start")).kind, "exists");
    await db.exec("delete from public.profiles");
    await db.query("insert into public.store_memberships values($1)", [otherId]);
    assert.equal((await rpc("social@example.invalid", "start")).kind, "exists");
    await db.exec("delete from public.store_memberships");
    assert.equal((await db.query("select count(*)::integer count from public.profiles")).rows[0].count, 0);
    assert.equal((await db.query("select count(*)::integer count from public.store_memberships")).rows[0].count, 0);
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      await assert.rejects(() => rpc("unknown@example.invalid", "inspect"), (error) => error.code === "42501");
      for (const statement of ["select * from public.owner_staff_email_signup_flows", "delete from public.owner_staff_email_signup_flows", "update public.owner_staff_email_signup_flows set role='owner'", "insert into public.owner_staff_email_signup_flows(email) values('blocked@example.invalid')"]) {
        await assert.rejects(() => db.exec(statement), (error) => error.code === "42501");
      }
      await db.exec("reset role");
    }
    await db.exec("set role service_role");
    assert.equal((await rpc("unknown@example.invalid", "inspect")).kind, "unavailable");
    await db.exec("select * from public.owner_staff_email_signup_flows;reset role");
    const postflight = await db.exec(readFileSync("docs/sql/owner-staff-email-first-postflight.sql", "utf8"));
    assert.ok(postflight.some((result) => result.rows.some((row) => row.matches_reviewed_body === true)));
    assert.ok(postflight.some((result) => result.rows.some((row) => row.rolname === "anon" && row.can_execute === false)));
    assert.ok(postflight.some((result) => result.rows.some((row) => row.rolname === "service_role" && row.can_execute === true)));
  } finally { await db.close(); }
});

test("039 rejects an incompatible real catalog before creating objects", async () => {
  const db = new PGlite();
  try {
    await db.exec(setup);
    await db.exec("alter table public.profiles drop column user_id");
    await assert.rejects(() => db.exec(migration), (error) => error.code === "55000");
    await db.exec("rollback");
    assert.equal((await db.query("select to_regclass('public.owner_staff_email_signup_flows') object")).rows[0].object, null);
  } finally { await db.close(); }
});

test("Auth deletion clears only that user's 038/039 signup state and allows a new ID", async () => {
  const db = new PGlite();
  const deletedId = "11111111-1111-4111-8111-111111111111";
  const retainedId = "22222222-2222-4222-8222-222222222222";
  const newId = "33333333-3333-4333-8333-333333333333";
  const deletedEmail = "deleted-owner@example.invalid";
  const retainedEmail = "retained-staff@example.invalid";
  const deletedStoreId = "44444444-4444-4444-8444-444444444444";
  const retainedStoreId = "55555555-5555-4555-8555-555555555555";
  try {
    await db.exec(setup);
    await db.exec(`
      alter table public.profiles add column email text;
      alter table public.profiles add column role text;
      alter table public.profiles add column approval_status text;
      alter table public.profiles add constraint profiles_id_pk primary key (id);
      alter table public.profiles add constraint profiles_auth_user_id_fk
        foreign key (user_id) references auth.users(id) on delete cascade;
      create table public.stores(id uuid primary key, boss_id uuid references public.profiles(id) on delete set null);
      alter table public.store_memberships add column store_id uuid references public.stores(id) on delete cascade;
      alter table public.store_memberships add constraint memberships_auth_user_fk
        foreign key (user_id) references auth.users(id) on delete cascade;
      create table public.manuals(id uuid primary key, store_id uuid references public.stores(id) on delete cascade);
      create table public.question_logs(id uuid primary key, store_id uuid references public.stores(id) on delete set null, question text);
      create table public.auth_user_delete_audit(user_id uuid, email text);
      create table public.owner_staff_signup_requests(email text primary key, requested_at timestamptz not null, available_at timestamptz not null);
    `);
    await db.exec(migration);
    await db.exec(`
      create function public.keep_existing_auth_delete_audit() returns trigger language plpgsql as $$
      begin insert into public.auth_user_delete_audit values(old.id, old.email); return old; end $$;
      create trigger existing_auth_delete_audit after delete on auth.users
        for each row execute function public.keep_existing_auth_delete_audit();
    `);
    await db.exec(`
      create role migration_user bypassrls;
      grant usage on schema auth, public to migration_user;
      grant create on schema public to migration_user;
      grant select, trigger on auth.users to migration_user;
      grant select, delete on public.owner_staff_signup_requests, public.owner_staff_email_signup_flows to migration_user;
      set role migration_user;
    `);
    const preflight = await db.exec(readFileSync("docs/sql/040_auth_delete_signup_state_preflight.readonly.sql", "utf8"));
    assert.equal(preflight.length, 1);
    assert.equal(preflight[0].command, "SELECT");
    const preflightRows = preflight[0].rows;
    assert.equal(preflightRows.find((row) => row.check_group === "column_contract").details.all_columns_match, true);
    const fkResult = preflightRows.find((row) => row.check_group === "expected_account_delete_fk_contracts").details;
    assert.equal(fkResult.all_match, true);
    assert.equal(fkResult.foreign_keys.length, 3);
    const privilegeResult = preflightRows.find((row) => row.check_group === "execution_role_and_privileges").details;
    assert.equal(privilegeResult.required_roles_present, true);
    assert.equal(privilegeResult.current_user_is_auth_owner_or_superuser, false);
    assert.equal(privilegeResult.public_schema_create, true);
    assert.equal(privilegeResult.auth_users_delete, false);
    assert.equal(privilegeResult.auth_users_trigger_privilege, true);
    assert.equal(privilegeResult.can_create_auth_delete_trigger, true);
    assert.equal(privilegeResult.auth_users_full_row_visibility, true);
    assert.equal(privilegeResult.signup_table_privileges_and_rls_access, true);
    for (const privilege of ["SELECT", "DELETE"]) {
      await db.exec(`reset role; revoke ${privilege} on public.owner_staff_email_signup_flows from migration_user; set role migration_user`);
      const incompletePrivileges = await db.exec(readFileSync("docs/sql/040_auth_delete_signup_state_preflight.readonly.sql", "utf8"));
      assert.equal(incompletePrivileges[0].rows.find((row) => row.check_group === "execution_role_and_privileges").details.signup_table_privileges_and_rls_access, false);
      await assert.rejects(() => db.exec(authDeleteCleanupDraft),
        (error) => error.code === "55000" && error.message.includes("AUTH_DELETE_SIGNUP_CLEANUP_REQUIRED_PRIVILEGES_MISSING"));
      await db.exec(`rollback; reset role; grant ${privilege} on public.owner_staff_email_signup_flows to migration_user; set role migration_user`);
    }
    const objectNames = preflightRows.find((row) => row.check_group === "new_object_names_available").details;
    assert.equal(objectNames.trigger_name_available, true);
    assert.equal(objectNames.function_name_available, true);
    const triggers = preflightRows.find((row) => row.check_group === "existing_auth_users_triggers_review_required").details;
    assert.ok(triggers.some((trigger) => trigger.trigger_name === "existing_auth_delete_audit"));
    const impact = preflightRows.find((row) => row.check_group === "auth_delete_data_impact").details;
    assert.equal(impact.stores_and_manuals_preserved_by_fk, true);
    assert.ok(impact.foreign_keys.some((relation) => relation.relation_name === "stores" && relation.delete_action === "SET NULL"));
    await db.exec("reset role; alter table public.manuals rename column store_id to previous_store_id; set role migration_user");
    const missingColumn = await db.exec(readFileSync("docs/sql/040_auth_delete_signup_state_preflight.readonly.sql", "utf8"));
    assert.equal(missingColumn[0].rows.find((row) => row.check_group === "column_contract").details.all_columns_match, false);
    await db.exec(`
      reset role;
      alter table public.manuals rename column previous_store_id to store_id;
      alter table public.stores drop constraint stores_boss_id_fkey;
      alter table public.stores add constraint stores_boss_id_fkey foreign key (boss_id) references public.profiles(id) on delete cascade;
      set role migration_user;
    `);
    const dangerousCascade = await db.exec(readFileSync("docs/sql/040_auth_delete_signup_state_preflight.readonly.sql", "utf8"));
    assert.equal(dangerousCascade[0].rows.find((row) => row.check_group === "auth_delete_data_impact").details.stores_and_manuals_preserved_by_fk, false);
    await assert.rejects(() => db.exec(authDeleteCleanupDraft),
      (error) => error.code === "55000" && error.message.includes("AUTH_DELETE_STORE_MANUAL_CASCADE_REVIEW_REQUIRED"));
    await db.exec(`
      rollback;
      reset role;
      alter table public.stores drop constraint stores_boss_id_fkey;
      alter table public.stores add constraint stores_boss_id_fkey foreign key (boss_id) references public.profiles(id) on delete set null;
      set role migration_user;
    `);
    await assert.rejects(
      () => db.exec(authDeleteCleanupDraft),
      (error) => error.code === "55000" && error.message.includes("AUTH_DELETE_TRIGGER_INVENTORY_REVIEW_REQUIRED"),
    );
    await db.exec("rollback");
    assert.equal((await db.query("select to_regprocedure('public.cleanup_owner_staff_signup_state_after_auth_delete()') object")).rows[0].object, null);
    await db.exec("reset role; set role migration_user");
    const reviewedDraft = authDeleteCleanupDraft.replace(
      "auth_trigger_inventory_reviewed boolean := false",
      "auth_trigger_inventory_reviewed boolean := true",
    );
    await db.exec(`reset role;
      create function public.synthetic_state_delete() returns trigger language plpgsql as $$ begin return old; end $$;
      create trigger synthetic_state_delete before delete on public.owner_staff_email_signup_flows
        for each row execute function public.synthetic_state_delete();
      set role migration_user;`);
    await assert.rejects(() => db.exec(reviewedDraft),
      (error) => error.code === "55000" && error.message.includes("AUTH_DELETE_SIGNUP_STATE_SIDE_EFFECT_REVIEW_REQUIRED"));
    await db.exec("rollback; reset role; drop trigger synthetic_state_delete on public.owner_staff_email_signup_flows; drop function public.synthetic_state_delete(); set role migration_user");
    await db.exec(reviewedDraft);
    await db.exec("reset role");

    const insertAccount = async (id, email, role) => db.query(
      "insert into auth.users values($1,$2,null,null,$3::jsonb,$4::jsonb,'')",
      [id, email, JSON.stringify({ provider: "email" }), JSON.stringify({ role })],
    );
    await insertAccount(deletedId, deletedEmail, "owner");
    await insertAccount(retainedId, retainedEmail, "staff");
    await db.query("insert into public.profiles values($1,$1,$2,'owner','pending')", [deletedId, deletedEmail]);
    await db.query("insert into public.profiles values($1,$1,$2,'staff','approved')", [retainedId, retainedEmail]);
    await db.query("insert into public.stores values($1,$2),($3,$4)", [deletedStoreId, deletedId, retainedStoreId, retainedId]);
    await db.query("insert into public.store_memberships(user_id,store_id) values($1,$2),($3,$4)", [deletedId, deletedStoreId, retainedId, retainedStoreId]);
    await db.query("insert into public.manuals values($1,$2),($3,$4)", ["66666666-6666-4666-8666-666666666666", deletedStoreId, "77777777-7777-4777-8777-777777777777", retainedStoreId]);
    await db.query("insert into public.question_logs values($1,$2,$3),($4,$5,$6)", ["88888888-8888-4888-8888-888888888888", deletedStoreId, "deleted account log fixture", "99999999-9999-4999-8999-999999999999", retainedStoreId, "retained account log fixture"]);
    await db.query("insert into public.owner_staff_signup_requests values($1,now(),now()),($2,now(),now())", [deletedEmail, retainedEmail]);
    const deletedRequestId = "88888888-8888-4888-8888-888888888888";
    const retainedRequestId = "99999999-9999-4999-8999-999999999999";
    await db.query(`insert into public.owner_staff_email_signup_flows
      (email,role,requested_at,available_at,expires_at,request_id,verified_user_id,verified_at,completed_user_id,completed_at)
      values ($1,'owner',now(),now(),now(),$2,$3,now(),$3,now()),($4,'staff',now(),now(),now(),$5,$6,now(),$6,now())`,
    [deletedEmail, deletedRequestId, deletedId, retainedEmail, retainedRequestId, retainedId]);

    await db.exec(`
      create function public.reject_signup_state_delete() returns trigger language plpgsql as $$
      begin raise exception 'synthetic signup-state cleanup failure'; end $$;
      create trigger fail_signup_state_cleanup before delete on public.owner_staff_email_signup_flows
        for each row when (old.email = 'deleted-owner@example.invalid')
        execute function public.reject_signup_state_delete();
    `);
    await assert.rejects(
      () => db.query("delete from auth.users where id=$1", [deletedId]),
      /synthetic signup-state cleanup failure/,
    );
    assert.equal((await db.query("select count(*)::integer n from auth.users where id=$1", [deletedId])).rows[0].n, 1);
    assert.equal((await db.query("select count(*)::integer n from public.profiles where id=$1", [deletedId])).rows[0].n, 1);
    assert.equal((await db.query("select count(*)::integer n from public.store_memberships where user_id=$1", [deletedId])).rows[0].n, 1);
    assert.equal((await db.query("select count(*)::integer n from public.owner_staff_signup_requests where email=$1", [deletedEmail])).rows[0].n, 1);
    assert.equal((await db.query("select count(*)::integer n from public.owner_staff_email_signup_flows where email=$1", [deletedEmail])).rows[0].n, 1);
    assert.equal((await db.query("select count(*)::integer n from public.auth_user_delete_audit")).rows[0].n, 0);
    await db.exec("drop trigger fail_signup_state_cleanup on public.owner_staff_email_signup_flows; drop function public.reject_signup_state_delete();");

    const sameNormalizedEmailId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    await insertAccount(sameNormalizedEmailId, deletedEmail.toUpperCase(), "owner");
    await db.query("delete from auth.users where id=$1", [deletedId]);

    assert.equal((await db.query("select count(*)::integer n from auth.users where id=$1", [deletedId])).rows[0].n, 0);
    assert.equal((await db.query("select count(*)::integer n from public.profiles where id=$1 or user_id=$1", [deletedId])).rows[0].n, 0);
    assert.equal((await db.query("select count(*)::integer n from public.store_memberships where user_id=$1", [deletedId])).rows[0].n, 0);
    assert.equal((await db.query("select count(*)::integer n from auth.users where id=$1", [sameNormalizedEmailId])).rows[0].n, 1);
    assert.equal((await db.query("select count(*)::integer n from public.owner_staff_signup_requests where email=$1", [deletedEmail])).rows[0].n, 1);
    assert.equal((await db.query("select count(*)::integer n from public.owner_staff_email_signup_flows where email=$1", [deletedEmail])).rows[0].n, 1);
    await db.query("delete from auth.users where id=$1", [sameNormalizedEmailId]);
    assert.equal((await db.query("select count(*)::integer n from public.owner_staff_signup_requests where email=$1", [deletedEmail])).rows[0].n, 0);
    assert.equal((await db.query("select count(*)::integer n from public.owner_staff_email_signup_flows where email=$1", [deletedEmail])).rows[0].n, 0);
    assert.equal((await db.query("select boss_id from public.stores where id=$1", [deletedStoreId])).rows[0].boss_id, null);
    assert.equal((await db.query("select count(*)::integer n from public.manuals where store_id=$1", [deletedStoreId])).rows[0].n, 1);
    assert.equal((await db.query("select count(*)::integer n from public.auth_user_delete_audit")).rows[0].n, 2);

    const historicalRequestId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    await db.query("insert into public.owner_staff_signup_requests values($1,now(),now())", [deletedEmail]);
    await db.query(`insert into public.owner_staff_email_signup_flows
      (email,role,requested_at,available_at,expires_at,request_id,verified_user_id,verified_at,completed_user_id,completed_at)
      values ($1,'owner',now(),now(),now(),$2,$3,now(),$3,now())`, [deletedEmail, historicalRequestId, deletedId]);
    const replaceHistoricalPlaceholders = (sql) => sql
      .replaceAll("REPLACE_WITH_TEST_EMAIL@example.com", deletedEmail)
      .replaceAll("REPLACE_WITH_039_REQUEST_UUID", historicalRequestId)
      .replaceAll("REPLACE_WITH_OLD_AUTH_USER_UUID", deletedId);
    const preview = await db.exec(replaceHistoricalPlaceholders(deletedStatePreview));
    const previewRow = preview.find((result) => result.command === "SELECT").rows[0];
    assert.equal(previewRow.no_auth_rows, true);
    assert.equal(previewRow.no_profile_rows, true);
    assert.equal(previewRow.no_membership_rows, true);
    assert.equal(previewRow.exactly_one_039_request_match, true);
    assert.equal(previewRow.flow_user_ids_match_confirmed_old_user, true);

    const cleanupDryRun = await db.exec(replaceHistoricalPlaceholders(deletedStateCleanupDraft));
    assert.equal(cleanupDryRun.find((result) => result.command === "SELECT").rows[0].remaining_target_039_rows, 1);
    assert.equal((await db.query("select count(*)::integer n from public.owner_staff_signup_requests where email=$1", [deletedEmail])).rows[0].n, 1);
    const wrongRequestCleanup = replaceHistoricalPlaceholders(deletedStateCleanupDraft)
      .replace(historicalRequestId, "cccccccc-cccc-4ccc-8ccc-cccccccccccc")
      .replace("p_confirm_delete boolean := false", "p_confirm_delete boolean := true");
    await assert.rejects(() => db.exec(wrongRequestCleanup), (error) => error.code === "P0001");
    await db.exec("rollback");
    assert.equal((await db.query("select count(*)::integer n from public.owner_staff_email_signup_flows where email=$1", [deletedEmail])).rows[0].n, 1);

    const reappearedAuthId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    await insertAccount(reappearedAuthId, deletedEmail, "owner");
    const changedStateCleanup = replaceHistoricalPlaceholders(deletedStateCleanupDraft)
      .replace("p_confirm_delete boolean := false", "p_confirm_delete boolean := true");
    await assert.rejects(() => db.exec(changedStateCleanup), (error) => error.code === "P0001");
    await db.exec("rollback");
    assert.equal((await db.query("select count(*)::integer n from auth.users where id=$1", [reappearedAuthId])).rows[0].n, 1);
    assert.equal((await db.query("select count(*)::integer n from public.owner_staff_signup_requests where email=$1", [deletedEmail])).rows[0].n, 1);
    assert.equal((await db.query("select count(*)::integer n from public.owner_staff_email_signup_flows where email=$1", [deletedEmail])).rows[0].n, 1);
    await db.query("delete from auth.users where id=$1", [reappearedAuthId]);
    await db.query("insert into public.owner_staff_signup_requests values($1,now(),now())", [deletedEmail]);
    await db.query(`insert into public.owner_staff_email_signup_flows
      (email,role,requested_at,available_at,expires_at,request_id,verified_user_id,verified_at,completed_user_id,completed_at)
      values ($1,'owner',now(),now(),now(),$2,$3,now(),$3,now())`, [deletedEmail, historicalRequestId, deletedId]);

    const cleanupEnabled = replaceHistoricalPlaceholders(deletedStateCleanupDraft).replace("p_confirm_delete boolean := false", "p_confirm_delete boolean := true");
    const cleanupResult = await db.exec(cleanupEnabled);
    const cleanupSummary = cleanupResult.find((result) => result.command === "SELECT").rows[0];
    assert.equal(cleanupSummary.remaining_auth_rows, 0);
    assert.equal(cleanupSummary.remaining_profile_rows, 0);
    assert.equal(cleanupSummary.remaining_membership_rows, 0);
    assert.equal(cleanupSummary.remaining_target_039_rows, 0);
    assert.equal(cleanupSummary.remaining_038_rows, 0);

    const rpc = async (email, action, uid = null, requestId = null, role = "owner") =>
      (await db.query("select public.prepare_owner_staff_email_first_signup($1,$2,$3,$4::uuid,$5::uuid) result", [email, role, action, uid, requestId])).rows[0].result;
    const restarted = await rpc(deletedEmail, "start");
    assert.equal(restarted.kind, "new");
    assert.notEqual(restarted.requestId, deletedRequestId);
    await insertAccount(newId, deletedEmail, "owner");
    assert.notEqual(newId, deletedId);
    assert.equal((await db.query("select count(*)::integer n from public.profiles where id=$1 or user_id=$1", [newId])).rows[0].n, 0);
    assert.equal((await db.query("select count(*)::integer n from public.store_memberships where user_id=$1", [newId])).rows[0].n, 0);
    assert.equal((await rpc(retainedEmail, "start", null, null, "staff")).kind, "exists");

    assert.equal((await db.query("select count(*)::integer n from auth.users where id=$1", [retainedId])).rows[0].n, 1);
    assert.equal((await db.query("select count(*)::integer n from public.profiles where id=$1", [retainedId])).rows[0].n, 1);
    assert.equal((await db.query("select count(*)::integer n from public.store_memberships where user_id=$1", [retainedId])).rows[0].n, 1);
    assert.equal((await db.query("select count(*)::integer n from public.owner_staff_signup_requests where email=$1", [retainedEmail])).rows[0].n, 1);
    assert.equal((await db.query("select count(*)::integer n from public.owner_staff_email_signup_flows where email=$1 and request_id=$2", [retainedEmail, retainedRequestId])).rows[0].n, 1);
    assert.equal((await db.query("select count(*)::integer n from public.stores")).rows[0].n, 2);
    assert.equal((await db.query("select count(*)::integer n from public.manuals")).rows[0].n, 2);
    assert.equal((await db.query("select count(*)::integer n from public.question_logs")).rows[0].n, 2);

    const postflight = await db.exec(readFileSync("docs/sql/040_auth_delete_signup_state_postflight.readonly.sql", "utf8"));
    const functionDetails = postflight.find((result) => result.rows.some((row) => row.check_group === "function"))?.rows.find((row) => row.check_group === "function")?.details;
    assert.equal(functionDetails.security_definer, true);
    assert.equal(functionDetails.anon_can_execute, false);
    assert.equal(functionDetails.authenticated_can_execute, false);
  } finally { await db.close(); }
});