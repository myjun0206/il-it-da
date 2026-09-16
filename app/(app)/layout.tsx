import { AppShell } from "@/components/layout/AppShell";

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // TODO: 세션에서 userRole, userName 가져오기
  const userRole = "staff" as const;
  const userName = "테스트 사용자";

  return (
    <AppShell userRole={userRole} userName={userName}>
      {children}
    </AppShell>
  );
}
