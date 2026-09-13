-- Vienna Hide & Seek v3.2 migration
-- Run this ONCE in Supabase SQL Editor on an existing v3.1.x database.

alter table public.game_secrets alter column hidden_lat drop not null;
alter table public.game_secrets alter column hidden_lng drop not null;

create or replace function public.create_game_v4(
  p_name text,p_password text,p_station_name text,p_station_lat double precision,p_station_lng double precision
) returns uuid language plpgsql security definer set search_path=public,extensions as $$
declare v_id uuid;
begin
  if char_length(trim(coalesce(p_name,''))) not between 1 and 80 then raise exception 'Game name must be 1-80 characters.'; end if;
  if char_length(coalesce(p_password,''))<4 then raise exception 'Password must be at least 4 characters.'; end if;
  if p_station_lat not between 48.05 and 48.40 or p_station_lng not between 16.05 and 16.70 then raise exception 'Station coordinate outside Vienna guardrail.'; end if;
  insert into public.games(name) values(trim(p_name)) returning id into v_id;
  insert into public.game_secrets(game_id,hidden_lat,hidden_lng,password_hash,station_lat,station_lng,station_name,endgame,base_radius_m)
  values(v_id,null,null,extensions.crypt(p_password,extensions.gen_salt('bf',10)),p_station_lat,p_station_lng,coalesce(nullif(trim(p_station_name),''),'Station'),false,250);
  return v_id;
end;$$;

create or replace function public.get_hider_game_v4(p_game_id uuid,p_password text)
returns table(game_id uuid,game_name text,game_status text,hidden_lat double precision,hidden_lng double precision,station_lat double precision,station_lng double precision,station_name text,endgame boolean,base_radius_m integer)
language plpgsql security definer set search_path=public,extensions as $$
begin
  return query select g.id,g.name,g.status,s.hidden_lat,s.hidden_lng,s.station_lat,s.station_lng,s.station_name,s.endgame,s.base_radius_m
  from public.games g join public.game_secrets s on s.game_id=g.id
  where g.id=p_game_id and s.password_hash=extensions.crypt(coalesce(p_password,''),s.password_hash);
end;$$;

create or replace function public.set_endgame_v4(
  p_game_id uuid,p_password text,p_endgame boolean,p_hidden_lat double precision default null,p_hidden_lng double precision default null
) returns boolean language plpgsql security definer set search_path=public,extensions as $$
declare
  v_station_lat double precision; v_station_lng double precision; v_base integer; v_dist_m double precision;
  v_home_count integer; v_limit_m double precision;
begin
  if not public._hider_password_ok(p_game_id,p_password) then raise exception 'Invalid hider password.'; end if;
  if not p_endgame then
    update public.game_secrets set endgame=false where game_id=p_game_id;
    return found;
  end if;
  if p_hidden_lat is null or p_hidden_lng is null then raise exception 'Choose the actual hiding location before starting Endgame.'; end if;
  if p_hidden_lat not between 48.05 and 48.40 or p_hidden_lng not between 16.05 and 16.70 then raise exception 'Hiding coordinate outside Vienna guardrail.'; end if;
  select station_lat,station_lng,base_radius_m into v_station_lat,v_station_lng,v_base from public.game_secrets where game_id=p_game_id;
  if v_station_lat is null or v_station_lng is null then raise exception 'Game has no hiding station.'; end if;
  select count(*) into v_home_count from public.game_actions where game_id=p_game_id and kind='curse_play' and is_active and payload->>'effect_key'='prosperous_home';
  v_limit_m := coalesce(v_base,250) * sqrt(power(2.0,v_home_count));
  v_dist_m := 6371000 * 2 * asin(sqrt(power(sin(radians(p_hidden_lat-v_station_lat)/2),2)+cos(radians(v_station_lat))*cos(radians(p_hidden_lat))*power(sin(radians(p_hidden_lng-v_station_lng)/2),2)));
  if v_dist_m>v_limit_m+0.5 then raise exception 'Actual hiding spot is % m from the station; current maximum is % m.',round(v_dist_m)::integer,round(v_limit_m)::integer; end if;
  update public.game_secrets set hidden_lat=p_hidden_lat,hidden_lng=p_hidden_lng,endgame=true where game_id=p_game_id;
  return found;
end;$$;

grant execute on function public.create_game_v4(text,text,text,double precision,double precision) to anon,authenticated;
grant execute on function public.get_hider_game_v4(uuid,text) to anon,authenticated;
grant execute on function public.set_endgame_v4(uuid,text,boolean,double precision,double precision) to anon,authenticated;
