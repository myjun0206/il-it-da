"use client";

import React, { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, ChevronRight, X, BookOpen, Plus, Edit2, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import OwnerSidebar from "@/components/owner/OwnerSidebar";
import OwnerHeader from "@/components/owner/OwnerHeader";
import { Input } from "@/components/common/Input";
import type { ManualRecord } from "@/lib/types/manual";

type ManualGroup = {
  id: string;
  title: string;
  items: ManualRecord[];
  updatedAt: string;
};

type SortOption = "recent" | "oldest" | "name";

type ModalMode = "create" | "edit" | null;
type DialogMode = "delete" | null;

type FormState = {
  title: string;
  items: string[];
};

// 부모/자식 구조로 매뉴얼을 그룹화
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
      updatedAt: parent.updated_at,
    };
  });
}

// 날짜 포맷팅
function formatDate(dateString: string | null | undefined): string {
  if (!dateString) return "";
  try {
    const date = new Date(dateString);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}.${month}.${day}`;
  } catch {
    return "";
  }
}

// 정렬 함수
function sortGroups(groups: ManualGroup[], sortBy: SortOption): ManualGroup[] {
  const sorted = [...groups];
  if (sortBy === "recent") {
    sorted.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  } else if (sortBy === "oldest") {
    sorted.sort((a, b) => new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime());
  } else if (sortBy === "name") {
    sorted.sort((a, b) => a.title.localeCompare(b.title, "ko"));
  }
  return sorted;
}

export default function StoreManualsManagemntPage() {
  const router = useRouter();
  const [isReady, setIsReady] = useState(false);
  const [userName, setUserName] = useState("");
  const [storeName, setStoreName] = useState("");
  const [selectedStoreId, setSelectedStoreId] = useState("");
  const [manuals, setManuals] = useState<ManualRecord[]>([]);
  const [isLoadingManuals, setIsLoadingManuals] = useState(true);
  const [error, setError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<SortOption>("recent");
  const [selectedGroup, setSelectedGroup] = useState<ManualGroup | null>(null);
  const [toastMessage, setToastMessage] = useState("");
  const [modalMode, setModalMode] = useState<ModalMode>(null);
  const [dialogMode, setDialogMode] = useState<DialogMode>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [formState, setFormState] = useState<FormState>({ title: "", items: [""] });

  // Auth 확인
  useLayoutEffect(() => {
    const checkAuth = async () => {
      try {
        const supabase = createClient();
        const { data } = await supabase.auth.getSession();

        if (!data.session?.user || data.session.user.user_metadata?.role !== "owner") {
          router.push("/");
          return;
        }

        setIsReady(true);
      } catch (e) {
        console.error("Auth check failed:", e);
        router.push("/");
      }
    };

    checkAuth();
  }, [router]);

  // 사용자 정보 로드 및 지점 검증
  useEffect(() => {
    const loadUserAndStoreInfo = async () => {
      try {
        const supabase = createClient();
        const { data } = await supabase.auth.getSession();

        if (!data.session?.user) return;

        const name = data.session.user.user_metadata?.name || "점주";
        setUserName(name);

        // sessionStorage에서 선택된 지점 정보 가져오기
        const storedStoreId = sessionStorage.getItem("selectedStoreId") || "";
        const storedStoreName = sessionStorage.getItem("selectedStoreName") || "";

        // 서버에서 승인된 지점 목록 조회 및 검증
        try {
          const response = await fetch("/api/signup/store-membership");
          const result = (await response.json()) as {
            success?: boolean;
            data?: Array<{ storeId: string; storeName: string; status: string; role: string }>;
          };

          if (response.ok && result.data) {
            const approvedStores = result.data.filter(
              (m) => m.status === "approved" && m.role === "owner",
            );

            if (approvedStores.length === 0) {
              setError("승인된 지점이 없습니다.");
              return;
            }

            // sessionStorage의 storeId가 유효한지 확인
            const isValidStore = approvedStores.some((s) => s.storeId === storedStoreId);

            if (isValidStore) {
              setSelectedStoreId(storedStoreId);
              setStoreName(storedStoreName || "선택된 지점");
            } else {
              // 첫 번째 승인된 지점으로 초기화
              setSelectedStoreId(approvedStores[0].storeId);
              setStoreName(approvedStores[0].storeName);
              sessionStorage.setItem("selectedStoreId", approvedStores[0].storeId);
              sessionStorage.setItem("selectedStoreName", approvedStores[0].storeName);
            }
          }
        } catch (e) {
          console.error("Failed to load store memberships:", e);
          setError("지점 정보를 불러올 수 없습니다.");
        }
      } catch (e) {
        console.error("Failed to load user info:", e);
      }
    };

    if (isReady) {
      loadUserAndStoreInfo();
    }
  }, [isReady]);

  // 매뉴얼 조회
  const fetchManuals = useCallback(async () => {
    if (!selectedStoreId) return;

    setIsLoadingManuals(true);
    setError("");
    try {
      const response = await fetch(`/api/store-manuals?storeId=${selectedStoreId}`);
      const data = (await response.json()) as { manuals?: ManualRecord[]; error?: string };

      if (!response.ok || !data.manuals) {
        throw new Error(data.error || "매뉴얼 목록을 불러오지 못했습니다.");
      }

      setManuals(data.manuals);
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : "매뉴얼 목록을 불러오지 못했습니다.";
      setError(errorMsg);
      console.error("Failed to fetch manuals:", e);
    } finally {
      setIsLoadingManuals(false);
    }
  }, [selectedStoreId]);

  // 초기 로드
  useEffect(() => {
    if (isReady && selectedStoreId) {
      const loadData = async () => {
        await fetchManuals();
      };
      void loadData();
    }
  }, [isReady, selectedStoreId, fetchManuals]);

  // 토스트 메시지
  const showToast = (message: string) => {
    setToastMessage(message);
    setTimeout(() => setToastMessage(""), 2500);
  };

  // 매뉴얼 그룹화
  const groups = groupByParent(manuals);

  // 검색 필터링
  const filteredGroups = groups.filter((group) => {
    const query = searchQuery.toLowerCase().trim();
    if (!query) return true;

    return (
      group.title.toLowerCase().includes(query) ||
      group.items.some((item) => item.content?.toLowerCase().includes(query))
    );
  });

  // 정렬 적용
  const sortedAndFilteredGroups = sortGroups(filteredGroups, sortBy);

  // 등록 모달 열기
  const handleOpenCreateModal = () => {
    setFormState({ title: "", items: [""] });
    setModalMode("create");
  };

  // 수정 모달 열기
  const handleOpenEditModal = (group: ManualGroup) => {
    const itemContents = group.items.map((item) => item.content || "");
    setFormState({
      title: group.title,
      items: itemContents.length > 0 ? itemContents : [""],
    });
    setModalMode("edit");
  };

  // 삭제 확인 다이얼로그 열기
  const handleOpenDeleteDialog = (group: ManualGroup) => {
    setDeleteTargetId(group.id);
    setDialogMode("delete");
  };

  // 모달/다이얼로그 닫기
  const closeModal = () => setModalMode(null);
  const closeDialog = () => {
    setDialogMode(null);
    setDeleteTargetId(null);
  };

  // 항목 추가
  const handleAddItem = () => {
    setFormState((prev) => ({
      ...prev,
      items: [...prev.items, ""],
    }));
  };

  // 항목 삭제
  const handleRemoveItem = (index: number) => {
    setFormState((prev) => ({
      ...prev,
      items: prev.items.filter((_, i) => i !== index),
    }));
  };

  // 항목 내용 변경
  const handleItemChange = (index: number, value: string) => {
    setFormState((prev) => {
      const newItems = [...prev.items];
      newItems[index] = value;
      return { ...prev, items: newItems };
    });
  };

  // 매뉴얼 저장 (생성 또는 수정)
  const handleSaveManual = async () => {
    const trimmedTitle = formState.title.trim();
    const validItems = formState.items.filter((item) => item.trim());

    if (!trimmedTitle) {
      showToast("제목을 입력해주세요.");
      return;
    }

    if (validItems.length === 0) {
      showToast("최소 1개 이상의 업무 내용을 입력해주세요.");
      return;
    }

    setIsProcessing(true);

    try {
      if (modalMode === "create") {
        // 생성
        const response = await fetch("/api/store-manuals", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            topic: trimmedTitle,
            items: validItems,
            storeId: selectedStoreId,
          }),
        });

        const data = (await response.json()) as { manuals?: ManualRecord[]; error?: string };

        if (!response.ok) {
          throw new Error(data.error || "매뉴얼 저장 중 오류가 발생했습니다.");
        }

        showToast("매뉴얼이 등록되었습니다.");
      } else if (modalMode === "edit") {
        // 수정 (선택된 그룹의 부모 id 사용)
        if (!selectedGroup) {
          throw new Error("수정할 매뉴얼을 찾을 수 없습니다.");
        }

        const response = await fetch(`/api/store-manuals/${selectedGroup.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            storeId: selectedStoreId,
            title: trimmedTitle,
            items: validItems,
          }),
        });

        const data = (await response.json()) as { manual?: ManualRecord; error?: string };

        if (!response.ok) {
          throw new Error(data.error || "매뉴얼 수정 중 오류가 발생했습니다.");
        }

        showToast("매뉴얼이 수정되었습니다.");
        setSelectedGroup(null);
      }

      closeModal();
      await fetchManuals();
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : "작업 중 오류가 발생했습니다.";
      showToast(errorMsg);
      console.error("Failed to save manual:", e);
    } finally {
      setIsProcessing(false);
    }
  };

  // 매뉴얼 삭제
  const handleDeleteManual = async () => {
    if (!deleteTargetId) return;

    setIsProcessing(true);

    try {
      const response = await fetch(`/api/store-manuals/${deleteTargetId}?storeId=${selectedStoreId}`, {
        method: "DELETE",
      });

      const data = (await response.json()) as { success?: boolean; error?: string };

      if (!response.ok) {
        throw new Error(data.error || "매뉴얼 삭제 중 오류가 발생했습니다.");
      }

      showToast("매뉴얼이 삭제되었습니다.");
      closeDialog();
      await fetchManuals();
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : "삭제 중 오류가 발생했습니다.";
      showToast(errorMsg);
      console.error("Failed to delete manual:", e);
    } finally {
      setIsProcessing(false);
    }
  };

  // 로그아웃 핸들러
  const handleLogout = async () => {
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
      router.push("/");
    } catch (e) {
      console.error("Logout failed:", e);
      showToast("로그아웃 중 오류가 발생했습니다.");
    }
  };

  if (!isReady) {
    return null;
  }

  return (
    <div className="min-h-screen bg-[var(--color-bg-default)]">
      <OwnerSidebar activeMenu="manual-store" onLogout={handleLogout} />

      <div className="lg:ml-[240px]">
        <OwnerHeader userName={userName} storeName={storeName} />

        <main className="p-6 lg:p-8">
          <div className="max-w-6xl mx-auto">
            {/* 페이지 제목 영역 */}
            <div className="mb-6">
              <h1 className="text-2xl font-bold text-[var(--color-text-primary)] mb-2">
                지점 매뉴얼 관리
              </h1>
              <p className="text-base text-[var(--color-text-secondary)]">
                현재 매장에서 사용하는 업무 매뉴얼을 등록하고 관리하세요.
              </p>
            </div>

            {/* 현재 매장 정보 및 등록 버튼 */}
            <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <p className="text-sm text-[var(--color-text-secondary)] mb-1">현재 매장</p>
                <p className="text-lg font-semibold text-[var(--color-text-primary)]">{storeName}</p>
              </div>
              <button
                onClick={handleOpenCreateModal}
                disabled={isLoadingManuals}
                className="flex items-center justify-center gap-2 px-4 py-3 bg-[var(--color-primary)] text-white rounded-lg font-medium hover:bg-[var(--color-primary)]/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <Plus size={20} />
                <span>새 매뉴얼 등록</span>
              </button>
            </div>

            {/* 검색 영역 */}
            <div className="mb-6">
              <div className="relative">
                <Search
                  size={20}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-secondary)]"
                />
                <Input
                  type="text"
                  placeholder="매뉴얼을 검색해보세요."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  disabled={isLoadingManuals}
                  className="pl-10 h-12"
                />
              </div>
            </div>

            {/* 정보/정렬 툴바 */}
            {!isLoadingManuals && manuals.length > 0 && (
              <div className="mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div className="text-sm text-[var(--color-text-secondary)]">
                  {searchQuery.trim()
                    ? `검색 결과 ${sortedAndFilteredGroups.length}개`
                    : `전체 매뉴얼 ${groups.length}개`}
                </div>
                <div className="flex items-center gap-3">
                  <label className="text-sm text-[var(--color-text-secondary)] hidden sm:inline">
                    정렬:
                  </label>
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as SortOption)}
                    className="px-3 py-2 border-2 border-[var(--color-border)] rounded-lg text-sm text-[var(--color-text-primary)] bg-white hover:border-[var(--color-primary)] focus:outline-none focus:border-[var(--color-primary)] focus:ring-2 focus:ring-[var(--color-primary)]/30 transition-colors"
                  >
                    <option value="recent">최근 업데이트순</option>
                    <option value="oldest">오래된 업데이트순</option>
                    <option value="name">이름순</option>
                  </select>
                </div>
              </div>
            )}

            {/* 에러 상태 */}
            {error && !isLoadingManuals && (
              <div className="mb-8 p-4 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-sm text-red-600">{error}</p>
              </div>
            )}

            {/* 로딩 상태 */}
            {isLoadingManuals && (
              <div className="flex flex-col items-center justify-center py-12">
                <div className="w-8 h-8 border-3 border-[var(--color-border)] border-t-[var(--color-primary)] rounded-full animate-spin" />
                <p className="mt-4 text-[var(--color-text-secondary)]">매뉴얼 로딩 중...</p>
              </div>
            )}

            {/* 빈 상태 */}
            {!isLoadingManuals && manuals.length === 0 && !error && (
              <div className="flex flex-col items-center justify-center py-12">
                <BookOpen size={48} className="text-[var(--color-border)] mb-4" />
                <p className="text-base font-semibold text-[var(--color-text-primary)] mb-2">
                  등록된 지점 매뉴얼이 없습니다.
                </p>
                <p className="text-sm text-[var(--color-text-secondary)] mb-6">
                  이 매장에서 사용하는 업무 매뉴얼을
                </p>
                <p className="text-sm text-[var(--color-text-secondary)] mb-8">
                  직접 등록해보세요.
                </p>
                <button
                  onClick={handleOpenCreateModal}
                  className="flex items-center gap-2 px-4 py-2 bg-[var(--color-primary)] text-white rounded-lg font-medium hover:bg-[var(--color-primary)]/90 transition-colors"
                >
                  <Plus size={18} />
                  <span>첫 매뉴얼 등록</span>
                </button>
              </div>
            )}

            {/* 검색 결과 없음 */}
            {!isLoadingManuals && manuals.length > 0 && sortedAndFilteredGroups.length === 0 && (
              <div className="flex flex-col items-center justify-center py-12">
                <Search size={48} className="text-[var(--color-border)] mb-4" />
                <p className="text-base font-semibold text-[var(--color-text-primary)] mb-2">
                  검색 결과가 없습니다.
                </p>
                <p className="text-sm text-[var(--color-text-secondary)]">
                  다른 검색어로 다시 찾아보세요.
                </p>
              </div>
            )}

            {/* 매뉴얼 카드 목록 */}
            {!isLoadingManuals && sortedAndFilteredGroups.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {sortedAndFilteredGroups.map((group) => (
                  <div
                    key={group.id}
                    className="flex flex-col p-6 bg-white border-2 border-[var(--color-border)] rounded-lg hover:border-[var(--color-primary)] transition-all duration-200"
                  >
                    <div className="flex-1">
                      <div className="flex items-start justify-between gap-4 mb-4">
                        <div className="flex-1 min-w-0">
                          <h3 className="text-lg font-semibold text-[var(--color-text-primary)] truncate">
                            {group.title}
                          </h3>
                        </div>
                      </div>
                      <div className="space-y-2 mb-4">
                        <p className="text-sm text-[var(--color-text-secondary)]">
                          하위 항목 {group.items.length}개
                        </p>
                        {formatDate(group.updatedAt) && (
                          <p className="text-xs text-[var(--color-text-secondary)]">
                            최근 업데이트 {formatDate(group.updatedAt)}
                          </p>
                        )}
                      </div>
                      <button
                        onClick={() => setSelectedGroup(group)}
                        className="text-sm text-[var(--color-primary)] font-medium hover:underline"
                      >
                        자세히 보기 →
                      </button>
                    </div>

                    {/* 액션 버튼 */}
                    <div className="mt-6 pt-6 border-t border-[var(--color-border)] flex gap-2">
                      <button
                        onClick={() => handleOpenEditModal(group)}
                        disabled={isProcessing}
                        className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-[var(--color-primary)]/10 text-[var(--color-primary)] rounded-lg font-medium hover:bg-[var(--color-primary)]/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        <Edit2 size={16} />
                        <span>수정</span>
                      </button>
                      <button
                        onClick={() => handleOpenDeleteDialog(group)}
                        disabled={isProcessing}
                        className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-red-50 text-red-600 rounded-lg font-medium hover:bg-red-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        <Trash2 size={16} />
                        <span>삭제</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </main>
      </div>

      {/* 상세 보기 모달 */}
      {selectedGroup && !modalMode && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center">
          <div className="bg-white w-full sm:max-w-2xl sm:rounded-lg rounded-t-lg max-h-[90vh] overflow-y-auto">
            {/* 헤더 */}
            <div className="sticky top-0 bg-white border-b border-[var(--color-border)] p-6 flex items-center justify-between">
              <h2 className="text-xl font-bold text-[var(--color-text-primary)] truncate">
                {selectedGroup.title}
              </h2>
              <button
                onClick={() => setSelectedGroup(null)}
                className="flex-shrink-0 ml-4 p-2 hover:bg-[var(--color-bg-surface)] rounded-lg transition-colors"
              >
                <X size={24} className="text-[var(--color-text-secondary)]" />
              </button>
            </div>

            {/* 내용 */}
            <div className="p-6">
              {selectedGroup.items.map((item, index) => (
                <div
                  key={item.id}
                  className={index > 0 ? "mt-8 pt-8 border-t border-[var(--color-border)]" : ""}
                >
                  {item.title && item.title !== selectedGroup.title && (
                    <h4 className="text-base font-semibold text-[var(--color-text-primary)] mb-3">
                      {item.title}
                    </h4>
                  )}
                  <div className="text-sm text-[var(--color-text-secondary)] leading-relaxed whitespace-pre-wrap">
                    {item.content}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 등록/수정 모달 */}
      {modalMode && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center">
          <div className="bg-white w-full sm:max-w-2xl sm:rounded-lg rounded-t-lg max-h-[90vh] overflow-y-auto">
            {/* 헤더 */}
            <div className="sticky top-0 bg-white border-b border-[var(--color-border)] p-6 flex items-center justify-between">
              <h2 className="text-xl font-bold text-[var(--color-text-primary)]">
                {modalMode === "create" ? "새 매뉴얼 등록" : "매뉴얼 수정"}
              </h2>
              <button
                onClick={closeModal}
                disabled={isProcessing}
                className="flex-shrink-0 ml-4 p-2 hover:bg-[var(--color-bg-surface)] rounded-lg transition-colors disabled:opacity-50"
              >
                <X size={24} className="text-[var(--color-text-secondary)]" />
              </button>
            </div>

            {/* 폼 내용 */}
            <div className="p-6">
              {/* 제목 입력 */}
              <div className="mb-6">
                <label className="block text-sm font-semibold text-[var(--color-text-primary)] mb-2">
                  제목
                </label>
                <input
                  type="text"
                  value={formState.title}
                  onChange={(e) =>
                    setFormState((prev) => ({ ...prev, title: e.target.value }))
                  }
                  placeholder="매뉴얼 제목을 입력하세요"
                  disabled={isProcessing}
                  className="w-full px-4 py-3 border-2 border-[var(--color-border)] rounded-lg text-[var(--color-text-primary)] placeholder-[var(--color-text-secondary)] focus:outline-none focus:border-[var(--color-primary)] focus:ring-2 focus:ring-[var(--color-primary)]/30 transition-colors disabled:opacity-50"
                />
              </div>

              {/* 업무 내용 입력 */}
              <div className="mb-6">
                <label className="block text-sm font-semibold text-[var(--color-text-primary)] mb-2">
                  세부 업무 내용
                </label>
                <div className="space-y-3">
                  {formState.items.map((item, index) => (
                    <div key={index} className="flex gap-2">
                      <span className="flex-shrink-0 flex items-center justify-center w-8 h-10 text-sm font-medium text-[var(--color-text-secondary)]">
                        {index + 1}.
                      </span>
                      <div className="flex-1 flex gap-2">
                        <input
                          type="text"
                          value={item}
                          onChange={(e) => handleItemChange(index, e.target.value)}
                          placeholder={`업무 내용 ${index + 1}`}
                          disabled={isProcessing}
                          className="flex-1 px-4 py-3 border-2 border-[var(--color-border)] rounded-lg text-[var(--color-text-primary)] placeholder-[var(--color-text-secondary)] focus:outline-none focus:border-[var(--color-primary)] focus:ring-2 focus:ring-[var(--color-primary)]/30 transition-colors disabled:opacity-50"
                        />
                        {formState.items.length > 1 && (
                          <button
                            onClick={() => handleRemoveItem(index)}
                            disabled={isProcessing}
                            className="px-3 py-3 text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                          >
                            <Trash2 size={18} />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {/* 항목 추가 버튼 */}
                <button
                  onClick={handleAddItem}
                  disabled={isProcessing}
                  className="mt-4 px-4 py-2 text-[var(--color-primary)] font-medium hover:bg-[var(--color-primary)]/10 rounded-lg transition-colors disabled:opacity-50"
                >
                  + 내용 항목 추가
                </button>
              </div>
            </div>

            {/* 푸터 */}
            <div className="sticky bottom-0 bg-white border-t border-[var(--color-border)] p-6 flex gap-3">
              <button
                onClick={closeModal}
                disabled={isProcessing}
                className="flex-1 px-4 py-3 border-2 border-[var(--color-border)] text-[var(--color-text-primary)] rounded-lg font-medium hover:bg-[var(--color-bg-surface)] transition-colors disabled:opacity-50"
              >
                취소
              </button>
              <button
                onClick={handleSaveManual}
                disabled={isProcessing}
                className="flex-1 px-4 py-3 bg-[var(--color-primary)] text-white rounded-lg font-medium hover:bg-[var(--color-primary)]/90 disabled:opacity-50 transition-colors"
              >
                {isProcessing ? "저장 중..." : "저장"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 삭제 확인 다이얼로그 */}
      {dialogMode === "delete" && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
          <div className="bg-white w-full max-w-sm rounded-lg p-6 mx-6 space-y-4">
            <h3 className="text-lg font-bold text-[var(--color-text-primary)]">
              이 매뉴얼을 삭제하시겠습니까?
            </h3>
            <p className="text-sm text-[var(--color-text-secondary)]">
              삭제한 매뉴얼은 복구할 수 없습니다.
            </p>
            <div className="flex gap-3 pt-4">
              <button
                onClick={closeDialog}
                disabled={isProcessing}
                className="flex-1 px-4 py-3 border-2 border-[var(--color-border)] text-[var(--color-text-primary)] rounded-lg font-medium hover:bg-[var(--color-bg-surface)] transition-colors disabled:opacity-50"
              >
                취소
              </button>
              <button
                onClick={handleDeleteManual}
                disabled={isProcessing}
                className="flex-1 px-4 py-3 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 disabled:opacity-50 transition-colors"
              >
                {isProcessing ? "삭제 중..." : "삭제"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 토스트 메시지 */}
      {toastMessage && (
        <div className="fixed bottom-6 left-6 right-6 sm:left-auto sm:right-6 sm:w-auto bg-[var(--color-text-primary)] text-white px-4 py-3 rounded-lg text-sm">
          {toastMessage}
        </div>
      )}
    </div>
  );
}
