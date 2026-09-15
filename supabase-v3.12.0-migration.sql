-- Hide & Seek: Vienna v3.12.0
-- Replace Nearest Station / Current Street Shape with Nearest Bus Line + VOR Navigation.
-- Run ONCE after v3.11.2, then Developer -> Refresh districts + transit once so
-- vienna_transit_v1 contains the new busLines geometry alongside railLines.

create extension if not exists pgcrypto with schema extensions;

insert into public.question_catalog(question_key,category,title,description,question_kind,params,endgame_only,enabled,sort_order)
values(
  'station-interchange','TENTACLES','Nearest Bus Line',
  'Endgame only: among Vienna bus lines crossing or within 1 km of the remaining area, keep the area closest to the answered line.',
  'tentacle','{"engine_kind":"bus_line_tentacle","search_buffer_m":1000}'::jsonb,true,true,25
)
on conflict(question_key) do update set
  category=excluded.category,title=excluded.title,description=excluded.description,
  question_kind=excluded.question_kind,params=excluded.params,endgame_only=excluded.endgame_only,
  enabled=excluded.enabled,sort_order=excluded.sort_order;

insert into public.question_catalog(question_key,category,title,description,question_kind,params,endgame_only,enabled,sort_order)
values(
  'street-shape','MIXED','VOR Navigation',
  'Endgame only: 3 minutes of a live 30 degree direction sector toward the hiding spot. No Hider answer required.',
  'directional','{"engine_kind":"vor_navigation","duration_seconds":180}'::jsonb,true,true,30
)
on conflict(question_key) do update set
  category=excluded.category,title=excluded.title,description=excluded.description,
  question_kind=excluded.question_kind,params=excluded.params,endgame_only=excluded.endgame_only,
  enabled=excluded.enabled,sort_order=excluded.sort_order;

-- Preserve answer_question_v5 (late penalties, Turntables suppression and Tiny House)
-- for the bus-line Tentacle, then upgrade its normal 3-pick-1 reward to 4-pick-2.
create or replace function public.answer_bus_line_tentacle_v1(
  p_game_id uuid,p_question_action_id uuid,p_password text,p_answer jsonb
) returns uuid
language plpgsql security definer set search_path=public,extensions as $$
declare
  v_answer_id uuid;v_extra jsonb;v_kind text;
begin
  select payload->>'question_kind' into v_kind
  from public.game_actions
  where id=p_question_action_id and game_id=p_game_id and kind='question' and is_active;
  if v_kind is distinct from 'bus_line_tentacle' then raise exception 'Question is not a bus-line Tentacle.';end if;
  if coalesce(p_answer->>'type','')<>'bus_line_tentacle' or coalesce(p_answer->>'status','')<>'line' or nullif(trim(p_answer->>'line_ref'),'') is null then
    raise exception 'Invalid bus-line Tentacle answer.';
  end if;

  v_answer_id:=public.answer_question_v5(p_game_id,p_question_action_id,p_password,p_answer);

  -- Turntables reward suppression deliberately creates no draw row; leave that intact.
  if exists(select 1 from public.curse_draws where question_action_id=p_question_action_id) then
    v_extra:=public._draw_cards_v4(p_game_id,1);
    if jsonb_array_length(coalesce(v_extra,'[]'::jsonb))>0 then
      update public.curse_draws
      set cards=cards||v_extra,
          keep_limit=least(2,jsonb_array_length(cards||v_extra))
      where question_action_id=p_question_action_id;
    end if;
  end if;
  return v_answer_id;
end;$$;
grant execute on function public.answer_bus_line_tentacle_v1(uuid,uuid,text,jsonb) to anon,authenticated;

-- VOR is resolved by the server immediately: the Hider never receives an answer UI.
-- It still counts as a question for Turntables and receives the Tentacle reward (4 pick 2)
-- unless that question falls inside Turntables' rewardless window.
create or replace function public.activate_vor_navigation_v1(
  p_game_id uuid,p_question_action_id uuid
) returns timestamptz
language plpgsql security definer set search_path=public,extensions as $$
declare
  v_q public.game_actions%rowtype;v_duration integer;v_expires timestamptz;v_answer_id uuid;
  v_cards jsonb;v_reloc_time timestamptz;v_rewardless_limit integer:=0;v_question_ordinal integer:=0;v_suppress boolean:=false;
