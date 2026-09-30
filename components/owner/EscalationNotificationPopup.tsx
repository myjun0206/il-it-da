"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bell, X } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import {
  type EscalationPopupState,
  type PopupNotification,
  createInitialPopupState,
  mergePopupQueue,
  readSeenIds,
  reduceNotificationPoll,
  storeIdFromTargetUrl,
  writeSeenIds,
} from "@/lib/notifications/escalation-popup";
import { resolveNotificationClick } from "@/lib/notifications/notification-href";
import { type OwnerStore, resolveOwnerCurrentStore } from "@/lib/owner/current-store";

const POLL_INTERVAL_MS = 30_000;
const NOTIFICATION_PAGE_SIZE = 15;
const GENERIC_STORE_LABEL = "운영 중인 매장";

type NotificationListResponse = {
  success?: boolean;
  data?: { notifications?: PopupNotification[] };
};

function safeSessionStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * 점주 화면에서만 동작하는 새 보류 질문 팝업.
 * /boss layout에 두어 같은 탭에서 경로를 옮겨도 감지가 끊기지 않게 한다.
 */
export default function EscalationNotificationPopup() {
  const [queue, setQueue] = useState<PopupNotification[]>([]);
  const [storeNames, setStoreNames] = useState<Map<string, string>>(new Map());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");
  const [navigationTarget, setNavigationTarget] = useState<string | null>(null);

  const userIdRef = useRef<string | null>(null);
  const stateRef = useRef<EscalationPopupState>(createInitialPopupState());
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  const isOpen = queue.length > 0;

  // NotificationCenter와 같은 방식으로 이동은 effect에서 수행한다.
  useEffect(() => {
    if (navigationTarget) {
      window.location.href = navigationTarget;
    }
  }, [navigationTarget]);

  useEffect(() => {
    let isCancelled = false;

    void resolveOwnerCurrentStore().then((resolution) => {
      if (isCancelled || resolution.status !== "ready") return;
      setStoreNames(new Map(resolution.stores.map((store: OwnerStore) => [store.storeId, store.storeName])));
    });

    return () => {
      isCancelled = true;
    };
  }, []);

  const applyPoll = useCallback((notifications: PopupNotification[]) => {
    const { state, newNotifications } = reduceNotificationPoll(stateRef.current, notifications);
    stateRef.current = state;
    writeSeenIds(safeSessionStorage(), userIdRef.current ?? "", state.seenIds);

    if (newNotifications.length > 0) {
      setQueue((current) => mergePopupQueue(current, newNotifications));
    }
  }, []);

  useEffect(() => {
    let isCancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const poll = async () => {
      try {
        const response = await fetch(`/api/notifications?limit=${NOTIFICATION_PAGE_SIZE}`, {
          credentials: "include",
        });
        if (!response.ok) return;
        const payload = (await response.json()) as NotificationListResponse;
        if (isCancelled || !payload.success || !Array.isArray(payload.data?.notifications)) return;
        applyPoll(payload.data.notifications);
      } catch {
        // 조회 실패는 건너뛴다. 기준 목록을 비우거나 초기화하지 않는다.
      }
    };

    void (async () => {
      const { data } = await createClient().auth.getUser();
      if (isCancelled || !data.user) return;

      userIdRef.current = data.user.id;
      stateRef.current = createInitialPopupState(readSeenIds(safeSessionStorage(), data.user.id));

      await poll();
      if (isCancelled) return;
      timer = setInterval(() => void poll(), POLL_INTERVAL_MS);
    })();

    return () => {
      isCancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [applyPoll]);

  // 포커스는 팝업이 열리는 순간에만 옮기고 닫힐 때 원래 자리로 되돌린다(폴링마다 뺏지 않는다).
  useEffect(() => {
    if (!isOpen) return;

    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
    const focusTarget = dialogRef.current?.querySelector<HTMLElement>("[data-autofocus]");
    focusTarget?.focus();
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = "";
      previouslyFocusedRef.current?.focus?.();
    };
  }, [isOpen]);

  const dismiss = useCallback(() => {
    // 읽음 처리는 하지 않는다. 종 알림에는 미확인으로 남는다.
    setQueue([]);
    setActionError("");
  }, []);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        dismiss();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable || focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, dismiss]);

  const storeLabelFor = useCallback(
    (notification: PopupNotification): string => {
      const storeId = storeIdFromTargetUrl(notification.targetUrl);
      return (storeId && storeNames.get(storeId)) || GENERIC_STORE_LABEL;
    },
    [storeNames],
  );

  const handleOpenQuestion = async (notification: PopupNotification) => {
    setBusyId(notification.id);
    setActionError("");

    try {
      const response = await fetch(`/api/notifications/${notification.id}/mark-read`, { method: "PUT" });
      if (!response.ok) {
        setActionError("알림을 읽음 처리하지 못했어요. 잠시 후 다시 시도해 주세요.");
        return;
      }
    } catch {
      setActionError("알림을 읽음 처리하지 못했어요. 잠시 후 다시 시도해 주세요.");
      return;
    } finally {
      setBusyId(null);
    }

    const action = resolveNotificationClick(notification);
    if (action.kind === "navigate") {
      setNavigationTarget(action.href);
      return;
    }
    if (action.kind === "notice") {
      setActionError(action.message);
      return;
    }
    dismiss();
  };

  const headingId = "escalation-popup-title";
  const bodyId = "escalation-popup-body";
  const items = useMemo(() => queue, [queue]);

  if (!isOpen) return null;

  return (
    <div role="presentation" className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        aria-describedby={bodyId}
        className="w-full max-w-md max-h-[85vh] overflow-y-auto rounded-2xl bg-white p-6 shadow-xl"
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 shrink-0 rounded-full bg-[var(--color-primary-light)]/30 p-2">
              <Bell size={18} className="text-[var(--color-primary)]" aria-hidden="true" />
            </span>
            <h2 id={headingId} className="text-lg font-bold text-[var(--color-text-primary)]">
              직원이 확인을 요청했어요
            </h2>
          </div>
          <button
            type="button"
            onClick={dismiss}
            aria-label="닫기"
            className="shrink-0 rounded-lg p-1 text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-surface)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
          >
            <X size={20} />
          </button>
        </div>

        <p id={bodyId} className="mb-4 text-sm text-[var(--color-text-secondary)]">
          매뉴얼에서 답을 찾지 못한 새 보류 질문 {items.length}건이 접수됐어요.
        </p>

        <ul className="mb-5 space-y-3">
          {items.map((notification) => (
            <li
              key={notification.id}
              className="rounded-lg border border-[var(--color-border)] p-3"
            >
              <p className="mb-2 break-words text-sm font-semibold text-[var(--color-text-primary)]">
                {storeLabelFor(notification)}
              </p>
              <button
                type="button"
                data-autofocus
                disabled={busyId === notification.id}
                onClick={() => void handleOpenQuestion(notification)}
                className="inline-flex min-h-[44px] items-center rounded-lg bg-[var(--color-primary)] px-4 text-sm font-medium text-white transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2 disabled:opacity-60"
              >
                {busyId === notification.id ? "여는 중..." : "질문 확인하기"}
              </button>
            </li>
          ))}
        </ul>

        {actionError && (
          <p role="alert" className="mb-4 text-sm text-red-600">
            {actionError}
          </p>
        )}

        <div className="flex justify-end">
          <button
            type="button"
            onClick={dismiss}
            className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-[var(--color-border)] bg-white px-4 text-sm font-medium text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-bg-surface)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2"
          >
            나중에
          </button>
        </div>
      </div>
    </div>
  );
}
