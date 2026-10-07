import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const draftPath = path.join(repoRoot, "docs/sql/owner-staff-email-otp-migration-draft.sql");
const sql = readFileSync(draftPath, "utf8");
const preflightPath = path.join(repoRoot, "docs/sql/owner-staff-email-otp-preflight.sql");
const migrationPath = path.join(repoRoot, "supabase/migrations/038_owner_staff_email_otp.sql");
const postflightPath = path.join(repoRoot, "docs/sql/owner-staff-email-otp-postflight.sql");
const executableSuffix = process.platform === "win32" ? ".exe" : "";
const bin = process.env.OTP_TEST_POSTGRES_BIN ?? path.join(tmpdir(), "ilitda-postgres-tools-16", "pgsql", "bin");
const executable = (name) => path.join(bin, `${name}${executableSuffix}`);
const childEnv = { ...process.env };
for (const name of Object.keys(childEnv)) {
  if (/^PG/i.test(name)) delete childEnv[name];
}
childEnv.PGCONNECT_TIMEOUT = "5";

function execute(name, args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable(name), args, { env: childEnv, stdio: ["pipe", "pipe", "pipe"], timeout: 30_000 });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.once(name === "pg_ctl" ? "exit" : "close", (code) => {
      if (name === "pg_ctl") {
        child.stdout.destroy();
        child.stderr.destroy();
      }
      resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() });
    });
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}

function successful(result) {
  assert.equal(result.code, 0, result.stderr || "PostgreSQL command failed");
  return result.stdout;
}

async function availablePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

const literal = (value) => value === null ? "NULL" : `'${String(value).replaceAll("'", "''")}'`;
const call = (email, role = "owner", action = "start") =>
  `select public.prepare_owner_staff_signup(${literal(email)}, ${literal(role)}, ${literal(action)})`;

const schemaFixture = `
create schema auth;
create table auth.users (
  id uuid primary key, email text unique, email_confirmed_at timestamptz,
  raw_app_meta_data jsonb, raw_user_meta_data jsonb
);
create table auth.identities (user_id uuid references auth.users(id), provider text);
create table public.profiles (id uuid primary key references auth.users(id));
grant usage on schema public to anon, authenticated, service_role;
insert into auth.users values
 ('00000000-0000-4000-8000-000000000001', 'resume-owner@example.invalid', null, '{"provider":"email"}', '{"role":"owner"}'),
 ('00000000-0000-4000-8000-000000000002', 'resume-staff@example.invalid', null, '{"provider":"email"}', '{"role":"staff"}'),
 ('00000000-0000-4000-8000-000000000003', 'confirmed@example.invalid', now(), '{"provider":"email"}', '{"role":"owner"}'),
 ('00000000-0000-4000-8000-000000000004', 'social@example.invalid', null, '{"provider":"google"}', '{"role":"owner"}'),
 ('00000000-0000-4000-8000-000000000005', 'linked-social@example.invalid', null, '{"provider":"email"}', '{"role":"owner"}'),
 ('00000000-0000-4000-8000-000000000006', 'profile@example.invalid', null, '{"provider":"email"}', '{"role":"owner"}');
insert into auth.identities values ('00000000-0000-4000-8000-000000000005', 'google');
insert into public.profiles values ('00000000-0000-4000-8000-000000000006');
`;

