"use client";

import React from "react";
import clsx from "clsx";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "outline"
  | "ghost"
  | "danger";

export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
  children: React.ReactNode;
}

const baseStyles =
  "inline-flex items-center justify-center rounded-md font-semibold transition-all duration-200 focus-visible:outline-3 focus-visible:outline-offset-2 disabled:opacity-60 disabled:cursor-not-allowed whitespace-nowrap";

const variantStyles = {
  primary:
    "bg-[var(--color-primary)] text-white hover:bg-[var(--color-primary-hover)] active:scale-95 focus-visible:outline-[var(--color-primary-accent)]",
  secondary:
    "bg-[var(--color-secondary)] text-white hover:bg-[var(--color-secondary-hover)] active:scale-95 focus-visible:outline-[var(--color-secondary)]",
  outline:
    "border-2 border-[var(--color-primary)] text-[var(--color-primary)] hover:bg-[var(--color-primary-light)] active:scale-95 focus-visible:outline-[var(--color-primary-accent)]",
  ghost:
    "text-[var(--color-primary)] hover:bg-[var(--color-primary-light)] active:scale-95 focus-visible:outline-[var(--color-primary-accent)]",
  danger:
    "bg-[var(--color-status-error)] text-white hover:bg-red-700 active:scale-95 focus-visible:outline-[var(--color-status-error)]",
};

const sizeStyles = {
  sm: "h-8 px-3 text-sm",
  md: "h-10 px-4 text-base",
  lg: "h-12 px-6 text-lg",
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = "primary",
      size = "md",
      isLoading,
      disabled,
      children,
      className,
      ...props
    },
    ref
  ) => {
    return (
      <button
        ref={ref}
        disabled={disabled || isLoading}
        className={clsx(
          baseStyles,
          variantStyles[variant],
          sizeStyles[size],
          className
        )}
        {...props}
      >
        {isLoading ? "로딩 중..." : children}
      </button>
    );
  }
);

Button.displayName = "Button";
