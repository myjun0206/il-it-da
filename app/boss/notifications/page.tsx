"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Bell } from "lucide-react";
import OwnerHeader from "@/components/owner/OwnerHeader";
import OwnerSidebar from "@/components/owner/OwnerSidebar";
import { formatNotificationTime } from "@/lib/notifications";
import { createClient } from "@/lib/supabase/client";

interface Notification {
  id: string;
  recipientUserId: string;
  type: string;
  title: string;
  message: string;
  targetUrl?: string;
  relatedId?: string;
  isRead: boolean;
  createdAt: string;
}

type FilterType = "all" | "unread";

export default function BossNotificationsPage() {
  const router = useRouter();
  const [userName, setUserName] = useState("점주");
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [filter, setFilter] = useState<FilterType>("all");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 20;

  useEffect(() => {
    let isCancelled = false;
    void createClient()
      .auth.getSession()
      .then(({ data }) => {
        const name = data.session?.user?.user_metadata?.name;
        if (!isCancelled && name) setUserName(name);
      });
    return () => {
      isCancelled = true;
    };
  }, []);

  const handleLogout = async () => {
    try {
      await createClient().auth.signOut();
    } finally {
      router.push("/");
    }
  };

  // Fetch notifications
  useEffect(() => {
    const fetchNotifications = async () => {
      setIsLoading(true);
      setError("");

      try {
        const response = await fetch(
          `/api/notifications?limit=${pageSize * page}&includeRead=${filter === "all"}`,
          { credentials: "include" },
        );
        const data = (await response.json()) as {
          success: boolean;
          data?: { notifications: Notification[]; unreadCount: number };
          error?: string;
        };

        if (response.ok && data.success && data.data) {
          setNotifications(data.data.notifications);
          setUnreadCount(data.data.unreadCount);
        } else {
          setError(data.error || "알림을 불러올 수 없습니다.");
        }
      } catch (e) {
        console.error("Failed to fetch notifications:", e);
        setError("알림을 불러올 수 없습니다.");
      } finally {
        setIsLoading(false);
      }
    };

    fetchNotifications();
  }, [filter, page]);

  // Handle notification click
  const handleNotificationClick = async (notification: Notification) => {
    // Mark as read
    if (!notification.isRead) {
      try {
        await fetch(`/api/notifications/${notification.id}/mark-read`, {
          method: "PUT",
          credentials: "include",
        });
        setNotifications((prev) =>
          prev.map((n) => (n.id === notification.id ? { ...n, isRead: true } : n))
        );
        setUnreadCount((count) => Math.max(0, count - 1));
      } catch (e) {
        console.error("Failed to mark notification as read:", e);
      }
    }

    // Navigate if targetUrl exists
    if (notification.targetUrl) {
      router.push(notification.targetUrl);
    }
  };

  // Handle mark all as read
  const handleMarkAllRead = async () => {
    try {
      await fetch("/api/notifications/read-all", { method: "PUT", credentials: "include" });
      setUnreadCount(0);
      setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
    } catch (e) {
      console.error("Failed to mark all as read:", e);
    }
  };

  // Filter notifications based on current filter
  const filteredNotifications =
    filter === "unread"
      ? notifications.filter((n) => !n.isRead)
      : notifications;

  const hasMore = filteredNotifications.length >= pageSize * page;

  const filterButtonClass = (isActive: boolean) =>
    `min-h-[44px] px-4 rounded-lg text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] ${
      isActive
        ? "bg-[var(--color-primary)] text-white"
        : "bg-[var(--color-bg-surface)] text-[var(--color-text-primary)] hover:bg-[var(--color-border)]"
    }`;

  return (
    <div className="min-h-screen bg-[var(--color-bg-default)] flex">
      <OwnerSidebar activeMenu="notifications" onLogout={handleLogout} />

      <div className="flex-1 min-w-0 ml-0 lg:ml-[240px] flex flex-col">
        <OwnerHeader userName={userName} storeName="" onLogout={handleLogout} />

        <main className="flex-1 overflow-y-auto">
          <div className="p-6 lg:p-8 max-w-7xl mx-auto">
            <div className="mb-8">
              <h1 className="text-2xl font-bold text-[var(--color-text-primary)] mb-2">알림</h1>
              <p className="text-base text-[var(--color-text-secondary)]">
                직원 가입 요청, 보류·반복 질문 등 매장 운영 알림을 확인하세요.
              </p>
            </div>

            <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex gap-2" role="group" aria-label="알림 필터">
                <button
                  type="button"
                  aria-pressed={filter === "all"}
                  onClick={() => {
                    setFilter("all");
                    setPage(1);
                  }}
                  className={filterButtonClass(filter === "all")}
                >
                  전체
                </button>
                <button
                  type="button"
                  aria-pressed={filter === "unread"}
                  onClick={() => {
                    setFilter("unread");
                    setPage(1);
                  }}
                  className={filterButtonClass(filter === "unread")}
                >
                  읽지 않음 {unreadCount}
                </button>
              </div>

              <button
                type="button"
                onClick={handleMarkAllRead}
                disabled={unreadCount === 0}
                className="min-h-[44px] self-start rounded-lg px-4 text-sm font-medium text-[var(--color-primary)] transition-opacity hover:enabled:opacity-80 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] disabled:cursor-not-allowed disabled:opacity-50 sm:self-auto"
              >
                모두 읽음
              </button>
            </div>

            {isLoading ? (
              <div className="rounded-xl border border-[var(--color-border)] bg-white p-8 text-center">
                <p className="text-base text-[var(--color-text-secondary)]" role="status">알림을 불러오는 중...</p>
              </div>
            ) : error ? (
              <div className="rounded-xl border border-red-200 bg-red-50 p-8 text-center" role="alert">
                <p className="flex items-center justify-center gap-1.5 text-sm text-red-700">
                  <AlertCircle size={16} aria-hidden="true" />
                  {error}
                </p>
                <button
                  type="button"
                  onClick={() => window.location.reload()}
                  className="mt-3 inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-[var(--color-primary)] hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
                >
                  다시 시도
                </button>
              </div>
            ) : filteredNotifications.length === 0 ? (
              <div className="rounded-xl border border-[var(--color-border)] bg-white p-8 text-center">
                <Bell size={28} className="mx-auto mb-2 text-[var(--color-text-tertiary)]" aria-hidden="true" />
                <p className="text-base font-semibold text-[var(--color-text-primary)]">
                  {filter === "unread" ? "읽지 않은 알림이 없습니다." : "아직 알림이 없습니다."}
                </p>
                <p className="mt-1 text-sm text-[var(--color-text-secondary)]">새로운 소식이 도착하면 이곳에서 확인할 수 있습니다.</p>
              </div>
            ) : (
              <>
                <ul className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-white">
                  {filteredNotifications.map((notification) => (
                    <li key={notification.id} className="border-b border-[var(--color-border)] last:border-b-0">
                      <button
                        type="button"
                        onClick={() => handleNotificationClick(notification)}
                        className={`flex w-full gap-4 px-5 py-4 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-primary)] sm:px-6 ${
                          notification.isRead
                            ? "hover:bg-[var(--color-bg-surface)]"
                            : "bg-[var(--color-primary-light)]/5 hover:bg-[var(--color-primary-light)]/10"
                        }`}
                      >
                        {!notification.isRead && (
                          <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[var(--color-primary)]" aria-label="읽지 않음" />
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="flex items-start justify-between gap-4">
                            <span
                              className={`min-w-0 break-keep text-sm text-[var(--color-text-primary)] ${
                                notification.isRead ? "font-semibold" : "font-bold"
                              }`}
                            >
                              {notification.title}
                            </span>
                            <time dateTime={notification.createdAt} className="shrink-0 whitespace-nowrap text-xs text-[var(--color-text-tertiary)]">
                              {formatNotificationTime(notification.createdAt)}
                            </time>
                          </span>
                          <span className="mt-1 block break-words text-sm text-[var(--color-text-secondary)] line-clamp-2">
                            {notification.message}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>

                {hasMore && (
                  <div className="py-6 text-center">
                    <button
                      type="button"
                      onClick={() => setPage((p) => p + 1)}
                      className="min-h-[44px] rounded-lg px-4 text-sm font-medium text-[var(--color-primary)] transition-opacity hover:opacity-80 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
                    >
                      더 보기
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
