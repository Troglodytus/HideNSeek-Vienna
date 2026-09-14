-- Hide & Seek: Vienna v3.10.0
-- New casting-cost modes + interactive Vienna curses.
-- Run ONCE after v3.9.0.

-- ---------------------------------------------------------------------------
-- Casting costs can now consume another held card.
-- ---------------------------------------------------------------------------
alter table public.curse_cards add column if not exists cast_cost_category text;

alter table public.curse_cards drop constraint if exists curse_cards_cast_cost_kind_check;
alter table public.curse_cards add constraint curse_cards_cast_cost_kind_check
  check (cast_cost_kind in ('none','time','custom','discard_any','discard_category'));

alter table public.curse_cards drop constraint if exists curse_cards_cast_cost_category_check;
alter table public.curse_cards add constraint curse_cards_cast_cost_category_check
  check (cast_cost_category is null or cast_cost_category in ('curse','veto','time_bonus','powerup','time_trap'));

create or replace function public.admin_list_cards_v3(p_password text)
returns table(
  card_key text,title text,description text,duration_seconds integer,
  card_kind text,effect_key text,value_int integer,cast_cost_minutes integer,
  cast_cost_kind text,cast_cost_text text,cast_cost_category text,enabled boolean,deck_count integer,
  special_engine boolean
)
language plpgsql security definer set search_path=public,extensions as $$
begin
  if not public._admin_password_ok(p_password) then
    perform pg_sleep(0.35); raise exception 'Invalid developer password.';
  end if;
  return query
  select c.card_key,c.title,c.description,c.duration_seconds,c.card_kind,c.effect_key,c.value_int,
         c.cast_cost_minutes,c.cast_cost_kind,c.cast_cost_text,c.cast_cost_category,c.enabled,c.deck_count,
         (c.effect_key in ('prosperous_home','duplicate','reshuffle_deck','time_trap','veto_question')) as special_engine
  from public.curse_cards c
  order by
    case when c.effect_key in ('prosperous_home','duplicate','reshuffle_deck','time_trap','veto_question') then 9
    when c.card_kind='time_bonus' then 1 when c.card_kind='curse' then 2 else 3 end,
    c.title,c.card_key;
end;$$;
grant execute on function public.admin_list_cards_v3(text) to anon,authenticated;

