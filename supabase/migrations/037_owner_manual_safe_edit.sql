begin;

create or replace function public.lock_manual_hierarchy_write()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, extensions
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('MANUAL_CONTRACT_V2:HIERARCHY', 0));
  return null;
end;
$$;
do $$
begin
  if exists(select 1 from pg_catalog.pg_trigger where tgrelid = 'public.manuals'::regclass
    and tgname = 'lock_manual_hierarchy_write'
    and tgfoid <> 'public.lock_manual_hierarchy_write()'::regprocedure) then
    raise exception 'MANUAL_CONTRACT_V2:TRIGGER_NAME_CONFLICT';
  end if;
end;
$$;
drop trigger if exists lock_manual_hierarchy_write on public.manuals;
create trigger lock_manual_hierarchy_write before insert or update or delete on public.manuals
for each statement execute function public.lock_manual_hierarchy_write();

create or replace function public.invalidate_changed_manual_chunks()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, extensions
as $$
begin
  if new.updated_at is null then
    raise exception using errcode = '22023', message = 'MANUAL_CONTRACT_V2:REVISION_REQUIRED';
  end if;
  new.updated_at := greatest(clock_timestamp(), old.updated_at + interval '1 microsecond');
  if row(new.title, new.category, new.content, new.brand_name, new.status,
         new.store_id, new.franchise_id, new.parent_manual_id, new.scope_type)
     is distinct from
     row(old.title, old.category, old.content, old.brand_name, old.status,
         old.store_id, old.franchise_id, old.parent_manual_id, old.scope_type) then
    new.updated_at := greatest(clock_timestamp(), old.updated_at + interval '1 microsecond');
    delete from public.manual_chunks where manual_id = old.id;
  end if;
  return new;
end;
$$;

do $$
begin
  if exists(select 1 from pg_catalog.pg_trigger where tgrelid = 'public.manuals'::regclass
    and tgname = 'invalidate_changed_manual_chunks'
    and tgfoid <> 'public.invalidate_changed_manual_chunks()'::regprocedure) then
    raise exception 'MANUAL_CONTRACT_V2:TRIGGER_NAME_CONFLICT';
  end if;
end;
$$;
drop trigger if exists invalidate_changed_manual_chunks on public.manuals;
create trigger invalidate_changed_manual_chunks
before update on public.manuals
for each row execute function public.invalidate_changed_manual_chunks();

create or replace function public.invalidate_manual_parent_chunks()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, extensions
as $$
declare
  parent_id uuid;
  parent_row public.manuals%rowtype;
  expected_store uuid;
  expected_franchise uuid;
  expected_scope text;
  ancestor_id uuid;
  visited_ids uuid[];
  child_row record;
