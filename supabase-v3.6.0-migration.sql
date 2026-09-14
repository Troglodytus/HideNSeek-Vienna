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
