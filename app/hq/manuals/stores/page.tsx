"use client";

import React, { useEffect, useState, useMemo } from "react";
import { useClientReady } from "@/lib/hq/use-client-ready";
import { useRouter, useSearchParams } from "next/navigation";
import { RefreshCw, Store, Search, FileText, AlertCircle, ChevronRight, ArrowLeft } from "lucide-react";
import type { ManualRecord } from "@/lib/types/manual";
import type { HqStoreSummary } from "@/lib/types/store";

interface StoreInfo { id: string; name: string; manualCount: number }
interface ManualWithStore { manual: ManualRecord; storeName: string; storeId: string }
interface ManualGroup { manual: ManualRecord; items: ManualRecord[] }
type SearchFilter = "all" | "store" | "manual";

const UUID_LIKE_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const INTERNAL_ID_LIKE_PATTERN = /^[A-Za-z0-9_-]{16,}$/;

function getDisplayCategoryName(category: string | null | undefined): string {
  const trimmed = category?.trim();
  if (!trimmed) return "미분류";
  return UUID_LIKE_PATTERN.test(trimmed) || INTERNAL_ID_LIKE_PATTERN.test(trimmed) ? "카테고리" : trimmed;
}

function groupManuals(manuals: ManualRecord[]): ManualGroup[] {
  const ids = new Set(manuals.map((manual) => manual.id));
  return manuals.filter((manual) => !manual.parent_manual_id || !ids.has(manual.parent_manual_id)).map((manual) => {
    const children = manuals.filter((item) => item.parent_manual_id === manual.id);
    return { manual, items: children.length ? children : [manual] };
  });
}

async function readJsonResponse<T>(response: Response, fallbackMessage: string): Promise<T> {
  if (!(response.headers.get("content-type") || "").includes("application/json")) throw new Error(fallbackMessage);
  const data = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(data.error || fallbackMessage);
  return data;
}

