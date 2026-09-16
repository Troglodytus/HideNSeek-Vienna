from pathlib import Path
import re

APP=Path('app.js'); IDX=Path('index.html')
s=APP.read_text()

def once(old,new,label):
    global s
    n=s.count(old)
    if n!=1: raise SystemExit(f'{label}: expected 1 exact match, got {n}')
    s=s.replace(old,new,1)

def sub_once(pattern,repl,label,flags=0):
    global s
    s2,n=re.subn(pattern,repl,s,count=1,flags=flags)
    if n!=1: raise SystemExit(f'{label}: expected 1 regex match, got {n}')
    s=s2

once("const APP_VERSION = '3.13.3';","const APP_VERSION = '3.13.4';",'version')

# Persistent additive interchange corrections. These are applied after every official refresh
# AND when loading an already-cached station dataset, so a WFS refresh cannot erase them.
needle="  const MANUAL_CURSE_EFFECTS=new Set(['fiaker','schwarzkappler','wean_ned_schlecht_redn']);\n"
insert=needle+"""  const MANUAL_STATION_LINE_OVERRIDES={
    'karlsplatz':['U1','U2','U4'],
    'stephansplatz':['U1','U3'],
    'westbahnhof':['U3','U6'],
    'volkstheater':['U2','U3'],
    'landstrasse':['U3','U4'],
    'wien mitte':['U3','U4'],
    'schottenring':['U2','U4'],
    'schwedenplatz':['U1','U4'],
    'langenfeldgasse':['U4','U6'],
    'praterstern':['U1','U2'],
    'spittelau':['U4','U6']
  };
  function stationOverrideKey(name){return String(name||'').normalize('NFKD').replace(/[\\u0300-\\u036f]/g,'').replace(/ß/g,'ss').toLowerCase().replace(/\\s+/g,' ').trim();}
  function applyManualStationLineOverrides(stations){
    return (stations||[]).map(st=>{
      const extra=MANUAL_STATION_LINE_OVERRIDES[stationOverrideKey(st?.properties?.stationName)]||[];if(!extra.length)return st;
      const refs=[...new Set([...(st.properties?.lineRefs||[]).map(r=>String(r).toUpperCase()),...extra])].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
      return {...st,properties:{...(st.properties||{}),lineRefs:refs,manualInterchangeOverride:true}};
    });
  }
"""
once(needle,insert,'manual interchange constants')

once("    return {stations,railLines};\n  }\n  function featureToPoi", "    return {stations:applyManualStationLineOverrides(stations),railLines};\n  }\n  function featureToPoi", 'official transit override')
once("    state.mapData={city:admin.city,districts:admin.districts,stations:stations.stations,railLines:Array.isArray(transit?.railLines)?transit.railLines:[]};", "    state.mapData={city:admin.city,districts:admin.districts,stations:applyManualStationLineOverrides(stations.stations),railLines:Array.isArray(transit?.railLines)?transit.railLines:[]};", 'cached station override')

# Street Shape: exact nearest OSM segment, with at most one same-street neighbour on each side.
street_new=r'''  async function nearestStreetGeometryForHider(){
    if(state.role!=='hider'||!state.secret?.endgame||!state.secret?.hidden)throw new Error('Current Street Shape requires the Hider Endgame location.');
    const [lng,lat]=state.secret.hidden.geometry.coordinates;
    const queries=[
      `[out:json][timeout:15];way(around:240,${lat},${lng})["highway"]["name"];out geom tags qt;`,
      `[out:json][timeout:15];way(around:240,${lat},${lng})["highway"];out geom tags qt;`
    ];
    let osm=null;for(const q of queries){try{osm=await fetchOverpass(q,'Nearest street',22000);if((osm.elements||[]).length)break;}catch(e){console.warn('Street-shape query failed',e);}}
    const target=turf.point([lng,lat]),nameKey=n=>String(n||'').toLocaleLowerCase('de-AT').replace(/\s+/g,' ').trim();
    const ways=[];
    for(const e of osm?.elements||[]){
      const coords=(e.geometry||[]).map(g=>[Number(g.lon),Number(g.lat)]).filter(c=>Number.isFinite(c[0])&&Number.isFinite(c[1]));
      if(coords.length<2)continue;ways.push({id:e.id,name:e.tags?.name||null,name_key:nameKey(e.tags?.name),highway:e.tags?.highway||null,coords});
    }
    const segments=[];let best=null,bestD=Infinity;
    for(const way of ways){for(let i=0;i<way.coords.length-1;i++){
      const a=way.coords[i],b=way.coords[i+1];let d=Infinity;try{d=turf.pointToLineDistance(target,turf.lineString([a,b]),{units:'meters'});}catch(_){}
      const seg={way,i,a,b,d};segments.push(seg);if(d<bestD){bestD=d;best=seg;}
    }}
    if(!best)throw new Error('No nearby street geometry could be loaded.');

    const sameStreet=(seg)=>seg&&((best.way.name_key&&seg.way.name_key===best.way.name_key)||(!best.way.name_key&&seg.way.id===best.way.id));
    const endpointDistance=(a,b)=>{try{return turf.distance(turf.point(a),turf.point(b),{units:'meters'});}catch(_){return Infinity;}};
    const connectedOuterPoint=(endpoint,side)=>{
      let candidate=null,candidateD=12;
      for(const seg of segments){
        if(seg===best||!sameStreet(seg))continue;
        if(seg.way.id===best.way.id&&(seg.i===best.i-1||seg.i===best.i+1))continue;
        const da=endpointDistance(endpoint,seg.a),db=endpointDistance(endpoint,seg.b),d=Math.min(da,db);if(d>candidateD)continue;
        const outer=da<=db?seg.b:seg.a;
        // Never accidentally add the exact opposite side of our selected segment.
        if(endpointDistance(outer,side==='before'?best.b:best.a)<0.5)continue;
        candidate={outer,d};candidateD=d;
      }
      return candidate?.outer||null;
    };

    const coords=[[...best.a],[...best.b]];
    // Prefer the adjacent segment from the same OSM way. If the way is split at an
    // intersection, bridge only to another way carrying the same street name.
    if(best.i>0)coords.unshift([...best.way.coords[best.i-1]]);
    else{const p=connectedOuterPoint(best.a,'before');if(p)coords.unshift([...p]);}
    if(best.i+2<best.way.coords.length)coords.push([...best.way.coords[best.i+2]]);
    else{const p=connectedOuterPoint(best.b,'after');if(p)coords.push([...p]);}
    return {id:best.way.id,name:best.way.name,highway:best.way.highway,coords,distance_m:bestD,segment_index:best.i};
  }
'''
sub_once(r"  async function nearestStreetGeometryForHider\(\)\{.*?\n  \}\n  function streetShapeBlob", street_new+"  function streetShapeBlob", 'street shape exact segment', re.S)

