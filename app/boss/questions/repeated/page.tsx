import RepeatedQuestionView from "./RepeatedQuestionView";

function firstParam(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw?.trim() || null;
}

export default async function BossRepeatedQuestionPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;

  return <RepeatedQuestionView storeId={firstParam(params.storeId)} alertId={firstParam(params.alertId)} />;
}
