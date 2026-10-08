"use client";

import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, ArrowLeft, FileText, Pencil, Plus, RefreshCw, Search, Sparkles, Store, Trash2, X } from "lucide-react";
import { Button } from "@/components/common/Button";
import { Input } from "@/components/common/Input";
import { createClient } from "@/lib/supabase/client";
import { getAuthenticatedProfile } from "@/lib/auth/client-profile";
import OwnerSidebar from "@/components/owner/OwnerSidebar";
import OwnerHeader from "@/components/owner/OwnerHeader";
import { ManualPreviewEditor, type ManualEditState } from "@/components/manuals/ManualPreviewEditor";
import type { ManualRecord } from "@/lib/types/manual";
import { resolveOwnerCurrentStore } from "@/lib/owner/current-store";
import { buildBossQuestionDetailUrl, pickQuestionsStore } from "@/lib/owner/boss-questions-view";
import { validateManualEdit } from "@/lib/manuals/validate-manual-edit";
import { manualSaveMessage } from "@/lib/manuals/manual-save-result";
import type { ManualEditSearchStatus } from "@/lib/manuals/save-store-manual-edit";
import { buildConfirmedManualsPayload, type ManualUploadPreview } from "@/lib/manuals/build-manual-preview";

type ManualGroup = {
  id: string;
  category: string;
  title: string;
  items: ManualRecord[];
};

type ManualCategory = {
  category: string;
  groups: ManualGroup[];
  itemCount: number;
};

type ManualView = "categories" | "titles" | "items";

const SUPPORTED_ANALYZE_EXTENSIONS = [".txt", ".md", ".docx", ".csv", ".xlsx", ".xls"];

const STORE_MANUAL_CATEGORY_PLACEHOLDER_CONTENT = "__STORE_MANUAL_CATEGORY_PLACEHOLDER__";
const UUID_LIKE_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const INTERNAL_ID_LIKE_PATTERN = /^[A-Za-z0-9_-]{16,}$/;
const STORE_REINDEX_URL = "/api/store-manuals/search-readiness/reindex";

// 저장 응답의 searchResults 중 검색 반영이 실패했거나 확인되지 않은 항목만 다시 처리 대상으로 삼는다.
function searchRetryManualIds(body: unknown): string[] {
  const results = (body as { searchResults?: unknown } | null)?.searchResults;
  if (!Array.isArray(results)) return [];
  return results
    .filter((item): item is { manualId: string; status: string } =>
      typeof item?.manualId === "string" && (item.status === "failed" || item.status === "unknown"))
    .map((item) => item.manualId);
}

function isCategoryPlaceholder(manual: ManualRecord): boolean {
  return !manual.parent_manual_id && manual.status === "draft" && manual.content === STORE_MANUAL_CATEGORY_PLACEHOLDER_CONTENT;
}

function getManualCategory(manual: ManualRecord): string {
  return manual.category?.trim() || "미분류";
}

function getDisplayCategoryName(category: string | null | undefined): string {
  const trimmed = category?.trim();
  if (!trimmed || UUID_LIKE_PATTERN.test(trimmed) || INTERNAL_ID_LIKE_PATTERN.test(trimmed)) {
    return "카테고리";
  }
  return trimmed;
}

// 대시보드 카드는 parent_manual_id가 NULL인 최상위 매뉴얼만 표시하고,
// 하위 항목(parent_manual_id가 그 카드의 id와 일치하는 행)을 상세 화면에서 보여준다.
function groupByParent(manuals: ManualRecord[]): ManualGroup[] {
  const topLevel = manuals.filter((manual) => !manual.parent_manual_id && !isCategoryPlaceholder(manual));
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
      category: getManualCategory(parent),
      title: parent.title,
      items: children.length > 0 ? children : [parent],
    };
  });
}

function groupByCategory(manuals: ManualRecord[], groups: ManualGroup[]): ManualCategory[] {
  const categories = new Map<string, ManualGroup[]>();

  for (const manual of manuals) {
    const category = getManualCategory(manual);
    if (!categories.has(category)) {
      categories.set(category, []);
    }
  }

  for (const group of groups) {
    const list = categories.get(group.category) ?? [];
    list.push(group);
    categories.set(group.category, list);
  }

  return Array.from(categories.entries()).map(([category, categoryGroups]) => ({
    category,
    groups: categoryGroups,
    itemCount: categoryGroups.reduce((count, group) => count + group.items.length, 0),
  }));
}

