import { redirect } from "next/navigation";

import { requireServerRole } from "@/lib/auth/require-server-role";

export default async function BossLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const result = await requireServerRole("owner");

  if (result.status !== "AUTHORIZED") {
    redirect("/");
  }

  return <>{children}</>;
}
