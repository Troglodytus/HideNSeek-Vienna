-- Hide & Seek: Vienna v3.11.1
-- Turntables reward suppression + strategic power-ups + Deceptive Tiny House.
-- Run ONCE after v3.11.0.

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Public action types used by power-ups. Hidden effects never use this table
-- until they are meant to be revealed.
-- ---------------------------------------------------------------------------
alter table public.game_actions drop constraint if exists game_actions_kind_check;
alter table public.game_actions add constraint game_actions_kind_check check (
  kind in (
    'seeker_location','thermo_reference','question','answer','curse_play','question_veto',
    'time_trap_place','time_trap_trigger','endgame_zone','game_finish','curse_complete',
    'turntables_relocate','powerup_play','powerup_draw'
  )
);

-- ---------------------------------------------------------------------------
-- Private secondary-effect catalogue for Kleingedrucktes.
-- curse_cards is publicly readable, so secondary effects MUST NOT live there.
-- ---------------------------------------------------------------------------
create table if not exists public.card_secondary_effects(
  card_key text primary key references public.curse_cards(card_key) on delete cascade,
  effect_mode text not null default 'none' check(effect_mode in ('none','custom','engine')),
  effect_text text,
  engine_key text,
  engine_payload jsonb not null default '{}'::jsonb check(jsonb_typeof(engine_payload)='object'),
  updated_at timestamptz not null default now()
);
alter table public.card_secondary_effects enable row level security;
revoke all on public.card_secondary_effects from anon,authenticated;

-- ---------------------------------------------------------------------------
-- Add/promote the requested engine cards without touching unrelated catalogue rows.
-- ---------------------------------------------------------------------------
do $$
declare v_key text;
begin
  -- Double or Nothing
  select card_key into v_key from public.curse_cards where lower(title)=lower('Double or Nothing') order by card_key limit 1;
  if v_key is null then
    insert into public.curse_cards(card_key,title,description,duration_seconds,card_kind,effect_key,value_int,cast_cost_minutes,cast_cost_kind,cast_cost_text,cast_cost_category,enabled,deck_count)
    values('double-or-nothing-vienna-1','Double or Nothing','Play this together with a timed Curse that normally costs time bonuses. Pay double its normal time casting cost and the Curse lasts twice as long.',null,'powerup','double_or_nothing',null,0,'none',null,null,true,1);
  else
    update public.curse_cards set card_kind='powerup',effect_key='double_or_nothing',duration_seconds=null,cast_cost_minutes=0,cast_cost_kind='none',cast_cost_text=null,cast_cost_category=null,enabled=true where card_key=v_key;
  end if;

  -- MA48
  v_key:=null;
  select card_key into v_key from public.curse_cards where lower(title)=lower('MA48') order by card_key limit 1;
  if v_key is null then
    insert into public.curse_cards(card_key,title,description,duration_seconds,card_kind,effect_key,value_int,cast_cost_minutes,cast_cost_kind,cast_cost_text,cast_cost_category,enabled,deck_count)
    values('ma48-vienna-1','MA48','Recycle one previously played or discarded card back into your hand. As the price, your current hand is publicly revealed to the Seekers. The recycled card is not included in that reveal.',null,'powerup','ma48',null,0,'none',null,null,true,1);
  else
    update public.curse_cards set card_kind='powerup',effect_key='ma48',duration_seconds=null,cast_cost_minutes=0,cast_cost_kind='none',cast_cost_text=null,cast_cost_category=null,enabled=true where card_key=v_key;
  end if;

  -- Kleingedrucktes
  v_key:=null;
  select card_key into v_key from public.curse_cards where lower(title)=lower('Kleingedrucktes') order by card_key limit 1;
  if v_key is null then
    insert into public.curse_cards(card_key,title,description,duration_seconds,card_kind,effect_key,value_int,cast_cost_minutes,cast_cost_kind,cast_cost_text,cast_cost_category,enabled,deck_count)
    values('kleingedrucktes-vienna-1','Kleingedrucktes','Reveal and activate the hidden secondary effect printed in the fine print of one currently active Curse.',null,'powerup','kleingedrucktes',null,0,'none',null,null,true,1);
  else
    update public.curse_cards set card_kind='powerup',effect_key='kleingedrucktes',duration_seconds=null,cast_cost_minutes=0,cast_cost_kind='none',cast_cost_text=null,cast_cost_category=null,enabled=true where card_key=v_key;
  end if;

  -- Same Day Delivery
  v_key:=null;
  select card_key into v_key from public.curse_cards where lower(title)=lower('Same Day Delivery') order by card_key limit 1;
  if v_key is null then
    insert into public.curse_cards(card_key,title,description,duration_seconds,card_kind,effect_key,value_int,cast_cost_minutes,cast_cost_kind,cast_cost_text,cast_cost_category,enabled,deck_count)
    values('same-day-delivery-vienna-1','Same Day Delivery','Draw 3 cards immediately and keep 2.',null,'powerup','same_day_delivery',null,15,'time',null,null,true,1);
  else
    update public.curse_cards set card_kind='powerup',effect_key='same_day_delivery',duration_seconds=null,cast_cost_minutes=15,cast_cost_kind='time',cast_cost_text=null,cast_cost_category=null,enabled=true where card_key=v_key;
  end if;

  -- Curse of the Deceptive Tiny House
  v_key:=null;
  select card_key into v_key from public.curse_cards where lower(title)=lower('Curse of the Deceptive Tiny House') order by card_key limit 1;
  if v_key is null then
    insert into public.curse_cards(card_key,title,description,duration_seconds,card_kind,effect_key,value_int,cast_cost_minutes,cast_cost_kind,cast_cost_text,cast_cost_category,enabled,deck_count)
    values('deceptive-tiny-house-vienna-1','Curse of the Deceptive Tiny House','When played you are allowed to answer the next Seekers question untruthfully and lie. The seekers are not informed about the curse until they reached the endgame. Your final hiding area shrinks by the factor 1/3.',null,'curse','deceptive_tiny_house',null,0,'none',null,null,true,1);
  else
    update public.curse_cards set
      title='Curse of the Deceptive Tiny House',
      description='When played you are allowed to answer the next Seekers question untruthfully and lie. The seekers are not informed about the curse until they reached the endgame. Your final hiding area shrinks by the factor 1/3.',
      card_kind='curse',effect_key='deceptive_tiny_house',duration_seconds=null,cast_cost_minutes=0,cast_cost_kind='none',cast_cost_text=null,cast_cost_category=null,enabled=true
    where card_key=v_key;
  end if;
