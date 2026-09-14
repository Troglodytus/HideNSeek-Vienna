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

