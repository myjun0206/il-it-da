import "dotenv/config";

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { ensureSystemOrphanOwner } from "../lib/owner/orphan-owner.ts";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(scriptDirectory, "..", ".env.local");
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath, override: true });
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error("System owner setup requires Supabase URL and service-role environment variables.");
  process.exitCode = 1;
} else {
  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  try {
    await ensureSystemOrphanOwner(adminClient);
    console.info("System orphan-owner account is ready.");
  } catch (error) {
    console.error("System orphan-owner setup failed.", {
      name: error instanceof Error ? error.name : "UnknownError",
    });
    process.exitCode = 1;
  }
}