end; $$;

-- Turntables receives the additional no-reward clause.
update public.curse_cards
set description='The game time is paused immediately when played and the Seekers are not allowed to move. The Hider has 20 Minutes to relocate to another hiding station. Possible effects of Prosperous Home are reset. The next 3 Seeker questions are answered without any reward.'
where effect_key='turntables';

-- ---------------------------------------------------------------------------
-- Card/admin helpers.
-- ---------------------------------------------------------------------------
create or replace function public.admin_list_cards_v4(p_password text)
returns table(
  card_key text,title text,description text,duration_seconds integer,
  card_kind text,effect_key text,value_int integer,cast_cost_minutes integer,
  cast_cost_kind text,cast_cost_text text,cast_cost_category text,enabled boolean,deck_count integer,
  secondary_effect_mode text,secondary_effect_text text,secondary_engine_key text,secondary_engine_payload jsonb,
  special_engine boolean
)
language plpgsql security definer set search_path=public,extensions as $$
begin
  if not public._admin_password_ok(p_password) then perform pg_sleep(0.35);raise exception 'Invalid developer password.';end if;
  return query
  select c.card_key,c.title,c.description,c.duration_seconds,c.card_kind,c.effect_key,c.value_int,
         c.cast_cost_minutes,c.cast_cost_kind,c.cast_cost_text,c.cast_cost_category,c.enabled,c.deck_count,
         coalesce(s.effect_mode,'none'),s.effect_text,s.engine_key,coalesce(s.engine_payload,'{}'::jsonb),
         (c.effect_key in (
           'prosperous_home','duplicate','reshuffle_deck','time_trap','veto_question','turntables',
           'double_or_nothing','ma48','kleingedrucktes','same_day_delivery','deceptive_tiny_house'
         )) as special_engine
  from public.curse_cards c
  left join public.card_secondary_effects s on s.card_key=c.card_key
  order by case when c.effect_key in (
      'prosperous_home','duplicate','reshuffle_deck','time_trap','veto_question','turntables',
      'double_or_nothing','ma48','kleingedrucktes','same_day_delivery','deceptive_tiny_house'
    ) then 9 when c.card_kind='time_bonus' then 1 when c.card_kind='curse' then 2 else 3 end,
    c.title,c.card_key;
end;$$;
grant execute on function public.admin_list_cards_v4(text) to anon,authenticated;

