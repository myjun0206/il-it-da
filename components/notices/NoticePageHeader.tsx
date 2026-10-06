import type { ReactNode } from "react";

interface NoticePageHeaderProps {
  title: string;
  description: string;
  action?: ReactNode;
}

export function NoticePageHeader({ title, description, action }: NoticePageHeaderProps) {
  return (
    <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="mb-2 text-2xl font-bold text-[var(--color-text-primary)]">{title}</h1>
        <p className="text-base text-[var(--color-text-secondary)]">{description}</p>
      </div>
      {action}
    </div>
  );
}