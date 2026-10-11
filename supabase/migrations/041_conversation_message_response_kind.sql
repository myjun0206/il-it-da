begin;

alter table public.conversation_messages
  add column if not exists response_kind text;

alter table public.conversation_messages
  add constraint conversation_messages_response_kind_check
  check (response_kind is null or response_kind in ('answer', 'clarification'));

alter table public.conversation_messages
  add constraint conversation_messages_user_response_kind_check
  check (role <> 'user' or response_kind is null);

commit;