create or replace function public.admin_save_card_v3(
  p_password text,p_card_key text,p_title text,p_description text,
  p_duration_seconds integer,p_card_kind text,p_effect_key text,p_value_int integer,
  p_cast_cost_kind text,p_cast_cost_minutes integer,p_cast_cost_text text,p_cast_cost_category text,
  p_deck_count integer
) returns text
language plpgsql security definer set search_path=public,extensions as $$
declare v_key text;v_special boolean;
begin
  if not public._admin_password_ok(p_password) then perform pg_sleep(0.35);raise exception 'Invalid developer password.';end if;
  if char_length(trim(coalesce(p_title,''))) not between 1 and 120 then raise exception 'Card title must be 1-120 characters.';end if;
  if char_length(trim(coalesce(p_description,''))) not between 1 and 1200 then raise exception 'Card text must be 1-1200 characters.';end if;
  if p_card_kind not in ('curse','powerup','time_bonus','time_trap') then raise exception 'Invalid card type.';end if;
  if p_cast_cost_kind not in ('none','time','custom','discard_any','discard_category') then raise exception 'Invalid casting-cost type.';end if;
  if coalesce(p_deck_count,-1) not between 0 and 50 then raise exception 'Deck count must be 0-50.';end if;
  if p_duration_seconds is not null and p_duration_seconds<0 then raise exception 'Invalid duration.';end if;
  if p_cast_cost_kind='time' and (coalesce(p_cast_cost_minutes,0)<=0 or p_cast_cost_minutes%5<>0 or p_cast_cost_minutes>120) then raise exception 'Time casting cost must be 5-120 minutes in 5-minute steps.';end if;
  if p_cast_cost_kind='custom' and char_length(trim(coalesce(p_cast_cost_text,'')))<1 then raise exception 'Enter the custom casting cost.';end if;
  if p_cast_cost_kind='discard_category' and coalesce(p_cast_cost_category,'') not in ('curse','veto','time_bonus','powerup','time_trap') then raise exception 'Choose a discard-card category.';end if;

  v_key=nullif(trim(coalesce(p_card_key,'')),'');
  if v_key is null then v_key='custom-'||replace(extensions.gen_random_uuid()::text,'-',''); end if;

  select effect_key in ('prosperous_home','duplicate','reshuffle_deck','time_trap','veto_question') into v_special
  from public.curse_cards where card_key=v_key;

  if coalesce(v_special,false) then
    update public.curse_cards set
      title=trim(p_title),description=trim(p_description),duration_seconds=p_duration_seconds,
      cast_cost_minutes=case when p_cast_cost_kind='time' then p_cast_cost_minutes else 0 end,
      cast_cost_kind=p_cast_cost_kind,
      cast_cost_text=case when p_cast_cost_kind='custom' then trim(p_cast_cost_text) else null end,
      cast_cost_category=case when p_cast_cost_kind='discard_category' then p_cast_cost_category else null end,
      deck_count=p_deck_count,enabled=(p_deck_count>0)
    where card_key=v_key;
    return v_key;
  end if;

  insert into public.curse_cards(
    card_key,title,description,duration_seconds,card_kind,effect_key,value_int,
    cast_cost_minutes,cast_cost_kind,cast_cost_text,cast_cost_category,enabled,deck_count
  ) values(
    v_key,trim(p_title),trim(p_description),p_duration_seconds,p_card_kind,
    coalesce(nullif(trim(coalesce(p_effect_key,'')),''),'custom_rule'),p_value_int,
    case when p_cast_cost_kind='time' then p_cast_cost_minutes else 0 end,
    p_cast_cost_kind,case when p_cast_cost_kind='custom' then trim(p_cast_cost_text) else null end,
    case when p_cast_cost_kind='discard_category' then p_cast_cost_category else null end,
    (p_deck_count>0),p_deck_count
  ) on conflict(card_key) do update set
    title=excluded.title,description=excluded.description,duration_seconds=excluded.duration_seconds,
    card_kind=excluded.card_kind,effect_key=excluded.effect_key,value_int=excluded.value_int,
    cast_cost_minutes=excluded.cast_cost_minutes,cast_cost_kind=excluded.cast_cost_kind,
    cast_cost_text=excluded.cast_cost_text,cast_cost_category=excluded.cast_cost_category,
    enabled=excluded.enabled,deck_count=excluded.deck_count;
  return v_key;
end;$$;
grant execute on function public.admin_save_card_v3(text,text,text,text,integer,text,text,integer,text,integer,text,text,integer) to anon,authenticated;

-- Draw snapshots include the discard-category rule.
create or replace function public._draw_cards_v4(p_game_id uuid,p_count integer)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare
  v_result jsonb:='[]'::jsonb;v_state public.game_card_state%rowtype;
  v_instance_key text;v_catalog_key text;v_card public.curse_cards%rowtype;
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
    v_instance_key:=v_state.deck->>v_state.cursor;
    update public.game_card_state set cursor=cursor+1,updated_at=now() where game_id=p_game_id;
    v_catalog_key:=split_part(v_instance_key,'::',1);
    select * into v_card from public.curse_cards where card_key=v_catalog_key and enabled and deck_count>0;
    if found then
      v_result:=v_result||jsonb_build_array(jsonb_build_object(
        'card_key',v_instance_key,'catalog_key',v_card.card_key,'title',v_card.title,'description',v_card.description,
        'duration_seconds',v_card.duration_seconds,'card_kind',v_card.card_kind,
        'effect_key',v_card.effect_key,'value_int',v_card.value_int,
        'cast_cost_minutes',v_card.cast_cost_minutes,'cast_cost_kind',v_card.cast_cost_kind,
        'cast_cost_text',v_card.cast_cost_text,'cast_cost_category',v_card.cast_cost_category));
    end if;
  end loop;
  return v_result;
end;$$;

create or replace function public._held_card_matches_category(p_card jsonb,p_category text)
returns boolean language sql immutable as $$
  select case p_category
    when 'curse' then p_card->>'card_kind'='curse'
    when 'veto' then p_card->>'effect_key'='veto_question'
    when 'time_bonus' then p_card->>'card_kind'='time_bonus'
    when 'powerup' then p_card->>'card_kind'='powerup'
    when 'time_trap' then p_card->>'effect_key'='time_trap' or p_card->>'card_kind'='time_trap'
    else false end;
$$;

