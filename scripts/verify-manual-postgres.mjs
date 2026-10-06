import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { setTimeout as retryDelay } from "node:timers/promises";

const container = `ilitda-manual-test-${randomUUID()}`;
const ownership = randomUUID();
let created = false;
let endpoint;
const docker = (args, input, timeout = 120_000) => execFileSync("docker", endpoint ? ["--host", endpoint, ...args] : args, { input, encoding: "utf8", windowsHide: true, timeout, stdio: ["pipe", "pipe", "pipe"] });
const localEndpoint = (value) => /^(npipe|unix):\/\//.test(value);
try {
  if (process.env.DOCKER_HOST && !localEndpoint(process.env.DOCKER_HOST)) throw new Error("Remote Docker forbidden");
  const context = JSON.parse(docker(["context", "inspect"]));
  endpoint = process.env.DOCKER_HOST || context[0]?.Endpoints?.docker?.Host;
  if (!localEndpoint(endpoint ?? "")) throw new Error("Remote Docker forbidden");
  docker(["info", "--format", "{{.ServerVersion}}"]);
} catch {
  console.error("NOT RUN: a running local Docker engine is required. No PostgreSQL or shared Supabase was accessed.");
  process.exit(2);
}

const psqlArgs = ["exec", "-i", container, "psql", "-X", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"];
const sql = (text) => docker(psqlArgs, text).trim();
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
const owner = "11111111-1111-4111-8111-111111111111";
const store = "22222222-2222-4222-8222-222222222222";
const franchise = "33333333-3333-4333-8333-333333333333";
const manualId = "44444444-4444-4444-8444-444444444444";
const parentId = "55555555-5555-4555-8555-555555555555";
const siblingId = "66666666-6666-4666-8666-666666666666";
const row = (id = manualId) => JSON.parse(sql(`select row_to_json(m) from public.manuals m where id=${quote(id)};`));
const vector = Array(1536).fill(0);
vector[0] = 1;
const chunks = (content = "indexed") => [{ manual_id: manualId, chunk_index: 0, content, embedding: vector }];
const publishSql = (snapshot, rows = chunks()) => `select public.replace_manual_chunks_if_current(${quote(snapshot.id)},${quote(JSON.stringify(snapshot))}::jsonb,${quote(JSON.stringify(rows))}::jsonb);`;
const editSql = (revision, content) => `select public.edit_store_manual_if_current(${quote(owner)},${quote(store)},${quote(franchise)},${quote(manualId)},${quote(revision)}::timestamptz,${quote(JSON.stringify({ content }))}::jsonb);`;
const service = (text) => sql(`set role service_role; ${text}`);
const fail = (text, pattern = /.+/s) => assert.throws(() => sql(text), (error) => pattern.test(String(error.stderr ?? error)));
const chunkCount = (id = manualId) => Number(sql(`select count(*) from public.manual_chunks where manual_id=${quote(id)};`));
let passed = 0;
const test = async (name, run) => { await run(); passed++; console.log(`PASS: ${name}`); };
const otherStore = "77777777-7777-4777-8777-777777777777";
const otherFranchise = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const otherBrandStore = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
async function waitUntil(check, message, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  do {
    if (await check()) return;
    await retryDelay(Math.min(200, Math.max(0, deadline - Date.now())));
  } while (Date.now() < deadline);
  throw new Error(message);
}
const waitForLock = (name) => waitUntil(() => sql(`select exists(select 1 from pg_stat_activity where application_name=${quote(name)} and wait_event_type='Lock');`) === "t", "connection did not reach a lock wait");

function session(text) {
  const child = spawn("docker", ["--host", endpoint, ...psqlArgs], { windowsHide: true, timeout: 30_000, stdio: ["pipe", "pipe", "pipe"] });
  let output = "";
  let error = "";
  let signal;
  const locked = new Promise((resolve, reject) => {
    signal = resolve;
    child.once("error", reject);
  });
  child.stdout.on("data", (data) => { output += data; if (output.includes("LOCKED")) signal(); });
  child.stderr.on("data", (data) => { error += data; });
  const done = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => { if (!output.includes("LOCKED")) signal(); resolve({ code, error, output }); });
  });
  child.stdin.write(`set statement_timeout='20s'; set idle_in_transaction_session_timeout='20s'; ${text}`);
  return { child, locked, done };
}

