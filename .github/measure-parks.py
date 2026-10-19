#!/usr/bin/env python3
"""Temporary audit: fetch current OSM park geometries without modifying Supabase."""
import json, math, pathlib, time, urllib.parse, urllib.request, random, sys
root=pathlib.Path(__file__).resolve().parents[1]
source=json.loads((root/'.github/park-source-ids.json').read_text())
ids=source['ids']
ways=[x.split('/')[1] for x in ids if x.startswith('way/')]
rels=[x.split('/')[1] for x in ids if x.startswith('relation/')]
nodes=[x for x in ids if x.startswith('node/')]
endpoints=[
 'https://overpass.kumi.systems/api/interpreter',
 'https://overpass-api.de/api/interpreter',
 'https://overpass.nchc.org.tw/api/interpreter',
 'https://overpass.private.coffee/api/interpreter',
]
def closed(c):return len(c)>=4 and c[0]==c[-1]
def meters_area(points):
 if not closed(points):return 0.
 # Spherical area in m²; max error is negligible for the 100 m² threshold.
 r=6371008.8
 val=0.
 for (lng1,lat1),(lng2,lat2) in zip(points,points[1:]):
  val+=math.radians(lng2-lng1)*(2+math.sin(math.radians(lat1))+math.sin(math.radians(lat2)))
 return abs(val)*r*r/2.
def coords(arr):return [(float(v['lon']),float(v['lat'])) for v in (arr or []) if 'lon' in v and 'lat' in v]
def rings(members,role):
 seqs=[coords(m.get('geometry')) for m in members if m.get('type')=='way' and m.get('role')==role]
 seqs=[x for x in seqs if len(x)>=2]
 result=[]
 while seqs:
  chain=seqs.pop()
  while not closed(chain):
   found=False
   for j,other in enumerate(seqs):
    if chain[-1]==other[0]:chain+=other[1:]
    elif chain[-1]==other[-1]:chain+=list(reversed(other[:-1]))
    elif chain[0]==other[-1]:chain=other[:-1]+chain
    elif chain[0]==other[0]:chain=list(reversed(other[1:]))+chain
    else:continue
    seqs.pop(j);found=True;break
   if not found:return None
  result.append(chain)
 return result
def inspect(e):
 access=str((e.get('tags') or {}).get('access','')).lower()
 if access in ('private','no','customers','permit'):return {'status':'restricted','area_m2':None}
 if (e.get('tags') or {}).get('leisure')!='park':return {'status':'not_park','area_m2':None}
 if e.get('type')=='way':area=meters_area(coords(e.get('geometry')))
 elif e.get('type')=='relation':
  outer=rings(e.get('members') or [],'outer')
  inner=rings(e.get('members') or [],'inner')
  area=max(0.,sum(map(meters_area,outer))-sum(map(meters_area,inner))) if outer and inner is not None else 0.
 else:area=0.
 return {'status':'area' if area>0 else 'no_polygon','area_m2':round(area)}
def query_api(way_ids,rel_ids,index):
 parts=[]
 if way_ids:parts.append('way(id:'+','.join(way_ids)+');')
 if rel_ids:parts.append('relation(id:'+','.join(rel_ids)+');')
 q='[out:json][timeout:70];('+''.join(parts)+');out geom tags qt;'
 data=urllib.parse.urlencode({'data':q}).encode()
 last=None
 for j in range(8):
  endpoint=endpoints[(index+j)%len(endpoints)]
  req=urllib.request.Request(endpoint,data=data,headers={'User-Agent':'HideNSeek-Vienna/3.13.7 (park area audit)','Content-Type':'application/x-www-form-urlencoded','Accept':'application/json'},method='POST')
  try:
   with urllib.request.urlopen(req,timeout=90) as response:
    obj=json.loads(response.read().decode())
   if not isinstance(obj.get('elements'),list):raise RuntimeError('No elements')
   return obj['elements']
  except Exception as e:
   last=e
   print(f'Attempt {j+1} batch {index}: {endpoint}: {str(e)[:130]}',flush=True)
   time.sleep(min(12,2+j))
 raise RuntimeError(f'OSM geometry batch {index} failed: {last}')
groups=[]
# Small batches keep public Overpass API requests manageable.
for j in range(0,max(len(ways),len(rels)*8),80):
 groups.append((ways[j:j+80],rels[j//8:j//8+10]))
# Ensure all relations are covered (last group may not include them).
included=set(x for _,r in groups for x in r)
rest=[x for x in rels if x not in included]
for j in range(0,len(rest),10):groups.append(([],rest[j:j+10]))
records={x:{'status':'unavailable','area_m2':None} for x in ids}
for x in nodes:records[x]={'status':'node_without_area','area_m2':None}
for k,(w,r) in enumerate(groups):
 elements=query_api(w,r,k)
 for e in elements:
  key=str(e.get('type'))+'/'+str(e.get('id'))
  if key in records:records[key]=inspect(e)
 print(f'Batch {k+1}/{len(groups)}: {len(elements)} OSM geometries',flush=True)
 time.sleep(.5)
statuses={}
for v in records.values():statuses[v['status']]=statuses.get(v['status'],0)+1
valid=sum(1 for v in records.values() if v['status']=='area' and v['area_m2']>=100)
summary={'source_count':len(ids),'valid_100m2':valid,'statuses':statuses,
         'under_100':sum(1 for v in records.values() if v['status']=='area' and v['area_m2']<100)}
print('SUMMARY '+json.dumps(summary),flush=True)
out={'min_area_m2':100,'records':records,'summary':summary}
(root/'.github/park-area-audit.json').write_text(json.dumps(out,separators=(',',':'))+'\n')
