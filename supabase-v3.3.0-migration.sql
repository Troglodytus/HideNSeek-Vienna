-- Vienna Hide & Seek v3.3.0 migration
-- Run ONCE after v3.2.x.
-- Adds shared reference-data storage and password-protected developer/admin RPCs.

create extension if not exists pgcrypto with schema extensions;

-- Ensure the v3.2.2 private Endgame marker is accepted by the action table.
alter table public.game_actions drop constraint if exists game_actions_kind_check;
alter table public.game_actions add constraint game_actions_kind_check check (
  kind in ('seeker_location','thermo_reference','question','answer','curse_play','question_veto','time_trap_trigger','endgame_zone')
);

create table if not exists public.reference_datasets (
  dataset_key text primary key,
  payload jsonb not null,
  source text,
  content_hash text,
  updated_at timestamptz not null default now(),
  checked_at timestamptz not null default now()
);

alter table public.reference_datasets enable row level security;
drop policy if exists "reference datasets readable by everyone" on public.reference_datasets;
create policy "reference datasets readable by everyone"
  on public.reference_datasets for select to anon,authenticated using (true);

grant select on public.reference_datasets to anon,authenticated;
revoke insert,update,delete on public.reference_datasets from anon,authenticated;

-- No direct public write policy: updates happen only through the password-protected admin RPC.

create table if not exists public.app_admin (
  id integer primary key check (id=1),
  password_hash text
);
insert into public.app_admin(id,password_hash) values(1,null)
on conflict (id) do nothing;
alter table public.app_admin enable row level security;
revoke all on public.app_admin from anon,authenticated;
-- Deliberately no anon/authenticated SELECT/INSERT/UPDATE policies on app_admin.

create or replace function public._admin_password_ok(p_password text)
returns boolean
language sql
stable
security definer
set search_path=public,extensions
as $$
  select coalesce((
    select a.password_hash is not null
       and a.password_hash = extensions.crypt(coalesce(p_password,''),a.password_hash)
    from public.app_admin a where a.id=1
  ),false);
$$;

create or replace function public.admin_list_games_v1(p_password text)
returns table(
  id uuid,
  name text,
  status text,
  created_at timestamptz,
  station_name text,
  endgame boolean
)
language plpgsql
security definer
set search_path=public,extensions
as $$
begin
  if not public._admin_password_ok(p_password) then
    perform pg_sleep(0.35);
    raise exception 'Invalid developer password.';
  end if;
  return query
    select g.id,g.name,g.status,g.created_at,s.station_name,s.endgame
    from public.games g
    left join public.game_secrets s on s.game_id=g.id
    order by g.created_at desc;
end;
$$;

create or replace function public.admin_update_game_v1(
  p_password text,
  p_game_id uuid,
  p_name text,
  p_status text
) returns boolean
language plpgsql
security definer
set search_path=public,extensions
as $$
begin
  if not public._admin_password_ok(p_password) then
    perform pg_sleep(0.35);
    raise exception 'Invalid developer password.';
  end if;
  if char_length(trim(coalesce(p_name,''))) not between 1 and 80 then
    raise exception 'Game name must be 1-80 characters.';
  end if;
  if p_status not in ('active','finished') then
    raise exception 'Invalid game status.';
  end if;
  update public.games set name=trim(p_name),status=p_status where id=p_game_id;
  return found;
end;
$$;

create or replace function public.admin_delete_game_v1(
  p_password text,
  p_game_id uuid
) returns boolean
language plpgsql
security definer
set search_path=public,extensions
as $$
begin
  if not public._admin_password_ok(p_password) then
    perform pg_sleep(0.35);
    raise exception 'Invalid developer password.';
  end if;
  delete from public.games where id=p_game_id;
  return found;
end;
$$;

create or replace function public.admin_save_reference_dataset_v1(
  p_password text,
  p_dataset_key text,
  p_payload jsonb,
  p_source text default null,
  p_content_hash text default null
) returns text
language plpgsql
security definer
set search_path=public,extensions
as $$
declare
  v_old_hash text;
  v_exists boolean;
begin
  if not public._admin_password_ok(p_password) then
    perform pg_sleep(0.35);
    raise exception 'Invalid developer password.';
  end if;
  if char_length(trim(coalesce(p_dataset_key,''))) < 3 then raise exception 'Invalid dataset key.'; end if;
  if p_payload is null then raise exception 'Dataset payload is required.'; end if;

  select true,content_hash into v_exists,v_old_hash
  from public.reference_datasets where dataset_key=p_dataset_key;

  if coalesce(v_exists,false) and p_content_hash is not null and v_old_hash=p_content_hash then
    update public.reference_datasets
      set checked_at=now(), source=coalesce(p_source,source)
      where dataset_key=p_dataset_key;
    return 'unchanged';
  end if;

  insert into public.reference_datasets(dataset_key,payload,source,content_hash,updated_at,checked_at)
  values(trim(p_dataset_key),p_payload,p_source,p_content_hash,now(),now())
  on conflict(dataset_key) do update
    set payload=excluded.payload,
        source=excluded.source,
        content_hash=excluded.content_hash,
        updated_at=now(),
        checked_at=now();

  return case when coalesce(v_exists,false) then 'updated' else 'created' end;
end;
$$;

grant execute on function public.admin_list_games_v1(text) to anon,authenticated;
grant execute on function public.admin_update_game_v1(text,uuid,text,text) to anon,authenticated;
grant execute on function public.admin_delete_game_v1(text,uuid) to anon,authenticated;
grant execute on function public.admin_save_reference_dataset_v1(text,text,jsonb,text,text) to anon,authenticated;

-- IMPORTANT: after running this migration, set your developer password ONCE by
-- executing the following statement separately in the Supabase SQL Editor.
-- Replace the example password before running it. Do NOT put the real password in GitHub.
--
-- update public.app_admin
-- set password_hash=extensions.crypt('PUT-A-STRONG-DEVELOPER-PASSWORD-HERE',extensions.gen_salt('bf',10))
-- where id=1;
