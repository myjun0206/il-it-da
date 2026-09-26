import { createHash } from "node:crypto";

import type { ManualGroupInput, ManualItemInput } from "@/lib/rag/save-manual-sections";

/**
 * 확정 저장 직전의 "무엇을 저장하는가"를 서버에서 정규화해 SHA-256 지문으로 만든다.
 * 클라이언트가 보낸 hash/scope 값은 쓰지 않는다.
 *
 * 순서 계약: saveManualGroupsWithChunks는 그룹과 항목을 받은 순서대로 insert하고, 목록
 * 화면은 category -> created_at 순으로 보여준다. 즉 순서가 사용자에게 보이는 결과를 바꾸므로
 * 의미가 있다고 보고 정렬하지 않고 그대로 보존한다(같은 항목을 재배열한 업로드는 다른 지문).
 */
export interface FingerprintScope {
  scopeType: "hq" | "store";
  franchiseId: string | null;
  storeId: string | null;
}

/** 줄 단위로 다듬어 CRLF/LF, 앞뒤 공백, 연속 공백 차이를 흡수한다. */
export function normalizeFingerprintText(value: string): string {
  // macOS에서 만든 파일 등은 한글이 NFD로 들어올 수 있다. 눈에 보이는 글자가 같으면
  // 같은 내용으로 판정해야 하므로 NFC로 맞춘 뒤 비교한다.
  return value
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim().replace(/[ \t]+/g, " "))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeItem(item: ManualItemInput): [string, string] {
  if (typeof item === "string") {
    return ["", normalizeFingerprintText(item)];
  }
  return [normalizeFingerprintText(item.title ?? ""), normalizeFingerprintText(item.content)];
}

/**
 * 배열만 사용해 정규화한다. 객체를 쓰면 key 순서가 JSON 문자열에 반영돼 같은 내용이
 * 다른 지문을 만들 수 있다.
 */
export function normalizeManualGroupsForFingerprint(
  groups: readonly ManualGroupInput[],
): (string | [string, string][])[][] {
  return groups.map((group) => [
    normalizeFingerprintText(group.category ?? ""),
    normalizeFingerprintText(group.topic),
    group.items.map(normalizeItem),
  ]);
}

export function buildManualContentFingerprint(
  scope: FingerprintScope,
  groups: readonly ManualGroupInput[],
): string {
  const canonical = [
    scope.scopeType,
    scope.scopeType === "hq" ? (scope.franchiseId ?? "") : "",
    scope.scopeType === "store" ? (scope.storeId ?? "") : "",
    normalizeManualGroupsForFingerprint(groups),
  ];

  return createHash("sha256").update(JSON.stringify(canonical), "utf8").digest("hex");
}
