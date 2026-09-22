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
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-4">
          화면 테마
        </label>
        <p className="text-sm text-[var(--color-text-secondary)] mb-4">
          일잇다 화면에 적용할 테마를 선택하세요.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {options.map((option) => {
          const Icon = option.icon;
          const isSelected = theme === option.value;

          return (
            <button
              key={option.value}
              onClick={() => setTheme(option.value)}
              className={`p-4 rounded-lg border-2 transition-all ${
                isSelected
                  ? "border-[var(--color-primary)] bg-[var(--color-primary-light)]/30"
                  : "border-[var(--color-border)] hover:border-[var(--color-primary)]/50 bg-[var(--color-bg-surface)]"
              }`}
            >
              <div className="flex flex-col items-center gap-3">
                <Icon
                  size={32}
                  className={
                    isSelected
                      ? "text-[var(--color-primary)]"
                      : "text-[var(--color-text-secondary)]"
                  }
                />
                <span
                  className={`text-sm font-medium ${
                    isSelected
                      ? "text-[var(--color-primary)]"
                      : "text-[var(--color-text-primary)]"
                  }`}
                >
                  {option.label}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
