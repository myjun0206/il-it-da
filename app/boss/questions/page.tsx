import BossQuestionsView from "./BossQuestionsView";

function firstParam(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw?.trim() || null;
}

export default async function BossQuestionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;

  return (
    <BossQuestionsView
      requestedStoreId={firstParam(params.storeId)}
      highlightQuestionId={firstParam(params.questionId)}
    />
  );
}
