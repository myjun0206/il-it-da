"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, ArrowLeft, Inbox } from "lucide-react";
import { formatNotificationTime } from "@/lib/notifications";

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
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [filter, setFilter] = useState<FilterType>("all");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 20;

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

  return (
    <div className="min-h-screen bg-[var(--color-bg-default)]">
      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <button
            onClick={() => router.back()}
            className="p-2 rounded-lg hover:bg-[var(--color-bg-surface)] transition-colors"
            aria-label="뒤로가기"
          >
            <ArrowLeft size={20} className="text-[var(--color-text-secondary)]" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">알림</h1>
            {unreadCount > 0 && (
              <p className="text-sm text-[var(--color-text-secondary)] mt-1">
                읽지 않은 알림 {unreadCount}개
              </p>
            )}
          </div>
        </div>

        {/* Controls */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
          {/* Filter */}
          <div className="flex gap-2">
            <button
              onClick={() => {
                setFilter("all");
                setPage(1);
              }}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                filter === "all"
                  ? "bg-[var(--color-primary)] text-white"
                  : "bg-[var(--color-bg-surface)] text-[var(--color-text-primary)] hover:bg-[var(--color-border)]"
              }`}
            >
              전체
            </button>
            <button
              onClick={() => {
                setFilter("unread");
                setPage(1);
              }}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                filter === "unread"
                  ? "bg-[var(--color-primary)] text-white"
                  : "bg-[var(--color-bg-surface)] text-[var(--color-text-primary)] hover:bg-[var(--color-border)]"
              }`}
            >
              읽지 않음
            </button>
          </div>

          {/* Mark all as read */}
          {unreadCount > 0 && (
            <button
              onClick={handleMarkAllRead}
              className="text-sm font-medium text-[var(--color-primary)] hover:opacity-80 transition-opacity"
            >
              모두 읽음
            </button>
          )}
        </div>

        {/* Content */}
        {isLoading ? (
          <div className="text-center py-12">
            <p className="text-[var(--color-text-secondary)]">로딩 중...</p>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-12 gap-3">
            <AlertCircle
              size={32}
              className="text-red-600"
              aria-hidden="true"
            />
            <p className="text-red-600 font-medium">{error}</p>
            <button
              onClick={() => window.location.reload()}
              className="text-sm font-medium text-[var(--color-primary)] hover:opacity-80 transition-opacity"
            >
              다시 시도
            </button>
          </div>
        ) : filteredNotifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 gap-3">
            <Inbox
              size={32}
              className="text-[var(--color-text-tertiary)]"
              aria-hidden="true"
            />
            <p className="text-[var(--color-text-secondary)]">
              {filter === "unread" ? "읽지 않은 알림이 없습니다." : "알림이 없습니다."}
            </p>
          </div>
        ) : (
          <div className="space-y-1">
            <div className="bg-white border border-[var(--color-border)] rounded-lg overflow-hidden">
              {filteredNotifications.map((notification, index) => (
                <div
                  key={notification.id}
                  onClick={() => handleNotificationClick(notification)}
                  className={`px-4 py-4 cursor-pointer transition-colors border-b border-[var(--color-border)] last:border-b-0 ${
                    notification.isRead
                      ? "bg-white hover:bg-[var(--color-bg-surface)]"
                      : "bg-[var(--color-primary-light)]/5 hover:bg-[var(--color-primary-light)]/10"
                  }`}
                >
                  <div className="flex gap-4">
                    {!notification.isRead && (
                      <div className="flex-shrink-0 mt-1">
                        <div className="w-2.5 h-2.5 rounded-full bg-[var(--color-primary)]" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-4">
                        <p className="text-sm font-semibold text-[var(--color-text-primary)]">
                          {notification.title}
                        </p>
                        <p className="text-xs text-[var(--color-text-tertiary)] flex-shrink-0">
                          {formatNotificationTime(notification.createdAt)}
                        </p>
                      </div>
                      <p className="text-sm text-[var(--color-text-secondary)] mt-2 line-clamp-2">
                        {notification.message}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Load more button */}
            {hasMore && (
              <div className="text-center py-6">
                <button
                  onClick={() => setPage((p) => p + 1)}
                  className="text-sm font-medium text-[var(--color-primary)] hover:opacity-80 transition-opacity"
                >
                  더 보기
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
