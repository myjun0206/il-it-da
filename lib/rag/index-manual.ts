import { createClient } from "@supabase/supabase-js";

import {
  indexApprovedManual,
  type IndexApprovedManualResult,
} from "@/lib/rag/index-approved-manual";

export async function indexManualById(
  manualId: string,
): Promise<IndexApprovedManualResult> {
  if (typeof window !== "undefined") {
    throw new Error("Manual indexing is only available on the server.");
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    const missing = [
      !supabaseUrl && "NEXT_PUBLIC_SUPABASE_URL",
      !serviceRoleKey && "SUPABASE_SERVICE_ROLE_KEY",
    ].filter(Boolean);

    throw new Error(`Missing manual indexing environment variables: ${missing.join(", ")}`);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return indexApprovedManual(manualId, supabase);
}