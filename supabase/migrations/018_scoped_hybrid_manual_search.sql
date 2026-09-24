-- 018: HQ 공통 매뉴얼 + 자기 지점 매뉴얼만 검색되는 scoped hybrid RPC.
--
-- 배경: lib/rag/search-manual-chunks.ts가 실제로 호출하는 005의
-- match_manual_chunks_hybrid_by_store(target_store_id)는 store_id = target_store_id만
-- 검색한다. scope_type='hq' + store_id is null인 "본사 공통 매뉴얼"은 store_id가
-- target_store_id와 다르므로(항상 null) 이 함수로는 절대 검색되지 않는다.
--
-- 010의 match_manual_chunks(query_embedding, match_count, p_franchise_id, p_store_id)는
-- franchise_id/store_id 계층을 인식하지만, 005의 hybrid keyword_boost/similarity_score
-- 계산이 없는 순수 코사인 유사도 전용 함수라 이 프로젝트의 기존 RAG 응답 계약
-- (raw_similarity_score/keyword_boost/similarity_score 3필드, threshold 계산 기준)을
-- 그대로 대체할 수 없다. 그래서 003/005/010의 기존 함수는 전혀 수정하지 않고,
-- 005의 hybrid 점수 계산 로직을 그대로 보존한 새 함수를 추가한다.
--
-- 허용 범위(둘 중 하나):
--   1) store 전용: m.scope_type = 'store' and m.store_id = target_store_id
--   2) HQ 공통:   m.scope_type = 'hq' and m.store_id is null and m.franchise_id = target_franchise_id
-- 그 외(다른 franchise의 HQ 공통, 다른 store의 store 전용, draft, embedding null)는 전부 제외한다.
--
-- 앱 코드(lib/rag/search-manual-chunks.ts)는 이 새 이름의 RPC로만 전환하고,
-- 기존 match_manual_chunks_hybrid_by_store 호출부는 남기지 않는다(더 이상 호출되지 않음).
-- SECURITY DEFINER는 사용하지 않는다: 이 RPC는 항상 서비스 롤 클라이언트
-- (lib/supabase/admin.ts)를 통해서만 호출되므로 호출자 권한 상승이 필요 없고,
-- 기존 003/005/010의 동일 계열 함수들도 SECURITY DEFINER를 쓰지 않는 것과 일관된다.

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
    least(
      1.0,
      case
        when scored.keyword_boost = 0.35
          then greatest(0.60, scored.raw_similarity_score + scored.keyword_boost)
        else scored.raw_similarity_score + scored.keyword_boost
      end
    ) as similarity_score
  from scored
  order by similarity_score desc, raw_similarity_score desc
  limit greatest(least(coalesce(match_count, 5), 10), 0);
$$;
