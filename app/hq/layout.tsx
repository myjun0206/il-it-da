import { redirect } from "next/navigation";

import { requireServerRole } from "@/lib/auth/require-server-role";

// profiles.role은 요청 시점에만 판정할 수 있으므로,
// 빌드 시 정적 사전 렌더링되지 않게 한다.
export const dynamic = "force-dynamic";

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