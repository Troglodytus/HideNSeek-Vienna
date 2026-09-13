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
