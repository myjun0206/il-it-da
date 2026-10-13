"use client";

import React, { useEffect, useRef, useState } from "react";
import { Bell, Building2, ChevronDown, Mail, Phone, X } from "lucide-react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import ProfileAvatar from "@/components/common/ProfileAvatar";
import { formatNotificationTime } from "@/lib/notifications";
import { NOTIFICATIONS_CHANGED_EVENT } from "@/lib/notifications/escalation-popup";
import { resolveNotificationClick } from "@/lib/notifications/notification-href";

interface ProfileNotification {
  id: string;
  type: string;
  title: string;
  message: string;
  targetUrl?: string | null;
  relatedId?: string | null;
  isRead: boolean;
  createdAt: string;
}

interface ProfileMenuProps {
  userName: string;
  /** 헤더 이름 아래 보조 문구 (예: "관리자" 등) */
  subtitle: string;
  /** 드롭다운 배지에 표시할 역할명 */
  roleLabel: string;
  /** 프로필 사진 URL (없으면 initials 표시) */
  avatarUrl?: string | null;
  /** 드롭다운에 표시할 현재 소속 정보 (예: 본사 관리자). 없으면 생략 */
  context?: { label: string; value: string };
  /** 모바일 통합 모달에만 표시할 소속 정보 */
  mobileContext?: { label: string; value: string };
  notificationPageUrl?: string;
}

