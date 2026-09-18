-- Hide & Seek: Vienna v3.13.5
-- Player identities / multi-Seeker GPS, strategic-question gating/rewards,
-- and simplified Time Trap accrual + automatic proximity triggering.
-- Run once after v3.13.4.

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Player catalogue.
-- ---------------------------------------------------------------------------
create table if not exists public.players(
  id uuid primary key default gen_random_uuid(),
  name text not null,
  initials text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists players_name_ci_unique on public.players(lower(name));
alter table public.players enable row level security;
revoke all on public.players from anon,authenticated;

create or replace function public._player_initials_v1(p_name text)
returns text language plpgsql immutable as $$
declare v_name text;v_parts text[];v_out text:='';v_part text;v_i integer:=0;
begin
  v_name:=regexp_replace(trim(coalesce(p_name,'')),'\s+',' ','g');
  if v_name='' then return '';end if;
  v_parts:=regexp_split_to_array(v_name,'\s+');
  if coalesce(array_length(v_parts,1),0)=1 then return upper(substr(v_parts[1],1,2));end if;
  foreach v_part in array v_parts loop
    exit when v_i>=3;
    if v_part<>'' then v_out:=v_out||upper(substr(v_part,1,1));v_i:=v_i+1;end if;
  end loop;
  return v_out;
end;$$;

create or replace function public.list_players_v1()
returns table(player_id uuid,name text,initials text)
language sql stable security definer set search_path=public as $$
  select p.id,p.name,p.initials from public.players p where p.enabled order by p.name;
$$;
grant execute on function public.list_players_v1() to anon,authenticated;

create or replace function public.admin_list_players_v1(p_password text)
returns table(player_id uuid,name text,initials text,enabled boolean,created_at timestamptz)
language plpgsql security definer set search_path=public as $$
begin
  if not public._admin_password_ok(p_password) then perform pg_sleep(.35);raise exception 'Invalid developer password.';end if;
  return query select p.id,p.name,p.initials,p.enabled,p.created_at from public.players p order by p.name;
end;$$;
grant execute on function public.admin_list_players_v1(text) to anon,authenticated;

create or replace function public.admin_create_player_v1(p_password text,p_name text)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_name text;v_initials text;v_id uuid;
begin
  if not public._admin_password_ok(p_password) then perform pg_sleep(.35);raise exception 'Invalid developer password.';end if;
  v_name:=regexp_replace(trim(coalesce(p_name,'')),'\s+',' ','g');
  if char_length(v_name) not between 1 and 100 then raise exception 'Player name must be 1-100 characters.';end if;
  v_initials:=public._player_initials_v1(v_name);
  if v_initials='' then raise exception 'Could not derive initials.';end if;
  insert into public.players(name,initials) values(v_name,v_initials) returning id into v_id;
  return v_id;
exception when unique_violation then raise exception 'A player with that name already exists.';
end;$$;
grant execute on function public.admin_create_player_v1(text,text) to anon,authenticated;

alter table public.games add column if not exists hider_player_id uuid references public.players(id) on delete set null;

create or replace function public.create_game_v5(
  p_name text,p_password text,p_station_name text,p_station_lat double precision,p_station_lng double precision,p_hider_player_id uuid
) returns uuid language plpgsql security definer set search_path=public,extensions as $$
declare v_id uuid;
begin
  if not exists(select 1 from public.players where id=p_hider_player_id and enabled) then raise exception 'Choose an active Hider player.';end if;
  v_id:=public.create_game_v4(p_name,p_password,p_station_name,p_station_lat,p_station_lng);
  update public.games set hider_player_id=p_hider_player_id where id=v_id;
  return v_id;
end;$$;
grant execute on function public.create_game_v5(text,text,text,double precision,double precision,uuid) to anon,authenticated;

create or replace function public.bind_hider_player_v1(p_game_id uuid,p_password text,p_player_id uuid)
returns boolean language plpgsql security definer set search_path=public,extensions as $$
declare v_existing uuid;
begin
  if not public._hider_password_ok(p_game_id,p_password) then raise exception 'Invalid hider password.';end if;
  if not exists(select 1 from public.players where id=p_player_id and enabled) then raise exception 'Choose an active Hider player.';end if;
  select hider_player_id into v_existing from public.games where id=p_game_id for update;
  if not found then raise exception 'Game not found.';end if;
  if v_existing is not null and v_existing<>p_player_id then raise exception 'This Hider run already belongs to another player.';end if;
  if v_existing is null then update public.games set hider_player_id=p_player_id where id=p_game_id;end if;
  return true;
end;$$;
grant execute on function public.bind_hider_player_v1(uuid,text,uuid) to anon,authenticated;

create or replace function public.admin_list_player_runs_v1(p_password text)
returns table(player_id uuid,game_id uuid,game_name text,status text,created_at timestamptz,finished_at timestamptz,duration_seconds bigint)
language plpgsql security definer set search_path=public as $$
begin
  if not public._admin_password_ok(p_password) then perform pg_sleep(.35);raise exception 'Invalid developer password.';end if;
  return query
  select g.hider_player_id,g.id,g.name,g.status,g.created_at,g.finished_at,
    case when g.status='finished' then coalesce(g.final_score_seconds,g.final_raw_seconds,g.clock_elapsed_seconds,0)
      else coalesce(g.clock_elapsed_seconds,0)+case when g.clock_running and g.clock_started_at is not null and g.clock_started_at<now() then greatest(0,floor(extract(epoch from(now()-g.clock_started_at)))::bigint) else 0 end end
  from public.games g where g.hider_player_id is not null
  order by 7 desc,g.created_at desc;
end;$$;
grant execute on function public.admin_list_player_runs_v1(text) to anon,authenticated;

-- ---------------------------------------------------------------------------
-- One live GPS row per Seeker player. This table never stores the Hider.
-- ---------------------------------------------------------------------------
create table if not exists public.seeker_player_positions(
  game_id uuid not null references public.games(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  lat double precision not null check(lat between -90 and 90),
  lng double precision not null check(lng between -180 and 180),
  accuracy_m double precision,
  source text not null default 'gps',
  updated_at timestamptz not null default now(),
  primary key(game_id,player_id)
);
alter table public.seeker_player_positions enable row level security;
revoke all on public.seeker_player_positions from anon,authenticated;

create or replace function public.get_seeker_player_positions_v1(p_game_id uuid)
returns table(player_id uuid,player_name text,initials text,lat double precision,lng double precision,accuracy_m double precision,source text,updated_at timestamptz)
language sql stable security definer set search_path=public as $$
  select s.player_id,p.name,p.initials,s.lat,s.lng,s.accuracy_m,s.source,s.updated_at
  from public.seeker_player_positions s join public.players p on p.id=s.player_id
  where s.game_id=p_game_id and p.enabled order by p.name;
$$;
grant execute on function public.get_seeker_player_positions_v1(uuid) to anon,authenticated;

-- Time Trap rule helper: 5-minute base + 5 minutes per complete 10 real minutes armed.
create or replace function public._time_trap_value_v4(p_base integer,p_armed_at timestamptz,p_at timestamptz default now())
returns integer language sql stable as $$
  select greatest(0,coalesce(p_base,5)) + greatest(0,floor(extract(epoch from(p_at-p_armed_at))/600)::integer)*5;
$$;

create or replace function public.set_seeker_player_position_v1(
  p_game_id uuid,p_player_id uuid,p_lat double precision,p_lng double precision,p_accuracy_m double precision default null
) returns integer
language plpgsql security definer set search_path=public as $$
declare v_trap public.time_traps%rowtype;v_dist double precision;v_bonus integer;v_count integer:=0;v_name text;v_initials text;
begin
  if not exists(select 1 from public.games where id=p_game_id and status='active') then raise exception 'Game is not active.';end if;
  if public._turntables_active(p_game_id) then raise exception 'Seekers are frozen by Curse of the Turntables.';end if;
  select name,initials into v_name,v_initials from public.players where id=p_player_id and enabled;
  if v_name is null then raise exception 'Choose an active Seeker player.';end if;
  if p_lat not between -90 and 90 or p_lng not between -180 and 180 then raise exception 'Invalid Seeker coordinate.';end if;

  insert into public.seeker_player_positions(game_id,player_id,lat,lng,accuracy_m,source,updated_at)
  values(p_game_id,p_player_id,p_lat,p_lng,p_accuracy_m,'gps',now())
  on conflict(game_id,player_id) do update set lat=excluded.lat,lng=excluded.lng,accuracy_m=excluded.accuracy_m,source='gps',updated_at=now();

  -- Keep the legacy single-position row fresh for backward compatibility only.
  insert into public.seeker_live_positions(game_id,lat,lng,accuracy_m,source,updated_at)
  values(p_game_id,p_lat,p_lng,p_accuracy_m,'gps',now())
  on conflict(game_id) do update set lat=excluded.lat,lng=excluded.lng,accuracy_m=excluded.accuracy_m,source='gps',updated_at=now();

  for v_trap in select * from public.time_traps where game_id=p_game_id and not trigger_active loop
    v_dist:=6371000*2*asin(sqrt(
      power(sin(radians(v_trap.station_lat-p_lat)/2),2)+
      cos(radians(p_lat))*cos(radians(v_trap.station_lat))*power(sin(radians(v_trap.station_lng-p_lng)/2),2)
    ));
    if v_dist<=50 then
      v_bonus:=public._time_trap_value_v4(v_trap.base_bonus_minutes,v_trap.armed_at,now());
      update public.time_traps set triggered_at=now(),bonus_minutes=v_bonus,trigger_active=true
      where id=v_trap.id and not trigger_active;
      if found then
        insert into public.game_actions(game_id,actor,kind,payload)
        values(p_game_id,'system','time_trap_trigger',jsonb_build_object(
          'trap_id',v_trap.id,'station_name',v_trap.station_name,'bonus_minutes',v_bonus,
          'auto_trigger',true,'triggered_by_player_id',p_player_id,'triggered_by_name',v_name,
          'triggered_by_initials',v_initials,'distance_m',round(v_dist::numeric,1)
        ));
        v_count:=v_count+1;
      end if;
    end if;
  end loop;
  return v_count;
end;$$;
grant execute on function public.set_seeker_player_position_v1(uuid,uuid,double precision,double precision,double precision) to anon,authenticated;

-- ---------------------------------------------------------------------------
-- Attribute questions to a player and lock the two strategic transit questions
-- until four earlier questions have actually been asked in the current target phase.
-- ---------------------------------------------------------------------------
create or replace function public.ask_question_v5(
  p_game_id uuid,p_slot_key text,p_kind text,p_payload jsonb,p_player_id uuid
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid;v_phase_start timestamptz:='epoch'::timestamptz;v_count integer:=0;v_name text;v_initials text;
begin
  select name,initials into v_name,v_initials from public.players where id=p_player_id and enabled;
  if v_name is null then raise exception 'Choose an active Seeker player.';end if;
  select coalesce(max(created_at),'epoch'::timestamptz) into v_phase_start
    from public.game_actions where game_id=p_game_id and kind='turntables_relocate' and is_active;
  select count(*) into v_count from public.game_actions q
    where q.game_id=p_game_id and q.kind='question' and q.is_active and q.created_at>v_phase_start;
  if p_kind in('same_line','station_interchange') and v_count<4 then
    raise exception 'Same Route and Interchange unlock after four earlier questions.';
  end if;
  v_id:=public.ask_question_v4(p_game_id,p_slot_key,p_kind,
    coalesce(p_payload,'{}'::jsonb)||jsonb_build_object(
      'asked_by_player_id',p_player_id,'asked_by_name',v_name,'asked_by_initials',v_initials
    ));
  return v_id;
end;$$;
grant execute on function public.ask_question_v5(uuid,text,text,jsonb,uuid) to anon,authenticated;

-- Keep the normal draw counts, but Same Route / Interchange may keep two of their three cards.
create or replace function public.answer_question_v6(p_game_id uuid,p_question_action_id uuid,p_password text,p_answer jsonb)
returns uuid language plpgsql security definer set search_path=public,extensions as $$
declare v_id uuid;v_kind text;
begin
  select payload->>'question_kind' into v_kind from public.game_actions
    where id=p_question_action_id and game_id=p_game_id and kind='question' and is_active;
  if v_kind is null then raise exception 'Question is not active.';end if;
  v_id:=public.answer_question_v5(p_game_id,p_question_action_id,p_password,p_answer);
  if v_kind in('same_line','station_interchange') then
    update public.curse_draws set keep_limit=least(2,jsonb_array_length(cards))
      where game_id=p_game_id and question_action_id=p_question_action_id;
  end if;
  return v_id;
end;$$;
grant execute on function public.answer_question_v6(uuid,uuid,text,jsonb) to anon,authenticated;

-- ---------------------------------------------------------------------------
-- VOR uses the GPS of the specific Seeker who asked the question.
-- ---------------------------------------------------------------------------
create or replace function public.get_vor_navigation_bearing_v1(p_game_id uuid,p_question_action_id uuid)
returns table(bearing_deg double precision,expires_at timestamptz)
language plpgsql security definer set search_path=public,extensions as $$
declare
  v_q public.game_actions%rowtype;v_answer jsonb;v_player uuid;
  v_seeker_lat double precision;v_seeker_lng double precision;v_target_lat double precision;v_target_lng double precision;
  v_expires timestamptz;v_y double precision;v_x double precision;v_bearing double precision;
begin
  select * into v_q from public.game_actions where id=p_question_action_id and game_id=p_game_id and kind='question' and is_active and payload->>'question_kind'='vor_navigation';
  if v_q.id is null then return;end if;
  select a.payload->'answer' into v_answer from public.game_actions a where a.parent_id=p_question_action_id and a.kind='answer' and a.is_active order by a.created_at desc limit 1;
  if coalesce(v_answer->>'type','')<>'vor_navigation' then return;end if;
  v_expires:=(v_answer->>'expires_at')::timestamptz;if v_expires is null or now()>=v_expires then return;end if;

  begin v_player:=nullif(v_q.payload->>'asked_by_player_id','')::uuid;exception when others then v_player:=null;end;
  if v_player is not null then
    select lat,lng into v_seeker_lat,v_seeker_lng from public.seeker_player_positions
      where game_id=p_game_id and player_id=v_player and updated_at>=now()-interval '20 seconds';
    -- An identified VOR question may fall back only to its own asking origin,
    -- never to the legacy row which might currently belong to another Seeker.
    if v_seeker_lat is null or v_seeker_lng is null then
      v_seeker_lat:=nullif(v_q.payload#>>'{origin,lat}','')::double precision;
      v_seeker_lng:=nullif(v_q.payload#>>'{origin,lng}','')::double precision;
    end if;
  else
    select lat,lng into v_seeker_lat,v_seeker_lng from public.seeker_live_positions
      where game_id=p_game_id and updated_at>=now()-interval '20 seconds';
    if v_seeker_lat is null or v_seeker_lng is null then
      v_seeker_lat:=nullif(v_q.payload#>>'{origin,lat}','')::double precision;
      v_seeker_lng:=nullif(v_q.payload#>>'{origin,lng}','')::double precision;
    end if;
  end if;
  if v_seeker_lat is null or v_seeker_lng is null then return;end if;

  select h.lat,h.lng into v_target_lat,v_target_lng from public.hider_vor_live_positions h
    where h.game_id=p_game_id and h.question_action_id=p_question_action_id and h.updated_at>=now()-interval '20 seconds';
  if v_target_lat is null or v_target_lng is null then
    select hidden_lat,hidden_lng into v_target_lat,v_target_lng from public.game_secrets
      where game_id=p_game_id and endgame and hidden_lat is not null and hidden_lng is not null;
  end if;
  if v_target_lat is null or v_target_lng is null then return;end if;

  v_y:=sin(radians(v_target_lng-v_seeker_lng))*cos(radians(v_target_lat));
  v_x:=cos(radians(v_seeker_lat))*sin(radians(v_target_lat))-sin(radians(v_seeker_lat))*cos(radians(v_target_lat))*cos(radians(v_target_lng-v_seeker_lng));
  v_bearing:=degrees(atan2(v_y,v_x));if v_bearing<0 then v_bearing:=v_bearing+360;end if;
  return query select v_bearing,v_expires;
end;$$;
grant execute on function public.get_vor_navigation_bearing_v1(uuid,uuid) to anon,authenticated;

-- ---------------------------------------------------------------------------
-- Time Traps: start at 5 min, gain +5 per complete 10 min, manual or 50 m auto trigger.
-- ---------------------------------------------------------------------------
update public.curse_cards set description='Place on any station. The trap starts at 5 minutes and gains 5 more minutes every 10 real minutes. Trigger it manually at any time, or it triggers automatically when any Seeker comes within 50 m.'
where effect_key='time_trap';

create or replace function public.get_time_traps_v3(p_game_id uuid,p_password text)
returns table(id uuid,card_key text,station_name text,station_lat double precision,station_lng double precision,base_bonus_minutes integer,armed_at timestamptz,triggered_at timestamptz,bonus_minutes integer,trigger_active boolean,current_bonus_minutes integer)
language plpgsql security definer set search_path=public,extensions as $$
begin
  if not public._hider_password_ok(p_game_id,p_password) then raise exception 'Invalid hider password.';end if;
  return query select t.id,t.card_key,t.station_name,t.station_lat,t.station_lng,t.base_bonus_minutes,t.armed_at,t.triggered_at,t.bonus_minutes,t.trigger_active,
    case when t.trigger_active then coalesce(t.bonus_minutes,t.base_bonus_minutes) else public._time_trap_value_v4(t.base_bonus_minutes,t.armed_at,now()) end
  from public.time_traps t where t.game_id=p_game_id order by t.armed_at;
end;$$;
grant execute on function public.get_time_traps_v3(uuid,text) to anon,authenticated;

create or replace function public.set_time_trap_trigger_v3(p_game_id uuid,p_trap_id uuid,p_password text,p_active boolean)
returns boolean language plpgsql security definer set search_path=public,extensions as $$
declare v_trap public.time_traps%rowtype;v_bonus integer;v_action uuid;
begin
  if not public._hider_password_ok(p_game_id,p_password) then raise exception 'Invalid hider password.';end if;
  select * into v_trap from public.time_traps where id=p_trap_id and game_id=p_game_id; if not found then raise exception 'Time Trap not found.';end if;
  if p_active then
    -- Manual trigger intentionally awards only the base value. Accrual belongs to the automatic 50 m trigger.
    v_bonus:=coalesce(v_trap.base_bonus_minutes,5);
    update public.time_traps set triggered_at=now(),bonus_minutes=v_bonus,trigger_active=true where id=p_trap_id;
    select id into v_action from public.game_actions where game_id=p_game_id and kind='time_trap_trigger' and payload->>'trap_id'=p_trap_id::text order by created_at desc limit 1;
    if v_action is null then
      insert into public.game_actions(game_id,actor,kind,payload) values(p_game_id,'hider','time_trap_trigger',jsonb_build_object('trap_id',p_trap_id,'station_name',v_trap.station_name,'bonus_minutes',v_bonus,'auto_trigger',false)) returning id into v_action;
    else
      update public.game_actions set is_active=true,payload=payload||jsonb_build_object('station_name',v_trap.station_name,'bonus_minutes',v_bonus,'auto_trigger',false) where id=v_action;
    end if;
  else
    update public.time_traps set trigger_active=false where id=p_trap_id;
    update public.game_actions set is_active=false where game_id=p_game_id and kind='time_trap_trigger' and payload->>'trap_id'=p_trap_id::text;
  end if;
  return true;
end;$$;
grant execute on function public.set_time_trap_trigger_v3(uuid,uuid,text,boolean) to anon,authenticated;

-- ---------------------------------------------------------------------------
-- Developer dynamic map editor.
-- Manual additions/overrides are deliberately separate from official caches,
-- so refreshing Vienna datasets never destroys hand corrections.
-- ---------------------------------------------------------------------------
create table if not exists public.map_manual_items(
  id uuid primary key default gen_random_uuid(),
  category text not null check(category in ('station','transit','museum','park','library','cinema','hospital','cemetery','church','zoo')),
  source_key text,
  name text not null,
  lat double precision,
  lng double precision,
  geometry jsonb,
  properties jsonb not null default '{}'::jsonb,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists map_manual_items_source_unique
  on public.map_manual_items(category,source_key) where source_key is not null;
alter table public.map_manual_items enable row level security;
revoke all on public.map_manual_items from anon,authenticated;

create or replace function public.list_map_manual_items_v1()
returns table(item_id uuid,category text,source_key text,name text,lat double precision,lng double precision,geometry jsonb,properties jsonb,enabled boolean,created_at timestamptz,updated_at timestamptz)
language sql stable security definer set search_path=public as $$
  select m.id,m.category,m.source_key,m.name,m.lat,m.lng,m.geometry,m.properties,m.enabled,m.created_at,m.updated_at
  from public.map_manual_items m where m.enabled order by m.category,m.name;
$$;
grant execute on function public.list_map_manual_items_v1() to anon,authenticated;

create or replace function public.admin_save_map_item_v1(
  p_password text,p_item_id uuid,p_category text,p_source_key text,p_name text,
  p_lat double precision,p_lng double precision,p_geometry jsonb,p_properties jsonb
) returns uuid
language plpgsql security definer set search_path=public as $$
declare v_id uuid;v_props jsonb:=coalesce(p_properties,'{}'::jsonb);
begin
  if not public._admin_password_ok(p_password) then perform pg_sleep(.35);raise exception 'Invalid developer password.';end if;
  if p_category not in ('station','transit','museum','park','library','cinema','hospital','cemetery','church','zoo') then raise exception 'Invalid map category.';end if;
  if char_length(trim(coalesce(p_name,''))) not between 1 and 120 then raise exception 'Map item name must be 1-120 characters.';end if;
  if jsonb_typeof(v_props)<>'object' then raise exception 'Map item properties must be a JSON object.';end if;
  if p_category='transit' then
    if p_source_key is null and (p_geometry is null or coalesce(p_geometry->>'type','') not in ('LineString','MultiLineString')) then raise exception 'A new transit line needs LineString geometry.';end if;
    if p_geometry is not null and coalesce(p_geometry->>'type','') not in ('LineString','MultiLineString') then raise exception 'Transit geometry must be LineString or MultiLineString.';end if;
  else
    if p_lat is null or p_lng is null or p_lat not between 48.00 and 48.40 or p_lng not between 16.00 and 16.70 then raise exception 'Map point must be inside the Vienna editing guardrail.';end if;
  end if;

  if p_item_id is not null then
    update public.map_manual_items set category=p_category,source_key=nullif(p_source_key,''),name=trim(p_name),lat=p_lat,lng=p_lng,geometry=p_geometry,properties=v_props,enabled=true,updated_at=now()
    where id=p_item_id returning id into v_id;
    if v_id is null then raise exception 'Manual map item not found.';end if;
    return v_id;
  end if;

  if nullif(p_source_key,'') is not null then
    select id into v_id from public.map_manual_items where category=p_category and source_key=p_source_key for update;
    if v_id is not null then
      update public.map_manual_items set name=trim(p_name),lat=p_lat,lng=p_lng,geometry=p_geometry,properties=v_props,enabled=true,updated_at=now() where id=v_id;
      return v_id;
    end if;
  end if;

  insert into public.map_manual_items(category,source_key,name,lat,lng,geometry,properties)
  values(p_category,nullif(p_source_key,''),trim(p_name),p_lat,p_lng,p_geometry,v_props)
  returning id into v_id;
  return v_id;
end;$$;
grant execute on function public.admin_save_map_item_v1(text,uuid,text,text,text,double precision,double precision,jsonb,jsonb) to anon,authenticated;

create or replace function public.admin_delete_map_item_v1(p_password text,p_item_id uuid)
returns boolean language plpgsql security definer set search_path=public as $$
begin
  if not public._admin_password_ok(p_password) then perform pg_sleep(.35);raise exception 'Invalid developer password.';end if;
  delete from public.map_manual_items where id=p_item_id;return found;
end;$$;
grant execute on function public.admin_delete_map_item_v1(text,uuid) to anon,authenticated;