export default function StoreManualViewPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isReady = useClientReady();
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [stores, setStores] = useState<StoreInfo[]>([]);
  const [allManuals, setAllManuals] = useState<ManualWithStore[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchFilter, setSearchFilter] = useState<SearchFilter>("all");
  const [storeSearch, setStoreSearch] = useState({ storeId: "", query: "", category: "" });
  const [storeResult, setStoreResult] = useState<{ storeId: string; manuals: ManualRecord[]; error: string } | null>(null);
  const [reloadStoreManuals, setReloadStoreManuals] = useState(0);
  const selectedStoreId = searchParams.get("storeId");
  const selectedManualId = searchParams.get("manualId");
  const selectedStore = stores.find((store) => store.id === selectedStoreId);
  const selectedResult = storeResult?.storeId === selectedStoreId ? storeResult : null;
  const storeManuals = selectedResult?.manuals ?? allManuals.filter((item) => item.storeId === selectedStoreId).map((item) => item.manual);
  const groups = groupManuals(storeManuals);
  const selectedManual = storeManuals.find((manual) => manual.id === selectedManualId);
  const selectedGroup = groups.find((group) => group.manual.id === selectedManualId);
  const currentSearch = storeSearch.storeId === selectedStoreId ? storeSearch : { query: "", category: "" };

  useEffect(() => {
    let cancelled = false;
    const fetchData = async () => {
      try {
        setIsLoading(true);
        setLoadError("");
        const storesResponse = await fetch("/api/hq/stores");
        const storesData = await readJsonResponse<{ stores?: HqStoreSummary[] }>(storesResponse, "지점 목록을 불러오지 못했습니다.");
        if (cancelled) return;
        const storesArray: StoreInfo[] = (storesData.stores ?? []).map((store) => ({ id: store.id, name: store.name, manualCount: store.manualCount }));
        setStores(storesArray);
        const allManualsWithStore: ManualWithStore[] = [];
        for (const store of storesArray) {
          try {
            const response = await fetch(`/api/manuals?storeId=${encodeURIComponent(store.id)}&scope=store`);
            const data = await readJsonResponse<{ manuals?: ManualRecord[] }>(response, "지점 매뉴얼을 불러오지 못했습니다.");
            if (cancelled) return;
            for (const manual of (data.manuals ?? []).filter((manual) => manual.store_id === store.id)) {
              allManualsWithStore.push({ manual, storeName: store.name, storeId: store.id });
            }
          } catch {
            if (!cancelled) setLoadError("일부 지점 매뉴얼을 불러오지 못했습니다. 다시 시도해 주세요.");
          }
        }
        if (!cancelled) setAllManuals(allManualsWithStore);
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error && e.message.includes("지점") ? e.message : "데이터를 불러오지 못했습니다. 다시 시도해 주세요.");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    if (isReady) void fetchData();
    return () => { cancelled = true; };
  }, [isReady, reloadKey]);

  useEffect(() => {
    if (!isReady || !selectedStore) return;
    const controller = new AbortController();
    fetch(`/api/manuals?storeId=${encodeURIComponent(selectedStore.id)}&scope=store`, { signal: controller.signal, cache: "no-store" })
      .then((response) => readJsonResponse<{ manuals?: ManualRecord[] }>(response, "지점 매뉴얼을 불러오지 못했습니다."))
      .then((data) => {
        if (controller.signal.aborted) return;
        if (!Array.isArray(data.manuals)) throw new Error("지점 매뉴얼 응답을 확인하지 못했습니다.");
        setStoreResult({ storeId: selectedStore.id, manuals: data.manuals.filter((manual) => manual.store_id === selectedStore.id), error: "" });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setStoreResult({ storeId: selectedStore.id, manuals: [], error: error instanceof Error ? error.message : "지점 매뉴얼을 불러오지 못했습니다." });
      });
    return () => controller.abort();
  }, [isReady, selectedStore, reloadStoreManuals]);

  const searchResults = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return {
      stores: query && searchFilter !== "manual" ? stores.filter((store) => store.name.toLowerCase().includes(query)) : [],
      manuals: query && searchFilter !== "store" ? allManuals.filter((item) => `${item.manual.title} ${item.storeName}`.toLowerCase().includes(query)) : [],
    };
  }, [searchQuery, searchFilter, stores, allManuals]);

  if (!isReady) {
    return null;
  }
  const openStore = (store: StoreInfo) => router.push(`/hq/manuals/stores?storeId=${encodeURIComponent(store.id)}`, { scroll: false });
  const openManual = (storeId: string, manualId: string) => router.push(`/hq/manuals/stores?storeId=${encodeURIComponent(storeId)}&manualId=${encodeURIComponent(manualId)}`, { scroll: false });
  const buttonClass = "w-full min-h-[130px] text-left flex flex-col rounded-lg border border-[var(--color-border)] bg-white px-6 py-6 shadow-sm transition-all hover:border-[var(--color-primary)] hover:bg-[var(--color-primary-light)]/10 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30";
  const query = currentSearch.query.trim().toLowerCase();
  const categories = [...new Set(groups.map((group) => getDisplayCategoryName(group.manual.category)))];
  const filteredGroups = groups.filter((group) => (!currentSearch.category || getDisplayCategoryName(group.manual.category) === currentSearch.category)
    && `${group.manual.title} ${getDisplayCategoryName(group.manual.category)} ${group.items.map((item) => `${item.title} ${item.content}`).join(" ")}`.toLowerCase().includes(query));

  return (
    <main className="p-6 lg:p-8 max-w-7xl mx-auto">
      {selectedStore ? (
        <>
          <button type="button" onClick={() => selectedManual ? openStore(selectedStore) : router.push("/hq/manuals/stores", { scroll: false })}
            className="mb-6 inline-flex min-h-11 items-center gap-2 text-base font-medium text-[var(--color-primary)]">
            <ArrowLeft size={20} aria-hidden="true" />{selectedManual ? "매뉴얼 목록으로" : "검색으로 돌아가기"}
          </button>
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">{selectedManual ? selectedManual.title : selectedStore.name}</h1>
            <p className="mt-2 text-base text-[var(--color-text-secondary)]">{selectedManual ? selectedStore.name : `총 ${groups.length}개의 매뉴얼`}</p>
          </div>
          {selectedResult?.error ? (
            <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-red-200 bg-red-50 p-6">
              <p className="flex-1 text-sm text-red-700">{selectedResult.error}</p>
              <button type="button" onClick={() => setReloadStoreManuals((value) => value + 1)} className="inline-flex min-h-10 items-center gap-2 text-red-700"><RefreshCw size={16} />다시 시도</button>
            </div>
          ) : selectedManual ? (
            <>
              <span className="inline-flex mb-4 rounded-full bg-[var(--color-primary-light)]/40 px-3 py-1 text-sm font-semibold text-[var(--color-primary)]">{getDisplayCategoryName(selectedManual.category)}</span>
              <div className="bg-white border border-[var(--color-border)] rounded-lg p-8 shadow-sm divide-y divide-[var(--color-border)]">
                {(selectedGroup?.items ?? [selectedManual]).map((item) => (
                  <section key={item.id} className="min-w-0 py-5 first:pt-0">
                    <h2 className="mb-3 break-words text-lg font-semibold">{item.title}</h2>
                    <p className="whitespace-pre-wrap break-words text-base leading-relaxed text-[var(--color-text-primary)]">{item.content?.trim() ? item.content : "매뉴얼 내용이 없습니다."}</p>
                    <p className="mt-4 text-sm text-[var(--color-text-tertiary)]">업데이트: {item.updated_at ? new Date(item.updated_at).toLocaleDateString("ko-KR") : "-"}</p>
                  </section>
                ))}
              </div>
            </>
          ) : !selectedResult && !storeManuals.length ? (
            <p role="status" className="py-8 text-center">지점 매뉴얼을 불러오는 중...</p>
          ) : (
            <>
              <div className="mb-6 space-y-4">
                <input type="search" aria-label="지점 매뉴얼 검색" placeholder="매뉴얼명 또는 내용 검색" value={currentSearch.query}
                  onChange={(event) => setStoreSearch({ storeId: selectedStore.id, category: currentSearch.category, query: event.target.value })}
                  className="h-12 w-full rounded-lg border-2 border-[var(--color-border)] bg-white px-4 text-base" />
                {categories.length > 1 && <div role="group" aria-label="매뉴얼 카테고리" className="flex flex-wrap gap-2">
                  {["", ...categories].map((category) => <button key={category} type="button" aria-pressed={currentSearch.category === category}
                    onClick={() => setStoreSearch({ storeId: selectedStore.id, query: currentSearch.query, category })}
                    className="min-h-9 rounded-full border border-[var(--color-border)] px-3.5 text-sm">{category || "전체"}</button>)}
                </div>}
              </div>
              {!filteredGroups.length ? <p className="py-12 text-center text-[var(--color-text-secondary)]">{groups.length ? "검색 결과가 없습니다." : "등록된 매뉴얼이 없습니다."}</p> : (
                <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {filteredGroups.map((group) => <li key={group.manual.id}>
                    <button type="button" onClick={() => openManual(selectedStore.id, group.manual.id)} className={buttonClass}>
                      <span className="mb-3 text-sm font-semibold text-[var(--color-primary)]">{getDisplayCategoryName(group.manual.category)}</span>
                      <span className="flex w-full items-start justify-between gap-3 text-lg font-semibold"><span className="line-clamp-2 break-words">{group.manual.title}</span><ChevronRight size={20} className="shrink-0" aria-hidden="true" /></span>
                      <span className="mt-auto pt-4 text-xs text-[var(--color-text-tertiary)]">세부 매뉴얼 {group.items.length}개</span>
                    </button>
                  </li>)}
                </ul>
              )}
            </>
          )}
        </>
      ) : (
        <>
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-[var(--color-text-primary)] mb-2">지점 매뉴얼 보기</h1>
            <p className="text-base text-[var(--color-text-secondary)]">지점명이나 매뉴얼명으로 검색하여 각 지점의 매뉴얼을 확인할 수 있습니다.</p>
          </div>
          {isLoading ? (
            <p role="status" className="py-8 text-center">로드 중...</p>
          ) : loadError ? (
            <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-red-200 bg-red-50 p-6">
              <p className="flex-1 text-sm text-red-700">{loadError}</p>
              <button type="button" onClick={() => setReloadKey((value) => value + 1)} className="inline-flex min-h-10 items-center gap-2 text-red-700"><RefreshCw size={16} />다시 시도</button>
            </div>
          ) : (
            <>
              <div className="mb-8">
                <div className="relative mb-4">
                  <Search size={20} aria-hidden="true" className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]" />
                  <input type="search" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="지점명 또는 매뉴얼명 검색" aria-label="지점명 또는 매뉴얼명 검색"
                    className="h-12 w-full rounded-lg border-2 border-[var(--color-border)] bg-white pl-12 pr-4 text-base" />
                </div>
                <div className="flex flex-wrap gap-2" role="group" aria-label="검색 필터">
                  {([{ value: "all", label: "전체" }, { value: "store", label: "지점" }, { value: "manual", label: "매뉴얼" }] as const).map((filter) => (
                    <button key={filter.value} type="button" onClick={() => setSearchFilter(filter.value)} aria-pressed={searchFilter === filter.value}
                      className={`min-h-9 rounded-full border px-3.5 text-sm font-medium ${searchFilter === filter.value ? "border-[var(--color-primary)] bg-[var(--color-primary-light)]/40 text-[var(--color-primary)]" : "border-[var(--color-border)] bg-white text-[var(--color-text-secondary)]"}`}>{filter.label}</button>
                  ))}
                </div>
              </div>
              {searchResults.stores.length > 0 && <section className="mb-8">
                <h2 className="mb-4 text-lg font-bold">지점 ({searchResults.stores.length})</h2>
                <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">{searchResults.stores.map((store) => <li key={store.id}>
                  <button type="button" onClick={() => openStore(store)} className={buttonClass}>
                    <span className="flex items-start gap-4"><Store size={24} className="shrink-0 text-[var(--color-primary)]" /><span className="break-words font-semibold">{store.name}</span></span>
                    <span className="mt-3 text-sm text-[var(--color-text-secondary)]">매뉴얼 {store.manualCount}개</span><ChevronRight size={20} className="mt-auto text-[var(--color-primary)]" aria-hidden="true" />
                  </button>
                </li>)}</ul>
              </section>}
              {searchResults.manuals.length > 0 && <section>
                <h2 className="mb-4 text-lg font-bold">매뉴얼 ({searchResults.manuals.length})</h2>
                <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">{searchResults.manuals.map((item) => <li key={`${item.storeId}-${item.manual.id}`}>
                  <button type="button" onClick={() => openManual(item.storeId, item.manual.id)} className={buttonClass}>
                    <span className="mb-3 text-sm font-semibold text-[var(--color-primary)]">{getDisplayCategoryName(item.manual.category)}</span>
                    <span className="flex w-full items-start justify-between gap-3 text-lg font-semibold"><span className="line-clamp-2 break-words">{item.manual.title}</span><ChevronRight size={20} className="shrink-0" aria-hidden="true" /></span>
                    <span className="mt-auto flex items-center gap-3 pt-4 text-base text-[var(--color-text-secondary)]"><Store size={20} className="shrink-0 text-[var(--color-primary)]" />{item.storeName}</span>
                  </button>
                </li>)}</ul>
              </section>}
              {!searchResults.stores.length && !searchResults.manuals.length && <div className="rounded-lg border border-[var(--color-border)] bg-white p-12 text-center shadow-sm">
                {searchQuery.trim() ? <AlertCircle size={32} className="mx-auto mb-4 text-amber-600" /> : <FileText size={32} className="mx-auto mb-4 text-blue-600" />}
                <p className="text-base text-[var(--color-text-secondary)]">{searchQuery.trim() ? "검색 결과가 없습니다." : "지점명이나 매뉴얼명을 입력하여 검색하세요."}</p>
                <p className="mt-1 text-sm text-[var(--color-text-tertiary)]">현재 {stores.length}개 지점, {allManuals.length}개 매뉴얼을 검색할 수 있습니다.</p>
              </div>}
            </>
          )}
        </>
      )}
    </main>
  );
}