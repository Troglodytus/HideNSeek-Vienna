-- Hide & Seek: Vienna v3.9.0
-- Catalogue counts for cards, question catalogue/editor, and finite-deck expansion.
-- Run ONCE after v3.8.0.

-- ---------------------------------------------------------------------------
-- Card catalogue: one row per card TYPE, with a physical-copy count.
-- ---------------------------------------------------------------------------
alter table public.curse_cards add column if not exists deck_count integer not null default 1;
alter table public.curse_cards drop constraint if exists curse_cards_deck_count_check;
alter table public.curse_cards add constraint curse_cards_deck_count_check check (deck_count between 0 and 50);

-- Collapse old physical duplicate rows that have identical rules into one catalogue
-- definition. Existing already-drawn JSON snapshots remain self-contained.
create temporary table _hns_card_groups as
select
  min(card_key) as keep_key,
  count(*) filter (where coalesce(enabled,true))::integer as copies,
  title,description,duration_seconds,card_kind,effect_key,value_int,
  coalesce(cast_cost_minutes,0) as cast_cost_minutes,
  coalesce(cast_cost_kind,'none') as cast_cost_kind,
  coalesce(cast_cost_text,'') as cast_cost_text,
  bool_or(coalesce(enabled,true)) as any_enabled
from public.curse_cards
group by title,description,duration_seconds,card_kind,effect_key,value_int,
         coalesce(cast_cost_minutes,0),coalesce(cast_cost_kind,'none'),coalesce(cast_cost_text,'');

update public.curse_cards c
set deck_count=g.copies,
    enabled=g.any_enabled
from _hns_card_groups g
where c.card_key=g.keep_key;

delete from public.curse_cards c
using _hns_card_groups g
where c.card_key<>g.keep_key
  and c.title=g.title
  and c.description=g.description
  and c.duration_seconds is not distinct from g.duration_seconds
  and c.card_kind=g.card_kind
  and c.effect_key is not distinct from g.effect_key
  and c.value_int is not distinct from g.value_int
  and coalesce(c.cast_cost_minutes,0)=g.cast_cost_minutes
  and coalesce(c.cast_cost_kind,'none')=g.cast_cost_kind
  and coalesce(c.cast_cost_text,'')=g.cast_cost_text;

update public.curse_cards set enabled=(deck_count>0);

drop table if exists _hns_card_groups;

-- Reset only the undrawn pile. Held cards remain in curse_draws snapshots.
delete from public.game_card_state;

create or replace function public.admin_list_cards_v2(p_password text)
returns table(
  card_key text,title text,description text,duration_seconds integer,
  card_kind text,effect_key text,value_int integer,cast_cost_minutes integer,
  cast_cost_kind text,cast_cost_text text,enabled boolean,deck_count integer,
  special_engine boolean
)
language plpgsql security definer set search_path=public,extensions as $$
begin
  if not public._admin_password_ok(p_password) then
    perform pg_sleep(0.35); raise exception 'Invalid developer password.';
  end if;
  return query
  select c.card_key,c.title,c.description,c.duration_seconds,c.card_kind,c.effect_key,c.value_int,
         c.cast_cost_minutes,c.cast_cost_kind,c.cast_cost_text,c.enabled,c.deck_count,
         (c.effect_key in ('prosperous_home','duplicate','reshuffle_deck','time_trap','veto_question')) as special_engine
  from public.curse_cards c
  order by
    case when c.effect_key in ('prosperous_home','duplicate','reshuffle_deck','time_trap','veto_question') then 9
         when c.card_kind='time_bonus' then 1 when c.card_kind='curse' then 2 else 3 end,
    c.title,c.card_key;
end;$$;
grant execute on function public.admin_list_cards_v2(text) to anon,authenticated;

