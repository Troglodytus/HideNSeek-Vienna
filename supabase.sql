-- Vienna Hide & Seek MVP v3 database / migration
-- Rerunnable migration for the two-stage station/endgame model, reversible actions,
-- Jet Lag-style question rewards, private hand state, vetoes, Duplicate and Time Traps.
-- Run the whole file in Supabase -> SQL Editor.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.games (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  status text not null default 'active' check (status in ('active','finished')),
  created_at timestamptz not null default now()
);

create table if not exists public.game_secrets (
  game_id uuid primary key references public.games(id) on delete cascade,
  hidden_lat double precision not null,
  hidden_lng double precision not null,
  password_hash text not null
);

alter table public.game_secrets add column if not exists station_lat double precision;
alter table public.game_secrets add column if not exists station_lng double precision;
alter table public.game_secrets add column if not exists station_name text;
alter table public.game_secrets add column if not exists endgame boolean not null default false;
alter table public.game_secrets add column if not exists base_radius_m integer not null default 250;
-- v3.2: final hiding coordinates are chosen only when Endgame starts.
alter table public.game_secrets alter column hidden_lat drop not null;
alter table public.game_secrets alter column hidden_lng drop not null;
update public.game_secrets set station_lat=coalesce(station_lat,hidden_lat), station_lng=coalesce(station_lng,hidden_lng), station_name=coalesce(station_name,'Legacy station') where station_lat is null or station_lng is null or station_name is null;