begin
  if not exists(select 1 from public.games where id=p_game_id and status='active') then raise exception 'Game is not active.';end if;
  select * into v_q from public.game_actions
  where id=p_question_action_id and game_id=p_game_id and kind='question' and is_active;
  if v_q.id is null or v_q.payload->>'question_kind'<>'vor_navigation' then raise exception 'Question is not VOR Navigation.';end if;
  if not exists(select 1 from public.game_secrets where game_id=p_game_id and endgame and hidden_lat is not null and hidden_lng is not null) then raise exception 'VOR Navigation requires Endgame.';end if;
  if exists(select 1 from public.game_actions where parent_id=p_question_action_id and kind in('answer','question_veto') and is_active) then
    select coalesce((payload->'answer'->>'expires_at')::timestamptz,v_q.created_at+interval '180 seconds') into v_expires
    from public.game_actions where parent_id=p_question_action_id and kind='answer' and is_active order by created_at desc limit 1;
    return v_expires;
  end if;

  v_duration:=least(300,greatest(30,coalesce(nullif(v_q.payload->>'duration_seconds','')::integer,180)));
  v_expires:=v_q.created_at+make_interval(secs=>v_duration);

  select r.created_at,coalesce((r.payload->>'rewardless_questions')::integer,0)
    into v_reloc_time,v_rewardless_limit
  from public.game_actions r
  where r.game_id=p_game_id and r.kind='turntables_relocate' and r.is_active
  order by r.created_at desc limit 1;
  if v_reloc_time is not null and v_q.created_at>v_reloc_time then
    select count(*) into v_question_ordinal from public.game_actions q
    where q.game_id=p_game_id and q.kind='question' and q.is_active and q.created_at>v_reloc_time
      and (q.created_at<v_q.created_at or (q.created_at=v_q.created_at and q.id::text<=p_question_action_id::text));
    v_suppress:=v_question_ordinal between 1 and v_rewardless_limit;
  end if;

  insert into public.game_actions(game_id,actor,kind,parent_id,payload)
  values(p_game_id,'system','answer',p_question_action_id,jsonb_build_object(
    'answer',jsonb_build_object('type','vor_navigation','status','active','expires_at',v_expires,'duration_seconds',v_duration),
    'auto_resolved',true,'reward_suppressed',v_suppress,'late_penalty_minutes',0
  )) returning id into v_answer_id;

  if not v_suppress and not exists(select 1 from public.curse_draws where question_action_id=p_question_action_id) then
    v_cards:=public._draw_cards_v4(p_game_id,4);
    if jsonb_array_length(v_cards)>0 then
      insert into public.curse_draws(game_id,question_action_id,cards,keep_limit)
      values(p_game_id,p_question_action_id,v_cards,least(2,jsonb_array_length(v_cards)))
      on conflict(question_action_id) do nothing;
    end if;
  end if;
  return v_expires;
end;$$;
grant execute on function public.activate_vor_navigation_v1(uuid,uuid) to anon,authenticated;

-- Return only the bearing, never the private target coordinates.
create or replace function public.get_vor_navigation_bearing_v1(
  p_game_id uuid,p_question_action_id uuid
) returns table(bearing_deg double precision,expires_at timestamptz)
language plpgsql security definer set search_path=public,extensions as $$
declare
  v_q public.game_actions%rowtype;v_answer jsonb;v_seeker_lat double precision;v_seeker_lng double precision;
  v_target_lat double precision;v_target_lng double precision;v_expires timestamptz;
  v_y double precision;v_x double precision;v_bearing double precision;
begin
  select * into v_q from public.game_actions
  where id=p_question_action_id and game_id=p_game_id and kind='question' and is_active and payload->>'question_kind'='vor_navigation';
  if v_q.id is null then return;end if;
  select a.payload->'answer' into v_answer from public.game_actions a
  where a.parent_id=p_question_action_id and a.kind='answer' and a.is_active
  order by a.created_at desc limit 1;
  if coalesce(v_answer->>'type','')<>'vor_navigation' then return;end if;
  v_expires:=(v_answer->>'expires_at')::timestamptz;if v_expires is null or now()>=v_expires then return;end if;

  select lat,lng into v_seeker_lat,v_seeker_lng from public.seeker_live_positions where game_id=p_game_id;
  if v_seeker_lat is null or v_seeker_lng is null then return;end if;
  select hidden_lat,hidden_lng into v_target_lat,v_target_lng from public.game_secrets
  where game_id=p_game_id and endgame and hidden_lat is not null and hidden_lng is not null;
  if v_target_lat is null or v_target_lng is null then return;end if;

  v_y:=sin(radians(v_target_lng-v_seeker_lng))*cos(radians(v_target_lat));
  v_x:=cos(radians(v_seeker_lat))*sin(radians(v_target_lat))
       -sin(radians(v_seeker_lat))*cos(radians(v_target_lat))*cos(radians(v_target_lng-v_seeker_lng));
  v_bearing:=degrees(atan2(v_y,v_x));if v_bearing<0 then v_bearing:=v_bearing+360;end if;
  return query select v_bearing,v_expires;
end;$$;
grant execute on function public.get_vor_navigation_bearing_v1(uuid,uuid) to anon,authenticated;