create or replace function public.admin_save_card_v2(
  p_password text,p_card_key text,p_title text,p_description text,
  p_duration_seconds integer,p_card_kind text,p_effect_key text,p_value_int integer,
  p_cast_cost_kind text,p_cast_cost_minutes integer,p_cast_cost_text text,
  p_deck_count integer
) returns text
language plpgsql security definer set search_path=public,extensions as $$
declare v_key text;v_special boolean;
begin
  if not public._admin_password_ok(p_password) then perform pg_sleep(0.35);raise exception 'Invalid developer password.';end if;
  if char_length(trim(coalesce(p_title,''))) not between 1 and 120 then raise exception 'Card title must be 1-120 characters.';end if;
  if char_length(trim(coalesce(p_description,''))) not between 1 and 1200 then raise exception 'Card text must be 1-1200 characters.';end if;
  if p_card_kind not in ('curse','powerup','time_bonus','time_trap') then raise exception 'Invalid card type.';end if;
  if p_cast_cost_kind not in ('none','time','custom') then raise exception 'Invalid casting-cost type.';end if;
  if coalesce(p_deck_count,-1) not between 0 and 50 then raise exception 'Deck count must be 0-50.';end if;
  if p_duration_seconds is not null and p_duration_seconds<0 then raise exception 'Invalid duration.';end if;
  if p_cast_cost_kind='time' and (coalesce(p_cast_cost_minutes,0)<=0 or p_cast_cost_minutes%5<>0 or p_cast_cost_minutes>120) then raise exception 'Time casting cost must be 5-120 minutes in 5-minute steps.';end if;
  if p_cast_cost_kind='custom' and char_length(trim(coalesce(p_cast_cost_text,'')))<1 then raise exception 'Enter the custom casting cost.';end if;

  v_key=nullif(trim(coalesce(p_card_key,'')),'');
  if v_key is null then v_key='custom-'||replace(extensions.gen_random_uuid()::text,'-',''); end if;

  -- Engine-driven cards keep their effect key/type/value. Their presentation and
  -- copy count can still be changed safely.
  select effect_key in ('prosperous_home','duplicate','reshuffle_deck','time_trap','veto_question') into v_special
  from public.curse_cards where card_key=v_key;
  if coalesce(v_special,false) then
    update public.curse_cards set
      title=trim(p_title),description=trim(p_description),duration_seconds=p_duration_seconds,
      cast_cost_minutes=case when p_cast_cost_kind='time' then p_cast_cost_minutes else 0 end,
      cast_cost_kind=p_cast_cost_kind,
      cast_cost_text=case when p_cast_cost_kind='custom' then trim(p_cast_cost_text) else null end,
      deck_count=p_deck_count,enabled=(p_deck_count>0)
    where card_key=v_key;
    return v_key;
  end if;

  insert into public.curse_cards(
    card_key,title,description,duration_seconds,card_kind,effect_key,value_int,
    cast_cost_minutes,cast_cost_kind,cast_cost_text,enabled,deck_count
  ) values(
    v_key,trim(p_title),trim(p_description),p_duration_seconds,p_card_kind,
    coalesce(nullif(trim(coalesce(p_effect_key,'')),''),'custom_rule'),p_value_int,
    case when p_cast_cost_kind='time' then p_cast_cost_minutes else 0 end,
    p_cast_cost_kind,case when p_cast_cost_kind='custom' then trim(p_cast_cost_text) else null end,
    (p_deck_count>0),p_deck_count
  ) on conflict(card_key) do update set
    title=excluded.title,description=excluded.description,duration_seconds=excluded.duration_seconds,
    card_kind=excluded.card_kind,effect_key=excluded.effect_key,value_int=excluded.value_int,
    cast_cost_minutes=excluded.cast_cost_minutes,cast_cost_kind=excluded.cast_cost_kind,
    cast_cost_text=excluded.cast_cost_text,enabled=excluded.enabled,deck_count=excluded.deck_count;
  return v_key;
end;$$;
grant execute on function public.admin_save_card_v2(text,text,text,text,integer,text,text,integer,text,integer,text,integer) to anon,authenticated;

-- Build a finite pile by expanding each catalogue definition deck_count times.
-- Each physical copy gets a unique instance key, while catalog_key points back to
-- its editable definition.
create or replace function public._reshuffle_card_deck_v1(p_game_id uuid)
returns integer language plpgsql security definer set search_path=public,extensions as $$
declare v_deck jsonb;v_cycle integer;
begin
  with held as (
    select e
    from public.curse_draws d
    cross join lateral jsonb_array_elements(d.cards) e
    where d.game_id=p_game_id
      and d.kept_card_keys ? (e->>'card_key')
      and not(d.used_card_keys ? (e->>'card_key'))
  ), available as (
    select c.*,
      greatest(0,c.deck_count-(
        select count(*) from held h
        where coalesce(h.e->>'catalog_key','')=c.card_key
           or (
             coalesce(h.e->>'catalog_key','')=''
             and h.e->>'title'=c.title
             and h.e->>'effect_key' is not distinct from c.effect_key
             and coalesce(nullif(h.e->>'value_int','')::integer,-2147483648)=coalesce(c.value_int,-2147483648)
           )
      ))::integer as available_count
    from public.curse_cards c
    where c.enabled and c.deck_count>0
  ), expanded as (
    select a.card_key as catalog_key,extensions.gen_random_uuid()::text as instance_uuid
    from available a
    cross join lateral generate_series(1,a.available_count) g
  )
  select coalesce(jsonb_agg(catalog_key||'::'||instance_uuid order by random()),'[]'::jsonb) into v_deck
  from expanded;

  insert into public.game_card_state(game_id,cycle,deck,cursor,updated_at)
  values(p_game_id,1,v_deck,0,now())
  on conflict(game_id) do update set cycle=public.game_card_state.cycle+1,deck=excluded.deck,cursor=0,updated_at=now()
  returning cycle into v_cycle;
  return v_cycle;
