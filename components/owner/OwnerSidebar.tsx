"use client";

import React, { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  House,
  BookOpen,
  FileText,
  Users,
  Store,
  Bell,
  MessageCircleQuestionMark,
  Settings,
  LogOut,
  Menu,
  X,
} from "lucide-react";

interface OwnerSidebarProps {
  activeMenu?: string;
  onLogout?: () => void;
}

export default function OwnerSidebar({
  activeMenu = "home",
  onLogout,
}: OwnerSidebarProps) {
  const [isOpen, setIsOpen] = useState(false);

  const menuItems = [
    { id: "home", label: "홈", icon: House, href: "/boss" },
    { id: "manual-common", label: "공통 매뉴얼 관리", icon: BookOpen, href: "/boss/manuals" },
    { id: "manual-store", label: "지점 매뉴얼 관리", icon: FileText, href: "/boss/store-manuals" },
    { id: "staff", label: "직원 관리", icon: Users, href: "/boss/employees" },
    { id: "questions", label: "보류 질문", icon: MessageCircleQuestionMark, href: "/boss/questions" },
    { id: "stores", label: "운영 매장", icon: Store, href: "/boss/stores" },
    { id: "notice", label: "공지사항", icon: Bell, href: "/boss/notices" },
  ];

  const bottomMenuItems = [
    { id: "settings", label: "설정", icon: Settings, href: "/boss/settings" },
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
        className={`fixed left-0 top-0 h-screen bg-white border-r border-(--color-border) flex flex-col transition-transform duration-300 lg:translate-x-0 ${
          isOpen ? "translate-x-0" : "-translate-x-full"
        } lg:w-[240px] w-64 z-40`}
      >
        {/* Logo Section - aligned with header */}
        <div className="flex shrink-0 items-center justify-between gap-3 px-6 h-16 border-b border-(--color-border)">
          <Link href="/boss" aria-label="홈으로 이동" onClick={() => setIsOpen(false)} className="min-w-0">
            <Image
              src="/logo/ilitda-wordmark.png"
              alt="일잉다"
              width={687}
              height={253}
              className="h-8 w-auto max-w-full object-contain"
            />
          </Link>
          <button
            type="button"
            onClick={() => setIsOpen(false)}
            aria-label="메뉴 닫기"
            title="메뉴 닫기"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-(--color-border) bg-white lg:hidden"
          >
            <X size={24} aria-hidden="true" />
          </button>
        </div>

        {/* Menu Section */}
        <nav className="flex-1 pt-8 px-3 overflow-y-auto">
          {menuItems.map((item, index) => {
            const isActive = activeMenu === item.id;
            const buttonClass = `w-full flex items-center gap-3 px-4 py-3 rounded-lg text-base font-medium transition-colors ${
              index > 0 ? "mt-1" : ""
            } ${
              isActive
                ? "bg-[var(--color-primary-light)]/30 text-[var(--color-primary)]"
                : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
            }`;

            return (
              <Link
                key={item.id}
                href={item.href}
                aria-current={isActive ? "page" : undefined}
                className={buttonClass}
                onClick={() => setIsOpen(false)}
              >
                <item.icon size={20} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Bottom Menu */}
        {/* data-app-sidebar-footer: 하단 고정 Action Bar가 이 영역 높이에 맞춰 상단 구분선을 이어 붙인다. */}
        <div data-app-sidebar-footer className="py-3 px-3 border-t border-(--color-border)">
          {bottomMenuItems.map((item) => {
            const isActive = activeMenu === item.id;
            const itemClass = `w-full flex items-center gap-3 px-4 py-3 rounded-lg text-base font-medium transition-colors ${
              isActive
                ? "bg-[var(--color-primary-light)]/30 text-[var(--color-primary)]"
                : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
            }`;

            if (item.href) {
              return (
                <Link
                  key={item.id}
                  href={item.href}
                  aria-current={isActive ? "page" : undefined}
                  className={itemClass}
                  onClick={() => setIsOpen(false)}
                >
                  <item.icon size={20} />
                  <span>{item.label}</span>
                </Link>
              );
            }

            return (
              <button
                key={item.id}
                className={itemClass}
              >
                <item.icon size={20} />
                <span>{item.label}</span>
              </button>
            );
          })}

          {/* Divider */}
          <div className="my-1 mx-2 border-t border-(--color-border)" />

          {/* Logout Button */}
          {onLogout && (
            <button
              type="button"
              onClick={onLogout}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-base font-medium text-(--color-text-secondary) hover:text-red-600 transition-colors"
            >
              <LogOut size={20} />
              <span>로그아웃</span>
            </button>
          )}
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
