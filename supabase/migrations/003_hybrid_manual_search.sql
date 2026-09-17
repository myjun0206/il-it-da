create or replace function public.match_manual_chunks_hybrid(
  query_embedding extensions.vector(1536),
  query_text text,
  query_keywords text[],
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