begin
  if tg_op = 'UPDATE' and row(new.parent_manual_id,new.store_id,new.franchise_id,new.scope_type)
    is not distinct from row(old.parent_manual_id,old.store_id,old.franchise_id,old.scope_type) then return new; end if;
  if (lower(new.scope_type) = 'store' and new.store_id is null)
    or (lower(new.scope_type) in ('hq','common','shared') and new.store_id is not null) then
    raise exception using errcode = '42501', message = 'MANUAL_CONTRACT_V2:INVALID_SCOPE';
  end if;
  if new.store_id is not null and not exists(select 1 from public.stores
    where id = new.store_id and franchise_id is not distinct from new.franchise_id) then
    raise exception using errcode = '42501', message = 'MANUAL_CONTRACT_V2:STORE_FRANCHISE_MISMATCH';
  end if;
  visited_ids := array[new.id];
  ancestor_id := new.parent_manual_id;
  while ancestor_id is not null loop
    if ancestor_id = any(visited_ids) then
      raise exception using errcode = '23514', message = 'MANUAL_CONTRACT_V2:PARENT_CYCLE';
    end if;
    visited_ids := array_append(visited_ids, ancestor_id);
    select parent_manual_id into ancestor_id from public.manuals where id = ancestor_id;
    if not found then raise exception using errcode = '23503', message = 'MANUAL_CONTRACT_V2:PARENT_NOT_FOUND'; end if;
  end loop;
  for child_row in select store_id,franchise_id,scope_type from public.manuals where parent_manual_id = new.id loop
    if child_row.franchise_id is distinct from new.franchise_id
      or not (child_row.store_id is not distinct from new.store_id
        or coalesce((new.store_id is null and lower(new.scope_type) in ('hq','common','shared') and lower(child_row.scope_type) = 'store'), false)) then
      raise exception using errcode = '42501', message = 'MANUAL_CONTRACT_V2:CHILD_SCOPE_DENIED';
    end if;
  end loop;
  for parent_id in select distinct candidate from unnest(
    array[new.parent_manual_id, case when tg_op = 'UPDATE' then old.parent_manual_id else null end]
  ) as parents(candidate) where candidate is not null order by candidate loop
    select * into parent_row from public.manuals where id = parent_id for update;
    if not found then raise exception using errcode = '23503', message = 'MANUAL_CONTRACT_V2:PARENT_NOT_FOUND'; end if;
    if tg_op = 'UPDATE' and parent_id = old.parent_manual_id and parent_id is distinct from new.parent_manual_id then
      expected_store := old.store_id; expected_franchise := old.franchise_id; expected_scope := old.scope_type;
    else
      expected_store := new.store_id; expected_franchise := new.franchise_id; expected_scope := new.scope_type;
    end if;
    if parent_row.franchise_id is distinct from expected_franchise
      or not (parent_row.store_id is not distinct from expected_store
        or coalesce((parent_row.store_id is null and lower(parent_row.scope_type) in ('hq','common','shared') and lower(expected_scope) = 'store'), false)) then
      raise exception using errcode = '42501', message = 'MANUAL_CONTRACT_V2:PARENT_SCOPE_DENIED';
    end if;
    update public.manuals set updated_at = greatest(clock_timestamp(), updated_at + interval '1 microsecond') where id = parent_id;
    delete from public.manual_chunks where manual_id = parent_id;
  end loop;
  return new;
end;
$$;
do $$
begin
  if exists(select 1 from pg_catalog.pg_trigger where tgrelid = 'public.manuals'::regclass
    and tgname = 'invalidate_manual_parent_chunks'
    and tgfoid <> 'public.invalidate_manual_parent_chunks()'::regprocedure) then
    raise exception 'MANUAL_CONTRACT_V2:TRIGGER_NAME_CONFLICT';
  end if;
end;
$$;
drop trigger if exists invalidate_manual_parent_chunks on public.manuals;
create trigger invalidate_manual_parent_chunks before insert or update of parent_manual_id,store_id,franchise_id,scope_type on public.manuals
for each row execute function public.invalidate_manual_parent_chunks();

create or replace function public.edit_store_manual_if_current(
  p_user_id uuid, p_store_id uuid, p_franchise_id uuid, p_manual_id uuid,
  p_expected_updated_at timestamptz, p_update jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, extensions
as $$
declare
  current_manual public.manuals%rowtype;
  field_name text;
begin
  if not exists (
    select 1 from public.store_memberships sm
    join public.stores s on s.id = sm.store_id
    where sm.user_id = p_user_id and sm.store_id = p_store_id
      and sm.role = 'owner' and sm.status = 'approved'
      and s.franchise_id = p_franchise_id
  ) then
    raise exception using errcode = '42501', message = 'OWNER_SCOPE_DENIED';
  end if;
  if jsonb_typeof(p_update) is distinct from 'object' or p_update = '{}'::jsonb
    or p_expected_updated_at is null then
    raise exception using errcode = '22023', message = 'MANUAL_CONTRACT_V2:INVALID_MANUAL_EDIT';
  end if;
  for field_name in select jsonb_object_keys(p_update) loop
    if field_name not in ('title', 'category', 'content')
      or jsonb_typeof(p_update -> field_name) is distinct from 'string'
      or btrim(p_update ->> field_name, E' \t\n\r') = '' then
      raise exception using errcode = '22023', message = 'INVALID_MANUAL_FIELD';
    end if;
  end loop;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('MANUAL_CONTRACT_V2:HIERARCHY', 0));
  select * into current_manual from public.manuals
    where id = p_manual_id and store_id = p_store_id and franchise_id = p_franchise_id
    for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'STORE_MANUAL_NOT_FOUND';
  end if;
  if current_manual.updated_at is distinct from p_expected_updated_at then
    raise exception using errcode = '40001', message = 'MANUAL_EDIT_CONFLICT';
  end if;
  update public.manuals set
    title = coalesce(p_update ->> 'title', title),
    category = coalesce(p_update ->> 'category', category),
    content = coalesce(p_update ->> 'content', content),
    updated_at = greatest(clock_timestamp(), updated_at + interval '1 microsecond')
    where id = p_manual_id returning * into current_manual;
  return jsonb_build_object('manual', to_jsonb(current_manual), 'hasChildren',
    exists(select 1 from public.manuals where parent_manual_id = p_manual_id));
