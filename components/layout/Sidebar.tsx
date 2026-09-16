"use client";

import React from "react";
import clsx from "clsx";

interface SidebarProps {
  isOpen?: boolean;
  onClose?: () => void;
  navigationItems: NavigationItem[];
}

export interface NavigationItem {
  id: string;
  label: string;
  icon: React.ReactNode;
  href: string;
  badge?: number;
  active?: boolean;
}

export const Sidebar = React.forwardRef<HTMLDivElement, SidebarProps>(
  ({ isOpen = true, navigationItems }, ref) => {
    return (
      <aside
        ref={ref}
        className={clsx(
          "fixed left-0 top-0 z-[var(--zindex-sticky)] h-full w-64 bg-[var(--color-bg-surface)] border-r border-[var(--color-border)]",
          "hidden lg:flex lg:flex-col",
          "pt-20" // Header height offset
        )}
      >
        {/* Navigation Items */}
        <nav className="flex-1 px-4 py-6 space-y-2 overflow-y-auto">
          {navigationItems.map((item) => (
            <a
              key={item.id}
              href={item.href}
              className={clsx(
                "flex items-center gap-3 px-4 py-3 rounded-lg transition-colors",
                item.active
                  ? "bg-[var(--color-primary-light)] text-[var(--color-primary)] font-semibold"
                  : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-default)]"
              )}
            >
              <div className="flex-shrink-0">{item.icon}</div>
              <span className="flex-1 min-w-0 truncate">{item.label}</span>
              {item.badge && item.badge > 0 && (
                <span className="flex-shrink-0 flex h-6 w-6 items-center justify-center rounded-full bg-[var(--color-status-error)] text-white text-xs font-bold">
                  {item.badge}
                </span>
              )}
            </a>
          ))}
        </nav>

        {/* Footer */}
        <div className="border-t border-[var(--color-border)] p-4">
          <p className="text-xs text-[var(--color-text-tertiary)]">
            일잇다 v1.0.0
          </p>
        </div>
      </aside>
    );
  }
);

Sidebar.displayName = "Sidebar";
