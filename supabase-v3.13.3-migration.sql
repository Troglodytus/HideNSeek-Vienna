-- Hide & Seek: Vienna v3.13.3
-- Performance-only migration.
-- Answers are now recorded immediately; heavy geometry may finish afterward and be linked
-- to the already-recorded answer so calculation time can never create a late-answer penalty.

create or replace function public.attach_answer_geometry_v1(
  p_game_id uuid,
  p_question_action_id uuid,
  p_answer_action_id uuid,
  p_password text,
  p_cache_key text,
  p_domain_signature text
) returns boolean
language plpgsql security definer set search_path=public,extensions as $$
declare v_kind text;
begin
  if not public._hider_password_ok(p_game_id,p_password) then raise exception 'Invalid hider password.';end if;

  if not exists(
    select 1 from public.game_geometry_cache c
    where c.game_id=p_game_id
      and c.question_action_id=p_question_action_id
      and c.cache_key=p_cache_key
      and c.domain_signature=p_domain_signature
  ) then raise exception 'Prepared geometry not found.';end if;

  if not exists(
    select 1 from public.game_actions a
    where a.id=p_answer_action_id
      and a.game_id=p_game_id
      and a.parent_id=p_question_action_id
      and a.kind='answer'
      and a.is_active
  ) then raise exception 'Active answer not found.';end if;

  update public.game_actions
  set payload=jsonb_set(
        jsonb_set(payload,'{answer,geometry_cache_key}',to_jsonb(p_cache_key),true),
        '{answer,geometry_domain_signature}',to_jsonb(p_domain_signature),true
      )
  where id=p_answer_action_id and game_id=p_game_id;

  select payload->>'question_kind' into v_kind
  from public.game_actions
  where id=p_question_action_id and game_id=p_game_id and kind='question';

  -- Bus source geometry is needed only until the final cached region has actually been linked.
  if v_kind='bus_line_tentacle' then
    update public.game_actions
    set payload=payload-'bus_features'-'domain_geometry'
    where id=p_question_action_id and game_id=p_game_id;
  end if;

  return true;
end;$$;

grant execute on function public.attach_answer_geometry_v1(uuid,uuid,uuid,text,text,text) to anon,authenticated;
