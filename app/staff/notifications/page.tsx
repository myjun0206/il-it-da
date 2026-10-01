"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Bell, MoreVertical } from "lucide-react";
import { formatNotificationTime } from "@/lib/notifications";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";

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

export default function StaffNotificationsPage() {
  const router = useRouter();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [filter, setFilter] = useState<FilterType>("all");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleteLoading, setIsDeleteLoading] = useState(false);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const menuRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const pageSize = 20;

  // Fetch notifications
  useEffect(() => {
    const fetchNotifications = async () => {
      setIsLoading(true);
      setError("");

      try {
        const response = await fetch(
          `/api/notifications?limit=${pageSize * page}&includeRead=${filter === "all"}`
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

  // Validate internal URL (must start with /)
  const isInternalUrl = (url?: string): boolean => {
    if (!url) return false;
    // Only allow paths starting with /
    // Reject http://, https://, //, javascript:, etc.
    return url.startsWith("/") && !url.startsWith("//");
  };

  // Handle notification click
  const handleNotificationClick = async (notification: Notification, e?: React.MouseEvent) => {
    // Prevent navigation if clicking on menu
    if (e && (e.target as HTMLElement).closest('[data-menu-button]')) {
      e.stopPropagation();
      return;
    }

    // Mark as read
    if (!notification.isRead) {
      try {
        await fetch(`/api/notifications/${notification.id}/mark-read`, {
          method: "PUT",
        });
        setNotifications((prev) =>
          prev.map((n) => (n.id === notification.id ? { ...n, isRead: true } : n))
        );
        setUnreadCount((count) => Math.max(0, count - 1));
      } catch (e) {
        console.error("Failed to mark notification as read:", e);
      }
    }

    // Navigate if targetUrl exists and is internal
    if (notification.targetUrl && isInternalUrl(notification.targetUrl)) {
      router.push(notification.targetUrl);
    }
  };

  // Handle mark as read
  const handleMarkAsRead = async (notificationId: string) => {
    try {
      await fetch(`/api/notifications/${notificationId}/mark-read`, {
        method: "PUT",
      });
      setNotifications((prev) =>
        prev.map((n) => (n.id === notificationId ? { ...n, isRead: true } : n))
      );
      setUnreadCount((count) => Math.max(0, count - 1));
      setOpenMenuId(null);
    } catch (e) {
      console.error("Failed to mark notification as read:", e);
    }
  };

  // Handle mark as unread
  const handleMarkAsUnread = async (notificationId: string) => {
    try {
      const response = await fetch(`/api/notifications/${notificationId}/mark-unread`, {
        method: "PUT",
      });

      if (response.ok) {
        setNotifications((prev) =>
          prev.map((n) => (n.id === notificationId ? { ...n, isRead: false } : n))
        );
        setUnreadCount((count) => count + 1);
        setOpenMenuId(null);
      } else {
        console.error("Failed to mark notification as unread");
      }
    } catch (e) {
      console.error("Failed to mark notification as unread:", e);
    }
  };

  // Handle mark all as read
  const handleMarkAllRead = async () => {
    try {
      await fetch("/api/notifications/read-all", { method: "PUT" });
      setUnreadCount(0);
      setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
    } catch (e) {
      console.error("Failed to mark all as read:", e);
    }
  };

  // Handle delete single notification
  const handleDeleteNotification = async (notificationId: string) => {
    try {
      const response = await fetch(`/api/notifications/${notificationId}/delete`, {
        method: "DELETE",
      });

      if (response.ok) {
        setNotifications((prev) => prev.filter((n) => n.id !== notificationId));
        const deletedNotification = notifications.find((n) => n.id === notificationId);
        if (deletedNotification && !deletedNotification.isRead) {
          setUnreadCount((count) => Math.max(0, count - 1));
        }
        setOpenMenuId(null);
      } else {
        console.error("Failed to delete notification");
      }
    } catch (e) {
      console.error("Failed to delete notification:", e);
    }
  };

  // Handle delete all notifications
  const handleDeleteAll = async () => {
    setIsDeleteLoading(true);
    try {
      const response = await fetch("/api/notifications/delete-all", {
        method: "DELETE",
      });

      if (response.ok) {
        setNotifications([]);
        setUnreadCount(0);
        setShowDeleteConfirm(false);
      } else {
        console.error("Failed to delete all notifications");
      }
    } catch (e) {
      console.error("Failed to delete all notifications:", e);
    } finally {
      setIsDeleteLoading(false);
    }
  };

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (openMenuId && menuRefs.current[openMenuId]) {
        if (!menuRefs.current[openMenuId]?.contains(e.target as Node)) {
          setOpenMenuId(null);
        }
      }
    };

    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, [openMenuId]);

  // Filter notifications based on current filter
  const filteredNotifications =
    filter === "unread"
      ? notifications.filter((n) => !n.isRead)
      : notifications;

  const hasMore = filteredNotifications.length >= pageSize * page;
  const allNotificationsCount = notifications.length;

  return (
    <div className="p-6 lg:p-8">
      <div className="max-w-7xl mx-auto">
        {/* Page header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-[var(--color-text-primary)] mb-2">알림</h1>
          <p className="text-base text-[var(--color-text-secondary)]">새로운 알림과 지난 알림을 확인하고 관리하세요.</p>
        </div>

        {/* Content */}
        {isLoading ? (
          <div className="rounded-lg border border-[var(--color-border)] bg-white p-8 text-center">
            <p className="text-base text-[var(--color-text-secondary)]">로딩 중...</p>
          </div>
        ) : error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-8 text-center">
            <p className="flex items-center justify-center gap-1.5 text-sm text-red-700">
              <AlertCircle size={16} aria-hidden="true" />
              {error}
            </p>
            <button
              onClick={() => window.location.reload()}
              className="mt-3 inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-[var(--color-primary)] hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
            >
              다시 시도
            </button>
          </div>
        ) : allNotificationsCount === 0 ? (
          <div className="rounded-lg border border-[var(--color-border)] bg-white p-8 text-center">
            <Bell size={28} className="mx-auto mb-2 text-[var(--color-text-tertiary)]" aria-hidden="true" />
            <p className="text-base font-semibold text-[var(--color-text-primary)]">아직 알림이 없습니다.</p>
            <p className="mt-1 text-sm text-[var(--color-text-secondary)]">새로운 소식이 도착하면 이곳에서 확인할 수 있습니다.</p>
          </div>
        ) : (
          <>
            {/* Filter + Action buttons */}
            <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              {/* Left: Filter buttons */}
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
                  전체 {allNotificationsCount}
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
                  읽지 않음 {unreadCount}
                </button>
              </div>

              {/* Right: Action buttons */}
              <div className="flex gap-3 sm:ml-auto">
                <button
                  onClick={handleMarkAllRead}
                  disabled={unreadCount === 0}
                  className="px-4 py-2 rounded-lg font-medium text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-[var(--color-primary)] hover:enabled:opacity-80"
                >
                  모두 읽음
                </button>
                <button
                  onClick={() => setShowDeleteConfirm(true)}
                  disabled={allNotificationsCount === 0}
                  className="px-4 py-2 rounded-lg font-medium text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-red-600 hover:enabled:opacity-80"
                >
                  전체 삭제
                </button>
              </div>
            </div>

            {/* Notifications list */}
            {filteredNotifications.length === 0 ? (
              <div className="rounded-lg border border-[var(--color-border)] bg-white p-8 text-center">
                <Bell size={28} className="mx-auto mb-2 text-[var(--color-text-tertiary)]" aria-hidden="true" />
                <p className="text-sm text-[var(--color-text-secondary)]">
                  {filter === "unread" ? "읽지 않은 알림이 없습니다." : "알림이 없습니다."}
                </p>
              </div>
            ) : (
              <div className="space-y-1 border border-[var(--color-border)] rounded-lg overflow-hidden bg-white">
                {filteredNotifications.map((notification) => (
                  <button
                    key={notification.id}
                    type="button"
                    onClick={(e) => handleNotificationClick(notification, e)}
                    className={`w-full px-6 py-4 text-left transition-colors border-b border-[var(--color-border)] last:border-b-0 ${
                      notification.isRead
                        ? "hover:bg-[var(--color-bg-surface)]"
                        : "hover:bg-[var(--color-primary-light)]/5"
                    }`}
                  >
                    <div className="flex gap-4">
                      {/* Unread indicator dot */}
                      {!notification.isRead && (
                        <div className="flex-shrink-0 mt-0.5">
                          <div className="w-2 h-2 rounded-full bg-[var(--color-primary)]" />
                        </div>
                      )}

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1 min-w-0">
                            <p
                              className={`text-sm font-semibold line-clamp-1 break-keep ${
                                notification.isRead
                                  ? "text-[var(--color-text-primary)]"
                                  : "text-[var(--color-text-primary)] font-bold"
                              }`}
                            >
                              {notification.title}
                            </p>
                            <p className="text-sm text-[var(--color-text-secondary)] mt-1 line-clamp-1 break-words">
                              {notification.message}
                            </p>
                          </div>

                          {/* Time and menu */}
                          <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                            <p className="text-xs text-[var(--color-text-tertiary)] whitespace-nowrap">
                              {formatNotificationTime(notification.createdAt)}
                            </p>

                            {/* Overflow menu */}
                            <div
                              ref={(el) => {
                                if (el) menuRefs.current[notification.id] = el;
                              }}
                              className="relative"
                            >
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setOpenMenuId(openMenuId === notification.id ? null : notification.id);
                                }}
                                data-menu-button
                                className="p-1 rounded-lg text-[var(--color-text-tertiary)] hover:bg-[var(--color-bg-surface)] transition-colors"
                                aria-label="메뉴"
                              >
                                <MoreVertical size={16} />
                              </button>

                              {/* Dropdown menu */}
                              {openMenuId === notification.id && (
                                <div className="absolute right-0 top-full mt-1 w-40 bg-white border border-[var(--color-border)] rounded-lg shadow-md z-10 overflow-hidden">
                                  {notification.isRead ? (
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleMarkAsUnread(notification.id);
                                      }}
                                      className="w-full px-4 py-2 text-left text-sm text-[var(--color-text-primary)] hover:bg-[var(--color-bg-surface)] transition-colors"
                                    >
                                      읽지 않음으로 표시
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleMarkAsRead(notification.id);
                                      }}
                                      className="w-full px-4 py-2 text-left text-sm text-[var(--color-text-primary)] hover:bg-[var(--color-bg-surface)] transition-colors"
                                    >
                                      읽음 처리
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleDeleteNotification(notification.id);
                                    }}
                                    className="w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50 transition-colors"
                                  >
                                    삭제
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}

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
          </>
        )}
      </div>

      {/* Delete all confirm dialog */}
      <ConfirmDialog
        isOpen={showDeleteConfirm}
        title="모든 알림을 삭제하시겠습니까?"
        description="삭제한 알림은 다시 확인할 수 없습니다."
        confirmText="전체 삭제"
        cancelText="취소"
        isDangerous
        isLoading={isDeleteLoading}
        onConfirm={handleDeleteAll}
        onCancel={() => setShowDeleteConfirm(false)}
      />
    </div>
  );
}
