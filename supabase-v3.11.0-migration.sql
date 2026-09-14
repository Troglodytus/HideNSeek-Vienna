-- Hide & Seek: Vienna v3.11.0
-- Curse of the Turntables: 20-minute relocation phase.
-- Run ONCE after v3.10.2.

create extension if not exists pgcrypto with schema extensions;

-- Public phase-boundary event. It intentionally contains no secret station coordinates/name.
alter table public.game_actions drop constraint if exists game_actions_kind_check;
alter table public.game_actions add constraint game_actions_kind_check check (
  kind in (
    'seeker_location','thermo_reference','question','answer','curse_play','question_veto',
    'time_trap_place','time_trap_trigger','endgame_zone','game_finish','curse_complete',
    'turntables_relocate'
  )
);

-- Add the engine card without touching any other catalogue entries. If the user already
-- created a card with this exact title, promote that row to the engine effect instead.
do $$
declare v_key text;
begin
  select card_key into v_key from public.curse_cards
  where lower(title)=lower('Curse of the Turntables')
  order by card_key limit 1;

  if v_key is null then
    insert into public.curse_cards(
      card_key,title,description,duration_seconds,card_kind,effect_key,value_int,
      cast_cost_minutes,cast_cost_kind,cast_cost_text,cast_cost_category,enabled,deck_count
    ) values (
      'turntables-vienna-1','Curse of the Turntables',
      'The game time is paused immediately when played and the Seekers are not allowed to move. The Hider has 20 Minutes to relocate to another hiding station. Possible effects of Prosperous Home are reset.',
      1200,'curse','turntables',null,0,'none',null,null,true,1
    );
  else
    update public.curse_cards set
      title='Curse of the Turntables',
      description='The game time is paused immediately when played and the Seekers are not allowed to move. The Hider has 20 Minutes to relocate to another hiding station. Possible effects of Prosperous Home are reset.',
      duration_seconds=1200,card_kind='curse',effect_key='turntables',enabled=true,
      cast_cost_minutes=0,cast_cost_kind='none',cast_cost_text=null,cast_cost_category=null,
      deck_count=greatest(1,coalesce(deck_count,1))
    where card_key=v_key;
  end if;
end; $$;

