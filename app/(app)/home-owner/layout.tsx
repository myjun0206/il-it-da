import { redirect } from "next/navigation";

import { getAuthenticatedProfile } from "@/lib/auth/client-profile";
import { createClient } from "@/lib/supabase/server";

export default async function LegacyOwnerHomeLayout() {
  const supabase = await createClient();
  const profile = await getAuthenticatedProfile(supabase);

  redirect(profile?.role === "owner" ? "/boss" : "/");
}