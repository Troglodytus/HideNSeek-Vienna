-- Hide & Seek: Vienna v3.13.4
-- Narrow feature migration: live/private Hider VOR position, configurable draw/keep
-- power-up templates, and default Kleingedrucktes text. Run once after v3.13.3.

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- VOR: optional private live Hider GPS. There is deliberately no SELECT policy.
-- Seekers can only obtain the derived bearing through the security-definer RPC.
-- If the Hider GPS is stale/unavailable the secret Endgame hiding point remains
-- the automatic fallback, so VOR never stops working merely because Hider GPS sleeps.
-- ---------------------------------------------------------------------------
create table if not exists public.hider_vor_live_positions(
  game_id uuid primary key references public.games(id) on delete cascade,
  question_action_id uuid not null references public.game_actions(id) on delete cascade,
  lat double precision not null check(lat between -90 and 90),
  lng double precision not null check(lng between -180 and 180),
  accuracy_m double precision,
  updated_at timestamptz not null default now()
);
alter table public.hider_vor_live_positions enable row level security;
revoke all on public.hider_vor_live_positions from anon,authenticated;

create or replace function public.set_hider_vor_live_position_v1(
  p_game_id uuid,p_question_action_id uuid,p_password text,
  p_lat double precision,p_lng double precision,p_accuracy_m double precision default null
) returns boolean
language plpgsql security definer set search_path=public,extensions as $$
begin
  if not public._hider_password_ok(p_game_id,p_password) then raise exception 'Invalid hider password.';end if;
  if p_lat not between -90 and 90 or p_lng not between -180 and 180 then raise exception 'Invalid Hider GPS coordinate.';end if;
  if not exists(
    select 1
    from public.game_actions q
    join public.game_actions a on a.parent_id=q.id and a.kind='answer' and a.is_active
    where q.id=p_question_action_id and q.game_id=p_game_id and q.kind='question' and q.is_active
      and q.payload->>'question_kind'='vor_navigation'
      and a.payload#>>'{answer,type}'='vor_navigation'
      and nullif(a.payload#>>'{answer,expires_at}','')::timestamptz>now()
  ) then raise exception 'VOR Navigation is not active.';end if;

  insert into public.hider_vor_live_positions(game_id,question_action_id,lat,lng,accuracy_m,updated_at)
  values(p_game_id,p_question_action_id,p_lat,p_lng,p_accuracy_m,now())
  on conflict(game_id) do update set question_action_id=excluded.question_action_id,lat=excluded.lat,lng=excluded.lng,
    accuracy_m=excluded.accuracy_m,updated_at=now();
  return true;
end;$$;
grant execute on function public.set_hider_vor_live_position_v1(uuid,uuid,text,double precision,double precision,double precision) to anon,authenticated;

create or replace function public.get_vor_navigation_bearing_v1(p_game_id uuid,p_question_action_id uuid)
returns table(bearing_deg double precision,expires_at timestamptz)
language plpgsql security definer set search_path=public,extensions as $$
declare
  v_q public.game_actions%rowtype;v_answer jsonb;
  v_seeker_lat double precision;v_seeker_lng double precision;
  v_target_lat double precision;v_target_lng double precision;
  v_expires timestamptz;v_y double precision;v_x double precision;v_bearing double precision;
begin
  select * into v_q from public.game_actions
  where id=p_question_action_id and game_id=p_game_id and kind='question' and is_active
    and payload->>'question_kind'='vor_navigation';
  if v_q.id is null then return;end if;

  select a.payload->'answer' into v_answer from public.game_actions a
  where a.parent_id=p_question_action_id and a.kind='answer' and a.is_active
  order by a.created_at desc limit 1;
  if coalesce(v_answer->>'type','')<>'vor_navigation' then return;end if;
  v_expires:=(v_answer->>'expires_at')::timestamptz;
  if v_expires is null or now()>=v_expires then return;end if;

  select lat,lng into v_seeker_lat,v_seeker_lng from public.seeker_live_positions where game_id=p_game_id and updated_at>=now()-interval '20 seconds';
  if v_seeker_lat is null or v_seeker_lng is null then
    v_seeker_lat:=nullif(v_q.payload#>>'{origin,lat}','')::double precision;
    v_seeker_lng:=nullif(v_q.payload#>>'{origin,lng}','')::double precision;
  end if;
  if v_seeker_lat is null or v_seeker_lng is null then return;end if;

  -- Prefer a fresh private Hider GPS fix for this exact VOR question. Never return it.
  select h.lat,h.lng into v_target_lat,v_target_lng
  from public.hider_vor_live_positions h
  where h.game_id=p_game_id and h.question_action_id=p_question_action_id
    and h.updated_at>=now()-interval '20 seconds';

  -- GPS is optional: the still-secret Endgame hiding point is the safe fallback.
  if v_target_lat is null or v_target_lng is null then
    select hidden_lat,hidden_lng into v_target_lat,v_target_lng
    from public.game_secrets where game_id=p_game_id and endgame and hidden_lat is not null and hidden_lng is not null;
  end if;
  if v_target_lat is null or v_target_lng is null then return;end if;

  v_y:=sin(radians(v_target_lng-v_seeker_lng))*cos(radians(v_target_lat));
  v_x:=cos(radians(v_seeker_lat))*sin(radians(v_target_lat))
      -sin(radians(v_seeker_lat))*cos(radians(v_target_lat))*cos(radians(v_target_lng-v_seeker_lng));
  v_bearing:=degrees(atan2(v_y,v_x));if v_bearing<0 then v_bearing:=v_bearing+360;end if;
  return query select v_bearing,v_expires;
end;$$;
grant execute on function public.get_vor_navigation_bearing_v1(uuid,uuid) to anon,authenticated;

-- ---------------------------------------------------------------------------
-- Draw/keep power-up template. Existing Same Day Delivery stays 3/2. A second
-- Economy Delivery instance is 3/1. Both use the same server engine and retain
-- normal casting-cost types from the existing card system.
-- ---------------------------------------------------------------------------
alter table public.curse_cards add column if not exists draw_count integer;
alter table public.curse_cards add column if not exists keep_limit integer;
alter table public.curse_cards drop constraint if exists curse_cards_draw_count_check;
alter table public.curse_cards add constraint curse_cards_draw_count_check check(draw_count is null or draw_count between 1 and 10);
alter table public.curse_cards drop constraint if exists curse_cards_keep_limit_check;
alter table public.curse_cards add constraint curse_cards_keep_limit_check check(keep_limit is null or keep_limit between 1 and 10);
alter table public.curse_cards drop constraint if exists curse_cards_draw_keep_check;
alter table public.curse_cards add constraint curse_cards_draw_keep_check check(draw_count is null or keep_limit is null or keep_limit<=draw_count);

update public.curse_cards
set draw_count=coalesce(draw_count,3),keep_limit=coalesce(keep_limit,2)
where effect_key='same_day_delivery';

insert into public.curse_cards(
  card_key,title,description,duration_seconds,card_kind,effect_key,value_int,
  cast_cost_minutes,cast_cost_kind,cast_cost_text,cast_cost_category,enabled,deck_count,draw_count,keep_limit
) values (
  'economy-delivery-vienna-1','Economy Delivery','Draw 3 cards immediately and keep 1.',null,
  'powerup','same_day_delivery',null,10,'time',null,null,true,1,3,1
) on conflict(card_key) do nothing;

-- New draw snapshots retain the template parameters so already-drawn cards keep
-- their own rules even when the Developer changes the catalogue later.
create or replace function public._draw_cards_v4(p_game_id uuid,p_count integer)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare
  v_result jsonb:='[]'::jsonb;v_state public.game_card_state%rowtype;
  v_instance_key text;v_catalog_key text;v_card public.curse_cards%rowtype;
begin
  if p_count<=0 then return v_result;end if;
  if not exists(select 1 from public.game_card_state where game_id=p_game_id) then perform public._reshuffle_card_deck_v1(p_game_id);end if;
  while jsonb_array_length(v_result)<p_count loop
    select * into v_state from public.game_card_state where game_id=p_game_id for update;
    if v_state.cursor>=jsonb_array_length(v_state.deck) then
      perform public._reshuffle_card_deck_v1(p_game_id);
      select * into v_state from public.game_card_state where game_id=p_game_id for update;
      if jsonb_array_length(v_state.deck)=0 then exit;end if;
    end if;
    v_instance_key:=v_state.deck->>v_state.cursor;
    update public.game_card_state set cursor=cursor+1,updated_at=now() where game_id=p_game_id;
    v_catalog_key:=split_part(v_instance_key,'::',1);
    select * into v_card from public.curse_cards where card_key=v_catalog_key and enabled and deck_count>0;
    if found then
      v_result:=v_result||jsonb_build_array(jsonb_build_object(
        'card_key',v_instance_key,'catalog_key',v_card.card_key,'title',v_card.title,'description',v_card.description,
        'duration_seconds',v_card.duration_seconds,'card_kind',v_card.card_kind,'effect_key',v_card.effect_key,'value_int',v_card.value_int,
        'cast_cost_minutes',v_card.cast_cost_minutes,'cast_cost_kind',v_card.cast_cost_kind,
        'cast_cost_text',v_card.cast_cost_text,'cast_cost_category',v_card.cast_cost_category,
        'draw_count',v_card.draw_count,'keep_limit',v_card.keep_limit));
    end if;
  end loop;
  return v_result;
end;$$;

create or replace function public.admin_list_cards_v5(p_password text)
returns table(
  card_key text,title text,description text,duration_seconds integer,
  card_kind text,effect_key text,value_int integer,cast_cost_minutes integer,
  cast_cost_kind text,cast_cost_text text,cast_cost_category text,enabled boolean,deck_count integer,
  draw_count integer,keep_limit integer,
  secondary_effect_mode text,secondary_effect_text text,secondary_engine_key text,secondary_engine_payload jsonb,
  special_engine boolean
)
language plpgsql security definer set search_path=public,extensions as $$
begin
  if not public._admin_password_ok(p_password) then perform pg_sleep(0.35);raise exception 'Invalid developer password.';end if;
  return query
  select c.card_key,c.title,c.description,c.duration_seconds,c.card_kind,c.effect_key,c.value_int,
         c.cast_cost_minutes,c.cast_cost_kind,c.cast_cost_text,c.cast_cost_category,c.enabled,c.deck_count,
         c.draw_count,c.keep_limit,
         coalesce(s.effect_mode,'none'),s.effect_text,s.engine_key,coalesce(s.engine_payload,'{}'::jsonb),
         (c.effect_key in (
           'prosperous_home','duplicate','reshuffle_deck','time_trap','veto_question','turntables',
           'double_or_nothing','ma48','kleingedrucktes','same_day_delivery','deceptive_tiny_house'
         )) as special_engine
  from public.curse_cards c
  left join public.card_secondary_effects s on s.card_key=c.card_key
  order by case when c.effect_key in (
      'prosperous_home','duplicate','reshuffle_deck','time_trap','veto_question','turntables',
      'double_or_nothing','ma48','kleingedrucktes','same_day_delivery','deceptive_tiny_house'
    ) then 9 when c.card_kind='time_bonus' then 1 when c.card_kind='curse' then 2 else 3 end,
    c.title,c.card_key;
end;$$;
grant execute on function public.admin_list_cards_v5(text) to anon,authenticated;

-- Wrapper keeps v4 behavior for every other card. Only the draw/keep engine gets
-- its template parameters and ordinary casting fields opened for editing.
create or replace function public.admin_save_card_v5(
  p_password text,p_card_key text,p_title text,p_description text,
  p_duration_seconds integer,p_card_kind text,p_effect_key text,p_value_int integer,
  p_cast_cost_kind text,p_cast_cost_minutes integer,p_cast_cost_text text,p_cast_cost_category text,
  p_deck_count integer,p_secondary_effect_mode text,p_secondary_effect_text text,
  p_secondary_engine_key text,p_secondary_engine_payload jsonb,p_draw_count integer,p_keep_limit integer
) returns text
language plpgsql security definer set search_path=public,extensions as $$
declare v_key text;v_effect text;
begin
  v_key:=public.admin_save_card_v4(
    p_password,p_card_key,p_title,p_description,p_duration_seconds,p_card_kind,p_effect_key,p_value_int,
    p_cast_cost_kind,p_cast_cost_minutes,p_cast_cost_text,p_cast_cost_category,p_deck_count,
    p_secondary_effect_mode,p_secondary_effect_text,p_secondary_engine_key,p_secondary_engine_payload
  );
  select effect_key into v_effect from public.curse_cards where card_key=v_key;
  if v_effect='same_day_delivery' then
    if coalesce(p_draw_count,0) not between 1 and 10 then raise exception 'Cards drawn must be 1-10.';end if;
    if coalesce(p_keep_limit,0) not between 1 and p_draw_count then raise exception 'Cards kept must be between 1 and cards drawn.';end if;
    update public.curse_cards set
      draw_count=p_draw_count,keep_limit=p_keep_limit,
      cast_cost_minutes=case when p_cast_cost_kind='time' then p_cast_cost_minutes else 0 end,
      cast_cost_kind=p_cast_cost_kind,
      cast_cost_text=case when p_cast_cost_kind='custom' then nullif(trim(coalesce(p_cast_cost_text,'')),'') else null end,
      cast_cost_category=case when p_cast_cost_kind='discard_category' then p_cast_cost_category else null end
    where card_key=v_key;
  end if;
  return v_key;
end;$$;
grant execute on function public.admin_save_card_v5(text,text,text,text,integer,text,text,integer,text,integer,text,text,integer,text,text,text,jsonb,integer,integer) to anon,authenticated;

create or replace function public.use_same_day_delivery_v1(
  p_game_id uuid,p_password text,p_card_key text,p_cost_card_keys text[]
) returns uuid
language plpgsql security definer set search_path=public,extensions as $$
declare
  v_card jsonb;v_key text;v_pay jsonb;v_paid integer:=0;v_action uuid;v_cards jsonb;
  v_draw integer;v_keep integer;v_cost integer;v_cost_kind text;v_cost_category text;v_title text;
begin
  if not public._hider_password_ok(p_game_id,p_password) then raise exception 'Invalid hider password.';end if;
  v_card:=public._get_held_card(p_game_id,p_card_key);
  if v_card is null or v_card->>'effect_key'<>'same_day_delivery' then raise exception 'Draw/keep delivery card is not in your hand.';end if;
  v_draw:=least(10,greatest(1,coalesce(nullif(v_card->>'draw_count','')::integer,3)));
  v_keep:=least(v_draw,greatest(1,coalesce(nullif(v_card->>'keep_limit','')::integer,2)));
  v_cost:=coalesce(nullif(v_card->>'cast_cost_minutes','')::integer,0);
  v_cost_kind:=coalesce(nullif(v_card->>'cast_cost_kind',''),case when v_cost>0 then 'time' else 'none' end);
  v_cost_category:=nullif(v_card->>'cast_cost_category','');v_title:=coalesce(v_card->>'title','Delivery');

  if v_cost_kind='time' and v_cost>0 then
    if coalesce(array_length(p_cost_card_keys,1),0)=0 then raise exception 'Choose time-bonus cards to pay the casting cost.';end if;
    foreach v_key in array p_cost_card_keys loop
      if v_key=p_card_key then raise exception 'The power-up cannot pay for itself.';end if;
      v_pay:=public._get_held_card(p_game_id,v_key);
      if v_pay is null or v_pay->>'card_kind'<>'time_bonus' then raise exception 'Casting cost must be paid with held time bonuses.';end if;
      v_paid:=v_paid+coalesce((v_pay->>'value_int')::integer,0);
    end loop;
    if v_paid<v_cost then raise exception 'Selected time bonuses do not cover the casting cost.';end if;
  elsif v_cost_kind in('discard_any','discard_category') then
    if coalesce(array_length(p_cost_card_keys,1),0)<>1 then raise exception 'Choose exactly one other held card to discard.';end if;
    v_key:=p_cost_card_keys[1];if v_key=p_card_key then raise exception 'The power-up cannot discard itself.';end if;
    v_pay:=public._get_held_card(p_game_id,v_key);if v_pay is null then raise exception 'Casting-cost card is not available in hand.';end if;
    if v_cost_kind='discard_category' and not public._held_card_matches_category(v_pay,v_cost_category) then raise exception 'Selected card does not match the required discard category.';end if;
  end if;

  perform public._consume_held_card(p_game_id,p_card_key);
  foreach v_key in array coalesce(p_cost_card_keys,array[]::text[]) loop perform public._consume_held_card(p_game_id,v_key);end loop;
  insert into public.game_actions(game_id,actor,kind,payload)
  values(p_game_id,'hider','powerup_draw',jsonb_build_object(
    'effect_key','same_day_delivery','title',v_title,'draw_count',v_draw,'keep_limit',v_keep,
    'cast_cost_kind',v_cost_kind,'cast_paid_minutes',v_paid,'cast_cost_text',v_card->>'cast_cost_text'
  )) returning id into v_action;
  v_cards:=public._draw_cards_v4(p_game_id,v_draw);
  if jsonb_array_length(v_cards)>0 then
    insert into public.curse_draws(game_id,question_action_id,cards,keep_limit)
    values(p_game_id,v_action,v_cards,least(v_keep,jsonb_array_length(v_cards)));
  end if;
  return v_action;
end;$$;
grant execute on function public.use_same_day_delivery_v1(uuid,text,text,text[]) to anon,authenticated;

-- ---------------------------------------------------------------------------
-- Default thematic Kleingedrucktes. Populate only untouched/empty fine print;
-- never overwrite a Developer-authored secondary effect.
-- ---------------------------------------------------------------------------
with defaults(effect_key,effect_text) as (values
  ('fiaker','Kleingedrucktes: Until a Fiaker is spotted, all Seekers must stay within 50 m of one another. In return, the Hider may not play another Curse while this Curse is active.'),
  ('broken_lift','Kleingedrucktes: The Hider is subject to the same lift/escalator restriction for the duration. Accessibility needs always override this clause.'),
  ('haute_vollee','Kleingedrucktes: While the forbidden districts rule is active, the Hider may not play another Curse. Seekers already inside a forbidden district when this is revealed may take the shortest reasonable route out.'),
  ('mordor_curse','Kleingedrucktes: The Danube-side restriction still applies, but the Hider may not play Curse of the Turntables while Mordor is active.'),
  ('schwarzkappler','Kleingedrucktes: Until the required ticket is bought, the Seekers may not split up. Once it is bought, the Hider may not play another Curse for 5 minutes.'),
  ('wiener_grantler','Kleingedrucktes: Before the next question, every Seeker must make one audible complaint about Vienna. That next question may not be vetoed by the Hider.')
)
insert into public.card_secondary_effects(card_key,effect_mode,effect_text,engine_key,engine_payload,updated_at)
select c.card_key,'custom',d.effect_text,null,'{}'::jsonb,now()
from public.curse_cards c join defaults d on d.effect_key=c.effect_key
on conflict(card_key) do update set effect_mode='custom',effect_text=excluded.effect_text,engine_key=null,engine_payload='{}'::jsonb,updated_at=now()
where public.card_secondary_effects.effect_mode='none'
  and coalesce(public.card_secondary_effects.effect_text,'')=''
  and public.card_secondary_effects.engine_key is null;
