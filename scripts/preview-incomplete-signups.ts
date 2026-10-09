import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { incompleteSignupGraceHours, previewIncompleteSignupCleanup, type IncompleteSignupSnapshot } from "@/lib/auth/incomplete-signup-cleanup";

const { values } = parseArgs({ options: { "dry-run": { type: "boolean" }, email: { type: "string" }, "grace-hours": { type: "string" } } });
if (!values["dry-run"]) throw new Error("DRY_RUN_REQUIRED_NO_DELETE_MODE_EXISTS");
const env = { ...process.env, ...dotenv.parse(readFileSync(".env.local")) };
const graceHours = incompleteSignupGraceHours(values["grace-hours"] ?? env.INCOMPLETE_SIGNUP_GRACE_HOURS);
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY ?? env.SUPABASE_SECRET_KEY;
if (!url || !key) throw new Error("PREVIEW_CONFIGURATION_MISSING");
const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const targetEmail = values.email?.trim().toLowerCase();
const digest = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 12);
let scanned = 0;
let candidates = 0;
try {
  for (let page = 1; page <= 100; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    for (const user of data.users) {
      if (user.user_metadata?.signup_flow !== "email_first" || !user.email || (targetEmail && user.email.toLowerCase() !== targetEmail)) continue;
      scanned++;
      const email = user.email.trim().toLowerCase();
      const [flow, profiles, memberships] = await Promise.all([
        admin.from("owner_staff_email_signup_flows").select("email,role,requested_at,available_at,expires_at,sent_at,verified_at,verified_user_id,completed_at,completed_user_id,request_id").eq("email", email).maybeSingle(),
        admin.from("profiles").select("id", { count: "exact", head: true }).or(`id.eq.${user.id},user_id.eq.${user.id},email.eq.${JSON.stringify(email)}`),
        admin.from("store_memberships").select("user_id", { count: "exact", head: true }).eq("user_id", user.id),
      ]);
      if (flow.error || profiles.error || memberships.error) {
        console.log(JSON.stringify({ userRef: digest(user.id), eligible: false, reasons: ["lookup_failed"] }));
        continue;
      }
      const snapshot: IncompleteSignupSnapshot = { user, flow: flow.data, profileCount: profiles.count, membershipCount: memberships.count };
      const result = previewIncompleteSignupCleanup(snapshot, { now: Date.now(), graceHours });
      if (result.eligible) candidates++;
      console.log(JSON.stringify({ userRef: digest(user.id), emailRef: digest(email), ...result }));
    }
    if (data.users.length < 200) break;
    if (page === 100) throw new Error("PREVIEW_SCAN_LIMIT_REACHED");
  }
  console.log(JSON.stringify({ dryRun: true, scanned, candidates, graceHours, accountsDeleted: 0, flowRowsChanged: 0 }));
} catch (error) {
  console.error(JSON.stringify({ dryRun: true, failed: true, errorType: error instanceof Error ? error.name : "UnknownError" }));
  process.exitCode = 1;
}