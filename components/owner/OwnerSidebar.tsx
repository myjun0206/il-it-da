"use client";

import React, { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  House,
  BookOpen,
  FileText,
  Users,
  Bell,
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
    { id: "manual-common", label: "공통 매뉴얼", icon: BookOpen, href: "/boss/manuals" },
    { id: "manual-store", label: "지점 매뉴얼 관리", icon: FileText, href: "/boss/store-manuals" },
    { id: "staff", label: "직원 관리", icon: Users, href: "/boss/employees" },
    { id: "notice", label: "공지사항", icon: Bell, href: "/boss/notices" },
  ];

  const bottomMenuItems = [
    { id: "settings", label: "설정", icon: Settings, href: "/boss/settings" },
  ];

  return (
    <>
      {/* Mobile Menu Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed top-4 left-4 z-50 lg:hidden bg-white rounded-lg p-2 border border-[var(--color-border)]"
      >
        {isOpen ? <X size={24} /> : <Menu size={24} />}
      </button>

      {/* Sidebar */}
      <aside
        className={`fixed left-0 top-0 h-screen bg-white border-r border-[var(--color-border)] flex flex-col transition-transform duration-300 lg:translate-x-0 ${
          isOpen ? "translate-x-0" : "-translate-x-full"
        } lg:w-[240px] w-64 z-40`}
      >
        {/* Logo Section - aligned with header */}
        <div className="flex items-center px-6 h-16 border-b border-[var(--color-border)]">
          <Image
            src="/logo/ilitda-wordmark.png"
            alt="일잉다"
            width={687}
            height={253}
            className="h-8 w-auto object-contain"
          />
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
        <div className="py-3 px-3 border-t border-[var(--color-border)]">
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
          <div className="my-1 mx-2 border-t border-[var(--color-border)]" />

          {/* Logout Button */}
          {onLogout && (
            <button
              onClick={onLogout}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-base font-medium text-[var(--color-text-secondary)] hover:text-red-600 transition-colors"
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
