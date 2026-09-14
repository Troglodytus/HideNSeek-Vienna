-- Hide & Seek: Vienna v3.10.1
-- Duplicate hotfix: Duplicate now creates a genuine second held card instance.
-- Run once after v3.10.0.

-- Held-card lookup now also understands active virtual copies created by Duplicate.
create or replace function public._get_held_card(p_game_id uuid,p_card_key text)
returns jsonb language sql stable security definer set search_path=public as $$
  select q.card
  from (
    select e as card,1 as ord
    from public.curse_draws d
    cross join lateral jsonb_array_elements(d.cards) e
    where d.game_id=p_game_id
      and d.kept_card_keys ? p_card_key
      and not (d.used_card_keys ? p_card_key)
      and e->>'card_key'=p_card_key
    union all
    select u.metadata->'card' as card,2 as ord
    from public.private_card_uses u
    where u.game_id=p_game_id
      and u.effect_key='duplicate_copy'
      and u.is_active
      and u.card_key=p_card_key
      and jsonb_typeof(u.metadata->'card')='object'
  ) q
  order by q.ord
  limit 1;
$$;

-- Consuming a held card now consumes either an ordinary drawn card or a Duplicate copy.
create or replace function public._consume_held_card(p_game_id uuid,p_card_key text)
returns boolean language plpgsql security definer set search_path=public as $$
begin
  update public.curse_draws
  set used_card_keys=used_card_keys||jsonb_build_array(p_card_key)
  where game_id=p_game_id
    and kept_card_keys ? p_card_key
    and not (used_card_keys ? p_card_key);
  if found then return true; end if;

  update public.private_card_uses
  set is_active=false
  where game_id=p_game_id
    and effect_key='duplicate_copy'
    and card_key=p_card_key
    and is_active;
  return found;
end;$$;

-- Correct Duplicate behavior:
-- consume Duplicate itself, leave the source card untouched, and add a new independent
-- copy to the private Hider hand. The copied card is only played/spent later.
create or replace function public.use_duplicate_v1(
  p_game_id uuid,p_password text,p_duplicate_card_key text,p_copy_card_key text
) returns text
language plpgsql security definer set search_path=public,extensions as $$
declare
  v_duplicate jsonb;v_copy jsonb;v_new_key text;v_snapshot jsonb;v_id uuid;
begin
  if not public._hider_password_ok(p_game_id,p_password) then
    raise exception 'Invalid hider password.';
  end if;

  v_duplicate:=public._get_held_card(p_game_id,p_duplicate_card_key);
  if v_duplicate is null or v_duplicate->>'effect_key'<>'duplicate' then
    raise exception 'Duplicate card is not available in hand.';
  end if;
  if p_duplicate_card_key=p_copy_card_key then
    raise exception 'Duplicate cannot copy itself.';
  end if;

  v_copy:=public._get_held_card(p_game_id,p_copy_card_key);
  if v_copy is null then raise exception 'Card to copy is not available in hand.'; end if;
  if coalesce(v_copy->>'card_kind','') not in ('time_bonus','curse') then
    raise exception 'Duplicate currently supports time bonuses and curses.';
  end if;

  v_new_key:='duplicate-copy-'||gen_random_uuid()::text;
  v_snapshot:=v_copy||jsonb_build_object(
    'card_key',v_new_key,
    'duplicated_from',p_copy_card_key
  );

  if not public._consume_held_card(p_game_id,p_duplicate_card_key) then
    raise exception 'Could not consume Duplicate card.';
  end if;

  insert into public.private_card_uses(game_id,card_key,effect_key,value_int,metadata,is_active)
  values(
    p_game_id,v_new_key,'duplicate_copy',nullif(v_copy->>'value_int','')::integer,
    jsonb_build_object(
      'copied_card_key',p_copy_card_key,
      'copied_title',v_copy->>'title',
      'source_duplicate_card_key',p_duplicate_card_key,
      'card',v_snapshot
    ),true
  ) returning id into v_id;

  return v_new_key;
end;$$;
grant execute on function public.use_duplicate_v1(uuid,text,text,text) to anon,authenticated;

-- Final scoring now counts active duplicated time-bonus cards as ordinary held bonuses.
-- Legacy duplicate_bonus rows from pre-v3.10.1 games are still counted too.
create or replace function public.finish_game_v1(
  p_game_id uuid,p_actor text,p_password text default null
) returns table(
  raw_seconds bigint,held_bonus_minutes integer,trap_bonus_minutes integer,
  penalty_minutes integer,final_seconds bigint,finished_at timestamptz
)
language plpgsql security definer set search_path=public,extensions as $$
declare
  v_game public.games%rowtype;v_now timestamptz:=now();v_raw bigint;
  v_held integer:=0;v_dup integer:=0;v_virtual integer:=0;v_traps integer:=0;v_penalty integer:=0;v_final bigint;
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

  -- Backwards compatibility for copies created by the old Duplicate implementation.
  select coalesce(sum(value_int),0)::integer into v_dup from public.private_card_uses
  where game_id=p_game_id and effect_key='duplicate_bonus' and is_active;

  -- v3.10.1+: copied time cards are real held card instances.
  select coalesce(sum(coalesce(nullif(metadata->'card'->>'value_int','')::integer,0)),0)::integer into v_virtual
  from public.private_card_uses
  where game_id=p_game_id
    and effect_key='duplicate_copy'
    and is_active
    and metadata->'card'->>'card_kind'='time_bonus';

  select coalesce(sum(coalesce(bonus_minutes,base_bonus_minutes)),0)::integer into v_traps
  from public.time_traps where game_id=p_game_id and trigger_active;

  select coalesce(sum(coalesce(nullif(payload->>'late_penalty_minutes','')::integer,0)),0)::integer into v_penalty
  from public.game_actions where game_id=p_game_id and is_active and kind in('answer','question_veto');

  v_held:=v_held+v_dup+v_virtual;
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