// HQ/Owner/Staff 헤더 우측의 사용자 정보 드롭다운
export default function ProfileMenu({
  userName,
  subtitle,
  roleLabel,
  avatarUrl,
  context,
  mobileContext,
  notificationPageUrl = "/notifications",
}: ProfileMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [notifications, setNotifications] = useState<ProfileNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isNotificationsLoading, setIsNotificationsLoading] = useState(false);
  const [notificationError, setNotificationError] = useState("");
  const [notificationToast, setNotificationToast] = useState("");
  const [navigationTarget, setNavigationTarget] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const isStaffMobileLayout = notificationPageUrl === "/staff/notifications";

  useEffect(() => {
    let isCancelled = false;
    const supabase = createClient();

    void (async () => {
      const { data } = await supabase.auth.getUser();
      if (isCancelled || !data.user) return;

      setEmail(data.user.email ?? "");
      const { data: profile } = await supabase
        .from("profiles")
        .select("phone")
        .eq("id", data.user.id)
        .maybeSingle<{ phone: string | null }>();
      if (!isCancelled) {
        const metadataPhone = data.user.user_metadata?.phone;
        setPhone(profile?.phone ?? (typeof metadataPhone === "string" ? metadataPhone : ""));
      }
    })();

    return () => {
      isCancelled = true;
    };
  }, []);

  useEffect(() => {
    let isCancelled = false;

    const refreshUnreadCount = async () => {
      try {
        const response = await fetch("/api/notifications?limit=1", { credentials: "include" });
        if (isCancelled) return;
        if (response.status === 401) {
          setUnreadCount(0);
          return;
        }
        const result = (await response.json()) as { success?: boolean; data?: { unreadCount?: number } };
        if (response.ok && result.success && typeof result.data?.unreadCount === "number") {
          setUnreadCount(result.data.unreadCount);
        }
      } catch {
        // Keep the last known badge count when the notification service is unavailable.
      }
    };

    void refreshUnreadCount();
    window.addEventListener(NOTIFICATIONS_CHANGED_EVENT, refreshUnreadCount);
    return () => {
      isCancelled = true;
      window.removeEventListener(NOTIFICATIONS_CHANGED_EVENT, refreshUnreadCount);
    };
  }, []);

  useEffect(() => {
    if (!isMobileOpen) return;
    const controller = new AbortController();

    void (async () => {
      setIsNotificationsLoading(true);
      setNotificationError("");
      try {
        const response = await fetch("/api/notifications?limit=15", {
          credentials: "include",
          signal: controller.signal,
        });
        const result = (await response.json()) as {
          success?: boolean;
          data?: { notifications?: ProfileNotification[]; unreadCount?: number };
          error?: string;
        };
        if (response.ok && result.success && result.data) {
          setNotifications(result.data.notifications ?? []);
          setUnreadCount(result.data.unreadCount ?? 0);
        } else {
          setNotificationError(result.error || "알림을 불러오지 못했습니다.");
        }
      } catch {
        if (!controller.signal.aborted) setNotificationError("알림을 불러오지 못했습니다.");
      } finally {
        if (!controller.signal.aborted) setIsNotificationsLoading(false);
      }
    })();

    return () => controller.abort();
  }, [isMobileOpen]);

  useEffect(() => {
    if (!isMobileOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsMobileOpen(false);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isMobileOpen]);

  useEffect(() => {
    if (!notificationToast) return;
    const timer = setTimeout(() => setNotificationToast(""), 2500);
    return () => clearTimeout(timer);
  }, [notificationToast]);

  useEffect(() => {
    if (navigationTarget) window.location.href = navigationTarget;
  }, [navigationTarget]);

  const handleMobileNotificationClick = async (notification: ProfileNotification) => {
    if (!notification.isRead) {
      try {
        const response = await fetch(`/api/notifications/${notification.id}/mark-read`, {
          method: "PUT",
          credentials: "include",
        });
        if (response.ok) {
          setNotifications((current) => current.map((item) =>
            item.id === notification.id ? { ...item, isRead: true } : item,
          ));
          setUnreadCount((count) => Math.max(0, count - 1));
          window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED_EVENT));
        }
      } catch {
        // Navigation should still work when marking as read fails.
      }
    }

    const action = resolveNotificationClick(notification);
    if (action.kind === "navigate") {
      setNavigationTarget(action.href);
    } else if (action.kind === "notice") {
      setNotificationToast(action.message);
    }
  };

  const handleMarkAllMobileNotificationsRead = async () => {
    try {
      const response = await fetch("/api/notifications/read-all", {
        method: "PUT",
        credentials: "include",
      });
      if (!response.ok) return;
      setNotifications((current) => current.map((item) => ({ ...item, isRead: true })));
      setUnreadCount(0);
      window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED_EVENT));
    } catch {
      setNotificationError("알림을 읽음 처리하지 못했습니다.");
    }
  };

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  return (
    <div ref={menuRef} className="relative pl-3 sm:pl-6 border-l border-[var(--color-border)]">
      <button
        type="button"
        onClick={() => setIsMobileOpen(true)}
        aria-label={unreadCount > 0 ? `내 정보 및 알림, 읽지 않은 알림 ${unreadCount}개` : "내 정보 및 알림"}
        aria-haspopup="dialog"
        aria-expanded={isMobileOpen}
        className="relative flex min-h-[44px] items-center rounded-lg p-1 sm:hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
      >
        <ProfileAvatar name={userName} avatarUrl={avatarUrl} size="md" />
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold leading-none text-white">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-controls="profile-menu"
        className="hidden min-h-[44px] items-center gap-3 rounded-lg px-2 -mx-2 transition-colors hover:bg-[var(--color-bg-default)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] sm:flex"
      >
        {/* 좁은 화면에서는 이름/소속 문구를 숨기고 아바타만 보여 준다. (드롭다운에 같은 정보가 있다) */}
        <span className="hidden text-right sm:block">
          <span className="block text-sm font-semibold text-[var(--color-text-primary)]">{userName}</span>
          <span className="block text-xs text-[var(--color-text-secondary)]">{subtitle}</span>
        </span>
        <ProfileAvatar name={userName} avatarUrl={avatarUrl} size="md" />
        <ChevronDown
          size={16}
          aria-hidden="true"
          className={`text-[var(--color-text-secondary)] transition-transform ${isOpen ? "rotate-180" : ""}`}
        />
      </button>

      {isMobileOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 p-2 sm:hidden"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setIsMobileOpen(false);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-label="내 정보 및 알림"
            className={`grid h-[min(620px,calc(100dvh-1rem))] w-full max-w-lg overflow-hidden rounded-xl border border-[var(--color-border)] bg-white shadow-xl ${isStaffMobileLayout ? "grid-cols-1 grid-rows-[auto_minmax(0,1fr)]" : "grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]"}`}
          >
            <aside className={`flex min-w-0 flex-col border-[var(--color-border)] bg-[var(--color-bg-default)] p-3 ${isStaffMobileLayout ? "max-h-[40dvh] items-center overflow-y-auto border-b text-center" : "border-r"}`}>
              {!isStaffMobileLayout && <p className="mb-5 text-[10px] font-bold uppercase text-[var(--color-text-tertiary)]">My Information</p>}
              <div className={`flex flex-col gap-2 ${isStaffMobileLayout ? "w-full items-center" : "mb-5 items-start"}`}>
                <ProfileAvatar name={userName} avatarUrl={avatarUrl} size="md" />
                <div className={`min-w-0 ${isStaffMobileLayout ? "w-full" : ""}`}>
                  <p className="break-words text-sm font-semibold text-[var(--color-text-primary)]">{userName}</p>
                  {!isStaffMobileLayout && <p className="mt-1 text-xs font-medium text-[var(--color-primary)]">{roleLabel || subtitle}</p>}
                </div>
              </div>

              <div className={`space-y-4 text-[11px] ${isStaffMobileLayout ? "mt-1 w-full" : ""}`}>
                {!isStaffMobileLayout && phone && (
                  <div className="min-w-0">
                    <p className="mb-1 flex items-center gap-1 text-[var(--color-text-tertiary)]"><Phone size={12} /> 연락처</p>
                    <p className="break-all font-medium text-[var(--color-text-primary)]">{phone}</p>
                  </div>
                )}
                {email && (
                  <div className="min-w-0">
                    {!isStaffMobileLayout && <p className="mb-1 flex items-center gap-1 text-[var(--color-text-tertiary)]"><Mail size={12} /> 이메일</p>}
                    <p className="break-all font-medium text-[var(--color-text-primary)]">{email}</p>
                  </div>
                )}
                {!isStaffMobileLayout && (mobileContext ?? context) && (
                  <div className="min-w-0">
                    <p className="mb-1 flex items-center gap-1 text-[var(--color-text-tertiary)]"><Building2 size={12} /> {(mobileContext ?? context)?.label}</p>
                    <p className="break-words font-medium text-[var(--color-text-primary)]">{(mobileContext ?? context)?.value}</p>
                  </div>
                )}
              </div>
            </aside>

            <div className="flex min-h-0 min-w-0 flex-col">
              <header className={`flex shrink-0 items-center justify-between gap-2 border-b border-[var(--color-border)] px-3 py-3 ${isStaffMobileLayout ? "flex-wrap gap-y-2" : ""}`}>
                <div className={`flex min-w-0 items-center gap-1.5 ${isStaffMobileLayout ? "flex-1" : ""}`}>
                  <Bell size={16} className="shrink-0 text-[var(--color-primary)]" aria-hidden="true" />
                  <h2 className={`font-semibold text-[var(--color-text-primary)] ${isStaffMobileLayout ? "min-w-0 break-words text-[19.6px] leading-snug" : "truncate text-sm"}`}>{!isNotificationsLoading && !notificationError && notifications.length === 0 ? "알림 없음" : "Notifications"}</h2>
                  {unreadCount > 0 && <span className={`rounded-full bg-red-600 px-1.5 py-0.5 font-bold text-white ${isStaffMobileLayout ? "shrink-0 text-[14px] leading-snug" : "text-[10px]"}`}>{unreadCount > 99 ? "99+" : unreadCount}</span>}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {unreadCount > 0 && (
                    <button type="button" onClick={handleMarkAllMobileNotificationsRead} className={`font-medium text-[var(--color-primary)] ${isStaffMobileLayout ? "whitespace-nowrap text-[14px] leading-relaxed" : "text-[10px]"}`}>모두 읽음</button>
                  )}
                  <button type="button" onClick={() => setIsMobileOpen(false)} aria-label="닫기" className="flex h-8 w-8 items-center justify-center rounded-md text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-default)]">
                    <X size={18} aria-hidden="true" />
                  </button>
                </div>
              </header>

              <div className={`min-h-0 flex-1 overflow-y-auto ${isStaffMobileLayout ? "overscroll-contain p-3" : "p-2"}`}>
                {isNotificationsLoading ? (
                  <p className={`py-8 text-center text-[var(--color-text-secondary)] ${isStaffMobileLayout ? "break-words text-[16.8px] leading-relaxed" : "text-xs"}`}>불러오는 중...</p>
                ) : notificationError ? (
                  <p role="alert" className={`py-8 text-center text-red-600 ${isStaffMobileLayout ? "break-words text-[16.8px] leading-relaxed" : "text-xs"}`}>{notificationError}</p>
                ) : notifications.length === 0 ? (
                  <p className={`py-8 text-center text-[var(--color-text-secondary)] ${isStaffMobileLayout ? "break-words text-[16.8px] leading-relaxed" : "text-xs"}`}>알림 없음</p>
                ) : (
                  <div className={isStaffMobileLayout ? "space-y-3" : "space-y-2"}>
                    {notifications.map((notification) => (
                      <button
                        key={notification.id}
                        type="button"
                        onClick={() => void handleMobileNotificationClick(notification)}
                        className={`w-full rounded-lg border border-[var(--color-border)] text-left ${isStaffMobileLayout ? "p-3" : "p-2"} ${notification.isRead ? "bg-white" : "bg-[var(--color-primary-light)]/10"}`}
                      >
                        <p className={`font-semibold text-[var(--color-text-primary)] ${isStaffMobileLayout ? "break-words text-[16.8px] leading-relaxed" : "line-clamp-2 text-xs"}`}>{notification.title}</p>
                        <p className={`text-[var(--color-text-secondary)] ${isStaffMobileLayout ? "mt-2 break-words text-[15.4px] leading-relaxed" : "mt-1 line-clamp-3 text-[11px] leading-4"}`}>{notification.message}</p>
                        <p className={`text-[var(--color-text-tertiary)] ${isStaffMobileLayout ? "mt-2 break-words text-[14px] leading-relaxed" : "mt-1 text-[10px]"}`}>{formatNotificationTime(notification.createdAt)}</p>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <Link href={notificationPageUrl} onClick={() => setIsMobileOpen(false)} className={`shrink-0 border-t border-[var(--color-border)] px-3 py-2.5 text-center font-semibold text-[var(--color-primary)] ${isStaffMobileLayout ? "text-[16.8px] leading-relaxed" : "text-xs"}`}>알림 전체보기</Link>
            </div>
          </section>
        </div>
      )}

      {notificationToast && (
        <div role="status" className="fixed bottom-6 left-1/2 z-[110] -translate-x-1/2 rounded-lg bg-[var(--color-text-primary)] px-4 py-3 text-sm text-white shadow-md sm:hidden">
          {notificationToast}
        </div>
      )}

      {isOpen && (
        <div
          id="profile-menu"
          role="menu"
          aria-label="계정 메뉴"
          className="absolute right-0 top-full z-50 mt-3 min-w-[380px] rounded-xl border border-[var(--color-border)] bg-white p-2 shadow-md"
        >
          <div className="px-3 pb-3 pt-2">
            {/* 사용자 정보 + 역할 배지 */}
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-base font-semibold text-[var(--color-text-primary)]">{userName}</p>
                {email && <p className="mt-0.5 text-sm text-[var(--color-text-secondary)] whitespace-nowrap">{email}</p>}
              </div>
              <span className="flex-shrink-0 inline-flex rounded-full bg-[var(--color-primary-light)]/40 px-2.5 py-0.5 text-xs font-semibold text-[var(--color-primary)]">
                {roleLabel}
              </span>
            </div>

            {/* HQ/Owner용 소속 정보 */}
            {context && (
              <div className="mt-4 rounded-lg bg-[var(--color-bg-default)] px-3 py-2">
                <p className="text-xs text-[var(--color-text-tertiary)]">{context.label}</p>
                <p className="mt-0.5 text-sm font-medium text-[var(--color-text-primary)] break-keep">{context.value}</p>
              </div>
            )}
          </div>

        </div>
      )}
    </div>
  );
}
