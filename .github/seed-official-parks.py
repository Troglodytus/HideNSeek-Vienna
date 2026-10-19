#!/usr/bin/env python3
"""Seed the Parks POI category from Vienna's official PARKINFOOGD with FLAECHE>=100 m²."""
import pathlib, urllib.request, urllib.parse, json, math, collections, time
root=pathlib.Path(__file__).resolve().parents[1]
base='https://data.wien.gv.at/daten/geo'
def get(params):
 url=base+'?'+urllib.parse.urlencode(params)
 with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'HideNSeek-Vienna/3.13.7 Park reference refresh'}),timeout=40) as f:
  data=f.read()
 obj=json.loads(data)
 if not isinstance(obj.get('features'),list):raise ValueError('The Vienna WFS did not return valid GeoJSON')
 return obj
args={'service':'WFS','request':'GetFeature','version':'1.1.0','typeName':'ogdwien:PARKINFOOGD','srsName':'EPSG:4326','outputFormat':'json','maxFeatures':2000}
full=get(args)
features=full['features']
print('SOURCE',len(features),'totalFeatures',full.get('totalFeatures'),flush=True)
if not 800<=len(features)<=1500:raise SystemExit('Unsafe unexpected official park count')
bbox=(48.117668,16.18218,48.322571,16.577511)
def tile_for(lat,lng):
 south,west,north,east=bbox
 row=max(0,min(3,int((lat-south)/(north-south)*4)))
 col=max(0,min(3,int((lng-west)/(east-west)*4)))
 return f'r{row}c{col}'
skipped_area=0;skipped_coord=0;no_names=0
pois=[]
seen=set()
for f in features:
 p=f.get('properties') or {}
 raw=p.get('FLAECHE')
 if isinstance(raw,(int,float)):area=float(raw)
 else:
  numeric=''.join(c for c in str(raw or '') if c in '0123456789.,')
  area=float(numeric.replace('.','').replace(',','.')) if numeric else math.nan
 if not math.isfinite(area) or area<100:skipped_area+=1;continue
 g=f.get('geometry') or {}
 if g.get('type')!='Point' or len(g.get('coordinates') or [])<2:skipped_coord+=1;continue
 lng,lat=map(float,g['coordinates'][:2])
 if not(48<=lat<=48.5 and 16<=lng<=16.8):skipped_coord+=1;continue
 name=str(p.get('ANL_NAME') or p.get('NAME') or '').strip()
 if not name:no_names+=1;continue
 key=f"wien-ogd/park/{f.get('id') or p.get('OBJECTID')}"
 if key in seen:continue
 seen.add(key)
 pois.append({'id':key,'name':name,'lat':lat,'lng':lng,'area_m2':round(area)})
if not 650<=len(pois)<=1200:raise SystemExit('Park filtering would produce suspiciously few records; abort')
tiles={f'r{r}c{c}':[] for r in range(4) for c in range(4)}
for p in pois:tiles[tile_for(p['lat'],p['lng'])].append(p)
# Check the exact tile bounding-box convention used by the current JS fetchWfsTile.
probe=args|{'bbox':'16.18218,48.117668,16.28101275,48.16889375,EPSG:4326','maxFeatures':2000}
try:
 match=get(probe)['features']
 print('PROBE tile r0c0',len(match),'expected',len(tiles['r0c0']),flush=True)
 if len(tiles['r0c0'])>0 and len(match)==0:raise SystemExit('Current WFS bbox convention returns zero features; would corrupt refresh')
except Exception as e:raise SystemExit(f'WFS tile bounding-box test failed: {e}')
payload={'source':'Stadt Wien PARKINFOOGD, FLAECHE>=100 m2','source_count':len(features),
         'filtered_count':len(pois),'skipped_area':skipped_area,'skipped_coord':skipped_coord,'skipped_name':no_names,
         'pois':pois,'tiles':tiles}
(root/'.github/parks-official-seed.json').write_text(json.dumps(payload,ensure_ascii=False,separators=(',',':'))+'\n')
print('FILTERED',len(pois),'too_small',skipped_area,'invalid_coords',skipped_coord,'unnamed',no_names,flush=True)
print('TILES',dict((k,len(v)) for k,v in tiles.items()),flush=True)