export default function StoreManualsManagementPage() {
  const router = useRouter();
  const [isReady, setIsReady] = useState(false);
  const [userName, setUserName] = useState("");
  const [storeName, setStoreName] = useState("");
  const [selectedStoreId, setSelectedStoreId] = useState("");
  const [manuals, setManuals] = useState<ManualRecord[]>([]);
  const [isLoadingManuals, setIsLoadingManuals] = useState(true);
  // 현재 매장 결정 상태: loading → none(승인 매장 없음) | ready | error. 서로 동시에 표시되지 않는다.
  const [storeStatus, setStoreStatus] = useState<"loading" | "none" | "ready" | "error">("loading");
  const [manualsError, setManualsError] = useState(false);
  const [view, setView] = useState<ManualView>("categories");
  const [searchQuery, setSearchQuery] = useState("");
  const [titleSearchQuery, setTitleSearchQuery] = useState("");
  const [itemSearchQuery, setItemSearchQuery] = useState("");
  const [selectedCategoryName, setSelectedCategoryName] = useState<string | null>(null);
  const [selectedTitleId, setSelectedTitleId] = useState<string | null>(null);
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [categoryName, setCategoryName] = useState("");
  const [categoryError, setCategoryError] = useState("");
  const [isCreatingCategory, setIsCreatingCategory] = useState(false);
  const [editingCategory, setEditingCategory] = useState<ManualCategory | null>(null);
  const [editCategoryName, setEditCategoryName] = useState("");
  const [editCategoryError, setEditCategoryError] = useState("");
  const [isUpdatingCategory, setIsUpdatingCategory] = useState(false);
  const [isDeletingCategory, setIsDeletingCategory] = useState(false);
  const [showTitleModal, setShowTitleModal] = useState(false);
  const [titleName, setTitleName] = useState("");
  const [titleItems, setTitleItems] = useState<{ id: string; content: string }[]>([
    { id: crypto.randomUUID(), content: "" },
  ]);
  const [titleError, setTitleError] = useState("");
  const [isCreatingTitle, setIsCreatingTitle] = useState(false);
  const [editingTitle, setEditingTitle] = useState<ManualGroup | null>(null);
  const [editTitleName, setEditTitleName] = useState("");
  const [editTitleError, setEditTitleError] = useState("");
  const [isUpdatingTitle, setIsUpdatingTitle] = useState(false);
  const [deletingTitleId, setDeletingTitleId] = useState<string | null>(null);
  const [showItemModal, setShowItemModal] = useState(false);
  const [itemContent, setItemContent] = useState("");
  const [itemError, setItemError] = useState("");
  const [isCreatingItem, setIsCreatingItem] = useState(false);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editingItemContent, setEditingItemContent] = useState("");
  const [savingItemId, setSavingItemId] = useState<string | null>(null);
  const [deletingItemId, setDeletingItemId] = useState<string | null>(null);
  const [itemEditError, setItemEditError] = useState("");
  const [questionReturnId, setQuestionReturnId] = useState<string | null>(null);
  const [manualSaveNotice, setManualSaveNotice] = useState("");
  const [searchRetryIds, setSearchRetryIds] = useState<string[]>([]);
  const [isRetryingSearch, setIsRetryingSearch] = useState(false);
  const [showDeleteAllConfirm, setShowDeleteAllConfirm] = useState(false);
  const [isDeletingAll, setIsDeletingAll] = useState(false);
  const [deleteAllError, setDeleteAllError] = useState("");
  const [toastMessage, setToastMessage] = useState("");
  const analyzeFileInputRef = useRef<HTMLInputElement>(null);
  const isSubmittingRef = useRef(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState("");
  const [preview, setPreview] = useState<ManualUploadPreview | null>(null);
  const [categoryLabels, setCategoryLabels] = useState<Record<string, string>>({});
  const [manualEdits, setManualEdits] = useState<Record<string, ManualEditState>>({});
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [isSavingAnalysis, setIsSavingAnalysis] = useState(false);
  const [analysisSaveError, setAnalysisSaveError] = useState("");
  const [filterType, setFilterType] = useState<"all" | "category" | "manual">("all");

  const showToast = (message: string) => {
    setToastMessage(message);
    setTimeout(() => setToastMessage(""), 2500);
  };

  // Auth 확인
  useLayoutEffect(() => {
    const checkAuth = async () => {
      try {
        const supabase = createClient();
        const profile = await getAuthenticatedProfile(supabase);

        if (profile?.role !== "owner") {
          router.push("/");
          return;
        }
        if (profile.approvalStatus !== "approved") {
          router.push("/signup/approval-status");
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

  // 사용자 정보 로드 + 현재 매장 결정 (점주 공통 로직: approved owner membership → store)
  useEffect(() => {
    if (!isReady) return;
    let isCancelled = false;

    const loadUserAndStoreInfo = async () => {
      const supabase = createClient();
      const { data } = await supabase.auth.getSession();
      if (isCancelled) return;
      setUserName(data.session?.user?.user_metadata?.name || "점주");

      const resolution = await resolveOwnerCurrentStore();
      if (isCancelled) return;

      if (resolution.status === "error") {
        setStoreStatus("error");
      } else if (!resolution.current) {
        setStoreStatus("none");
      } else {
        const params = new URLSearchParams(window.location.search);
        const choice = pickQuestionsStore(resolution.stores, resolution.current, params.get("storeId"));
        if (choice.requestedStoreRejected || !choice.store) {
          setStoreStatus("error");
          return;
        }
        setSelectedStoreId(choice.store.storeId);
        setStoreName(choice.store.storeName);
        setQuestionReturnId(params.get("questionId"));
        setStoreStatus("ready");
      }
    };

    void loadUserAndStoreInfo();
    return () => {
      isCancelled = true;
    };
  }, [isReady]);

  const fetchManualsData = async (storeId: string): Promise<ManualRecord[] | null> => {
    const response = await fetch(`/api/store-manuals?storeId=${storeId}&includeCategoryPlaceholders=1`);
    const data = (await response.json()) as { manuals?: ManualRecord[]; error?: string };
    return response.ok ? data.manuals ?? [] : null;
  };

  const refetchManuals = async () => {
    if (!selectedStoreId) return;
    setIsLoadingManuals(true);
    try {
      const manuals = await fetchManualsData(selectedStoreId);
      if (manuals) {
        setManuals(manuals);
        setManualsError(false);
      } else {
        setManualsError(true);
      }
    } catch (e) {
      console.error("지점 매뉴얼 목록 조회 실패:", e);
      setManualsError(true);
    } finally {
      setIsLoadingManuals(false);
    }
  };

  useEffect(() => {
    if (!isReady || !selectedStoreId) return;

    fetchManualsData(selectedStoreId)
      .then((manuals) => {
        if (manuals) {
          setManuals(manuals);
          const targetId = new URLSearchParams(window.location.search).get("manualId");
          const target = targetId ? manuals.find((manual) => manual.id === targetId && manual.store_id === selectedStoreId) : null;
          if (target && !manuals.some((manual) => manual.parent_manual_id === target.id)) {
            setSelectedCategoryName(getManualCategory(target));
            setSelectedTitleId(target.parent_manual_id || target.id);
            setView("items");
            setEditingItemId(target.id);
            setEditingItemContent(target.content);
          } else if (targetId) {
            setManualSaveNotice("선택한 매뉴얼을 수정 가능한 매장 범위에서 찾지 못했습니다. 목록에서 다시 확인해 주세요.");
          }
        } else {
          setManualsError(true);
        }
      })
      .catch((e) => {
        console.error("지점 매뉴얼 목록 조회 실패:", e);
        setManualsError(true);
      })
      .finally(() => setIsLoadingManuals(false));
  }, [isReady, selectedStoreId]);

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

  // 카테고리 → 타이틀 → 세부 매뉴얼은 같은 route의 view 상태라 이전 단계 view를 명시적으로 지정한다.
  const goToCategories = () => {
    setTitleSearchQuery("");
    setItemSearchQuery("");
    setView("categories");
  };

  const groups = groupByParent(manuals);
  const categories = groupByCategory(manuals, groups);
  const totalItemCount = groups.reduce((count, group) => count + group.items.length, 0);
  const selectedCategory = selectedCategoryName
    ? categories.find((category) => category.category === selectedCategoryName) ?? null
    : null;
  const selectedTitle = selectedTitleId ? selectedCategory?.groups.find((group) => group.id === selectedTitleId) ?? null : null;
  const normalizedSearch = searchQuery.trim().toLowerCase();
  const visibleCategories = normalizedSearch
    ? categories.filter((category) => {
        const categoryText = getDisplayCategoryName(category.category).toLowerCase();
        const groupText = category.groups
          .flatMap((group) => [group.title, ...group.items.map((item) => item.content)])
          .join(" ")
          .toLowerCase();
        return categoryText.includes(normalizedSearch) || groupText.includes(normalizedSearch);
      })
    : categories;
  const visibleManuals = normalizedSearch
    ? groups.filter((group) => {
        const groupText = [group.title, ...group.items.map((item) => item.content)].join(" ").toLowerCase();
        return groupText.includes(normalizedSearch);
      })
    : groups;
  const normalizedTitleSearch = titleSearchQuery.trim().toLowerCase();
  const visibleTitleGroups = selectedCategory
    ? normalizedTitleSearch
      ? selectedCategory.groups.filter((group) => {
          const groupText = [group.title, ...group.items.map((item) => item.content)].join(" ").toLowerCase();
          return groupText.includes(normalizedTitleSearch);
        })
      : selectedCategory.groups
    : [];
  const normalizedItemSearch = itemSearchQuery.trim().toLowerCase();
  const visibleManualItems = selectedTitle
    ? normalizedItemSearch
      ? selectedTitle.items.filter((item) => item.content.toLowerCase().includes(normalizedItemSearch))
      : selectedTitle.items
    : [];

  const resetCategoryForm = () => {
    setCategoryName("");
    setCategoryError("");
  };

  const openEditCategoryModal = (category: ManualCategory) => {
    setEditingCategory(category);
    setEditCategoryName(getDisplayCategoryName(category.category));
    setEditCategoryError("");
  };

  const closeEditCategoryModal = () => {
    setEditingCategory(null);
    setEditCategoryName("");
    setEditCategoryError("");
  };

  const resetTitleForm = () => {
    setTitleName("");
    setTitleItems([{ id: crypto.randomUUID(), content: "" }]);
    setTitleError("");
  };

  const handleAddTitleItem = () => {
    setTitleItems((prev) => [...prev, { id: crypto.randomUUID(), content: "" }]);
  };

  const handleRemoveTitleItem = (id: string) => {
    setTitleItems((prev) => (prev.length > 1 ? prev.filter((item) => item.id !== id) : prev));
  };

  const handleTitleItemChange = (id: string, content: string) => {
    setTitleItems((prev) => prev.map((item) => (item.id === id ? { ...item, content } : item)));
  };

  const openEditTitleModal = (group: ManualGroup) => {
    setEditingTitle(group);
    setEditTitleName(group.title);
    setEditTitleError("");
  };

  const closeEditTitleModal = () => {
    setEditingTitle(null);
    setEditTitleName("");
    setEditTitleError("");
  };

  const resetItemForm = () => {
    setItemContent("");
    setItemError("");
  };

  const handleCreateCategory = async () => {
    const category = categoryName.trim();
    setCategoryError("");

    if (!category) {
      setCategoryError("카테고리 이름을 입력해주세요.");
      return;
    }

    setIsCreatingCategory(true);

    try {
      const response = await fetch("/api/store-manuals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, categoryOnly: true, storeId: selectedStoreId }),
      });
      const data = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(data.error || "카테고리 저장 중 오류가 발생했습니다.");
      }

      resetCategoryForm();
      setShowCategoryModal(false);
      await refetchManuals();
      showToast("카테고리가 추가되었습니다.");
      setManualSaveNotice(manualSaveMessage(data));
      setSearchRetryIds(searchRetryManualIds(data));
    } catch (e) {
      setCategoryError(e instanceof Error ? e.message : "카테고리 저장 중 오류가 발생했습니다.");
    } finally {
      setIsCreatingCategory(false);
    }
  };

  const handleUpdateCategory = async () => {
    if (!editingCategory) return;

    const newCategory = editCategoryName.trim();
    setEditCategoryError("");

    if (!newCategory) {
      setEditCategoryError("카테고리 이름을 입력해주세요.");
      return;
    }

    setIsUpdatingCategory(true);

    try {
      const response = await fetch("/api/store-manuals", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "rename-category",
          category: editingCategory.category,
          newCategory,
          storeId: selectedStoreId,
        }),
      });
      const data = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(data.error || "카테고리 이름 변경 중 오류가 발생했습니다.");
      }

      const previousCategory = editingCategory.category;
      closeEditCategoryModal();
      await refetchManuals();
      if (selectedCategoryName === previousCategory) {
        setSelectedCategoryName(newCategory);
      }
      showToast("카테고리 이름이 변경되었습니다.");
      setManualSaveNotice(manualSaveMessage(data));
      setSearchRetryIds(searchRetryManualIds(data));
    } catch (e) {
      setEditCategoryError(e instanceof Error ? e.message : "카테고리 이름 변경 중 오류가 발생했습니다.");
    } finally {
      setIsUpdatingCategory(false);
    }
  };

  const handleDeleteCategory = async () => {
    if (!editingCategory || isDeletingCategory) return;

    const confirmed = window.confirm(
      "이 카테고리를 삭제하시면 소속된 모든 타이틀과 세부 매뉴얼이 전부 삭제됩니다. 정말 삭제하시겠습니까?",
    );

    if (!confirmed) return;

    setIsDeletingCategory(true);
    setEditCategoryError("");

    try {
      const response = await fetch("/api/store-manuals", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete-category", category: editingCategory.category, storeId: selectedStoreId }),
      });
      const data = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(data.error || "카테고리 삭제 중 오류가 발생했습니다.");
      }

      if (selectedCategoryName === editingCategory.category) {
        setSelectedCategoryName(null);
        setSelectedTitleId(null);
        setView("categories");
      }
      closeEditCategoryModal();
      await refetchManuals();
      showToast("카테고리가 삭제되었습니다.");
    } catch (e) {
      setEditCategoryError(e instanceof Error ? e.message : "카테고리 삭제 중 오류가 발생했습니다.");
    } finally {
      setIsDeletingCategory(false);
    }
  };

  const handleCreateTitle = async () => {
    const category = selectedCategory?.category;
    const topic = titleName.trim();
    const items = titleItems.map((item) => item.content.trim()).filter((content) => content.length > 0);
    setTitleError("");

    if (!category) {
      setTitleError("카테고리를 먼저 선택해주세요.");
      return;
    }

    if (!topic || items.length === 0) {
      setTitleError("타이틀과 세부 매뉴얼을 하나 이상 입력해주세요.");
      return;
    }

    setIsCreatingTitle(true);

    try {
      const response = await fetch("/api/store-manuals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, topic, items, storeId: selectedStoreId }),
      });
      const data = (await response.json()) as { manuals?: ManualRecord[]; error?: string };

      if (!response.ok) {
        throw new Error(data.error || "타이틀 저장 중 오류가 발생했습니다.");
      }

      const parent = data.manuals?.find((manual) => !manual.parent_manual_id);
      resetTitleForm();
      setShowTitleModal(false);
      await refetchManuals();
      setSelectedCategoryName(category);
      if (parent) {
        setSelectedTitleId(parent.id);
        setView("items");
      } else {
        setView("titles");
      }
      showToast("타이틀이 추가되었습니다.");
      setManualSaveNotice(manualSaveMessage(data));
      setSearchRetryIds(searchRetryManualIds(data));
    } catch (e) {
      setTitleError(e instanceof Error ? e.message : "타이틀 저장 중 오류가 발생했습니다.");
    } finally {
      setIsCreatingTitle(false);
    }
  };

  const handleUpdateTitle = async () => {
    if (!editingTitle) return;

    const title = editTitleName.trim();
    setEditTitleError("");

    if (!title) {
      setEditTitleError("타이틀 이름을 입력해주세요.");
      return;
    }

    setIsUpdatingTitle(true);

    try {
      const response = await fetch(`/api/store-manuals/${editingTitle.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, storeId: selectedStoreId, expectedUpdatedAt: manuals.find((manual) => manual.id === editingTitle.id)?.updated_at }),
      });
      const data = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(data.error || "타이틀 이름 변경 중 오류가 발생했습니다.");
      }

      const updatedTitleId = editingTitle.id;
      closeEditTitleModal();
      await refetchManuals();
      setSelectedTitleId(updatedTitleId);
      showToast("타이틀 이름이 변경되었습니다.");
      setManualSaveNotice(manualSaveMessage(data));
      setSearchRetryIds(searchRetryManualIds(data));
    } catch (e) {
      setEditTitleError(e instanceof Error ? e.message : "타이틀 이름 변경 중 오류가 발생했습니다.");
    } finally {
      setIsUpdatingTitle(false);
    }
  };

  const handleDeleteTitle = async (group: ManualGroup) => {
    if (deletingTitleId) return;

    const confirmed = window.confirm(
      "이 타이틀을 삭제하시면 그 안에 포함된 모든 세부 매뉴얼도 전부 삭제됩니다. 정말 삭제하시겠습니까?",
    );

    if (!confirmed) return;

    setDeletingTitleId(group.id);

    try {
      const response = await fetch(`/api/store-manuals/${group.id}?storeId=${selectedStoreId}`, { method: "DELETE" });
      const data = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(data.error || "타이틀 삭제 중 오류가 발생했습니다.");
      }

      if (selectedTitleId === group.id) {
        setSelectedTitleId(null);
      }
      if (editingTitle?.id === group.id) {
        closeEditTitleModal();
      }
      await refetchManuals();
      showToast("타이틀이 삭제되었습니다.");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "타이틀 삭제 중 오류가 발생했습니다.");
    } finally {
      setDeletingTitleId(null);
    }
  };

  const handleCreateItem = async () => {
    const content = itemContent.trim();
    setItemError("");

    if (!selectedTitle) {
      setItemError("타이틀을 먼저 선택해주세요.");
      return;
    }

    if (!content) {
      setItemError("세부 매뉴얼 내용을 입력해주세요.");
      return;
    }

    setIsCreatingItem(true);

    try {
      const response = await fetch(`/api/store-manuals/${selectedTitle.id}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: [content], storeId: selectedStoreId }),
      });
      const data = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(data.error || "세부 매뉴얼 저장 중 오류가 발생했습니다.");
      }

      resetItemForm();
      setShowItemModal(false);
      await refetchManuals();
      showToast("세부 매뉴얼이 추가되었습니다.");
      setManualSaveNotice(manualSaveMessage(data));
      setSearchRetryIds(searchRetryManualIds(data));
    } catch (e) {
      setItemError(e instanceof Error ? e.message : "세부 매뉴얼 저장 중 오류가 발생했습니다.");
    } finally {
      setIsCreatingItem(false);
    }
  };

  const startEditItem = (item: ManualRecord) => {
    setEditingItemId(item.id);
    setEditingItemContent(item.content);
    setItemEditError("");
  };

  const cancelEditItem = () => {
    setEditingItemId(null);
    setEditingItemContent("");
    setItemEditError("");
  };

  const reloadEditingItem = async (item: ManualRecord) => {
    if (!window.confirm("입력 중인 내용을 버리고 최신 본문을 불러올까요?")) return;
    try {
      const latest = await fetchManualsData(selectedStoreId);
      const current = latest?.find((manual) => manual.id === item.id && manual.store_id === selectedStoreId);
      if (!latest || !current) { setItemEditError("최신 본문을 확인하지 못했습니다."); return; }
      setManuals(latest);
      setEditingItemContent(current.content);
      setItemEditError("");
    } catch { setItemEditError("최신 본문을 불러오지 못했습니다."); }
  };

  const retrySearchIndexing = async () => {
    if (!selectedStoreId || searchRetryIds.length === 0 || isRetryingSearch) return;
    setIsRetryingSearch(true);
    const stillFailed: string[] = [];
    for (const manualId of searchRetryIds) {
      try {
        const response = await fetch(STORE_REINDEX_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ storeId: selectedStoreId, manualId }),
        });
        if (!response.ok) stillFailed.push(manualId);
      } catch {
        stillFailed.push(manualId);
      }
    }
    setSearchRetryIds(stillFailed);
    setManualSaveNotice(stillFailed.length === 0
      ? "검색 반영을 다시 처리했습니다. 질문은 자동 완료되지 않습니다."
      : `검색 반영 ${stillFailed.length}건을 다시 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.`);
    setIsRetryingSearch(false);
  };

  const handleSaveItem = async (item: ManualRecord) => {
    const content = editingItemContent.trim();
    setItemEditError("");

    const validation = validateManualEdit({ content });
    if (!validation.valid) {
      setItemEditError(validation.error);
      return;
    }

    setSavingItemId(item.id);
    setManualSaveNotice("");
    setSearchRetryIds([]);

    try {
      const response = await fetch(`/api/store-manuals/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, storeId: selectedStoreId, expectedUpdatedAt: item.updated_at }),
      });
      const data = (await response.json()) as { error?: string; searchStatus?: ManualEditSearchStatus };

      if (!response.ok) {
        throw new Error(data.error || "매뉴얼 저장 중 오류가 발생했습니다.");
      }

      cancelEditItem();
      await refetchManuals();
      setSearchRetryIds(data.searchStatus === "ready" || data.searchStatus === "not_searchable" ? [] : [item.id]);
      const searchNotice = data.searchStatus === "ready" ? "검색 반영이 완료되었습니다."
        : data.searchStatus === "failed" ? "검색 반영에 실패했습니다. 아래 버튼으로 다시 처리해 주세요."
        : data.searchStatus === "not_searchable" ? "아직 승인되지 않아 검색 대상이 아닙니다."
        : "검색 반영 완료를 확인하지 못했습니다.";
      setManualSaveNotice(`본문 저장 성공. ${searchNotice} 질문은 자동 완료되지 않습니다.`);
    } catch (e) {
      setItemEditError(e instanceof Error ? e.message : "매뉴얼 저장 중 오류가 발생했습니다.");
    } finally {
      setSavingItemId(null);
    }
  };

  const handleDeleteItem = async (item: ManualRecord) => {
    setItemEditError("");
    setDeletingItemId(item.id);

    try {
      const response = await fetch("/api/store-manuals/batch-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [item.id], storeId: selectedStoreId }),
      });
      const data = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(data.error || "매뉴얼 삭제 중 오류가 발생했습니다.");
      }

      cancelEditItem();
      await refetchManuals();
      showToast("매뉴얼 항목이 삭제되었습니다.");
    } catch (e) {
      setItemEditError(e instanceof Error ? e.message : "매뉴얼 삭제 중 오류가 발생했습니다.");
    } finally {
      setDeletingItemId(null);
    }
  };

  const handleDeleteAll = async () => {
    setDeleteAllError("");
    setIsDeletingAll(true);

    try {
      const response = await fetch(`/api/store-manuals?storeId=${selectedStoreId}`, { method: "DELETE" });
      const data = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(data.error || "매뉴얼 전체 삭제 중 오류가 발생했습니다.");
      }

      setShowDeleteAllConfirm(false);
      setSelectedCategoryName(null);
      setSelectedTitleId(null);
      setView("categories");
      await refetchManuals();
      showToast("등록된 모든 지점 매뉴얼이 삭제되었습니다.");
    } catch (e) {
      setDeleteAllError(e instanceof Error ? e.message : "매뉴얼 전체 삭제 중 오류가 발생했습니다.");
    } finally {
      setIsDeletingAll(false);
    }
  };

  const openAnalyzeFilePicker = () => {
    if (isAnalyzing) return;
    analyzeFileInputRef.current?.click();
  };

  const closeAnalyzeReview = () => {
    setPreview(null);
    setCategoryLabels({});
    setManualEdits({});
    setCollapsedCategories(new Set());
    setIdempotencyKey("");
    setAnalysisSaveError("");
  };

  const handleAnalyzeFileSelected = async (file: File) => {
    setAnalyzeError("");
    setIdempotencyKey("");
    setAnalysisSaveError("");
    setIsAnalyzing(true);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("storeId", selectedStoreId);

      const response = await fetch("/api/store-manuals/preview", {
        method: "POST",
        body: formData,
      });
      const data = (await response.json()) as {
        preview?: ManualUploadPreview;
        idempotencyKey?: string;
        error?: string;
      };

      if (!response.ok || !data.preview || !data.idempotencyKey) {
        throw new Error(data.error || "파일을 분석하는 중 오류가 발생했습니다.");
      }

      setPreview(data.preview);
      setIdempotencyKey(data.idempotencyKey);
      setCategoryLabels(
        Object.fromEntries(data.preview.categories.map((category) => [category.tempId, category.label])),
      );
      setManualEdits(
        Object.fromEntries(
          data.preview.manuals.map((manual) => [
            manual.tempId,
            { title: manual.title, topCategoryTempId: manual.topCategoryTempId, excluded: false },
          ]),
        ),
      );
      setCollapsedCategories(new Set());
      setAnalysisSaveError("");
    } catch (e) {
      setAnalyzeError(e instanceof Error ? e.message : "파일을 분석하는 중 오류가 발생했습니다.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleCategoryLabelChange = (tempId: string, value: string) => {
    setCategoryLabels((previous) => ({ ...previous, [tempId]: value }));
  };

  const handleManualTitleChange = (tempId: string, value: string) => {
    setManualEdits((previous) => ({ ...previous, [tempId]: { ...previous[tempId], title: value } }));
  };

  const handleManualCategoryMove = (tempId: string, topCategoryTempId: string) => {
    setManualEdits((previous) => ({ ...previous, [tempId]: { ...previous[tempId], topCategoryTempId } }));
  };

  const handleManualExcludeToggle = (tempId: string) => {
    setManualEdits((previous) => ({
      ...previous,
      [tempId]: { ...previous[tempId], excluded: !previous[tempId]?.excluded },
    }));
  };

  const handleToggleCategoryCollapsed = (tempId: string) => {
    setCollapsedCategories((previous) => {
      const next = new Set(previous);
      if (next.has(tempId)) {
        next.delete(tempId);
      } else {
        next.add(tempId);
      }
      return next;
    });
  };

  const handleSaveAnalysis = async () => {
    if (!preview || !selectedStoreId || !idempotencyKey || isSubmittingRef.current) return;

    setAnalysisSaveError("");
    const payloadManuals = buildConfirmedManualsPayload(preview, categoryLabels, manualEdits);
    const includedCount = payloadManuals.filter((manual) => !manual.excluded).length;

    if (includedCount === 0) {
      setAnalysisSaveError("저장할 매뉴얼이 없어요. 최소 1개 이상 남겨주세요.");
      return;
    }

    isSubmittingRef.current = true;
    setIsSavingAnalysis(true);

    try {
      const response = await fetch("/api/store-manuals/preview/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeId: selectedStoreId, manuals: payloadManuals, idempotencyKey }),
      });
      const data = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(data.error || "매뉴얼 저장 중 오류가 발생했습니다.");
      }

      closeAnalyzeReview();
      await refetchManuals();
      setManualSaveNotice(manualSaveMessage(data));
      setSearchRetryIds(searchRetryManualIds(data));
    } catch (e) {
      setAnalysisSaveError(e instanceof Error ? e.message : "매뉴얼 저장 중 오류가 발생했습니다.");
    } finally {
      setIsSavingAnalysis(false);
      isSubmittingRef.current = false;
    }
  };

  const includedAnalysisCount = preview
    ? preview.manuals.filter((manual) => !(manualEdits[manual.tempId]?.excluded ?? false)).length
    : 0;

  const goToTitles = () => {
    setItemSearchQuery("");
    cancelEditItem();
    setView("titles");
  };

  const detailHeader =
    storeStatus === "ready" && !isLoadingManuals && !manualsError
      ? view === "items" && selectedTitle
        ? {
            title: selectedTitle.title,
            description: "세부 매뉴얼을 관리합니다.",
            backLabel: "타이틀 목록으로 돌아가기",
            onBack: goToTitles,
          }
        : view !== "categories" && selectedCategory
          ? {
              title: getDisplayCategoryName(selectedCategory.category),
              description: "이 카테고리의 타이틀과 세부 매뉴얼을 관리합니다.",
              backLabel: "카테고리 목록으로 돌아가기",
              onBack: goToCategories,
            }
          : null
      : null;

  if (!isReady) {
    return null;
  }

  return (
    <div className="min-h-screen bg-(--color-bg-default)">
      <OwnerSidebar activeMenu="manual-store" onLogout={handleLogout} />

      <div className="lg:ml-[240px]">
        <OwnerHeader userName={userName} storeName={storeName} onLogout={handleLogout} />

        <main className="p-6 lg:p-8 max-w-7xl mx-auto">
          {detailHeader ? (
            <div className="mb-8 flex items-start gap-3">
              <button
                type="button"
                onClick={detailHeader.onBack}
                aria-label={detailHeader.backLabel}
                title={detailHeader.backLabel}
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-(--color-border) bg-white text-(--color-text-secondary) transition-colors hover:border-(--color-primary) hover:bg-(--color-primary-light)/30 hover:text-(--color-primary) focus:outline-none focus-visible:ring-2 focus-visible:ring-(--color-primary)"
              >
                <ArrowLeft size={20} aria-hidden="true" />
              </button>
              <div className="min-w-0 pt-1.5">
                <h1 className="text-2xl font-bold text-(--color-text-primary) mb-2 break-keep">{detailHeader.title}</h1>
                <p className="text-base text-(--color-text-secondary)">{detailHeader.description}</p>
              </div>
            </div>
          ) : (
            <div className="mb-8">
              <h1 className="text-2xl font-bold text-(--color-text-primary) mb-2">
                지점 매뉴얼 관리
              </h1>
              <p className="text-base text-(--color-text-secondary)">
                우리 매장의 업무 절차와 운영 노하우를 등록하고 관리하세요.
              </p>
            </div>
          )}

          <input
            ref={analyzeFileInputRef}
            type="file"
            accept={SUPPORTED_ANALYZE_EXTENSIONS.join(",")}
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) {
                void handleAnalyzeFileSelected(file);
              }
            }}
          />

          {analyzeError && (
            <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-5" role="alert">
              <p className="text-sm text-red-700">{analyzeError}</p>
            </div>
          )}

          {questionReturnId && selectedStoreId && (
            <div className="mb-5 rounded-xl border border-(--color-primary)/30 bg-(--color-primary-light)/15 px-5 py-4 text-sm">
              <Link href={buildBossQuestionDetailUrl(questionReturnId, selectedStoreId)} className="inline-flex items-center gap-2 font-semibold text-(--color-primary)">
                <ArrowLeft size={16} aria-hidden="true" />질문으로 돌아가 해결 여부 확인
              </Link>
              <p className="mt-2 text-(--color-text-secondary)">부족한 본문만 수정해 주세요. 저장·승인·검색 준비 완료와 질문 해결은 서로 다릅니다.</p>
            </div>
          )}
          {manualSaveNotice && (
            <div role="status" className="mb-5 flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 sm:flex-row sm:items-center sm:justify-between">
              <p className="min-w-0 whitespace-pre-wrap wrap-break-word">{manualSaveNotice}</p>
              {searchRetryIds.length > 0 && (
                <button
                  type="button"
                  onClick={() => void retrySearchIndexing()}
                  disabled={isRetryingSearch}
                  className="inline-flex min-h-[44px] shrink-0 items-center justify-center gap-1.5 self-start rounded-lg border-2 border-amber-300 bg-white px-4 text-sm font-semibold text-amber-900 transition-colors hover:bg-amber-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-600 disabled:cursor-not-allowed disabled:opacity-60 sm:self-auto"
                >
                  <RefreshCw size={16} className={isRetryingSearch ? "animate-spin" : ""} aria-hidden="true" />
                  {isRetryingSearch ? "다시 처리 중..." : "검색 반영 다시 처리"}
                </button>
              )}
            </div>
          )}

          {storeStatus === "loading" || (storeStatus === "ready" && isLoadingManuals) ? (
            <div className="bg-white border border-(--color-border) rounded-xl p-8 text-center">
              <p className="text-base text-(--color-text-secondary)" role="status">
                불러오는 중...
              </p>
            </div>
          ) : storeStatus === "error" || manualsError ? (
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-red-200 bg-red-50 p-5" role="alert">
              <AlertCircle size={20} className="shrink-0 text-red-700" aria-hidden="true" />
              <p className="flex-1 text-sm text-red-700">
                {storeStatus === "error" ? "매장 정보를 불러오지 못했습니다." : "지점 매뉴얼을 불러오지 못했습니다."}
              </p>
              <button
                type="button"
                onClick={() => (storeStatus === "error" ? window.location.reload() : void refetchManuals())}
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-(--color-primary) hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-(--color-primary)"
              >
                <RefreshCw size={16} aria-hidden="true" /> 다시 시도
              </button>
            </div>
          ) : storeStatus === "none" ? (
            <div className="flex items-start gap-3 bg-white border border-(--color-border) rounded-xl p-5">
              <Store size={20} className="mt-0.5 shrink-0 text-(--color-text-tertiary)" aria-hidden="true" />
              <div>
                <p className="text-base font-semibold text-(--color-text-primary)">아직 연결된 매장이 없습니다.</p>
                <p className="mt-0.5 text-sm text-(--color-text-secondary)">
                  매장 승인 또는 등록이 완료되면 지점 전용 매뉴얼을 관리할 수 있습니다.
                </p>
              </div>
            </div>
          ) : view === "categories" ? (
            <section>
              <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
                <div className="relative flex-1 min-w-0">
                  <Search
                    size={18}
                    aria-hidden="true"
                    className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-(--color-text-tertiary)"
                  />
                  <input
                    type="search"
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder="카테고리 검색"
                    aria-label="카테고리 검색"
                    className="h-12 w-full rounded-lg border border-(--color-border) bg-white pl-11 pr-4 text-base text-(--color-text-primary) placeholder:text-(--color-text-tertiary) focus:border-(--color-primary) focus:outline-none focus:ring-2 focus:ring-(--color-primary)/20"
                  />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {manuals.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setDeleteAllError("");
                        setShowDeleteAllConfirm(true);
                      }}
                      className="mr-2 inline-flex h-10 items-center justify-center whitespace-nowrap rounded-md border-2 border-red-200 bg-transparent px-4 text-base font-semibold text-red-700 transition-colors hover:bg-red-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-600 focus-visible:ring-offset-2"
                    >
                      전체 삭제
                    </button>
                  )}
                  <Button variant="outline" onClick={openAnalyzeFilePicker} isLoading={isAnalyzing}>
                    <Sparkles size={16} className="mr-2" /> 매뉴얼 등록
                  </Button>
                  <Button variant="primary" onClick={() => setShowCategoryModal(true)}>
                    <Plus size={16} className="mr-2" /> 카테고리 추가
                  </Button>
                </div>
              </div>

              {/* Filter Buttons */}
              <div className="mb-6 flex flex-wrap gap-2" role="group" aria-label="검색 필터">
                <button
                  type="button"
                  onClick={() => setFilterType("all")}
                  aria-pressed={filterType === "all"}
                  className={`min-h-9 rounded-full border px-3.5 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-(--color-primary) ${
                    filterType === "all"
                      ? "border-(--color-primary) bg-(--color-primary-light)/40 text-(--color-primary)"
                      : "border-(--color-border) bg-white text-(--color-text-secondary) hover:border-(--color-primary)/50 hover:text-(--color-text-primary)"
                  }`}
                >
                  전체
                </button>
                <button
                  type="button"
                  onClick={() => setFilterType("category")}
                  aria-pressed={filterType === "category"}
                  className={`min-h-9 rounded-full border px-3.5 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-(--color-primary) ${
                    filterType === "category"
                      ? "border-(--color-primary) bg-(--color-primary-light)/40 text-(--color-primary)"
                      : "border-(--color-border) bg-white text-(--color-text-secondary) hover:border-(--color-primary)/50 hover:text-(--color-text-primary)"
                  }`}
                >
                  카테고리
                </button>
                <button
                  type="button"
                  onClick={() => setFilterType("manual")}
                  aria-pressed={filterType === "manual"}
                  className={`min-h-9 rounded-full border px-3.5 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-(--color-primary) ${
                    filterType === "manual"
                      ? "border-(--color-primary) bg-(--color-primary-light)/40 text-(--color-primary)"
                      : "border-(--color-border) bg-white text-(--color-text-secondary) hover:border-(--color-primary)/50 hover:text-(--color-text-primary)"
                  }`}
                >
                  매뉴얼
                </button>
              </div>

              <div className="mb-6 text-left text-sm">
                <span className="font-bold text-(--color-text-primary)">
                  검색 결과{" "}
                  {filterType === "all"
                    ? visibleCategories.length + visibleManuals.length
                    : filterType === "category"
                    ? visibleCategories.length
                    : visibleManuals.length}
                  개
                </span>
                <span className="text-(--color-text-secondary)">
                  {" "}· 카테고리 {categories.length}개 · 타이틀 {groups.length}개 · 세부 항목 {totalItemCount}개
                </span>
              </div>

              {(filterType === "all" && visibleCategories.length === 0 && visibleManuals.length === 0) ||
              (filterType === "category" && visibleCategories.length === 0) ||
              (filterType === "manual" && visibleManuals.length === 0) ? (
                <div className="rounded-xl border border-(--color-border) bg-white p-12 text-center">
                  <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-(--color-primary-light)">
                    <FileText size={32} className="text-(--color-primary)" />
                  </div>
                  <p className="mb-2 text-base text-(--color-text-secondary)">
                    {categories.length === 0 ? "아직 등록된 지점 매뉴얼이 없습니다." : "검색 결과가 없습니다."}
                  </p>
                  <p className="mb-6 text-sm text-(--color-text-tertiary)">
                    {categories.length === 0
                      ? "우리 매장의 업무 절차와 운영 노하우를 등록해보세요."
                      : "다른 검색어를 입력해보세요."}
                  </p>
                  {categories.length === 0 && (
                    <Button variant="primary" onClick={() => setShowCategoryModal(true)}>
                      <Plus size={16} className="mr-2" /> 첫 매뉴얼 등록
                    </Button>
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {(filterType === "all" || filterType === "category") &&
                    visibleCategories.map((category) => (
                      <div
                        key={category.category}
                        role="button"
                        tabIndex={0}
                        onClick={() => {
                          setSelectedCategoryName(category.category);
                          setSelectedTitleId(null);
                          setTitleSearchQuery("");
                          setView("titles");
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            setSelectedCategoryName(category.category);
                          setSelectedTitleId(null);
                          setTitleSearchQuery("");
                          setView("titles");
                        }
                      }}
                      className="relative cursor-pointer rounded-xl border border-(--color-border) bg-white p-5 text-left transition-colors hover:border-(--color-primary) hover:bg-(--color-primary-light)/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-(--color-primary)"
                    >
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          openEditCategoryModal(category);
                        }}
                        className="absolute right-2 top-2 inline-flex h-9 w-9 items-center justify-center rounded-lg text-(--color-text-secondary) transition-all hover:bg-(--color-primary-light)/20 hover:text-(--color-primary) focus:outline-none focus-visible:ring-2 focus-visible:ring-(--color-primary)"
                        aria-label="카테고리 이름 수정"
                        title="카테고리 이름 수정"
                      >
                        <Pencil size={18} />
                      </button>
                      <p className="text-lg font-bold text-(--color-text-primary) break-keep line-clamp-2">{getDisplayCategoryName(category.category)}</p>
                      <p className="pt-3 text-xs text-(--color-text-tertiary)">
                        타이틀 {category.groups.length}개 · 세부 매뉴얼 {category.itemCount}개
                      </p>
                    </div>
                  ))}
                  {(filterType === "all" || filterType === "manual") &&
                    visibleManuals.map((group) => (
                      <div
                        key={group.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => {
                          setSelectedCategoryName(group.category);
                          setSelectedTitleId(group.id);
                          setItemSearchQuery("");
                          cancelEditItem();
                          setView("items");
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            setSelectedCategoryName(group.category);
                            setSelectedTitleId(group.id);
                            setItemSearchQuery("");
                            cancelEditItem();
                            setView("items");
                          }
                        }}
                        className="relative cursor-pointer rounded-xl border border-(--color-border) bg-white p-5 text-left transition-colors hover:border-(--color-primary) hover:bg-(--color-primary-light)/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-(--color-primary)"
                      >
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            openEditTitleModal(group);
                          }}
                          className="absolute right-2 top-2 inline-flex h-9 w-9 items-center justify-center rounded-lg text-(--color-text-secondary) transition-all hover:bg-(--color-primary-light)/20 hover:text-(--color-primary) focus:outline-none focus-visible:ring-2 focus-visible:ring-(--color-primary)"
                          aria-label="매뉴얼 이름 수정"
                          title="매뉴얼 이름 수정"
                        >
                          <Pencil size={18} />
                        </button>
                        <span className="mb-3 inline-flex max-w-[calc(100%-2.5rem)] truncate rounded-full bg-(--color-primary-light)/40 px-2.5 py-0.5 text-xs font-semibold text-(--color-primary)">
                          {getDisplayCategoryName(group.category)}
                        </span>
                        <p className="pr-10 text-lg font-bold text-(--color-text-primary) break-keep line-clamp-2">{group.title}</p>
                        <p className="pt-3 text-xs text-(--color-text-tertiary)">세부 매뉴얼 {group.items.length}개</p>
                      </div>
                    ))}
                </div>
              )}

            </section>
          ) : view === "titles" ? (
            <section>
              <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
                <div className="relative flex-1 min-w-0">
                  <Search
                    size={18}
                    aria-hidden="true"
                    className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-(--color-text-tertiary)"
                  />
                  <input
                    type="search"
                    value={titleSearchQuery}
                    onChange={(event) => setTitleSearchQuery(event.target.value)}
                    placeholder="타이틀 검색"
                    aria-label="타이틀 검색"
                    className="h-12 w-full rounded-lg border border-(--color-border) bg-white pl-11 pr-4 text-base text-(--color-text-primary) placeholder:text-(--color-text-tertiary) focus:border-(--color-primary) focus:outline-none focus:ring-2 focus:ring-(--color-primary)/20"
                  />
                </div>
                <Button variant="primary" onClick={() => setShowTitleModal(true)} disabled={!selectedCategory}>
                  <Plus size={16} className="mr-2" /> 타이틀 추가
                </Button>
              </div>

              {!selectedCategory || visibleTitleGroups.length === 0 ? (
                <div className="rounded-xl border border-dashed border-(--color-border) bg-white p-12 text-center text-sm text-(--color-text-secondary)">
                  {selectedCategory && selectedCategory.groups.length > 0
                    ? "검색 결과가 없습니다."
                    : "아직 등록된 타이틀이 없습니다. 타이틀을 추가해 첫 세부 매뉴얼을 등록하세요."}
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {visibleTitleGroups.map((group) => (
                    <div
                      key={group.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => {
                        setSelectedTitleId(group.id);
                        setItemSearchQuery("");
                        cancelEditItem();
                        setView("items");
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setSelectedTitleId(group.id);
                          setItemSearchQuery("");
                          cancelEditItem();
                          setView("items");
                        }
                      }}
                      className="relative cursor-pointer rounded-xl border border-(--color-border) bg-white p-5 text-left transition-colors hover:border-(--color-primary) hover:bg-(--color-primary-light)/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-(--color-primary)"
                    >
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          openEditTitleModal(group);
                        }}
                        className="absolute right-2 top-2 inline-flex h-9 w-9 items-center justify-center rounded-lg text-(--color-text-secondary) transition-all hover:bg-(--color-primary-light)/20 hover:text-(--color-primary) focus:outline-none focus-visible:ring-2 focus-visible:ring-(--color-primary)"
                        aria-label="타이틀 이름 수정"
                        title="타이틀 이름 수정"
                      >
                        <Pencil size={18} />
                      </button>
                      <span className="mb-3 inline-flex max-w-[calc(100%-2.5rem)] truncate rounded-full bg-(--color-primary-light)/40 px-2.5 py-0.5 text-xs font-semibold text-(--color-primary)">
                        {getDisplayCategoryName(group.category)}
                      </span>
                      <p className="pr-10 text-base font-semibold text-(--color-text-primary) break-keep line-clamp-2">{group.title}</p>
                      <p className="pt-3 text-xs text-(--color-text-tertiary)">세부 매뉴얼 {group.items.length}개</p>
                    </div>
                  ))}
                </div>
              )}

            </section>
          ) : (
            <section>
              <div className="mb-6 relative w-full">
                <Search
                  size={18}
                  aria-hidden="true"
                  className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-(--color-text-tertiary)"
                />
                <input
                  type="search"
                  value={itemSearchQuery}
                  onChange={(event) => setItemSearchQuery(event.target.value)}
                  placeholder="세부 매뉴얼 검색"
                  aria-label="세부 매뉴얼 검색"
                  className="h-12 w-full rounded-lg border border-(--color-border) bg-white pl-11 pr-4 text-base text-(--color-text-primary) placeholder:text-(--color-text-tertiary) focus:border-(--color-primary) focus:outline-none focus:ring-2 focus:ring-(--color-primary)/20"
                />
              </div>

              {selectedTitle ? (
                <div className="space-y-4">
                  {visibleManualItems.map((item, index) => (
                    <article key={item.id} className="rounded-xl border border-(--color-border) bg-white p-5">
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-bold text-(--color-primary)">매뉴얼 {index + 1}</p>
                          <p className="mt-1 text-xs text-(--color-text-secondary)">승인 상태: {item.status === "approved" ? "승인됨" : "미승인"}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => startEditItem(item)}
                            disabled={editingItemId === item.id || deletingItemId === item.id || savingItemId === item.id}
                            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-(--color-text-secondary) transition-all hover:bg-(--color-primary-light)/20 hover:text-(--color-primary) focus:outline-none focus-visible:ring-2 focus-visible:ring-(--color-primary) disabled:cursor-not-allowed disabled:opacity-60"
                            aria-label="매뉴얼 수정"
                            title="매뉴얼 수정"
                          >
                            <Pencil size={18} />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteItem(item)}
                            disabled={deletingItemId === item.id || savingItemId === item.id}
                            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-(--color-text-secondary) transition-all hover:bg-red-100/50 hover:text-red-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-600 disabled:cursor-not-allowed disabled:opacity-60"
                            aria-label="매뉴얼 삭제"
                            title="매뉴얼 삭제"
                          >
                            <Trash2 size={18} />
                          </button>
                        </div>
                      </div>

                      {editingItemId === item.id ? (
                        <div className="space-y-3">
                          <textarea
                            aria-label="매뉴얼 본문"
                            disabled={savingItemId === item.id}
                            value={editingItemContent}
                            onChange={(event) => setEditingItemContent(event.target.value)}
                            rows={5}
                            className="w-full rounded-lg border-2 border-(--color-border) bg-white px-4 py-3 text-base text-(--color-text-primary) focus:border-(--color-primary-accent) focus:outline-none focus:ring-2 focus:ring-(--color-primary-accent)/30"
                          />
                          {itemEditError && <p role="alert" className="text-sm text-(--color-status-error)">{itemEditError}</p>}
                          <div className="flex justify-end gap-2">
                            <Button variant="ghost" size="sm" onClick={() => void reloadEditingItem(item)} disabled={savingItemId === item.id}>
                              <RefreshCw size={14} aria-hidden="true" />최신 본문 불러오기
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={cancelEditItem}
                              disabled={savingItemId === item.id || deletingItemId === item.id}
                            >
                              취소
                            </Button>
                            <Button
                              variant="primary"
                              size="sm"
                              isLoading={savingItemId === item.id}
                              disabled={deletingItemId === item.id}
                              onClick={() => handleSaveItem(item)}
                            >
                              저장
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <p className="whitespace-pre-wrap text-sm leading-6 text-(--color-text-primary)">{item.content}</p>
                      )}
                    </article>
                  ))}
                  {visibleManualItems.length === 0 && (
                    <div className="rounded-xl border border-dashed border-(--color-border) bg-white p-12 text-center text-sm text-(--color-text-secondary)">
                      검색 결과가 없습니다.
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => setShowItemModal(true)}
                    className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-(--color-border) bg-white py-4 text-sm font-bold text-(--color-text-secondary) transition-colors hover:border-(--color-primary) hover:bg-(--color-primary-light)/10 hover:text-(--color-primary) focus:outline-none focus-visible:ring-2 focus-visible:ring-(--color-primary)"
                  >
                    매뉴얼 추가하기 <Plus size={16} />
                  </button>
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-(--color-border) bg-white p-12 text-center text-sm text-(--color-text-secondary)">
                  타이틀을 선택하면 세부 매뉴얼이 표시됩니다.
                </div>
              )}

            </section>
          )}
        </main>
      </div>

      {/* Delete All Manuals Confirm Modal */}
      {showDeleteAllConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="bg-white rounded-xl shadow-lg w-full max-w-[500px] p-8">
            <h2 className="text-xl font-bold text-(--color-text-primary) mb-3">
              지점 매뉴얼 전체 삭제
            </h2>
            <p className="text-base text-(--color-text-secondary) mb-8 leading-relaxed">
              이 지점에 등록된 모든 매뉴얼을 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.
            </p>

            {deleteAllError && <p className="mb-6 text-sm text-(--color-status-error)">{deleteAllError}</p>}

            <div className="flex items-center justify-end gap-3">
              <Button variant="ghost" onClick={() => setShowDeleteAllConfirm(false)} disabled={isDeletingAll}>
                취소
              </Button>
              <Button variant="danger" isLoading={isDeletingAll} onClick={handleDeleteAll}>
                전체 삭제
              </Button>
            </div>
          </div>
        </div>
      )}

      {showCategoryModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="relative w-full max-w-md rounded-xl bg-white p-6 shadow-lg">
            <button
              type="button"
              onClick={() => {
                setShowCategoryModal(false);
                resetCategoryForm();
              }}
              className="absolute right-4 top-4 text-(--color-text-tertiary) hover:text-(--color-text-primary)"
              aria-label="닫기"
            >
              <X size={20} />
            </button>
            <h2 className="mb-6 text-lg font-bold text-(--color-text-primary)">카테고리 추가</h2>
            <div className="space-y-4">
              <Input
                label="카테고리 이름"
                placeholder="예: 오픈/마감"
                value={categoryName}
                onChange={(event) => setCategoryName(event.target.value)}
                error={categoryError}
              />
              <Button variant="primary" className="w-full" isLoading={isCreatingCategory} onClick={handleCreateCategory}>
                추가
              </Button>
            </div>
          </div>
        </div>
      )}

      {editingCategory && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="relative w-full max-w-md rounded-xl bg-white p-6 shadow-lg">
            <button
              type="button"
              onClick={closeEditCategoryModal}
              className="absolute right-4 top-4 text-(--color-text-tertiary) hover:text-(--color-text-primary)"
              aria-label="닫기"
            >
              <X size={20} />
            </button>
            <h2 className="mb-6 text-lg font-bold text-(--color-text-primary)">카테고리 이름 수정</h2>
            <div className="space-y-4">
              <Input
                label="카테고리 이름"
                placeholder="예: 오픈/마감"
                value={editCategoryName}
                onChange={(event) => setEditCategoryName(event.target.value)}
                error={editCategoryError}
              />
              <Button variant="primary" className="w-full" isLoading={isUpdatingCategory} onClick={handleUpdateCategory}>
                저장
              </Button>
              <Button
                variant="danger"
                className="w-full"
                isLoading={isDeletingCategory}
                disabled={isUpdatingCategory}
                onClick={handleDeleteCategory}
              >
                삭제하기
              </Button>
            </div>
          </div>
        </div>
      )}

      {showTitleModal && selectedCategory && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="relative flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-white shadow-xl">
            <button
              type="button"
              onClick={() => {
                setShowTitleModal(false);
                resetTitleForm();
              }}
              className="absolute right-4 top-4 text-(--color-text-tertiary) hover:text-(--color-text-primary)"
              aria-label="닫기"
            >
              <X size={20} />
            </button>
            <div className="shrink-0 border-b border-(--color-border) px-6 py-5">
              <h2 className="mb-1 text-lg font-bold text-(--color-text-primary)">타이틀 추가</h2>
            </div>

            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5 overscroll-contain">
              <Input
                label="타이틀"
                placeholder="예: 1. 오픈 준비"
                value={titleName}
                onChange={(event) => setTitleName(event.target.value)}
              />
              <div className="space-y-4">
                {titleItems.map((item, index) => (
                  <section
                    key={item.id}
                    className="rounded-xl border-2 border-(--color-border) bg-(--color-bg-surface) p-4 shadow-md"
                  >
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <label className="block text-sm font-bold text-(--color-text-primary)">
                        세부 매뉴얼 {index + 1}
                      </label>
                      {titleItems.length > 1 && (
                        <button
                          type="button"
                          onClick={() => handleRemoveTitleItem(item.id)}
                          className="rounded-md border border-red-200 bg-white px-2.5 py-1 text-xs font-semibold text-(--color-status-error) hover:bg-red-50"
                        >
                          삭제
                        </button>
                      )}
                    </div>
                    <textarea
                      value={item.content}
                      onChange={(event) => handleTitleItemChange(item.id, event.target.value)}
                      rows={4}
                      placeholder="예: 1-1. 오픈 전 장비 전원을 확인한다."
                      className="w-full rounded-lg border-2 border-(--color-border) bg-white px-4 py-3 text-base text-(--color-text-primary) focus:border-(--color-primary-accent) focus:outline-none focus:ring-2 focus:ring-(--color-primary-accent)/30"
                    />
                  </section>
                ))}

                <button
                  type="button"
                  onClick={handleAddTitleItem}
                  className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-(--color-border) bg-(--color-bg-surface) py-3 text-sm font-bold text-(--color-text-secondary) transition-colors hover:border-(--color-primary) hover:bg-white hover:text-(--color-primary)"
                >
                  <Plus size={16} /> 세부 매뉴얼 추가
                </button>
              </div>
            </div>

            <div className="shrink-0 border-t border-(--color-border) bg-white px-6 py-4">
              {titleError && <p className="mb-3 text-sm text-(--color-status-error)">{titleError}</p>}
              <Button variant="primary" className="w-full" isLoading={isCreatingTitle} onClick={handleCreateTitle}>
                저장
              </Button>
            </div>
          </div>
        </div>
      )}

      {editingTitle && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="relative w-full max-w-md rounded-xl bg-white p-6 shadow-lg">
            <button
              type="button"
              onClick={closeEditTitleModal}
              className="absolute right-4 top-4 text-(--color-text-tertiary) hover:text-(--color-text-primary)"
              aria-label="닫기"
            >
              <X size={20} />
            </button>
            <h2 className="mb-6 text-lg font-bold text-(--color-text-primary)">타이틀 이름 수정</h2>
            <div className="space-y-4">
              <Input
                label="타이틀"
                placeholder="예: 1. 오픈 준비"
                value={editTitleName}
                onChange={(event) => setEditTitleName(event.target.value)}
                error={editTitleError}
              />
              <Button variant="primary" className="w-full" isLoading={isUpdatingTitle} onClick={handleUpdateTitle}>
                저장
              </Button>
              <Button
                variant="danger"
                className="w-full"
                isLoading={deletingTitleId === editingTitle.id}
                disabled={isUpdatingTitle}
                onClick={() => handleDeleteTitle(editingTitle)}
              >
                삭제하기
              </Button>
            </div>
          </div>
        </div>
      )}

      {showItemModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="relative w-full max-w-md rounded-xl bg-white p-6 shadow-lg">
            <button
              type="button"
              onClick={() => {
                setShowItemModal(false);
                resetItemForm();
              }}
              className="absolute right-4 top-4 text-(--color-text-tertiary) hover:text-(--color-text-primary)"
              aria-label="닫기"
            >
              <X size={20} />
            </button>
            <h2 className="mb-6 text-lg font-bold text-(--color-text-primary)">매뉴얼 추가하기</h2>
            <div className="space-y-4">
              <textarea
                value={itemContent}
                onChange={(event) => setItemContent(event.target.value)}
                rows={5}
                placeholder="세부 매뉴얼 내용을 입력하세요"
                className="w-full rounded-lg border-2 border-(--color-border) bg-white px-4 py-3 text-base text-(--color-text-primary) focus:border-(--color-primary-accent) focus:outline-none focus:ring-2 focus:ring-(--color-primary-accent)/30"
              />
              {itemError && <p className="text-sm text-(--color-status-error)">{itemError}</p>}
              <Button variant="primary" className="w-full" isLoading={isCreatingItem} onClick={handleCreateItem}>
                저장
              </Button>
            </div>
          </div>
        </div>
      )}

      {preview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="relative flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-white shadow-xl">
            <button
              type="button"
              onClick={closeAnalyzeReview}
              disabled={isSavingAnalysis}
              className="absolute right-4 top-4 text-(--color-text-tertiary) hover:text-(--color-text-primary) disabled:opacity-50"
              aria-label="닫기"
            >
              <X size={20} />
            </button>
            <div className="shrink-0 border-b border-(--color-border) px-6 py-5">
              <h2 className="mb-1 text-lg font-bold text-(--color-text-primary)">매뉴얼 등록 미리보기</h2>
              <p className="text-sm text-(--color-text-secondary)">
                {preview.totalDetailManualCount}개 세부 매뉴얼을 {preview.topCategoryCount}개 카테고리로 분류했습니다. 분류와 저장 항목을 확인하세요.
              </p>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5 overscroll-contain">
              <ManualPreviewEditor
                preview={preview}
                categoryLabels={categoryLabels}
                manualEdits={manualEdits}
                collapsedCategories={collapsedCategories}
                onCategoryLabelChange={handleCategoryLabelChange}
                onManualTitleChange={handleManualTitleChange}
                onManualCategoryMove={handleManualCategoryMove}
                onManualExcludeToggle={handleManualExcludeToggle}
                onToggleCategoryCollapsed={handleToggleCategoryCollapsed}
              />
            </div>

            <div className="shrink-0 border-t border-(--color-border) bg-white px-6 py-4">
              {analysisSaveError && (
                <p role="alert" className="mb-3 text-sm text-(--color-status-error)">{analysisSaveError}</p>
              )}
              <div className="flex gap-3">
                <Button variant="ghost" className="flex-1" onClick={closeAnalyzeReview} disabled={isSavingAnalysis}>
                  취소
                </Button>
                <Button
                  variant="primary"
                  className="flex-1"
                  isLoading={isSavingAnalysis}
                  disabled={isSavingAnalysis}
                  onClick={handleSaveAnalysis}
                >
                  세부 매뉴얼 {includedAnalysisCount}개 저장
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {toastMessage && (
        <div className="fixed bottom-6 left-6 right-6 sm:left-auto sm:right-6 sm:w-auto bg-(--color-text-primary) text-white px-4 py-3 rounded-lg text-sm">
          {toastMessage}
        </div>
      )}
    </div>
  );
}
