import BossQuestionDetailView from "./BossQuestionDetailView";

function firstParam(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw?.trim() || null;
}

export default async function BossQuestionDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);

  return (
    <BossQuestionDetailView
      questionId={id}
      requestedStoreId={firstParam(query.storeId)}
    />
  );
}