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
  X,
} from "lucide-react";

interface HQSidebarProps {
  userName: string;
  franchiseName: string;
  onLogout: () => void;
  activeMenu?: string;
}

export default function HQSidebar({
  userName,
  franchiseName,
  onLogout,
  activeMenu = "home",
}: HQSidebarProps) {
  const [isOpen, setIsOpen] = useState(false);

  const menuItems = [
    { id: "home", label: "홈", icon: House, href: "/hq" },
    {
      id: "manual",
      label: "매뉴얼 관리",
      icon: BookOpen,
      href: "/hq/manuals",
      submenu: [
        { id: "manual-common", label: "공통 매뉴얼 관리" },
        { id: "manual-store", label: "지점 매뉴얼 보기" },
      ],
    },
    {
      id: "store",
      label: "지점 관리",
      icon: Store,
      submenu: [
        { id: "store-status", label: "지점 현황" },
        { id: "store-request", label: "문의 · 요청" },
      ],
    },
    { id: "notice", label: "소통", icon: Megaphone, href: "/hq/communication" },
  ];

  const bottomMenuItems = [
    { id: "settings", label: "설정", icon: Settings },
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
        aria-label={`${franchiseName} · ${userName} 사이드바`}
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
                {item.submenu && isActive && (
                  <div className="ml-4 mt-1">
                    {item.submenu.map((sub) => (
                      <button
                        key={sub.id}
                        className="w-full text-left px-4 py-3 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-primary)] transition-colors"
                      >
                        {sub.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        {/* Bottom Menu */}
        <div className="py-3 px-3">
          {bottomMenuItems.map((item) => (
            <button
              key={item.id}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-base font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
            >
              <item.icon size={20} />
              <span>{item.label}</span>
            </button>
          ))}
          
          {/* Divider between actions */}
          <div className="border-t border-[var(--color-border)] my-1" />

          <button
            onClick={onLogout}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-base font-medium text-[var(--color-text-secondary)] hover:text-red-600 transition-colors"
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
