"use client";

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, Plus, Trash2, Upload, X } from "lucide-react";
import { Button } from "@/components/common/Button";
import { Input } from "@/components/common/Input";
import { createClient } from "@/lib/supabase/client";
import HQSidebar from "@/components/hq/HQSidebar";
import HQHeader from "@/components/hq/HQHeader";
import type { ManualRecord } from "@/lib/types/manual";

type ManualGroup = {
  id: string;
  title: string;
  items: ManualRecord[];
};

// 대시보드 카드는 parent_manual_id가 NULL인 최상위 매뉴얼만 표시하고,
// 하위 항목(parent_manual_id가 그 카드의 id와 일치하는 행)을 모달에서 보여준다.
// 하위 항목이 없는 최상위 매뉴얼(레거시/단건 등록 등)은 자기 자신을 유일한 항목으로 취급한다.
function groupByParent(manuals: ManualRecord[]): ManualGroup[] {
  const topLevel = manuals.filter((manual) => !manual.parent_manual_id);
  const childrenByParent = new Map<string, ManualRecord[]>();

  for (const manual of manuals) {
    if (!manual.parent_manual_id) continue;
    const list = childrenByParent.get(manual.parent_manual_id) ?? [];
    list.push(manual);
    childrenByParent.set(manual.parent_manual_id, list);
  }

  return topLevel.map((parent) => {
    const children = childrenByParent.get(parent.id) ?? [];
    return {
      id: parent.id,
      title: parent.title,
      items: children.length > 0 ? children : [parent],
    };
  });
}

