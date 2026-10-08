import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

const tools = process.env.EMAIL_FIRST_SQL_TEST_TOOLS_PATH ?? path.join(tmpdir(), "ilitda-email-first-sql-tools/package.json");
const { PGlite } = createRequire(tools)("@electric-sql/pglite");
const migration = readFileSync("supabase/migrations/039_owner_staff_email_first_signup.sql", "utf8");
const setup = `
create role anon; create role authenticated; create role service_role bypassrls; create schema auth;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,last_sign_in_at timestamptz,raw_app_meta_data jsonb,raw_user_meta_data jsonb,encrypted_password text);
create table auth.identities(user_id uuid,provider text);
create table public.profiles(id uuid,user_id uuid);
create table public.store_memberships(user_id uuid);`;
const userId = "11111111-1111-4111-8111-111111111111";
const otherId = "22222222-2222-4222-8222-222222222222";

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