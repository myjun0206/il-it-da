import { redirect } from "next/navigation";

import { requireServerRole } from "@/lib/auth/require-server-role";

export default async function StaffLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const result = await requireServerRole("staff");

  if (result.status !== "AUTHORIZED") {
    redirect("/");
  }

  return <>{children}</>;
}
