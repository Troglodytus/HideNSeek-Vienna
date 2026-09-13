-- Vienna Hide & Seek v3.4.0 migration
-- Run ONCE after v3.3.x.

create extension if not exists pgcrypto with schema extensions;

-- Shared game clock ---------------------------------------------------------
alter table public.games add column if not exists clock_elapsed_seconds bigint not null default 0;
alter table public.games add column if not exists clock_started_at timestamptz;
alter table public.games add column if not exists clock_running boolean not null default false;

create or replace function public.set_game_clock_v1(p_game_id uuid,p_password text,p_action text)
returns boolean language plpgsql security definer set search_path=public,extensions as $$
declare v_now timestamptz:=now();v_running boolean;v_started timestamptz;
begin
  if not public._hider_password_ok(p_game_id,p_password) then raise exception 'Invalid hider password.'; end if;
  select clock_running,clock_started_at into v_running,v_started from public.games where id=p_game_id for update;
  if not found then raise exception 'Game not found.'; end if;
  if p_action in ('start','resume') then
    if not v_running then update public.games set clock_running=true,clock_started_at=v_now where id=p_game_id; end if;
  elsif p_action='pause' then
    if v_running and v_started is not null then
      update public.games set
        clock_elapsed_seconds=clock_elapsed_seconds+greatest(0,floor(extract(epoch from (v_now-v_started)))::bigint),
        clock_running=false,clock_started_at=null where id=p_game_id;
    end if;
  else raise exception 'Invalid clock action.'; end if;
  return true;
end;$$;
grant execute on function public.set_game_clock_v1(uuid,text,text) to anon,authenticated;
do $$ begin alter publication supabase_realtime add table public.games; exception when duplicate_object then null; end $$;

-- Latest seeker GPS, readable only through Hider-password RPC ---------------
create table if not exists public.seeker_live_positions(
  game_id uuid primary key references public.games(id) on delete cascade,
  lat double precision not null,lng double precision not null,accuracy_m double precision,
  source text not null default 'gps',updated_at timestamptz not null default now()
);
alter table public.seeker_live_positions enable row level security;
revoke all on public.seeker_live_positions from anon,authenticated;

create or replace function public.set_seeker_live_position_v1(p_game_id uuid,p_lat double precision,p_lng double precision,p_accuracy_m double precision default null)
returns boolean language plpgsql security definer set search_path=public as $$
begin
  if not exists(select 1 from public.games where id=p_game_id and status='active') then raise exception 'Game is not active.'; end if;
  insert into public.seeker_live_positions(game_id,lat,lng,accuracy_m,source,updated_at)
  values(p_game_id,p_lat,p_lng,p_accuracy_m,'gps',now())
  on conflict(game_id) do update set lat=excluded.lat,lng=excluded.lng,accuracy_m=excluded.accuracy_m,source='gps',updated_at=now();
  return true;
end;$$;

create or replace function public.get_seeker_live_position_v1(p_game_id uuid,p_password text)
returns table(lat double precision,lng double precision,accuracy_m double precision,source text,updated_at timestamptz)
language plpgsql security definer set search_path=public,extensions as $$
begin
  if not public._hider_password_ok(p_game_id,p_password) then raise exception 'Invalid hider password.'; end if;
  return query select s.lat,s.lng,s.accuracy_m,s.source,s.updated_at from public.seeker_live_positions s where s.game_id=p_game_id;
end;$$;
grant execute on function public.set_seeker_live_position_v1(uuid,double precision,double precision,double precision) to anon,authenticated;
grant execute on function public.get_seeker_live_position_v1(uuid,text) to anon,authenticated;

-- Card catalogue ------------------------------------------------------------
alter table public.curse_cards add column if not exists cast_cost_minutes integer not null default 0;
delete from public.curse_cards;

-- Exactly 5x5, 4x10, 3x15, 2x20 minute cards.
insert into public.curse_cards(card_key,title,description,duration_seconds,card_kind,effect_key,value_int,cast_cost_minutes)
select 'time-5-'||g,'5 Minute Bonus','Keep in your hand; adds five minutes to the final hiding time.',null::integer,'time_bonus','time_bonus',5,0 from generate_series(1,5) g
union all select 'time-10-'||g,'10 Minute Bonus','Keep in your hand; adds ten minutes to the final hiding time.',null::integer,'time_bonus','time_bonus',10,0 from generate_series(1,4) g
union all select 'time-15-'||g,'15 Minute Bonus','Keep in your hand; adds fifteen minutes to the final hiding time.',null::integer,'time_bonus','time_bonus',15,0 from generate_series(1,3) g
union all select 'time-20-'||g,'20 Minute Bonus','Keep in your hand; adds twenty minutes to the final hiding time.',null::integer,'time_bonus','time_bonus',20,0 from generate_series(1,2) g;

