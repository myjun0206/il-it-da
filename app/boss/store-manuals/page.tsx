"use client";

import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, Pencil, Plus, Sparkles, Trash2, X } from "lucide-react";
import { Button } from "@/components/common/Button";
import { Input } from "@/components/common/Input";
import { createClient } from "@/lib/supabase/client";
import { getAuthenticatedProfile } from "@/lib/auth/client-profile";
import OwnerSidebar from "@/components/owner/OwnerSidebar";
import OwnerHeader from "@/components/owner/OwnerHeader";
import type { ManualRecord } from "@/lib/types/manual";
import type { AnalyzedManualGroup } from "@/lib/manuals/analyze-manual-with-ai";

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

// AI 분석 미리보기 화면에서 편집 가능한 그룹(카테고리/타이틀/세부 매뉴얼 여러 줄 텍스트).
type AnalyzeDraftGroup = {
  id: string;
  category: string;
  topic: string;
  itemsText: string;
};

const SUPPORTED_ANALYZE_EXTENSIONS = [".txt", ".md", ".docx", ".csv", ".xlsx", ".xls"];

const STORE_MANUAL_CATEGORY_PLACEHOLDER_CONTENT = "__STORE_MANUAL_CATEGORY_PLACEHOLDER__";
const UUID_LIKE_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const INTERNAL_ID_LIKE_PATTERN = /^[A-Za-z0-9_-]{16,}$/;

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
  const [error, setError] = useState("");
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
  const [showDeleteAllConfirm, setShowDeleteAllConfirm] = useState(false);
  const [isDeletingAll, setIsDeletingAll] = useState(false);
  const [deleteAllError, setDeleteAllError] = useState("");
  const [toastMessage, setToastMessage] = useState("");
  const analyzeFileInputRef = useRef<HTMLInputElement>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState("");
  const [analyzeDraftGroups, setAnalyzeDraftGroups] = useState<AnalyzeDraftGroup[] | null>(null);
  const [isBatchRegistering, setIsBatchRegistering] = useState(false);
  const [batchRegisterError, setBatchRegisterError] = useState("");

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

  // 사용자 정보 로드 및 지점 검증 (승인된 지점 목록 중 sessionStorage에 저장된 지점을 사용, 없으면 첫 번째 지점)
  useEffect(() => {
    const loadUserAndStoreInfo = async () => {
      try {
        const supabase = createClient();
        const { data } = await supabase.auth.getSession();

        if (!data.session?.user) return;

        const name = data.session.user.user_metadata?.name || "점주";
        setUserName(name);

        const storedStoreId = sessionStorage.getItem("selectedStoreId") || "";
        const storedStoreName = sessionStorage.getItem("selectedStoreName") || "";

        try {
          const response = await fetch("/api/signup/store-membership", { credentials: "include" });
          const result = (await response.json()) as {
            success?: boolean;
            data?: Array<{ storeId: string; storeName: string; status: string; role: string }>;
          };

          if (response.ok && result.data) {
            const approvedStores = result.data.filter((m) => m.status === "approved" && m.role === "owner");

            if (approvedStores.length === 0) {
              setError("승인된 지점이 없습니다.");
              return;
            }

            const isValidStore = approvedStores.some((s) => s.storeId === storedStoreId);

            if (isValidStore) {
              setSelectedStoreId(storedStoreId);
              setStoreName(storedStoreName || "선택된 지점");
            } else {
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
      }
    } catch (e) {
      console.error("지점 매뉴얼 목록 조회 실패:", e);
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
        }
      })
      .catch((e) => console.error("지점 매뉴얼 목록 조회 실패:", e))
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
        body: JSON.stringify({ title, storeId: selectedStoreId }),
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

  const handleSaveItem = async (item: ManualRecord) => {
    const content = editingItemContent.trim();
    setItemEditError("");

    if (!content) {
      setItemEditError("매뉴얼 내용을 입력해주세요.");
      return;
    }

    setSavingItemId(item.id);

    try {
      const response = await fetch(`/api/store-manuals/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, storeId: selectedStoreId }),
      });
      const data = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(data.error || "매뉴얼 저장 중 오류가 발생했습니다.");
      }

      cancelEditItem();
      await refetchManuals();
      showToast("매뉴얼 내용이 저장되었습니다.");
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

  const closeAnalyzePreview = () => {
    setAnalyzeDraftGroups(null);
    setBatchRegisterError("");
  };

  const handleAnalyzeFileSelected = async (file: File) => {
    setAnalyzeError("");
    setIsAnalyzing(true);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("storeId", selectedStoreId);

      const response = await fetch("/api/store-manuals/analyze", {
        method: "POST",
        body: formData,
      });
      const data = (await response.json()) as { groups?: AnalyzedManualGroup[]; error?: string };

      if (!response.ok || !data.groups) {
        throw new Error(data.error || "파일을 분석하는 중 오류가 발생했습니다.");
      }

      setAnalyzeDraftGroups(
        data.groups.map((group) => ({
          id: crypto.randomUUID(),
          category: group.category,
          topic: group.topic,
          itemsText: group.items.join("\n"),
        })),
      );
    } catch (e) {
      setAnalyzeError(e instanceof Error ? e.message : "파일을 분석하는 중 오류가 발생했습니다.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleDraftGroupChange = (id: string, field: "category" | "topic" | "itemsText", value: string) => {
    setAnalyzeDraftGroups((prev) =>
      prev ? prev.map((group) => (group.id === id ? { ...group, [field]: value } : group)) : prev,
    );
  };

  const handleRemoveDraftGroup = (id: string) => {
    setAnalyzeDraftGroups((prev) => (prev ? prev.filter((group) => group.id !== id) : prev));
  };

  const handleAddDraftGroup = () => {
    setAnalyzeDraftGroups((prev) => [
      ...(prev ?? []),
      { id: crypto.randomUUID(), category: "", topic: "", itemsText: "" },
    ]);
  };

  const handleBatchRegister = async () => {
    if (!analyzeDraftGroups || analyzeDraftGroups.length === 0) return;

    setBatchRegisterError("");

    const groups = analyzeDraftGroups
      .map((group) => ({
        // 카테고리를 비워두고 제출하면 서버(batch-create)의 legacy fallback으로 타이틀이 그대로
        // 카테고리가 되어버릴 수 있으므로, 프런트에서 먼저 "미분류"로 채워 넣어 그 경로를 막는다.
        category: group.category.trim() || "미분류",
        topic: group.topic.trim(),
        items: group.itemsText
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean),
      }))
      .filter((group) => group.topic && group.items.length > 0);

    if (groups.length === 0) {
      setBatchRegisterError("등록할 타이틀과 세부 매뉴얼을 하나 이상 입력해주세요.");
      return;
    }

    setIsBatchRegistering(true);

    try {
      const response = await fetch("/api/store-manuals/batch-create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeId: selectedStoreId, groups }),
      });
      const data = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(data.error || "매뉴얼 일괄 등록 중 오류가 발생했습니다.");
      }

      closeAnalyzePreview();
      await refetchManuals();
      showToast(`AI 분석 결과 ${groups.length}개 타이틀을 등록했습니다.`);
    } catch (e) {
      setBatchRegisterError(e instanceof Error ? e.message : "매뉴얼 일괄 등록 중 오류가 발생했습니다.");
    } finally {
      setIsBatchRegistering(false);
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

        <main className="p-6 lg:p-8 max-w-7xl mx-auto">
          <div className="mb-6">
            <h1 className="text-2xl font-bold text-[var(--color-text-primary)] mb-2">
              지점 매뉴얼 관리
            </h1>
            <p className="text-base text-[var(--color-text-secondary)]">
              카테고리, 타이틀, 세부 매뉴얼 순서로 {storeName || "우리 지점"} 전용 매뉴얼을 관리합니다.
            </p>
          </div>

          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-sm text-red-600">{error}</p>
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
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-sm text-red-600">{analyzeError}</p>
            </div>
          )}

          {isLoadingManuals ? (
            <p className="text-sm text-[var(--color-text-secondary)]">불러오는 중...</p>
          ) : view === "categories" ? (
            <section>
              <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="w-full lg:max-w-md">
                  <Input
                    label="검색"
                    placeholder="카테고리 검색하기"
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" onClick={() => router.push("/boss/store-manuals/upload")}>
                    <FileText size={16} className="mr-2" /> 미리보기로 올리기
                  </Button>
                  <Button variant="outline" onClick={openAnalyzeFilePicker} isLoading={isAnalyzing}>
                    <Sparkles size={16} className="mr-2" /> 매뉴얼 분석
                  </Button>
                  <Button variant="primary" onClick={() => setShowCategoryModal(true)}>
                    <Plus size={16} className="mr-2" /> 카테고리 추가
                  </Button>
                </div>
              </div>

              <div className="mb-4 text-sm text-[var(--color-text-secondary)]">
                카테고리 <span className="font-bold text-[var(--color-text-primary)]">{categories.length}</span>개 · 타이틀{" "}
                <span className="font-bold text-[var(--color-text-primary)]">{groups.length}</span>개 · 세부 항목{" "}
                <span className="font-bold text-[var(--color-text-primary)]">{totalItemCount}</span>개
              </div>

              {visibleCategories.length === 0 ? (
                <div className="rounded-xl border-2 border-[var(--color-border)] bg-[var(--color-bg-surface)] p-12 text-center shadow-md">
                  <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[var(--color-primary-light)]">
                    <FileText size={32} className="text-[var(--color-primary)]" />
                  </div>
                  <p className="mb-2 text-base text-[var(--color-text-secondary)]">
                    {categories.length === 0 ? "등록된 지점 매뉴얼 카테고리가 없습니다." : "검색 결과가 없습니다."}
                  </p>
                  <p className="mb-6 text-sm text-[var(--color-text-tertiary)]">
                    카테고리를 추가한 뒤 타이틀과 세부 매뉴얼을 채워 넣어보세요.
                  </p>
                  <Button variant="primary" onClick={() => setShowCategoryModal(true)}>
                    <Plus size={16} className="mr-2" /> 카테고리 추가
                  </Button>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {visibleCategories.map((category, index) => (
                    <button
                      key={category.category}
                      type="button"
                      onClick={() => {
                        setSelectedCategoryName(category.category);
                        setSelectedTitleId(null);
                        setTitleSearchQuery("");
                        setView("titles");
                      }}
                      className="relative rounded-xl border-2 border-[var(--color-border)] bg-[var(--color-bg-surface)] p-6 text-left shadow-md transition-all hover:border-[var(--color-primary)] hover:bg-white hover:shadow-lg"
                    >
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(event) => {
                          event.stopPropagation();
                          openEditCategoryModal(category);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            event.stopPropagation();
                            openEditCategoryModal(category);
                          }
                        }}
                        className="absolute right-4 top-4 inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--color-border)] bg-white text-[var(--color-text-secondary)] shadow-sm transition-colors hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]"
                        aria-label="카테고리 이름 수정"
                      >
                        <Pencil size={15} />
                      </span>
                      <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-lg bg-[var(--color-primary-light)] text-sm font-bold text-[var(--color-primary)]">
                        {index + 1}
                      </div>
                      <p className="mb-2 text-lg font-bold text-[var(--color-text-primary)]">{getDisplayCategoryName(category.category)}</p>
                      <p className="text-sm text-[var(--color-text-secondary)]">
                        타이틀 {category.groups.length}개 · 세부 매뉴얼 {category.itemCount}개
                      </p>
                    </button>
                  ))}
                </div>
              )}

              {manuals.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setDeleteAllError("");
                    setShowDeleteAllConfirm(true);
                  }}
                  className="fixed bottom-6 left-6 z-40 rounded-full border border-red-200 bg-white px-5 py-3 text-sm font-bold text-[var(--color-status-error)] shadow-lg transition-colors hover:bg-red-50 lg:left-[272px]"
                >
                  전체 삭제
                </button>
              )}
            </section>
          ) : view === "titles" ? (
            <section>
              <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                <div className="w-full lg:max-w-md">
                  <Input
                    label="검색"
                    placeholder="타이틀 검색하기"
                    value={titleSearchQuery}
                    onChange={(event) => setTitleSearchQuery(event.target.value)}
                  />
                </div>
                <div className="flex items-center justify-end">
                  <Button variant="primary" onClick={() => setShowTitleModal(true)} disabled={!selectedCategory}>
                    <Plus size={16} className="mr-2" /> 타이틀 추가
                  </Button>
                </div>
              </div>

              {!selectedCategory || visibleTitleGroups.length === 0 ? (
                <div className="rounded-xl border-2 border-dashed border-[var(--color-border)] bg-[var(--color-bg-surface)] p-12 text-center text-sm text-[var(--color-text-secondary)] shadow-sm">
                  {selectedCategory && selectedCategory.groups.length > 0
                    ? "검색 결과가 없습니다."
                    : "아직 등록된 타이틀이 없습니다. 타이틀을 추가해 첫 세부 매뉴얼을 등록하세요."}
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {visibleTitleGroups.map((group, index) => (
                    <button
                      key={group.id}
                      type="button"
                      onClick={() => {
                        setSelectedTitleId(group.id);
                        setItemSearchQuery("");
                        cancelEditItem();
                        setView("items");
                      }}
                      className="relative rounded-xl border-2 border-[var(--color-border)] bg-[var(--color-bg-surface)] p-6 text-left shadow-md transition-all hover:border-[var(--color-primary)] hover:bg-white hover:shadow-lg"
                    >
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(event) => {
                          event.stopPropagation();
                          openEditTitleModal(group);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            event.stopPropagation();
                            openEditTitleModal(group);
                          }
                        }}
                        className="absolute right-4 top-4 inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--color-border)] bg-white text-[var(--color-text-secondary)] shadow-sm transition-colors hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]"
                        aria-label="타이틀 이름 수정"
                      >
                        <Pencil size={15} />
                      </span>
                      <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-lg bg-[var(--color-primary-light)] text-sm font-bold text-[var(--color-primary)]">
                        {index + 1}
                      </div>
                      <p className="mb-2 text-lg font-bold text-[var(--color-text-primary)]">{group.title}</p>
                      <p className="text-sm text-[var(--color-text-secondary)]">세부 매뉴얼 {group.items.length}개</p>
                    </button>
                  ))}
                </div>
              )}

              <div className="fixed bottom-6 right-6 z-40 rounded-full border border-[var(--color-border)] bg-white p-2 shadow-lg lg:right-8">
                <button
                  type="button"
                  onClick={() => {
                    setTitleSearchQuery("");
                    setView("categories");
                  }}
                  className="rounded-full bg-[var(--color-primary)] px-5 py-2 text-sm font-bold text-white shadow-sm transition-colors hover:bg-[var(--color-primary-hover)]"
                >
                  ← 카테고리 목록
                </button>
              </div>
            </section>
          ) : (
            <section>
              <div className="mb-6 w-full lg:max-w-md">
                <Input
                  label="검색"
                  placeholder="매뉴얼 검색하기"
                  value={itemSearchQuery}
                  onChange={(event) => setItemSearchQuery(event.target.value)}
                />
              </div>

              {selectedTitle ? (
                <div className="space-y-4">
                  {visibleManualItems.map((item, index) => (
                    <article key={item.id} className="rounded-xl border-2 border-[var(--color-border)] bg-[var(--color-bg-surface)] p-5 shadow-md">
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <p className="text-sm font-bold text-[var(--color-primary)]">매뉴얼 {index + 1}</p>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => startEditItem(item)}
                            disabled={editingItemId === item.id || deletingItemId === item.id || savingItemId === item.id}
                            className="rounded-md border border-[var(--color-border)] bg-white px-3 py-1.5 text-xs font-bold text-[var(--color-text-secondary)] transition-colors hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]"
                          >
                            수정
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteItem(item)}
                            disabled={deletingItemId === item.id || savingItemId === item.id}
                            className="rounded-md border border-red-200 bg-white px-3 py-1.5 text-xs font-bold text-[var(--color-status-error)] transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {deletingItemId === item.id ? "삭제 중" : "삭제"}
                          </button>
                        </div>
                      </div>

                      {editingItemId === item.id ? (
                        <div className="space-y-3">
                          <textarea
                            value={editingItemContent}
                            onChange={(event) => setEditingItemContent(event.target.value)}
                            rows={5}
                            className="w-full rounded-lg border-2 border-[var(--color-border)] bg-white px-4 py-3 text-base text-[var(--color-text-primary)] focus:border-[var(--color-primary-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-accent)]/30"
                          />
                          {itemEditError && <p className="text-sm text-[var(--color-status-error)]">{itemEditError}</p>}
                          <div className="flex justify-end gap-2">
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
                        <p className="whitespace-pre-wrap text-sm leading-6 text-[var(--color-text-primary)]">{item.content}</p>
                      )}
                    </article>
                  ))}
                  {visibleManualItems.length === 0 && (
                    <div className="rounded-xl border-2 border-dashed border-[var(--color-border)] bg-[var(--color-bg-surface)] p-12 text-center text-sm text-[var(--color-text-secondary)] shadow-sm">
                      검색 결과가 없습니다.
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => setShowItemModal(true)}
                    className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-[var(--color-border)] bg-[var(--color-bg-surface)] py-4 text-sm font-bold text-[var(--color-text-secondary)] shadow-sm transition-colors hover:border-[var(--color-primary)] hover:bg-white hover:text-[var(--color-primary)]"
                  >
                    매뉴얼 추가하기 <Plus size={16} />
                  </button>
                </div>
              ) : (
                <div className="rounded-xl border-2 border-dashed border-[var(--color-border)] bg-[var(--color-bg-surface)] p-12 text-center text-sm text-[var(--color-text-secondary)] shadow-sm">
                  타이틀을 선택하면 세부 매뉴얼이 표시됩니다.
                </div>
              )}

              <div className="fixed bottom-6 right-6 z-40 rounded-full border border-[var(--color-border)] bg-white p-2 shadow-lg lg:right-8">
                <button
                  type="button"
                  onClick={() => {
                    setItemSearchQuery("");
                    cancelEditItem();
                    setView("titles");
                  }}
                  className="rounded-full bg-[var(--color-primary)] px-5 py-2 text-sm font-bold text-white shadow-sm transition-colors hover:bg-[var(--color-primary-hover)]"
                >
                  ← 타이틀 목록
                </button>
              </div>
            </section>
          )}
        </main>
      </div>

      {/* Delete All Manuals Confirm Modal */}
      {showDeleteAllConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="bg-white rounded-xl shadow-lg w-full max-w-sm p-6">
            <h2 className="text-lg font-bold text-[var(--color-text-primary)] mb-2">
              지점 매뉴얼 전체 삭제
            </h2>
            <p className="text-sm text-[var(--color-text-secondary)] mb-6">
              이 지점에 등록된 모든 매뉴얼을 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.
            </p>

            {deleteAllError && <p className="mb-4 text-sm text-[var(--color-status-error)]">{deleteAllError}</p>}

            <div className="flex items-center justify-end gap-2">
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
              className="absolute right-4 top-4 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]"
              aria-label="닫기"
            >
              <X size={20} />
            </button>
            <h2 className="mb-6 text-lg font-bold text-[var(--color-text-primary)]">카테고리 추가</h2>
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
              className="absolute right-4 top-4 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]"
              aria-label="닫기"
            >
              <X size={20} />
            </button>
            <h2 className="mb-6 text-lg font-bold text-[var(--color-text-primary)]">카테고리 이름 수정</h2>
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
              className="absolute right-4 top-4 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]"
              aria-label="닫기"
            >
              <X size={20} />
            </button>
            <div className="shrink-0 border-b border-[var(--color-border)] px-6 py-5">
              <h2 className="mb-1 text-lg font-bold text-[var(--color-text-primary)]">타이틀 추가</h2>
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
                    className="rounded-xl border-2 border-[var(--color-border)] bg-[var(--color-bg-surface)] p-4 shadow-md"
                  >
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <label className="block text-sm font-bold text-[var(--color-text-primary)]">
                        세부 매뉴얼 {index + 1}
                      </label>
                      {titleItems.length > 1 && (
                        <button
                          type="button"
                          onClick={() => handleRemoveTitleItem(item.id)}
                          className="rounded-md border border-red-200 bg-white px-2.5 py-1 text-xs font-semibold text-[var(--color-status-error)] hover:bg-red-50"
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
                      className="w-full rounded-lg border-2 border-[var(--color-border)] bg-white px-4 py-3 text-base text-[var(--color-text-primary)] focus:border-[var(--color-primary-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-accent)]/30"
                    />
                  </section>
                ))}

                <button
                  type="button"
                  onClick={handleAddTitleItem}
                  className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-[var(--color-border)] bg-[var(--color-bg-surface)] py-3 text-sm font-bold text-[var(--color-text-secondary)] transition-colors hover:border-[var(--color-primary)] hover:bg-white hover:text-[var(--color-primary)]"
                >
                  <Plus size={16} /> 세부 매뉴얼 추가
                </button>
              </div>
            </div>

            <div className="shrink-0 border-t border-[var(--color-border)] bg-white px-6 py-4">
              {titleError && <p className="mb-3 text-sm text-[var(--color-status-error)]">{titleError}</p>}
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
              className="absolute right-4 top-4 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]"
              aria-label="닫기"
            >
              <X size={20} />
            </button>
            <h2 className="mb-6 text-lg font-bold text-[var(--color-text-primary)]">타이틀 이름 수정</h2>
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
              className="absolute right-4 top-4 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]"
              aria-label="닫기"
            >
              <X size={20} />
            </button>
            <h2 className="mb-6 text-lg font-bold text-[var(--color-text-primary)]">매뉴얼 추가하기</h2>
            <div className="space-y-4">
              <textarea
                value={itemContent}
                onChange={(event) => setItemContent(event.target.value)}
                rows={5}
                placeholder="세부 매뉴얼 내용을 입력하세요"
                className="w-full rounded-lg border-2 border-[var(--color-border)] bg-white px-4 py-3 text-base text-[var(--color-text-primary)] focus:border-[var(--color-primary-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-accent)]/30"
              />
              {itemError && <p className="text-sm text-[var(--color-status-error)]">{itemError}</p>}
              <Button variant="primary" className="w-full" isLoading={isCreatingItem} onClick={handleCreateItem}>
                저장
              </Button>
            </div>
          </div>
        </div>
      )}

      {analyzeDraftGroups && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="relative flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-white shadow-xl">
            <button
              type="button"
              onClick={closeAnalyzePreview}
              disabled={isBatchRegistering}
              className="absolute right-4 top-4 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] disabled:opacity-50"
              aria-label="닫기"
            >
              <X size={20} />
            </button>
            <div className="shrink-0 border-b border-[var(--color-border)] px-6 py-5">
              <h2 className="mb-1 text-lg font-bold text-[var(--color-text-primary)]">AI 분석 결과 미리보기</h2>
              <p className="text-sm text-[var(--color-text-secondary)]">
                카테고리/타이틀/세부 매뉴얼 내용을 확인하고 필요하면 수정한 뒤 일괄 등록하세요.
              </p>
            </div>

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5 overscroll-contain">
              {analyzeDraftGroups.map((group, index) => (
                <section
                  key={group.id}
                  className="rounded-xl border-2 border-[var(--color-border)] bg-[var(--color-bg-surface)] p-4 shadow-md"
                >
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <p className="text-sm font-bold text-[var(--color-primary)]">그룹 {index + 1}</p>
                    <button
                      type="button"
                      onClick={() => handleRemoveDraftGroup(group.id)}
                      className="rounded-md border border-red-200 bg-white px-2.5 py-1 text-xs font-semibold text-[var(--color-status-error)] hover:bg-red-50"
                    >
                      <Trash2 size={14} className="mr-1 inline" /> 삭제
                    </button>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Input
                      label="카테고리"
                      placeholder="예: 오픈/마감"
                      value={group.category}
                      onChange={(event) => handleDraftGroupChange(group.id, "category", event.target.value)}
                    />
                    <Input
                      label="타이틀"
                      placeholder="예: 1. 오픈 준비"
                      value={group.topic}
                      onChange={(event) => handleDraftGroupChange(group.id, "topic", event.target.value)}
                    />
                  </div>
                  <label className="mt-3 mb-1 block text-sm font-bold text-[var(--color-text-primary)]">
                    세부 매뉴얼 (한 줄에 하나씩)
                  </label>
                  <textarea
                    value={group.itemsText}
                    onChange={(event) => handleDraftGroupChange(group.id, "itemsText", event.target.value)}
                    rows={4}
                    className="w-full rounded-lg border-2 border-[var(--color-border)] bg-white px-4 py-3 text-sm text-[var(--color-text-primary)] focus:border-[var(--color-primary-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-accent)]/30"
                  />
                </section>
              ))}

              <button
                type="button"
                onClick={handleAddDraftGroup}
                className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-[var(--color-border)] bg-[var(--color-bg-surface)] py-3 text-sm font-bold text-[var(--color-text-secondary)] transition-colors hover:border-[var(--color-primary)] hover:bg-white hover:text-[var(--color-primary)]"
              >
                <Plus size={16} /> 그룹 추가
              </button>
            </div>

            <div className="shrink-0 border-t border-[var(--color-border)] bg-white px-6 py-4">
              {batchRegisterError && (
                <p className="mb-3 text-sm text-[var(--color-status-error)]">{batchRegisterError}</p>
              )}
              <div className="flex gap-3">
                <Button variant="ghost" className="flex-1" onClick={closeAnalyzePreview} disabled={isBatchRegistering}>
                  취소
                </Button>
                <Button
                  variant="primary"
                  className="flex-1"
                  isLoading={isBatchRegistering}
                  onClick={handleBatchRegister}
                >
                  일괄 등록
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {toastMessage && (
        <div className="fixed bottom-6 left-6 right-6 sm:left-auto sm:right-6 sm:w-auto bg-[var(--color-text-primary)] text-white px-4 py-3 rounded-lg text-sm">
          {toastMessage}
        </div>
      )}
    </div>
  );
}
