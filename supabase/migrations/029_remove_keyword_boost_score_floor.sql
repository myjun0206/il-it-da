-- 029: 018 hybrid RPC의 keyword_boost 0.60 바닥을 걷어낸다.
--
-- 배경: 018은 keyword_boost가 0.35(환불/규정/결제/취소 계열)일 때
--   greatest(0.60, raw_similarity_score + keyword_boost)
-- 로 최종 점수를 계산한다. 원래 의미 유사도가 0에 가까워도 단어만 겹치면 0.60이 되어,
-- 랭킹에서 진짜 근거(예: raw 0.55)보다 무관한 청크가 위로 올라올 수 있다.
--
-- 이 마이그레이션은 함수 이름·인자·반환 컬럼을 018과 완전히 동일하게 유지하고,
-- 점수 계산에서 바닥값만 제거한다(랭킹 순서만 바뀌고 계약은 그대로다).
-- 기존 데이터/임베딩은 읽지도 바꾸지도 않는다.
--
-- 적용 순서와 호환성:
--   - 앱 코드는 이미 raw_similarity_score 기준으로 답변 가능 여부를 판정하므로
--     (lib/rag/evidence-gate.ts), 029 적용 전에도 후에도 동작한다.
--   - 029는 similarity_score를 낮출 수 있으나 앱의 answered/cautious 판정에는 쓰이지 않는다.
--     similarity_score는 RPC 내부 정렬과 응답의 matches 표시용으로만 남는다.
--   - 018을 아직 적용하지 않았다면 018 → 029 순서로 적용한다.

create or replace function public.match_manual_chunks_hybrid_scoped(
  query_embedding extensions.vector(1536),
  query_text text,
  query_keywords text[],
  target_store_id uuid,
  target_franchise_id uuid,
  match_count integer default 5
)
returns table (
  chunk_id uuid,
  manual_id uuid,
  title text,
  category text,
  content text,
  raw_similarity_score double precision,
  keyword_boost double precision,
  similarity_score double precision
)
language sql
stable
set search_path = public, extensions
as $$
  with scored as (
    select
      mc.id as chunk_id,
      m.id as manual_id,
      m.title,
      m.category,
      mc.content,
      1 - (mc.embedding <=> query_embedding) as raw_similarity_score,
      case
        when (
          lower(query_text) like any (array['%환불%', '%규정%', '%결제%', '%취소%'])
          or coalesce(query_keywords, array[]::text[]) && array['환불', '규정', '결제', '취소']::text[]
        ) and (
          lower(coalesce(m.title, '')) like any (array['%환불%', '%결제%'])
          or lower(coalesce(mc.content, '')) like any (array['%환불%', '%결제%'])
        ) then 0.35
        when position(lower(query_text) in lower(m.title)) > 0 then 0.30
        when position(lower(query_text) in lower(mc.content)) > 0 then 0.25
        when exists (
          select 1
          from unnest(coalesce(query_keywords, array[]::text[])) as keywords(keyword)
          where length(keyword) >= 2
            and position(lower(keyword) in lower(m.title)) > 0
        ) then 0.25
        when exists (
          select 1
          from unnest(coalesce(query_keywords, array[]::text[])) as keywords(keyword)
          where length(keyword) >= 2
            and position(lower(keyword) in lower(mc.content)) > 0
        ) then 0.20
        else 0.0
      end::double precision as keyword_boost
    from public.manual_chunks as mc
    join public.manuals as m on m.id = mc.manual_id
    where m.status = 'approved'
      and mc.embedding is not null
      and (
        (m.scope_type = 'store' and m.store_id = target_store_id)
        or
        (m.scope_type = 'hq' and m.store_id is null and m.franchise_id = target_franchise_id)
      )
  )
  select
    scored.chunk_id,
    scored.manual_id,
    scored.title,
    scored.category,
    scored.content,
    scored.raw_similarity_score,
    scored.keyword_boost,
    least(1.0, scored.raw_similarity_score + scored.keyword_boost) as similarity_score
  from scored
  order by similarity_score desc, raw_similarity_score desc
  limit greatest(least(coalesce(match_count, 5), 10), 0);
$$;
