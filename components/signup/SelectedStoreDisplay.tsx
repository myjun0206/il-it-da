"use client";

import React from "react";
import { MapPin, X } from "lucide-react";
import type { Store } from "@/lib/types/store";

interface SelectedStoreDisplayProps {
  selectedStores: Store[];
  onRemoveStore: (storeId: string) => void;
}

export default function SelectedStoreDisplay({
  selectedStores,
  onRemoveStore,
}: SelectedStoreDisplayProps) {
  return (
    <div className="h-[400px] rounded-lg border border-[var(--color-border)] bg-white flex flex-col">
      {/* Header */}
      <div className="px-6 py-4 border-b border-[var(--color-border-light)] flex-shrink-0">
        <div className="flex items-center justify-between">
          <h2 className="text-base sm:text-lg font-bold text-[var(--color-text-primary)]">
            선택한 매장
          </h2>
          {selectedStores.length > 0 && (
            <span className="text-sm font-semibold text-[var(--color-text-secondary)]">
              {selectedStores.length}개
            </span>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {selectedStores.length === 0 ? (
          // Empty state
          <div className="flex flex-col items-center justify-center h-full text-center px-6">
            <div className="mb-4 p-3 rounded-full bg-[var(--color-primary-light)]/10">
              <MapPin
                size={28}
                className="text-[var(--color-text-secondary)]"
              />
            </div>
            <p className="text-sm text-[var(--color-text-secondary)] mb-2">
              아직 선택한 매장이 없습니다.
            </p>
            <p className="text-xs text-[var(--color-text-tertiary)]">
              검색창에서 운영 중인 매장을
              <br />
              검색해 추가해주세요.
            </p>
          </div>
        ) : (
          // Stores list with internal scroll
          <div className="flex-1 overflow-y-auto px-4 py-4">
            <div className="space-y-3">
              {selectedStores.map((store) => (
                <div
                  key={store.id}
                  className="p-4 border border-[var(--color-border-light)] rounded-lg bg-white hover:bg-[var(--color-bg-default)] transition-colors group"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-base text-[var(--color-text-primary)]">
                        {store.brandName}
                      </p>
                      <p className="text-sm text-[var(--color-text-secondary)] mt-1">
                        {store.name}
                      </p>
                      <p className="text-xs text-[var(--color-text-tertiary)] mt-2 truncate">
                        {store.address}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => onRemoveStore(store.id)}
                      aria-label={`${store.brandName} ${store.name} 선택 해제`}
                      className="flex-shrink-0 p-2 rounded-md text-[var(--color-text-tertiary)] hover:text-red-500 hover:bg-red-50 transition-colors active:scale-95 min-h-[44px] min-w-[44px] flex items-center justify-center"
                    >
                      <X size={20} strokeWidth={2} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
