import Link from "next/link";
import { ArrowLeft } from "lucide-react";

// 홈의 "확인이 필요한 업무" 카드에서 진입하는 업무 화면 공통 back navigation.
export default function BackToHomeLink() {
  return (
    <Link
      href="/hq"
      className="-ml-2 mb-3 inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
    >
      <ArrowLeft size={16} aria-hidden="true" />
      홈으로
    </Link>
  );
}