end;
$$;

create or replace function public.replace_manual_chunks_if_current(
  p_manual_id uuid, p_expected_snapshot jsonb, p_chunks jsonb
)
returns integer
language plpgsql
security invoker
set search_path = pg_catalog, extensions
as $$
declare
  current_manual public.manuals%rowtype;
  chunk jsonb;
  chunk_number integer := 0;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('MANUAL_CONTRACT_V2:HIERARCHY', 0));
  select * into current_manual from public.manuals where id = p_manual_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'MANUAL_CONTRACT_V2:MANUAL_NOT_FOUND';
  end if;
  if jsonb_typeof(p_expected_snapshot) is distinct from 'object'
    or not (p_expected_snapshot ?& array['id', 'updated_at', 'content', 'title', 'category', 'brand_name', 'status', 'franchise_id', 'store_id', 'scope_type', 'parent_manual_id']) then
    raise exception using errcode = '22023', message = 'INVALID_SNAPSHOT';
  end if;
  if current_manual.status <> 'approved'
    or current_manual.updated_at is distinct from (p_expected_snapshot ->> 'updated_at')::timestamptz
    or current_manual.content is distinct from p_expected_snapshot ->> 'content'
    or current_manual.title is distinct from p_expected_snapshot ->> 'title'
    or current_manual.category is distinct from p_expected_snapshot ->> 'category'
    or current_manual.brand_name is distinct from p_expected_snapshot ->> 'brand_name'
    or current_manual.id is distinct from (p_expected_snapshot ->> 'id')::uuid
    or current_manual.franchise_id is distinct from (p_expected_snapshot ->> 'franchise_id')::uuid
    or current_manual.store_id is distinct from (p_expected_snapshot ->> 'store_id')::uuid
    or current_manual.parent_manual_id is distinct from (p_expected_snapshot ->> 'parent_manual_id')::uuid
    or current_manual.scope_type is distinct from p_expected_snapshot ->> 'scope_type'
    or current_manual.status is distinct from p_expected_snapshot ->> 'status' then
    raise exception using errcode = '40001', message = 'MANUAL_INDEX_CONFLICT';
  end if;
  if exists(select 1 from public.manuals where parent_manual_id = p_manual_id) then
    raise exception using errcode = '22023', message = 'PARENT_NOT_SEARCHABLE';
  end if;
  if jsonb_typeof(p_chunks) is distinct from 'array' then
    raise exception using errcode = '22023', message = 'INVALID_CHUNKS';
  end if;
  if jsonb_array_length(p_chunks) not between 1 and 100 then
    raise exception using errcode = '22023', message = 'INVALID_CHUNK_COUNT';
  end if;
  delete from public.manual_chunks where manual_id = p_manual_id;
  for chunk in select value from jsonb_array_elements(p_chunks) loop
    if (chunk ->> 'manual_id')::uuid is distinct from p_manual_id
      or (chunk ->> 'chunk_index')::integer is distinct from chunk_number
      or jsonb_typeof(chunk -> 'content') is distinct from 'string'
      or btrim(chunk ->> 'content', E' \t\n\r') = ''
      or jsonb_typeof(chunk -> 'embedding') is distinct from 'array' then
      raise exception using errcode = '22023', message = 'INVALID_CHUNK';
    end if;
    if jsonb_array_length(chunk -> 'embedding') <> 1536 then
      raise exception using errcode = '22023', message = 'INVALID_EMBEDDING_DIMENSION';
    end if;
    if exists(select 1 from jsonb_array_elements(chunk -> 'embedding') as component(value)
      where jsonb_typeof(value) <> 'number') then
      raise exception using errcode = '22023', message = 'INVALID_EMBEDDING_COMPONENT';
    end if;
    insert into public.manual_chunks(manual_id, chunk_index, content, embedding)
    values(p_manual_id, chunk_number, chunk ->> 'content', (chunk ->> 'embedding')::extensions.vector(1536));
    chunk_number := chunk_number + 1;
  end loop;
  return chunk_number;
