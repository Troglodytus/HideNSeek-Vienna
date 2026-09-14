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
