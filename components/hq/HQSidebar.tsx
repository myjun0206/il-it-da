"use client";

import React, { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  House,
  BookOpen,
  Store,
  Megaphone,
  Settings,
  LogOut,
  Menu,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

interface HQSidebarProps {
  userName: string;
  franchiseName: string;
  onLogout: () => void;
  activeMenu?: string;
}

interface HQSidebarSubmenuItem {
  id: string;
  label: string;
  href?: string;
}

interface HQSidebarMenuItem {
  id: string;
  label: string;
  icon: LucideIcon;
  href?: string;
  submenu?: HQSidebarSubmenuItem[];
}

export default function HQSidebar({
  userName,
  franchiseName,
  onLogout,
  activeMenu = "home",
}: HQSidebarProps) {
  const [isOpen, setIsOpen] = useState(false);

  const menuItems: HQSidebarMenuItem[] = [
    { id: "home", label: "홈", icon: House, href: "/hq" },
    {
      id: "manual",
      label: "매뉴얼 관리",
      icon: BookOpen,
      href: "/hq/manuals",
      submenu: [
        { id: "manual-common", label: "공통 매뉴얼 관리", href: "/hq/manuals/common" },
        { id: "manual-store", label: "지점 매뉴얼 보기", href: "/hq/manuals/stores" },
      ],
    },
    {
      id: "store",
      label: "지점 관리",
      icon: Store,
      href: "/hq/stores",
      submenu: [
        { id: "store-status", label: "지점 현황", href: "/hq/stores" },
        { id: "store-request", label: "문의 · 요청", href: "/hq/stores/requests" },
      ],
    },
    { id: "notice", label: "공지사항", icon: Megaphone, href: "/hq/communication" },
  ];

  const bottomMenuItems: HQSidebarMenuItem[] = [
    { id: "settings", label: "설정", icon: Settings, href: "/hq/settings" },
  ];

  return (
    <>
      {/* Mobile Menu Button */}
      {!isOpen && (
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          aria-label="메뉴 열기"
          aria-expanded={isOpen}
          className="fixed top-4 left-4 z-50 lg:hidden bg-white rounded-lg p-2 border border-(--color-border)"
        >
          <Menu size={24} />
        </button>
      )}

      {/* Sidebar */}
      <aside
        aria-label={`${franchiseName} · ${userName} 사이드바`}
        className={`fixed left-0 top-0 h-dvh overflow-hidden bg-white border-r border-(--color-border) flex flex-col transition-transform duration-300 lg:translate-x-0 ${
          isOpen ? "translate-x-0" : "-translate-x-full"
        } lg:w-60 w-64 z-40`}
      >
        {/* Logo Section - aligned with header */}
        <div className="flex shrink-0 items-center px-6 h-16 border-b border-(--color-border)">
          <Link href="/hq" aria-label="홈으로 이동" onClick={() => setIsOpen(false)} className="min-w-0">
            <Image
              src="/logo/ilitda-wordmark.png"
              alt="일잉다"
              width={687}
              height={253}
              className="h-8 w-auto max-w-full object-contain"
            />
          </Link>
        </div>

        {/* Menu Section */}
        <nav className="min-h-0 flex-1 py-3 px-3 overflow-y-auto">
          {menuItems.map((item, index) => {
            const isActive = activeMenu === item.id;
            const hasSubmenu = Boolean(item.submenu && item.submenu.length > 0);
            const hasActiveSubmenu = hasSubmenu && Boolean(item.submenu?.some((sub) => sub.id === activeMenu));
            const isGroupActive = isActive || hasActiveSubmenu;

            const buttonClass = `w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-base font-medium transition-colors ${
              index > 0 ? "mt-1" : ""
            } ${
              isActive
                ? "bg-(--color-primary-light)/30 text-(--color-primary)"
                : hasActiveSubmenu
                  ? "bg-(--color-primary-light)/15 text-(--color-text-primary)"
                  : "text-(--color-text-secondary) hover:text-(--color-text-primary)"
            }`;

            return (
              <div key={item.id}>
                {item.href ? (
                  <Link href={item.href} className={buttonClass}>
                    <item.icon size={20} />
                    <span>{item.label}</span>
                  </Link>
                ) : (
                  <button className={buttonClass}>
                    <item.icon size={20} />
                    <span>{item.label}</span>
                  </button>
                )}

                {/* Submenu */}
                {item.submenu && isGroupActive && (
                  <div className="ml-4 mt-1">
                    {item.submenu.map((sub) => {
                      const isSubActive = sub.id === activeMenu;
                      const subClass = `w-full block text-left px-4 py-3 text-sm font-medium rounded transition-colors ${
                        isSubActive
                          ? "bg-(--color-primary-light)/25 text-(--color-primary)"
                          : "text-(--color-text-secondary) hover:text-(--color-primary)"
                      }`;

                      return sub.href ? (
                        <Link key={sub.id} href={sub.href} className={subClass}>
                          {sub.label}
                        </Link>
                      ) : (
                        <button key={sub.id} className={subClass}>
                          {sub.label}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        {/* Bottom Menu */}
        <div className="shrink-0 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] px-3 border-t border-(--color-border)">
          {bottomMenuItems.map((item) => {
            const bottomClass = `w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-base font-medium transition-colors ${
              activeMenu === item.id
                ? "bg-(--color-primary-light)/30 text-(--color-primary)"
                : "text-(--color-text-secondary) hover:text-(--color-text-primary)"
            }`;

            return item.href ? (
              <Link key={item.id} href={item.href} className={bottomClass}>
                <item.icon size={20} />
                <span>{item.label}</span>
              </Link>
            ) : (
              <button key={item.id} className={bottomClass}>
                <item.icon size={20} />
                <span>{item.label}</span>
              </button>
            );
          })}

          <button
            type="button"
            onClick={onLogout}
            className="w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-base font-medium text-(--color-text-secondary) hover:text-red-600 transition-colors"
          >
            <LogOut size={20} />
            <span>로그아웃</span>
          </button>
        </div>
      </aside>

      {/* Mobile Overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/20 z-30 lg:hidden"
          onClick={() => setIsOpen(false)}
        />
      )}
    </>
  );
}
