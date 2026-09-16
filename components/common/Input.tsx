"use client";

import React, { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import clsx from "clsx";

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helpText?: string;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, helpText, className, ...props }, ref) => {
    return (
      <div className="w-full">
        {label && (
          <label className="mb-2 block text-sm font-semibold text-[var(--color-text-primary)]">
            {label}
          </label>
        )}
        <input
          ref={ref}
          className={clsx(
            "w-full h-16 px-5 py-3.5 rounded-lg border-2",
            "text-base text-[var(--color-text-primary)]",
            "placeholder:text-[var(--color-text-tertiary)]",
            "bg-[var(--color-bg-surface)]",
            "border-[var(--color-border)]",
            "transition-colors duration-200",
            "focus:outline-none focus:border-[var(--color-primary-accent)]",
            "focus:ring-2 focus:ring-[var(--color-primary-accent)]/30",
            error && "border-[var(--color-status-error)] focus:border-[var(--color-status-error)]",
            className
          )}
          {...props}
        />
        {error && (
          <p className="mt-1.5 text-sm text-[var(--color-status-error)]">
            {error}
          </p>
        )}
        {helpText && !error && (
          <p className="mt-1.5 text-sm text-[var(--color-text-tertiary)]">
            {helpText}
          </p>
        )}
      </div>
    );
  }
);

Input.displayName = "Input";

export interface PasswordInputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helpText?: string;
}

export const PasswordInput = React.forwardRef<
  HTMLInputElement,
  PasswordInputProps
>(({ label, error, helpText, className, ...props }, ref) => {
  const [showPassword, setShowPassword] = useState(false);

  return (
    <div className="w-full">
      {label && (
        <label className="mb-2 block text-sm font-semibold text-[var(--color-text-primary)]">
          {label}
        </label>
      )}
      <div className="relative">
        <input
          ref={ref}
          type={showPassword ? "text" : "password"}
          className={clsx(
            "w-full h-16 px-5 py-3.5 pr-14 rounded-lg border-2",
            "text-base text-[var(--color-text-primary)]",
            "placeholder:text-[var(--color-text-tertiary)]",
            "bg-[var(--color-bg-surface)]",
            "border-[var(--color-border)]",
            "transition-colors duration-200",
            "focus:outline-none focus:border-[var(--color-primary-accent)]",
            "focus:ring-2 focus:ring-[var(--color-primary-accent)]/30",
            error && "border-[var(--color-status-error)] focus:border-[var(--color-status-error)]",
            className
          )}
          {...props}
        />
        <button
          type="button"
          onClick={() => setShowPassword(!showPassword)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)] transition-colors"
          aria-label={showPassword ? "비밀번호 숨기기" : "비밀번호 표시"}
        >
          {showPassword ? (
            <EyeOff size={18} />
          ) : (
            <Eye size={18} />
          )}
        </button>
      </div>
      {error && (
        <p className="mt-1.5 text-sm text-[var(--color-status-error)]">
          {error}
        </p>
      )}
      {helpText && !error && (
        <p className="mt-1.5 text-sm text-[var(--color-text-tertiary)]">
          {helpText}
        </p>
      )}
    </div>
  );
});

PasswordInput.displayName = "PasswordInput";
