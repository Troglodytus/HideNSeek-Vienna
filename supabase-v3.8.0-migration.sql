-- Hide & Seek: Vienna v3.8.0
-- Developer card catalogue + editable/custom casting costs.

alter table public.curse_cards add column if not exists cast_cost_kind text not null default 'none';
alter table public.curse_cards add column if not exists cast_cost_text text;
alter table public.curse_cards add column if not exists enabled boolean not null default true;

alter table public.curse_cards drop constraint if exists curse_cards_cast_cost_kind_check;
alter table public.curse_cards add constraint curse_cards_cast_cost_kind_check
  check (cast_cost_kind in ('none','time','custom'));

update public.curse_cards
set cast_cost_kind=case when coalesce(cast_cost_minutes,0)>0 then 'time' else 'none' end
where cast_cost_kind='none' and coalesce(cast_cost_minutes,0)>0;

create or replace function public.admin_list_cards_v1(p_password text)
returns table(
  card_key text,
  title text,
  description text,
  duration_seconds integer,
  card_kind text,
  effect_key text,
  value_int integer,
  cast_cost_minutes integer,
  cast_cost_kind text,
  cast_cost_text text,
  enabled boolean
)
language plpgsql security definer set search_path=public,extensions as $$
begin
  if not public._admin_password_ok(p_password) then
    perform pg_sleep(0.35);
    raise exception 'Invalid developer password.';
  end if;
  return query
  select c.card_key,c.title,c.description,c.duration_seconds,c.card_kind,c.effect_key,c.value_int,
         c.cast_cost_minutes,c.cast_cost_kind,c.cast_cost_text,c.enabled
  from public.curse_cards c
  order by case c.card_kind when 'time_bonus' then 1 when 'powerup' then 2 when 'time_trap' then 3 else 4 end,
           c.title,c.card_key;
end;$$;

grant execute on function public.admin_list_cards_v1(text) to anon,authenticated;

create or replace function public.admin_save_card_v1(
  p_password text,
  p_card_key text,
  p_title text,
  p_description text,
  p_duration_seconds integer,
  p_card_kind text,
  p_effect_key text,
  p_value_int integer,
  p_cast_cost_kind text,
  p_cast_cost_minutes integer,
  p_cast_cost_text text,
  p_enabled boolean
) returns text
language plpgsql security definer set search_path=public,extensions as $$
declare v_key text;
begin
  if not public._admin_password_ok(p_password) then
    perform pg_sleep(0.35);
    raise exception 'Invalid developer password.';
  end if;
  if char_length(trim(coalesce(p_title,''))) not between 1 and 120 then raise exception 'Card title must be 1-120 characters.'; end if;
  if char_length(trim(coalesce(p_description,''))) not between 1 and 1200 then raise exception 'Card text must be 1-1200 characters.'; end if;
  if p_card_kind not in ('curse','powerup','time_bonus','time_trap') then raise exception 'Invalid card type.'; end if;
  if p_cast_cost_kind not in ('none','time','custom') then raise exception 'Invalid casting-cost type.'; end if;
  if p_duration_seconds is not null and p_duration_seconds<0 then raise exception 'Invalid duration.'; end if;
  if p_cast_cost_kind='time' and (coalesce(p_cast_cost_minutes,0)<=0 or p_cast_cost_minutes%5<>0 or p_cast_cost_minutes>120) then raise exception 'Time casting cost must be 5-120 minutes in 5-minute steps.'; end if;
  if p_cast_cost_kind='custom' and char_length(trim(coalesce(p_cast_cost_text,'')))<1 then raise exception 'Enter the custom casting cost.'; end if;

  v_key=nullif(trim(coalesce(p_card_key,'')),'');
  if v_key is null then v_key='custom-'||replace(gen_random_uuid()::text,'-',''); end if;

  insert into public.curse_cards(card_key,title,description,duration_seconds,card_kind,effect_key,value_int,cast_cost_minutes,cast_cost_kind,cast_cost_text,enabled)
  values(
    v_key,trim(p_title),trim(p_description),p_duration_seconds,p_card_kind,
    coalesce(nullif(trim(coalesce(p_effect_key,'')),''),'custom_rule'),p_value_int,
    case when p_cast_cost_kind='time' then p_cast_cost_minutes else 0 end,
    p_cast_cost_kind,case when p_cast_cost_kind='custom' then trim(p_cast_cost_text) else null end,
    coalesce(p_enabled,true)
  )
  on conflict(card_key) do update set
    title=excluded.title,description=excluded.description,duration_seconds=excluded.duration_seconds,
    card_kind=excluded.card_kind,effect_key=excluded.effect_key,value_int=excluded.value_int,
    cast_cost_minutes=excluded.cast_cost_minutes,cast_cost_kind=excluded.cast_cost_kind,
    cast_cost_text=excluded.cast_cost_text,enabled=excluded.enabled;
  return v_key;
