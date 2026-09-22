-- 011: Notifications system for app events
-- 
-- Records user-facing notifications for:
-- - Staff pending approval requests (recipient: store owner)
-- - Owner pending approval requests (recipient: HQ admins)
-- - Approval decisions (approve/reject) (recipient: requester)
-- - New notices posted (recipient: store staff)
-- - Manual updates (recipient: relevant users)
--
-- RLS: Each user can only read their own notifications

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_user_id uuid not null,
  type text not null,
  title text not null,
  message text not null,
  target_url text,
  related_id text,
  is_read boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

-- Indexes for common queries
create index if not exists notifications_recipient_id_idx
  on public.notifications (recipient_user_id);

create index if not exists notifications_recipient_is_read_idx
  on public.notifications (recipient_user_id, is_read);

create index if not exists notifications_recipient_created_at_idx
  on public.notifications (recipient_user_id, created_at desc);

-- Foreign key to auth.users
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'notifications_recipient_user_id_fkey'
      and conrelid = 'public.notifications'::regclass
  ) then
    alter table public.notifications
      add constraint notifications_recipient_user_id_fkey
      foreign key (recipient_user_id) references auth.users(id) on delete cascade;
  end if;
end $$;

-- RLS Policies: Each user can only read their own notifications
alter table public.notifications enable row level security;

drop policy if exists "Users can read own notifications" on public.notifications;
create policy "Users can read own notifications" on public.notifications
  for select using (recipient_user_id = auth.uid());

drop policy if exists "Users can update own notifications" on public.notifications;
create policy "Users can update own notifications" on public.notifications
  for update using (recipient_user_id = auth.uid());