end;$$;

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
        'card_key',v_instance_key,'catalog_key',v_card.card_key,
        'title',v_card.title,'description',v_card.description,
        'duration_seconds',v_card.duration_seconds,'card_kind',v_card.card_kind,
        'effect_key',v_card.effect_key,'value_int',v_card.value_int,
        'cast_cost_minutes',v_card.cast_cost_minutes,'cast_cost_kind',v_card.cast_cost_kind,
        'cast_cost_text',v_card.cast_cost_text));
    end if;
  end loop;
  return v_result;
end;$$;

-- ---------------------------------------------------------------------------
-- Editable question catalogue.
-- ---------------------------------------------------------------------------
create table if not exists public.question_catalog(
  question_key text primary key,
  category text not null check(category in ('MIXED','RADAR','THERMOMETER','TENTACLES','PHOTO')),
  title text not null,
  description text not null default '',
  question_kind text not null check(question_kind in ('radar','district','district_set','landmark_compare','directional','same_line','thermometer','tentacle','photo','street_shape')),
  params jsonb not null default '{}'::jsonb check(jsonb_typeof(params)='object'),
  endgame_only boolean not null default false,
  enabled boolean not null default true,
  sort_order integer not null default 100,
  updated_at timestamptz not null default now()
);
alter table public.question_catalog enable row level security;
drop policy if exists "question catalogue readable by everyone" on public.question_catalog;
create policy "question catalogue readable by everyone" on public.question_catalog for select to anon,authenticated using(true);
grant select on public.question_catalog to anon,authenticated;
revoke insert,update,delete on public.question_catalog from anon,authenticated;

insert into public.question_catalog(question_key,category,title,description,question_kind,params,endgame_only,sort_order) values
('same-district','MIXED','Same District','Same Vienna district?','district','{}',false,10),
('same-line','MIXED','On This U-/S-Bahn Line?','Choose a line. Is the hiding station served by it?','same_line','{}',false,20),
('street-shape','MIXED','Current Street Shape','Receive a hand-drawn outline of the Hider''s nearest street.','street_shape','{}',true,30),
('transdanubia','MIXED','In Mordor?','Is the target across the Danube in district 21 or 22?','district_set','{"districts":[21,22],"yes_label":"Yes","no_label":"No"}',false,40),
('inner-districts','MIXED','Inner Districts?','Is the target in districts 1-9?','district_set','{"districts":[1,2,3,4,5,6,7,8,9],"yes_label":"Yes","no_label":"No"}',false,50),
('stephansdom-benchmark','MIXED','Closer to Stephansdom?','Is the target closer to Stephansdom than you are?','landmark_compare','{"landmark_name":"Stephansdom","landmark":{"lat":48.20849,"lng":16.37208}}',false,60),
('schoenbrunn-benchmark','MIXED','Closer to Schönbrunn?','Is the target closer to Schönbrunn Palace than you are?','landmark_compare','{"landmark_name":"Schönbrunn Palace","landmark":{"lat":48.18452,"lng":16.31217}}',false,70),
('donauturm-benchmark','MIXED','Closer to Donauturm?','Is the target closer to Donauturm than you are?','landmark_compare','{"landmark_name":"Donauturm","landmark":{"lat":48.24035,"lng":16.41008}}',false,80),
('riesenrad-benchmark','MIXED','Closer to the Riesenrad?','Is the target closer to the Wiener Riesenrad than you are?','landmark_compare','{"landmark_name":"Wiener Riesenrad","landmark":{"lat":48.21667,"lng":16.39588}}',false,90),
('north-of-me','MIXED','North of Me?','Is the target north of your position?','directional','{"axis":"lat","positive_label":"North","negative_label":"South"}',false,100),
('east-of-me','MIXED','East of Me?','Is the target east of your position?','directional','{"axis":"lng","positive_label":"East","negative_label":"West"}',false,110),
('radar-20000','RADAR','20 km Radar','Is the target within 20 km of this location?','radar','{"radius_m":20000}',false,200),
('radar-10000','RADAR','10 km Radar','Is the target within 10 km of this location?','radar','{"radius_m":10000}',false,210),
('radar-5000','RADAR','5 km Radar','Is the target within 5 km of this location?','radar','{"radius_m":5000}',false,220),
('radar-1000','RADAR','1 km Radar','Is the target within 1 km of this location?','radar','{"radius_m":1000}',false,230),
('radar-500','RADAR','500 m Radar','Is the target within 500 m of this location?','radar','{"radius_m":500}',false,240),
('radar-100','RADAR','100 m Radar','Is the target within 100 m of this location?','radar','{"radius_m":100}',false,250),
('thermo-250','THERMOMETER','250 m Thermometer','Start here; after moving at least 250 m ask whether you are warmer.','thermometer','{"min_travel_m":250}',false,300),
('thermo-500','THERMOMETER','500 m Thermometer','Start here; after moving at least 500 m ask whether you are warmer.','thermometer','{"min_travel_m":500}',false,310),
('thermo-2000','THERMOMETER','2 km Thermometer','Start here; after moving at least 2 km ask whether you are warmer.','thermometer','{"min_travel_m":2000}',false,320),
('tentacle-museums','TENTACLES','Museums','5 km Tentacle.','tentacle','{"poi_type":"museum"}',true,400),
('tentacle-parks','TENTACLES','Parks','5 km Tentacle.','tentacle','{"poi_type":"park"}',true,410),
('tentacle-libraries','TENTACLES','Libraries','5 km Tentacle.','tentacle','{"poi_type":"library"}',true,420),
('tentacle-cinemas','TENTACLES','Movie Theaters','5 km Tentacle.','tentacle','{"poi_type":"cinema"}',true,430),
('tentacle-hospitals','TENTACLES','Hospitals','5 km Tentacle.','tentacle','{"poi_type":"hospital"}',true,440),
('tentacle-cemeteries','TENTACLES','Cemeteries / Graveyards','5 km Tentacle.','tentacle','{"poi_type":"cemetery"}',true,450),
('tentacle-churches','TENTACLES','Churches','5 km Tentacle.','tentacle','{"poi_type":"church"}',true,460),
('tentacle-zoos','TENTACLES','Zoos / Aquariums','5 km Tentacle.','tentacle','{"poi_type":"zoo"}',true,470),
('photo-water','PHOTO','Biggest body of water','Send a photo of the biggest body of water visible from the hiding area.','photo','{"photo_prompt":"Biggest body of water"}',false,500),
('photo-structure','PHOTO','Highest visible structure','Send a photo of the highest visible structure.','photo','{"photo_prompt":"Highest visible structure"}',false,510),
('photo-selfie','PHOTO','Selfie','Send a current selfie from the hiding location.','photo','{"photo_prompt":"Selfie"}',false,520),
('photo-four-houses','PHOTO','At least 4 houses in one image','One photo with at least four houses.','photo','{"photo_prompt":"At least 4 houses in one image"}',false,530),
('photo-lamp','PHOTO','Closest street light','Photograph the closest street light or lamp to the hiding spot.','photo','{"photo_prompt":"Closest street light / lamp"}',false,540),
('photo-up','PHOTO','View straight up','Photograph the view straight upward.','photo','{"photo_prompt":"View straight up"}',false,550)
on conflict(question_key) do nothing;