export default function ManualDashboardPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [userName, setUserName] = useState("본사 관리자");
  const [franchiseName, setFranchiseName] = useState("메가MGC커피");
  const [isReady, setIsReady] = useState(false);
  const [manuals, setManuals] = useState<ManualRecord[]>([]);
  const [isLoadingManuals, setIsLoadingManuals] = useState(true);
  const [selectedGroup, setSelectedGroup] = useState<ManualGroup | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createTopic, setCreateTopic] = useState("");
  const [createItems, setCreateItems] = useState<{ id: string; content: string }[]>([
    { id: crypto.randomUUID(), content: "" },
  ]);
  const [createError, setCreateError] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [showDeleteAllConfirm, setShowDeleteAllConfirm] = useState(false);
  const [isDeletingAll, setIsDeletingAll] = useState(false);
  const [deleteAllError, setDeleteAllError] = useState("");
  const [toastMessage, setToastMessage] = useState("");

  const showToast = (message: string) => {
    setToastMessage(message);
    setTimeout(() => setToastMessage(""), 2500);
  };

  useLayoutEffect(() => {
    const checkAuth = async () => {
      try {
        const supabase = createClient();
        const { data } = await supabase.auth.getSession();

        if (!data.session?.user || data.session.user.user_metadata?.role !== "hq") {
          router.push("/");
          return;
        }
      } catch (e) {
        console.error("Auth check failed:", e);
        router.push("/");
      }
    };

    checkAuth();
  }, [router]);

  useEffect(() => {
    const setUserInfo = async () => {
      try {
        const supabase = createClient();
        const { data } = await supabase.auth.getSession();

        if (!data.session?.user) return;

        const name = data.session.user.user_metadata?.name;
        if (name) {
          setUserName(name);
          if (name.includes(" ")) {
            const [first] = name.split(" ");
            if (first) setFranchiseName(first);
          }
        }
      } finally {
        setIsReady(true);
      }
    };

    setUserInfo();
  }, []);

  // 상태를 전혀 건드리지 않는 순수 데이터 조회 함수 - useEffect에서 안전하게 호출하기 위해 분리.
  // 기존 동작과 동일하게, HTTP 오류 응답은 조용히 무시하고(에러 로그 없이) manuals를 갱신하지 않는다.
  const fetchManualsData = async (): Promise<ManualRecord[] | null> => {
    const response = await fetch("/api/manuals");
    const data = (await response.json()) as { manuals?: ManualRecord[]; error?: string };
    return response.ok ? data.manuals ?? [] : null;
  };

  // 마운트 시 로딩 표시는 isLoadingManuals의 초기값(true)으로 이미 처리되므로,
  // 재조회 시에만 로딩 상태를 다시 켠다(이벤트 핸들러에서 호출, effect 동기 구간과 무관).
  const refetchManuals = async () => {
    setIsLoadingManuals(true);
    try {
      const manuals = await fetchManualsData();
      if (manuals) {
        setManuals(manuals);
      }
    } catch (e) {
      console.error("매뉴얼 목록 조회 실패:", e);
    } finally {
      setIsLoadingManuals(false);
    }
  };

  useEffect(() => {
    fetchManualsData()
      .then((manuals) => {
        if (manuals) {
          setManuals(manuals);
        }
      })
      .catch((e) => console.error("매뉴얼 목록 조회 실패:", e))
      .finally(() => setIsLoadingManuals(false));
  }, []);

  const handleLogout = async () => {
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
      router.push("/");
    } catch (e) {
      console.error("Logout failed:", e);
      router.push("/");
    }
  };

  const groups = groupByParent(manuals);

  const handleFileSelected = async (file: File) => {
    setUploadError("");
    setIsUploading(true);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/manuals/upload", {
        method: "POST",
        body: formData,
      });
      const data = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(data.error || "매뉴얼 업로드 중 오류가 발생했습니다.");
      }

      await refetchManuals();
      showToast("매뉴얼이 업로드되었습니다.");
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : "매뉴얼 업로드 중 오류가 발생했습니다.");
    } finally {
      setIsUploading(false);
    }
  };

  const resetCreateForm = () => {
    setCreateTopic("");
    setCreateItems([{ id: crypto.randomUUID(), content: "" }]);
    setCreateError("");
  };

  const handleAddCreateItem = () => {
    setCreateItems((prev) => [...prev, { id: crypto.randomUUID(), content: "" }]);
  };

  const handleRemoveCreateItem = (id: string) => {
    setCreateItems((prev) => (prev.length > 1 ? prev.filter((item) => item.id !== id) : prev));
  };

  const handleCreateItemChange = (id: string, value: string) => {
    setCreateItems((prev) => prev.map((item) => (item.id === id ? { ...item, content: value } : item)));
  };

  const handleCreateSubmit = async () => {
    setCreateError("");

    const topic = createTopic.trim();
    const items = createItems.map((item) => item.content.trim()).filter(Boolean);

    if (!topic || items.length === 0) {
      setCreateError("주제와 세부 내용을 모두 입력해주세요.");
      return;
    }

    setIsCreating(true);

    try {
      const response = await fetch("/api/manuals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, items }),
      });
      const data = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(data.error || "매뉴얼 저장 중 오류가 발생했습니다.");
      }

      resetCreateForm();
      setShowCreateModal(false);
      await refetchManuals();
      showToast("매뉴얼이 생성되었습니다.");
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : "매뉴얼 저장 중 오류가 발생했습니다.");
    } finally {
      setIsCreating(false);
    }
  };

  const handleDeleteAll = async () => {
    setDeleteAllError("");
    setIsDeletingAll(true);

    try {
      const response = await fetch("/api/manuals", { method: "DELETE" });
      const data = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(data.error || "매뉴얼 전체 삭제 중 오류가 발생했습니다.");
      }

      setShowDeleteAllConfirm(false);
      await refetchManuals();
      showToast("등록된 모든 매뉴얼이 삭제되었습니다.");
    } catch (e) {
      setDeleteAllError(e instanceof Error ? e.message : "매뉴얼 전체 삭제 중 오류가 발생했습니다.");
    } finally {
      setIsDeletingAll(false);
    }
  };

  if (!isReady) {
    return null;
  }

  return (
    <div className="min-h-screen bg-[var(--color-bg-default)]">
      <HQSidebar
        userName={userName}
        franchiseName={franchiseName}
        onLogout={handleLogout}
        activeMenu="manual-common"
      />

      <div className="lg:ml-[240px]">
        <HQHeader userName={userName} franchiseName={franchiseName} />

        <main className="p-6 lg:p-8 max-w-7xl mx-auto">
          {/* Header */}
          <div className="mb-8">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h1 className="text-2xl font-bold text-[var(--color-text-primary)] mb-2">
                  공통 매뉴얼 관리
                </h1>
                <p className="text-base text-[var(--color-text-secondary)]">
                  모든 지점에서 공통으로 사용하는 본사 매뉴얼을 관리합니다.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="primary"
                  onClick={() => fileInputRef.current?.click()}
                  isLoading={isUploading}
                >
                  <Upload size={16} className="mr-2" /> 매뉴얼 파일 업로드
                </Button>
                <Button variant="primary" onClick={() => setShowCreateModal(true)}>
                  <Plus size={16} className="mr-2" /> 매뉴얼 추가
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv,.txt,.pdf"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (file) {
                      handleFileSelected(file);
                    }
                  }}
                />
              </div>
            </div>
          </div>

          {/* Toolbar with Info */}
          {!isLoadingManuals && (
            <div className="mb-6 flex items-center justify-between">
              <div className="text-sm text-[var(--color-text-secondary)]">
                전체 <span className="font-bold text-[var(--color-text-primary)]">{groups.length}</span>개
              </div>
              {manuals.length > 0 && (
                <button
                  onClick={() => {
                    setDeleteAllError("");
                    setShowDeleteAllConfirm(true);
                  }}
                  className="text-sm text-[var(--color-status-error)] hover:underline"
                >
                  전체 삭제
                </button>
              )}
            </div>
          )}

          {/* Content Area */}
          {isLoadingManuals ? (
            <p className="text-sm text-[var(--color-text-secondary)]">불러오는 중...</p>
          ) : groups.length === 0 ? (
            <div className="bg-white border border-[var(--color-border)] rounded-xl p-12 text-center shadow-sm">
              <div className="w-16 h-16 rounded-full bg-[var(--color-primary-light)] flex items-center justify-center mx-auto mb-4">
                <FileText size={32} className="text-[var(--color-primary)]" />
              </div>
              <p className="text-base text-[var(--color-text-secondary)] mb-2">
                등록된 공통 매뉴얼이 없습니다.
              </p>
              <p className="text-sm text-[var(--color-text-tertiary)] mb-6">
                모든 지점에서 사용할 첫 번째 매뉴얼을 등록해보세요.
              </p>
              <Button variant="primary" onClick={() => setShowCreateModal(true)}>
                <Plus size={16} className="mr-2" /> 첫 매뉴얼 등록하기
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {groups.map((group) => (
                <button
                  key={group.id}
                  onClick={() => setSelectedGroup(group)}
                  className="text-left bg-white border border-[var(--color-border)] rounded-xl p-6 shadow-sm hover:border-[var(--color-primary)] hover:shadow-md transition-all"
                >
                  <div className="w-10 h-10 rounded-lg bg-[var(--color-primary-light)] flex items-center justify-center mb-4">
                    <FileText size={20} className="text-[var(--color-primary)]" />
                  </div>
                  <p className="text-lg font-bold text-[var(--color-text-primary)] mb-1">
                    {group.title}
                  </p>
                  <p className="text-sm text-[var(--color-text-secondary)]">
                    {group.items.length}개 항목
                  </p>
                </button>
              ))}
            </div>
          )}

          {uploadError && (
            <p className="mt-4 text-sm text-[var(--color-status-error)]">{uploadError}</p>
          )}
        </main>
      </div>

      {/* Delete All Manuals Confirm Modal */}
      {showDeleteAllConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="bg-white rounded-xl shadow-lg w-full max-w-sm p-6">
            <h2 className="text-lg font-bold text-[var(--color-text-primary)] mb-2">
              매뉴얼 전체 삭제
            </h2>
            <p className="text-sm text-[var(--color-text-secondary)] mb-6">
              등록된 모든 매뉴얼을 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.
            </p>

            {deleteAllError && (
              <p className="mb-4 text-sm text-[var(--color-status-error)]">{deleteAllError}</p>
            )}

            <div className="flex items-center justify-end gap-2">
              <Button
                variant="ghost"
                onClick={() => setShowDeleteAllConfirm(false)}
                disabled={isDeletingAll}
              >
                취소
              </Button>
              <Button variant="danger" isLoading={isDeletingAll} onClick={handleDeleteAll}>
                전체 삭제
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Manual Create Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="bg-white rounded-xl shadow-lg w-full max-w-lg max-h-[85vh] overflow-y-auto p-6 relative">
            <button
              onClick={() => {
                setShowCreateModal(false);
                resetCreateForm();
              }}
              className="absolute top-4 right-4 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]"
              aria-label="닫기"
            >
              <X size={20} />
            </button>

            <h2 className="text-lg font-bold text-[var(--color-text-primary)] mb-6">
              매뉴얼 직접 작성
            </h2>

            <div className="space-y-4">
              <Input
                label="주제"
                placeholder="예: 화장실 청소 관리법"
                value={createTopic}
                onChange={(e) => setCreateTopic(e.target.value)}
              />

              <div className="space-y-3">
                {createItems.map((item, index) => (
                  <div key={item.id} className="flex items-start gap-2">
                    <div className="flex-1">
                      <label className="mb-2 block text-sm font-semibold text-[var(--color-text-primary)]">
                        내용 {index + 1}
                      </label>
                      <textarea
                        value={item.content}
                        onChange={(e) => handleCreateItemChange(item.id, e.target.value)}
                        rows={3}
                        className="w-full px-4 py-3 rounded-lg border-2 border-[var(--color-border)] text-base text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-primary-accent)] focus:ring-2 focus:ring-[var(--color-primary-accent)]/30"
                      />
                    </div>
                    {createItems.length > 1 && (
                      <button
                        type="button"
                        onClick={() => handleRemoveCreateItem(item.id)}
                        className="mt-8 p-2 rounded-lg text-[var(--color-text-tertiary)] hover:text-[var(--color-status-error)] hover:bg-red-50 transition-colors"
                        aria-label="내용 항목 삭제"
                      >
                        <Trash2 size={18} />
                      </button>
                    )}
                  </div>
                ))}

                <button
                  type="button"
                  onClick={handleAddCreateItem}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg border-2 border-dashed border-[var(--color-border)] text-sm font-semibold text-[var(--color-text-secondary)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] transition-colors"
                >
                  <Plus size={16} /> 내용 항목 추가
                </button>
              </div>

              {createError && (
                <p className="text-sm text-[var(--color-status-error)]">{createError}</p>
              )}

              <Button
                variant="primary"
                className="w-full"
                isLoading={isCreating}
                onClick={handleCreateSubmit}
              >
                저장
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Manual Detail / Edit Modal */}
      {selectedGroup && (
        <ManualGroupModal
          group={selectedGroup}
          onClose={() => setSelectedGroup(null)}
          onSaved={async (message) => {
            await refetchManuals();
            showToast(message);
          }}
        />
      )}

      {/* Toast */}
      {toastMessage && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] bg-[var(--color-text-primary)] text-white text-sm font-medium px-5 py-3 rounded-lg shadow-lg">
          {toastMessage}
        </div>
      )}
    </div>
  );
}

