-- pgvector cosine distance (<=>)를 cosine similarity로 변환합니다.
create or replace function public.match_manual_chunks(
  query_embedding extensions.vector(1536),
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
    1 - (mc.embedding <=> query_embedding) as similarity_score
  from public.manual_chunks as mc
  join public.manuals as m on m.id = mc.manual_id
  where m.status = 'approved'
    and mc.embedding is not null
  order by mc.embedding <=> query_embedding asc
  limit greatest(least(coalesce(match_count, 5), 10), 0);
$$;