# VOR: Hider privately publishes fresh GPS while an active VOR exists. Seeker continues
# polling derived bearing every second; no target coordinates ever leave the server.
vor_start=r'''  async function publishHiderVorLivePosition(q,p){
    if(state.role!=='hider'||!state.hiderPassword||!state.game||!q||!p)return;
    const {error}=await state.supabase.rpc('set_hider_vor_live_position_v1',{p_game_id:state.game.id,p_question_action_id:q.id,p_password:state.hiderPassword,p_lat:Number(p.lat),p_lng:Number(p.lng),p_accuracy_m:p.accuracy_m??null});if(error)throw error;
  }
  function startVorTracking(q){
    if(!q||!['seeker','hider'].includes(state.role))return;
    if(state.vorGeoWatchId===null&&navigator.geolocation){state.vorGeoWatchId=navigator.geolocation.watchPosition(pos=>{
      const p={lat:pos.coords.latitude,lng:pos.coords.longitude,accuracy_m:pos.coords.accuracy,source:'gps'};state.lastGpsUpdateMs=Date.now();setCurrentPosition(p,{pan:false});
      if(state.role==='seeker')publishSeekerLivePosition(p).then(()=>requestVorBearing(q,{force:true})).catch(e=>console.warn('VOR live Seeker GPS publish failed',e));
      else publishHiderVorLivePosition(q,p).catch(e=>console.warn('VOR private Hider GPS publish failed',e));
    },e=>console.warn('VOR live GPS unavailable',e),{enableHighAccuracy:true,maximumAge:500,timeout:10000});}
    if(state.role==='seeker'){
      if(typeof DeviceOrientationEvent!=='undefined'&&typeof DeviceOrientationEvent.requestPermission!=='function'&&!state.vorOrientationHandler)attachVorOrientation();
      if(!state.vorRenderTimer)state.vorRenderTimer=setInterval(()=>renderVorNavigation(),1000);
    }
  }
'''
sub_once(r"  function startVorTracking\(q\)\{.*?\n  \}\n  function stopVorTracking", vor_start+"  function stopVorTracking", 'VOR dual-role GPS', re.S)

old_render="""  function renderVorNavigation(){
    const panel=$('vorNavigationPanel');if(!panel)return;const active=state.role==='seeker'?activeVorNavigation():null;
    if(!active){panel.classList.add('hidden');if(state.vorQuestionId)stopVorTracking();return;}
    panel.classList.remove('hidden');state.vorQuestionId=active.question.id;state.vorExpiresAt=active.expiry;startVorTracking(active.question);requestVorBearing(active.question).catch(()=>{});
"""
new_render="""  function renderVorNavigation(){
    const panel=$('vorNavigationPanel');if(!panel)return;const active=['seeker','hider'].includes(state.role)?activeVorNavigation():null;
    if(!active){panel.classList.add('hidden');if(state.vorQuestionId)stopVorTracking();return;}
    state.vorQuestionId=active.question.id;state.vorExpiresAt=active.expiry;startVorTracking(active.question);
    if(state.role==='hider'){panel.classList.add('hidden');return;}
    if(state.role!=='seeker'){panel.classList.add('hidden');return;}
    panel.classList.remove('hidden');requestVorBearing(active.question).catch(()=>{});
"""
once(old_render,new_render,'VOR render Hider tracking')