-- v5 adds effect payloads and discard-card casting costs.
create or replace function public.play_card_v5(
  p_game_id uuid,p_password text,p_card_key text,p_copy_card_key text default null,
  p_cost_card_keys text[] default array[]::text[],p_effect_payload jsonb default '{}'::jsonb
) returns uuid language plpgsql security definer set search_path=public,extensions as $$
declare
  v_card jsonb;v_copy jsonb;v_effect text;v_kind text;v_duration integer;v_now timestamptz:=now();v_id uuid;
  v_title text;v_desc text;v_value integer;v_cost integer:=0;v_paid integer:=0;v_key text;v_pay jsonb;
  v_cost_kind text;v_cost_text text;v_cost_category text;v_payload jsonb:=coalesce(p_effect_payload,'{}'::jsonb);
  v_local timestamp;v_dow integer;v_t time;v_sidequest text;
begin
  if not public._hider_password_ok(p_game_id,p_password) then raise exception 'Invalid hider password.';end if;
  v_card:=public._get_held_card(p_game_id,p_card_key);if v_card is null then raise exception 'Card is not available in hand.';end if;
  v_effect:=v_card->>'effect_key';v_kind:=v_card->>'card_kind';

  if v_effect='duplicate' then
    if p_copy_card_key is null then raise exception 'Choose a card to duplicate.';end if;
    v_copy:=public._get_held_card(p_game_id,p_copy_card_key);if v_copy is null then raise exception 'Duplicate target is not available.';end if;
    if v_copy->>'card_kind'='time_bonus' then
      perform public._consume_held_card(p_game_id,p_card_key);
      insert into public.private_card_uses(game_id,card_key,effect_key,value_int,metadata)
      values(p_game_id,p_card_key,'duplicate_bonus',(v_copy->>'value_int')::integer,jsonb_build_object('copied_card_key',p_copy_card_key,'copied_title',v_copy->>'title'))
      returning id into v_id;return v_id;
    elsif v_copy->>'card_kind'='curse' then v_card:=v_copy;v_effect:=v_copy->>'effect_key';v_kind:='curse';
    else raise exception 'Duplicate currently supports time bonuses and curses.';end if;
  elsif v_kind<>'curse' then raise exception 'This card is used elsewhere in the interface.';end if;

  v_cost:=coalesce(nullif(v_card->>'cast_cost_minutes','')::integer,0);
  v_cost_kind:=coalesce(nullif(v_card->>'cast_cost_kind',''),case when v_cost>0 then 'time' else 'none' end);
  v_cost_text:=nullif(v_card->>'cast_cost_text','');
  v_cost_category:=nullif(v_card->>'cast_cost_category','');

  if v_cost_kind='time' and v_cost>0 then
    if coalesce(array_length(p_cost_card_keys,1),0)=0 then raise exception 'Choose time-bonus cards to pay the casting cost.';end if;
    foreach v_key in array p_cost_card_keys loop
      if v_key=p_card_key or v_key=coalesce(p_copy_card_key,'') then raise exception 'The played/copied card cannot pay its own casting cost.';end if;
      v_pay:=public._get_held_card(p_game_id,v_key);
      if v_pay is null or v_pay->>'card_kind'<>'time_bonus' then raise exception 'Casting costs can only be paid with held time-bonus cards.';end if;
      v_paid:=v_paid+coalesce((v_pay->>'value_int')::integer,0);
    end loop;
    if v_paid<v_cost then raise exception 'Selected time bonuses do not cover the casting cost.';end if;
  elsif v_cost_kind in ('discard_any','discard_category') then
    if coalesce(array_length(p_cost_card_keys,1),0)<>1 then raise exception 'Choose exactly one other held card to discard.';end if;
    v_key:=p_cost_card_keys[1];
    if v_key=p_card_key or v_key=coalesce(p_copy_card_key,'') then raise exception 'The played/copied card cannot pay its own casting cost.';end if;
    v_pay:=public._get_held_card(p_game_id,v_key);if v_pay is null then raise exception 'Casting-cost card is not available in hand.';end if;
    if v_cost_kind='discard_category' and not public._held_card_matches_category(v_pay,v_cost_category) then raise exception 'The selected card does not match the required discard category.';end if;
  end if;

  -- Effect-specific, server-owned rules.
  if v_effect='deutsche_bahn' then
    if coalesce(v_payload->>'blocked_line','') !~ '^[US][0-9]{1,2}$' then raise exception 'Choose the blocked U-/S-Bahn line.';end if;
    v_duration:=1800;
  elsif v_effect='side_quest' then
    v_duration:=2700;
    v_sidequest:=case floor(random()*10)::integer
      when 0 then 'Find a public statue and recreate its pose as a team photo.'
      when 1 then 'Find a playground. Every Seeker must use one piece of playground equipment.'
      when 2 then 'Find a public fountain and take an unnecessarily dramatic team portrait.'
      when 3 then 'Find an animal statue or sculpture and give it a name and backstory.'
      when 4 then 'Ride three consecutive stops on a tram line you were not planning to use.'
      when 5 then 'Find a bakery and unanimously choose one item that best represents Vienna.'
      when 6 then 'Find a street named after a person and learn one fact about that person.'
      when 7 then 'Find something red-white-red in public space and photograph the whole team with it.'
      when 8 then 'Find a staircase with at least 20 steps and stage a heroic summit photo at the top.'
      else 'Find a park bench with a view and record a 20-second fake tourism advertisement for Vienna.' end;
    v_payload:=v_payload||jsonb_build_object('side_quest',v_sidequest);
  elsif v_effect='wean_ned_schlecht_redn' then
    v_local:=v_now at time zone 'Europe/Vienna';v_dow:=extract(isodow from v_local)::integer;v_t:=v_local::time;
    if v_dow=1 or (v_dow=2 and v_t<time '12:00') then
      v_duration:=3600;v_payload:=v_payload||jsonb_build_object('mode','work_hours');
    else
      v_duration:=null;v_payload:=v_payload||jsonb_build_object('mode','wine_hike');
    end if;
  elsif v_effect='haute_vollee' then v_duration:=900;
  elsif v_effect='fiaker' then v_duration:=3600;
  elsif v_effect='mordor_curse' then
    if coalesce(v_payload->>'mode','') not in ('inside','outside') then raise exception 'Mordor curse needs the Seekers current side of the Danube.';end if;
    v_duration:=1200;
  elsif v_effect='broken_lift' then v_duration:=1800;
  elsif v_effect='false_prophet' then v_duration:=1200;
  else
    v_duration:=nullif(v_card->>'duration_seconds','')::integer;
  end if;

  perform public._consume_held_card(p_game_id,p_card_key);
  if v_cost_kind in ('time','discard_any','discard_category') then
    foreach v_key in array p_cost_card_keys loop perform public._consume_held_card(p_game_id,v_key);end loop;
  end if;

  v_title:=v_card->>'title';v_desc:=v_card->>'description';v_value:=nullif(v_card->>'value_int','')::integer;
  insert into public.game_actions(game_id,actor,kind,payload) values(
    p_game_id,'hider','curse_play',
    jsonb_build_object(
      'source_card_key',p_card_key,'effect_key',v_effect,'title',v_title,'description',v_desc,
      'duration_seconds',v_duration,'value_int',v_value,'starts_at',v_now,
      'ends_at',case when v_duration is null then null else v_now+make_interval(secs=>v_duration) end,
      'copied_from',p_copy_card_key,'cast_cost_kind',v_cost_kind,'cast_cost_minutes',v_cost,
      'cast_cost_text',v_cost_text,'cast_cost_category',v_cost_category,'cast_paid_minutes',v_paid,
      'cast_cards',to_jsonb(p_cost_card_keys)
    ) || v_payload
  ) returning id into v_id;
  return v_id;
