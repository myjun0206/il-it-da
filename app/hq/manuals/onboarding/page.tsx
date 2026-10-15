"use client";

import { useRouter } from "next/navigation";
import HQManualUpload from "@/components/manuals/HQManualUpload";
import { manualSaveMessage } from "@/lib/manuals/manual-save-result";

export default function ManualOnboardingPage() {
  const router = useRouter();

  return (
    <HQManualUpload
      onClose={() => router.replace("/hq/manuals/common")}
      onSaved={(data) => {
        try {
          sessionStorage.setItem("ilitda:manual-upload-notice", manualSaveMessage(data));
        } catch {}
        router.replace("/hq/manuals/common?saved=1");
      }}
    />
  );
}