"use client";

import React, { useEffect, useState, useRef } from "react";
import { Bell } from "lucide-react";
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

interface NotificationCenterProps {
  className?: string;
}

interface NavigationState {
  targetUrl: string | null;
}

export default function NotificationCenter({ className = "" }: NotificationCenterProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [navigationTarget, setNavigationTarget] = useState<NavigationState>({ targetUrl: null });
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Handle navigation
  useEffect(() => {
    if (navigationTarget.targetUrl) {
      window.location.href = navigationTarget.targetUrl;
    }
  }, [navigationTarget]);

  // Fetch notifications when panel opens
  useEffect(() => {
    if (!isOpen) return;

    const fetchNotifications = async () => {
      setIsLoading(true);
      setError("");

      try {
        const response = await fetch("/api/notifications?limit=15");
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
  }, [isOpen]);

  // Handle notification click
  const handleNotificationClick = async (notification: Notification) => {
    // Mark as read
    if (!notification.isRead) {
      try {
        await fetch(`/api/notifications/${notification.id}/mark-read`, {
          method: "PUT",
        });
      } catch (e) {
        console.error("Failed to mark notification as read:", e);
      }
    }

    // Navigate if targetUrl exists
    if (notification.targetUrl) {
      setNavigationTarget({ targetUrl: notification.targetUrl });
    }
  };

  // Handle mark all as read
  const handleMarkAllRead = async () => {
    try {
      await fetch("/api/notifications/read-all", { method: "PUT" });
      setUnreadCount(0);
      setNotifications((prev) =>
        prev.map((n) => ({ ...n, isRead: true }))
      );
    } catch (e) {
      console.error("Failed to mark all as read:", e);
    }
  };

  // Close panel on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        isOpen &&
        panelRef.current &&
        !panelRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  // Handle ESC key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        setIsOpen(false);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  return (
    <div className={`relative ${className}`}>
      {/* Bell Button */}
      <button
        ref={buttonRef}
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 rounded-lg hover:bg-[var(--color-bg-surface)] transition-colors"
        aria-label="알림"
        aria-expanded={isOpen}
        aria-haspopup="dialog"
      >
        <Bell size={20} className="text-[var(--color-text-secondary)]" />
        {unreadCount > 0 && (
          <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full" />
        )}
      </button>

      {/* Notification Panel */}
      {isOpen && (
        <div
          ref={panelRef}
          className="absolute right-0 top-full mt-2 w-96 max-w-[calc(100vw-1rem)] bg-white border border-[var(--color-border)] rounded-lg shadow-lg z-50 max-h-96 flex flex-col"
          role="dialog"
          aria-label="알림 목록"
        >
          {/* Header */}
          <div className="sticky top-0 flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)] bg-white rounded-t-lg">
            <h3 className="font-semibold text-[var(--color-text-primary)]">알림</h3>
            {unreadCount > 0 && (
              <button
                onClick={handleMarkAllRead}
                className="text-xs font-medium text-[var(--color-primary)] hover:opacity-80 transition-opacity"
              >
                모두 읽음
              </button>
            )}
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto">
            {isLoading ? (
              <div className="p-4 text-center text-[var(--color-text-secondary)] text-sm">
                로딩 중...
              </div>
            ) : error ? (
              <div className="p-4 text-center text-red-600 text-sm">
                {error}
              </div>
            ) : notifications.length === 0 ? (
              <div className="p-8 text-center text-[var(--color-text-secondary)] text-sm">
                새로운 알림이 없습니다.
              </div>
            ) : (
              <div className="divide-y divide-[var(--color-border)]">
                {notifications.map((notification) => (
                  <div
                    key={notification.id}
                    onClick={() => handleNotificationClick(notification)}
                    className={`px-4 py-3 cursor-pointer transition-colors ${
                      notification.isRead
                        ? "bg-white hover:bg-[var(--color-bg-surface)]"
                        : "bg-[var(--color-primary-light)]/5 hover:bg-[var(--color-primary-light)]/10"
                    }`}
                  >
                    <div className="flex gap-3">
                      {!notification.isRead && (
                        <div className="flex-shrink-0 mt-1">
                          <div className="w-2 h-2 rounded-full bg-[var(--color-primary)]" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-[var(--color-text-primary)] line-clamp-2">
                          {notification.title}
                        </p>
                        <p className="text-xs text-[var(--color-text-secondary)] line-clamp-2 mt-1">
                          {notification.message}
                        </p>
                        <p className="text-xs text-[var(--color-text-secondary)] mt-1">
                          {formatNotificationTime(notification.createdAt)}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          {notifications.length > 0 && (
            <div className="sticky bottom-0 px-4 py-3 border-t border-[var(--color-border)] bg-white rounded-b-lg text-center">
              <button className="text-sm font-medium text-[var(--color-primary)] hover:opacity-80 transition-opacity">
                알림 전체보기
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