test("actual PostgreSQL: disposable owner/staff signup migration isolation", { timeout: 120_000 }, async (context) => {
  for (const name of ["initdb", "pg_ctl", "psql", "postgres"]) {
    assert.ok(existsSync(executable(name)), `Missing local ${name} binary; set OTP_TEST_POSTGRES_BIN to a local PostgreSQL bin directory`);
  }
  assert.doesNotMatch(sql, /[\u3131-\u318E\uAC00-\uD7A3]/);
  assert.doesNotMatch(sql, /[^\x00-\x7F]/);
  assert.doesNotMatch(sql, /^\s*(?:```|#{1,6}\s|\|)/m);
  assert.match(sql, /^begin;$/m);
  assert.match(sql, /^commit;\s*$/m);

  const root = mkdtempSync(path.join(tmpdir(), "ilitda-otp-postgres-"));
  const cluster = path.join(root, "cluster");
  const port = await availablePort();
  const sessions = new Set();
  const args = (database = "otp_test", application = "otp_isolation") => [
    "-X", "-w", "-qAt", "-v", "ON_ERROR_STOP=1", "-h", "127.0.0.1", "-p", String(port),
    "-U", "otp_test_admin", "-d", database, "-v", `application_name=${application}`,
  ];
  const query = async (statement, database = "otp_test", application = "otp_isolation") => {
    const result = await execute("psql", args(database, application), `set application_name = ${literal(application)};\n${statement};\n`);
    return successful(result);
  };
  const queryJson = async (statement) => JSON.parse(await query(statement));
  const snapshot = async (table) => query(`select coalesce(jsonb_agg(to_jsonb(record) || jsonb_build_object('xmin', record.xmin::text, 'ctid', record.ctid::text) order by record.ctid), '[]'::jsonb) from ${table} as record`);
  const snapshotAll = async () => Promise.all(["auth.users", "auth.identities", "public.profiles", "public.owner_staff_signup_requests"].map(snapshot));

  const session = (application) => {
    const child = spawn(executable("psql"), args("otp_test", application), { env: childEnv, stdio: ["pipe", "pipe", "pipe"] });
    sessions.add(child);
    let pending = null;
    let counter = 0;
    let stderr = "";
    const output = createInterface({ input: child.stdout });
    output.on("line", (line) => {
      if (!pending) return;
      if (line === pending.marker) {
        const { resolve, lines } = pending;
        pending = null;
        resolve(lines.join("\n"));
      } else pending.lines.push(line);
    });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => { pending?.reject(error); pending = null; });
    child.on("close", () => {
      pending?.reject(new Error(stderr || "Isolated PostgreSQL session closed"));
      pending = null;
      output.close();
      sessions.delete(child);
    });
    return {
      command(statement) {
        assert.equal(pending, null);
        return new Promise((resolve, reject) => {
          const marker = `otp_marker_${++counter}`;
          pending = { marker, resolve, reject, lines: [] };
          child.stdin.write(`${statement};\n\\echo ${marker}\n`);
        });
      },
      close() { child.stdin.end(); },
    };
  };

  const waitForLock = async (application) => {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await query(`select exists(select 1 from pg_stat_activity where application_name = ${literal(application)} and wait_event_type = 'Lock')`) === "t") return;
    }
    throw new Error("Concurrent isolated request did not reach the expected row/transaction lock");
  };

  try {
    const version = successful(await execute("postgres", ["--version"]));
    context.diagnostic(`${version}; fresh loopback-only cluster, synthetic Auth fixtures, no hosted services`);
    successful(await execute("initdb", ["-D", cluster, "-U", "otp_test_admin", "-A", "trust", "--encoding=UTF8", "--no-locale"]));
    successful(await execute("pg_ctl", ["-D", cluster, "-l", path.join(root, "postgres.log"), "-o", `-h 127.0.0.1 -p ${port} -c max_connections=20`, "-w", "start"]));
    const actualDirectory = await query("show data_directory", "postgres");
    assert.equal(realpathSync(actualDirectory).toLowerCase(), realpathSync(cluster).toLowerCase());
    await query("create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls; create database otp_test; create database otp_rollback", "postgres");
    await query(schemaFixture);
    await context.test("preflight metadata SQL is read-only and works before OTP objects exist", async () => {
      const before = await Promise.all(["auth.users", "auth.identities", "public.profiles"].map(snapshot));
      successful(await execute("psql", [...args(), "-f", preflightPath]));
      assert.deepEqual(await Promise.all(["auth.users", "auth.identities", "public.profiles"].map(snapshot)), before);
      assert.equal(await query("select to_regclass('public.owner_staff_signup_requests') is null"), "t");
    });
    successful(await execute("psql", [...args(), "-f", migrationPath]));

    await context.test("formal migration keeps the exact tested RPC body and postflight is read-only", async () => {
      const before = await snapshotAll();
      const output = successful(await execute("psql", [...args(), "-f", postflightPath]));
      const checks = output.split(/\r?\n/).filter((line) => /^[a-z_]+\|[tf]$/.test(line));
      assert.equal(checks.length, 11);
      assert.ok(checks.every((line) => line.endsWith("|t")));
      assert.deepEqual(await snapshotAll(), before);
    });

    await context.test("preflight metadata SQL works for existing OTP objects without invoking the RPC or writing rows", async () => {
      const before = await snapshotAll();
      successful(await execute("psql", [...args(), "-f", preflightPath]));
      assert.deepEqual(await snapshotAll(), before);
    });

    await context.test("real SQL parses and covers new, resume, confirmed, social, profile and role mismatch branches", async () => {
      const cases = [
        ["new@example.invalid", "owner", "new"], ["new-staff@example.invalid", "staff", "new"],
        ["resume-owner@example.invalid", "owner", "resume"], ["resume-staff@example.invalid", "staff", "resume"],
        ["confirmed@example.invalid", "owner", "exists"], ["social@example.invalid", "owner", "exists"],
        ["linked-social@example.invalid", "owner", "exists"], ["profile@example.invalid", "owner", "exists"],
        ["resume-staff@example.invalid", "owner", "role_mismatch"],
      ];
      const before = await snapshotAll();
      for (const [email, role, kind] of cases) assert.deepEqual(await queryJson(call(email, role, "inspect")), { kind });
      assert.deepEqual(await snapshotAll(), before);
    });

    await context.test("NULL and malformed inputs return unavailable without changing any fixture or request row", async () => {
      const invalid = [
        [null, "owner", "start"], ["null-role@example.invalid", null, "start"],
        ["null-action@example.invalid", "owner", null], [null, null, null],
        ["bad-role@example.invalid", "hq", "start"], ["bad-role@example.invalid", "boss", "start"],
        ["bad-role@example.invalid", "", "start"], ["bad-role@example.invalid", "OWNER", "inspect"],
        ["bad-action@example.invalid", "owner", ""], ["bad-action@example.invalid", "owner", "unknown"],
        ["", "owner", "start"], ["   ", "staff", "resend"], ["missing-domain", "owner", "start"],
        ["person@@example.invalid", "owner", "start"], ["person@exam ple.invalid", "owner", "start"],
        [`${"a".repeat(245)}@example.org`, "owner", "start"],
      ];
      const before = await snapshotAll();
      for (const [email, role, action] of invalid) assert.deepEqual(await queryJson(call(email, role, action)), { kind: "unavailable" });
      assert.deepEqual(await snapshotAll(), before);
    });

    await context.test("new requests reserve exactly 5 minutes and resumable resend requests exactly 60 seconds", async () => {
      assert.deepEqual(await queryJson(call("duration-new@example.invalid")), { kind: "new" });
      assert.deepEqual(await queryJson(call("resume-owner@example.invalid", "owner", "resend")), { kind: "resume" });
      const durations = await queryJson("select jsonb_object_agg(email, extract(epoch from available_at - requested_at)) from public.owner_staff_signup_requests");
      assert.equal(durations["duration-new@example.invalid"], 300);
      assert.equal(durations["resume-owner@example.invalid"], 60);
      const before = await snapshotAll();
      for (const [email, maximum] of [["duration-new@example.invalid", 300], ["resume-owner@example.invalid", 60]]) {
        const result = await queryJson(call(email));
        assert.equal(result.kind, "rate_limited");
        assert.ok(result.retryAfterSeconds > 0 && result.retryAfterSeconds <= maximum);
      }
      assert.deepEqual(await snapshotAll(), before);
    });

    await context.test("same normalized email concurrent creation permits only one request", async () => {
      const holder = session("otp_concurrent_holder");
      await holder.command("begin");
      assert.deepEqual(JSON.parse(await holder.command(call("concurrent@example.invalid"))), { kind: "new" });
      const waiting = query(call("  CONCURRENT@EXAMPLE.INVALID  "), "otp_test", "otp_concurrent_waiter");
      waiting.catch(() => {});
      await waitForLock("otp_concurrent_waiter");
      await holder.command("commit");
      const result = JSON.parse(await waiting);
      assert.equal(result.kind, "rate_limited");
      assert.ok(result.retryAfterSeconds > 0 && result.retryAfterSeconds <= 300);
      assert.equal(await query("select count(*) from public.owner_staff_signup_requests where email = 'concurrent@example.invalid'"), "1");
      holder.close();
    });

    await context.test("a waiting request recalculates the clock after lock release for eligibility and updated timestamps", async () => {
      await query("insert into public.owner_staff_signup_requests values ('lock-expiry@example.invalid', clock_timestamp(), clock_timestamp())");
      const holder = session("otp_expiry_holder");
      await holder.command("begin; select email from public.owner_staff_signup_requests where email = 'lock-expiry@example.invalid' for update");
      const waiting = query(call("lock-expiry@example.invalid"), "otp_test", "otp_expiry_waiter");
      waiting.catch(() => {});
      await waitForLock("otp_expiry_waiter");
      const releaseBoundary = Number(await holder.command("update public.owner_staff_signup_requests set available_at = clock_timestamp() where email = 'lock-expiry@example.invalid' returning extract(epoch from available_at)"));
      await holder.command("commit");
      assert.deepEqual(JSON.parse(await waiting), { kind: "new" });
      const row = await queryJson("select jsonb_build_object('requested', extract(epoch from requested_at), 'duration', extract(epoch from available_at - requested_at)) from public.owner_staff_signup_requests where email = 'lock-expiry@example.invalid'");
      assert.ok(row.requested >= releaseBoundary);
      assert.equal(row.duration, 300);
      holder.close();
    });

    await context.test("retry-after uses the post-lock clock and a still-limited request performs no write", async () => {
      await query("insert into public.owner_staff_signup_requests values ('lock-limit@example.invalid', clock_timestamp(), clock_timestamp())");
      const holder = session("otp_limit_holder");
      await holder.command("begin; select email from public.owner_staff_signup_requests where email = 'lock-limit@example.invalid' for update");
      const waiting = query(call("lock-limit@example.invalid"), "otp_test", "otp_limit_waiter");
      waiting.catch(() => {});
      await waitForLock("otp_limit_waiter");
      await holder.command("update public.owner_staff_signup_requests set available_at = clock_timestamp() + interval '60 seconds' where email = 'lock-limit@example.invalid'");
      const before = await holder.command("select to_jsonb(record) || jsonb_build_object('xmin', record.xmin::text, 'ctid', record.ctid::text) from public.owner_staff_signup_requests as record where email = 'lock-limit@example.invalid'");
      await holder.command("commit");
      const result = JSON.parse(await waiting);
      assert.equal(result.kind, "rate_limited");
      assert.ok(result.retryAfterSeconds > 0 && result.retryAfterSeconds <= 60);
      assert.equal(await query("select to_jsonb(record) || jsonb_build_object('xmin', record.xmin::text, 'ctid', record.ctid::text) from public.owner_staff_signup_requests as record where email = 'lock-limit@example.invalid'"), before);
      holder.close();
    });

    await context.test("inspect neither inserts absent request rows nor updates existing or rate-limited rows", async () => {
      const before = await snapshotAll();
      assert.deepEqual(await queryJson(call("inspect-absent@example.invalid", "owner", "inspect")), { kind: "new" });
      assert.deepEqual(await queryJson(call("duration-new@example.invalid", "owner", "inspect")), { kind: "new" });
      assert.deepEqual(await queryJson(call("resume-owner@example.invalid", "owner", "inspect")), { kind: "resume" });
      assert.deepEqual(await snapshotAll(), before);
    });

    await context.test("anon/authenticated cannot execute the RPC or select/insert/update/delete request rows", async () => {
      const before = await snapshotAll();
      for (const role of ["anon", "authenticated"]) {
        const statements = [
          call("denied@example.invalid"), "select * from public.owner_staff_signup_requests",
          "insert into public.owner_staff_signup_requests values ('denied@example.invalid', now(), now())",
          "update public.owner_staff_signup_requests set available_at = now()",
          "delete from public.owner_staff_signup_requests",
        ];
        for (const statement of statements) {
          const result = await execute("psql", [...args(), "-v", "VERBOSITY=sqlstate"], `set role ${role};\n${statement};\n`);
          assert.notEqual(result.code, 0);
          assert.match(result.stderr, /42501/);
        }
      }
      assert.deepEqual(await snapshotAll(), before);
    });

    await context.test("service_role has RPC execution and required request-table CRUD with RLS enabled", async () => {
      assert.equal(await query("select relrowsecurity from pg_class where oid = 'public.owner_staff_signup_requests'::regclass"), "t");
      const before = await snapshotAll();
      const result = JSON.parse(await query(`begin; set local role service_role; ${call("service-role@example.invalid")}; rollback`));
      assert.deepEqual(result, { kind: "new" });
      await query("begin; set local role service_role; insert into public.owner_staff_signup_requests values ('service-crud@example.invalid', now(), now()); update public.owner_staff_signup_requests set available_at = now() + interval '60 seconds' where email = 'service-crud@example.invalid'; select count(*) from public.owner_staff_signup_requests; delete from public.owner_staff_signup_requests where email = 'service-crud@example.invalid'; rollback");
      assert.deepEqual(await snapshotAll(), before);
    });

    await context.test("reapplying the formal migration preserves data, function identity and permissions", async () => {
      const before = await snapshotAll();
      const functionId = await query("select 'public.prepare_owner_staff_signup(text,text,text)'::regprocedure::oid");
      successful(await execute("psql", [...args(), "-f", migrationPath]));
      assert.deepEqual(await snapshotAll(), before);
      assert.equal(await query("select 'public.prepare_owner_staff_signup(text,text,text)'::regprocedure::oid"), functionId);
      for (const role of ["anon", "authenticated", "service_role"]) {
        assert.equal(await query(`select has_function_privilege(${literal(role)}, 'public.prepare_owner_staff_signup(text,text,text)', 'execute')`), role === "service_role" ? "t" : "f");
      }
    });

    await context.test("request writes roll back and a deliberate migration error rolls back all draft objects", async () => {
      const before = await snapshotAll();
      assert.deepEqual(JSON.parse(await query(`begin; ${call("rollback-request@example.invalid")}; rollback`)), { kind: "new" });
      assert.deepEqual(await snapshotAll(), before);
      await query(schemaFixture, "otp_rollback");
      const interrupted = sql.replace(/commit;\s*$/i, "select 1 / 0;\ncommit;\n");
      assert.notEqual(interrupted, sql);
      const result = await execute("psql", [...args("otp_rollback"), "-v", "ON_ERROR_STOP=0", "-v", "VERBOSITY=sqlstate"], interrupted);
      assert.match(result.stderr, /22012/);
      assert.equal(await query("select to_regclass('public.owner_staff_signup_requests') is null and to_regprocedure('public.prepare_owner_staff_signup(text,text,text)') is null", "otp_rollback"), "t");
      assert.equal(await query("select count(*) from auth.users", "otp_rollback"), "6");
      assert.deepEqual(await snapshotAll(), before);
    });

    await context.test("formal migration rejects incompatible existing tables without repairing or changing them", async () => {
      const cases = [
        "email varchar(254) primary key, requested_at timestamptz not null, available_at timestamptz not null",
        "email text primary key, requested_at timestamptz, available_at timestamptz not null",
        "email text primary key, requested_at timestamp not null, available_at timestamptz not null",
        "email text not null, requested_at timestamptz not null, available_at timestamptz not null",
        "email text primary key deferrable initially immediate, requested_at timestamptz not null, available_at timestamptz not null",
        "email text primary key, requested_at timestamptz not null, available_at timestamptz not null, unexpected text",
      ];
      for (const [index, columns] of cases.entries()) {
        const database = `otp_incompatible_${index}`;
        await query(`create database ${database}`, "postgres");
        await query(schemaFixture, database);
        await query(`create table public.owner_staff_signup_requests (${columns}); insert into public.owner_staff_signup_requests(email, requested_at, available_at) values ('preserved@example.invalid', '2026-10-07 00:00:00+00', '2026-10-07 00:05:00+00')`, database);
        const snapshotSql = "select jsonb_agg(to_jsonb(record) || jsonb_build_object('xmin', record.xmin::text, 'ctid', record.ctid::text)) from public.owner_staff_signup_requests as record";
        const before = await query(snapshotSql, database);
        const result = await execute("psql", [...args(database), "-f", migrationPath]);
        assert.notEqual(result.code, 0);
        assert.match(result.stderr, /OTP_EXISTING_TABLE_(SCHEMA_INCOMPATIBLE|CONTRACT_REVIEW_REQUIRED)/);
        assert.equal(await query(snapshotSql, database), before);
        assert.equal(await query("select to_regprocedure('public.prepare_owner_staff_signup(text,text,text)') is null", database), "t");
      }
    });

    await context.test("formal migration does not overwrite an existing different RPC or signature overload", async () => {
      for (const [index, parameters] of ["p_email text, p_role text, p_action text", "p_email text"].entries()) {
        const database = `otp_rpc_conflict_${index}`;
        await query(`create database ${database}`, "postgres");
        await query(schemaFixture, database);
        await query(`create function public.prepare_owner_staff_signup(${parameters}) returns jsonb language sql as 'select ''{"kind":"existing"}''::jsonb'`, database);
        const before = await query("select oid::text || ':' || md5(prosrc) from pg_proc where proname = 'prepare_owner_staff_signup'", database);
        const result = await execute("psql", [...args(database), "-f", migrationPath]);
        assert.notEqual(result.code, 0);
        assert.match(result.stderr, /OTP_(EXISTING_RPC|RPC_OVERLOAD)_REVIEW_REQUIRED/);
        assert.equal(await query("select oid::text || ':' || md5(prosrc) from pg_proc where proname = 'prepare_owner_staff_signup'", database), before);
        assert.equal(await query("select to_regclass('public.owner_staff_signup_requests') is null", database), "t");
      }
    });

    await context.test("formal migration rolls back if client roles inherit service-role privileges", async () => {
      const database = "otp_inherited_privileges";
      await query(`create database ${database}`, "postgres");
      await query(schemaFixture, database);
      await query("grant service_role to anon", "postgres");
      try {
        const result = await execute("psql", [...args(database), "-f", migrationPath]);
        assert.notEqual(result.code, 0);
        assert.match(result.stderr, /OTP_INHERITED_CLIENT_PRIVILEGES_REVIEW_REQUIRED/);
        assert.equal(await query("select to_regclass('public.owner_staff_signup_requests') is null and to_regprocedure('public.prepare_owner_staff_signup(text,text,text)') is null", database), "t");
      } finally {
        await query("revoke service_role from anon", "postgres");
      }
    });

    await context.test("formal migration rolls back unexpected default table or function grants", async () => {
      await query("create role otp_unexpected_reader nologin", "postgres");
      for (const [index, objectKind] of ["tables", "functions"].entries()) {
        const database = `otp_default_acl_${index}`;
        await query(`create database ${database}`, "postgres");
        await query(schemaFixture, database);
        await query(`alter default privileges in schema public grant ${objectKind === "tables" ? "select" : "execute"} on ${objectKind} to otp_unexpected_reader`, database);
        const result = await execute("psql", [...args(database), "-f", migrationPath]);
        assert.notEqual(result.code, 0);
        assert.match(result.stderr, /OTP_UNEXPECTED_GRANTEES_REVIEW_REQUIRED/);
        assert.equal(await query("select to_regclass('public.owner_staff_signup_requests') is null and to_regprocedure('public.prepare_owner_staff_signup(text,text,text)') is null", database), "t");
      }
    });
  } finally {
    for (const child of sessions) child.stdin.end();
    if (existsSync(path.join(cluster, "postmaster.pid"))) {
      successful(await execute("pg_ctl", ["-D", cluster, "-m", "immediate", "-w", "stop"]));
    }
    assert.ok(path.basename(root).startsWith("ilitda-otp-postgres-"));
    rmSync(root, { recursive: true, force: true });
    context.diagnostic("Disposable PostgreSQL server stopped and cluster directory removed");
  }
});