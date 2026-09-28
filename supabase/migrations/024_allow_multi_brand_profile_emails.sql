-- 024: Allow one auth email to be represented by multiple brand profiles.
--
-- Brand-scoped profile rows intentionally copy the master profile email. The
-- old global lower(email) uniqueness rule therefore conflicts with the
-- multi-brand profile model. Email uniqueness belongs to auth.users; profile
-- identity is enforced by the user_id/brand_id indexes from migration 023.

begin;

-- Some environments created this as a table constraint, while others created
-- it as a standalone unique index. Handle both shapes safely.
alter table public.profiles
  drop constraint if exists profiles_email_lower_key;

drop index if exists public.profiles_email_lower_key;

commit;
