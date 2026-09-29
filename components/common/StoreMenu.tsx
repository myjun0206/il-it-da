"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MoreVertical, LogOut, X } from "lucide-react";

interface StoreMenuAction {
  label: string;
  destructive?: boolean;
  onClick: () => void;
}

interface StoreMenuProps {
  actions: StoreMenuAction[];
  ariaLabel?: string;
}

interface MenuPosition {
  top: number;
  right: number;
  direction: "up" | "down";
}

export function StoreMenu({ actions, ariaLabel = "매장 관리 메뉴" }: StoreMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // button 위치를 계산하고 메뉴를 위/아래 중 적절한 방향으로 배치
  useEffect(() => {
    if (!isOpen || !buttonRef.current) {
      setMenuPosition(null);
      return;
    }

    const updatePosition = () => {
      if (!buttonRef.current) return;

      const rect = buttonRef.current.getBoundingClientRect();
      const menuHeight = actions.length * 44; // 각 메뉴 아이템은 py-3 = ~44px
      const gap = 8; // mt-1 in pixels
      const viewportHeight = window.innerHeight;

      // button 아래 공간
      const spaceBelow = viewportHeight - (rect.bottom + gap);

      // 아래쪽에 충분한 공간이 있으면 아래로, 아니면 위로
      const direction: "down" | "up" = spaceBelow >= menuHeight ? "down" : "up";

      const top = direction === "down"
        ? rect.bottom + gap
        : rect.top - menuHeight - gap;

      const right = window.innerWidth - rect.right;

      setMenuPosition({ top, right, direction });
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition);

    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition);
    };
  }, [isOpen, actions.length]);

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (
        menuRef.current &&
        buttonRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsOpen(false);
      }
    };

    document.addEventListener("click", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("click", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  const handleActionClick = (action: StoreMenuAction) => {
    setIsOpen(false);
    action.onClick();
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        aria-label={ariaLabel}
        aria-expanded={isOpen}
        className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-secondary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2 transition-colors"
      >
        <MoreVertical size={20} aria-hidden="true" />
      </button>

      {isOpen && menuPosition && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={menuRef}
              role="menu"
              style={{
                position: "fixed",
                top: `${menuPosition.top}px`,
                right: `${menuPosition.right}px`,
                zIndex: 999,
              }}
              className="w-48 rounded-lg border border-[var(--color-border)] bg-white shadow-md overflow-hidden"
            >
              {actions.map((action, idx) => (
                <button
                  key={idx}
                  type="button"
                  role="menuitem"
                  onClick={() => handleActionClick(action)}
                  className={`w-full flex items-center gap-3 px-4 py-3 text-sm font-medium transition-colors focus:outline-none ${
                    action.destructive
                      ? "text-red-600 hover:bg-red-50"
                      : "text-[var(--color-text-primary)] hover:bg-[var(--color-bg-secondary)]"
                  }`}
                >
                  {action.label}
                </button>
              ))}
            </div>,
            document.body
          )
        : null}
    </>
  );
}
