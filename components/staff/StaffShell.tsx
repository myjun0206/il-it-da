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
  const isChatPage = pathname === "/staff" || pathname === "/staff/";

  return (
    <div
      data-staff-shell
      data-staff-chat={isChatPage ? "true" : undefined}
      className={`bg-[var(--color-bg-default)] sm:h-screen sm:min-h-0 sm:overflow-hidden ${isChatPage ? "h-dvh overflow-hidden" : "min-h-dvh"}`}
    >
      <StaffSidebar activeMenu={resolveActiveMenu(pathname)} onLogout={() => void logout()} />

      {/* Header 높이(h-16)는 Sidebar 로고 영역과 맞춘다. 모바일은 문서가, sm 이상은 main이 스크롤된다. */}
      <div className={`lg:ml-[240px] flex flex-col sm:h-screen sm:min-h-0 sm:overflow-hidden ${isChatPage ? "h-dvh overflow-hidden" : "min-h-dvh"}`}>
        <StaffHeader />
        <main className={`mt-16 sm:mt-0 sm:h-auto sm:flex-1 sm:min-h-0 sm:overflow-x-hidden sm:overflow-y-auto sm:overscroll-y-auto ${isChatPage ? "h-[calc(100dvh-4rem)] flex-none overflow-hidden" : "flex-1 overflow-visible"}`}>{children}</main>
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
