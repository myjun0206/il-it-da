-- 벡터 유사도 + 키워드 매칭을 결합한 하이브리드 검색 RPC

-- 확장이 어느 스키마(public/extensions)에 설치되어 있든 타입/함수를 찾도록 세션 search_path에 둘 다 포함
create extension if not exists vector;
create extension if not exists pg_trgm;
set search_path = public, extensions;

create or replace function public.match_manual_chunks_hybrid(
  query_embedding vector(1536),
  query_text text,
  match_count integer default 5
)
returns table (
  chunk_id uuid,
  manual_id uuid,
  title text,
  category text,
  content text,
  similarity_score double precision
)
language sql
stable
set search_path = public, extensions
as $$
  select
    mc.id as chunk_id,
    m.id as manual_id,
    m.title,
    m.category,
    mc.content,
    least(
      1.0,
      (1 - (mc.embedding <=> query_embedding))
        + case
            when query_text is not null
              and length(trim(query_text)) > 0
              and (
                position(lower(trim(query_text)) in lower(m.title)) > 0
                or position(lower(trim(query_text)) in lower(mc.content)) > 0
                or similarity(lower(m.title), lower(trim(query_text))) > 0.3
                or similarity(lower(mc.content), lower(trim(query_text))) > 0.3
              )
            then 0.30
            else 0
          end
    ) as similarity_score
  from public.manual_chunks as mc
  join public.manuals as m on m.id = mc.manual_id
  where m.status = 'approved'
    and mc.embedding is not null
  order by similarity_score desc
  limit greatest(match_count, 0);
$$;
