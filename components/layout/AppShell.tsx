"use client";

import React, { useState } from "react";
import { usePathname } from "next/navigation";
import {
  Home,
  Users,
  FileText,
  BarChart3,
  Store,
  MessageSquare,
  Settings,
  HelpCircle,
} from "lucide-react";
import { Header } from "./Header";
import { Sidebar, type NavigationItem } from "./Sidebar";
import { MobileNav, type MobileNavItem } from "./MobileNav";
import clsx from "clsx";

interface AppShellProps {
  children: React.ReactNode;
  userRole?: "hq" | "owner" | "staff";
  userName?: string;
}

export const AppShell = React.forwardRef<HTMLDivElement, AppShellProps>(
  ({ children, userRole = "staff", userName = "사용자" }, ref) => {
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
    const pathname = usePathname();

    // 역할별 네비게이션 생성
    const getNavigationItems = (): NavigationItem[] => {
      const baseItems: NavigationItem[] = [
        {
          id: "home",
          label: "홈",
          icon: <Home size={20} />,
          href: "/app/home",
          active: pathname === "/app/home",
        },
      ];

      const roleItems: Record<string, NavigationItem[]> = {
        hq: [
          {
            id: "brands",
            label: "브랜드 관리",
            icon: <Store size={20} />,
            href: "/app/brands",
            active: pathname.startsWith("/app/brands"),
          },
          {
            id: "stores",
            label: "매장 관리",
            icon: <BarChart3 size={20} />,
            href: "/app/stores",
            active: pathname.startsWith("/app/stores"),
          },
          {
            id: "members",
            label: "직원 관리",
            icon: <Users size={20} />,
            href: "/app/members",
            active: pathname.startsWith("/app/members"),
            badge: 3,
          },
          {
            id: "manuals",
            label: "매뉴얼",
            icon: <FileText size={20} />,
            href: "/app/manuals",
            active: pathname.startsWith("/app/manuals"),
          },
          {
            id: "chat",
            label: "AI 상담",
            icon: <MessageSquare size={20} />,
            href: "/app/chat",
            active: pathname.startsWith("/app/chat"),
          },
        ],
        owner: [
          {
            id: "store",
            label: "매장",
            icon: <Store size={20} />,
            href: "/app/store",
            active: pathname === "/app/store",
          },
          {
            id: "members",
            label: "직원",
            icon: <Users size={20} />,
            href: "/app/members",
            active: pathname.startsWith("/app/members"),
            badge: 2,
          },
          {
            id: "manuals",
            label: "매뉴얼",
            icon: <FileText size={20} />,
            href: "/app/manuals",
            active: pathname.startsWith("/app/manuals"),
          },
          {
            id: "chat",
            label: "AI 상담",
            icon: <MessageSquare size={20} />,
            href: "/app/chat",
            active: pathname.startsWith("/app/chat"),
          },
          {
            id: "stats",
            label: "통계",
            icon: <BarChart3 size={20} />,
            href: "/app/stats",
            active: pathname.startsWith("/app/stats"),
          },
        ],
        staff: [
          {
            id: "manuals",
            label: "매뉴얼",
            icon: <FileText size={20} />,
            href: "/app/manuals",
            active: pathname.startsWith("/app/manuals"),
          },
          {
            id: "chat",
            label: "AI 상담",
            icon: <MessageSquare size={20} />,
            href: "/app/chat",
            active: pathname.startsWith("/app/chat"),
          },
          {
            id: "faq",
            label: "FAQ",
            icon: <HelpCircle size={20} />,
            href: "/app/faq",
            active: pathname.startsWith("/app/faq"),
          },
        ],
      };

      return [...baseItems, ...(roleItems[userRole] || [])];
    };

    // 모바일 네비게이션 항목 (축약 버전)
    const getMobileNavItems = (): MobileNavItem[] => {
      const navigationItems = getNavigationItems();
      return navigationItems.slice(0, 4).map((item) => ({
        id: item.id,
        label: item.label,
        icon: item.icon,
        href: item.href,
        badge: item.badge,
        active: item.active,
      }));
    };

    return (
      <div ref={ref} className="min-h-screen bg-[var(--color-bg-default)]">
        {/* Header */}
        <Header
          userRole={userRole}
          userName={userName}
          onMenuToggle={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          isMobileMenuOpen={isMobileMenuOpen}
        />

        {/* Sidebar */}
        <Sidebar navigationItems={getNavigationItems()} />

        {/* Main Content */}
        <main
          className={clsx(
            "pt-20 pb-20 lg:pb-0 lg:pl-64 transition-all duration-300",
            isMobileMenuOpen && "lg:pl-64"
          )}
        >
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
            {children}
          </div>
        </main>

        {/* Mobile Navigation */}
        <MobileNav items={getMobileNavItems()} />

        {/* Mobile Menu Overlay */}
        {isMobileMenuOpen && (
          <div
            className="fixed inset-0 z-30 lg:hidden bg-black/50"
            onClick={() => setIsMobileMenuOpen(false)}
          />
        )}
      </div>
    );
  }
);

AppShell.displayName = "AppShell";
