-- Hide & Seek: Vienna v3.11.2
-- Run once after v3.11.1.
-- QoL: Developer read-only game previews, Tentacle auto-veto rewards,
-- and Curse of the Passierschein A38.

-- ---------------------------------------------------------------------------
-- Developer read-only Hider snapshot. The developer password grants inspection
-- without disclosing or bypassing the Hider password for gameplay mutations.
-- ---------------------------------------------------------------------------
create or replace function public.admin_get_game_preview_v1(p_password text,p_game_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public,extensions
as $$
declare
  v_game jsonb;
  v_secret jsonb;
  v_draws jsonb;
  v_traps jsonb;
  v_private jsonb;
  v_live jsonb;
  v_deck jsonb;
begin
  if not public._admin_password_ok(p_password) then
    perform pg_sleep(0.35);
    raise exception 'Invalid developer password.';
  end if;

  select to_jsonb(g) into v_game from public.games g where g.id=p_game_id;
  if v_game is null then raise exception 'Game not found.'; end if;

  select jsonb_build_object(
    'hidden_lat',s.hidden_lat,'hidden_lng',s.hidden_lng,
    'station_lat',s.station_lat,'station_lng',s.station_lng,
    'station_name',s.station_name,'endgame',s.endgame,
    'base_radius_m',s.base_radius_m
  ) into v_secret
  from public.game_secrets s where s.game_id=p_game_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',d.id,'question_action_id',d.question_action_id,'cards',d.cards,
    'keep_limit',d.keep_limit,'kept_card_keys',d.kept_card_keys,
    'used_card_keys',d.used_card_keys,'created_at',d.created_at
  ) order by d.created_at),'[]'::jsonb)
  into v_draws from public.curse_draws d where d.game_id=p_game_id;

  select coalesce(jsonb_agg(to_jsonb(t) order by t.armed_at),'[]'::jsonb)
  into v_traps from public.time_traps t where t.game_id=p_game_id;

  select coalesce(jsonb_agg(to_jsonb(u) order by u.created_at),'[]'::jsonb)
  into v_private from public.private_card_uses u where u.game_id=p_game_id;

  select to_jsonb(l) into v_live from public.seeker_live_positions l where l.game_id=p_game_id;

  select jsonb_build_object(
    'cycle',c.cycle,
    'remaining',greatest(0,jsonb_array_length(c.deck)-c.cursor),
    'total',jsonb_array_length(c.deck)
  ) into v_deck from public.game_card_state c where c.game_id=p_game_id;

  return jsonb_build_object(
    'game',v_game,'secret',v_secret,'draws',coalesce(v_draws,'[]'::jsonb),
    'time_traps',coalesce(v_traps,'[]'::jsonb),
    'private_card_uses',coalesce(v_private,'[]'::jsonb),
    'seeker_live_position',v_live,'deck_status',v_deck
  );
end;$$;
grant execute on function public.admin_get_game_preview_v1(text,uuid) to anon,authenticated;

-- ---------------------------------------------------------------------------
-- Automatic Tentacle vetoes still earn the normal Tentacle reward (draw 4,
-- keep 2). The only exception is a Turntables no-reward question.
-- ---------------------------------------------------------------------------
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
  v_cards jsonb;
  v_question_time timestamptz;
  v_reloc_time timestamptz;
  v_rewardless_limit integer:=0;
  v_question_ordinal integer:=0;
  v_suppress boolean:=false;
begin
  if not public._hider_password_ok(p_game_id,p_password) then
    raise exception 'Invalid hider password.';
  end if;

  select payload,payload->>'title',payload->>'question_kind',
         coalesce((payload->>'valid_distance_m')::integer,250),created_at
  into v_payload,v_title,v_kind,v_limit,v_question_time
  from public.game_actions
  where id=p_question_action_id and game_id=p_game_id and kind='question' and is_active;

  if v_kind is null then raise exception 'Question is not active.'; end if;
  if v_kind<>'tentacle' then raise exception 'Automatic veto is only valid for Tentacle questions.'; end if;
  if exists(select 1 from public.game_actions where parent_id=p_question_action_id and kind in('answer','question_veto') and is_active) then
    raise exception 'Question already resolved.';
  end if;

  select r.created_at,coalesce((r.payload->>'rewardless_questions')::integer,0)
  into v_reloc_time,v_rewardless_limit
  from public.game_actions r
  where r.game_id=p_game_id and r.kind='turntables_relocate' and r.is_active
  order by r.created_at desc limit 1;
  if v_reloc_time is not null and v_question_time>v_reloc_time then
    select count(*) into v_question_ordinal from public.game_actions q
    where q.game_id=p_game_id and q.kind='question' and q.is_active and q.created_at>v_reloc_time
      and (q.created_at<v_question_time or (q.created_at=v_question_time and q.id::text<=p_question_action_id::text));
    v_suppress:=v_question_ordinal between 1 and v_rewardless_limit;
  end if;

  select endgame,hidden_lat,hidden_lng into v_endgame,v_target_lat,v_target_lng
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
      'automatic_tentacle',true,'question_title',coalesce(v_title,'Tentacle'),
      'valid_distance_m',v_limit,'radius_m',v_limit,'radar_miss',v_radar_miss,
      'reason',case when v_radar_miss then 'target_outside_tentacle_range' else 'no_candidate_pois' end,
      'resolved_at',v_now,'late_penalty_minutes',v_penalty,
      'reward_suppressed',v_suppress,'reward_suppressed_reason',case when v_suppress then 'turntables' else null end
    )
  ) returning id into v_id;

  if not v_suppress and not exists(select 1 from public.curse_draws where question_action_id=p_question_action_id) then
    v_cards:=public._draw_cards_v4(p_game_id,4);
    if jsonb_array_length(v_cards)>0 then
      insert into public.curse_draws(game_id,question_action_id,cards,keep_limit)
      values(p_game_id,p_question_action_id,v_cards,2)
      on conflict(question_action_id) do nothing;
    end if;
  end if;

  return v_id;
