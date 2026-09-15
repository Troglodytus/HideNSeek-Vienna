-- Hide & Seek: Vienna v3.13.2
-- Performance-only migration.
-- Heavy map polygons are cached separately from game_actions so realtime/poll reloads
-- never have to repeatedly download and parse huge geometry payloads.

create table if not exists public.game_geometry_cache (
  game_id uuid not null references public.games(id) on delete cascade,
  question_action_id uuid not null references public.game_actions(id) on delete cascade,
  cache_key text not null,
  domain_signature text not null,
  geometry jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (game_id, cache_key)
);

create index if not exists game_geometry_cache_question_idx
  on public.game_geometry_cache(question_action_id);

alter table public.game_geometry_cache enable row level security;
revoke all on table public.game_geometry_cache from anon, authenticated;

-- Hider-only pre-answer storage. The geometry remains completely private until an active
-- answer explicitly references its cache_key.
create or replace function public.save_question_geometry_v1(
  p_game_id uuid,
  p_question_action_id uuid,
  p_password text,
  p_cache_key text,
  p_domain_signature text,
  p_geometry jsonb
) returns text
language plpgsql security definer set search_path=public,extensions as $$
begin
  if not public._hider_password_ok(p_game_id,p_password) then raise exception 'Invalid hider password.';end if;
  if not exists(
    select 1 from public.game_actions q
    where q.id=p_question_action_id and q.game_id=p_game_id and q.kind='question' and q.is_active
  ) then raise exception 'Question not found.';end if;
  if char_length(coalesce(p_cache_key,''))<8 or char_length(p_cache_key)>180 then raise exception 'Invalid geometry cache key.';end if;
  if char_length(coalesce(p_domain_signature,''))<2 then raise exception 'Invalid geometry domain signature.';end if;
  if p_geometry is null or jsonb_typeof(p_geometry)<>'object' or coalesce(p_geometry->>'type','')<>'Feature' then raise exception 'Invalid geometry.';end if;
  if octet_length(p_geometry::text)>4000000 then raise exception 'Geometry cache item is too large.';end if;

  insert into public.game_geometry_cache(game_id,question_action_id,cache_key,domain_signature,geometry,updated_at)
  values(p_game_id,p_question_action_id,p_cache_key,p_domain_signature,p_geometry,now())
  on conflict(game_id,cache_key) do update set
    question_action_id=excluded.question_action_id,
    domain_signature=excluded.domain_signature,
    geometry=excluded.geometry,
    updated_at=now();
  return p_cache_key;
end;$$;
grant execute on function public.save_question_geometry_v1(uuid,uuid,text,text,text,jsonb) to anon,authenticated;

-- Lets the Hider reuse a precomputed private polygon after a reload while the question is
-- still pending. No direct table SELECT permission is granted.
create or replace function public.get_hider_question_geometry_v1(
  p_game_id uuid,
  p_question_action_id uuid,
  p_password text,
  p_cache_key text
) returns table(cache_key text,domain_signature text,geometry jsonb)
language plpgsql security definer set search_path=public,extensions as $$
begin
  if not public._hider_password_ok(p_game_id,p_password) then raise exception 'Invalid hider password.';end if;
  return query
  select c.cache_key,c.domain_signature,c.geometry
  from public.game_geometry_cache c
  where c.game_id=p_game_id and c.question_action_id=p_question_action_id and c.cache_key=p_cache_key
  limit 1;
end;$$;
grant execute on function public.get_hider_question_geometry_v1(uuid,uuid,text,text) to anon,authenticated;

-- Public retrieval is deliberately gated by an ACTIVE answer which references exactly this
-- cache key. Before the Hider answers, Seekers cannot retrieve a Tentacle/Bus result.
create or replace function public.get_answer_geometry_v1(
  p_game_id uuid,
  p_question_action_id uuid,
  p_cache_key text
) returns table(cache_key text,domain_signature text,geometry jsonb)
language sql stable security definer set search_path=public as $$
  select c.cache_key,c.domain_signature,c.geometry
  from public.game_geometry_cache c
  where c.game_id=p_game_id
    and c.question_action_id=p_question_action_id
    and c.cache_key=p_cache_key
    and exists(
      select 1 from public.game_actions a
      where a.game_id=p_game_id
        and a.parent_id=p_question_action_id
        and a.kind='answer'
        and a.is_active
        and a.payload->'answer'->>'geometry_cache_key'=c.cache_key
    )
  limit 1;
$$;
grant execute on function public.get_answer_geometry_v1(uuid,uuid,text) to anon,authenticated;

-- Remove v3.13.1's large inline geometry objects from existing game history. They caused every
-- reloadActions()/Realtime refresh to transfer and JSON-parse the same polygons again. v3.13.2
-- safely reconstructs old answers in the Web Worker when needed.
update public.game_actions
set payload=jsonb_set(
  payload,
  '{answer}',
  coalesce(payload->'answer','{}'::jsonb)
    - 'constraint_geometry'
    - 'constraint_geometry_yes'
    - 'constraint_geometry_no'
    - 'final_geometry',
  true
)
where kind='answer'
  and is_active
  and jsonb_typeof(payload->'answer')='object'
  and (
    (payload->'answer') ? 'constraint_geometry'
    or (payload->'answer') ? 'constraint_geometry_yes'
    or (payload->'answer') ? 'constraint_geometry_no'
    or (payload->'answer') ? 'final_geometry'
  );

-- v3.13.1 briefly embedded the whole current possible area into Bus question actions.
-- It is no longer needed because the worker uses the current domain and the final result is cached.
update public.game_actions
set payload=payload-'domain_geometry'
where kind='question' and payload->>'question_kind'='bus_line_tentacle' and payload ? 'domain_geometry';

-- Keep the Bus reward pipeline unchanged, but compact the public question row after the answer:
-- bus_features are only needed while the Hider is deciding the nearest line. Afterward the cached
-- final polygon replaces them and repeated polling no longer downloads line geometry.
create or replace function public.answer_bus_line_tentacle_v1(p_game_id uuid,p_question_action_id uuid,p_password text,p_answer jsonb)
returns uuid language plpgsql security definer set search_path=public,extensions as $$
declare v_answer_id uuid;v_extra jsonb;v_kind text;
begin
  select payload->>'question_kind' into v_kind from public.game_actions where id=p_question_action_id and game_id=p_game_id and kind='question' and is_active;
  if v_kind is distinct from 'bus_line_tentacle' then raise exception 'Question is not Nearest Bus Line.';end if;
  if coalesce(p_answer->>'type','')<>'bus_line_tentacle' or coalesce(p_answer->>'status','')<>'line' or nullif(trim(p_answer->>'line_ref'),'') is null then raise exception 'Invalid bus-line answer.';end if;
  v_answer_id:=public.answer_question_v5(p_game_id,p_question_action_id,p_password,p_answer);
  if exists(select 1 from public.curse_draws where question_action_id=p_question_action_id) then
    v_extra:=public._draw_cards_v4(p_game_id,1);
    if jsonb_array_length(coalesce(v_extra,'[]'::jsonb))>0 then
      update public.curse_draws set cards=cards||v_extra,keep_limit=least(2,jsonb_array_length(cards||v_extra)) where question_action_id=p_question_action_id;
    end if;
  end if;
  update public.game_actions set payload=payload-'bus_features'-'domain_geometry' where id=p_question_action_id;
  return v_answer_id;
end;$$;
grant execute on function public.answer_bus_line_tentacle_v1(uuid,uuid,text,jsonb) to anon,authenticated;
