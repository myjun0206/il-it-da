"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";

import StaffHeader from "@/components/staff/StaffHeader";
import StaffSidebar from "@/components/staff/StaffSidebar";
import { StaffShellProvider, useStaffShell } from "@/components/staff/StaffShellContext";

function resolveActiveMenu(pathname: string): string {
  if (pathname.startsWith("/staff/manuals")) return "manual-common";
  if (pathname.startsWith("/staff/store-manuals")) return "manual-store";
  if (pathname.startsWith("/staff/stores")) return "stores";
  if (pathname.startsWith("/staff/notices")) return "notice";
  if (pathname.startsWith("/staff/settings")) return "settings";
  return "ai-chat";
}

function StaffAppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { logout } = useStaffShell();

  return (
    <div className="h-screen overflow-hidden bg-[var(--color-bg-default)]">
      <StaffSidebar activeMenu={resolveActiveMenu(pathname)} onLogout={() => void logout()} />

      {/* Header 높이(h-16) = Sidebar 로고 영역 높이 → 두 경계선이 한 줄로 이어진다. 스크롤은 main 안에서만. */}
      <div className="lg:ml-[240px] h-screen flex flex-col overflow-hidden">
        <StaffHeader />
        <main className="flex-1 min-h-0 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}

/** 직원 화면 공통 App Shell (Sidebar + Header + 현재 근무 매장 상태) */
export default function StaffShell({ children }: { children: ReactNode }) {
  return (
    <StaffShellProvider>
      <StaffAppShell>{children}</StaffAppShell>
    </StaffShellProvider>
  );
}