try {
  try { docker(["image", "inspect", "pgvector/pgvector:pg16"]); }
  catch { console.log("IMAGE DOWNLOAD: pgvector/pgvector:pg16 is not cached; Docker will pull it."); }
  docker(["run", "--detach", "--rm", "--network", "none", "--name", container,
    "--label", `ilitda.manual-test-owner=${ownership}`,
    "-e", "POSTGRES_PASSWORD=local-disposable-test", "pgvector/pgvector:pg16"]);
  created = true;
  await waitUntil(() => {
    try { docker(["exec", container, "pg_isready", "-U", "postgres"], undefined, 3000); return true; } catch { return false; }
  }, "Local PostgreSQL did not become ready", 30_000);
  sql(`create schema extensions; create extension vector with schema extensions;
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create table public.franchises(id uuid primary key);
    create table public.stores(id uuid primary key, franchise_id uuid references public.franchises);
    create table public.store_memberships(id uuid primary key, user_id uuid not null references auth.users on delete cascade,
      store_id uuid not null references public.stores on delete cascade, role text not null check(role in ('owner','staff')),
      status text not null check(status in ('pending','approved','rejected')), unique(user_id,store_id));
    create table public.manuals(id uuid primary key, brand_name text, title text not null, category text not null, content text not null,
      status text not null check(status in ('draft','approved')), updated_at timestamptz not null, created_at timestamptz default now(),
      store_id uuid references public.stores on delete cascade, franchise_id uuid references public.franchises on delete cascade,
      scope_type text default 'hq' check(scope_type is null or scope_type in ('hq','store','HQ','STORE','common','shared')),
      parent_manual_id uuid references public.manuals on delete cascade);
    create table public.manual_chunks(id uuid primary key default gen_random_uuid(), manual_id uuid not null references public.manuals on delete cascade,
      chunk_index integer not null check(chunk_index >= 0), content text not null, embedding extensions.vector(1536), created_at timestamptz default now(),
      constraint manual_chunks_manual_id_chunk_index_key unique(manual_id,chunk_index));
    alter table public.manuals enable row level security; alter table public.manual_chunks enable row level security;
    grant usage on schema public,extensions to service_role;
    grant all on all tables in schema public to service_role; grant all on all sequences in schema public to service_role;
    insert into auth.users values(${quote(owner)});
    insert into public.franchises values(${quote(franchise)}),(${quote(otherFranchise)});
    insert into public.stores values(${quote(store)},${quote(franchise)});
    insert into public.stores values(${quote(otherStore)},${quote(franchise)});
    insert into public.stores values(${quote(otherBrandStore)},${quote(otherFranchise)});
    insert into public.store_memberships values(gen_random_uuid(),${quote(owner)},${quote(store)},'owner','approved');
    insert into public.manuals(id,brand_name,title,category,content,status,updated_at,store_id,franchise_id,scope_type,parent_manual_id)
    values(${quote(parentId)},'brand','parent','category','2 items','approved','2026-10-04T00:00:00.123456Z',${quote(store)},${quote(franchise)},'store',null),
      (${quote(manualId)},'brand','title','category','original','approved','2026-10-04T00:00:00.123456Z',${quote(store)},${quote(franchise)},'store',${quote(parentId)}),
      (${quote(siblingId)},'brand','sibling','category','sibling original','approved','2026-10-04T00:00:00.123456Z',${quote(store)},${quote(franchise)},'store',${quote(parentId)});`);
  const migration = readFileSync(new URL("../supabase/migrations/037_owner_manual_safe_edit.sql", import.meta.url), "utf8");
  sql(migration);
  await test("SQL creation, repeat application, readiness and service role privileges", () => {
    sql(migration); assert.equal(service("select public.check_manual_write_contract();").split("\n").at(-1), "2");
    const inspection = readFileSync(new URL("../docs/sql/owner-manual-postdeploy.readonly.sql", import.meta.url), "utf8");
    assert.match(sql(inspection), /(?:^|\n)2(?:\n|$)/);
    fail("set role anon; select public.check_manual_write_contract();");
    fail("set role authenticated; select public.check_manual_write_contract();");
    for (const role of ["anon", "authenticated"]) fail(`set role ${role}; ${publishSql(row())}`);
    for (const role of ["anon", "authenticated"]) fail(`set role ${role}; ${editSql(row().updated_at, "denied")}`);
    sql("alter table public.manuals disable trigger invalidate_changed_manual_chunks;");
    assert.equal(service("select public.check_manual_write_contract();").split("\n").at(-1), "0");
    sql("alter table public.manuals enable trigger invalidate_changed_manual_chunks;");
  });
  await test("same version concurrent edits: one commits and the blocked operation conflicts", async () => {
    const revision = row().updated_at;
    const first = session(`begin; set role service_role; ${editSql(revision, "race winner")} select 'LOCKED';\n`);
    await first.locked;
    assert.ok(first.child.exitCode === null);
    const second = session(`set application_name='ilitda-manual-race'; set role service_role; ${editSql(revision, "race loser")}\n`);
    second.child.stdin.end();
    try {
      await waitForLock("ilitda-manual-race");
      first.child.stdin.end("commit;\n");
      assert.equal((await first.done).code, 0);
      const result = await second.done;
      assert.notEqual(result.code, 0); assert.match(result.error, /MANUAL_EDIT_CONFLICT/);
      assert.equal(row().content, "race winner");
    } finally { if (!first.child.stdin.destroyed) first.child.stdin.end("rollback;\n"); }
  });
  await test("changed body invalidates chunks; late old snapshot cannot republish", () => {
    const old = row(); service(publishSql(old)); assert.equal(chunkCount(), 1);
    service(editSql(old.updated_at, "new body")); assert.equal(chunkCount(), 0);
    fail(`set role service_role; ${publishSql(old)}`, /MANUAL_INDEX_CONFLICT/); assert.equal(chunkCount(), 0);
    assert.equal(row().content, "new body");
  });
  await test("omitted publication leaves changed manual excluded; fake-vector publication restores it (no embedding generator run)", () => {
    assert.equal(chunkCount(), 0);
    service(publishSql(row(), chunks("new body"))); assert.equal(chunkCount(), 1);
  });
  await test("invalid second chunk rolls back complete replacement; failed reindex preserves valid chunks", () => {
    const current = row();
    const invalid = [...chunks("replacement"), { manual_id: manualId, chunk_index: 1, content: "bad", embedding: [0] }];
    fail(`set role service_role; ${publishSql(current, invalid)}`, /INVALID_EMBEDDING_DIMENSION/);
    assert.equal(sql(`select content from public.manual_chunks where manual_id=${quote(manualId)};`), "new body");
    assert.equal(chunkCount(), 1);
  });
  await test("body and invalidation roll back together", () => {
    const current = row();
    fail(`begin; set role service_role; ${editSql(current.updated_at, "must roll back")} select 1/0; commit;`);
    assert.equal(row().content, current.content); assert.equal(chunkCount(), 1);
  });
  await test("parent, sibling and scope are preserved; cross-store edit is denied", () => {
    const before = row(); service(editSql(before.updated_at, "preserved"));
    const after = row();
    for (const key of ["parent_manual_id", "store_id", "franchise_id", "scope_type", "status"]) assert.equal(after[key], before[key]);
    assert.equal(sql(`select content from public.manuals where id=${quote(siblingId)};`), "sibling original");
    fail(`set role service_role; select public.edit_store_manual_if_current(${quote(owner)},'77777777-7777-4777-8777-777777777777',${quote(franchise)},${quote(manualId)},${quote(after.updated_at)}::timestamptz,'{"content":"no"}'::jsonb);`);
    fail(`set role service_role; select public.edit_store_manual_if_current(${quote(owner)},${quote(store)},'77777777-7777-4777-8777-777777777777',${quote(manualId)},${quote(after.updated_at)}::timestamptz,'{"content":"no"}'::jsonb);`);
    const parent = JSON.parse(sql(`select row_to_json(m) from public.manuals m where id=${quote(parentId)};`));
    const parentChunks = chunks().map((item) => ({ ...item, manual_id: parentId }));
    fail(`set role service_role; select public.replace_manual_chunks_if_current(${quote(parentId)},${quote(JSON.stringify(parent))}::jsonb,${quote(JSON.stringify(parentChunks))}::jsonb);`);
  });
  await test("HQ/bulk direct update races with a waiting webhook-style old publication", async () => {
    const old = row(); service(publishSql(old));
    const writer = session(`begin; set role service_role; update public.manuals set content='bulk update' where id=${quote(manualId)}; select 'LOCKED';\n`);
    await writer.locked;
    const publisher = session(`set application_name='ilitda-manual-publish'; set role service_role; ${publishSql(old)}\n`);
    publisher.child.stdin.end();
    try {
      await waitForLock("ilitda-manual-publish");
      writer.child.stdin.end("commit;\n");
      assert.equal((await writer.done).code, 0);
      const result = await publisher.done;
      assert.notEqual(result.code, 0); assert.match(result.error, /MANUAL_INDEX_CONFLICT/);
      assert.equal(chunkCount(), 0);
    } finally { if (!writer.child.stdin.destroyed) writer.child.stdin.end("rollback;\n"); }
    service(publishSql(row())); assert.equal(chunkCount(), 1);
  });
  await test("unchanged parent ID does not bypass child store/franchise/scope validation", () => {
    const before = row();
    const count = chunkCount();
    for (const [change, pattern] of [
      [`store_id=${quote(otherStore)}`, /PARENT_SCOPE_DENIED/],
      [`franchise_id=${quote(otherFranchise)}`, /STORE_FRANCHISE_MISMATCH/],
      [`store_id=${quote(otherBrandStore)},franchise_id=${quote(otherFranchise)}`, /PARENT_SCOPE_DENIED/],
      ["scope_type='hq'", /INVALID_SCOPE/],
    ]) {
      fail(`set role service_role; update public.manuals set ${change} where id=${quote(manualId)};`, pattern);
      assert.deepEqual(row(), before); assert.equal(chunkCount(), count);
    }
  });
  await test("parents with children reject incompatible scope changes but preserve HQ inheritance conversion", () => {
    const before = row(parentId);
    for (const change of [`store_id=${quote(otherStore)}`, `store_id=${quote(otherBrandStore)},franchise_id=${quote(otherFranchise)}`]) {
      fail(`set role service_role; update public.manuals set ${change} where id=${quote(parentId)};`, /CHILD_SCOPE_DENIED/);
      assert.deepEqual(row(parentId), before);
    }
    fail(`set role service_role; update public.manuals set scope_type='hq' where id=${quote(parentId)};`, /INVALID_SCOPE/);
    fail(`set role service_role; update public.manuals set franchise_id=${quote(otherFranchise)} where id=${quote(parentId)};`, /STORE_FRANCHISE_MISMATCH/);
    fail(`set role service_role; update public.manuals set scope_type=null,store_id=null where id=${quote(parentId)};`, /CHILD_SCOPE_DENIED/);
    for (const scope of ['HQ','common','shared','hq']) service(`update public.manuals set scope_type=${quote(scope)},store_id=null where id=${quote(parentId)};`);
    assert.equal(row().parent_manual_id, parentId); assert.equal(row().store_id, store);
    service(`update public.manuals set scope_type='store',store_id=${quote(store)} where id=${quote(parentId)};`);
  });
  await test("self-parent and indirect cycles roll back instead of recursing forever", () => {
    const before = row();
    fail(`set role service_role; update public.manuals set parent_manual_id=id where id=${quote(manualId)};`, /PARENT_CYCLE/);
    fail(`set role service_role; update public.manuals set parent_manual_id=${quote(manualId)} where id=${quote(parentId)};`, /PARENT_CYCLE/);
    assert.deepEqual(row(), before); assert.equal(row(parentId).parent_manual_id, null);
  });
  await test("scope/parent changes reject old jobs and timezone comparisons retain microseconds", () => {
    const old = row();
    service(`update public.manuals set scope_type='hq',store_id=null,parent_manual_id=null where id=${quote(manualId)};`);
    fail(`set role service_role; ${publishSql(old)}`); assert.equal(chunkCount(), 0);
    assert.equal(sql("select '2026-10-04T00:00:00.123456Z'::timestamptz = '2026-10-04T09:00:00.123456+09:00'::timestamptz;"), "t");
    assert.equal(sql("select '2026-10-04T00:00:00.123456Z'::timestamptz = '2026-10-04T00:00:00.123457Z'::timestamptz;"), "f");
  });
  await test("adding a child invalidates a formerly standalone parent and its prior snapshot", () => {
    const old = row(); service(publishSql(old));
    service(`insert into public.manuals(id,brand_name,title,category,content,status,updated_at,store_id,franchise_id,scope_type,parent_manual_id)
      values('88888888-8888-4888-8888-888888888888','brand','child','category','child text','approved',clock_timestamp(),null,${quote(franchise)},'hq',${quote(manualId)});`);
    assert.equal(chunkCount(), 0); fail(`set role service_role; ${publishSql(old)}`);
  });
  await test("same-franchise HQ inheritance is preserved and cross-franchise parent insertion is denied", () => {
    service(`insert into public.manuals(id,brand_name,title,category,content,status,updated_at,store_id,franchise_id,scope_type,parent_manual_id)
      values('99999999-9999-4999-8999-999999999999','brand','inherited','category','text','approved',clock_timestamp(),${quote(store)},${quote(franchise)},'store',${quote(manualId)});`);
    service("update public.manuals set parent_manual_id=null where id='99999999-9999-4999-8999-999999999999';");
    fail(`set role service_role; insert into public.manuals(id,brand_name,title,category,content,status,updated_at,store_id,franchise_id,scope_type,parent_manual_id)
      values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','other','bad','category','text','approved',clock_timestamp(),${quote(otherBrandStore)},'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','store',${quote(manualId)});`, /PARENT_SCOPE_DENIED/);
  });
  await test("parent relationship change serializes with old chunk publication", async () => {
    const childId = "99999999-9999-4999-8999-999999999999";
    const newParent = "88888888-8888-4888-8888-888888888888";
    const old = row(childId);
    const rows = chunks("inherited text").map((item) => ({ ...item, manual_id: childId }));
    service(publishSql(old, rows));
    const writer = session(`begin; set role service_role; update public.manuals set parent_manual_id=${quote(newParent)} where id=${quote(childId)}; select 'LOCKED';\n`);
    await writer.locked;
    const publisher = session(`set application_name='ilitda-parent-publish'; set role service_role; ${publishSql(old, rows)}\n`);
    publisher.child.stdin.end();
    try {
      await waitForLock("ilitda-parent-publish");
      writer.child.stdin.end("commit;\n"); assert.equal((await writer.done).code, 0);
      const result = await publisher.done;
      assert.notEqual(result.code, 0); assert.match(result.error, /MANUAL_INDEX_CONFLICT/);
      assert.equal(row(childId).parent_manual_id, newParent); assert.equal(chunkCount(childId), 0);
    } finally { if (!writer.child.stdin.destroyed) writer.child.stdin.end("rollback;\n"); }
  });
  await test("equivalent unique index is accepted, partial/deferrable alternatives are rejected", () => {
    sql("alter table public.manual_chunks drop constraint manual_chunks_manual_id_chunk_index_key; create unique index test_manual_pair on public.manual_chunks(chunk_index,manual_id) include(content);");
    assert.equal(service("select public.check_manual_write_contract();").split("\n").at(-1), "2");
    sql("drop index public.test_manual_pair; create unique index test_manual_pair on public.manual_chunks(manual_id,chunk_index) where chunk_index >= 0;");
    assert.equal(service("select public.check_manual_write_contract();").split("\n").at(-1), "0");
    sql("drop index public.test_manual_pair; alter table public.manual_chunks add constraint manual_chunks_manual_id_chunk_index_key unique(manual_id,chunk_index) deferrable initially immediate;");
    assert.equal(service("select public.check_manual_write_contract();").split("\n").at(-1), "0");
    sql("alter table public.manual_chunks drop constraint manual_chunks_manual_id_chunk_index_key; alter table public.manual_chunks add constraint manual_chunks_manual_id_chunk_index_key unique(manual_id,chunk_index);");
  });
  await test("unreviewed timestamp trigger blocks readiness without silently allowing it", () => {
    sql("create function public.test_unreviewed_timestamp() returns trigger language plpgsql as $$ begin new.updated_at:=clock_timestamp(); return new; end; $$; create trigger test_unreviewed_timestamp before update on public.manuals for each row execute function public.test_unreviewed_timestamp();");
    assert.equal(service("select public.check_manual_write_contract();").split("\n").at(-1), "0");
    sql("drop trigger test_unreviewed_timestamp on public.manuals; drop function public.test_unreviewed_timestamp();");
    assert.equal(service("select public.check_manual_write_contract();").split("\n").at(-1), "2");
  });
  console.log(`PASS: ${passed} actual disposable PostgreSQL scenarios. No external embedding or shared DB used.`);
} catch (error) {
  console.error("FAIL: disposable PostgreSQL verification did not complete.", error instanceof Error ? error.message : "Unknown error");
  process.exitCode = 1;
} finally {
  if (created) {
    try {
      const actual = docker(["inspect", "--format", '{{index .Config.Labels "ilitda.manual-test-owner"}}', container]).trim();
      if (actual === ownership) docker(["rm", "--force", container]);
      else console.error("Cleanup refused: container ownership label does not match.");
    } catch {}
  }
}