end;$$;
grant execute on function public.play_card_v5(uuid,text,text,text,text[],jsonb) to anon,authenticated;

-- Seekers may manually clear only curses that explicitly use a completion checkbox.
create or replace function public.complete_curse_v1(p_game_id uuid,p_curse_action_id uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_action public.game_actions%rowtype;v_effect text;v_id uuid;v_mode text;
begin
  select * into v_action from public.game_actions where id=p_curse_action_id and game_id=p_game_id and kind='curse_play' and is_active;
  if not found then raise exception 'Active curse not found.';end if;
  v_effect:=v_action.payload->>'effect_key';v_mode:=v_action.payload->>'mode';
  if v_effect not in ('fiaker','schwarzkappler','wean_ned_schlecht_redn') then raise exception 'This curse cannot be manually completed.';end if;
  if v_effect='wean_ned_schlecht_redn' and v_mode<>'wine_hike' then raise exception 'This version of the curse ends by timer.';end if;
  if exists(select 1 from public.game_actions where game_id=p_game_id and kind='curse_complete' and parent_id=p_curse_action_id and is_active) then
    raise exception 'Curse is already complete.';
  end if;
  insert into public.game_actions(game_id,actor,kind,parent_id,payload)
  values(p_game_id,'seeker','curse_complete',p_curse_action_id,jsonb_build_object('effect_key',v_effect,'completed_at',now()))
  returning id into v_id;
  return v_id;
end;$$;
grant execute on function public.complete_curse_v1(uuid,uuid) to anon,authenticated;

-- ---------------------------------------------------------------------------
-- New curses. Existing cards are deliberately untouched.
-- ---------------------------------------------------------------------------
insert into public.curse_cards(
  card_key,title,description,duration_seconds,card_kind,effect_key,value_int,
  cast_cost_minutes,cast_cost_kind,cast_cost_text,cast_cost_category,enabled,deck_count
) values
('side-quest-vienna-1','Curse of the Side Quest','A completely unnecessary mission has appeared. Complete the randomly assigned side quest while the 45-minute curse timer runs.',2700,'curse','side_quest',null,0,'discard_category',null,'curse',true,1),
('deutsche-bahn-vienna-1','Curse of the Deutsche Bahn','Your current line received an unexpected Gleisschaden due to 30 years of infrastructural neglect. We, the Deutsche Bahn would like to apologize for this unforseeable interruption. Get off your mode of transportation at the next possible stop. Your line is blocked for 30 minutes and cannot be used.',1800,'curse','deutsche_bahn',null,0,'none',null,null,true,1),
('wean-ned-schlecht-redn-vienna-1','Curse of the ''I lass mir mei Wean ned schlecht redn''','If its already past Tuesday noon, visit the start of any of the Wien Weinwanderwege. If its before before Tuesday noon, you have to hault for 1h as its work hours.',null,'curse','wean_ned_schlecht_redn',null,40,'time',null,null,true,1),
('haute-vollee-vienna-1','Curse of the Haute Vollee','As peasents and cretins you are not allowed to enter the high society (and Asian tourism) areas. Stay out of 1., 18., and 19. Bezirk for 15 minutes.',900,'curse','haute_vollee',null,15,'time',null,null,true,1),
('one-ring-vienna-1','Curse of the One Ring','They all were deceived as another ring was forged. You cannot cross the Ringstrasse in any direction with public transportation. On foot you may cross it, but only when traversing at least 250m along it.',null,'curse','one_ring',null,10,'time',null,null,true,1),
('schwarzkappler-vienna-1','Curse of the Schwarzkappler','Seekers must leave their current transportation if currently on any and go to the ticket machine to buy a ticket before continuing their journey.',null,'curse','schwarzkappler',null,5,'time',null,null,true,1),
('wiener-grantler-vienna-1','Curse of the Wiener Grantler','Until the next question, the Seekers may only communicate in exaggeratedly grumpy complaints about Vienna. If anyone says something sincerely positive, the team must stop for 2 minutes.',null,'curse','wiener_grantler',null,5,'time',null,null,true,1),
('fiaker-vienna-1','Curse of the Fiaker','Seekers must spot a Fiaker horse carriage before being allowed to ask any more questions. Check the curse off when you spot one. It automatically lifts after 1 hour.',3600,'curse','fiaker',null,15,'time',null,null,true,1),
('mordor-curse-vienna-1','Curse of Mordor','If the Seekers are already in districts 21 or 22, they must remain in Mordor for 20 minutes. Otherwise, they may not enter districts 21 or 22 for 20 minutes.',1200,'curse','mordor_curse',null,15,'time',null,null,true,1),
('broken-lift-vienna-1','Curse of the Broken Lift','Elevators are forbidden for 30 minutes. Stairs and escalators only.',1800,'curse','broken_lift',null,5,'time',null,null,true,1),
('gemeindebau-vienna-1','Curse of the Gemeindebau','Before asking another question, find and photograph a Gemeindebau or an obvious municipal housing complex.',null,'curse','gemeindebau',null,5,'time',null,null,true,1),
('quick-escalation-vienna-1','Curse of Quick Escalation','Seekers must until the end of the run deliberately stand on the left side of any escalater they might use.',null,'curse','quick_escalation',null,0,'custom','The hider must spot a person standing on the left side of the escalator to play the curse.',null,true,1),
('false-prophet-vienna-1','Curse of the False Prophet','One Seeker becomes the Prophet for 20 minutes. Only the Prophet may decide which direction the team travels, but the Prophet may not look at the map. Everyone else may see the map but can answer the Prophet only with yes/no.',1200,'curse','false_prophet',null,15,'time',null,null,true,1)
on conflict(card_key) do nothing;