# Draw/keep template UI helpers and Developer API v5.
needle="""  function deckCountOptions(selected){
    const vals=[];for(let n=0;n<=20;n++)vals.push(n);vals.push(25,30,40,50);
    return vals.map(n=>`<option value="${n}" ${Number(selected??1)===n?'selected':''}>${n}</option>`).join('');
  }
"""
insert=needle+"""  function drawKeepCountOptions(selected){
    const n=Math.max(1,Math.min(10,Number(selected||1)));return Array.from({length:10},(_,i)=>i+1).map(v=>`<option value="${v}" ${n===v?'selected':''}>${v}</option>`).join('');
  }
"""
once(needle,insert,'draw keep options')

once("    const key=c.card_key||'',isCurse=isNew||(c.card_kind||'curse')==='curse',special=!!c.special_engine;", "    const key=c.card_key||'',isCurse=isNew||(c.card_kind||'curse')==='curse',special=!!c.special_engine,isDrawKeep=c.effect_key==='same_day_delivery';", 'developer draw template flag')
once("        <label>Copies<select class=\"dev-card-count card-count-select\">${deckCountOptions(c.deck_count??1)}</select></label>\n", "        <label>Copies<select class=\"dev-card-count card-count-select\">${deckCountOptions(c.deck_count??1)}</select></label>\n        ${isDrawKeep?`<label>Cards drawn<select class=\"dev-card-draw-count\">${drawKeepCountOptions(c.draw_count||3)}</select></label><label>Cards kept<select class=\"dev-card-keep-limit\">${drawKeepCountOptions(c.keep_limit||2)}</select></label>`:''}\n", 'developer draw fields')
once("      <div class=\"card-cost-row ${isCurse?'':'hidden'}\">", "      <div class=\"card-cost-row ${isCurse||isDrawKeep?'':'hidden'}\">", 'draw template casting costs')

once("      state.supabase.rpc('admin_list_cards_v4',{p_password:state.developerPassword}),", "      state.supabase.rpc('admin_list_cards_v5',{p_password:state.developerPassword}),", 'developer list v5')

once("    const old=state.developerCards.find(c=>c.card_key===row.dataset.developerCard);\n    const secMode=", "    const old=state.developerCards.find(c=>c.card_key===row.dataset.developerCard),isDrawKeep=old?.effect_key==='same_day_delivery';\n    const secMode=", 'admin save draw flag')
once("      p_deck_count:Number(row.querySelector('.dev-card-count').value),\n      p_secondary_effect_mode:", "      p_deck_count:Number(row.querySelector('.dev-card-count').value),\n      p_draw_count:isDrawKeep?Number(row.querySelector('.dev-card-draw-count')?.value||3):null,p_keep_limit:isDrawKeep?Number(row.querySelector('.dev-card-keep-limit')?.value||2):null,\n      p_secondary_effect_mode:", 'admin save draw args')
once("    const {error}=await state.supabase.rpc('admin_save_card_v4',args);", "    const {error}=await state.supabase.rpc('admin_save_card_v5',args);", 'admin save v5')

# Same Day Delivery engine now reads each card snapshot's editable template/casting values.
new_delivery=r'''  async function useSameDayDelivery(card){
    const drawCount=Math.max(1,Math.min(10,Number(card.draw_count||3))),keepLimit=Math.max(1,Math.min(drawCount,Number(card.keep_limit||2)));
    const costKeys=await chooseCastingCost(card);if(costKeys===null)return;const cost=cardCostLabel(card);
    const ok=await confirmAction(`${card.title||'Delivery'}?`,`${cost?`Casting cost: ${cost}\n\n`:''}Draw ${drawCount} cards immediately and keep ${keepLimit}.`,`Draw cards`);if(!ok)return;
    const {error}=await state.supabase.rpc('use_same_day_delivery_v1',{p_game_id:state.game.id,p_password:state.hiderPassword,p_card_key:card.card_key,p_cost_card_keys:costKeys||[]});if(error)throw error;
    await reloadGameState();
  }
'''
sub_once(r"  async function useSameDayDelivery\(card\)\{.*?\n  \}\n\n  async function useDeceptiveTinyHouse", new_delivery+"\n  async function useDeceptiveTinyHouse", 'generic draw keep use', re.S)

once("    if(a.kind==='powerup_draw'&&p.effect_key==='same_day_delivery')return 'Same Day Delivery · drew 3 cards, keep 2';", "    if(a.kind==='powerup_draw'&&p.effect_key==='same_day_delivery')return `${p.title||'Delivery'} · drew ${Number(p.draw_count||3)} cards, keep ${Number(p.keep_limit||2)}`;", 'dynamic delivery activity')

APP.write_text(s)
idx=IDX.read_text()
if '3.13.3' not in idx: raise SystemExit('index version 3.13.3 not found')
idx=idx.replace('3.13.3','3.13.4')
IDX.write_text(idx)
print('v3.13.4 patch applied')
