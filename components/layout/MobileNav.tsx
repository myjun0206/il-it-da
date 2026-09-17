"use client";

import React from "react";
import clsx from "clsx";

export interface MobileNavItem {
  id: string;
  label: string;
  icon: React.ReactNode;
  href: string;
  badge?: number;
  active?: boolean;
}

interface MobileNavProps {
  items: MobileNavItem[];
}

export const MobileNav = React.forwardRef<HTMLDivElement, MobileNavProps>(
  ({ items }, ref) => {
    return (
      <nav
        ref={ref}
        className="fixed bottom-0 left-0 right-0 z-[var(--zindex-fixed)] lg:hidden h-20 bg-[var(--color-bg-surface)] border-t border-[var(--color-border)] flex items-center justify-around px-2"
      >
        {items.map((item) => (
          <a
            key={item.id}
            href={item.href}
            className="flex flex-col items-center justify-center w-16 h-20 gap-1 relative text-[var(--color-text-secondary)] hover:text-[var(--color-primary)] transition-colors"
          >
            <div className={clsx(item.active && "text-[var(--color-primary)]")}>
              {item.icon}
            </div>
            <span className="text-xs font-medium text-center truncate max-w-14">
              {item.label}
            </span>
            {item.badge && item.badge > 0 && (
              <span className="absolute top-2 right-2 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--color-status-error)] text-white text-xs font-bold">
                {item.badge}
              </span>
            )}
          </a>
        ))}
      </nav>
    );
  }
);

MobileNav.displayName = "MobileNav";
