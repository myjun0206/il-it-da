"use client";

import { useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { GripVertical } from "lucide-react";

// 드래그 앤 드롭 정렬 목록 (외부 라이브러리 없이 Pointer Events로 구현 → 마우스·터치·펜 공통).
// - 핸들을 잡고 끌면 카드가 포인터를 따라오고, 놓일 자리는 점선 박스로 표시되며 나머지 카드는 부드럽게 비켜난다.
// - 키보드: 핸들에 포커스를 두고 ↑/↓ 로 한 칸씩, Home/End 로 맨 위/아래로 이동한다. (이동 결과는 스크린리더에 안내)
// 순서만 다루며, 어떤 항목을 보여줄지·저장은 부모가 한다.

interface SortableItem {
  id: string;
}

interface SortableStoreListProps<T extends SortableItem> {
  items: T[];
  /** 목록 이름 (스크린리더용) */
  label: string;
  getItemLabel: (item: T) => string;
  onReorder: (orderedIds: string[]) => void;
  disabled?: boolean;
  /** 카드 내용. 드래그 핸들은 이 컴포넌트가 왼쪽에 붙인다. */
  renderItem: (item: T) => ReactNode;
}

interface DragState {
  id: string;
  startIndex: number;
  overIndex: number;
  pointerStartY: number;
  deltaY: number;
  /** 드래그 시작 시점의 각 카드 위치 (목록 상단 기준) */
  tops: number[];
  heights: number[];
  gap: number;
}

function moveId(ids: string[], from: number, to: number): string[] {
  const next = [...ids];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

export default function SortableStoreList<T extends SortableItem>({
  items,
  label,
  getItemLabel,
  onReorder,
  disabled = false,
  renderItem,
}: SortableStoreListProps<T>) {
  const listRef = useRef<HTMLUListElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [announcement, setAnnouncement] = useState("");

  const ids = items.map((item) => item.id);

  const startDrag = (event: PointerEvent<HTMLButtonElement>, index: number) => {
    if (disabled || items.length < 2 || !listRef.current) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    try {
      // 포인터가 핸들 밖으로 나가도 이동/놓기 이벤트를 계속 받는다.
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // 캡처를 지원하지 않는 환경에서는 핸들 위에서만 추적된다.
    }

    const listTop = listRef.current.getBoundingClientRect().top;
    const rects = Array.from(listRef.current.children).map((child) => child.getBoundingClientRect());
    const tops = rects.map((rect) => rect.top - listTop);
    const heights = rects.map((rect) => rect.height);
    const gap = rects.length > 1 ? Math.max(0, tops[1] - (tops[0] + heights[0])) : 0;

    setDrag({ id: items[index].id, startIndex: index, overIndex: index, pointerStartY: event.clientY, deltaY: 0, tops, heights, gap });
  };

  const moveDrag = (event: PointerEvent<HTMLButtonElement>) => {
    if (!drag) return;
    const { startIndex, tops, heights } = drag;
    const lastIndex = tops.length - 1;
    // 목록 밖으로 나가지 않게 제한
    const minDelta = tops[0] - tops[startIndex];
    const maxDelta = tops[lastIndex] + heights[lastIndex] - (tops[startIndex] + heights[startIndex]);
    const deltaY = Math.min(maxDelta, Math.max(minDelta, event.clientY - drag.pointerStartY));

    // 끌고 있는 카드의 중심보다 위에 있는 다른 카드 수 = 새 위치
    const draggedCenter = tops[startIndex] + heights[startIndex] / 2 + deltaY;
    let overIndex = 0;
    for (let index = 0; index <= lastIndex; index += 1) {
      if (index === startIndex) continue;
      if (tops[index] + heights[index] / 2 < draggedCenter) overIndex += 1;
    }

    setDrag({ ...drag, deltaY, overIndex });
  };

  const endDrag = (commit: boolean) => {
    if (!drag) return;
    const { startIndex, overIndex } = drag;
    setDrag(null);
    if (commit && overIndex !== startIndex) {
      onReorder(moveId(ids, startIndex, overIndex));
      setAnnouncement(`${getItemLabel(items[startIndex])}, ${items.length}개 중 ${overIndex + 1}번째로 이동했습니다.`);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (disabled || drag) return;
    const lastIndex = items.length - 1;
    const target =
      event.key === "ArrowUp" ? index - 1 : event.key === "ArrowDown" ? index + 1 : event.key === "Home" ? 0 : event.key === "End" ? lastIndex : null;
    if (target === null) return;
    event.preventDefault();
    if (target < 0 || target > lastIndex || target === index) return;
    onReorder(moveId(ids, index, target));
    setAnnouncement(`${getItemLabel(items[index])}, ${items.length}개 중 ${target + 1}번째로 이동했습니다.`);
  };

  // 드래그 중 각 카드의 이동량: 끌리는 카드는 포인터를 따라가고, 사이에 낀 카드는 한 칸씩 비켜난다.
  const offsetFor = (index: number): number => {
    if (!drag) return 0;
    const { startIndex, overIndex, heights, gap } = drag;
    if (index === startIndex) return drag.deltaY;
    const shift = heights[startIndex] + gap;
    if (startIndex < overIndex && index > startIndex && index <= overIndex) return -shift;
    if (overIndex < startIndex && index >= overIndex && index < startIndex) return shift;
    return 0;
  };

  // 놓일 자리 (점선 박스)
  const placeholderTop = drag
    ? drag.overIndex <= drag.startIndex
      ? drag.tops[drag.overIndex]
      : drag.tops[drag.overIndex] + drag.heights[drag.overIndex] - drag.heights[drag.startIndex]
    : 0;

  return (
    <div className="relative">
      {drag && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 rounded-xl border-2 border-dashed border-[var(--color-primary)]/50 bg-[var(--color-primary-light)]/15"
          style={{ top: placeholderTop, height: drag.heights[drag.startIndex] }}
        />
      )}

      <ul ref={listRef} aria-label={label} className="relative w-full flex flex-col gap-3">
        {items.map((item, index) => {
          const isDragging = drag?.id === item.id;
          const itemLabel = getItemLabel(item);
          return (
            <li
              key={item.id}
              style={{ transform: drag ? `translateY(${offsetFor(index)}px)` : undefined }}
              className={`flex items-center gap-3 min-h-[52px] rounded-xl border bg-white ${
                isDragging
                  ? "relative z-10 border-[var(--color-primary)] shadow-lg"
                  : `border-[var(--color-border)] ${drag ? "motion-safe:transition-transform motion-safe:duration-200" : ""}`
              }`}
            >
              <button
                type="button"
                disabled={disabled || items.length < 2}
                aria-label={`${itemLabel} 순서 변경`}
                aria-describedby="sortable-store-hint"
                onPointerDown={(event) => startDrag(event, index)}
                onPointerMove={moveDrag}
                onPointerUp={() => endDrag(true)}
                onPointerCancel={() => endDrag(false)}
                onKeyDown={(event) => handleKeyDown(event, index)}
                className={`ml-4 flex w-11 shrink-0 touch-none items-center justify-center rounded-l-xl text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-bg-default)] hover:text-[var(--color-text-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-primary)] disabled:cursor-not-allowed disabled:opacity-40 ${
                  isDragging ? "cursor-grabbing" : "cursor-grab"
                }`}
              >
                <GripVertical size={20} aria-hidden="true" />
              </button>
              <div className="min-w-0 flex-1 pr-4">{renderItem(item)}</div>
            </li>
          );
        })}
      </ul>

      <p id="sortable-store-hint" className="sr-only">
        끌어서 순서를 바꾸거나, 위아래 화살표 키로 한 칸씩 이동할 수 있습니다.
      </p>
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
    </div>
  );
}
