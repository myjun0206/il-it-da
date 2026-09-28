import { redirect } from "next/navigation";

import StaffShell from "@/components/staff/StaffShell";
import { requireServerRole } from "@/lib/auth/require-server-role";

// profiles.role은 요청 시점에만 판정할 수 있으므로,
// 빌드 시 정적 사전 렌더링되지 않게 한다.
export const dynamic = "force-dynamic";

export default async function StaffLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const result = await requireServerRole("staff");

  if (result.status !== "AUTHORIZED") {
    redirect("/");
  }

  // 모든 직원 화면이 같은 Sidebar/Header/현재 근무 매장 상태를 공유한다.
  return <StaffShell>{children}</StaffShell>;
}