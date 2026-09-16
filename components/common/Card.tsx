"use client";

import React from "react";
import clsx from "clsx";

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  padding?: "sm" | "md" | "lg" | "none";
  border?: boolean;
  shadow?: boolean;
}

export const Card = React.forwardRef<HTMLDivElement, CardProps>(
  (
    {
      children,
      padding = "md",
      border = true,
      shadow = true,
      className,
      ...props
    },
    ref
  ) => {
    const paddingClass = {
      sm: "p-3",
      md: "p-4",
      lg: "p-6",
      none: "p-0",
    }[padding];

    return (
      <div
        ref={ref}
        className={clsx(
          "rounded-lg bg-[var(--color-bg-surface)]",
          border && "border border-[var(--color-border)]",
          shadow && "shadow-md",
          paddingClass,
          className
        )}
        {...props}
      >
        {children}
      </div>
    );
  }
);

Card.displayName = "Card";