end;$$;

grant execute on function public.admin_save_card_v1(text,text,text,text,integer,text,text,integer,text,integer,text,boolean) to anon,authenticated;

create or replace function public.admin_delete_card_v1(p_password text,p_card_key text)
returns boolean language plpgsql security definer set search_path=public,extensions as $$
begin
  if not public._admin_password_ok(p_password) then
    perform pg_sleep(0.35);
    raise exception 'Invalid developer password.';
  end if;
  delete from public.curse_cards where card_key=p_card_key;
  return found;
end;$$;

grant execute on function public.admin_delete_card_v1(text,text) to anon,authenticated;

-- Future reshuffles use only enabled catalogue cards.
create or replace function public._reshuffle_card_deck_v1(p_game_id uuid)
returns integer language plpgsql security definer set search_path=public as $$
declare v_deck jsonb;v_cycle integer;
begin
  select coalesce(jsonb_agg(c.card_key order by random()),'[]'::jsonb) into v_deck
  from public.curse_cards c
  where c.enabled
    and not exists(
      select 1 from public.curse_draws d
      where d.game_id=p_game_id and d.kept_card_keys ? c.card_key and not(d.used_card_keys ? c.card_key)
    );
  insert into public.game_card_state(game_id,cycle,deck,cursor,updated_at)
  values(p_game_id,1,v_deck,0,now())
  on conflict(game_id) do update set cycle=public.game_card_state.cycle+1,deck=excluded.deck,cursor=0,updated_at=now()
  returning cycle into v_cycle;
  return v_cycle;
end;$$;

create or replace function public._draw_cards_v4(p_game_id uuid,p_count integer)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_result jsonb:='[]'::jsonb;v_state public.game_card_state%rowtype;v_key text;v_card public.curse_cards%rowtype;
begin
  if p_count<=0 then return v_result; end if;
  if not exists(select 1 from public.game_card_state where game_id=p_game_id) then perform public._reshuffle_card_deck_v1(p_game_id); end if;
  while jsonb_array_length(v_result)<p_count loop
    select * into v_state from public.game_card_state where game_id=p_game_id for update;
    if v_state.cursor>=jsonb_array_length(v_state.deck) then
      perform public._reshuffle_card_deck_v1(p_game_id);
      select * into v_state from public.game_card_state where game_id=p_game_id for update;
      if jsonb_array_length(v_state.deck)=0 then exit; end if;
    end if;
    v_key:=v_state.deck->>v_state.cursor;
    update public.game_card_state set cursor=cursor+1,updated_at=now() where game_id=p_game_id;
    select * into v_card from public.curse_cards where card_key=v_key and enabled;
    if found then
      v_result:=v_result||jsonb_build_array(jsonb_build_object(
        'card_key',v_card.card_key,'title',v_card.title,'description',v_card.description,
        'duration_seconds',v_card.duration_seconds,'card_kind',v_card.card_kind,
        'effect_key',v_card.effect_key,'value_int',v_card.value_int,
        'cast_cost_minutes',v_card.cast_cost_minutes,'cast_cost_kind',v_card.cast_cost_kind,
        'cast_cost_text',v_card.cast_cost_text));
    end if;
  end loop;
  return v_result;
end;$$;