insert into public.curse_cards(card_key,title,description,duration_seconds,card_kind,effect_key,value_int,cast_cost_minutes)
select 'veto-'||g,'Veto Question','Use on a pending seeker question to refuse that question; no answer is sent.',null::integer,'powerup','veto_question',null::integer,0 from generate_series(1,6) g
union all select 'duplicate-'||g,'Duplicate','Copy another held time-bonus or curse card without consuming the original.',null::integer,'powerup','duplicate',null::integer,0 from generate_series(1,4) g
union all select 'time-trap-'||g,'Time Trap','Secretly place this on a station. If triggered, it awards its base bonus plus 10 minutes per full hour it was armed.',null::integer,'time_trap','time_trap',5,0 from generate_series(1,6) g
union all select 'gamblers-feet-'||g,'Curse of the Gambler''s Feet','For one hour, seekers use a die to determine how many steps they may take before rolling again.',3600,'curse','gamblers_feet',null::integer,0 from generate_series(1,3) g
union all select 'fog-'||g,'Curse of the Impenetrable Fog','For one hour, seekers randomize their direction whenever they reach a qualifying street intersection.',3600,'curse','impenetrable_fog',null::integer,0 from generate_series(1,3) g
union all select 'express-'||g,'Curse of the Express Route','Seekers may not disembark their current train for up to 30 minutes, unless it reaches the end of its line first.',1800,'curse','express_route',null::integer,15 from generate_series(1,3) g
union all select 'prosperous-'||g,'Curse of the Prosperous Home','Expand the final hiding area. This Vienna implementation doubles area rather than doubling radius.',null::integer,'curse','prosperous_home',2,0 from generate_series(1,3) g;

