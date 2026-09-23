import { redirect } from "next/navigation";

import { requireServerRole } from "@/lib/auth/require-server-role";

export default async function HqLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const result = await requireServerRole("hq");

  if (result.status !== "AUTHORIZED") {
    redirect("/");
  }

  return <>{children}</>;
}