-- Keep automatic time-bonus payment for time costs; custom casting costs are
-- displayed and socially enforced rather than consuming time cards.
create or replace function public.play_card_v4(p_game_id uuid,p_password text,p_card_key text,p_copy_card_key text default null,p_cost_card_keys text[] default array[]::text[])
returns uuid language plpgsql security definer set search_path=public,extensions as $$
declare v_card jsonb;v_copy jsonb;v_effect text;v_kind text;v_duration integer;v_now timestamptz:=now();v_id uuid;v_title text;v_desc text;v_value integer;v_cost integer:=0;v_paid integer:=0;v_key text;v_pay jsonb;v_cost_kind text;v_cost_text text;
begin
  if not public._hider_password_ok(p_game_id,p_password) then raise exception 'Invalid hider password.';end if;
  v_card:=public._get_held_card(p_game_id,p_card_key);if v_card is null then raise exception 'Card is not available in hand.';end if;
  v_effect:=v_card->>'effect_key';v_kind:=v_card->>'card_kind';
  if v_effect='duplicate' then
    if p_copy_card_key is null then raise exception 'Choose a card to duplicate.';end if;
    v_copy:=public._get_held_card(p_game_id,p_copy_card_key);if v_copy is null then raise exception 'Duplicate target is not available.';end if;
    if v_copy->>'card_kind'='time_bonus' then
      perform public._consume_held_card(p_game_id,p_card_key);
      insert into public.private_card_uses(game_id,card_key,effect_key,value_int,metadata) values(p_game_id,p_card_key,'duplicate_bonus',(v_copy->>'value_int')::integer,jsonb_build_object('copied_card_key',p_copy_card_key,'copied_title',v_copy->>'title')) returning id into v_id;return v_id;
    elsif v_copy->>'card_kind'='curse' then v_card:=v_copy;v_effect:=v_copy->>'effect_key';v_kind:='curse';
    else raise exception 'Duplicate currently supports time bonuses and curses.';end if;
  elsif v_kind<>'curse' then raise exception 'This card is used elsewhere in the interface.';end if;

  v_cost:=coalesce(nullif(v_card->>'cast_cost_minutes','')::integer,0);
  v_cost_kind:=coalesce(nullif(v_card->>'cast_cost_kind',''),case when v_cost>0 then 'time' else 'none' end);
  v_cost_text:=nullif(v_card->>'cast_cost_text','');
  if v_cost_kind='time' and v_cost>0 then
    if coalesce(array_length(p_cost_card_keys,1),0)=0 then raise exception 'Choose time-bonus cards to pay the casting cost.';end if;
    foreach v_key in array p_cost_card_keys loop
      v_pay:=public._get_held_card(p_game_id,v_key);
      if v_pay is null or v_pay->>'card_kind'<>'time_bonus' then raise exception 'Casting costs can only be paid with held time-bonus cards.';end if;
      v_paid:=v_paid+coalesce((v_pay->>'value_int')::integer,0);
    end loop;
    if v_paid<v_cost then raise exception 'Selected time bonuses do not cover the casting cost.';end if;
  end if;

  perform public._consume_held_card(p_game_id,p_card_key);
  if v_cost_kind='time' then foreach v_key in array p_cost_card_keys loop perform public._consume_held_card(p_game_id,v_key);end loop; end if;
  v_title:=v_card->>'title';v_desc:=v_card->>'description';v_duration:=nullif(v_card->>'duration_seconds','')::integer;v_value:=nullif(v_card->>'value_int','')::integer;
  insert into public.game_actions(game_id,actor,kind,payload) values(p_game_id,'hider','curse_play',jsonb_build_object(
    'source_card_key',p_card_key,'effect_key',v_effect,'title',v_title,'description',v_desc,
    'duration_seconds',v_duration,'value_int',v_value,'starts_at',v_now,
    'ends_at',case when v_duration is null then null else v_now+make_interval(secs=>v_duration) end,
    'copied_from',p_copy_card_key,'cast_cost_kind',v_cost_kind,'cast_cost_minutes',v_cost,
    'cast_cost_text',v_cost_text,'cast_paid_minutes',v_paid,'cast_cards',to_jsonb(p_cost_card_keys))) returning id into v_id;
  return v_id;
end;$$;

grant execute on function public.play_card_v4(uuid,text,text,text,text[]) to anon,authenticated;