end;$$;
grant execute on function public.auto_veto_tentacle_v5(uuid,uuid,text) to anon,authenticated;

-- ---------------------------------------------------------------------------
-- Curse of the Passierschein A38. The card does not rewrite historical answers.
-- Instead it stores a public, temporary 50/50 flip mask over the currently
-- relevant map-affecting answered questions. The client uses that mask for ten
-- minutes and then automatically returns to the original deductions.
-- ---------------------------------------------------------------------------
insert into public.curse_cards(
  card_key,title,description,duration_seconds,card_kind,effect_key,value_int,
  cast_cost_minutes,cast_cost_kind,cast_cost_text,cast_cost_category,enabled,deck_count
) values (
  'passierschein-a38-vienna-1','Curse of the Passierschein A38',
  'For 10 minutes, each previous deduction answer has a 50% chance of being displayed as its opposite. The affected questions are marked in the Activity log until the curse expires.',
  600,'curse','passierschein_a38',null,0,'custom','The Hider must roll an odd number on a die.',null,true,1
) on conflict(card_key) do nothing;

create or replace function public.use_passierschein_a38_v1(p_game_id uuid,p_password text,p_card_key text)
returns uuid
language plpgsql
security definer
set search_path=public,extensions
as $$
declare
  v_card jsonb;
  v_id uuid;
  v_now timestamptz:=now();
  v_phase timestamptz:='-infinity'::timestamptz;
  v_t timestamptz;
  v_flipped jsonb:='[]'::jsonb;
begin
  if not public._hider_password_ok(p_game_id,p_password) then raise exception 'Invalid hider password.';end if;
  v_card:=public._get_held_card(p_game_id,p_card_key);
  if v_card is null or v_card->>'effect_key'<>'passierschein_a38' then raise exception 'Passierschein A38 is not available in hand.';end if;
  if exists(select 1 from public.game_actions a where a.game_id=p_game_id and a.kind='curse_play' and a.is_active and a.payload->>'effect_key'='passierschein_a38' and (a.payload->>'ends_at')::timestamptz>v_now) then
    raise exception 'Passierschein A38 is already active.';
  end if;

  select max(created_at) into v_t from public.game_actions where game_id=p_game_id and kind='turntables_relocate' and is_active;
  if v_t is not null then v_phase:=greatest(v_phase,v_t);end if;
  select max(created_at) into v_t from public.game_actions where game_id=p_game_id and kind='endgame_zone' and is_active;
  if v_t is not null then v_phase:=greatest(v_phase,v_t);end if;

  select coalesce(jsonb_agg(x.qid order by x.created_at),'[]'::jsonb) into v_flipped
  from (
    select q.id::text as qid,q.created_at
    from public.game_actions q
    join public.game_actions a on a.parent_id=q.id and a.kind='answer' and a.is_active
    where q.game_id=p_game_id and q.kind='question' and q.is_active and q.created_at>v_phase
      and q.payload->>'question_kind' in ('radar','district','district_set','landmark_compare','directional','same_line','station_interchange','thermometer','tentacle')
      and random()<0.5
  ) x;

  if not public._consume_held_card(p_game_id,p_card_key) then raise exception 'Could not consume Passierschein A38.';end if;

  insert into public.game_actions(game_id,actor,kind,payload)
  values(p_game_id,'hider','curse_play',jsonb_build_object(
    'source_card_key',p_card_key,'effect_key','passierschein_a38',
    'title',coalesce(v_card->>'title','Curse of the Passierschein A38'),
    'description',coalesce(v_card->>'description','Some previous deductions are temporarily wrong.'),
    'duration_seconds',600,'starts_at',v_now,'ends_at',v_now+interval '10 minutes',
    'cast_cost_kind','custom','cast_cost_text','The Hider must roll an odd number on a die.',
    'flipped_question_ids',v_flipped
  )) returning id into v_id;
  return v_id;
end;$$;
grant execute on function public.use_passierschein_a38_v1(uuid,text,text) to anon,authenticated;
