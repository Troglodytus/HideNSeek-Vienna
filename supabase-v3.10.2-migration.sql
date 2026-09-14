-- Hide & Seek: Vienna v3.10.2
-- Same-line overlap preservation + interchange question.
-- Run ONCE after v3.10.1.

-- Allow the new editable question rule type.
alter table public.question_catalog drop constraint if exists question_catalog_question_kind_check;
alter table public.question_catalog add constraint question_catalog_question_kind_check
  check(question_kind in (
    'radar','district','district_set','landmark_compare','directional','same_line',
    'station_interchange','thermometer','tentacle','photo','street_shape'
  ));

insert into public.question_catalog(
  question_key,category,title,description,question_kind,params,endgame_only,enabled,sort_order
) values (
  'station-interchange','MIXED','Nearest Station an Interchange?',
  'Is the hiding station served by at least two U-/S-Bahn lines?',
  'station_interchange','{"radius_m":250}'::jsonb,false,true,25
)
on conflict(question_key) do update set
  category=excluded.category,
  title=excluded.title,
  description=excluded.description,
  question_kind=excluded.question_kind,
  params=excluded.params,
  endgame_only=excluded.endgame_only,
  enabled=excluded.enabled,
  sort_order=excluded.sort_order,
  updated_at=now();

create or replace function public.ask_question_v4(p_game_id uuid,p_slot_key text,p_kind text,p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare v_id uuid;
begin
  if p_kind not in ('radar','district','district_set','landmark_compare','directional','same_line','station_interchange','thermometer','tentacle','photo','street_shape') then
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

create or replace function public.admin_save_question_v1(
  p_password text,p_question_key text,p_category text,p_title text,p_description text,
  p_question_kind text,p_params jsonb,p_endgame_only boolean,p_enabled boolean,p_sort_order integer
) returns text
language plpgsql security definer set search_path=public,extensions as $$
declare v_key text;
begin
  if not public._admin_password_ok(p_password) then perform pg_sleep(0.35);raise exception 'Invalid developer password.';end if;
  if p_category not in ('MIXED','RADAR','THERMOMETER','TENTACLES','PHOTO') then raise exception 'Invalid question category.';end if;
  if p_question_kind not in ('radar','district','district_set','landmark_compare','directional','same_line','station_interchange','thermometer','tentacle','photo','street_shape') then raise exception 'Invalid question rule type.';end if;
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
