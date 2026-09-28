-- 022: Staff AI 대화 기록 (conversations / conversation_messages)
--
-- 직원이 AI 챗봇과 나눈 대화를 매장(store) 단위로 저장한다.
-- - 대화(conversation)는 생성 시점의 store_id에 고정되며 이후 바뀌지 않는다.
-- - 첫 질문을 보낼 때 서버가 생성한다(빈 대화 row를 만들지 않음).
-- - 읽기/쓰기는 서버 API(/api/staff/chat, /api/staff/conversations)가 service role로
--   "본인 대화인지(user_id)"와 "해당 매장의 승인된 직원인지(store_memberships)"를 검증한 뒤 수행한다.
--   그래서 RLS만 켜 두고 anon/authenticated 직접 접근 정책은 만들지 않는다.
-- question_logs(RAG 품질 분석용 로그)와는 별개다.

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  title text not null check (length(btrim(title)) > 0),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists conversations_user_updated_at_idx
  on public.conversations (user_id, updated_at desc);

create table if not exists public.conversation_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  -- assistant 답변의 RAG 결과 요약 (표시용)
  status text check (status is null or status in ('answered', 'cautious', 'insufficient')),
  source_title text,
  source_category text,
  similarity double precision,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists conversation_messages_conversation_created_at_idx
  on public.conversation_messages (conversation_id, created_at);

alter table public.conversations enable row level security;
alter table public.conversation_messages enable row level security;
