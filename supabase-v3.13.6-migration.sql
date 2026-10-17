-- HideNSeek Vienna v3.13.6
-- Apply after supabase-v3.13.5-migration.sql.
-- Scoped changes: 90s live per-viewer VOR and 100m server-side automatic Time Traps.

-- Existing 3-minute VOR question catalogue entries also need the new limit:
-- changing the JS default alone would not override stored catalogue params.
update public.question_catalog
set params=jsonb_set(coalesce(params,'{}'::jsonb),'{duration_seconds}','90'::jsonb,true),
    description=case when description ilike '%3 minute%' or description ilike '%3 min%'
      then 'Endgame only: 90 seconds of a live 30 degree direction sector toward the hiding spot. No Hider answer is required.'
      else description end,
    updated_at=now()
where question_key='vor-navigation';

-- Enforce 90 seconds even for outdated clients or manually modified question params.
create or replace function public.activate_vor_navigation_v1(p_game_id uuid,p_question_action_id uuid)
returns timestamptz language plpgsql security definer set search_path=public,extensions as $$
declare v_q public.game_actions%rowtype;v_duration integer;v_expires timestamptz;v_cards jsonb;v_reloc_time timestamptz;v_rewardless_limit integer:=0;v_question_ordinal integer:=0;v_suppress boolean:=false;
begin
  if not exists(select 1 from public.games where id=p_game_id and status='active') then raise exception 'Game is not active.';end if;
  select * into v_q from public.game_actions where id=p_question_action_id and game_id=p_game_id and kind='question' and is_active;
  if v_q.id is null or v_q.payload->>'question_kind'<>'vor_navigation' then raise exception 'Question is not VOR Navigation.';end if;
  if not exists(select 1 from public.game_secrets where game_id=p_game_id and endgame and hidden_lat is not null and hidden_lng is not null) then raise exception 'VOR Navigation requires Endgame and an actual hiding spot.';end if;
  if exists(select 1 from public.game_actions where parent_id=p_question_action_id and kind in('answer','question_veto') and is_active) then select (payload->'answer'->>'expires_at')::timestamptz into v_expires from public.game_actions where parent_id=p_question_action_id and kind='answer' and is_active order by created_at desc limit 1;return v_expires;end if;
  v_duration:=least(90,greatest(30,coalesce(nullif(v_q.payload->>'duration_seconds','')::integer,90)));v_expires:=now()+make_interval(secs=>v_duration);
  select r.created_at,coalesce((r.payload->>'rewardless_questions')::integer,0) into v_reloc_time,v_rewardless_limit from public.game_actions r where r.game_id=p_game_id and r.kind='turntables_relocate' and r.is_active order by r.created_at desc limit 1;
  if v_reloc_time is not null and v_q.created_at>v_reloc_time then select count(*) into v_question_ordinal from public.game_actions q where q.game_id=p_game_id and q.kind='question' and q.is_active and q.created_at>v_reloc_time and (q.created_at<v_q.created_at or(q.created_at=v_q.created_at and q.id::text<=p_question_action_id::text));v_suppress:=v_question_ordinal between 1 and v_rewardless_limit;end if;
  insert into public.game_actions(game_id,actor,kind,parent_id,payload) values(p_game_id,'system','answer',p_question_action_id,jsonb_build_object('answer',jsonb_build_object('type','vor_navigation','status','active','expires_at',v_expires,'duration_seconds',v_duration),'auto_resolved',true,'reward_suppressed',v_suppress,'late_penalty_minutes',0));
  if not v_suppress and not exists(select 1 from public.curse_draws where question_action_id=p_question_action_id) then v_cards:=public._draw_cards_v4(p_game_id,4);if jsonb_array_length(v_cards)>0 then insert into public.curse_draws(game_id,question_action_id,cards,keep_limit) values(p_game_id,p_question_action_id,v_cards,least(2,jsonb_array_length(v_cards))) on conflict(question_action_id) do nothing;end if;end if;
  return v_expires;
end;$$;
grant execute on function public.activate_vor_navigation_v1(uuid,uuid) to anon,authenticated;

-- Keep the existing great-circle bearing formula and the private fresh-Hider-GPS
-- / secret-location fallback unchanged; change only the viewing Seeker origin.
create or replace function public.get_vor_navigation_bearing_v2(p_game_id uuid,p_question_action_id uuid,p_player_id uuid)
returns table(bearing_deg double precision,expires_at timestamptz)
language plpgsql security definer set search_path=public,extensions as $$
declare
  v_q public.game_actions%rowtype;v_answer jsonb;
  v_seeker_lat double precision;v_seeker_lng double precision;v_target_lat double precision;v_target_lng double precision;
  v_expires timestamptz;v_y double precision;v_x double precision;v_bearing double precision;
begin
  select * into v_q from public.game_actions where id=p_question_action_id and game_id=p_game_id and kind='question' and is_active and payload->>'question_kind'='vor_navigation';
  if v_q.id is null then return;end if;
  select a.payload->'answer' into v_answer from public.game_actions a where a.parent_id=p_question_action_id and a.kind='answer' and a.is_active order by a.created_at desc limit 1;
  if coalesce(v_answer->>'type','')<>'vor_navigation' then return;end if;
  v_expires:=(v_answer->>'expires_at')::timestamptz;if v_expires is null or now()>=v_expires then return;end if;

  -- Every viewing Seeker receives the bearing from THEIR fresh GPS, independently.
  -- Do not fall back to the question asker or a legacy shared Seeker row.
  if p_player_id is null then return;end if;
  select s.lat,s.lng into v_seeker_lat,v_seeker_lng
  from public.seeker_player_positions s
  join public.players p on p.id=s.player_id and p.enabled
  where s.game_id=p_game_id and s.player_id=p_player_id
    and s.source='gps' and s.updated_at>=now()-interval '20 seconds';
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
grant execute on function public.get_vor_navigation_bearing_v2(uuid,uuid,uuid) to anon,authenticated;

-- v3.13.5 already triggers automatically upon every GPS position publication.
-- Keep all existing accrual, manual-trigger, and turntables logic; enlarge only
-- the station proximity radius from 50 to 100 metres.
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

  -- Maintain the legacy shared row only for compatibility with historical games.
  insert into public.seeker_live_positions(game_id,lat,lng,accuracy_m,source,updated_at)
  values(p_game_id,p_lat,p_lng,p_accuracy_m,'gps',now())
  on conflict(game_id) do update set lat=excluded.lat,lng=excluded.lng,accuracy_m=excluded.accuracy_m,source='gps',updated_at=now();

  for v_trap in select * from public.time_traps
    where game_id=p_game_id and not trigger_active
    for update skip locked
  loop
    v_dist:=6371000*2*asin(sqrt(
      power(sin(radians(v_trap.station_lat-p_lat)/2),2)+
      cos(radians(p_lat))*cos(radians(v_trap.station_lat))*power(sin(radians(v_trap.station_lng-p_lng)/2),2)
    ));
    if v_dist<=100 then
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

update public.curse_cards
set description='Place on any station. Manual trigger: base 5 minutes. Automatic trigger when any Seeker comes within 100 m: 5-minute base + another 5 minutes per complete 10 real minutes armed.'
where effect_key='time_trap' and description='Place on any station. The trap starts at 5 minutes and gains 5 more minutes every 10 real minutes. Trigger it manually at any time, or it triggers automatically when any Seeker comes within 50 m.';