create or replace function public.admin_save_card_v4(
  p_password text,p_card_key text,p_title text,p_description text,
  p_duration_seconds integer,p_card_kind text,p_effect_key text,p_value_int integer,
  p_cast_cost_kind text,p_cast_cost_minutes integer,p_cast_cost_text text,p_cast_cost_category text,
  p_deck_count integer,
  p_secondary_effect_mode text default 'none',p_secondary_effect_text text default null,
  p_secondary_engine_key text default null,p_secondary_engine_payload jsonb default '{}'::jsonb
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
  if coalesce(p_secondary_effect_mode,'none') not in ('none','custom','engine') then raise exception 'Invalid secondary-effect mode.';end if;
  if p_secondary_effect_mode='custom' and char_length(trim(coalesce(p_secondary_effect_text,'')))<1 then raise exception 'Enter the hidden secondary-effect text.';end if;
  if p_secondary_effect_mode='engine' and char_length(trim(coalesce(p_secondary_engine_key,'')))<1 then raise exception 'Enter the secondary engine-effect key.';end if;
  if coalesce(jsonb_typeof(coalesce(p_secondary_engine_payload,'{}'::jsonb)),'object')<>'object' then raise exception 'Secondary engine payload must be a JSON object.';end if;

  v_key=nullif(trim(coalesce(p_card_key,'')),'');
  if v_key is null then v_key='custom-'||replace(extensions.gen_random_uuid()::text,'-','');end if;
  select effect_key in (
    'prosperous_home','duplicate','reshuffle_deck','time_trap','veto_question','turntables',
    'double_or_nothing','ma48','kleingedrucktes','same_day_delivery','deceptive_tiny_house'
  ) into v_special from public.curse_cards where card_key=v_key;

  if coalesce(v_special,false) then
    update public.curse_cards set title=trim(p_title),description=trim(p_description),deck_count=p_deck_count,enabled=(p_deck_count>0) where card_key=v_key;
  else
    insert into public.curse_cards(card_key,title,description,duration_seconds,card_kind,effect_key,value_int,cast_cost_minutes,cast_cost_kind,cast_cost_text,cast_cost_category,enabled,deck_count)
    values(v_key,trim(p_title),trim(p_description),p_duration_seconds,p_card_kind,coalesce(nullif(trim(coalesce(p_effect_key,'')),''),'custom_rule'),p_value_int,
      case when p_cast_cost_kind='time' then p_cast_cost_minutes else 0 end,p_cast_cost_kind,case when p_cast_cost_kind='custom' then trim(p_cast_cost_text) else null end,
      case when p_cast_cost_kind='discard_category' then p_cast_cost_category else null end,(p_deck_count>0),p_deck_count)
    on conflict(card_key) do update set title=excluded.title,description=excluded.description,duration_seconds=excluded.duration_seconds,card_kind=excluded.card_kind,
      effect_key=excluded.effect_key,value_int=excluded.value_int,cast_cost_minutes=excluded.cast_cost_minutes,cast_cost_kind=excluded.cast_cost_kind,
      cast_cost_text=excluded.cast_cost_text,cast_cost_category=excluded.cast_cost_category,enabled=excluded.enabled,deck_count=excluded.deck_count;
  end if;

  if p_card_kind='curse' then
    insert into public.card_secondary_effects(card_key,effect_mode,effect_text,engine_key,engine_payload,updated_at)
    values(v_key,coalesce(p_secondary_effect_mode,'none'),
      case when p_secondary_effect_mode in ('custom','engine') then nullif(trim(coalesce(p_secondary_effect_text,'')),'') else null end,
      case when p_secondary_effect_mode='engine' then nullif(trim(coalesce(p_secondary_engine_key,'')),'') else null end,
      case when p_secondary_effect_mode='engine' then coalesce(p_secondary_engine_payload,'{}'::jsonb) else '{}'::jsonb end,now())
    on conflict(card_key) do update set effect_mode=excluded.effect_mode,effect_text=excluded.effect_text,engine_key=excluded.engine_key,engine_payload=excluded.engine_payload,updated_at=now();
  else
    delete from public.card_secondary_effects where card_key=v_key;
  end if;
  return v_key;
end;$$;
grant execute on function public.admin_save_card_v4(text,text,text,text,integer,text,text,integer,text,integer,text,text,integer,text,text,text,jsonb) to anon,authenticated;

-- ---------------------------------------------------------------------------
-- Generic private/public hand helpers.
-- ---------------------------------------------------------------------------
create or replace function public._held_hand_titles_v1(p_game_id uuid)
returns jsonb language sql stable security definer set search_path=public as $$
  with cards as (
    select e->>'title' as title
    from public.curse_draws d
    cross join lateral jsonb_array_elements(d.cards) e
    where d.game_id=p_game_id and d.kept_card_keys ? (e->>'card_key') and not (d.used_card_keys ? (e->>'card_key'))
    union all
    select u.metadata->'card'->>'title'
    from public.private_card_uses u
    where u.game_id=p_game_id and u.effect_key='duplicate_copy' and u.is_active and jsonb_typeof(u.metadata->'card')='object'
  )
  select coalesce(jsonb_agg(title order by title),'[]'::jsonb) from cards where title is not null;
$$;

create or replace function public._spent_card_snapshot_v1(p_game_id uuid,p_spent_card_key text)
returns jsonb language sql stable security definer set search_path=public as $$
  select q.card from (
    select e as card,1 as ord
    from public.curse_draws d cross join lateral jsonb_array_elements(d.cards) e
    where d.game_id=p_game_id and d.used_card_keys ? p_spent_card_key and e->>'card_key'=p_spent_card_key
    union all
    select u.metadata->'card' as card,2 as ord
    from public.private_card_uses u
    where u.game_id=p_game_id and u.effect_key='duplicate_copy' and not u.is_active and u.card_key=p_spent_card_key and jsonb_typeof(u.metadata->'card')='object'
  ) q order by q.ord limit 1;
$$;

create or replace function public.get_ma48_candidates_v1(p_game_id uuid,p_password text)
returns table(spent_card_key text,title text,card jsonb)
language plpgsql security definer set search_path=public as $$
begin
  if not public._hider_password_ok(p_game_id,p_password) then raise exception 'Invalid hider password.';end if;
  return query
  with spent as (
    select e->>'card_key' as k,e->>'title' as t,e as c,d.created_at as at
    from public.curse_draws d cross join lateral jsonb_array_elements(d.cards) e
    where d.game_id=p_game_id and d.used_card_keys ? (e->>'card_key')
    union all
    select u.card_key,u.metadata->'card'->>'title',u.metadata->'card',u.created_at
    from public.private_card_uses u
    where u.game_id=p_game_id and u.effect_key='duplicate_copy' and not u.is_active and jsonb_typeof(u.metadata->'card')='object'
  )
  select distinct on (coalesce(c->>'catalog_key',c->>'effect_key',t)) k,t,c
  from spent
  where c is not null
  order by coalesce(c->>'catalog_key',c->>'effect_key',t),at desc;
end;$$;
grant execute on function public.get_ma48_candidates_v1(uuid,text) to anon,authenticated;

-- ---------------------------------------------------------------------------
-- MA48: consume the power-up, publicly reveal the current hand, then privately
-- return the chosen spent card. The revived card is intentionally absent from
-- the hand snapshot.
-- ---------------------------------------------------------------------------
create or replace function public.use_ma48_v1(
  p_game_id uuid,p_password text,p_card_key text,p_revive_card_key text
) returns text
language plpgsql security definer set search_path=public,extensions as $$
declare v_power jsonb;v_old jsonb;v_snapshot jsonb;v_new_key text;v_public_id uuid;
begin
  if not public._hider_password_ok(p_game_id,p_password) then raise exception 'Invalid hider password.';end if;
  v_power:=public._get_held_card(p_game_id,p_card_key);
  if v_power is null or v_power->>'effect_key'<>'ma48' then raise exception 'MA48 is not in your hand.';end if;
  v_old:=public._spent_card_snapshot_v1(p_game_id,p_revive_card_key);
  if v_old is null then raise exception 'That card is not in the played/discarded pile.';end if;
  if not public._consume_held_card(p_game_id,p_card_key) then raise exception 'Could not consume MA48.';end if;
  v_snapshot:=public._held_hand_titles_v1(p_game_id);
  v_new_key:='ma48-copy-'||extensions.gen_random_uuid()::text;
  insert into public.private_card_uses(game_id,card_key,effect_key,value_int,metadata,is_active)
  values(p_game_id,v_new_key,'duplicate_copy',nullif(v_old->>'value_int','')::integer,
    jsonb_build_object('card',(v_old-'card_key')||jsonb_build_object('card_key',v_new_key,'revived_by','MA48'),'origin','ma48','revived_from',p_revive_card_key),true);
  insert into public.game_actions(game_id,actor,kind,payload)
  values(p_game_id,'hider','powerup_play',jsonb_build_object(
    'effect_key','ma48','title','MA48','description','The Hider recycled one previously used card.',
    'hand_snapshot',v_snapshot,'revived_card_hidden',true
  )) returning id into v_public_id;
  return v_new_key;
end;$$;
grant execute on function public.use_ma48_v1(uuid,text,text,text) to anon,authenticated;

-- ---------------------------------------------------------------------------
-- Same Day Delivery: pay 15 min, draw 3, keep 2.
-- ---------------------------------------------------------------------------
create or replace function public.use_same_day_delivery_v1(
  p_game_id uuid,p_password text,p_card_key text,p_cost_card_keys text[]
) returns uuid
language plpgsql security definer set search_path=public,extensions as $$
declare v_card jsonb;v_key text;v_pay jsonb;v_paid integer:=0;v_action uuid;v_cards jsonb;
begin
  if not public._hider_password_ok(p_game_id,p_password) then raise exception 'Invalid hider password.';end if;
  v_card:=public._get_held_card(p_game_id,p_card_key);
  if v_card is null or v_card->>'effect_key'<>'same_day_delivery' then raise exception 'Same Day Delivery is not in your hand.';end if;
  foreach v_key in array coalesce(p_cost_card_keys,array[]::text[]) loop
    if v_key=p_card_key then raise exception 'The power-up cannot pay for itself.';end if;
    v_pay:=public._get_held_card(p_game_id,v_key);
    if v_pay is null or v_pay->>'card_kind'<>'time_bonus' then raise exception 'Same Day Delivery is paid with held time bonuses.';end if;
    v_paid:=v_paid+coalesce((v_pay->>'value_int')::integer,0);
  end loop;
  if v_paid<15 then raise exception 'Same Day Delivery costs 15 minutes of time bonuses.';end if;
  perform public._consume_held_card(p_game_id,p_card_key);
  foreach v_key in array coalesce(p_cost_card_keys,array[]::text[]) loop perform public._consume_held_card(p_game_id,v_key);end loop;
  insert into public.game_actions(game_id,actor,kind,payload)
  values(p_game_id,'hider','powerup_draw',jsonb_build_object('effect_key','same_day_delivery','title','Same Day Delivery','draw_count',3,'keep_limit',2,'cast_paid_minutes',v_paid))
  returning id into v_action;
  v_cards:=public._draw_cards_v4(p_game_id,3);
  if jsonb_array_length(v_cards)>0 then
    insert into public.curse_draws(game_id,question_action_id,cards,keep_limit)
    values(p_game_id,v_action,v_cards,least(2,jsonb_array_length(v_cards)));
  end if;
  return v_action;
end;$$;
grant execute on function public.use_same_day_delivery_v1(uuid,text,text,text[]) to anon,authenticated;

-- ---------------------------------------------------------------------------
-- Double or Nothing: doubles both a timed time-cost Curse's price and duration.
-- ---------------------------------------------------------------------------
create or replace function public.use_double_or_nothing_v1(
  p_game_id uuid,p_password text,p_powerup_card_key text,p_curse_card_key text,
  p_cost_card_keys text[] default array[]::text[],p_effect_payload jsonb default '{}'::jsonb
) returns uuid
language plpgsql security definer set search_path=public,extensions as $$
declare
  v_power jsonb;v_curse jsonb;v_pay jsonb;v_key text;v_paid integer:=0;v_cost integer;v_duration integer;
  v_payload jsonb:=coalesce(p_effect_payload,'{}'::jsonb);v_id uuid;v_now timestamptz:=now();
begin
  if not public._hider_password_ok(p_game_id,p_password) then raise exception 'Invalid hider password.';end if;
  v_power:=public._get_held_card(p_game_id,p_powerup_card_key);
  if v_power is null or v_power->>'effect_key'<>'double_or_nothing' then raise exception 'Double or Nothing is not in your hand.';end if;
  v_curse:=public._get_held_card(p_game_id,p_curse_card_key);
  if v_curse is null or v_curse->>'card_kind'<>'curse' then raise exception 'Choose a held Curse.';end if;
  if coalesce(v_curse->>'cast_cost_kind','none')<>'time' then raise exception 'Double or Nothing only works on Curses with time casting costs.';end if;
  v_cost:=coalesce(nullif(v_curse->>'cast_cost_minutes','')::integer,0);
  v_duration:=coalesce(nullif(v_curse->>'duration_seconds','')::integer,0);
  if v_cost<=0 or v_duration<=0 then raise exception 'The selected Curse must have both a time casting cost and a timer.';end if;

  if v_curse->>'effect_key'='deutsche_bahn' and coalesce(v_payload->>'blocked_line','') !~ '^[US][0-9]{1,2}$' then raise exception 'Choose the blocked U-/S-Bahn line.';end if;
  if v_curse->>'effect_key'='mordor_curse' and coalesce(v_payload->>'mode','') not in ('inside','outside') then raise exception 'Choose the Mordor mode.';end if;

  foreach v_key in array coalesce(p_cost_card_keys,array[]::text[]) loop
    if v_key=p_powerup_card_key or v_key=p_curse_card_key then raise exception 'Played cards cannot pay their own cost.';end if;
    v_pay:=public._get_held_card(p_game_id,v_key);
    if v_pay is null or v_pay->>'card_kind'<>'time_bonus' then raise exception 'Double or Nothing is paid with held time bonuses.';end if;
    v_paid:=v_paid+coalesce((v_pay->>'value_int')::integer,0);
  end loop;
  if v_paid<(v_cost*2) then raise exception 'You must pay double the Curse casting cost.';end if;

  perform public._consume_held_card(p_game_id,p_powerup_card_key);
  perform public._consume_held_card(p_game_id,p_curse_card_key);
  foreach v_key in array coalesce(p_cost_card_keys,array[]::text[]) loop perform public._consume_held_card(p_game_id,v_key);end loop;

  insert into public.game_actions(game_id,actor,kind,payload)
  values(p_game_id,'hider','curse_play',jsonb_build_object(
    'source_card_key',p_curse_card_key,'effect_key',v_curse->>'effect_key','title',v_curse->>'title','description',v_curse->>'description',
    'duration_seconds',v_duration*2,'starts_at',v_now,'ends_at',v_now+make_interval(secs=>v_duration*2),
    'cast_cost_kind','time','cast_cost_minutes',v_cost*2,'cast_paid_minutes',v_paid,'cast_cards',to_jsonb(p_cost_card_keys),
    'double_or_nothing',true,'base_duration_seconds',v_duration,'base_cast_cost_minutes',v_cost
  )||v_payload) returning id into v_id;
  return v_id;
end;$$;
grant execute on function public.use_double_or_nothing_v1(uuid,text,text,text,text[],jsonb) to anon,authenticated;

-- ---------------------------------------------------------------------------
-- Kleingedrucktes lookup and reveal. Engine payload is stored/revealed now; actual
-- engine keys can be implemented later without changing the secret-storage model.
-- ---------------------------------------------------------------------------
create or replace function public._catalog_key_for_curse_action_v1(p_game_id uuid,p_action_id uuid)
returns text language plpgsql stable security definer set search_path=public as $$
declare v_a public.game_actions%rowtype;v_source text;v_key text;
begin
  select * into v_a from public.game_actions where id=p_action_id and game_id=p_game_id and kind='curse_play';
  if not found then return null;end if;
  v_source:=v_a.payload->>'source_card_key';
  if position('::' in coalesce(v_source,''))>0 then
    v_key:=split_part(v_source,'::',1);
    if exists(select 1 from public.curse_cards where card_key=v_key) then return v_key;end if;
  end if;
  select u.metadata->'card'->>'catalog_key' into v_key from public.private_card_uses u
  where u.game_id=p_game_id and u.card_key=v_source and jsonb_typeof(u.metadata->'card')='object' order by u.created_at desc limit 1;
  if v_key is not null then return v_key;end if;
  select c.card_key into v_key from public.curse_cards c
  where c.effect_key=v_a.payload->>'effect_key' and lower(c.title)=lower(coalesce(v_a.payload->>'title',c.title))
  order by c.card_key limit 1;
  return v_key;
end;$$;

create or replace function public.get_kleingedrucktes_targets_v1(p_game_id uuid,p_password text)
returns table(action_id uuid,title text,effect_mode text,effect_text text,engine_key text,engine_payload jsonb)
language plpgsql security definer set search_path=public as $$
declare a public.game_actions%rowtype;v_key text;s public.card_secondary_effects%rowtype;
begin
  if not public._hider_password_ok(p_game_id,p_password) then raise exception 'Invalid hider password.';end if;
  for a in select * from public.game_actions x
    where x.game_id=p_game_id and x.kind='curse_play' and x.is_active
      and (x.payload->>'ends_at' is null or (x.payload->>'ends_at')::timestamptz>now())
      and not exists(select 1 from public.game_actions cc where cc.parent_id=x.id and cc.kind='curse_complete' and cc.is_active)
    order by x.created_at desc
  loop
    v_key:=public._catalog_key_for_curse_action_v1(p_game_id,a.id);
    if v_key is null then continue;end if;
    select * into s from public.card_secondary_effects where card_key=v_key and effect_mode<>'none';
    if found then
      action_id:=a.id;title:=coalesce(a.payload->>'title','Curse');effect_mode:=s.effect_mode;effect_text:=s.effect_text;engine_key:=s.engine_key;engine_payload:=s.engine_payload;return next;
    end if;
  end loop;
end;$$;
grant execute on function public.get_kleingedrucktes_targets_v1(uuid,text) to anon,authenticated;

create or replace function public.use_kleingedrucktes_v1(
  p_game_id uuid,p_password text,p_card_key text,p_target_action_id uuid
) returns uuid
language plpgsql security definer set search_path=public as $$
declare v_card jsonb;v_target public.game_actions%rowtype;v_catalog text;v_s public.card_secondary_effects%rowtype;v_id uuid;
begin
  if not public._hider_password_ok(p_game_id,p_password) then raise exception 'Invalid hider password.';end if;
  v_card:=public._get_held_card(p_game_id,p_card_key);
  if v_card is null or v_card->>'effect_key'<>'kleingedrucktes' then raise exception 'Kleingedrucktes is not in your hand.';end if;
  select * into v_target from public.game_actions where id=p_target_action_id and game_id=p_game_id and kind='curse_play' and is_active;
  if not found or (v_target.payload->>'ends_at' is not null and (v_target.payload->>'ends_at')::timestamptz<=now()) then raise exception 'Choose a currently active Curse.';end if;
  v_catalog:=public._catalog_key_for_curse_action_v1(p_game_id,p_target_action_id);
  select * into v_s from public.card_secondary_effects where card_key=v_catalog and effect_mode<>'none';
  if not found then raise exception 'That Curse has no hidden secondary effect.';end if;
  perform public._consume_held_card(p_game_id,p_card_key);
  insert into public.game_actions(game_id,actor,kind,parent_id,payload)
  values(p_game_id,'hider','powerup_play',p_target_action_id,jsonb_build_object(
    'effect_key','kleingedrucktes','title','Kleingedrucktes','target_title',coalesce(v_target.payload->>'title','Curse'),
    'secondary_effect_mode',v_s.effect_mode,'secondary_effect_text',v_s.effect_text,
    'secondary_engine_key',v_s.engine_key,'secondary_engine_payload',v_s.engine_payload
  )) returning id into v_id;
  return v_id;
end;$$;
grant execute on function public.use_kleingedrucktes_v1(uuid,text,text,uuid) to anon,authenticated;

-- ---------------------------------------------------------------------------
-- Deceptive Tiny House. It is private until Endgame begins.
-- ---------------------------------------------------------------------------
create or replace function public._tiny_house_count_v1(p_game_id uuid)
returns integer language sql stable security definer set search_path=public as $$
  select count(*)::integer from public.private_card_uses
  where game_id=p_game_id and effect_key='deceptive_tiny_house' and is_active;
$$;

create or replace function public._reveal_tiny_houses_v1(p_game_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare u public.private_card_uses%rowtype;v_id uuid;
begin
  for u in select * from public.private_card_uses
    where game_id=p_game_id and effect_key='deceptive_tiny_house' and is_active
      and coalesce((metadata->>'revealed')::boolean,false)=false
    order by created_at
  loop
    insert into public.game_actions(game_id,actor,kind,payload)
    values(p_game_id,'system','curse_play',jsonb_build_object(
      'effect_key','deceptive_tiny_house','title','Curse of the Deceptive Tiny House',
      'description','The Hider previously activated Deceptive Tiny House. One next-question answer could have been a lie. The final hiding radius is reduced to one third.',
      'revealed_at_endgame',true,'tiny_house_factor',0.3333333333333333
    )) returning id into v_id;
    update public.private_card_uses set metadata=metadata||jsonb_build_object('revealed',true,'reveal_action_id',v_id,'revealed_at',now()) where id=u.id;
  end loop;
end;$$;

create or replace function public.use_deceptive_tiny_house_v1(
  p_game_id uuid,p_password text,p_card_key text
) returns uuid
language plpgsql security definer set search_path=public,extensions as $$
declare v_card jsonb;v_id uuid;v_endgame boolean;v_public_endgame boolean;
begin
  if not public._hider_password_ok(p_game_id,p_password) then raise exception 'Invalid hider password.';end if;
  v_card:=public._get_held_card(p_game_id,p_card_key);
  if v_card is null or v_card->>'effect_key'<>'deceptive_tiny_house' then raise exception 'Deceptive Tiny House is not in your hand.';end if;
  perform public._consume_held_card(p_game_id,p_card_key);
  insert into public.private_card_uses(game_id,card_key,effect_key,value_int,metadata,is_active)
  values(p_game_id,'tiny-house-'||extensions.gen_random_uuid()::text,'deceptive_tiny_house',null,
    jsonb_build_object('card',v_card,'lie_consumed',false,'played_at',now(),'revealed',false),true)
  returning id into v_id;
  select endgame into v_endgame from public.game_secrets where game_id=p_game_id;
  select exists(select 1 from public.game_actions where game_id=p_game_id and kind='endgame_zone' and is_active) into v_public_endgame;
  -- The Hider's Endgame toggle is private. Reveal only once the Seekers themselves enter public Endgame.
  if v_public_endgame then perform public._reveal_tiny_houses_v1(p_game_id);end if;
  return v_id;
end;$$;
grant execute on function public.use_deceptive_tiny_house_v1(uuid,text,text) to anon,authenticated;

-- ---------------------------------------------------------------------------
-- Turntables relocation: preserve history, reset the target phase, and mark the
-- next three answered questions as rewardless.
-- ---------------------------------------------------------------------------
create or replace function public.relocate_turntables_v1(
  p_game_id uuid,p_password text,p_curse_action_id uuid,
  p_station_name text,p_station_lat double precision,p_station_lng double precision
) returns uuid
language plpgsql security definer set search_path=public,extensions as $$
declare
  v_curse public.game_actions%rowtype;v_old_name text;v_old_lat double precision;v_old_lng double precision;
  v_id uuid;v_end timestamptz;
begin
  if not public._hider_password_ok(p_game_id,p_password) then raise exception 'Invalid hider password.';end if;
  select * into v_curse from public.game_actions
  where id=p_curse_action_id and game_id=p_game_id and kind='curse_play' and is_active and payload->>'effect_key'='turntables'
  for update;
  if not found then raise exception 'Active Turntables curse not found.';end if;
  v_end:=nullif(v_curse.payload->>'ends_at','')::timestamptz;
  if v_end is null or now()>v_end then raise exception 'The 20-minute relocation window has expired.';end if;
  if exists(select 1 from public.game_actions where game_id=p_game_id and kind='turntables_relocate' and parent_id=p_curse_action_id and is_active) then raise exception 'A new station has already been selected for this Turntables card.';end if;
  if char_length(trim(coalesce(p_station_name,'')))<1 then raise exception 'Choose a station.';end if;
  if p_station_lat not between -90 and 90 or p_station_lng not between -180 and 180 then raise exception 'Invalid station coordinate.';end if;
  select station_name,station_lat,station_lng into v_old_name,v_old_lat,v_old_lng from public.game_secrets where game_id=p_game_id for update;
  if lower(trim(coalesce(v_old_name,'')))=lower(trim(p_station_name)) or (abs(coalesce(v_old_lat,999)-p_station_lat)<0.00025 and abs(coalesce(v_old_lng,999)-p_station_lng)<0.00035) then raise exception 'Turntables requires another hiding station.';end if;

  update public.game_secrets set station_name=trim(p_station_name),station_lat=p_station_lat,station_lng=p_station_lng,hidden_lat=null,hidden_lng=null,endgame=false,base_radius_m=250 where game_id=p_game_id;
  update public.game_actions set is_active=false where game_id=p_game_id and kind='endgame_zone' and is_active;
  update public.game_actions set is_active=false,payload=payload||jsonb_build_object('reset_by_turntables',p_curse_action_id,'reset_at',now())
  where game_id=p_game_id and kind='curse_play' and is_active and payload->>'effect_key'='prosperous_home';

  insert into public.game_actions(game_id,actor,kind,parent_id,payload)
  values(p_game_id,'hider','turntables_relocate',p_curse_action_id,jsonb_build_object(
    'effect_key','turntables','relocated_at',now(),'target_phase_reset',true,'rewardless_questions',3
  )) returning id into v_id;
  return v_id;
end;$$;
grant execute on function public.relocate_turntables_v1(uuid,text,uuid,text,double precision,double precision) to anon,authenticated;

-- ---------------------------------------------------------------------------
-- Answers: first 3 answers after latest Turntables relocation draw zero cards.
-- Also consume the next-question lie permission of one armed Tiny House, while
-- keeping the card active for its final-radius penalty.
-- ---------------------------------------------------------------------------
create or replace function public.answer_question_v5(p_game_id uuid,p_question_action_id uuid,p_password text,p_answer jsonb)
returns uuid
language plpgsql security definer set search_path=public,extensions as $$
declare
  v_answer_id uuid;v_cards jsonb;v_kind text;v_draw_count integer;v_keep_limit integer;
  v_penalty integer;v_now timestamptz:=now();v_reloc_time timestamptz;v_rewardless_limit integer:=0;v_question_ordinal integer:=0;v_suppress boolean:=false;
  v_tiny_id uuid;v_question_time timestamptz;
begin
  if not public._hider_password_ok(p_game_id,p_password) then raise exception 'Invalid hider password.';end if;
  select q.payload->>'question_kind',q.created_at into v_kind,v_question_time from public.game_actions q
  where q.id=p_question_action_id and q.game_id=p_game_id and q.kind='question' and q.is_active;
  if v_kind is null then raise exception 'Question is not active.';end if;
  if exists(select 1 from public.game_actions a where a.parent_id=p_question_action_id and a.kind in('answer','question_veto') and a.is_active) then raise exception 'Question already has an active answer/veto.';end if;

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

  -- Resolve the private Tiny House permission BEFORE inserting the public answer.
  -- Otherwise this question would immediately cease to be "unanswered" and could
  -- no longer be identified as the protected next question.
  select u.id into v_tiny_id from public.private_card_uses u
  where u.game_id=p_game_id and u.effect_key='deceptive_tiny_house' and u.is_active
    and coalesce((u.metadata->>'lie_consumed')::boolean,false)=false
    and v_question_time>coalesce((u.metadata->>'played_at')::timestamptz,u.created_at)
    and p_question_action_id=(
      select q2.id from public.game_actions q2
      where q2.game_id=p_game_id and q2.kind='question' and q2.is_active
        and q2.created_at>coalesce((u.metadata->>'played_at')::timestamptz,u.created_at)
        and not exists(select 1 from public.game_actions rr where rr.parent_id=q2.id and rr.kind in ('answer','question_veto') and rr.is_active)
      order by q2.created_at limit 1
    )
  order by u.created_at limit 1 for update;

  v_penalty:=coalesce(public._question_late_penalty_minutes_v1(p_question_action_id,v_now),0);
  insert into public.game_actions(game_id,actor,kind,parent_id,payload)
  values(p_game_id,'hider','answer',p_question_action_id,jsonb_build_object(
    'answer',coalesce(p_answer,'{}'::jsonb),'answered_at',v_now,'late_penalty_minutes',v_penalty,
    'reward_suppressed',v_suppress,'reward_suppressed_reason',case when v_suppress then 'turntables' else null end
  )) returning id into v_answer_id;

  if v_tiny_id is not null then
    update public.private_card_uses set metadata=metadata||jsonb_build_object('lie_consumed',true,'consumed_on_question',p_question_action_id,'consumed_at',v_now) where id=v_tiny_id;
  end if;

  if not v_suppress then
    if v_kind in('radar','thermometer') then v_draw_count:=2;v_keep_limit:=1;
    elsif v_kind='tentacle' then v_draw_count:=4;v_keep_limit:=2;
    else v_draw_count:=3;v_keep_limit:=1;
    end if;
    if not exists(select 1 from public.curse_draws where question_action_id=p_question_action_id) then
      v_cards:=public._draw_cards_v4(p_game_id,v_draw_count);
      if jsonb_array_length(v_cards)>0 then
        insert into public.curse_draws(game_id,question_action_id,cards,keep_limit)
        values(p_game_id,p_question_action_id,v_cards,v_keep_limit) on conflict(question_action_id) do nothing;
      end if;
    end if;
  end if;
  return v_answer_id;
end;$$;
grant execute on function public.answer_question_v5(uuid,uuid,text,jsonb) to anon,authenticated;

-- ---------------------------------------------------------------------------
-- Endgame validation/reveal with Tiny House radius factor (radius x 1/3 per card).
-- ---------------------------------------------------------------------------
create or replace function public.set_hider_endgame_target_v1(
  p_game_id uuid,p_password text,p_endgame boolean,
  p_hidden_lat double precision default null,p_hidden_lng double precision default null
) returns boolean
language plpgsql security definer set search_path=public,extensions as $$
declare
  v_station_lat double precision;v_station_lng double precision;v_base integer;
  v_dist_m double precision;v_home_count integer;v_tiny_count integer;v_limit_m double precision;
begin
  if not public._hider_password_ok(p_game_id,p_password) then raise exception 'Invalid hider password.';end if;
  if not p_endgame then update public.game_secrets set endgame=false where game_id=p_game_id;return true;end if;
  if p_hidden_lat is null or p_hidden_lng is null then raise exception 'Choose the actual hiding location first.';end if;
  select station_lat,station_lng,base_radius_m into v_station_lat,v_station_lng,v_base from public.game_secrets where game_id=p_game_id;
  if v_station_lat is null or v_station_lng is null then raise exception 'Game has no hiding station.';end if;
  select count(*) into v_home_count from public.game_actions where game_id=p_game_id and kind='curse_play' and is_active and payload->>'effect_key'='prosperous_home';
  v_tiny_count:=public._tiny_house_count_v1(p_game_id);
  v_limit_m:=coalesce(v_base,250)*sqrt(power(2.0,v_home_count))*power(1.0/3.0,v_tiny_count);
  v_dist_m:=6371000*2*asin(sqrt(power(sin(radians(p_hidden_lat-v_station_lat)/2),2)+cos(radians(v_station_lat))*cos(radians(p_hidden_lat))*power(sin(radians(p_hidden_lng-v_station_lng)/2),2)));
  if v_dist_m>v_limit_m+0.5 then raise exception 'Actual hiding spot is % m from the station; current maximum is % m.',round(v_dist_m)::integer,round(v_limit_m)::integer;end if;
  update public.game_secrets set hidden_lat=p_hidden_lat,hidden_lng=p_hidden_lng,endgame=true where game_id=p_game_id;
  return true;
end;$$;
grant execute on function public.set_hider_endgame_target_v1(uuid,text,boolean,double precision,double precision) to anon,authenticated;

create or replace function public.start_seeker_endgame_v1(
  p_game_id uuid,p_station_name text,p_station_lat double precision,p_station_lng double precision
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid;
begin
  if not exists(select 1 from public.games where id=p_game_id and status='active') then raise exception 'Game is not active.';end if;
  if public._turntables_active(p_game_id) then raise exception 'Seekers are frozen by Curse of the Turntables.';end if;
  perform public._reveal_tiny_houses_v1(p_game_id);
  update public.game_actions set is_active=false where game_id=p_game_id and kind='endgame_zone' and is_active;
  insert into public.game_actions(game_id,actor,kind,payload)
  values(p_game_id,'seeker','endgame_zone',jsonb_build_object(
    'station_name',p_station_name,'center',jsonb_build_object('lat',p_station_lat,'lng',p_station_lng),'base_radius_m',250,'dynamic_radius',true
  )) returning id into v_id;
  return v_id;
end;$$;
grant execute on function public.start_seeker_endgame_v1(uuid,text,double precision,double precision) to anon,authenticated;