create or replace function public.admin_list_questions_v1(p_password text)
returns table(
  question_key text,category text,title text,description text,question_kind text,
  params jsonb,endgame_only boolean,enabled boolean,sort_order integer,updated_at timestamptz
)
language plpgsql security definer set search_path=public,extensions as $$
begin
  if not public._admin_password_ok(p_password) then perform pg_sleep(0.35);raise exception 'Invalid developer password.';end if;
  return query select q.question_key,q.category,q.title,q.description,q.question_kind,q.params,q.endgame_only,q.enabled,q.sort_order,q.updated_at
  from public.question_catalog q order by q.sort_order,q.title;
end;$$;
grant execute on function public.admin_list_questions_v1(text) to anon,authenticated;

create or replace function public.admin_save_question_v1(
  p_password text,p_question_key text,p_category text,p_title text,p_description text,
  p_question_kind text,p_params jsonb,p_endgame_only boolean,p_enabled boolean,p_sort_order integer
) returns text
language plpgsql security definer set search_path=public,extensions as $$
declare v_key text;
begin
  if not public._admin_password_ok(p_password) then perform pg_sleep(0.35);raise exception 'Invalid developer password.';end if;
  if p_category not in ('MIXED','RADAR','THERMOMETER','TENTACLES','PHOTO') then raise exception 'Invalid question category.';end if;
  if p_question_kind not in ('radar','district','district_set','landmark_compare','directional','same_line','thermometer','tentacle','photo','street_shape') then raise exception 'Invalid question rule type.';end if;
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

create or replace function public.admin_delete_question_v1(p_password text,p_question_key text)
returns boolean language plpgsql security definer set search_path=public,extensions as $$
begin
  if not public._admin_password_ok(p_password) then perform pg_sleep(0.35);raise exception 'Invalid developer password.';end if;
  delete from public.question_catalog where question_key=p_question_key;
  return found;
end;$$;
grant execute on function public.admin_delete_question_v1(text,text) to anon,authenticated;
