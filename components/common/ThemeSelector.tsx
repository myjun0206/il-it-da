"use client";

import React from "react";
import { Sun, Moon, Monitor } from "lucide-react";
import { useTheme } from "@/lib/theme-context";

export default function ThemeSelector() {
  const { theme, setTheme } = useTheme();

  const options = [
    { value: "light" as const, label: "라이트", icon: Sun },
    { value: "dark" as const, label: "다크", icon: Moon },
    { value: "system" as const, label: "시스템 설정", icon: Monitor },
  ];

  return (
    <div role="radiogroup" aria-label="화면 테마" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {options.map((option) => {
        const Icon = option.icon;
        const isSelected = theme === option.value;

        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={isSelected}
            onClick={() => setTheme(option.value)}
            className={`flex min-h-[48px] items-center justify-center gap-2 rounded-lg border-2 px-4 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2 ${
              isSelected
                ? "border-[var(--color-primary)] bg-[var(--color-primary-light)]/30 text-[var(--color-primary)]"
                : "border-[var(--color-border)] bg-[var(--color-bg-surface)] text-[var(--color-text-primary)] hover:border-[var(--color-primary)]/50"
            }`}
          >
            <Icon
              size={18}
              aria-hidden="true"
              className={isSelected ? "text-[var(--color-primary)]" : "text-[var(--color-text-secondary)]"}
            />
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
