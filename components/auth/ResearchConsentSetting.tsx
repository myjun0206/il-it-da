"use client";

import { useEffect, useState } from "react";
import { RESEARCH_CONSENT_TITLE } from "@/lib/auth/signup-research-consent";

export default function ResearchConsentSetting() {
  const [accepted, setAccepted] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/auth/research-consent", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok || !data.ok || typeof data.accepted !== "boolean") throw new Error();
        if (!controller.signal.aborted) setAccepted(data.accepted);
      })
      .catch(() => { if (!controller.signal.aborted) setError("선택 동의를 불러오지 못했습니다."); });
    return () => controller.abort();
  }, []);

  const change = async (next: boolean) => {
    if (saving || accepted === null) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/auth/research-consent", {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accepted: next }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok || typeof data.accepted !== "boolean") throw new Error();
      setAccepted(data.accepted);
    } catch {
      setError("선택 동의를 저장하지 못했습니다. 다시 시도해 주세요.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="my-6 border-t border-[var(--color-border)] pt-6" aria-label="선택 안내 수신">
      <h2 className="mb-3 text-lg font-semibold text-[var(--color-text-primary)]">선택 안내 수신</h2>
      <label className="flex min-h-11 items-start gap-3 text-sm text-[var(--color-text-primary)]">
        <input type="checkbox" checked={accepted === true} disabled={accepted === null || saving}
          onChange={(event) => void change(event.target.checked)} className="mt-1 h-5 w-5 shrink-0 accent-[var(--color-primary)]" />
        <span className="min-w-0 break-words">{RESEARCH_CONSENT_TITLE}</span>
      </label>
      <p className="mt-2 text-sm text-[var(--color-text-secondary)]">미동의로 변경하면 철회됩니다. 현재 설문·인터뷰 안내는 발송하지 않습니다.</p>
      {error && <p role="alert" className="mt-2 text-sm text-[var(--color-status-error)]">{error}</p>}
    </section>
  );
}