type EditableItem = {
  id: string;
  title: string;
  content: string;
  isNew?: boolean;
};

function ManualGroupModal({
  group,
  onClose,
  onSaved,
}: {
  group: ManualGroup;
  onClose: () => void;
  onSaved: (message: string) => Promise<void>;
}) {
  const [topic, setTopic] = useState(group.title);
  const [isSavingTopic, setIsSavingTopic] = useState(false);
  const [items, setItems] = useState<EditableItem[]>(
    group.items.map((item) => ({ id: item.id, title: item.title, content: item.content })),
  );
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isSavingAll, setIsSavingAll] = useState(false);
  const [isDeletingSelected, setIsDeletingSelected] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState("");

  const allSelected = items.length > 0 && selectedIds.size === items.length;

  const handleChange = (id: string, value: string) => {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, content: value } : item)));
  };

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelectedIds(allSelected ? new Set() : new Set(items.map((item) => item.id)));
  };

  const handleAddItem = () => {
    setItems((prev) => [...prev, { id: `new-${crypto.randomUUID()}`, title: "", content: "", isNew: true }]);
  };

  const handleSaveTopic = async () => {
    const trimmed = topic.trim();

    if (!trimmed) {
      setError("주제를 입력해주세요.");
      return;
    }

    setIsSavingTopic(true);
    setError("");

    try {
      const response = await fetch(`/api/manuals/${group.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: trimmed, category: trimmed }),
      });
      const data = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(data.error || "주제 저장 중 오류가 발생했습니다.");
      }

      await onSaved("주제가 저장되었습니다.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "주제 저장 중 오류가 발생했습니다.");
    } finally {
      setIsSavingTopic(false);
    }
  };

  const handleSaveAll = async () => {
    setIsSavingAll(true);
    setError("");

    try {
      const existingItems = items.filter((item) => !item.isNew);
      const newItems = items.filter((item) => item.isNew && item.content.trim());

      if (existingItems.length > 0) {
        const response = await fetch("/api/manuals/batch-update", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            manuals: existingItems.map((item) => ({ id: item.id, title: item.title, content: item.content })),
          }),
        });
        const data = (await response.json()) as { error?: string };

        if (!response.ok) {
          throw new Error(data.error || "일괄 저장 중 오류가 발생했습니다.");
        }
      }

      if (newItems.length > 0) {
        const response = await fetch(`/api/manuals/${group.id}/items`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items: newItems.map((item) => item.content.trim()) }),
        });
        const data = (await response.json()) as { manuals?: ManualRecord[]; error?: string };

        if (!response.ok) {
          throw new Error(data.error || "새 내용 항목 저장 중 오류가 발생했습니다.");
        }

        const created = data.manuals ?? [];
        setItems((prev) => {
          let createdIndex = 0;
          return prev.map((item) => {
            if (item.isNew && item.content.trim() && createdIndex < created.length) {
              const record = created[createdIndex];
              createdIndex += 1;
              return { id: record.id, title: record.title, content: record.content };
            }
            return item;
          });
        });
      }

      await onSaved("변경사항이 모두 저장되었습니다.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "일괄 저장 중 오류가 발생했습니다.");
    } finally {
      setIsSavingAll(false);
    }
  };

  const handleDeleteSelected = async () => {
    if (selectedIds.size === 0) {
      setError("삭제할 항목을 선택해주세요.");
      return;
    }

    setIsDeletingSelected(true);
    setError("");

    try {
      const selectedItems = items.filter((item) => selectedIds.has(item.id));
      const persistedIds = selectedItems.filter((item) => !item.isNew).map((item) => item.id);

      if (persistedIds.length > 0) {
        const response = await fetch("/api/manuals/batch-delete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: persistedIds }),
        });
        const data = (await response.json()) as { error?: string };

        if (!response.ok) {
          throw new Error(data.error || "일괄 삭제 중 오류가 발생했습니다.");
        }
      }

      setConfirmDelete(false);
      await onSaved("선택한 항목이 삭제되었습니다.");

      const remaining = items.filter((item) => !selectedIds.has(item.id));
      setItems(remaining);
      setSelectedIds(new Set());

      if (remaining.length === 0) {
        onClose();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "일괄 삭제 중 오류가 발생했습니다.");
    } finally {
      setIsDeletingSelected(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="bg-white rounded-xl shadow-lg w-full max-w-2xl max-h-[85vh] overflow-y-auto p-6 relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]"
          aria-label="닫기"
        >
          <X size={20} />
        </button>

        <div className="flex items-end gap-3 mb-4">
          <div className="flex-1">
            <Input label="주제" value={topic} onChange={(e) => setTopic(e.target.value)} />
          </div>
          <Button variant="outline" size="sm" isLoading={isSavingTopic} onClick={handleSaveTopic}>
            주제 저장
          </Button>
        </div>

        {/* 일괄 컨트롤 액션 바 */}
        <div className="flex items-center justify-between gap-3 mb-4 p-3 bg-[var(--color-bg-surface)] border border-[var(--color-border)] rounded-lg">
          <label className="flex items-center gap-2 text-sm font-medium text-[var(--color-text-primary)] cursor-pointer">
            <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} />
            전체 선택 ({selectedIds.size}/{items.length})
          </label>
          <div className="flex items-center gap-2">
            {confirmDelete ? (
              <>
                <span className="text-sm text-[var(--color-status-error)]">선택한 항목을 삭제할까요?</span>
                <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
                  취소
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  isLoading={isDeletingSelected}
                  onClick={handleDeleteSelected}
                >
                  삭제 확정
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={selectedIds.size === 0}
                  onClick={() => setConfirmDelete(true)}
                >
                  선택 삭제
                </Button>
                <Button variant="primary" size="sm" isLoading={isSavingAll} onClick={handleSaveAll}>
                  전체 저장
                </Button>
              </>
            )}
          </div>
        </div>

        {error && <p className="mb-4 text-sm text-[var(--color-status-error)]">{error}</p>}

        <div className="space-y-4">
          {items.map((item, index) => (
            <div key={item.id} className="border border-[var(--color-border)] rounded-lg p-4">
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  className="mt-3.5 flex-shrink-0"
                  checked={selectedIds.has(item.id)}
                  onChange={() => toggleSelected(item.id)}
                  aria-label="세부 내용 선택"
                />
                <div className="flex-1">
                  <label className="mb-2 block text-sm font-semibold text-[var(--color-text-primary)]">
                    내용 {index + 1}
                  </label>
                  <textarea
                    value={item.content}
                    onChange={(e) => handleChange(item.id, e.target.value)}
                    rows={4}
                    className="w-full px-4 py-3 rounded-lg border-2 border-[var(--color-border)] text-base text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-primary-accent)] focus:ring-2 focus:ring-[var(--color-primary-accent)]/30"
                  />
                </div>
              </div>
            </div>
          ))}

          <button
            type="button"
            onClick={handleAddItem}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg border-2 border-dashed border-[var(--color-border)] text-sm font-semibold text-[var(--color-text-secondary)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] transition-colors"
          >
            <Plus size={16} /> 내용 항목 추가
          </button>
        </div>
      </div>
    </div>
  );
}