-- A server-side test used by seeker action RPCs.
create or replace function public._turntables_active(p_game_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(
    select 1 from public.game_actions a
    where a.game_id=p_game_id and a.kind='curse_play' and a.is_active
      and a.payload->>'effect_key'='turntables'
      and nullif(a.payload->>'ends_at','')::timestamptz > now()
  );
$$;

-- Playing Turntables consumes the held card and schedules the main clock to resume
-- automatically exactly 20 minutes later. Using a future clock_started_at means the existing
-- clock calculation naturally remains frozen until that instant, even if no browser is open.
create or replace function public.play_turntables_v1(
  p_game_id uuid,p_password text,p_card_key text
) returns uuid
language plpgsql security definer set search_path=public,extensions as $$
declare
  v_card jsonb;v_id uuid;v_now timestamptz:=now();v_resume timestamptz:=now()+interval '20 minutes';
  v_running boolean;v_started timestamptz;v_add bigint:=0;
begin
  if not public._hider_password_ok(p_game_id,p_password) then raise exception 'Invalid hider password.';end if;
  if not exists(select 1 from public.games where id=p_game_id and status='active') then raise exception 'Game is not active.';end if;
  if public._turntables_active(p_game_id) then raise exception 'Turntables is already active.';end if;

  v_card:=public._get_held_card(p_game_id,p_card_key);
  if v_card is null or v_card->>'effect_key'<>'turntables' then raise exception 'No unused Turntables card is in your hand.';end if;

  select clock_running,clock_started_at into v_running,v_started
  from public.games where id=p_game_id for update;
  if v_running and v_started is not null and v_started<v_now then
    v_add:=greatest(0,floor(extract(epoch from (v_now-v_started)))::bigint);
  end if;
  update public.games set
    clock_elapsed_seconds=clock_elapsed_seconds+v_add,
    clock_running=true,
    clock_started_at=v_resume
  where id=p_game_id;

  perform public._consume_held_card(p_game_id,p_card_key);
  insert into public.game_actions(game_id,actor,kind,payload)
  values(p_game_id,'hider','curse_play',jsonb_build_object(
    'source_card_key',p_card_key,'effect_key','turntables','title',coalesce(v_card->>'title','Curse of the Turntables'),
    'description',coalesce(v_card->>'description',''),'duration_seconds',1200,
    'starts_at',v_now,'ends_at',v_resume,'relocation_seconds',1200
  )) returning id into v_id;
  return v_id;
end;$$;
grant execute on function public.play_turntables_v1(uuid,text,text) to anon,authenticated;

-- Confirm the replacement hiding station. No station details are published in game_actions.
-- The old target phase becomes history, old public Endgame zones are retired, and any active
-- Prosperous Home effects are permanently reset by this card.
create or replace function public.relocate_turntables_v1(
  p_game_id uuid,p_password text,p_curse_action_id uuid,
  p_station_name text,p_station_lat double precision,p_station_lng double precision
) returns uuid
language plpgsql security definer set search_path=public,extensions as $$
declare
  v_curse public.game_actions%rowtype;v_old_name text;v_old_lat double precision;v_old_lng double precision;
  v_id uuid;v_end timestamptz;
begin
  if not public._hider_password_ok(p_game_id,p_password) then raise exception 'Invalid hider password.';end if;
  select * into v_curse from public.game_actions
  where id=p_curse_action_id and game_id=p_game_id and kind='curse_play' and is_active
    and payload->>'effect_key'='turntables'
  for update;
  if not found then raise exception 'Active Turntables curse not found.';end if;
  v_end:=nullif(v_curse.payload->>'ends_at','')::timestamptz;
  if v_end is null or now()>v_end then raise exception 'The 20-minute relocation window has expired.';end if;
  if exists(select 1 from public.game_actions where game_id=p_game_id and kind='turntables_relocate' and parent_id=p_curse_action_id and is_active) then
    raise exception 'A new station has already been selected for this Turntables card.';
  end if;
  if char_length(trim(coalesce(p_station_name,'')))<1 then raise exception 'Choose a station.';end if;
  if p_station_lat not between -90 and 90 or p_station_lng not between -180 and 180 then raise exception 'Invalid station coordinate.';end if;

  select station_name,station_lat,station_lng into v_old_name,v_old_lat,v_old_lng
  from public.game_secrets where game_id=p_game_id for update;
  if lower(trim(coalesce(v_old_name,'')))=lower(trim(p_station_name))
     or (abs(coalesce(v_old_lat,999)-p_station_lat)<0.00025 and abs(coalesce(v_old_lng,999)-p_station_lng)<0.00035) then
    raise exception 'Turntables requires another hiding station.';
  end if;

  update public.game_secrets set
    station_name=trim(p_station_name),station_lat=p_station_lat,station_lng=p_station_lng,
    hidden_lat=null,hidden_lng=null,endgame=false,base_radius_m=250
  where game_id=p_game_id;

  -- Old public Endgame zone no longer applies to the relocated target.
  update public.game_actions set is_active=false
  where game_id=p_game_id and kind='endgame_zone' and is_active;

  -- Reset every currently active Prosperous Home. Mark why it was retired so the UI does not
  -- offer a misleading Redo button for an effect that Turntables explicitly erased.
  update public.game_actions set
    is_active=false,
    payload=payload||jsonb_build_object('reset_by_turntables',p_curse_action_id,'reset_at',now())
  where game_id=p_game_id and kind='curse_play' and is_active
    and payload->>'effect_key'='prosperous_home';

  insert into public.game_actions(game_id,actor,kind,parent_id,payload)
  values(p_game_id,'hider','turntables_relocate',p_curse_action_id,jsonb_build_object(
    'effect_key','turntables','relocated_at',now(),'target_phase_reset',true
  )) returning id into v_id;
  return v_id;
end;$$;
grant execute on function public.relocate_turntables_v1(uuid,text,uuid,text,double precision,double precision) to anon,authenticated;

-- Hider may not manually override the mandatory pause while Turntables is active.
create or replace function public.set_game_clock_v1(p_game_id uuid,p_password text,p_action text)
returns boolean language plpgsql security definer set search_path=public,extensions as $$
declare v_now timestamptz:=now();v_running boolean;v_started timestamptz;
begin
  if not public._hider_password_ok(p_game_id,p_password) then raise exception 'Invalid hider password.';end if;
  if public._turntables_active(p_game_id) then raise exception 'Game clock is locked by Curse of the Turntables.';end if;
  select clock_running,clock_started_at into v_running,v_started from public.games where id=p_game_id for update;
  if not found then raise exception 'Game not found.';end if;
  if p_action in ('start','resume') then
    if not v_running then update public.games set clock_running=true,clock_started_at=v_now where id=p_game_id;end if;
  elsif p_action='pause' then
    if v_running and v_started is not null then
      update public.games set
        clock_elapsed_seconds=clock_elapsed_seconds+greatest(0,floor(extract(epoch from (v_now-v_started)))::bigint),
        clock_running=false,clock_started_at=null where id=p_game_id;
    end if;
  else raise exception 'Invalid clock action.';end if;
  return true;
end;$$;
grant execute on function public.set_game_clock_v1(uuid,text,text) to anon,authenticated;

-- Seekers cannot publish movement while frozen.
create or replace function public.set_seeker_live_position_v1(p_game_id uuid,p_lat double precision,p_lng double precision,p_accuracy_m double precision default null)
returns boolean language plpgsql security definer set search_path=public as $$
begin
  if not exists(select 1 from public.games where id=p_game_id and status='active') then raise exception 'Game is not active.';end if;
  if public._turntables_active(p_game_id) then raise exception 'Seekers are frozen by Curse of the Turntables.';end if;
  insert into public.seeker_live_positions(game_id,lat,lng,accuracy_m,source,updated_at)
  values(p_game_id,p_lat,p_lng,p_accuracy_m,'gps',now())
  on conflict(game_id) do update set lat=excluded.lat,lng=excluded.lng,accuracy_m=excluded.accuracy_m,source='gps',updated_at=now();
  return true;
end;$$;
grant execute on function public.set_seeker_live_position_v1(uuid,double precision,double precision,double precision) to anon,authenticated;

-- Question cards can be reused after a successful Turntables relocation because the target
-- has changed. Questions remain visible in history, but only the new target phase counts here.
create or replace function public.ask_question_v4(p_game_id uuid,p_slot_key text,p_kind text,p_payload jsonb)
returns uuid
language plpgsql security definer set search_path=public as $$
declare v_id uuid;v_phase_start timestamptz:='epoch'::timestamptz;
begin
  if p_kind not in ('radar','district','district_set','landmark_compare','directional','same_line','station_interchange','thermometer','tentacle','photo','street_shape') then
    raise exception 'Invalid question kind.';
  end if;
  if not exists(select 1 from public.games where id=p_game_id and status='active') then raise exception 'Game is not active.';end if;
  if public._turntables_active(p_game_id) then raise exception 'Seekers are frozen by Curse of the Turntables.';end if;
  select coalesce(max(created_at),'epoch'::timestamptz) into v_phase_start
  from public.game_actions where game_id=p_game_id and kind='turntables_relocate' and is_active;
  if exists(
    select 1 from public.game_actions a
    where a.game_id=p_game_id and a.kind='question' and a.is_active
      and a.created_at>v_phase_start and a.payload->>'slot_key'=p_slot_key
  ) then raise exception 'That question card is already active.';end if;
  insert into public.game_actions(game_id,actor,kind,payload)
  values(p_game_id,'seeker','question',coalesce(p_payload,'{}'::jsonb)||jsonb_build_object(
    'slot_key',p_slot_key,'question_kind',p_kind,'answer_due_at',now()+interval '15 minutes'
  )) returning id into v_id;
  return v_id;
end;$$;
grant execute on function public.ask_question_v4(uuid,text,text,jsonb) to anon,authenticated;

-- Seekers also cannot switch to an Endgame zone during the movement freeze.
create or replace function public.start_seeker_endgame_v1(
  p_game_id uuid,p_station_name text,p_station_lat double precision,p_station_lng double precision
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid;
begin
  if not exists(select 1 from public.games where id=p_game_id and status='active') then raise exception 'Game is not active.';end if;
  if public._turntables_active(p_game_id) then raise exception 'Seekers are frozen by Curse of the Turntables.';end if;
  update public.game_actions set is_active=false where game_id=p_game_id and kind='endgame_zone' and is_active;
  insert into public.game_actions(game_id,actor,kind,payload)
  values(p_game_id,'seeker','endgame_zone',jsonb_build_object(
    'station_name',p_station_name,'center',jsonb_build_object('lat',p_station_lat,'lng',p_station_lng),
    'base_radius_m',250,'dynamic_radius',true
  )) returning id into v_id;
  return v_id;
end;$$;
grant execute on function public.start_seeker_endgame_v1(uuid,text,double precision,double precision) to anon,authenticated;

-- Keep Turntables in the Developer "Special engine cards" section.
create or replace function public.admin_list_cards_v3(p_password text)
returns table(
  card_key text,title text,description text,duration_seconds integer,
  card_kind text,effect_key text,value_int integer,cast_cost_minutes integer,
  cast_cost_kind text,cast_cost_text text,cast_cost_category text,enabled boolean,deck_count integer,
  special_engine boolean
)
language plpgsql security definer set search_path=public,extensions as $$
begin
  if not public._admin_password_ok(p_password) then perform pg_sleep(0.35);raise exception 'Invalid developer password.';end if;
  return query
  select c.card_key,c.title,c.description,c.duration_seconds,c.card_kind,c.effect_key,c.value_int,
         c.cast_cost_minutes,c.cast_cost_kind,c.cast_cost_text,c.cast_cost_category,c.enabled,c.deck_count,
         (c.effect_key in ('prosperous_home','duplicate','reshuffle_deck','time_trap','veto_question','turntables')) as special_engine
  from public.curse_cards c
  order by case when c.effect_key in ('prosperous_home','duplicate','reshuffle_deck','time_trap','veto_question','turntables') then 9
    when c.card_kind='time_bonus' then 1 when c.card_kind='curse' then 2 else 3 end,c.title,c.card_key;
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
  v_key=nullif(trim(coalesce(p_card_key,'')),'');if v_key is null then v_key='custom-'||replace(extensions.gen_random_uuid()::text,'-','');end if;
  select effect_key in ('prosperous_home','duplicate','reshuffle_deck','time_trap','veto_question','turntables') into v_special from public.curse_cards where card_key=v_key;
  if coalesce(v_special,false) then
    update public.curse_cards set title=trim(p_title),description=trim(p_description),deck_count=p_deck_count,enabled=(p_deck_count>0) where card_key=v_key;
    return v_key;
  end if;
  insert into public.curse_cards(card_key,title,description,duration_seconds,card_kind,effect_key,value_int,cast_cost_minutes,cast_cost_kind,cast_cost_text,cast_cost_category,enabled,deck_count)
  values(v_key,trim(p_title),trim(p_description),p_duration_seconds,p_card_kind,coalesce(nullif(trim(coalesce(p_effect_key,'')),''),'custom_rule'),p_value_int,
    case when p_cast_cost_kind='time' then p_cast_cost_minutes else 0 end,p_cast_cost_kind,case when p_cast_cost_kind='custom' then trim(p_cast_cost_text) else null end,
    case when p_cast_cost_kind='discard_category' then p_cast_cost_category else null end,(p_deck_count>0),p_deck_count)
  on conflict(card_key) do update set title=excluded.title,description=excluded.description,duration_seconds=excluded.duration_seconds,card_kind=excluded.card_kind,
    effect_key=excluded.effect_key,value_int=excluded.value_int,cast_cost_minutes=excluded.cast_cost_minutes,cast_cost_kind=excluded.cast_cost_kind,
    cast_cost_text=excluded.cast_cost_text,cast_cost_category=excluded.cast_cost_category,enabled=excluded.enabled,deck_count=excluded.deck_count;
  return v_key;
end;$$;
grant execute on function public.admin_save_card_v3(text,text,text,text,integer,text,text,integer,text,integer,text,text,integer) to anon,authenticated;