end;
$$;

create or replace function public.check_manual_write_contract()
returns integer
language plpgsql
stable
security invoker
set search_path = pg_catalog, extensions
as $$
declare
  function_id oid;
  signature text;
  relation_name text;
begin
  if not has_schema_privilege('service_role','public','USAGE')
    or not has_schema_privilege('service_role','extensions','USAGE') then return 0; end if;
  for relation_name in select unnest(array['public.manuals','public.manual_chunks','public.stores','public.store_memberships']) loop
    if not has_table_privilege('service_role',relation_name,'SELECT') then return 0; end if;
  end loop;
  if not has_table_privilege('service_role','public.manuals','INSERT')
    or not has_table_privilege('service_role','public.manuals','UPDATE')
    or not has_table_privilege('service_role','public.manual_chunks','INSERT')
    or not has_table_privilege('service_role','public.manual_chunks','DELETE') then return 0; end if;
  if exists(select 1 from pg_proc where pronamespace = 'public'::regnamespace
    and proname in ('edit_store_manual_if_current','replace_manual_chunks_if_current','invalidate_changed_manual_chunks','invalidate_manual_parent_chunks','lock_manual_hierarchy_write')
    group by proname having count(*) <> 1) then return 0; end if;
  for signature in select unnest(array[
    'public.edit_store_manual_if_current(uuid,uuid,uuid,uuid,timestamp with time zone,jsonb)',
    'public.replace_manual_chunks_if_current(uuid,jsonb,jsonb)',
    'public.invalidate_changed_manual_chunks()',
    'public.invalidate_manual_parent_chunks()',
    'public.lock_manual_hierarchy_write()'
  ]) loop
    function_id := to_regprocedure(signature);
    if function_id is null then return 0; end if;
    if not has_function_privilege('service_role', function_id, 'EXECUTE')
      or has_function_privilege('anon', function_id, 'EXECUTE')
      or has_function_privilege('authenticated', function_id, 'EXECUTE') then return 0; end if;
    if not exists(select 1 from pg_proc where oid = function_id
      and proconfig @> array['search_path=pg_catalog, extensions']
      and pg_get_functiondef(oid) like '%MANUAL_CONTRACT_V2%') then return 0; end if;
  end loop;
  if not exists(select 1 from pg_proc where oid = 'public.edit_store_manual_if_current(uuid,uuid,uuid,uuid,timestamp with time zone,jsonb)'::regprocedure
    and not prosecdef and prorettype = 'jsonb'::regtype
    and proargnames = array['p_user_id','p_store_id','p_franchise_id','p_manual_id','p_expected_updated_at','p_update']) then return 0; end if;
  if not exists(select 1 from pg_proc where oid = 'public.replace_manual_chunks_if_current(uuid,jsonb,jsonb)'::regprocedure
    and not prosecdef and prorettype = 'integer'::regtype
    and proargnames = array['p_manual_id','p_expected_snapshot','p_chunks']) then return 0; end if;
  if not exists(select 1 from pg_proc where oid = 'public.invalidate_changed_manual_chunks()'::regprocedure
    and prosecdef and prorettype = 'trigger'::regtype) then return 0; end if;
  if not exists(select 1 from pg_trigger where tgrelid = 'public.manuals'::regclass
    and tgname = 'invalidate_changed_manual_chunks' and not tgisinternal
    and tgfoid = 'public.invalidate_changed_manual_chunks()'::regprocedure
    and tgenabled in ('O','A') and tgtype = 19 and tgqual is null and tgattr = ''::int2vector) then return 0; end if;
  if exists(select 1 from pg_trigger where tgrelid = 'public.manuals'::regclass
    and not tgisinternal and tgname not in ('invalidate_changed_manual_chunks','invalidate_manual_parent_chunks','lock_manual_hierarchy_write')
    and (tgtype & 20) <> 0 and tgenabled in ('O','A')) then return 0; end if;
  if not exists(select 1 from pg_trigger where tgrelid = 'public.manuals'::regclass
    and tgname = 'invalidate_manual_parent_chunks' and not tgisinternal
    and tgfoid = 'public.invalidate_manual_parent_chunks()'::regprocedure and tgenabled in ('O','A')
    and tgtype = 23 and tgqual is null
    and (select array_agg(attribute.attname::text order by attribute.attname) from unnest(tgattr) as columns(attnum)
      join pg_attribute attribute on attribute.attrelid = 'public.manuals'::regclass and attribute.attnum = columns.attnum)
      = array['franchise_id','parent_manual_id','scope_type','store_id']) then return 0; end if;
  if not exists(select 1 from pg_proc where oid = 'public.invalidate_manual_parent_chunks()'::regprocedure
    and prosecdef and prorettype = 'trigger'::regtype) then return 0; end if;
  if not exists(select 1 from pg_proc where oid = 'public.lock_manual_hierarchy_write()'::regprocedure
    and not prosecdef and prorettype = 'trigger'::regtype) then return 0; end if;
  if not exists(select 1 from pg_trigger where tgrelid = 'public.manuals'::regclass
    and tgname = 'lock_manual_hierarchy_write' and not tgisinternal
    and tgfoid = 'public.lock_manual_hierarchy_write()'::regprocedure and tgenabled in ('O','A')
    and tgtype = 30 and tgqual is null and tgattr = ''::int2vector) then return 0; end if;
  if exists(select 1 from pg_trigger where tgrelid = 'public.manual_chunks'::regclass
    and not tgisinternal and (tgtype & 28) <> 0 and tgenabled in ('O','A')) then return 0; end if;
  if not exists(select 1 from pg_attribute where attrelid = 'public.manual_chunks'::regclass
    and attname = 'embedding' and atttypid = 'extensions.vector'::regtype and atttypmod = 1536) then return 0; end if;
  if not exists(select 1 from pg_index indexes where indrelid = 'public.manual_chunks'::regclass
    and indisunique and indisvalid and indisready and indimmediate and indpred is null and indexprs is null and indnkeyatts = 2
    and (select array_agg(attribute.attname::text order by attribute.attname)
      from unnest(indexes.indkey) with ordinality as keys(attnum,key_position)
      join pg_attribute attribute on attribute.attrelid = indexes.indrelid and attribute.attnum = keys.attnum
      where keys.key_position <= indexes.indnkeyatts) = array['chunk_index','manual_id']) then return 0; end if;
  if (select count(*) from pg_attribute where attrelid = 'public.manuals'::regclass and not attisdropped
    and attname in ('id','updated_at','title','category','content','brand_name','status','franchise_id','store_id','scope_type','parent_manual_id')) <> 11 then return 0; end if;
  if exists(select 1 from (values
    ('id','uuid'),('updated_at','timestamp with time zone'),('title','text'),('category','text'),('content','text'),
    ('brand_name','text'),('status','text'),('franchise_id','uuid'),('store_id','uuid'),('scope_type','text'),('parent_manual_id','uuid')
  ) as expected(column_name,type_name) where not exists(select 1 from pg_attribute
    where attrelid = 'public.manuals'::regclass and attname = expected.column_name
      and atttypid = expected.type_name::regtype and not attisdropped)) then return 0; end if;
  return 2;
end;
$$;

revoke all on function public.invalidate_changed_manual_chunks() from public, anon, authenticated;
revoke all on function public.edit_store_manual_if_current(uuid, uuid, uuid, uuid, timestamptz, jsonb) from public, anon, authenticated;
revoke all on function public.replace_manual_chunks_if_current(uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.edit_store_manual_if_current(uuid, uuid, uuid, uuid, timestamptz, jsonb) to service_role;
grant execute on function public.replace_manual_chunks_if_current(uuid, jsonb, jsonb) to service_role;
grant execute on function public.invalidate_changed_manual_chunks() to service_role;
revoke all on function public.invalidate_manual_parent_chunks() from public, anon, authenticated;
grant execute on function public.invalidate_manual_parent_chunks() to service_role;
revoke all on function public.lock_manual_hierarchy_write() from public, anon, authenticated;
grant execute on function public.lock_manual_hierarchy_write() to service_role;
revoke all on function public.check_manual_write_contract() from public, anon, authenticated;
grant execute on function public.check_manual_write_contract() to service_role;

commit;