create table if not exists public.game_actions (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  actor text not null check (actor in ('seeker','hider','system')),
  kind text not null,
  parent_id uuid null references public.game_actions(id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.game_actions drop constraint if exists game_actions_kind_check;
alter table public.game_actions add constraint game_actions_kind_check check (kind in ('seeker_location','thermo_reference','question','answer','curse_play','question_veto','time_trap_trigger'));
create index if not exists game_actions_game_created_idx on public.game_actions(game_id,created_at);
create index if not exists game_actions_parent_idx on public.game_actions(parent_id);

create table if not exists public.curse_cards (
  card_key text primary key,
  title text not null,
  description text not null,
  duration_seconds integer null check (duration_seconds is null or duration_seconds >= 0)
);
alter table public.curse_cards add column if not exists card_kind text not null default 'curse';
alter table public.curse_cards add column if not exists effect_key text;
alter table public.curse_cards add column if not exists value_int integer;

create table if not exists public.curse_draws (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  question_action_id uuid not null unique references public.game_actions(id) on delete cascade,
  cards jsonb not null check (jsonb_typeof(cards)='array'),
  kept_card_key text null,
  keep_active boolean not null default false,
  created_at timestamptz not null default now(),
  kept_at timestamptz null
);
alter table public.curse_draws add column if not exists keep_limit integer not null default 1;
alter table public.curse_draws add column if not exists kept_card_keys jsonb not null default '[]'::jsonb;
alter table public.curse_draws add column if not exists used_card_keys jsonb not null default '[]'::jsonb;
update public.curse_draws set kept_card_keys=jsonb_build_array(kept_card_key) where kept_card_key is not null and jsonb_array_length(kept_card_keys)=0;

create table if not exists public.private_card_uses (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  card_key text not null,
  effect_key text not null,
  value_int integer,
  metadata jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.time_traps (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  card_key text not null,
  station_name text not null,
  station_lat double precision not null,
  station_lng double precision not null,
  base_bonus_minutes integer not null default 5,
  armed_at timestamptz not null default now(),
  triggered_at timestamptz,
  bonus_minutes integer,
  trigger_active boolean not null default false
);

-- Replace the old starter catalogue. Existing draw JSON remains self-contained.
delete from public.curse_cards;

-- Time bonus instances. Multiple physical instances are represented by unique card_key values.
insert into public.curse_cards(card_key,title,description,duration_seconds,card_kind,effect_key,value_int)
select 'time-5-'||g,'5 Minute Bonus','Keep in your hand; adds five minutes to the final hiding time.',null::integer,'time_bonus','time_bonus',5 from generate_series(1,10) g
union all select 'time-10-'||g,'10 Minute Bonus','Keep in your hand; adds ten minutes to the final hiding time.',null::integer,'time_bonus','time_bonus',10 from generate_series(1,8) g
union all select 'time-15-'||g,'15 Minute Bonus','Keep in your hand; adds fifteen minutes to the final hiding time.',null::integer,'time_bonus','time_bonus',15 from generate_series(1,6) g
union all select 'time-20-'||g,'20 Minute Bonus','Keep in your hand; adds twenty minutes to the final hiding time.',null::integer,'time_bonus','time_bonus',20 from generate_series(1,4) g
union all select 'time-30-'||g,'30 Minute Bonus','Keep in your hand; adds thirty minutes to the final hiding time.',null::integer,'time_bonus','time_bonus',30 from generate_series(1,2) g;

insert into public.curse_cards(card_key,title,description,duration_seconds,card_kind,effect_key,value_int)
select 'veto-'||g,'Veto Question','Use on a pending seeker question to refuse that question; no answer is sent.',null::integer,'powerup','veto_question',null::integer from generate_series(1,6) g
union all select 'duplicate-'||g,'Duplicate','Copy another held time-bonus or curse card without consuming the original.',null::integer,'powerup','duplicate',null::integer from generate_series(1,4) g
union all select 'time-trap-'||g,'Time Trap','Secretly place this on a station. If triggered, it awards its base bonus plus 10 minutes per full hour it was armed.',null::integer,'time_trap','time_trap',5 from generate_series(1,6) g
union all select 'gamblers-feet-'||g,'Curse of the Gambler''s Feet','For one hour, seekers use a die to determine how many steps they may take before rolling again. Casting roll should be resolved by the players.',3600,'curse','gamblers_feet',null::integer from generate_series(1,3) g
union all select 'fog-'||g,'Curse of the Impenetrable Fog','For one hour, seekers randomize their direction whenever they reach a qualifying street intersection.',3600,'curse','impenetrable_fog',null::integer from generate_series(1,3) g
union all select 'express-'||g,'Curse of the Express Route','Seekers may not disembark their current train for up to 30 minutes, unless it reaches the end of its line first.',1800,'curse','express_route',null::integer from generate_series(1,3) g
union all select 'prosperous-'||g,'Curse of the Prosperous Home','Expand the final hiding area. This Vienna implementation doubles area rather than doubling radius.',null::integer,'curse','prosperous_home',2 from generate_series(1,3) g;

alter table public.games enable row level security;
alter table public.game_secrets enable row level security;
alter table public.game_actions enable row level security;
alter table public.curse_cards enable row level security;
alter table public.curse_draws enable row level security;
alter table public.private_card_uses enable row level security;
alter table public.time_traps enable row level security;

drop policy if exists "games readable by everyone" on public.games;
create policy "games readable by everyone" on public.games for select to anon,authenticated using (true);
drop policy if exists "game actions readable by everyone" on public.game_actions;
create policy "game actions readable by everyone" on public.game_actions for select to anon,authenticated using (true);
drop policy if exists "curse card catalogue readable by everyone" on public.curse_cards;
create policy "curse card catalogue readable by everyone" on public.curse_cards for select to anon,authenticated using (true);
-- No SELECT/INSERT/UPDATE policies are granted on game_secrets, curse_draws, private_card_uses or time_traps.

create or replace function public._hider_password_ok(p_game_id uuid,p_password text)
returns boolean language sql stable security definer set search_path=public,extensions as $$
  select exists(select 1 from public.game_secrets s where s.game_id=p_game_id and s.password_hash=extensions.crypt(coalesce(p_password,''),s.password_hash));
$$;

create or replace function public.create_game_v3(
  p_name text,p_password text,p_station_name text,p_station_lat double precision,p_station_lng double precision,p_hidden_lat double precision,p_hidden_lng double precision
) returns uuid language plpgsql security definer set search_path=public,extensions as $$
declare v_id uuid; v_dist_m double precision;
begin
  if char_length(trim(coalesce(p_name,''))) not between 1 and 80 then raise exception 'Game name must be 1-80 characters.'; end if;
  if char_length(coalesce(p_password,''))<4 then raise exception 'Password must be at least 4 characters.'; end if;
  if p_station_lat not between 48.05 and 48.40 or p_station_lng not between 16.05 and 16.70 or p_hidden_lat not between 48.05 and 48.40 or p_hidden_lng not between 16.05 and 16.70 then raise exception 'Coordinate outside Vienna guardrail.'; end if;
  v_dist_m := 6371000 * 2 * asin(sqrt(power(sin(radians(p_hidden_lat-p_station_lat)/2),2)+cos(radians(p_station_lat))*cos(radians(p_hidden_lat))*power(sin(radians(p_hidden_lng-p_station_lng)/2),2)));
  if v_dist_m>250.5 then raise exception 'Actual hiding spot must be within 250 m of the selected station.'; end if;
  insert into public.games(name) values(trim(p_name)) returning id into v_id;
  insert into public.game_secrets(game_id,hidden_lat,hidden_lng,password_hash,station_lat,station_lng,station_name,endgame,base_radius_m)
  values(v_id,p_hidden_lat,p_hidden_lng,extensions.crypt(p_password,extensions.gen_salt('bf',10)),p_station_lat,p_station_lng,coalesce(nullif(trim(p_station_name),''),'Station'),false,250);
  return v_id;
end;$$;

create or replace function public.get_hider_game_v3(p_game_id uuid,p_password text)
returns table(game_id uuid,game_name text,game_status text,hidden_lat double precision,hidden_lng double precision,station_lat double precision,station_lng double precision,station_name text,endgame boolean,base_radius_m integer)
language plpgsql security definer set search_path=public,extensions as $$
begin
  return query select g.id,g.name,g.status,s.hidden_lat,s.hidden_lng,s.station_lat,s.station_lng,s.station_name,s.endgame,s.base_radius_m from public.games g join public.game_secrets s on s.game_id=g.id where g.id=p_game_id and s.password_hash=extensions.crypt(coalesce(p_password,''),s.password_hash);
end;$$;

create or replace function public.set_endgame_v3(p_game_id uuid,p_password text,p_endgame boolean)
returns boolean language plpgsql security definer set search_path=public,extensions as $$
begin
  if not public._hider_password_ok(p_game_id,p_password) then raise exception 'Invalid hider password.'; end if;
  update public.game_secrets set endgame=p_endgame where game_id=p_game_id; return found;
end;$$;

create or replace function public.add_thermo_reference_v3(p_game_id uuid,p_lat double precision,p_lng double precision,p_accuracy_m double precision default null,p_source text default 'gps')
returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid;
begin
  if not exists(select 1 from public.games where id=p_game_id and status='active') then raise exception 'Game is not active.'; end if;
  insert into public.game_actions(game_id,actor,kind,payload) values(p_game_id,'seeker','thermo_reference',jsonb_build_object('lat',p_lat,'lng',p_lng,'accuracy_m',p_accuracy_m,'source',p_source)) returning id into v_id; return v_id;
end;$$;

create or replace function public.ask_question_v3(p_game_id uuid,p_slot_key text,p_kind text,p_payload jsonb)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid;
begin
  if p_kind not in ('radar','district','thermometer','tentacle') then raise exception 'Invalid question kind.'; end if;
  if not exists(select 1 from public.games where id=p_game_id and status='active') then raise exception 'Game is not active.'; end if;
  if exists(select 1 from public.game_actions a where a.game_id=p_game_id and a.kind='question' and a.is_active and a.payload->>'slot_key'=p_slot_key) then raise exception 'That question card is already active.'; end if;
  insert into public.game_actions(game_id,actor,kind,payload) values(p_game_id,'seeker','question',coalesce(p_payload,'{}'::jsonb)||jsonb_build_object('slot_key',p_slot_key,'question_kind',p_kind)) returning id into v_id; return v_id;
end;$$;

create or replace function public.answer_question_v3(p_game_id uuid,p_question_action_id uuid,p_password text,p_answer jsonb)
returns uuid language plpgsql security definer set search_path=public,extensions as $$
declare v_answer_id uuid; v_cards jsonb; v_kind text; v_draw_count integer; v_keep_limit integer;
begin
  if not public._hider_password_ok(p_game_id,p_password) then raise exception 'Invalid hider password.'; end if;
  select q.payload->>'question_kind' into v_kind from public.game_actions q where q.id=p_question_action_id and q.game_id=p_game_id and q.kind='question' and q.is_active;
  if v_kind is null then raise exception 'Question is not active.'; end if;
  if exists(select 1 from public.game_actions a where a.parent_id=p_question_action_id and a.kind in ('answer','question_veto') and a.is_active) then raise exception 'Question already has an active answer/veto.'; end if;
  insert into public.game_actions(game_id,actor,kind,parent_id,payload) values(p_game_id,'hider','answer',p_question_action_id,jsonb_build_object('answer',coalesce(p_answer,'{}'::jsonb))) returning id into v_answer_id;
  if v_kind in ('radar','thermometer') then v_draw_count:=2;v_keep_limit:=1; elsif v_kind='tentacle' then v_draw_count:=4;v_keep_limit:=2; else v_draw_count:=3;v_keep_limit:=1; end if;
  if not exists(select 1 from public.curse_draws where question_action_id=p_question_action_id) then
    select coalesce(jsonb_agg(jsonb_build_object('card_key',x.card_key,'title',x.title,'description',x.description,'duration_seconds',x.duration_seconds,'card_kind',x.card_kind,'effect_key',x.effect_key,'value_int',x.value_int)),'[]'::jsonb) into v_cards
    from (select c.* from public.curse_cards c where not exists(select 1 from public.curse_draws d cross join lateral jsonb_array_elements(d.cards) e where d.game_id=p_game_id and e->>'card_key'=c.card_key) order by random() limit v_draw_count) x;
    if jsonb_array_length(v_cards)>0 then insert into public.curse_draws(game_id,question_action_id,cards,keep_limit) values(p_game_id,p_question_action_id,v_cards,v_keep_limit) on conflict(question_action_id) do nothing; end if;
  end if;
  return v_answer_id;
end;$$;

create or replace function public.get_hider_draws_v3(p_game_id uuid,p_password text)
returns table(id uuid,question_action_id uuid,cards jsonb,keep_limit integer,kept_card_keys jsonb,used_card_keys jsonb,created_at timestamptz)
language plpgsql security definer set search_path=public,extensions as $$
begin
  if not public._hider_password_ok(p_game_id,p_password) then raise exception 'Invalid hider password.'; end if;
  return query select d.id,d.question_action_id,d.cards,d.keep_limit,d.kept_card_keys,d.used_card_keys,d.created_at from public.curse_draws d where d.game_id=p_game_id order by d.created_at;
end;$$;

create or replace function public.toggle_keep_card_v3(p_game_id uuid,p_draw_id uuid,p_password text,p_card_key text,p_active boolean)
returns boolean language plpgsql security definer set search_path=public,extensions as $$
declare v_draw public.curse_draws%rowtype; v_count integer;
begin
  if not public._hider_password_ok(p_game_id,p_password) then raise exception 'Invalid hider password.'; end if;
  select * into v_draw from public.curse_draws where id=p_draw_id and game_id=p_game_id; if not found then raise exception 'Draw not found.'; end if;
  if not exists(select 1 from jsonb_array_elements(v_draw.cards) e where e->>'card_key'=p_card_key) then raise exception 'Card not in this draw.'; end if;
  if v_draw.used_card_keys ? p_card_key then raise exception 'Card has already been used.'; end if;
  if p_active then
    if v_draw.kept_card_keys ? p_card_key then return true; end if;
    select count(*) into v_count from jsonb_array_elements(v_draw.kept_card_keys);
    if v_count>=v_draw.keep_limit then raise exception 'Keep limit reached.'; end if;
    update public.curse_draws set kept_card_keys=kept_card_keys||jsonb_build_array(p_card_key) where id=p_draw_id;
  else
    update public.curse_draws set kept_card_keys=kept_card_keys-p_card_key where id=p_draw_id;
  end if;
  return true;
end;$$;

create or replace function public._get_held_card(p_game_id uuid,p_card_key text)
returns jsonb language sql stable security definer set search_path=public as $$
  select e from public.curse_draws d cross join lateral jsonb_array_elements(d.cards) e where d.game_id=p_game_id and d.kept_card_keys ? p_card_key and not (d.used_card_keys ? p_card_key) and e->>'card_key'=p_card_key limit 1;
$$;

create or replace function public._consume_held_card(p_game_id uuid,p_card_key text)
returns boolean language plpgsql security definer set search_path=public as $$
begin
  update public.curse_draws set used_card_keys=used_card_keys||jsonb_build_array(p_card_key) where game_id=p_game_id and kept_card_keys ? p_card_key and not (used_card_keys ? p_card_key); return found;
end;$$;

create or replace function public.veto_question_v3(p_game_id uuid,p_question_action_id uuid,p_password text,p_card_key text)
returns uuid language plpgsql security definer set search_path=public,extensions as $$
declare v_card jsonb; v_id uuid; v_title text;
begin
  if not public._hider_password_ok(p_game_id,p_password) then raise exception 'Invalid hider password.'; end if;
  v_card:=public._get_held_card(p_game_id,p_card_key); if v_card is null or v_card->>'effect_key'<>'veto_question' then raise exception 'No unused veto card.'; end if;
  select payload->>'title' into v_title from public.game_actions where id=p_question_action_id and game_id=p_game_id and kind='question' and is_active; if v_title is null then raise exception 'Question is not active.'; end if;
  if exists(select 1 from public.game_actions where parent_id=p_question_action_id and kind in ('answer','question_veto') and is_active) then raise exception 'Question already resolved.'; end if;
  perform public._consume_held_card(p_game_id,p_card_key);
  insert into public.game_actions(game_id,actor,kind,parent_id,payload) values(p_game_id,'hider','question_veto',p_question_action_id,jsonb_build_object('card_key',p_card_key,'question_title',v_title)) returning id into v_id; return v_id;
end;$$;

create or replace function public.auto_veto_tentacle_v3(p_game_id uuid,p_question_action_id uuid,p_password text)
returns uuid language plpgsql security definer set search_path=public,extensions as $$
declare
  v_id uuid; v_title text; v_kind text; v_limit integer; v_payload jsonb; v_poi jsonb;
  v_target_lat double precision; v_target_lng double precision; v_lat double precision; v_lng double precision;
  v_a double precision; v_distance double precision; v_any_within boolean:=false;
begin
  if not public._hider_password_ok(p_game_id,p_password) then raise exception 'Invalid hider password.'; end if;
  select payload, payload->>'title', payload->>'question_kind', coalesce((payload->>'valid_distance_m')::integer,250)
    into v_payload,v_title,v_kind,v_limit
    from public.game_actions
    where id=p_question_action_id and game_id=p_game_id and kind='question' and is_active;
  if v_kind is null then raise exception 'Question is not active.'; end if;
  if v_kind<>'tentacle' then raise exception 'Automatic proximity veto is only valid for Tentacle questions.'; end if;
  if exists(select 1 from public.game_actions where parent_id=p_question_action_id and kind in ('answer','question_veto') and is_active) then raise exception 'Question already resolved.'; end if;

  select case when endgame then hidden_lat else station_lat end,
         case when endgame then hidden_lng else station_lng end
    into v_target_lat,v_target_lng
    from public.game_secrets where game_id=p_game_id;
  if v_target_lat is null or v_target_lng is null then raise exception 'Private target is unavailable.'; end if;

  for v_poi in select value from jsonb_array_elements(coalesce(v_payload->'pois','[]'::jsonb)) loop
    v_lat:=(v_poi->>'lat')::double precision; v_lng:=(v_poi->>'lng')::double precision;
    v_a:=power(sin(radians(v_lat-v_target_lat)/2),2)
       + cos(radians(v_target_lat))*cos(radians(v_lat))*power(sin(radians(v_lng-v_target_lng)/2),2);
    v_distance:=2*6371008.8*asin(least(1.0,sqrt(greatest(0.0,v_a))));
    if v_distance<=v_limit then v_any_within:=true; exit; end if;
  end loop;
  if v_any_within then raise exception 'Tentacle has at least one candidate within the validity distance and cannot be automatically vetoed.'; end if;

  insert into public.game_actions(game_id,actor,kind,parent_id,payload)
    values(p_game_id,'hider','question_veto',p_question_action_id,
      jsonb_build_object('automatic_tentacle',true,'question_title',coalesce(v_title,'Tentacle'),'valid_distance_m',v_limit,'reason','no_candidate_within_limit'))
    returning id into v_id;
  return v_id;
end;$$;

create or replace function public.play_card_v3(p_game_id uuid,p_password text,p_card_key text,p_copy_card_key text default null)
returns uuid language plpgsql security definer set search_path=public,extensions as $$
declare v_card jsonb; v_copy jsonb; v_effect text; v_kind text; v_duration integer; v_now timestamptz:=now(); v_id uuid; v_title text; v_desc text; v_value integer;
begin
  if not public._hider_password_ok(p_game_id,p_password) then raise exception 'Invalid hider password.'; end if;
  v_card:=public._get_held_card(p_game_id,p_card_key); if v_card is null then raise exception 'Card is not available in hand.'; end if;
  v_effect:=v_card->>'effect_key'; v_kind:=v_card->>'card_kind';
  if v_effect='duplicate' then
    if p_copy_card_key is null then raise exception 'Choose a card to duplicate.'; end if;
    v_copy:=public._get_held_card(p_game_id,p_copy_card_key); if v_copy is null then raise exception 'Duplicate target is not available.'; end if;
    if v_copy->>'card_kind'='time_bonus' then
      perform public._consume_held_card(p_game_id,p_card_key);
      insert into public.private_card_uses(game_id,card_key,effect_key,value_int,metadata) values(p_game_id,p_card_key,'duplicate_bonus',(v_copy->>'value_int')::integer,jsonb_build_object('copied_card_key',p_copy_card_key,'copied_title',v_copy->>'title')) returning id into v_id; return v_id;
    elsif v_copy->>'card_kind'='curse' then
      v_card:=v_copy; v_effect:=v_copy->>'effect_key'; v_kind:='curse';
      perform public._consume_held_card(p_game_id,p_card_key);
    else raise exception 'Duplicate currently supports time bonuses and curses.'; end if;
  else
    if v_kind<>'curse' then raise exception 'This card is used elsewhere in the interface.'; end if;
    perform public._consume_held_card(p_game_id,p_card_key);
  end if;
  v_title:=v_card->>'title';v_desc:=v_card->>'description';v_duration:=nullif(v_card->>'duration_seconds','')::integer;v_value:=nullif(v_card->>'value_int','')::integer;
  insert into public.game_actions(game_id,actor,kind,payload) values(p_game_id,'hider','curse_play',jsonb_build_object('source_card_key',p_card_key,'effect_key',v_effect,'title',v_title,'description',v_desc,'duration_seconds',v_duration,'value_int',v_value,'starts_at',v_now,'ends_at',case when v_duration is null then null else v_now+make_interval(secs=>v_duration) end,'copied_from',p_copy_card_key)) returning id into v_id; return v_id;
end;$$;

create or replace function public.place_time_trap_v3(p_game_id uuid,p_password text,p_card_key text,p_station_name text,p_station_lat double precision,p_station_lng double precision)
returns uuid language plpgsql security definer set search_path=public,extensions as $$
declare v_card jsonb; v_id uuid; v_base integer;
begin
  if not public._hider_password_ok(p_game_id,p_password) then raise exception 'Invalid hider password.'; end if;
  v_card:=public._get_held_card(p_game_id,p_card_key); if v_card is null or v_card->>'effect_key'<>'time_trap' then raise exception 'No unused Time Trap card.'; end if;
  perform public._consume_held_card(p_game_id,p_card_key); v_base:=coalesce(nullif(v_card->>'value_int','')::integer,5);
  insert into public.time_traps(game_id,card_key,station_name,station_lat,station_lng,base_bonus_minutes) values(p_game_id,p_card_key,p_station_name,p_station_lat,p_station_lng,v_base) returning id into v_id; return v_id;
end;$$;

create or replace function public.get_time_traps_v3(p_game_id uuid,p_password text)
returns table(id uuid,card_key text,station_name text,station_lat double precision,station_lng double precision,base_bonus_minutes integer,armed_at timestamptz,triggered_at timestamptz,bonus_minutes integer,trigger_active boolean,current_bonus_minutes integer)
language plpgsql security definer set search_path=public,extensions as $$
begin
  if not public._hider_password_ok(p_game_id,p_password) then raise exception 'Invalid hider password.'; end if;
  return query select t.id,t.card_key,t.station_name,t.station_lat,t.station_lng,t.base_bonus_minutes,t.armed_at,t.triggered_at,t.bonus_minutes,t.trigger_active,case when t.trigger_active then coalesce(t.bonus_minutes,t.base_bonus_minutes) else t.base_bonus_minutes+(floor(extract(epoch from (now()-t.armed_at))/3600)::integer*10) end from public.time_traps t where t.game_id=p_game_id order by t.armed_at;
end;$$;

create or replace function public.set_time_trap_trigger_v3(p_game_id uuid,p_trap_id uuid,p_password text,p_active boolean)
returns boolean language plpgsql security definer set search_path=public,extensions as $$
declare v_trap public.time_traps%rowtype; v_bonus integer; v_action uuid;
begin
  if not public._hider_password_ok(p_game_id,p_password) then raise exception 'Invalid hider password.'; end if;
  select * into v_trap from public.time_traps where id=p_trap_id and game_id=p_game_id; if not found then raise exception 'Time Trap not found.'; end if;
  if p_active then
    v_bonus:=v_trap.base_bonus_minutes+(floor(extract(epoch from (now()-v_trap.armed_at))/3600)::integer*10);
    update public.time_traps set triggered_at=now(),bonus_minutes=v_bonus,trigger_active=true where id=p_trap_id;
    select id into v_action from public.game_actions where game_id=p_game_id and kind='time_trap_trigger' and payload->>'trap_id'=p_trap_id::text order by created_at desc limit 1;
    if v_action is null then insert into public.game_actions(game_id,actor,kind,payload) values(p_game_id,'hider','time_trap_trigger',jsonb_build_object('trap_id',p_trap_id,'station_name',v_trap.station_name,'bonus_minutes',v_bonus)) returning id into v_action; else update public.game_actions set is_active=true,payload=payload||jsonb_build_object('station_name',v_trap.station_name,'bonus_minutes',v_bonus) where id=v_action; end if;
  else
    update public.time_traps set trigger_active=false where id=p_trap_id;
    update public.game_actions set is_active=false where game_id=p_game_id and kind='time_trap_trigger' and payload->>'trap_id'=p_trap_id::text;
  end if;
  return true;
end;$$;

create or replace function public.get_private_card_uses_v3(p_game_id uuid,p_password text)
returns table(id uuid,card_key text,effect_key text,value_int integer,metadata jsonb,is_active boolean,created_at timestamptz)
language plpgsql security definer set search_path=public,extensions as $$
begin
  if not public._hider_password_ok(p_game_id,p_password) then raise exception 'Invalid hider password.'; end if;
  return query select u.id,u.card_key,u.effect_key,u.value_int,u.metadata,u.is_active,u.created_at from public.private_card_uses u where u.game_id=p_game_id order by u.created_at;
end;$$;

create or replace function public.set_action_active_v3(p_game_id uuid,p_action_id uuid,p_password text,p_active boolean)
returns boolean language plpgsql security definer set search_path=public,extensions as $$
declare v public.game_actions%rowtype; v_slot text; v_duration integer; v_now timestamptz:=now();
begin
  select * into v from public.game_actions where id=p_action_id and game_id=p_game_id; if not found then raise exception 'Action not found.'; end if;
  if v.actor='hider' and not public._hider_password_ok(p_game_id,p_password) then raise exception 'Invalid hider password.'; end if;
  if v.kind='time_trap_trigger' then raise exception 'Use the private Time Trap controls to undo/redo a trap.'; end if;
  if p_active and v.kind='question' then v_slot:=v.payload->>'slot_key';if exists(select 1 from public.game_actions a where a.game_id=p_game_id and a.kind='question' and a.is_active and a.id<>p_action_id and a.payload->>'slot_key'=v_slot) then raise exception 'Another active question uses that card.'; end if; end if;
  if p_active and v.kind in ('answer','question_veto') and not exists(select 1 from public.game_actions q where q.id=v.parent_id and q.kind='question' and q.is_active) then raise exception 'Redo the parent question first.'; end if;
  if p_active and v.kind='curse_play' then v_duration:=nullif(v.payload->>'duration_seconds','')::integer;update public.game_actions set is_active=true,payload=payload||jsonb_build_object('starts_at',v_now,'ends_at',case when v_duration is null then null else v_now+make_interval(secs=>v_duration) end) where id=p_action_id; else update public.game_actions set is_active=p_active where id=p_action_id; end if;
  return true;
end;$$;

create or replace function public.server_now() returns timestamptz language sql stable security definer set search_path=public as $$select now();$$;

create or replace function public.set_game_status(p_game_id uuid,p_password text,p_status text)
returns boolean language plpgsql security definer set search_path=public,extensions as $$
begin if p_status not in ('active','finished') then raise exception 'Invalid status.'; end if;if not public._hider_password_ok(p_game_id,p_password) then raise exception 'Invalid hider password.'; end if;update public.games set status=p_status where id=p_game_id;return found;end;$$;

-- v3.2 station-first / delayed-Endgame target functions
create or replace function public.create_game_v4(
  p_name text,p_password text,p_station_name text,p_station_lat double precision,p_station_lng double precision
) returns uuid language plpgsql security definer set search_path=public,extensions as $$
declare v_id uuid;
begin
  if char_length(trim(coalesce(p_name,''))) not between 1 and 80 then raise exception 'Game name must be 1-80 characters.'; end if;
  if char_length(coalesce(p_password,''))<4 then raise exception 'Password must be at least 4 characters.'; end if;
  if p_station_lat not between 48.05 and 48.40 or p_station_lng not between 16.05 and 16.70 then raise exception 'Station coordinate outside Vienna guardrail.'; end if;
  insert into public.games(name) values(trim(p_name)) returning id into v_id;
  insert into public.game_secrets(game_id,hidden_lat,hidden_lng,password_hash,station_lat,station_lng,station_name,endgame,base_radius_m)
  values(v_id,null,null,extensions.crypt(p_password,extensions.gen_salt('bf',10)),p_station_lat,p_station_lng,coalesce(nullif(trim(p_station_name),''),'Station'),false,250);
  return v_id;
end;$$;

create or replace function public.get_hider_game_v4(p_game_id uuid,p_password text)
returns table(game_id uuid,game_name text,game_status text,hidden_lat double precision,hidden_lng double precision,station_lat double precision,station_lng double precision,station_name text,endgame boolean,base_radius_m integer)
language plpgsql security definer set search_path=public,extensions as $$
begin
  return query select g.id,g.name,g.status,s.hidden_lat,s.hidden_lng,s.station_lat,s.station_lng,s.station_name,s.endgame,s.base_radius_m
  from public.games g join public.game_secrets s on s.game_id=g.id
  where g.id=p_game_id and s.password_hash=extensions.crypt(coalesce(p_password,''),s.password_hash);
end;$$;

create or replace function public.set_endgame_v4(
  p_game_id uuid,p_password text,p_endgame boolean,p_hidden_lat double precision default null,p_hidden_lng double precision default null
) returns boolean language plpgsql security definer set search_path=public,extensions as $$
declare
  v_station_lat double precision; v_station_lng double precision; v_base integer; v_dist_m double precision;
  v_home_count integer; v_limit_m double precision;
begin
  if not public._hider_password_ok(p_game_id,p_password) then raise exception 'Invalid hider password.'; end if;
  if not p_endgame then
    update public.game_secrets set endgame=false where game_id=p_game_id;
    return found;
  end if;

  if p_hidden_lat is null or p_hidden_lng is null then raise exception 'Choose the actual hiding location before starting Endgame.'; end if;
  if p_hidden_lat not between 48.05 and 48.40 or p_hidden_lng not between 16.05 and 16.70 then raise exception 'Hiding coordinate outside Vienna guardrail.'; end if;

  select station_lat,station_lng,base_radius_m into v_station_lat,v_station_lng,v_base from public.game_secrets where game_id=p_game_id;
  if v_station_lat is null or v_station_lng is null then raise exception 'Game has no hiding station.'; end if;

  select count(*) into v_home_count from public.game_actions
    where game_id=p_game_id and kind='curse_play' and is_active and payload->>'effect_key'='prosperous_home';
  v_limit_m := coalesce(v_base,250) * sqrt(power(2.0,v_home_count));
  v_dist_m := 6371000 * 2 * asin(sqrt(power(sin(radians(p_hidden_lat-v_station_lat)/2),2)+cos(radians(v_station_lat))*cos(radians(p_hidden_lat))*power(sin(radians(p_hidden_lng-v_station_lng)/2),2)));
  if v_dist_m>v_limit_m+0.5 then raise exception 'Actual hiding spot is % m from the station; current maximum is % m.',round(v_dist_m)::integer,round(v_limit_m)::integer; end if;

  update public.game_secrets set hidden_lat=p_hidden_lat,hidden_lng=p_hidden_lng,endgame=true where game_id=p_game_id;
  return found;
end;$$;

-- Function permissions
revoke all on function public._hider_password_ok(uuid,text) from public;
revoke all on function public._get_held_card(uuid,text) from public;
revoke all on function public._consume_held_card(uuid,text) from public;

grant execute on function public.create_game_v3(text,text,text,double precision,double precision,double precision,double precision) to anon,authenticated;
grant execute on function public.get_hider_game_v3(uuid,text) to anon,authenticated;
grant execute on function public.set_endgame_v3(uuid,text,boolean) to anon,authenticated;
grant execute on function public.create_game_v4(text,text,text,double precision,double precision) to anon,authenticated;
grant execute on function public.get_hider_game_v4(uuid,text) to anon,authenticated;
grant execute on function public.set_endgame_v4(uuid,text,boolean,double precision,double precision) to anon,authenticated;
grant execute on function public.add_thermo_reference_v3(uuid,double precision,double precision,double precision,text) to anon,authenticated;
grant execute on function public.ask_question_v3(uuid,text,text,jsonb) to anon,authenticated;
grant execute on function public.answer_question_v3(uuid,uuid,text,jsonb) to anon,authenticated;
grant execute on function public.get_hider_draws_v3(uuid,text) to anon,authenticated;
grant execute on function public.toggle_keep_card_v3(uuid,uuid,text,text,boolean) to anon,authenticated;
grant execute on function public.veto_question_v3(uuid,uuid,text,text) to anon,authenticated;
grant execute on function public.auto_veto_tentacle_v3(uuid,uuid,text) to anon,authenticated;
grant execute on function public.play_card_v3(uuid,text,text,text) to anon,authenticated;
grant execute on function public.place_time_trap_v3(uuid,text,text,text,double precision,double precision) to anon,authenticated;
grant execute on function public.get_time_traps_v3(uuid,text) to anon,authenticated;
grant execute on function public.set_time_trap_trigger_v3(uuid,uuid,text,boolean) to anon,authenticated;
grant execute on function public.get_private_card_uses_v3(uuid,text) to anon,authenticated;
grant execute on function public.set_action_active_v3(uuid,uuid,text,boolean) to anon,authenticated;
grant execute on function public.server_now() to anon,authenticated;
grant execute on function public.set_game_status(uuid,text,text) to anon,authenticated;

-- Realtime publication: rerunning is safe through exception handling.
do $$ begin alter publication supabase_realtime add table public.game_actions; exception when duplicate_object then null; end $$;
-- Vienna Hide & Seek v3.2.2 migration
-- Run ONCE on an existing v3.2.x database.
-- Adds a public-but-UI-hidden Endgame zone action so both clients can switch the
-- deduction map from all of Vienna to the final station radius without exposing
-- the private hiding coordinate.

create or replace function public.set_endgame_v5(
  p_game_id uuid,
  p_password text,
  p_endgame boolean,
  p_hidden_lat double precision default null,
  p_hidden_lng double precision default null
) returns boolean
language plpgsql
security definer
set search_path=public,extensions
as $$
declare
  v_station_lat double precision;
  v_station_lng double precision;
  v_station_name text;
  v_base integer;
  v_dist_m double precision;
  v_home_count integer;
  v_limit_m double precision;
begin
  if not public._hider_password_ok(p_game_id,p_password) then
    raise exception 'Invalid hider password.';
  end if;

  if not p_endgame then
    update public.game_secrets
      set endgame=false
      where game_id=p_game_id;

    update public.game_actions
      set is_active=false
      where game_id=p_game_id
        and kind='endgame_zone'
        and is_active;

    return true;
  end if;

  if p_hidden_lat is null or p_hidden_lng is null then
    raise exception 'Choose the actual hiding location before starting Endgame.';
  end if;
  if p_hidden_lat not between 48.05 and 48.40 or p_hidden_lng not between 16.05 and 16.70 then
    raise exception 'Hiding coordinate outside Vienna guardrail.';
  end if;

  select station_lat,station_lng,station_name,base_radius_m
    into v_station_lat,v_station_lng,v_station_name,v_base
  from public.game_secrets
  where game_id=p_game_id;

  if v_station_lat is null or v_station_lng is null then
    raise exception 'Game has no hiding station.';
  end if;

  select count(*) into v_home_count
  from public.game_actions
  where game_id=p_game_id
    and kind='curse_play'
    and is_active
    and payload->>'effect_key'='prosperous_home';

  v_limit_m := coalesce(v_base,250) * sqrt(power(2.0,v_home_count));

  v_dist_m := 6371000 * 2 * asin(sqrt(
    power(sin(radians(p_hidden_lat-v_station_lat)/2),2)
    + cos(radians(v_station_lat))*cos(radians(p_hidden_lat))
    * power(sin(radians(p_hidden_lng-v_station_lng)/2),2)
  ));

  if v_dist_m>v_limit_m+0.5 then
    raise exception 'Actual hiding spot is % m from the station; current maximum is % m.',
      round(v_dist_m)::integer,round(v_limit_m)::integer;
  end if;

  update public.game_secrets
    set hidden_lat=p_hidden_lat,
        hidden_lng=p_hidden_lng,
        endgame=true
    where game_id=p_game_id;

  -- End any older zone and create a fresh phase marker. The action contains the
  -- already-known station and radius, never the private final hiding coordinate.
  update public.game_actions
    set is_active=false
    where game_id=p_game_id
      and kind='endgame_zone'
      and is_active;

  insert into public.game_actions(game_id,actor,kind,payload)
  values(
    p_game_id,
    'hider',
    'endgame_zone',
    jsonb_build_object(
      'station_name',coalesce(v_station_name,'Station'),
      'center',jsonb_build_object('lat',v_station_lat,'lng',v_station_lng),
      'radius_m',round(v_limit_m)::integer
    )
  );

  return true;
end;
$$;

grant execute on function public.set_endgame_v5(uuid,text,boolean,double precision,double precision) to anon,authenticated;


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
-- Vienna Hide & Seek v3.4.0 migration
-- Run ONCE after v3.3.x.

create extension if not exists pgcrypto with schema extensions;

-- Shared game clock ---------------------------------------------------------
alter table public.games add column if not exists clock_elapsed_seconds bigint not null default 0;
alter table public.games add column if not exists clock_started_at timestamptz;
alter table public.games add column if not exists clock_running boolean not null default false;

create or replace function public.set_game_clock_v1(p_game_id uuid,p_password text,p_action text)
returns boolean language plpgsql security definer set search_path=public,extensions as $$
declare v_now timestamptz:=now();v_running boolean;v_started timestamptz;
begin
  if not public._hider_password_ok(p_game_id,p_password) then raise exception 'Invalid hider password.'; end if;
  select clock_running,clock_started_at into v_running,v_started from public.games where id=p_game_id for update;
  if not found then raise exception 'Game not found.'; end if;
  if p_action in ('start','resume') then
    if not v_running then update public.games set clock_running=true,clock_started_at=v_now where id=p_game_id; end if;
  elsif p_action='pause' then
    if v_running and v_started is not null then
      update public.games set
        clock_elapsed_seconds=clock_elapsed_seconds+greatest(0,floor(extract(epoch from (v_now-v_started)))::bigint),
        clock_running=false,clock_started_at=null where id=p_game_id;
    end if;
  else raise exception 'Invalid clock action.'; end if;
  return true;
end;$$;
grant execute on function public.set_game_clock_v1(uuid,text,text) to anon,authenticated;
do $$ begin alter publication supabase_realtime add table public.games; exception when duplicate_object then null; end $$;

-- Latest seeker GPS, readable only through Hider-password RPC ---------------
create table if not exists public.seeker_live_positions(
  game_id uuid primary key references public.games(id) on delete cascade,
  lat double precision not null,lng double precision not null,accuracy_m double precision,
  source text not null default 'gps',updated_at timestamptz not null default now()
);
alter table public.seeker_live_positions enable row level security;
revoke all on public.seeker_live_positions from anon,authenticated;

create or replace function public.set_seeker_live_position_v1(p_game_id uuid,p_lat double precision,p_lng double precision,p_accuracy_m double precision default null)
returns boolean language plpgsql security definer set search_path=public as $$
begin
  if not exists(select 1 from public.games where id=p_game_id and status='active') then raise exception 'Game is not active.'; end if;
  insert into public.seeker_live_positions(game_id,lat,lng,accuracy_m,source,updated_at)
  values(p_game_id,p_lat,p_lng,p_accuracy_m,'gps',now())
  on conflict(game_id) do update set lat=excluded.lat,lng=excluded.lng,accuracy_m=excluded.accuracy_m,source='gps',updated_at=now();
  return true;
end;$$;

create or replace function public.get_seeker_live_position_v1(p_game_id uuid,p_password text)
returns table(lat double precision,lng double precision,accuracy_m double precision,source text,updated_at timestamptz)
language plpgsql security definer set search_path=public,extensions as $$
begin
  if not public._hider_password_ok(p_game_id,p_password) then raise exception 'Invalid hider password.'; end if;
  return query select s.lat,s.lng,s.accuracy_m,s.source,s.updated_at from public.seeker_live_positions s where s.game_id=p_game_id;
end;$$;
grant execute on function public.set_seeker_live_position_v1(uuid,double precision,double precision,double precision) to anon,authenticated;
grant execute on function public.get_seeker_live_position_v1(uuid,text) to anon,authenticated;

-- Card catalogue ------------------------------------------------------------
alter table public.curse_cards add column if not exists cast_cost_minutes integer not null default 0;
delete from public.curse_cards;

-- Exactly 5x5, 4x10, 3x15, 2x20 minute cards.
insert into public.curse_cards(card_key,title,description,duration_seconds,card_kind,effect_key,value_int,cast_cost_minutes)
select 'time-5-'||g,'5 Minute Bonus','Keep in your hand; adds five minutes to the final hiding time.',null::integer,'time_bonus','time_bonus',5,0 from generate_series(1,5) g
union all select 'time-10-'||g,'10 Minute Bonus','Keep in your hand; adds ten minutes to the final hiding time.',null::integer,'time_bonus','time_bonus',10,0 from generate_series(1,4) g
union all select 'time-15-'||g,'15 Minute Bonus','Keep in your hand; adds fifteen minutes to the final hiding time.',null::integer,'time_bonus','time_bonus',15,0 from generate_series(1,3) g
union all select 'time-20-'||g,'20 Minute Bonus','Keep in your hand; adds twenty minutes to the final hiding time.',null::integer,'time_bonus','time_bonus',20,0 from generate_series(1,2) g;

insert into public.curse_cards(card_key,title,description,duration_seconds,card_kind,effect_key,value_int,cast_cost_minutes)
select 'veto-'||g,'Veto Question','Use on a pending seeker question to refuse that question; no answer is sent.',null::integer,'powerup','veto_question',null::integer,0 from generate_series(1,6) g
union all select 'duplicate-'||g,'Duplicate','Copy another held time-bonus or curse card without consuming the original.',null::integer,'powerup','duplicate',null::integer,0 from generate_series(1,4) g
union all select 'time-trap-'||g,'Time Trap','Secretly place this on a station. If triggered, it awards its base bonus plus 10 minutes per full hour it was armed.',null::integer,'time_trap','time_trap',5,0 from generate_series(1,6) g
union all select 'gamblers-feet-'||g,'Curse of the Gambler''s Feet','For one hour, seekers use a die to determine how many steps they may take before rolling again.',3600,'curse','gamblers_feet',null::integer,0 from generate_series(1,3) g
union all select 'fog-'||g,'Curse of the Impenetrable Fog','For one hour, seekers randomize their direction whenever they reach a qualifying street intersection.',3600,'curse','impenetrable_fog',null::integer,0 from generate_series(1,3) g
union all select 'express-'||g,'Curse of the Express Route','Seekers may not disembark their current train for up to 30 minutes, unless it reaches the end of its line first.',1800,'curse','express_route',null::integer,15 from generate_series(1,3) g
union all select 'prosperous-'||g,'Curse of the Prosperous Home','Expand the final hiding area. This Vienna implementation doubles area rather than doubling radius.',null::integer,'curse','prosperous_home',2,0 from generate_series(1,3) g;

-- One shuffled draw pile per game. The cursor advances without replacement.
create table if not exists public.game_card_state(
  game_id uuid primary key references public.games(id) on delete cascade,
  cycle integer not null default 0,
  deck jsonb not null default '[]'::jsonb check(jsonb_typeof(deck)='array'),
  cursor integer not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.game_card_state enable row level security;
revoke all on public.game_card_state from anon,authenticated;

create or replace function public._reshuffle_card_deck_v1(p_game_id uuid)
returns integer language plpgsql security definer set search_path=public as $$
declare v_deck jsonb;v_cycle integer;
begin
  select coalesce(jsonb_agg(c.card_key order by random()),'[]'::jsonb) into v_deck
  from public.curse_cards c
  where not exists(
    select 1 from public.curse_draws d
    where d.game_id=p_game_id and d.kept_card_keys ? c.card_key and not(d.used_card_keys ? c.card_key)
  );
  insert into public.game_card_state(game_id,cycle,deck,cursor,updated_at)
  values(p_game_id,1,v_deck,0,now())
  on conflict(game_id) do update set cycle=public.game_card_state.cycle+1,deck=excluded.deck,cursor=0,updated_at=now()
  returning cycle into v_cycle;
  return v_cycle;
end;$$;

create or replace function public._draw_cards_v4(p_game_id uuid,p_count integer)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_result jsonb:='[]'::jsonb;v_state public.game_card_state%rowtype;v_key text;v_card public.curse_cards%rowtype;
begin
  if p_count<=0 then return v_result; end if;
  if not exists(select 1 from public.game_card_state where game_id=p_game_id) then perform public._reshuffle_card_deck_v1(p_game_id); end if;
  while jsonb_array_length(v_result)<p_count loop
    select * into v_state from public.game_card_state where game_id=p_game_id for update;
    if v_state.cursor>=jsonb_array_length(v_state.deck) then
      perform public._reshuffle_card_deck_v1(p_game_id);
      select * into v_state from public.game_card_state where game_id=p_game_id for update;
      if jsonb_array_length(v_state.deck)=0 then exit; end if;
    end if;
    v_key:=v_state.deck->>v_state.cursor;
    update public.game_card_state set cursor=cursor+1,updated_at=now() where game_id=p_game_id;
    select * into v_card from public.curse_cards where card_key=v_key;
    if found then
      v_result:=v_result||jsonb_build_array(jsonb_build_object(
        'card_key',v_card.card_key,'title',v_card.title,'description',v_card.description,
        'duration_seconds',v_card.duration_seconds,'card_kind',v_card.card_kind,
        'effect_key',v_card.effect_key,'value_int',v_card.value_int,'cast_cost_minutes',v_card.cast_cost_minutes));
    end if;
  end loop;
  return v_result;
end;$$;

create or replace function public.answer_question_v4(p_game_id uuid,p_question_action_id uuid,p_password text,p_answer jsonb)
returns uuid language plpgsql security definer set search_path=public,extensions as $$
declare v_answer_id uuid;v_cards jsonb;v_kind text;v_draw_count integer;v_keep_limit integer;
begin
  if not public._hider_password_ok(p_game_id,p_password) then raise exception 'Invalid hider password.'; end if;
  select q.payload->>'question_kind' into v_kind from public.game_actions q where q.id=p_question_action_id and q.game_id=p_game_id and q.kind='question' and q.is_active;
  if v_kind is null then raise exception 'Question is not active.'; end if;
  if exists(select 1 from public.game_actions a where a.parent_id=p_question_action_id and a.kind in('answer','question_veto') and a.is_active) then raise exception 'Question already has an active answer/veto.'; end if;
  insert into public.game_actions(game_id,actor,kind,parent_id,payload) values(p_game_id,'hider','answer',p_question_action_id,jsonb_build_object('answer',coalesce(p_answer,'{}'::jsonb))) returning id into v_answer_id;
  if v_kind in('radar','thermometer') then v_draw_count:=2;v_keep_limit:=1;
  elsif v_kind='tentacle' then v_draw_count:=4;v_keep_limit:=2;
  else v_draw_count:=3;v_keep_limit:=1;end if;
  if not exists(select 1 from public.curse_draws where question_action_id=p_question_action_id) then
    v_cards:=public._draw_cards_v4(p_game_id,v_draw_count);
    if jsonb_array_length(v_cards)>0 then insert into public.curse_draws(game_id,question_action_id,cards,keep_limit) values(p_game_id,p_question_action_id,v_cards,v_keep_limit) on conflict(question_action_id) do nothing;end if;
  end if;
  return v_answer_id;
end;$$;
grant execute on function public.answer_question_v4(uuid,uuid,text,jsonb) to anon,authenticated;

create or replace function public.discard_held_card_v1(p_game_id uuid,p_password text,p_card_key text)
returns boolean language plpgsql security definer set search_path=public,extensions as $$
begin
  if not public._hider_password_ok(p_game_id,p_password) then raise exception 'Invalid hider password.';end if;
  if public._get_held_card(p_game_id,p_card_key) is null then raise exception 'Card is not available in hand.';end if;
  return public._consume_held_card(p_game_id,p_card_key);
end;$$;
grant execute on function public.discard_held_card_v1(uuid,text,text) to anon,authenticated;

create or replace function public.get_card_deck_status_v1(p_game_id uuid,p_password text)
returns table(cycle integer,remaining integer,total integer)
language plpgsql security definer set search_path=public,extensions as $$
declare v public.game_card_state%rowtype;
begin
  if not public._hider_password_ok(p_game_id,p_password) then raise exception 'Invalid hider password.';end if;
  if not exists(select 1 from public.game_card_state where game_id=p_game_id) then perform public._reshuffle_card_deck_v1(p_game_id);end if;
  select * into v from public.game_card_state where game_id=p_game_id;
  return query select v.cycle,greatest(0,jsonb_array_length(v.deck)-v.cursor),jsonb_array_length(v.deck);
end;$$;
grant execute on function public.get_card_deck_status_v1(uuid,text) to anon,authenticated;

create or replace function public.play_card_v4(p_game_id uuid,p_password text,p_card_key text,p_copy_card_key text default null,p_cost_card_keys text[] default array[]::text[])
returns uuid language plpgsql security definer set search_path=public,extensions as $$
declare v_card jsonb;v_copy jsonb;v_effect text;v_kind text;v_duration integer;v_now timestamptz:=now();v_id uuid;v_title text;v_desc text;v_value integer;v_cost integer:=0;v_paid integer:=0;v_key text;v_pay jsonb;
begin
  if not public._hider_password_ok(p_game_id,p_password) then raise exception 'Invalid hider password.';end if;
  v_card:=public._get_held_card(p_game_id,p_card_key);if v_card is null then raise exception 'Card is not available in hand.';end if;
  v_effect:=v_card->>'effect_key';v_kind:=v_card->>'card_kind';
  if v_effect='duplicate' then
    if p_copy_card_key is null then raise exception 'Choose a card to duplicate.';end if;
    v_copy:=public._get_held_card(p_game_id,p_copy_card_key);if v_copy is null then raise exception 'Duplicate target is not available.';end if;
    if v_copy->>'card_kind'='time_bonus' then
      perform public._consume_held_card(p_game_id,p_card_key);
      insert into public.private_card_uses(game_id,card_key,effect_key,value_int,metadata) values(p_game_id,p_card_key,'duplicate_bonus',(v_copy->>'value_int')::integer,jsonb_build_object('copied_card_key',p_copy_card_key,'copied_title',v_copy->>'title')) returning id into v_id;return v_id;
    elsif v_copy->>'card_kind'='curse' then v_card:=v_copy;v_effect:=v_copy->>'effect_key';v_kind:='curse';
    else raise exception 'Duplicate currently supports time bonuses and curses.';end if;
  elsif v_kind<>'curse' then raise exception 'This card is used elsewhere in the interface.';end if;

  v_cost:=coalesce(nullif(v_card->>'cast_cost_minutes','')::integer,0);
  if v_cost>0 then
    if coalesce(array_length(p_cost_card_keys,1),0)=0 then raise exception 'Choose time-bonus cards to pay the casting cost.';end if;
    foreach v_key in array p_cost_card_keys loop
      v_pay:=public._get_held_card(p_game_id,v_key);
      if v_pay is null or v_pay->>'card_kind'<>'time_bonus' then raise exception 'Casting costs can only be paid with held time-bonus cards.';end if;
      v_paid:=v_paid+coalesce((v_pay->>'value_int')::integer,0);
    end loop;
    if v_paid<v_cost then raise exception 'Selected time bonuses do not cover the casting cost.';end if;
  end if;

  perform public._consume_held_card(p_game_id,p_card_key);
  foreach v_key in array p_cost_card_keys loop perform public._consume_held_card(p_game_id,v_key);end loop;
  v_title:=v_card->>'title';v_desc:=v_card->>'description';v_duration:=nullif(v_card->>'duration_seconds','')::integer;v_value:=nullif(v_card->>'value_int','')::integer;
  insert into public.game_actions(game_id,actor,kind,payload) values(p_game_id,'hider','curse_play',jsonb_build_object('source_card_key',p_card_key,'effect_key',v_effect,'title',v_title,'description',v_desc,'duration_seconds',v_duration,'value_int',v_value,'starts_at',v_now,'ends_at',case when v_duration is null then null else v_now+make_interval(secs=>v_duration) end,'copied_from',p_copy_card_key,'cast_cost_minutes',v_cost,'cast_paid_minutes',v_paid,'cast_cards',to_jsonb(p_cost_card_keys))) returning id into v_id;
  return v_id;
end;$$;
grant execute on function public.play_card_v4(uuid,text,text,text,text[]) to anon,authenticated;

-- Vienna Hide & Seek v3.5.0 migration
-- Run ONCE after v3.4.0.
-- Adds photo questions/private upload authorization, per-question answer penalties,
-- and per-card Thermometer starts.

create extension if not exists pgcrypto with schema extensions;

-- -------------------------------------------------------------------------
-- Hider-authorized one-time photo upload tickets
-- -------------------------------------------------------------------------
create table if not exists public.game_photo_upload_tickets(
  path text primary key,
  game_id uuid not null references public.games(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
alter table public.game_photo_upload_tickets enable row level security;
revoke all on public.game_photo_upload_tickets from anon,authenticated;

create or replace function public.create_photo_upload_ticket_v1(p_game_id uuid,p_password text,p_extension text default 'jpg')
returns text
language plpgsql
security definer
set search_path=public,extensions
as $$
declare v_ext text;v_path text;
begin
  if not public._hider_password_ok(p_game_id,p_password) then raise exception 'Invalid hider password.'; end if;
  v_ext:=lower(regexp_replace(coalesce(p_extension,'jpg'),'[^a-z0-9]','','g'));
  if v_ext not in ('jpg','jpeg','png','webp','heic','heif') then v_ext:='jpg'; end if;
  if v_ext='jpeg' then v_ext:='jpg'; end if;
  v_path:=p_game_id::text||'/'||gen_random_uuid()::text||'.'||v_ext;
  insert into public.game_photo_upload_tickets(path,game_id,expires_at) values(v_path,p_game_id,now()+interval '10 minutes');
  return v_path;
end;$$;
grant execute on function public.create_photo_upload_ticket_v1(uuid,text,text) to anon,authenticated;

create or replace function public.can_upload_game_photo_path_v1(p_name text)
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select exists(
    select 1 from public.game_photo_upload_tickets t
    where t.path=p_name and t.expires_at>now()
  );
$$;
grant execute on function public.can_upload_game_photo_path_v1(text) to anon,authenticated;

create or replace function public.can_read_game_photo_path_v1(p_name text)
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select exists(
    select 1 from public.game_actions a
    where a.kind='answer'
      and a.payload #>> '{answer,photo_path}' = p_name
  );
$$;
grant execute on function public.can_read_game_photo_path_v1(text) to anon,authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('game-photos','game-photos',false,26214400,array['image/*']::text[])
on conflict(id) do update set
  public=false,
  file_size_limit=excluded.file_size_limit,
  allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists "hns hider photo uploads" on storage.objects;
create policy "hns hider photo uploads"
on storage.objects for insert to anon,authenticated
with check (
  bucket_id='game-photos'
  and public.can_upload_game_photo_path_v1(name)
);

drop policy if exists "hns public answered photos" on storage.objects;
create policy "hns public answered photos"
on storage.objects for select to anon,authenticated
using (
  bucket_id='game-photos'
  and public.can_read_game_photo_path_v1(name)
);

-- -------------------------------------------------------------------------
-- Question timing / penalty helpers
-- 15 minutes are free. Every FULL 10-minute block beyond that costs
-- 20 minutes from the final score.
-- -------------------------------------------------------------------------
create or replace function public._question_late_penalty_minutes_v1(p_question_action_id uuid,p_resolved_at timestamptz default now())
returns integer
language sql
stable
security definer
set search_path=public
as $$
  select case
    when q.created_at is null then 0
    when extract(epoch from (p_resolved_at-q.created_at)) <= 900 then 0
    else 20 * floor((extract(epoch from (p_resolved_at-q.created_at))-900) / 600.0)::integer
  end
  from public.game_actions q
  where q.id=p_question_action_id and q.kind='question';
$$;

-- Photo is now a valid question kind.
create or replace function public.ask_question_v4(p_game_id uuid,p_slot_key text,p_kind text,p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare v_id uuid;
begin
  if p_kind not in ('radar','district','thermometer','tentacle','photo') then
    raise exception 'Invalid question kind.';
  end if;
  if not exists(select 1 from public.games where id=p_game_id and status='active') then
    raise exception 'Game is not active.';
  end if;
  if exists(
    select 1 from public.game_actions a
    where a.game_id=p_game_id and a.kind='question' and a.is_active
      and a.payload->>'slot_key'=p_slot_key
  ) then
    raise exception 'That question card is already active.';
  end if;
  insert into public.game_actions(game_id,actor,kind,payload)
  values(
    p_game_id,'seeker','question',
    coalesce(p_payload,'{}'::jsonb)||jsonb_build_object('slot_key',p_slot_key,'question_kind',p_kind,'answer_due_at',now()+interval '15 minutes')
  ) returning id into v_id;
  return v_id;
end;$$;
grant execute on function public.ask_question_v4(uuid,text,text,jsonb) to anon,authenticated;

-- Thermometer point A is tracked per Thermometer card rather than globally.
create or replace function public.start_thermometer_v1(
  p_game_id uuid,p_slot_key text,p_min_travel_m integer,
  p_lat double precision,p_lng double precision,
  p_accuracy_m double precision default null,p_source text default 'gps'
) returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare v_id uuid;
begin
  if not exists(select 1 from public.games where id=p_game_id and status='active') then
    raise exception 'Game is not active.';
  end if;
  if p_min_travel_m not in (250,500,2000) then raise exception 'Invalid Thermometer distance.'; end if;
  if p_slot_key is null or p_slot_key='' then raise exception 'Thermometer slot is required.'; end if;
  insert into public.game_actions(game_id,actor,kind,payload)
  values(p_game_id,'seeker','thermo_reference',jsonb_build_object(
    'slot_key',p_slot_key,'min_travel_m',p_min_travel_m,
    'lat',p_lat,'lng',p_lng,'accuracy_m',p_accuracy_m,'source',coalesce(p_source,'gps')
  )) returning id into v_id;
  return v_id;
end;$$;
grant execute on function public.start_thermometer_v1(uuid,text,integer,double precision,double precision,double precision,text) to anon,authenticated;

-- Answer resolver with server-computed deadline penalty.
create or replace function public.answer_question_v5(p_game_id uuid,p_question_action_id uuid,p_password text,p_answer jsonb)
returns uuid
language plpgsql
security definer
set search_path=public,extensions
as $$
declare
  v_answer_id uuid;v_cards jsonb;v_kind text;v_draw_count integer;v_keep_limit integer;
  v_penalty integer;v_now timestamptz:=now();
begin
  if not public._hider_password_ok(p_game_id,p_password) then raise exception 'Invalid hider password.'; end if;
  select q.payload->>'question_kind' into v_kind
  from public.game_actions q
  where q.id=p_question_action_id and q.game_id=p_game_id and q.kind='question' and q.is_active;
  if v_kind is null then raise exception 'Question is not active.'; end if;
  if exists(select 1 from public.game_actions a where a.parent_id=p_question_action_id and a.kind in('answer','question_veto') and a.is_active) then
    raise exception 'Question already has an active answer/veto.';
  end if;
  v_penalty:=coalesce(public._question_late_penalty_minutes_v1(p_question_action_id,v_now),0);
  insert into public.game_actions(game_id,actor,kind,parent_id,payload)
  values(p_game_id,'hider','answer',p_question_action_id,jsonb_build_object(
    'answer',coalesce(p_answer,'{}'::jsonb),'answered_at',v_now,'late_penalty_minutes',v_penalty
  )) returning id into v_answer_id;

  if v_kind in('radar','thermometer') then v_draw_count:=2;v_keep_limit:=1;
  elsif v_kind='tentacle' then v_draw_count:=4;v_keep_limit:=2;
  else v_draw_count:=3;v_keep_limit:=1;
  end if;
  if not exists(select 1 from public.curse_draws where question_action_id=p_question_action_id) then
    v_cards:=public._draw_cards_v4(p_game_id,v_draw_count);
    if jsonb_array_length(v_cards)>0 then
      insert into public.curse_draws(game_id,question_action_id,cards,keep_limit)
      values(p_game_id,p_question_action_id,v_cards,v_keep_limit)
      on conflict(question_action_id) do nothing;
    end if;
  end if;
  return v_answer_id;
end;$$;
grant execute on function public.answer_question_v5(uuid,uuid,text,jsonb) to anon,authenticated;

-- Manual Veto also resolves the response timer, preventing a late-veto loophole.
create or replace function public.veto_question_v4(p_game_id uuid,p_question_action_id uuid,p_password text,p_card_key text)
returns uuid
language plpgsql
security definer
set search_path=public,extensions
as $$
declare v_card jsonb;v_id uuid;v_title text;v_penalty integer;v_now timestamptz:=now();
begin
  if not public._hider_password_ok(p_game_id,p_password) then raise exception 'Invalid hider password.'; end if;
  v_card:=public._get_held_card(p_game_id,p_card_key);
  if v_card is null or v_card->>'effect_key'<>'veto_question' then raise exception 'No unused veto card.'; end if;
  select payload->>'title' into v_title
  from public.game_actions
  where id=p_question_action_id and game_id=p_game_id and kind='question' and is_active;
  if v_title is null then raise exception 'Question is not active.'; end if;
  if exists(select 1 from public.game_actions where parent_id=p_question_action_id and kind in('answer','question_veto') and is_active) then
    raise exception 'Question already resolved.';
  end if;
  v_penalty:=coalesce(public._question_late_penalty_minutes_v1(p_question_action_id,v_now),0);
  perform public._consume_held_card(p_game_id,p_card_key);
  insert into public.game_actions(game_id,actor,kind,parent_id,payload)
  values(p_game_id,'hider','question_veto',p_question_action_id,jsonb_build_object(
    'card_key',p_card_key,'question_title',v_title,'resolved_at',v_now,'late_penalty_minutes',v_penalty
  )) returning id into v_id;
  return v_id;
end;$$;
grant execute on function public.veto_question_v4(uuid,uuid,text,text) to anon,authenticated;

-- Automatic Tentacle veto with the same deadline accounting.
create or replace function public.auto_veto_tentacle_v4(p_game_id uuid,p_question_action_id uuid,p_password text)
returns uuid
language plpgsql
security definer
set search_path=public,extensions
as $$
declare
  v_id uuid;v_title text;v_kind text;v_limit integer;v_payload jsonb;v_poi jsonb;
  v_target_lat double precision;v_target_lng double precision;v_lat double precision;v_lng double precision;
  v_a double precision;v_distance double precision;v_any_within boolean:=false;
  v_penalty integer;v_now timestamptz:=now();
begin
  if not public._hider_password_ok(p_game_id,p_password) then raise exception 'Invalid hider password.'; end if;
  select payload,payload->>'title',payload->>'question_kind',coalesce((payload->>'valid_distance_m')::integer,250)
  into v_payload,v_title,v_kind,v_limit
  from public.game_actions
  where id=p_question_action_id and game_id=p_game_id and kind='question' and is_active;
  if v_kind is null then raise exception 'Question is not active.'; end if;
  if v_kind<>'tentacle' then raise exception 'Automatic proximity veto is only valid for Tentacle questions.'; end if;
  if exists(select 1 from public.game_actions where parent_id=p_question_action_id and kind in('answer','question_veto') and is_active) then
    raise exception 'Question already resolved.';
  end if;

  select case when endgame then hidden_lat else station_lat end,
         case when endgame then hidden_lng else station_lng end
  into v_target_lat,v_target_lng
  from public.game_secrets where game_id=p_game_id;
  if v_target_lat is null or v_target_lng is null then raise exception 'Private target is unavailable.'; end if;

  for v_poi in select value from jsonb_array_elements(coalesce(v_payload->'pois','[]'::jsonb)) loop
    v_lat:=(v_poi->>'lat')::double precision;v_lng:=(v_poi->>'lng')::double precision;
    v_a:=power(sin(radians(v_lat-v_target_lat)/2),2)
       +cos(radians(v_target_lat))*cos(radians(v_lat))*power(sin(radians(v_lng-v_target_lng)/2),2);
    v_distance:=2*6371008.8*asin(least(1.0,sqrt(greatest(0.0,v_a))));
    if v_distance<=v_limit then v_any_within:=true;exit;end if;
  end loop;
  if v_any_within then raise exception 'Tentacle has at least one candidate within the validity distance and cannot be automatically vetoed.'; end if;

  v_penalty:=coalesce(public._question_late_penalty_minutes_v1(p_question_action_id,v_now),0);
  insert into public.game_actions(game_id,actor,kind,parent_id,payload)
  values(p_game_id,'hider','question_veto',p_question_action_id,jsonb_build_object(
    'automatic_tentacle',true,'question_title',coalesce(v_title,'Tentacle'),
    'valid_distance_m',v_limit,'reason','no_candidate_within_limit',
    'resolved_at',v_now,'late_penalty_minutes',v_penalty
  )) returning id into v_id;
  return v_id;
end;$$;
grant execute on function public.auto_veto_tentacle_v4(uuid,uuid,text) to anon,authenticated;


-- ============================================================================
-- v3.6.0 additions
-- ============================================================================
-- Vienna Hide & Seek v3.6.0 migration
-- Run ONCE after v3.5.0.

create extension if not exists pgcrypto with schema extensions;

-- Final score fields ---------------------------------------------------------
alter table public.games add column if not exists final_raw_seconds bigint;
alter table public.games add column if not exists final_bonus_minutes integer;
alter table public.games add column if not exists final_trap_minutes integer;
alter table public.games add column if not exists final_penalty_minutes integer;
alter table public.games add column if not exists final_score_seconds bigint;
alter table public.games add column if not exists finished_at timestamptz;
alter table public.games add column if not exists finished_by text;

-- Public Time Trap placement events + finalization event.
alter table public.game_actions drop constraint if exists game_actions_kind_check;
alter table public.game_actions add constraint game_actions_kind_check check (
  kind in (
    'seeker_location','thermo_reference','question','answer','curse_play','question_veto',
    'time_trap_place','time_trap_trigger','endgame_zone','game_finish'
  )
);

-- Time Traps are public strategic map objects from the moment they are placed.
create or replace function public.place_time_trap_v4(
  p_game_id uuid,p_password text,p_card_key text,p_station_name text,
  p_station_lat double precision,p_station_lng double precision
) returns uuid
language plpgsql security definer set search_path=public,extensions as $$
declare v_card jsonb;v_id uuid;v_base integer;
begin
  if not public._hider_password_ok(p_game_id,p_password) then raise exception 'Invalid hider password.'; end if;
  if not exists(select 1 from public.games where id=p_game_id and status='active') then raise exception 'Game is not active.'; end if;
  v_card:=public._get_held_card(p_game_id,p_card_key);
  if v_card is null or v_card->>'effect_key'<>'time_trap' then raise exception 'No unused Time Trap card.'; end if;
  perform public._consume_held_card(p_game_id,p_card_key);
  v_base:=coalesce(nullif(v_card->>'value_int','')::integer,5);
  insert into public.time_traps(game_id,card_key,station_name,station_lat,station_lng,base_bonus_minutes)
  values(p_game_id,p_card_key,p_station_name,p_station_lat,p_station_lng,v_base)
  returning id into v_id;
  insert into public.game_actions(game_id,actor,kind,payload)
  values(p_game_id,'hider','time_trap_place',jsonb_build_object(
    'trap_id',v_id,'station_name',p_station_name,'lat',p_station_lat,'lng',p_station_lng,
    'base_bonus_minutes',v_base,'armed_at',now()
  ));
  return v_id;
end;$$;
grant execute on function public.place_time_trap_v4(uuid,text,text,text,double precision,double precision) to anon,authenticated;

-- Hider's private Endgame target is now independent of the Seekers' public
-- Endgame map switch. This function never publishes the secret station/spot.
create or replace function public.set_hider_endgame_target_v1(
  p_game_id uuid,p_password text,p_endgame boolean,
  p_hidden_lat double precision default null,p_hidden_lng double precision default null
) returns boolean
language plpgsql security definer set search_path=public,extensions as $$
declare
  v_station_lat double precision;v_station_lng double precision;v_base integer;
  v_dist_m double precision;v_home_count integer;v_limit_m double precision;
begin
  if not public._hider_password_ok(p_game_id,p_password) then raise exception 'Invalid hider password.'; end if;
  if not p_endgame then
    update public.game_secrets set endgame=false where game_id=p_game_id;
    return true;
  end if;
  if p_hidden_lat is null or p_hidden_lng is null then raise exception 'Choose the actual hiding location first.'; end if;
  select station_lat,station_lng,base_radius_m into v_station_lat,v_station_lng,v_base
  from public.game_secrets where game_id=p_game_id;
  if v_station_lat is null or v_station_lng is null then raise exception 'Game has no hiding station.'; end if;
  select count(*) into v_home_count from public.game_actions
  where game_id=p_game_id and kind='curse_play' and is_active and payload->>'effect_key'='prosperous_home';
  v_limit_m:=coalesce(v_base,250)*sqrt(power(2.0,v_home_count));
  v_dist_m:=6371000*2*asin(sqrt(
    power(sin(radians(p_hidden_lat-v_station_lat)/2),2)
    +cos(radians(v_station_lat))*cos(radians(p_hidden_lat))*power(sin(radians(p_hidden_lng-v_station_lng)/2),2)
  ));
  if v_dist_m>v_limit_m+0.5 then
    raise exception 'Actual hiding spot is % m from the station; current maximum is % m.',round(v_dist_m)::integer,round(v_limit_m)::integer;
  end if;
  update public.game_secrets set hidden_lat=p_hidden_lat,hidden_lng=p_hidden_lng,endgame=true where game_id=p_game_id;
  return true;
end;$$;
grant execute on function public.set_hider_endgame_target_v1(uuid,text,boolean,double precision,double precision) to anon,authenticated;

-- Seekers deliberately switch their own deduction map to the station Endgame
-- zone. They choose the station they believe is correct; this reveals no secret.
create or replace function public.start_seeker_endgame_v1(
  p_game_id uuid,p_station_name text,p_station_lat double precision,p_station_lng double precision
) returns uuid
language plpgsql security definer set search_path=public as $$
declare v_id uuid;v_base integer:=250;
begin
  if not exists(select 1 from public.games where id=p_game_id and status='active') then raise exception 'Game is not active.'; end if;
  if p_station_lat not between 48.05 and 48.40 or p_station_lng not between 16.05 and 16.70 then raise exception 'Station coordinate outside Vienna guardrail.'; end if;
  update public.game_actions set is_active=false where game_id=p_game_id and kind='endgame_zone' and is_active;
  insert into public.game_actions(game_id,actor,kind,payload)
  values(p_game_id,'seeker','endgame_zone',jsonb_build_object(
    'station_name',coalesce(nullif(trim(p_station_name),''),'Station'),
    'center',jsonb_build_object('lat',p_station_lat,'lng',p_station_lng),
    'base_radius_m',v_base,'dynamic_radius',true
  )) returning id into v_id;
  return v_id;
end;$$;
grant execute on function public.start_seeker_endgame_v1(uuid,text,double precision,double precision) to anon,authenticated;

-- A finite-card-deck reshuffle power-up.
insert into public.curse_cards(card_key,title,description,duration_seconds,card_kind,effect_key,value_int,cast_cost_minutes)
select 'reshuffle-'||g,'Fresh Shuffle','Reshuffle the remaining deck immediately. Cards currently held stay out of the draw pile.',null::integer,'powerup','reshuffle_deck',null::integer,0
from generate_series(1,2) g
on conflict(card_key) do update set title=excluded.title,description=excluded.description,card_kind=excluded.card_kind,effect_key=excluded.effect_key,cast_cost_minutes=excluded.cast_cost_minutes;

create or replace function public.use_reshuffle_card_v1(p_game_id uuid,p_password text,p_card_key text)
returns integer language plpgsql security definer set search_path=public,extensions as $$
declare v_card jsonb;v_cycle integer;
begin
  if not public._hider_password_ok(p_game_id,p_password) then raise exception 'Invalid hider password.'; end if;
  v_card:=public._get_held_card(p_game_id,p_card_key);
  if v_card is null or v_card->>'effect_key'<>'reshuffle_deck' then raise exception 'Fresh Shuffle is not available in hand.'; end if;
  perform public._consume_held_card(p_game_id,p_card_key);
  v_cycle:=public._reshuffle_card_deck_v1(p_game_id);
  insert into public.private_card_uses(game_id,card_key,effect_key,value_int,metadata)
  values(p_game_id,p_card_key,'reshuffle_deck',v_cycle,jsonb_build_object('cycle',v_cycle));
  return v_cycle;
end;$$;
grant execute on function public.use_reshuffle_card_v1(uuid,text,text) to anon,authenticated;

-- Additional Vienna-friendly curses. These are deliberately simple/socially
-- enforced so they remain usable with 1-2 physical dice and no extra sensors.
insert into public.curse_cards(card_key,title,description,duration_seconds,card_kind,effect_key,value_int,cast_cost_minutes)
select 'rewind-'||g,'Curse of the Rewind','The next question must be asked from the exact location of the previous question.',null::integer,'curse','rewind',null::integer,10 from generate_series(1,2) g
union all
select 'dice-tax-'||g,'Curse of the Dice Tax','For 45 minutes, before each new movement leg roll a die: 1-2 wait 5 min, 3-4 wait 2 min, 5-6 no wait.',2700,'curse','dice_tax',null::integer,10 from generate_series(1,2) g
union all
select 'spotty-memory-'||g,'Curse of Spotty Memory','For one hour, roll a die after each answered question to block one question category until the next answer. 1 Mixed, 2 Radar, 3 Thermometer, 4 Tentacle, 5 Photo, 6 reroll.',3600,'curse','spotty_memory',null::integer,15 from generate_series(1,2) g
union all
select 'statue-'||g,'Curse of the Statue','Before asking the next question, roll a die and stand completely still for twice that many minutes.',null::integer,'curse','statue',null::integer,5 from generate_series(1,2) g
union all
select 'photo-op-'||g,'Curse of the Photo Op','Before asking the next question, take a group photo with a clearly identifiable Vienna sign, landmark, or transit marker.',null::integer,'curse','photo_op',null::integer,5 from generate_series(1,2) g
on conflict(card_key) do update set title=excluded.title,description=excluded.description,duration_seconds=excluded.duration_seconds,card_kind=excluded.card_kind,effect_key=excluded.effect_key,value_int=excluded.value_int,cast_cost_minutes=excluded.cast_cost_minutes;

-- Time Trap wording is now explicitly public.
update public.curse_cards set description='Place this on a station. The clock marker is public immediately. If triggered, it awards its base bonus plus 10 minutes per full hour armed.'
where effect_key='time_trap';

-- Finish the game from either role. Hider calls must prove the password; the
-- seeker path is intentionally public because this app has no seeker accounts.
create or replace function public.finish_game_v1(
  p_game_id uuid,p_actor text,p_password text default null
) returns table(
  raw_seconds bigint,held_bonus_minutes integer,trap_bonus_minutes integer,
  penalty_minutes integer,final_seconds bigint,finished_at timestamptz
)
language plpgsql security definer set search_path=public,extensions as $$
declare
  v_game public.games%rowtype;v_now timestamptz:=now();v_raw bigint;
  v_held integer:=0;v_dup integer:=0;v_traps integer:=0;v_penalty integer:=0;v_final bigint;
begin
  if p_actor not in ('hider','seeker') then raise exception 'Invalid actor.'; end if;
  if p_actor='hider' and not public._hider_password_ok(p_game_id,p_password) then raise exception 'Invalid hider password.'; end if;
  select * into v_game from public.games where id=p_game_id for update;
  if not found then raise exception 'Game not found.'; end if;
  if v_game.status='finished' then
    return query select coalesce(v_game.final_raw_seconds,v_game.clock_elapsed_seconds),coalesce(v_game.final_bonus_minutes,0),coalesce(v_game.final_trap_minutes,0),coalesce(v_game.final_penalty_minutes,0),coalesce(v_game.final_score_seconds,v_game.clock_elapsed_seconds),v_game.finished_at;
    return;
  end if;
  v_raw:=coalesce(v_game.clock_elapsed_seconds,0);
  if v_game.clock_running and v_game.clock_started_at is not null then
    v_raw:=v_raw+greatest(0,floor(extract(epoch from (v_now-v_game.clock_started_at)))::bigint);
  end if;

  select coalesce(sum(coalesce(nullif(e->>'value_int','')::integer,0)),0)::integer into v_held
  from public.curse_draws d cross join lateral jsonb_array_elements(d.cards) e
  where d.game_id=p_game_id and d.kept_card_keys ? (e->>'card_key') and not(d.used_card_keys ? (e->>'card_key')) and e->>'card_kind'='time_bonus';

  select coalesce(sum(value_int),0)::integer into v_dup from public.private_card_uses
  where game_id=p_game_id and effect_key='duplicate_bonus' and is_active;

  select coalesce(sum(coalesce(bonus_minutes,base_bonus_minutes)),0)::integer into v_traps
  from public.time_traps where game_id=p_game_id and trigger_active;

  select coalesce(sum(coalesce(nullif(payload->>'late_penalty_minutes','')::integer,0)),0)::integer into v_penalty
  from public.game_actions where game_id=p_game_id and is_active and kind in('answer','question_veto');

  v_held:=v_held+v_dup;
  v_final:=greatest(0,v_raw+(v_held+v_traps-v_penalty)::bigint*60);

  update public.games set status='finished',clock_elapsed_seconds=v_raw,clock_running=false,clock_started_at=null,
    final_raw_seconds=v_raw,final_bonus_minutes=v_held,final_trap_minutes=v_traps,
    final_penalty_minutes=v_penalty,final_score_seconds=v_final,finished_at=v_now,finished_by=p_actor
  where id=p_game_id;

  insert into public.game_actions(game_id,actor,kind,payload)
  values(p_game_id,p_actor,'game_finish',jsonb_build_object(
    'raw_seconds',v_raw,'held_bonus_minutes',v_held,'trap_bonus_minutes',v_traps,
    'penalty_minutes',v_penalty,'final_seconds',v_final,'finished_at',v_now
  ));

  return query select v_raw,v_held,v_traps,v_penalty,v_final,v_now;
end;$$;
grant execute on function public.finish_game_v1(uuid,text,text) to anon,authenticated;

-- Vienna Hide & Seek v3.7.0
-- Run once after v3.6.0.


-- Expanded question catalogue for v3.6/v3.7 mixed questions.
create or replace function public.ask_question_v4(p_game_id uuid,p_slot_key text,p_kind text,p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare v_id uuid;
begin
  if p_kind not in ('radar','district','district_set','landmark_compare','directional','same_line','thermometer','tentacle','photo','street_shape') then
    raise exception 'Invalid question kind.';
  end if;
  if not exists(select 1 from public.games where id=p_game_id and status='active') then
    raise exception 'Game is not active.';
  end if;
  if exists(
    select 1 from public.game_actions a
    where a.game_id=p_game_id and a.kind='question' and a.is_active
      and a.payload->>'slot_key'=p_slot_key
  ) then raise exception 'That question card is already active.'; end if;
  insert into public.game_actions(game_id,actor,kind,payload)
  values(
    p_game_id,'seeker','question',
    coalesce(p_payload,'{}'::jsonb)||jsonb_build_object('slot_key',p_slot_key,'question_kind',p_kind,'answer_due_at',now()+interval '15 minutes')
  ) returning id into v_id;
  return v_id;
end;$$;
grant execute on function public.ask_question_v4(uuid,text,text,jsonb) to anon,authenticated;

-- Tentacle automatic veto now checks the Hider's FINAL Endgame point against
-- the Seeker's Tentacle origin. If farther than 250 m, the public result is a
-- 250 m radar-style miss. No private distance is written to public actions.
create or replace function public.auto_veto_tentacle_v5(
  p_game_id uuid,
  p_question_action_id uuid,
  p_password text
)
returns uuid
language plpgsql
security definer
set search_path=public,extensions
as $$
declare
  v_id uuid;
  v_title text;
  v_kind text;
  v_limit integer;
  v_payload jsonb;
  v_target_lat double precision;
  v_target_lng double precision;
  v_origin_lat double precision;
  v_origin_lng double precision;
  v_a double precision;
  v_distance double precision;
  v_poi_count integer;
  v_radar_miss boolean;
  v_penalty integer;
  v_now timestamptz:=now();
  v_endgame boolean;
begin
  if not public._hider_password_ok(p_game_id,p_password) then
    raise exception 'Invalid hider password.';
  end if;

  select payload,
         payload->>'title',
         payload->>'question_kind',
         coalesce((payload->>'valid_distance_m')::integer,250)
  into v_payload,v_title,v_kind,v_limit
  from public.game_actions
  where id=p_question_action_id
    and game_id=p_game_id
    and kind='question'
    and is_active;

  if v_kind is null then raise exception 'Question is not active.'; end if;
  if v_kind<>'tentacle' then raise exception 'Automatic veto is only valid for Tentacle questions.'; end if;
  if exists(
    select 1 from public.game_actions
    where parent_id=p_question_action_id
      and kind in('answer','question_veto')
      and is_active
  ) then raise exception 'Question already resolved.'; end if;

  select endgame,hidden_lat,hidden_lng
  into v_endgame,v_target_lat,v_target_lng
  from public.game_secrets where game_id=p_game_id;

  if not coalesce(v_endgame,false) or v_target_lat is null or v_target_lng is null then
    raise exception 'Tentacles require the final Endgame hiding point.';
  end if;

  v_origin_lat:=nullif(v_payload#>>'{origin,lat}','')::double precision;
  v_origin_lng:=nullif(v_payload#>>'{origin,lng}','')::double precision;
  if v_origin_lat is null or v_origin_lng is null then raise exception 'Tentacle origin is missing.'; end if;

  v_a:=power(sin(radians(v_origin_lat-v_target_lat)/2),2)
     +cos(radians(v_target_lat))*cos(radians(v_origin_lat))*power(sin(radians(v_origin_lng-v_target_lng)/2),2);
  v_distance:=2*6371008.8*asin(least(1.0,sqrt(greatest(0.0,v_a))));
  v_poi_count:=jsonb_array_length(coalesce(v_payload->'pois','[]'::jsonb));
  v_radar_miss:=v_distance>v_limit;

  if not v_radar_miss and v_poi_count>0 then
    raise exception 'Tentacle is in range and has candidate POIs; answer it instead of vetoing.';
  end if;

  v_penalty:=coalesce(public._question_late_penalty_minutes_v1(p_question_action_id,v_now),0);
  insert into public.game_actions(game_id,actor,kind,parent_id,payload)
  values(
    p_game_id,'hider','question_veto',p_question_action_id,
    jsonb_build_object(
      'automatic_tentacle',true,
      'question_title',coalesce(v_title,'Tentacle'),
      'valid_distance_m',v_limit,
      'radius_m',v_limit,
      'radar_miss',v_radar_miss,
      'reason',case when v_radar_miss then 'target_outside_tentacle_range' else 'no_candidate_pois' end,
      'resolved_at',v_now,
      'late_penalty_minutes',v_penalty
    )
  ) returning id into v_id;
  return v_id;
end;$$;

grant execute on function public.auto_veto_tentacle_v5(uuid,uuid,text) to anon,authenticated;

-- Additional curses. Some are adapted from official Hide + Seek curse mechanics;
-- Vienna-specific entries are intentionally social/physical and need no extra secret data.
insert into public.curse_cards(
  card_key,title,description,duration_seconds,card_kind,effect_key,value_int,cast_cost_minutes
) values
  ('right-turn-vienna-1','Curse of the Right Turn','For 40 minutes, at street intersections the Seekers may only continue straight or turn right. A dead end permits a U-turn.',2400,'curse','right_turn',null,10),
  ('passenger-princess-vienna-1','Curse of the Passenger Princess','For 60 minutes, choose one Seeker as Passenger Princess: they may not navigate, research, carry team belongings, or discuss strategy.',3600,'curse','passenger_princess',null,15),
  ('hide-seek-ception-vienna-1','Curse of Hide-and-Seek-Ception','Before the next question, one Seeker hides at least 150 m away while the others close their eyes, then the others must find them without help.',null,'curse','hide_seek_ception',null,10),
  ('wurst-stand-vienna-1','Curse of the Würstelstand','Before the next question, the Seekers must visit a Würstelstand (or comparable sausage stand) and take a photo there.',null,'curse','wurst_stand',null,10),
  ('melange-vienna-1','Curse of the Melange','Before the next question, the Seekers must enter a café and acquire a coffee or other drink.',null,'curse','melange',null,5),
  ('strassenbahn-vienna-1','Curse of the Straßenbahn','For 30 minutes, U-Bahn and S-Bahn are forbidden. Walking, tram and bus are allowed.',1800,'curse','strassenbahn_only',null,15),
  ('opernball-vienna-1','Curse of the Opernball','Before the next question, one Seeker must perform a 30-second waltz in a public place while the other records it.',null,'curse','opernball',null,5)
on conflict(card_key) do update set
  title=excluded.title,
  description=excluded.description,
  duration_seconds=excluded.duration_seconds,
  card_kind=excluded.card_kind,
  effect_key=excluded.effect_key,
  value_int=excluded.value_int,
  cast_cost_minutes=excluded.cast_cost_minutes;


-- ============================================================================
-- v3.8.0 additions: developer card catalogue + custom casting costs
-- ============================================================================
-- Hide & Seek: Vienna v3.8.0
-- Developer card catalogue + editable/custom casting costs.

alter table public.curse_cards add column if not exists cast_cost_kind text not null default 'none';
alter table public.curse_cards add column if not exists cast_cost_text text;
alter table public.curse_cards add column if not exists enabled boolean not null default true;

alter table public.curse_cards drop constraint if exists curse_cards_cast_cost_kind_check;
alter table public.curse_cards add constraint curse_cards_cast_cost_kind_check
  check (cast_cost_kind in ('none','time','custom'));

update public.curse_cards
set cast_cost_kind=case when coalesce(cast_cost_minutes,0)>0 then 'time' else 'none' end
where cast_cost_kind='none' and coalesce(cast_cost_minutes,0)>0;

create or replace function public.admin_list_cards_v1(p_password text)
returns table(
  card_key text,
  title text,
  description text,
  duration_seconds integer,
  card_kind text,
  effect_key text,
  value_int integer,
  cast_cost_minutes integer,
  cast_cost_kind text,
  cast_cost_text text,
  enabled boolean
)
language plpgsql security definer set search_path=public,extensions as $$
begin
  if not public._admin_password_ok(p_password) then
    perform pg_sleep(0.35);
    raise exception 'Invalid developer password.';
  end if;
  return query
  select c.card_key,c.title,c.description,c.duration_seconds,c.card_kind,c.effect_key,c.value_int,
         c.cast_cost_minutes,c.cast_cost_kind,c.cast_cost_text,c.enabled
  from public.curse_cards c
  order by case c.card_kind when 'time_bonus' then 1 when 'powerup' then 2 when 'time_trap' then 3 else 4 end,
           c.title,c.card_key;
end;$$;

grant execute on function public.admin_list_cards_v1(text) to anon,authenticated;

create or replace function public.admin_save_card_v1(
  p_password text,
  p_card_key text,
  p_title text,
  p_description text,
  p_duration_seconds integer,
  p_card_kind text,
  p_effect_key text,
  p_value_int integer,
  p_cast_cost_kind text,
  p_cast_cost_minutes integer,
  p_cast_cost_text text,
  p_enabled boolean
) returns text
language plpgsql security definer set search_path=public,extensions as $$
declare v_key text;
begin
  if not public._admin_password_ok(p_password) then
    perform pg_sleep(0.35);
    raise exception 'Invalid developer password.';
  end if;
  if char_length(trim(coalesce(p_title,''))) not between 1 and 120 then raise exception 'Card title must be 1-120 characters.'; end if;
  if char_length(trim(coalesce(p_description,''))) not between 1 and 1200 then raise exception 'Card text must be 1-1200 characters.'; end if;
  if p_card_kind not in ('curse','powerup','time_bonus','time_trap') then raise exception 'Invalid card type.'; end if;
  if p_cast_cost_kind not in ('none','time','custom') then raise exception 'Invalid casting-cost type.'; end if;
  if p_duration_seconds is not null and p_duration_seconds<0 then raise exception 'Invalid duration.'; end if;
  if p_cast_cost_kind='time' and (coalesce(p_cast_cost_minutes,0)<=0 or p_cast_cost_minutes%5<>0 or p_cast_cost_minutes>120) then raise exception 'Time casting cost must be 5-120 minutes in 5-minute steps.'; end if;
  if p_cast_cost_kind='custom' and char_length(trim(coalesce(p_cast_cost_text,'')))<1 then raise exception 'Enter the custom casting cost.'; end if;

  v_key=nullif(trim(coalesce(p_card_key,'')),'');
  if v_key is null then v_key='custom-'||replace(gen_random_uuid()::text,'-',''); end if;

  insert into public.curse_cards(card_key,title,description,duration_seconds,card_kind,effect_key,value_int,cast_cost_minutes,cast_cost_kind,cast_cost_text,enabled)
  values(
    v_key,trim(p_title),trim(p_description),p_duration_seconds,p_card_kind,
    coalesce(nullif(trim(coalesce(p_effect_key,'')),''),'custom_rule'),p_value_int,
    case when p_cast_cost_kind='time' then p_cast_cost_minutes else 0 end,
    p_cast_cost_kind,case when p_cast_cost_kind='custom' then trim(p_cast_cost_text) else null end,
    coalesce(p_enabled,true)
  )
  on conflict(card_key) do update set
    title=excluded.title,description=excluded.description,duration_seconds=excluded.duration_seconds,
    card_kind=excluded.card_kind,effect_key=excluded.effect_key,value_int=excluded.value_int,
    cast_cost_minutes=excluded.cast_cost_minutes,cast_cost_kind=excluded.cast_cost_kind,
    cast_cost_text=excluded.cast_cost_text,enabled=excluded.enabled;
  return v_key;
end;$$;

grant execute on function public.admin_save_card_v1(text,text,text,text,integer,text,text,integer,text,integer,text,boolean) to anon,authenticated;

create or replace function public.admin_delete_card_v1(p_password text,p_card_key text)
returns boolean language plpgsql security definer set search_path=public,extensions as $$
begin
  if not public._admin_password_ok(p_password) then
    perform pg_sleep(0.35);
    raise exception 'Invalid developer password.';
  end if;
  delete from public.curse_cards where card_key=p_card_key;
  return found;
end;$$;

grant execute on function public.admin_delete_card_v1(text,text) to anon,authenticated;

-- Future reshuffles use only enabled catalogue cards.
create or replace function public._reshuffle_card_deck_v1(p_game_id uuid)
returns integer language plpgsql security definer set search_path=public as $$
declare v_deck jsonb;v_cycle integer;
begin
  select coalesce(jsonb_agg(c.card_key order by random()),'[]'::jsonb) into v_deck
  from public.curse_cards c
  where c.enabled
    and not exists(
      select 1 from public.curse_draws d
      where d.game_id=p_game_id and d.kept_card_keys ? c.card_key and not(d.used_card_keys ? c.card_key)
    );
  insert into public.game_card_state(game_id,cycle,deck,cursor,updated_at)
  values(p_game_id,1,v_deck,0,now())
  on conflict(game_id) do update set cycle=public.game_card_state.cycle+1,deck=excluded.deck,cursor=0,updated_at=now()
  returning cycle into v_cycle;
  return v_cycle;
end;$$;

create or replace function public._draw_cards_v4(p_game_id uuid,p_count integer)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_result jsonb:='[]'::jsonb;v_state public.game_card_state%rowtype;v_key text;v_card public.curse_cards%rowtype;
begin
  if p_count<=0 then return v_result; end if;
  if not exists(select 1 from public.game_card_state where game_id=p_game_id) then perform public._reshuffle_card_deck_v1(p_game_id); end if;
  while jsonb_array_length(v_result)<p_count loop
    select * into v_state from public.game_card_state where game_id=p_game_id for update;
    if v_state.cursor>=jsonb_array_length(v_state.deck) then
      perform public._reshuffle_card_deck_v1(p_game_id);
      select * into v_state from public.game_card_state where game_id=p_game_id for update;
      if jsonb_array_length(v_state.deck)=0 then exit; end if;
    end if;
    v_key:=v_state.deck->>v_state.cursor;
    update public.game_card_state set cursor=cursor+1,updated_at=now() where game_id=p_game_id;
    select * into v_card from public.curse_cards where card_key=v_key and enabled;
    if found then
      v_result:=v_result||jsonb_build_array(jsonb_build_object(
        'card_key',v_card.card_key,'title',v_card.title,'description',v_card.description,
        'duration_seconds',v_card.duration_seconds,'card_kind',v_card.card_kind,
        'effect_key',v_card.effect_key,'value_int',v_card.value_int,
        'cast_cost_minutes',v_card.cast_cost_minutes,'cast_cost_kind',v_card.cast_cost_kind,
        'cast_cost_text',v_card.cast_cost_text));
    end if;
  end loop;
  return v_result;
end;$$;

-- Keep automatic time-bonus payment for time costs; custom casting costs are
-- displayed and socially enforced rather than consuming time cards.
create or replace function public.play_card_v4(p_game_id uuid,p_password text,p_card_key text,p_copy_card_key text default null,p_cost_card_keys text[] default array[]::text[])
returns uuid language plpgsql security definer set search_path=public,extensions as $$
declare v_card jsonb;v_copy jsonb;v_effect text;v_kind text;v_duration integer;v_now timestamptz:=now();v_id uuid;v_title text;v_desc text;v_value integer;v_cost integer:=0;v_paid integer:=0;v_key text;v_pay jsonb;v_cost_kind text;v_cost_text text;
begin
  if not public._hider_password_ok(p_game_id,p_password) then raise exception 'Invalid hider password.';end if;
  v_card:=public._get_held_card(p_game_id,p_card_key);if v_card is null then raise exception 'Card is not available in hand.';end if;
  v_effect:=v_card->>'effect_key';v_kind:=v_card->>'card_kind';
  if v_effect='duplicate' then
    if p_copy_card_key is null then raise exception 'Choose a card to duplicate.';end if;
    v_copy:=public._get_held_card(p_game_id,p_copy_card_key);if v_copy is null then raise exception 'Duplicate target is not available.';end if;
    if v_copy->>'card_kind'='time_bonus' then
      perform public._consume_held_card(p_game_id,p_card_key);
      insert into public.private_card_uses(game_id,card_key,effect_key,value_int,metadata) values(p_game_id,p_card_key,'duplicate_bonus',(v_copy->>'value_int')::integer,jsonb_build_object('copied_card_key',p_copy_card_key,'copied_title',v_copy->>'title')) returning id into v_id;return v_id;
    elsif v_copy->>'card_kind'='curse' then v_card:=v_copy;v_effect:=v_copy->>'effect_key';v_kind:='curse';
    else raise exception 'Duplicate currently supports time bonuses and curses.';end if;
  elsif v_kind<>'curse' then raise exception 'This card is used elsewhere in the interface.';end if;

  v_cost:=coalesce(nullif(v_card->>'cast_cost_minutes','')::integer,0);
  v_cost_kind:=coalesce(nullif(v_card->>'cast_cost_kind',''),case when v_cost>0 then 'time' else 'none' end);
  v_cost_text:=nullif(v_card->>'cast_cost_text','');
  if v_cost_kind='time' and v_cost>0 then
    if coalesce(array_length(p_cost_card_keys,1),0)=0 then raise exception 'Choose time-bonus cards to pay the casting cost.';end if;
    foreach v_key in array p_cost_card_keys loop
      v_pay:=public._get_held_card(p_game_id,v_key);
      if v_pay is null or v_pay->>'card_kind'<>'time_bonus' then raise exception 'Casting costs can only be paid with held time-bonus cards.';end if;
      v_paid:=v_paid+coalesce((v_pay->>'value_int')::integer,0);
    end loop;
    if v_paid<v_cost then raise exception 'Selected time bonuses do not cover the casting cost.';end if;
  end if;

  perform public._consume_held_card(p_game_id,p_card_key);
  if v_cost_kind='time' then foreach v_key in array p_cost_card_keys loop perform public._consume_held_card(p_game_id,v_key);end loop; end if;
  v_title:=v_card->>'title';v_desc:=v_card->>'description';v_duration:=nullif(v_card->>'duration_seconds','')::integer;v_value:=nullif(v_card->>'value_int','')::integer;
  insert into public.game_actions(game_id,actor,kind,payload) values(p_game_id,'hider','curse_play',jsonb_build_object(
    'source_card_key',p_card_key,'effect_key',v_effect,'title',v_title,'description',v_desc,
    'duration_seconds',v_duration,'value_int',v_value,'starts_at',v_now,
    'ends_at',case when v_duration is null then null else v_now+make_interval(secs=>v_duration) end,
    'copied_from',p_copy_card_key,'cast_cost_kind',v_cost_kind,'cast_cost_minutes',v_cost,
    'cast_cost_text',v_cost_text,'cast_paid_minutes',v_paid,'cast_cards',to_jsonb(p_cost_card_keys))) returning id into v_id;
  return v_id;
end;$$;

grant execute on function public.play_card_v4(uuid,text,text,text,text[]) to anon,authenticated;


-- Hide & Seek: Vienna v3.9.0
-- Catalogue counts for cards, question catalogue/editor, and finite-deck expansion.
-- Run ONCE after v3.8.0.

-- ---------------------------------------------------------------------------
-- Card catalogue: one row per card TYPE, with a physical-copy count.
-- ---------------------------------------------------------------------------
alter table public.curse_cards add column if not exists deck_count integer not null default 1;
alter table public.curse_cards drop constraint if exists curse_cards_deck_count_check;
alter table public.curse_cards add constraint curse_cards_deck_count_check check (deck_count between 0 and 50);

-- Collapse old physical duplicate rows that have identical rules into one catalogue
-- definition. Existing already-drawn JSON snapshots remain self-contained.
create temporary table _hns_card_groups as
select
  min(card_key) as keep_key,
  count(*) filter (where coalesce(enabled,true))::integer as copies,
  title,description,duration_seconds,card_kind,effect_key,value_int,
  coalesce(cast_cost_minutes,0) as cast_cost_minutes,
  coalesce(cast_cost_kind,'none') as cast_cost_kind,
  coalesce(cast_cost_text,'') as cast_cost_text,
  bool_or(coalesce(enabled,true)) as any_enabled
from public.curse_cards
group by title,description,duration_seconds,card_kind,effect_key,value_int,
         coalesce(cast_cost_minutes,0),coalesce(cast_cost_kind,'none'),coalesce(cast_cost_text,'');

update public.curse_cards c
set deck_count=g.copies,
    enabled=g.any_enabled
from _hns_card_groups g
where c.card_key=g.keep_key;

delete from public.curse_cards c
using _hns_card_groups g
where c.card_key<>g.keep_key
  and c.title=g.title
  and c.description=g.description
  and c.duration_seconds is not distinct from g.duration_seconds
  and c.card_kind=g.card_kind
  and c.effect_key is not distinct from g.effect_key
  and c.value_int is not distinct from g.value_int
  and coalesce(c.cast_cost_minutes,0)=g.cast_cost_minutes
  and coalesce(c.cast_cost_kind,'none')=g.cast_cost_kind
  and coalesce(c.cast_cost_text,'')=g.cast_cost_text;

update public.curse_cards set enabled=(deck_count>0);

drop table if exists _hns_card_groups;

-- Reset only the undrawn pile. Held cards remain in curse_draws snapshots.
delete from public.game_card_state;

create or replace function public.admin_list_cards_v2(p_password text)
returns table(
  card_key text,title text,description text,duration_seconds integer,
  card_kind text,effect_key text,value_int integer,cast_cost_minutes integer,
  cast_cost_kind text,cast_cost_text text,enabled boolean,deck_count integer,
  special_engine boolean
)
language plpgsql security definer set search_path=public,extensions as $$
begin
  if not public._admin_password_ok(p_password) then
    perform pg_sleep(0.35); raise exception 'Invalid developer password.';
  end if;
  return query
  select c.card_key,c.title,c.description,c.duration_seconds,c.card_kind,c.effect_key,c.value_int,
         c.cast_cost_minutes,c.cast_cost_kind,c.cast_cost_text,c.enabled,c.deck_count,
         (c.effect_key in ('prosperous_home','duplicate','reshuffle_deck','time_trap','veto_question')) as special_engine
  from public.curse_cards c
  order by
    case when c.effect_key in ('prosperous_home','duplicate','reshuffle_deck','time_trap','veto_question') then 9
         when c.card_kind='time_bonus' then 1 when c.card_kind='curse' then 2 else 3 end,
    c.title,c.card_key;
end;$$;
grant execute on function public.admin_list_cards_v2(text) to anon,authenticated;

create or replace function public.admin_save_card_v2(
  p_password text,p_card_key text,p_title text,p_description text,
  p_duration_seconds integer,p_card_kind text,p_effect_key text,p_value_int integer,
  p_cast_cost_kind text,p_cast_cost_minutes integer,p_cast_cost_text text,
  p_deck_count integer
) returns text
language plpgsql security definer set search_path=public,extensions as $$
declare v_key text;v_special boolean;
begin
  if not public._admin_password_ok(p_password) then perform pg_sleep(0.35);raise exception 'Invalid developer password.';end if;
  if char_length(trim(coalesce(p_title,''))) not between 1 and 120 then raise exception 'Card title must be 1-120 characters.';end if;
  if char_length(trim(coalesce(p_description,''))) not between 1 and 1200 then raise exception 'Card text must be 1-1200 characters.';end if;
  if p_card_kind not in ('curse','powerup','time_bonus','time_trap') then raise exception 'Invalid card type.';end if;
  if p_cast_cost_kind not in ('none','time','custom') then raise exception 'Invalid casting-cost type.';end if;
  if coalesce(p_deck_count,-1) not between 0 and 50 then raise exception 'Deck count must be 0-50.';end if;
  if p_duration_seconds is not null and p_duration_seconds<0 then raise exception 'Invalid duration.';end if;
  if p_cast_cost_kind='time' and (coalesce(p_cast_cost_minutes,0)<=0 or p_cast_cost_minutes%5<>0 or p_cast_cost_minutes>120) then raise exception 'Time casting cost must be 5-120 minutes in 5-minute steps.';end if;
  if p_cast_cost_kind='custom' and char_length(trim(coalesce(p_cast_cost_text,'')))<1 then raise exception 'Enter the custom casting cost.';end if;

  v_key=nullif(trim(coalesce(p_card_key,'')),'');
  if v_key is null then v_key='custom-'||replace(extensions.gen_random_uuid()::text,'-',''); end if;

  -- Engine-driven cards keep their effect key/type/value. Their presentation and
  -- copy count can still be changed safely.
  select effect_key in ('prosperous_home','duplicate','reshuffle_deck','time_trap','veto_question') into v_special
  from public.curse_cards where card_key=v_key;
  if coalesce(v_special,false) then
    update public.curse_cards set
      title=trim(p_title),description=trim(p_description),duration_seconds=p_duration_seconds,
      cast_cost_minutes=case when p_cast_cost_kind='time' then p_cast_cost_minutes else 0 end,
      cast_cost_kind=p_cast_cost_kind,
      cast_cost_text=case when p_cast_cost_kind='custom' then trim(p_cast_cost_text) else null end,
      deck_count=p_deck_count,enabled=(p_deck_count>0)
    where card_key=v_key;
    return v_key;
  end if;

  insert into public.curse_cards(
    card_key,title,description,duration_seconds,card_kind,effect_key,value_int,
    cast_cost_minutes,cast_cost_kind,cast_cost_text,enabled,deck_count
  ) values(
    v_key,trim(p_title),trim(p_description),p_duration_seconds,p_card_kind,
    coalesce(nullif(trim(coalesce(p_effect_key,'')),''),'custom_rule'),p_value_int,
    case when p_cast_cost_kind='time' then p_cast_cost_minutes else 0 end,
    p_cast_cost_kind,case when p_cast_cost_kind='custom' then trim(p_cast_cost_text) else null end,
    (p_deck_count>0),p_deck_count
  ) on conflict(card_key) do update set
    title=excluded.title,description=excluded.description,duration_seconds=excluded.duration_seconds,
    card_kind=excluded.card_kind,effect_key=excluded.effect_key,value_int=excluded.value_int,
    cast_cost_minutes=excluded.cast_cost_minutes,cast_cost_kind=excluded.cast_cost_kind,
    cast_cost_text=excluded.cast_cost_text,enabled=excluded.enabled,deck_count=excluded.deck_count;
  return v_key;
end;$$;
grant execute on function public.admin_save_card_v2(text,text,text,text,integer,text,text,integer,text,integer,text,integer) to anon,authenticated;

-- Build a finite pile by expanding each catalogue definition deck_count times.
-- Each physical copy gets a unique instance key, while catalog_key points back to
-- its editable definition.
create or replace function public._reshuffle_card_deck_v1(p_game_id uuid)
returns integer language plpgsql security definer set search_path=public,extensions as $$
declare v_deck jsonb;v_cycle integer;
begin
  with held as (
    select e
    from public.curse_draws d
    cross join lateral jsonb_array_elements(d.cards) e
    where d.game_id=p_game_id
      and d.kept_card_keys ? (e->>'card_key')
      and not(d.used_card_keys ? (e->>'card_key'))
  ), available as (
    select c.*,
      greatest(0,c.deck_count-(
        select count(*) from held h
        where coalesce(h.e->>'catalog_key','')=c.card_key
           or (
             coalesce(h.e->>'catalog_key','')=''
             and h.e->>'title'=c.title
             and h.e->>'effect_key' is not distinct from c.effect_key
             and coalesce(nullif(h.e->>'value_int','')::integer,-2147483648)=coalesce(c.value_int,-2147483648)
           )
      ))::integer as available_count
    from public.curse_cards c
    where c.enabled and c.deck_count>0
  ), expanded as (
    select a.card_key as catalog_key,extensions.gen_random_uuid()::text as instance_uuid
    from available a
    cross join lateral generate_series(1,a.available_count) g
  )
  select coalesce(jsonb_agg(catalog_key||'::'||instance_uuid order by random()),'[]'::jsonb) into v_deck
  from expanded;

  insert into public.game_card_state(game_id,cycle,deck,cursor,updated_at)
  values(p_game_id,1,v_deck,0,now())
  on conflict(game_id) do update set cycle=public.game_card_state.cycle+1,deck=excluded.deck,cursor=0,updated_at=now()
  returning cycle into v_cycle;
  return v_cycle;
end;$$;

create or replace function public._draw_cards_v4(p_game_id uuid,p_count integer)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare
  v_result jsonb:='[]'::jsonb;v_state public.game_card_state%rowtype;
  v_instance_key text;v_catalog_key text;v_card public.curse_cards%rowtype;
begin
  if p_count<=0 then return v_result; end if;
  if not exists(select 1 from public.game_card_state where game_id=p_game_id) then perform public._reshuffle_card_deck_v1(p_game_id); end if;
  while jsonb_array_length(v_result)<p_count loop
    select * into v_state from public.game_card_state where game_id=p_game_id for update;
    if v_state.cursor>=jsonb_array_length(v_state.deck) then
      perform public._reshuffle_card_deck_v1(p_game_id);
      select * into v_state from public.game_card_state where game_id=p_game_id for update;
      if jsonb_array_length(v_state.deck)=0 then exit; end if;
    end if;
    v_instance_key:=v_state.deck->>v_state.cursor;
    update public.game_card_state set cursor=cursor+1,updated_at=now() where game_id=p_game_id;
    v_catalog_key:=split_part(v_instance_key,'::',1);
    select * into v_card from public.curse_cards where card_key=v_catalog_key and enabled and deck_count>0;
    if found then
      v_result:=v_result||jsonb_build_array(jsonb_build_object(
        'card_key',v_instance_key,'catalog_key',v_card.card_key,
        'title',v_card.title,'description',v_card.description,
        'duration_seconds',v_card.duration_seconds,'card_kind',v_card.card_kind,
        'effect_key',v_card.effect_key,'value_int',v_card.value_int,
        'cast_cost_minutes',v_card.cast_cost_minutes,'cast_cost_kind',v_card.cast_cost_kind,
        'cast_cost_text',v_card.cast_cost_text));
    end if;
  end loop;
  return v_result;
end;$$;

-- ---------------------------------------------------------------------------
-- Editable question catalogue.
-- ---------------------------------------------------------------------------
create table if not exists public.question_catalog(
  question_key text primary key,
  category text not null check(category in ('MIXED','RADAR','THERMOMETER','TENTACLES','PHOTO')),
  title text not null,
  description text not null default '',
  question_kind text not null check(question_kind in ('radar','district','district_set','landmark_compare','directional','same_line','thermometer','tentacle','photo','street_shape')),
  params jsonb not null default '{}'::jsonb check(jsonb_typeof(params)='object'),
  endgame_only boolean not null default false,
  enabled boolean not null default true,
  sort_order integer not null default 100,
  updated_at timestamptz not null default now()
);
alter table public.question_catalog enable row level security;
drop policy if exists "question catalogue readable by everyone" on public.question_catalog;
create policy "question catalogue readable by everyone" on public.question_catalog for select to anon,authenticated using(true);
grant select on public.question_catalog to anon,authenticated;
revoke insert,update,delete on public.question_catalog from anon,authenticated;

insert into public.question_catalog(question_key,category,title,description,question_kind,params,endgame_only,sort_order) values
('same-district','MIXED','Same District','Same Vienna district?','district','{}',false,10),
('same-line','MIXED','On This U-/S-Bahn Line?','Choose a line. Is the hiding station served by it?','same_line','{}',false,20),
('street-shape','MIXED','Current Street Shape','Receive a hand-drawn outline of the Hider''s nearest street.','street_shape','{}',true,30),
('transdanubia','MIXED','In Mordor?','Is the target across the Danube in district 21 or 22?','district_set','{"districts":[21,22],"yes_label":"Yes","no_label":"No"}',false,40),
('inner-districts','MIXED','Inner Districts?','Is the target in districts 1-9?','district_set','{"districts":[1,2,3,4,5,6,7,8,9],"yes_label":"Yes","no_label":"No"}',false,50),
('stephansdom-benchmark','MIXED','Closer to Stephansdom?','Is the target closer to Stephansdom than you are?','landmark_compare','{"landmark_name":"Stephansdom","landmark":{"lat":48.20849,"lng":16.37208}}',false,60),
('schoenbrunn-benchmark','MIXED','Closer to Schönbrunn?','Is the target closer to Schönbrunn Palace than you are?','landmark_compare','{"landmark_name":"Schönbrunn Palace","landmark":{"lat":48.18452,"lng":16.31217}}',false,70),
('donauturm-benchmark','MIXED','Closer to Donauturm?','Is the target closer to Donauturm than you are?','landmark_compare','{"landmark_name":"Donauturm","landmark":{"lat":48.24035,"lng":16.41008}}',false,80),
('riesenrad-benchmark','MIXED','Closer to the Riesenrad?','Is the target closer to the Wiener Riesenrad than you are?','landmark_compare','{"landmark_name":"Wiener Riesenrad","landmark":{"lat":48.21667,"lng":16.39588}}',false,90),
('north-of-me','MIXED','North of Me?','Is the target north of your position?','directional','{"axis":"lat","positive_label":"North","negative_label":"South"}',false,100),
('east-of-me','MIXED','East of Me?','Is the target east of your position?','directional','{"axis":"lng","positive_label":"East","negative_label":"West"}',false,110),
('radar-20000','RADAR','20 km Radar','Is the target within 20 km of this location?','radar','{"radius_m":20000}',false,200),
('radar-10000','RADAR','10 km Radar','Is the target within 10 km of this location?','radar','{"radius_m":10000}',false,210),
('radar-5000','RADAR','5 km Radar','Is the target within 5 km of this location?','radar','{"radius_m":5000}',false,220),
('radar-1000','RADAR','1 km Radar','Is the target within 1 km of this location?','radar','{"radius_m":1000}',false,230),
('radar-500','RADAR','500 m Radar','Is the target within 500 m of this location?','radar','{"radius_m":500}',false,240),
('radar-100','RADAR','100 m Radar','Is the target within 100 m of this location?','radar','{"radius_m":100}',false,250),
('thermo-250','THERMOMETER','250 m Thermometer','Start here; after moving at least 250 m ask whether you are warmer.','thermometer','{"min_travel_m":250}',false,300),
('thermo-500','THERMOMETER','500 m Thermometer','Start here; after moving at least 500 m ask whether you are warmer.','thermometer','{"min_travel_m":500}',false,310),
('thermo-2000','THERMOMETER','2 km Thermometer','Start here; after moving at least 2 km ask whether you are warmer.','thermometer','{"min_travel_m":2000}',false,320),
('tentacle-museums','TENTACLES','Museums','5 km Tentacle.','tentacle','{"poi_type":"museum"}',true,400),
('tentacle-parks','TENTACLES','Parks','5 km Tentacle.','tentacle','{"poi_type":"park"}',true,410),
('tentacle-libraries','TENTACLES','Libraries','5 km Tentacle.','tentacle','{"poi_type":"library"}',true,420),
('tentacle-cinemas','TENTACLES','Movie Theaters','5 km Tentacle.','tentacle','{"poi_type":"cinema"}',true,430),
('tentacle-hospitals','TENTACLES','Hospitals','5 km Tentacle.','tentacle','{"poi_type":"hospital"}',true,440),
('tentacle-cemeteries','TENTACLES','Cemeteries / Graveyards','5 km Tentacle.','tentacle','{"poi_type":"cemetery"}',true,450),
('tentacle-churches','TENTACLES','Churches','5 km Tentacle.','tentacle','{"poi_type":"church"}',true,460),
('tentacle-zoos','TENTACLES','Zoos / Aquariums','5 km Tentacle.','tentacle','{"poi_type":"zoo"}',true,470),
('photo-water','PHOTO','Biggest body of water','Send a photo of the biggest body of water visible from the hiding area.','photo','{"photo_prompt":"Biggest body of water"}',false,500),
('photo-structure','PHOTO','Highest visible structure','Send a photo of the highest visible structure.','photo','{"photo_prompt":"Highest visible structure"}',false,510),
('photo-selfie','PHOTO','Selfie','Send a current selfie from the hiding location.','photo','{"photo_prompt":"Selfie"}',false,520),
('photo-four-houses','PHOTO','At least 4 houses in one image','One photo with at least four houses.','photo','{"photo_prompt":"At least 4 houses in one image"}',false,530),
('photo-lamp','PHOTO','Closest street light','Photograph the closest street light or lamp to the hiding spot.','photo','{"photo_prompt":"Closest street light / lamp"}',false,540),
('photo-up','PHOTO','View straight up','Photograph the view straight upward.','photo','{"photo_prompt":"View straight up"}',false,550)
on conflict(question_key) do nothing;

create or replace function public.admin_list_questions_v1(p_password text)
returns table(
  question_key text,category text,title text,description text,question_kind text,
  params jsonb,endgame_only boolean,enabled boolean,sort_order integer,updated_at timestamptz
)
language plpgsql security definer set search_path=public,extensions as $$
begin
  if not public._admin_password_ok(p_password) then perform pg_sleep(0.35);raise exception 'Invalid developer password.';end if;
  return query select q.question_key,q.category,q.title,q.description,q.question_kind,q.params,q.endgame_only,q.enabled,q.sort_order,q.updated_at
  from public.question_catalog q order by q.sort_order,q.title;
end;$$;
grant execute on function public.admin_list_questions_v1(text) to anon,authenticated;

create or replace function public.admin_save_question_v1(
  p_password text,p_question_key text,p_category text,p_title text,p_description text,
  p_question_kind text,p_params jsonb,p_endgame_only boolean,p_enabled boolean,p_sort_order integer
) returns text
language plpgsql security definer set search_path=public,extensions as $$
declare v_key text;
begin
  if not public._admin_password_ok(p_password) then perform pg_sleep(0.35);raise exception 'Invalid developer password.';end if;
  if p_category not in ('MIXED','RADAR','THERMOMETER','TENTACLES','PHOTO') then raise exception 'Invalid question category.';end if;
  if p_question_kind not in ('radar','district','district_set','landmark_compare','directional','same_line','thermometer','tentacle','photo','street_shape') then raise exception 'Invalid question rule type.';end if;
  if jsonb_typeof(coalesce(p_params,'{}'::jsonb))<>'object' then raise exception 'Question parameters must be a JSON object.';end if;
  if char_length(trim(coalesce(p_title,''))) not between 1 and 120 then raise exception 'Question title must be 1-120 characters.';end if;
  if char_length(coalesce(p_description,''))>800 then raise exception 'Question text is too long.';end if;

  v_key=nullif(trim(coalesce(p_question_key,'')),'');
  if v_key is null then v_key='custom-'||replace(extensions.gen_random_uuid()::text,'-','');end if;
  insert into public.question_catalog(question_key,category,title,description,question_kind,params,endgame_only,enabled,sort_order,updated_at)
  values(v_key,p_category,trim(p_title),trim(coalesce(p_description,'')),p_question_kind,coalesce(p_params,'{}'::jsonb),coalesce(p_endgame_only,false),coalesce(p_enabled,true),coalesce(p_sort_order,100),now())
  on conflict(question_key) do update set category=excluded.category,title=excluded.title,description=excluded.description,
    question_kind=excluded.question_kind,params=excluded.params,endgame_only=excluded.endgame_only,enabled=excluded.enabled,
    sort_order=excluded.sort_order,updated_at=now();
  return v_key;
end;$$;
grant execute on function public.admin_save_question_v1(text,text,text,text,text,text,jsonb,boolean,boolean,integer) to anon,authenticated;

create or replace function public.admin_delete_question_v1(p_password text,p_question_key text)
returns boolean language plpgsql security definer set search_path=public,extensions as $$
begin
  if not public._admin_password_ok(p_password) then perform pg_sleep(0.35);raise exception 'Invalid developer password.';end if;
  delete from public.question_catalog where question_key=p_question_key;
  return found;
end;$$;
grant execute on function public.admin_delete_question_v1(text,text) to anon,authenticated;


-- Hide & Seek: Vienna v3.10.0
-- New casting-cost modes + interactive Vienna curses.
-- Run ONCE after v3.9.0.

-- ---------------------------------------------------------------------------
-- Casting costs can now consume another held card.
-- ---------------------------------------------------------------------------
alter table public.curse_cards add column if not exists cast_cost_category text;

alter table public.curse_cards drop constraint if exists curse_cards_cast_cost_kind_check;
alter table public.curse_cards add constraint curse_cards_cast_cost_kind_check
  check (cast_cost_kind in ('none','time','custom','discard_any','discard_category'));

alter table public.curse_cards drop constraint if exists curse_cards_cast_cost_category_check;
alter table public.curse_cards add constraint curse_cards_cast_cost_category_check
  check (cast_cost_category is null or cast_cost_category in ('curse','veto','time_bonus','powerup','time_trap'));

create or replace function public.admin_list_cards_v3(p_password text)
returns table(
  card_key text,title text,description text,duration_seconds integer,
  card_kind text,effect_key text,value_int integer,cast_cost_minutes integer,
  cast_cost_kind text,cast_cost_text text,cast_cost_category text,enabled boolean,deck_count integer,
  special_engine boolean
)
language plpgsql security definer set search_path=public,extensions as $$
begin
  if not public._admin_password_ok(p_password) then
    perform pg_sleep(0.35); raise exception 'Invalid developer password.';
  end if;
  return query
  select c.card_key,c.title,c.description,c.duration_seconds,c.card_kind,c.effect_key,c.value_int,
         c.cast_cost_minutes,c.cast_cost_kind,c.cast_cost_text,c.cast_cost_category,c.enabled,c.deck_count,
         (c.effect_key in ('prosperous_home','duplicate','reshuffle_deck','time_trap','veto_question')) as special_engine
  from public.curse_cards c
  order by
    case when c.effect_key in ('prosperous_home','duplicate','reshuffle_deck','time_trap','veto_question') then 9
    when c.card_kind='time_bonus' then 1 when c.card_kind='curse' then 2 else 3 end,
    c.title,c.card_key;
end;$$;
grant execute on function public.admin_list_cards_v3(text) to anon,authenticated;

create or replace function public.admin_save_card_v3(
  p_password text,p_card_key text,p_title text,p_description text,
  p_duration_seconds integer,p_card_kind text,p_effect_key text,p_value_int integer,
  p_cast_cost_kind text,p_cast_cost_minutes integer,p_cast_cost_text text,p_cast_cost_category text,
  p_deck_count integer
) returns text
language plpgsql security definer set search_path=public,extensions as $$
declare v_key text;v_special boolean;
begin
  if not public._admin_password_ok(p_password) then perform pg_sleep(0.35);raise exception 'Invalid developer password.';end if;
  if char_length(trim(coalesce(p_title,''))) not between 1 and 120 then raise exception 'Card title must be 1-120 characters.';end if;
  if char_length(trim(coalesce(p_description,''))) not between 1 and 1200 then raise exception 'Card text must be 1-1200 characters.';end if;
  if p_card_kind not in ('curse','powerup','time_bonus','time_trap') then raise exception 'Invalid card type.';end if;
  if p_cast_cost_kind not in ('none','time','custom','discard_any','discard_category') then raise exception 'Invalid casting-cost type.';end if;
  if coalesce(p_deck_count,-1) not between 0 and 50 then raise exception 'Deck count must be 0-50.';end if;
  if p_duration_seconds is not null and p_duration_seconds<0 then raise exception 'Invalid duration.';end if;
  if p_cast_cost_kind='time' and (coalesce(p_cast_cost_minutes,0)<=0 or p_cast_cost_minutes%5<>0 or p_cast_cost_minutes>120) then raise exception 'Time casting cost must be 5-120 minutes in 5-minute steps.';end if;
  if p_cast_cost_kind='custom' and char_length(trim(coalesce(p_cast_cost_text,'')))<1 then raise exception 'Enter the custom casting cost.';end if;
  if p_cast_cost_kind='discard_category' and coalesce(p_cast_cost_category,'') not in ('curse','veto','time_bonus','powerup','time_trap') then raise exception 'Choose a discard-card category.';end if;

  v_key=nullif(trim(coalesce(p_card_key,'')),'');
  if v_key is null then v_key='custom-'||replace(extensions.gen_random_uuid()::text,'-',''); end if;

  select effect_key in ('prosperous_home','duplicate','reshuffle_deck','time_trap','veto_question') into v_special
  from public.curse_cards where card_key=v_key;

  if coalesce(v_special,false) then
    update public.curse_cards set
      title=trim(p_title),description=trim(p_description),duration_seconds=p_duration_seconds,
      cast_cost_minutes=case when p_cast_cost_kind='time' then p_cast_cost_minutes else 0 end,
      cast_cost_kind=p_cast_cost_kind,
      cast_cost_text=case when p_cast_cost_kind='custom' then trim(p_cast_cost_text) else null end,
      cast_cost_category=case when p_cast_cost_kind='discard_category' then p_cast_cost_category else null end,
      deck_count=p_deck_count,enabled=(p_deck_count>0)
    where card_key=v_key;
    return v_key;
  end if;

  insert into public.curse_cards(
    card_key,title,description,duration_seconds,card_kind,effect_key,value_int,
    cast_cost_minutes,cast_cost_kind,cast_cost_text,cast_cost_category,enabled,deck_count
  ) values(
    v_key,trim(p_title),trim(p_description),p_duration_seconds,p_card_kind,
    coalesce(nullif(trim(coalesce(p_effect_key,'')),''),'custom_rule'),p_value_int,
    case when p_cast_cost_kind='time' then p_cast_cost_minutes else 0 end,
    p_cast_cost_kind,case when p_cast_cost_kind='custom' then trim(p_cast_cost_text) else null end,
    case when p_cast_cost_kind='discard_category' then p_cast_cost_category else null end,
    (p_deck_count>0),p_deck_count
  ) on conflict(card_key) do update set
    title=excluded.title,description=excluded.description,duration_seconds=excluded.duration_seconds,
    card_kind=excluded.card_kind,effect_key=excluded.effect_key,value_int=excluded.value_int,
    cast_cost_minutes=excluded.cast_cost_minutes,cast_cost_kind=excluded.cast_cost_kind,
    cast_cost_text=excluded.cast_cost_text,cast_cost_category=excluded.cast_cost_category,
    enabled=excluded.enabled,deck_count=excluded.deck_count;
  return v_key;
end;$$;
grant execute on function public.admin_save_card_v3(text,text,text,text,integer,text,text,integer,text,integer,text,text,integer) to anon,authenticated;

-- Draw snapshots include the discard-category rule.
create or replace function public._draw_cards_v4(p_game_id uuid,p_count integer)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare
  v_result jsonb:='[]'::jsonb;v_state public.game_card_state%rowtype;
  v_instance_key text;v_catalog_key text;v_card public.curse_cards%rowtype;
begin
  if p_count<=0 then return v_result; end if;
  if not exists(select 1 from public.game_card_state where game_id=p_game_id) then perform public._reshuffle_card_deck_v1(p_game_id); end if;
  while jsonb_array_length(v_result)<p_count loop
    select * into v_state from public.game_card_state where game_id=p_game_id for update;
    if v_state.cursor>=jsonb_array_length(v_state.deck) then
      perform public._reshuffle_card_deck_v1(p_game_id);
      select * into v_state from public.game_card_state where game_id=p_game_id for update;
      if jsonb_array_length(v_state.deck)=0 then exit; end if;
    end if;
    v_instance_key:=v_state.deck->>v_state.cursor;
    update public.game_card_state set cursor=cursor+1,updated_at=now() where game_id=p_game_id;
    v_catalog_key:=split_part(v_instance_key,'::',1);
    select * into v_card from public.curse_cards where card_key=v_catalog_key and enabled and deck_count>0;
    if found then
      v_result:=v_result||jsonb_build_array(jsonb_build_object(
        'card_key',v_instance_key,'catalog_key',v_card.card_key,'title',v_card.title,'description',v_card.description,
        'duration_seconds',v_card.duration_seconds,'card_kind',v_card.card_kind,
        'effect_key',v_card.effect_key,'value_int',v_card.value_int,
        'cast_cost_minutes',v_card.cast_cost_minutes,'cast_cost_kind',v_card.cast_cost_kind,
        'cast_cost_text',v_card.cast_cost_text,'cast_cost_category',v_card.cast_cost_category));
    end if;
  end loop;
  return v_result;
end;$$;

create or replace function public._held_card_matches_category(p_card jsonb,p_category text)
returns boolean language sql immutable as $$
  select case p_category
    when 'curse' then p_card->>'card_kind'='curse'
    when 'veto' then p_card->>'effect_key'='veto_question'
    when 'time_bonus' then p_card->>'card_kind'='time_bonus'
    when 'powerup' then p_card->>'card_kind'='powerup'
    when 'time_trap' then p_card->>'effect_key'='time_trap' or p_card->>'card_kind'='time_trap'
    else false end;
$$;

-- v5 adds effect payloads and discard-card casting costs.
create or replace function public.play_card_v5(
  p_game_id uuid,p_password text,p_card_key text,p_copy_card_key text default null,
  p_cost_card_keys text[] default array[]::text[],p_effect_payload jsonb default '{}'::jsonb
) returns uuid language plpgsql security definer set search_path=public,extensions as $$
declare
  v_card jsonb;v_copy jsonb;v_effect text;v_kind text;v_duration integer;v_now timestamptz:=now();v_id uuid;
  v_title text;v_desc text;v_value integer;v_cost integer:=0;v_paid integer:=0;v_key text;v_pay jsonb;
  v_cost_kind text;v_cost_text text;v_cost_category text;v_payload jsonb:=coalesce(p_effect_payload,'{}'::jsonb);
  v_local timestamp;v_dow integer;v_t time;v_sidequest text;
begin
  if not public._hider_password_ok(p_game_id,p_password) then raise exception 'Invalid hider password.';end if;
  v_card:=public._get_held_card(p_game_id,p_card_key);if v_card is null then raise exception 'Card is not available in hand.';end if;
  v_effect:=v_card->>'effect_key';v_kind:=v_card->>'card_kind';

  if v_effect='duplicate' then
    if p_copy_card_key is null then raise exception 'Choose a card to duplicate.';end if;
    v_copy:=public._get_held_card(p_game_id,p_copy_card_key);if v_copy is null then raise exception 'Duplicate target is not available.';end if;
    if v_copy->>'card_kind'='time_bonus' then
      perform public._consume_held_card(p_game_id,p_card_key);
      insert into public.private_card_uses(game_id,card_key,effect_key,value_int,metadata)
      values(p_game_id,p_card_key,'duplicate_bonus',(v_copy->>'value_int')::integer,jsonb_build_object('copied_card_key',p_copy_card_key,'copied_title',v_copy->>'title'))
      returning id into v_id;return v_id;
    elsif v_copy->>'card_kind'='curse' then v_card:=v_copy;v_effect:=v_copy->>'effect_key';v_kind:='curse';
    else raise exception 'Duplicate currently supports time bonuses and curses.';end if;
  elsif v_kind<>'curse' then raise exception 'This card is used elsewhere in the interface.';end if;

  v_cost:=coalesce(nullif(v_card->>'cast_cost_minutes','')::integer,0);
  v_cost_kind:=coalesce(nullif(v_card->>'cast_cost_kind',''),case when v_cost>0 then 'time' else 'none' end);
  v_cost_text:=nullif(v_card->>'cast_cost_text','');
  v_cost_category:=nullif(v_card->>'cast_cost_category','');

  if v_cost_kind='time' and v_cost>0 then
    if coalesce(array_length(p_cost_card_keys,1),0)=0 then raise exception 'Choose time-bonus cards to pay the casting cost.';end if;
    foreach v_key in array p_cost_card_keys loop
      if v_key=p_card_key or v_key=coalesce(p_copy_card_key,'') then raise exception 'The played/copied card cannot pay its own casting cost.';end if;
      v_pay:=public._get_held_card(p_game_id,v_key);
      if v_pay is null or v_pay->>'card_kind'<>'time_bonus' then raise exception 'Casting costs can only be paid with held time-bonus cards.';end if;
      v_paid:=v_paid+coalesce((v_pay->>'value_int')::integer,0);
    end loop;
    if v_paid<v_cost then raise exception 'Selected time bonuses do not cover the casting cost.';end if;
  elsif v_cost_kind in ('discard_any','discard_category') then
    if coalesce(array_length(p_cost_card_keys,1),0)<>1 then raise exception 'Choose exactly one other held card to discard.';end if;
    v_key:=p_cost_card_keys[1];
    if v_key=p_card_key or v_key=coalesce(p_copy_card_key,'') then raise exception 'The played/copied card cannot pay its own casting cost.';end if;
    v_pay:=public._get_held_card(p_game_id,v_key);if v_pay is null then raise exception 'Casting-cost card is not available in hand.';end if;
    if v_cost_kind='discard_category' and not public._held_card_matches_category(v_pay,v_cost_category) then raise exception 'The selected card does not match the required discard category.';end if;
  end if;

  -- Effect-specific, server-owned rules.
  if v_effect='deutsche_bahn' then
    if coalesce(v_payload->>'blocked_line','') !~ '^[US][0-9]{1,2}$' then raise exception 'Choose the blocked U-/S-Bahn line.';end if;
    v_duration:=1800;
  elsif v_effect='side_quest' then
    v_duration:=2700;
    v_sidequest:=case floor(random()*10)::integer
      when 0 then 'Find a public statue and recreate its pose as a team photo.'
      when 1 then 'Find a playground. Every Seeker must use one piece of playground equipment.'
      when 2 then 'Find a public fountain and take an unnecessarily dramatic team portrait.'
      when 3 then 'Find an animal statue or sculpture and give it a name and backstory.'
      when 4 then 'Ride three consecutive stops on a tram line you were not planning to use.'
      when 5 then 'Find a bakery and unanimously choose one item that best represents Vienna.'
      when 6 then 'Find a street named after a person and learn one fact about that person.'
      when 7 then 'Find something red-white-red in public space and photograph the whole team with it.'
      when 8 then 'Find a staircase with at least 20 steps and stage a heroic summit photo at the top.'
      else 'Find a park bench with a view and record a 20-second fake tourism advertisement for Vienna.' end;
    v_payload:=v_payload||jsonb_build_object('side_quest',v_sidequest);
  elsif v_effect='wean_ned_schlecht_redn' then
    v_local:=v_now at time zone 'Europe/Vienna';v_dow:=extract(isodow from v_local)::integer;v_t:=v_local::time;
    if v_dow=1 or (v_dow=2 and v_t<time '12:00') then
      v_duration:=3600;v_payload:=v_payload||jsonb_build_object('mode','work_hours');
    else
      v_duration:=null;v_payload:=v_payload||jsonb_build_object('mode','wine_hike');
    end if;
  elsif v_effect='haute_vollee' then v_duration:=900;
  elsif v_effect='fiaker' then v_duration:=3600;
  elsif v_effect='mordor_curse' then
    if coalesce(v_payload->>'mode','') not in ('inside','outside') then raise exception 'Mordor curse needs the Seekers current side of the Danube.';end if;
    v_duration:=1200;
  elsif v_effect='broken_lift' then v_duration:=1800;
  elsif v_effect='false_prophet' then v_duration:=1200;
  else
    v_duration:=nullif(v_card->>'duration_seconds','')::integer;
  end if;

  perform public._consume_held_card(p_game_id,p_card_key);
  if v_cost_kind in ('time','discard_any','discard_category') then
    foreach v_key in array p_cost_card_keys loop perform public._consume_held_card(p_game_id,v_key);end loop;
  end if;

  v_title:=v_card->>'title';v_desc:=v_card->>'description';v_value:=nullif(v_card->>'value_int','')::integer;
  insert into public.game_actions(game_id,actor,kind,payload) values(
    p_game_id,'hider','curse_play',
    jsonb_build_object(
      'source_card_key',p_card_key,'effect_key',v_effect,'title',v_title,'description',v_desc,
      'duration_seconds',v_duration,'value_int',v_value,'starts_at',v_now,
      'ends_at',case when v_duration is null then null else v_now+make_interval(secs=>v_duration) end,
      'copied_from',p_copy_card_key,'cast_cost_kind',v_cost_kind,'cast_cost_minutes',v_cost,
      'cast_cost_text',v_cost_text,'cast_cost_category',v_cost_category,'cast_paid_minutes',v_paid,
      'cast_cards',to_jsonb(p_cost_card_keys)
    ) || v_payload
  ) returning id into v_id;
  return v_id;
end;$$;
grant execute on function public.play_card_v5(uuid,text,text,text,text[],jsonb) to anon,authenticated;

-- Seekers may manually clear only curses that explicitly use a completion checkbox.
create or replace function public.complete_curse_v1(p_game_id uuid,p_curse_action_id uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_action public.game_actions%rowtype;v_effect text;v_id uuid;v_mode text;
begin
  select * into v_action from public.game_actions where id=p_curse_action_id and game_id=p_game_id and kind='curse_play' and is_active;
  if not found then raise exception 'Active curse not found.';end if;
  v_effect:=v_action.payload->>'effect_key';v_mode:=v_action.payload->>'mode';
  if v_effect not in ('fiaker','schwarzkappler','wean_ned_schlecht_redn') then raise exception 'This curse cannot be manually completed.';end if;
  if v_effect='wean_ned_schlecht_redn' and v_mode<>'wine_hike' then raise exception 'This version of the curse ends by timer.';end if;
  if exists(select 1 from public.game_actions where game_id=p_game_id and kind='curse_complete' and parent_id=p_curse_action_id and is_active) then
    raise exception 'Curse is already complete.';
  end if;
  insert into public.game_actions(game_id,actor,kind,parent_id,payload)
  values(p_game_id,'seeker','curse_complete',p_curse_action_id,jsonb_build_object('effect_key',v_effect,'completed_at',now()))
  returning id into v_id;
  return v_id;
end;$$;
grant execute on function public.complete_curse_v1(uuid,uuid) to anon,authenticated;

-- ---------------------------------------------------------------------------
-- New curses. Existing cards are deliberately untouched.
-- ---------------------------------------------------------------------------
insert into public.curse_cards(
  card_key,title,description,duration_seconds,card_kind,effect_key,value_int,
  cast_cost_minutes,cast_cost_kind,cast_cost_text,cast_cost_category,enabled,deck_count
) values
('side-quest-vienna-1','Curse of the Side Quest','A completely unnecessary mission has appeared. Complete the randomly assigned side quest while the 45-minute curse timer runs.',2700,'curse','side_quest',null,0,'discard_category',null,'curse',true,1),
('deutsche-bahn-vienna-1','Curse of the Deutsche Bahn','Your current line received an unexpected Gleisschaden due to 30 years of infrastructural neglect. We, the Deutsche Bahn would like to apologize for this unforseeable interruption. Get off your mode of transportation at the next possible stop. Your line is blocked for 30 minutes and cannot be used.',1800,'curse','deutsche_bahn',null,0,'none',null,null,true,1),
('wean-ned-schlecht-redn-vienna-1','Curse of the ''I lass mir mei Wean ned schlecht redn''','If its already past Tuesday noon, visit the start of any of the Wien Weinwanderwege. If its before before Tuesday noon, you have to hault for 1h as its work hours.',null,'curse','wean_ned_schlecht_redn',null,40,'time',null,null,true,1),
('haute-vollee-vienna-1','Curse of the Haute Vollee','As peasents and cretins you are not allowed to enter the high society (and Asian tourism) areas. Stay out of 1., 18., and 19. Bezirk for 15 minutes.',900,'curse','haute_vollee',null,15,'time',null,null,true,1),
('one-ring-vienna-1','Curse of the One Ring','They all were deceived as another ring was forged. You cannot cross the Ringstrasse in any direction with public transportation. On foot you may cross it, but only when traversing at least 250m along it.',null,'curse','one_ring',null,10,'time',null,null,true,1),
('schwarzkappler-vienna-1','Curse of the Schwarzkappler','Seekers must leave their current transportation if currently on any and go to the ticket machine to buy a ticket before continuing their journey.',null,'curse','schwarzkappler',null,5,'time',null,null,true,1),
('wiener-grantler-vienna-1','Curse of the Wiener Grantler','Until the next question, the Seekers may only communicate in exaggeratedly grumpy complaints about Vienna. If anyone says something sincerely positive, the team must stop for 2 minutes.',null,'curse','wiener_grantler',null,5,'time',null,null,true,1),
('fiaker-vienna-1','Curse of the Fiaker','Seekers must spot a Fiaker horse carriage before being allowed to ask any more questions. Check the curse off when you spot one. It automatically lifts after 1 hour.',3600,'curse','fiaker',null,15,'time',null,null,true,1),
('mordor-curse-vienna-1','Curse of Mordor','If the Seekers are already in districts 21 or 22, they must remain in Mordor for 20 minutes. Otherwise, they may not enter districts 21 or 22 for 20 minutes.',1200,'curse','mordor_curse',null,15,'time',null,null,true,1),
('broken-lift-vienna-1','Curse of the Broken Lift','Elevators are forbidden for 30 minutes. Stairs and escalators only.',1800,'curse','broken_lift',null,5,'time',null,null,true,1),
('gemeindebau-vienna-1','Curse of the Gemeindebau','Before asking another question, find and photograph a Gemeindebau or an obvious municipal housing complex.',null,'curse','gemeindebau',null,5,'time',null,null,true,1),
('quick-escalation-vienna-1','Curse of Quick Escalation','Seekers must until the end of the run deliberately stand on the left side of any escalater they might use.',null,'curse','quick_escalation',null,0,'custom','The hider must spot a person standing on the left side of the escalator to play the curse.',null,true,1),
('false-prophet-vienna-1','Curse of the False Prophet','One Seeker becomes the Prophet for 20 minutes. Only the Prophet may decide which direction the team travels, but the Prophet may not look at the map. Everyone else may see the map but can answer the Prophet only with yes/no.',1200,'curse','false_prophet',null,15,'time',null,null,true,1)
on conflict(card_key) do nothing;


-- Hide & Seek: Vienna v3.10.1
-- Duplicate hotfix: Duplicate now creates a genuine second held card instance.
-- Run once after v3.10.0.

-- Held-card lookup now also understands active virtual copies created by Duplicate.
create or replace function public._get_held_card(p_game_id uuid,p_card_key text)
returns jsonb language sql stable security definer set search_path=public as $$
  select q.card
  from (
    select e as card,1 as ord
    from public.curse_draws d
    cross join lateral jsonb_array_elements(d.cards) e
    where d.game_id=p_game_id
      and d.kept_card_keys ? p_card_key
      and not (d.used_card_keys ? p_card_key)
      and e->>'card_key'=p_card_key
    union all
    select u.metadata->'card' as card,2 as ord
    from public.private_card_uses u
    where u.game_id=p_game_id
      and u.effect_key='duplicate_copy'
      and u.is_active
      and u.card_key=p_card_key
      and jsonb_typeof(u.metadata->'card')='object'
  ) q
  order by q.ord
  limit 1;
$$;

-- Consuming a held card now consumes either an ordinary drawn card or a Duplicate copy.
create or replace function public._consume_held_card(p_game_id uuid,p_card_key text)
returns boolean language plpgsql security definer set search_path=public as $$
begin
  update public.curse_draws
  set used_card_keys=used_card_keys||jsonb_build_array(p_card_key)
  where game_id=p_game_id
    and kept_card_keys ? p_card_key
    and not (used_card_keys ? p_card_key);
  if found then return true; end if;

  update public.private_card_uses
  set is_active=false
  where game_id=p_game_id
    and effect_key='duplicate_copy'
    and card_key=p_card_key
    and is_active;
  return found;
end;$$;

-- Correct Duplicate behavior:
-- consume Duplicate itself, leave the source card untouched, and add a new independent
-- copy to the private Hider hand. The copied card is only played/spent later.
create or replace function public.use_duplicate_v1(
  p_game_id uuid,p_password text,p_duplicate_card_key text,p_copy_card_key text
) returns text
language plpgsql security definer set search_path=public,extensions as $$
declare
  v_duplicate jsonb;v_copy jsonb;v_new_key text;v_snapshot jsonb;v_id uuid;
begin
  if not public._hider_password_ok(p_game_id,p_password) then
    raise exception 'Invalid hider password.';
  end if;

  v_duplicate:=public._get_held_card(p_game_id,p_duplicate_card_key);
  if v_duplicate is null or v_duplicate->>'effect_key'<>'duplicate' then
    raise exception 'Duplicate card is not available in hand.';
  end if;
  if p_duplicate_card_key=p_copy_card_key then
    raise exception 'Duplicate cannot copy itself.';
  end if;

  v_copy:=public._get_held_card(p_game_id,p_copy_card_key);
  if v_copy is null then raise exception 'Card to copy is not available in hand.'; end if;
  if coalesce(v_copy->>'card_kind','') not in ('time_bonus','curse') then
    raise exception 'Duplicate currently supports time bonuses and curses.';
  end if;

  v_new_key:='duplicate-copy-'||gen_random_uuid()::text;
  v_snapshot:=v_copy||jsonb_build_object(
    'card_key',v_new_key,
    'duplicated_from',p_copy_card_key
  );

  if not public._consume_held_card(p_game_id,p_duplicate_card_key) then
    raise exception 'Could not consume Duplicate card.';
  end if;

  insert into public.private_card_uses(game_id,card_key,effect_key,value_int,metadata,is_active)
  values(
    p_game_id,v_new_key,'duplicate_copy',nullif(v_copy->>'value_int','')::integer,
    jsonb_build_object(
      'copied_card_key',p_copy_card_key,
      'copied_title',v_copy->>'title',
      'source_duplicate_card_key',p_duplicate_card_key,
      'card',v_snapshot
    ),true
  ) returning id into v_id;

  return v_new_key;
end;$$;
grant execute on function public.use_duplicate_v1(uuid,text,text,text) to anon,authenticated;

-- Final scoring now counts active duplicated time-bonus cards as ordinary held bonuses.
-- Legacy duplicate_bonus rows from pre-v3.10.1 games are still counted too.
create or replace function public.finish_game_v1(
  p_game_id uuid,p_actor text,p_password text default null
) returns table(
  raw_seconds bigint,held_bonus_minutes integer,trap_bonus_minutes integer,
  penalty_minutes integer,final_seconds bigint,finished_at timestamptz
)
language plpgsql security definer set search_path=public,extensions as $$
declare
  v_game public.games%rowtype;v_now timestamptz:=now();v_raw bigint;
  v_held integer:=0;v_dup integer:=0;v_virtual integer:=0;v_traps integer:=0;v_penalty integer:=0;v_final bigint;
begin
  if p_actor not in ('hider','seeker') then raise exception 'Invalid actor.'; end if;
  if p_actor='hider' and not public._hider_password_ok(p_game_id,p_password) then raise exception 'Invalid hider password.'; end if;
  select * into v_game from public.games where id=p_game_id for update;
  if not found then raise exception 'Game not found.'; end if;
  if v_game.status='finished' then
    return query select coalesce(v_game.final_raw_seconds,v_game.clock_elapsed_seconds),coalesce(v_game.final_bonus_minutes,0),coalesce(v_game.final_trap_minutes,0),coalesce(v_game.final_penalty_minutes,0),coalesce(v_game.final_score_seconds,v_game.clock_elapsed_seconds),v_game.finished_at;
    return;
  end if;
  v_raw:=coalesce(v_game.clock_elapsed_seconds,0);
  if v_game.clock_running and v_game.clock_started_at is not null then
    v_raw:=v_raw+greatest(0,floor(extract(epoch from (v_now-v_game.clock_started_at)))::bigint);
  end if;

  select coalesce(sum(coalesce(nullif(e->>'value_int','')::integer,0)),0)::integer into v_held
  from public.curse_draws d cross join lateral jsonb_array_elements(d.cards) e
  where d.game_id=p_game_id and d.kept_card_keys ? (e->>'card_key') and not(d.used_card_keys ? (e->>'card_key')) and e->>'card_kind'='time_bonus';

  -- Backwards compatibility for copies created by the old Duplicate implementation.
  select coalesce(sum(value_int),0)::integer into v_dup from public.private_card_uses
  where game_id=p_game_id and effect_key='duplicate_bonus' and is_active;

  -- v3.10.1+: copied time cards are real held card instances.
  select coalesce(sum(coalesce(nullif(metadata->'card'->>'value_int','')::integer,0)),0)::integer into v_virtual
  from public.private_card_uses
  where game_id=p_game_id
    and effect_key='duplicate_copy'
    and is_active
    and metadata->'card'->>'card_kind'='time_bonus';

  select coalesce(sum(coalesce(bonus_minutes,base_bonus_minutes)),0)::integer into v_traps
  from public.time_traps where game_id=p_game_id and trigger_active;

  select coalesce(sum(coalesce(nullif(payload->>'late_penalty_minutes','')::integer,0)),0)::integer into v_penalty
  from public.game_actions where game_id=p_game_id and is_active and kind in('answer','question_veto');

  v_held:=v_held+v_dup+v_virtual;
  v_final:=greatest(0,v_raw+(v_held+v_traps-v_penalty)::bigint*60);

  update public.games set status='finished',clock_elapsed_seconds=v_raw,clock_running=false,clock_started_at=null,
    final_raw_seconds=v_raw,final_bonus_minutes=v_held,final_trap_minutes=v_traps,
    final_penalty_minutes=v_penalty,final_score_seconds=v_final,finished_at=v_now,finished_by=p_actor
  where id=p_game_id;

  insert into public.game_actions(game_id,actor,kind,payload)
  values(p_game_id,p_actor,'game_finish',jsonb_build_object(
    'raw_seconds',v_raw,'held_bonus_minutes',v_held,'trap_bonus_minutes',v_traps,
    'penalty_minutes',v_penalty,'final_seconds',v_final,'finished_at',v_now
  ));

  return query select v_raw,v_held,v_traps,v_penalty,v_final,v_now;
end;$$;
grant execute on function public.finish_game_v1(uuid,text,text) to anon,authenticated;
