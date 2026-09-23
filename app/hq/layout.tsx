import { redirect } from "next/navigation";

import { getAuthenticatedProfile } from "@/lib/auth/client-profile";
import { createClient } from "@/lib/supabase/server";

export default async function HQLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const supabase = await createClient();
  const profile = await getAuthenticatedProfile(supabase);

  if (profile?.role !== "hq") {
    redirect("/");
  }

  return children;
}