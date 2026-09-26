-- 018: manuals.parent_manual_id FK를 ON DELETE SET NULL -> ON DELETE CASCADE로 변경.
--
-- 배경: 010_franchises_and_hq_manuals.sql에서 만든 manuals_parent_manual_id_fkey는
-- "on delete set null"이었다. 이 때문에 부모(타이틀) 행을 지워도 DB가 자식(세부 매뉴얼)
-- 행을 자동으로 지워주지 않고, 자식들의 parent_manual_id만 null로 바뀌어 "고아 데이터"
-- (원래 속했던 카테고리/타이틀과의 연결이 끊긴 채 DB에 남는 행)가 될 위험이 있었다.
-- 현재 애플리케이션 코드(app/api/manuals/[id], app/api/manuals/route.ts의
-- delete-category, app/api/store-manuals/[id], app/api/store-manuals/route.ts의
-- delete-category 등)는 전부 자식을 먼저 지운 뒤 부모를 지우는 방식으로 이 문제를
-- 애플리케이션 레벨에서 이미 우회하고 있었지만, 앞으로 추가될 삭제 경로가 이 규칙을
-- 놓치더라도 데이터가 깨지지 않도록 DB 레벨에서도 안전망을 건다.
do $$
begin
  if to_regclass('public.manuals') is null then
    return;
  end if;

  if exists (
    select 1
    from pg_constraint
    where conname = 'manuals_parent_manual_id_fkey'
      and conrelid = 'public.manuals'::regclass
  ) then
    alter table public.manuals drop constraint manuals_parent_manual_id_fkey;
  end if;

  alter table public.manuals
    add constraint manuals_parent_manual_id_fkey
    foreign key (parent_manual_id) references public.manuals(id) on delete cascade;
end
$$;
