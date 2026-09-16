from pathlib import Path
p=Path('supabase-v3.13.4-migration.sql');s=p.read_text()
old="  select lat,lng into v_seeker_lat,v_seeker_lng from public.seeker_live_positions where game_id=p_game_id;"
new="  select lat,lng into v_seeker_lat,v_seeker_lng from public.seeker_live_positions where game_id=p_game_id and updated_at>=now()-interval '20 seconds';"
if s.count(old)!=1: raise SystemExit(f'expected one seeker-live select, got {s.count(old)}')
p.write_text(s.replace(old,new,1))
