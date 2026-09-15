from pathlib import Path

w=Path('geometry-worker.js')
s=w.read_text()
old="  let region=unionList(kept);\n  if(payload.invert && region) region=difference2(domain,region) || domain;\n  return optimize(region);"
new="  let region=unionList(kept);\n  if(!region) return optimize(domain);\n  if(payload.invert) region=difference2(domain,region) || domain;\n  return optimize(region);"
if s.count(old)!=1:raise SystemExit('worker empty Bus-region anchor mismatch')
w.write_text(s.replace(old,new,1))

q=Path('supabase-v3.13.2-migration.sql')
s=q.read_text()
old="where kind='answer'\n  and is_active\n  and jsonb_typeof(payload->'answer')='object'"
new="where kind='answer'\n  and jsonb_typeof(payload->'answer')='object'"
if s.count(old)!=1:raise SystemExit('SQL historic cleanup anchor mismatch')
q.write_text(s.replace(old,new,1))