-- One shuffled draw pile per game. The cursor advances without replacement.
create table if not exists public.game_card_state(
  game_id uuid primary key references public.games(id) on delete cascade,
  cycle integer not null default 0,
  deck jsonb not null default '[]'::jsonb check(jsonb_typeof(deck)='array'),
  cursor integer not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.game_card_state enable row level security;
revoke all on public.game_card_state from anon,authenticated;

create or replace function public._reshuffle_card_deck_v1(p_game_id uuid)
returns integer language plpgsql security definer set search_path=public as $$
declare v_deck jsonb;v_cycle integer;
begin
  select coalesce(jsonb_agg(c.card_key order by random()),'[]'::jsonb) into v_deck
  from public.curse_cards c
  where not exists(
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
    select * into v_card from public.curse_cards where card_key=v_key;
    if found then
      v_result:=v_result||jsonb_build_array(jsonb_build_object(
        'card_key',v_card.card_key,'title',v_card.title,'description',v_card.description,
        'duration_seconds',v_card.duration_seconds,'card_kind',v_card.card_kind,
        'effect_key',v_card.effect_key,'value_int',v_card.value_int,'cast_cost_minutes',v_card.cast_cost_minutes));
    end if;
  end loop;
  return v_result;
end;$$;

create or replace function public.answer_question_v4(p_game_id uuid,p_question_action_id uuid,p_password text,p_answer jsonb)
returns uuid language plpgsql security definer set search_path=public,extensions as $$
declare v_answer_id uuid;v_cards jsonb;v_kind text;v_draw_count integer;v_keep_limit integer;
begin
  if not public._hider_password_ok(p_game_id,p_password) then raise exception 'Invalid hider password.'; end if;
  select q.payload->>'question_kind' into v_kind from public.game_actions q where q.id=p_question_action_id and q.game_id=p_game_id and q.kind='question' and q.is_active;
  if v_kind is null then raise exception 'Question is not active.'; end if;
  if exists(select 1 from public.game_actions a where a.parent_id=p_question_action_id and a.kind in('answer','question_veto') and a.is_active) then raise exception 'Question already has an active answer/veto.'; end if;
  insert into public.game_actions(game_id,actor,kind,parent_id,payload) values(p_game_id,'hider','answer',p_question_action_id,jsonb_build_object('answer',coalesce(p_answer,'{}'::jsonb))) returning id into v_answer_id;
  if v_kind in('radar','thermometer') then v_draw_count:=2;v_keep_limit:=1;
  elsif v_kind='tentacle' then v_draw_count:=4;v_keep_limit:=2;
  else v_draw_count:=3;v_keep_limit:=1;end if;
  if not exists(select 1 from public.curse_draws where question_action_id=p_question_action_id) then
    v_cards:=public._draw_cards_v4(p_game_id,v_draw_count);
    if jsonb_array_length(v_cards)>0 then insert into public.curse_draws(game_id,question_action_id,cards,keep_limit) values(p_game_id,p_question_action_id,v_cards,v_keep_limit) on conflict(question_action_id) do nothing;end if;
  end if;
  return v_answer_id;
end;$$;
grant execute on function public.answer_question_v4(uuid,uuid,text,jsonb) to anon,authenticated;

create or replace function public.discard_held_card_v1(p_game_id uuid,p_password text,p_card_key text)
returns boolean language plpgsql security definer set search_path=public,extensions as $$
begin
  if not public._hider_password_ok(p_game_id,p_password) then raise exception 'Invalid hider password.';end if;
  if public._get_held_card(p_game_id,p_card_key) is null then raise exception 'Card is not available in hand.';end if;
  return public._consume_held_card(p_game_id,p_card_key);
end;$$;
grant execute on function public.discard_held_card_v1(uuid,text,text) to anon,authenticated;

create or replace function public.get_card_deck_status_v1(p_game_id uuid,p_password text)
returns table(cycle integer,remaining integer,total integer)
language plpgsql security definer set search_path=public,extensions as $$
declare v public.game_card_state%rowtype;
begin
  if not public._hider_password_ok(p_game_id,p_password) then raise exception 'Invalid hider password.';end if;
  if not exists(select 1 from public.game_card_state where game_id=p_game_id) then perform public._reshuffle_card_deck_v1(p_game_id);end if;
  select * into v from public.game_card_state where game_id=p_game_id;
  return query select v.cycle,greatest(0,jsonb_array_length(v.deck)-v.cursor),jsonb_array_length(v.deck);
end;$$;
grant execute on function public.get_card_deck_status_v1(uuid,text) to anon,authenticated;

create or replace function public.play_card_v4(p_game_id uuid,p_password text,p_card_key text,p_copy_card_key text default null,p_cost_card_keys text[] default array[]::text[])
returns uuid language plpgsql security definer set search_path=public,extensions as $$
declare v_card jsonb;v_copy jsonb;v_effect text;v_kind text;v_duration integer;v_now timestamptz:=now();v_id uuid;v_title text;v_desc text;v_value integer;v_cost integer:=0;v_paid integer:=0;v_key text;v_pay jsonb;
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
  if v_cost>0 then
    if coalesce(array_length(p_cost_card_keys,1),0)=0 then raise exception 'Choose time-bonus cards to pay the casting cost.';end if;
    foreach v_key in array p_cost_card_keys loop
      v_pay:=public._get_held_card(p_game_id,v_key);
      if v_pay is null or v_pay->>'card_kind'<>'time_bonus' then raise exception 'Casting costs can only be paid with held time-bonus cards.';end if;
      v_paid:=v_paid+coalesce((v_pay->>'value_int')::integer,0);
    end loop;
    if v_paid<v_cost then raise exception 'Selected time bonuses do not cover the casting cost.';end if;
  end if;

  perform public._consume_held_card(p_game_id,p_card_key);
  foreach v_key in array p_cost_card_keys loop perform public._consume_held_card(p_game_id,v_key);end loop;
  v_title:=v_card->>'title';v_desc:=v_card->>'description';v_duration:=nullif(v_card->>'duration_seconds','')::integer;v_value:=nullif(v_card->>'value_int','')::integer;
  insert into public.game_actions(game_id,actor,kind,payload) values(p_game_id,'hider','curse_play',jsonb_build_object('source_card_key',p_card_key,'effect_key',v_effect,'title',v_title,'description',v_desc,'duration_seconds',v_duration,'value_int',v_value,'starts_at',v_now,'ends_at',case when v_duration is null then null else v_now+make_interval(secs=>v_duration) end,'copied_from',p_copy_card_key,'cast_cost_minutes',v_cost,'cast_paid_minutes',v_paid,'cast_cards',to_jsonb(p_cost_card_keys))) returning id into v_id;
  return v_id;
end;$$;
grant execute on function public.play_card_v4(uuid,text,text,text,text[]) to anon,authenticated;
