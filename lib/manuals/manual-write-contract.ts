import type { SupabaseClient } from "@supabase/supabase-js";

export const MANUAL_FEATURE_PENDING = "매뉴얼 기능 준비 중입니다. 잠시 후 다시 시도해 주세요. 저장 및 검색 반영 상태는 다시 확인해 주세요.";
export class ManualWriteUnavailableError extends Error {
  constructor() { super(MANUAL_FEATURE_PENDING); this.name = "ManualWriteUnavailableError"; }
}

export type ManualWriteContext = { client: SupabaseClient; contractVersion: 2 };

export async function requireManualWriteContract(client: SupabaseClient): Promise<ManualWriteContext> {
  try {
    const { data, error } = await client.rpc("check_manual_write_contract");
    if (error || data !== 2) throw new ManualWriteUnavailableError();
    return { client, contractVersion: 2 };
  } catch { throw new ManualWriteUnavailableError(); }
}

export function sameManualRevision(left: string, right: string): boolean {
  const point = (value: string) => {
    const milliseconds = Date.parse(value);
    const fraction = value.match(/\.(\d{1,6})(?:Z|[+-]\d{2}:?\d{2})$/)?.[1] ?? "";
    return Number.isFinite(milliseconds) ? milliseconds * 1000 + Number(fraction.padEnd(6, "0").slice(3)) : NaN;
  };
  return point(left) === point(right);
}