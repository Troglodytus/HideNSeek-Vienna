-- Vienna Hide & Seek v3.2.2 migration
-- Run ONCE on an existing v3.2.x database.
-- Adds a public-but-UI-hidden Endgame zone action so both clients can switch the
-- deduction map from all of Vienna to the final station radius without exposing
-- the private hiding coordinate.

create or replace function public.set_endgame_v5(
  p_game_id uuid,
  p_password text,
  p_endgame boolean,
  p_hidden_lat double precision default null,
  p_hidden_lng double precision default null
) returns boolean
language plpgsql
security definer
set search_path=public,extensions
as $$
declare
  v_station_lat double precision;
  v_station_lng double precision;
  v_station_name text;
  v_base integer;
  v_dist_m double precision;
  v_home_count integer;
  v_limit_m double precision;
begin
  if not public._hider_password_ok(p_game_id,p_password) then
    raise exception 'Invalid hider password.';
  end if;

  if not p_endgame then
    update public.game_secrets
      set endgame=false
      where game_id=p_game_id;

    update public.game_actions
      set is_active=false
      where game_id=p_game_id
        and kind='endgame_zone'
        and is_active;

    return true;
  end if;

  if p_hidden_lat is null or p_hidden_lng is null then
    raise exception 'Choose the actual hiding location before starting Endgame.';
  end if;
  if p_hidden_lat not between 48.05 and 48.40 or p_hidden_lng not between 16.05 and 16.70 then
    raise exception 'Hiding coordinate outside Vienna guardrail.';
  end if;

  select station_lat,station_lng,station_name,base_radius_m
    into v_station_lat,v_station_lng,v_station_name,v_base
  from public.game_secrets
  where game_id=p_game_id;

  if v_station_lat is null or v_station_lng is null then
    raise exception 'Game has no hiding station.';
  end if;

  select count(*) into v_home_count
  from public.game_actions
  where game_id=p_game_id
    and kind='curse_play'
    and is_active
    and payload->>'effect_key'='prosperous_home';

  v_limit_m := coalesce(v_base,250) * sqrt(power(2.0,v_home_count));

  v_dist_m := 6371000 * 2 * asin(sqrt(
    power(sin(radians(p_hidden_lat-v_station_lat)/2),2)
    + cos(radians(v_station_lat))*cos(radians(p_hidden_lat))
    * power(sin(radians(p_hidden_lng-v_station_lng)/2),2)
  ));

  if v_dist_m>v_limit_m+0.5 then
    raise exception 'Actual hiding spot is % m from the station; current maximum is % m.',
      round(v_dist_m)::integer,round(v_limit_m)::integer;
  end if;

  update public.game_secrets
    set hidden_lat=p_hidden_lat,
        hidden_lng=p_hidden_lng,
        endgame=true
    where game_id=p_game_id;

  -- End any older zone and create a fresh phase marker. The action contains the
  -- already-known station and radius, never the private final hiding coordinate.
  update public.game_actions
    set is_active=false
    where game_id=p_game_id
      and kind='endgame_zone'
      and is_active;

  insert into public.game_actions(game_id,actor,kind,payload)
  values(
    p_game_id,
    'hider',
    'endgame_zone',
    jsonb_build_object(
      'station_name',coalesce(v_station_name,'Station'),
      'center',jsonb_build_object('lat',v_station_lat,'lng',v_station_lng),
      'radius_m',round(v_limit_m)::integer
    )
  );

  return true;
end;
$$;

grant execute on function public.set_endgame_v5(uuid,text,boolean,double precision,double precision) to anon,authenticated;
