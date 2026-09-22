import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, "..");
const envPath = path.join(projectRoot, ".env.local");

if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath, override: true });
}

type ApprovedManual = { id: string };

function validateEnvironment(): void {
  const missing = [
    !process.env.NEXT_PUBLIC_SUPABASE_URL && "NEXT_PUBLIC_SUPABASE_URL",
    !process.env.SUPABASE_SERVICE_ROLE_KEY && "SUPABASE_SERVICE_ROLE_KEY",
    !process.env.OPENAI_API_KEY && "OPENAI_API_KEY",
  ].filter((name): name is string => Boolean(name));

  if (missing.length > 0) {
    throw new Error(`필수 환경 변수가 없습니다: ${missing.join(", ")}`);
  }
}

function getSafeErrorMessage(error: unknown): string {
  let message = error instanceof Error ? error.message : "알 수 없는 오류";

  for (const secret of [
    process.env.OPENAI_API_KEY,
    process.env.SUPABASE_SECRET_KEY,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  ]) {
    if (secret) message = message.replaceAll(secret, "[REDACTED]");
  }

  return message
    .replace(/sk-[A-Za-z0-9_-]+/g, "[REDACTED]")
    .replace(/(api[_ -]?key|password|secret|token)\s*[:=]\s*\S+/gi, "$1=[REDACTED]");
}

function isApprovedManual(value: unknown): value is ApprovedManual {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof (value as Record<string, unknown>).id === "string",
  );
}

async function main(): Promise<void> {
  validateEnvironment();

  const { indexManualById } = await import("../lib/rag/index-manual");
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY as string;
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
  const { data, error } = await supabase
    .from("manuals")
    .select("id")
    .eq("status", "approved")
    .order("id");

  if (error) throw new Error(`승인 매뉴얼 조회 실패: ${error.message}`);
  if (!Array.isArray(data) || !data.every(isApprovedManual)) {
    throw new Error("승인 매뉴얼 조회 결과 형식이 올바르지 않습니다.");
  }

  console.log(`[Index] 가져온 승인 매뉴얼 개수: ${data.length}개`);

  let failedCount = 0;

  for (const manual of data) {
    try {
      const result = await indexManualById(manual.id);
      const { count, error: countError } = await supabase
        .from("manual_chunks")
        .select("id", { count: "exact", head: true })
        .eq("manual_id", manual.id)
        .not("embedding", "is", null);

      if (countError) {
        throw new Error(`저장된 청크 확인 실패: ${countError.message}`);
      }
      if (result.chunkCount < 1 || count !== result.chunkCount) {
        throw new Error(
          `청크 검증 실패: 생성 ${result.chunkCount}개, 저장 ${count ?? 0}개`,
        );
      }

      console.log(
        `[Index] 매뉴얼 ID ${result.manualId} 완료, 청크 수: ${result.chunkCount}개`,
      );
    } catch (error) {
      failedCount += 1;
      console.error(
        `[Index] 매뉴얼 ID ${manual.id} 실패: ${getSafeErrorMessage(error)}`,
      );
    }
  }

  if (failedCount > 0) {
    throw new Error(`${failedCount}개 매뉴얼의 인덱싱 또는 청크 검증에 실패했습니다.`);
  }

  console.log(`[Index] 승인 매뉴얼 ${data.length}개 인덱싱 및 청크 검증 완료`);
}

main().catch((error: unknown) => {
  console.error(`[Index] 실행 실패: ${getSafeErrorMessage(error)}`);
  process.exitCode = 1;
});