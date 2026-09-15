#!/usr/bin/env python3
from pathlib import Path
import re, subprocess, textwrap

OLD='91b99f6f856c596bfa106de82cb94ecaf46ad2f9'

def old_file(path):
    return subprocess.check_output(['git','show',f'{OLD}:{path}'],text=True)

def must_replace(s, old, new, label, count=1):
    n=s.count(old)
    if n < count:
        raise RuntimeError(f'{label}: expected at least {count} occurrence(s), found {n}')
    return s.replace(old,new,count)

def must_sub(s, pattern, repl, label, count=1, flags=0):
    out,n=re.subn(pattern,repl,s,count=count,flags=flags)
    if n!=count:
        raise RuntimeError(f'{label}: expected {count} regex replacement(s), got {n}')
    return out

# ---------------------------------------------------------------------------
# Restore the application surface exactly from v3.11.3.
# ---------------------------------------------------------------------------
app=old_file('app.js')
html=old_file('index.html')
css=old_file('styles.css')

# Version + constants.
app=must_replace(app,"const APP_VERSION = '3.11.3';","const APP_VERSION = '3.13.0';",'version')
app=must_replace(app,
"  const TENTACLE_SEARCH_RADIUS_M = 5000;\n  const CACHE_KEY",
"  const TENTACLE_SEARCH_RADIUS_M = 5000;\n  const BUS_TENTACLE_SEARCH_BUFFER_M = 1000;\n  const BUS_TENTACLE_GRID_M = 15;\n  const VOR_NAV_DURATION_SECONDS = 180;\n  const CACHE_KEY",
'new constants')

# Keep every v3.11.3 question and ADD two new cards. Do not repurpose any slot.
old_cards="""    { slot:'station-interchange', category:'MIXED', title:'Nearest Station an Interchange?', detail:'Is the hiding station served by at least two U-/S-Bahn lines?', kind:'station_interchange' },
    { slot:'street-shape', category:'MIXED', title:'Current Street Shape', detail:'Endgame only: receive a hand-drawn outline of the Hider’s nearest street.', kind:'street_shape', endgame_only:true },"""
new_cards=old_cards+"""
    { slot:'nearest-bus-line', category:'TENTACLES', title:'Nearest Bus Line', detail:'Endgame only: among Vienna bus lines crossing or within 1 km of the remaining area, keep the territory closest to the answered line.', kind:'bus_line_tentacle', endgame_only:true, search_buffer_m:BUS_TENTACLE_SEARCH_BUFFER_M },
    { slot:'vor-navigation', category:'MIXED', title:'VOR Navigation', detail:'Endgame only: 3 minutes of a live 30° direction sector toward the hiding spot. No Hider answer required.', kind:'vor_navigation', endgame_only:true, duration_seconds:VOR_NAV_DURATION_SECONDS },"""
app=must_replace(app,old_cards,new_cards,'question cards')

# Coalesce game-state reloads and add VOR state without changing any existing state fields.
app=must_replace(app,
"    realtimeChannel:null, timerId:null, pollId:null, serverOffsetMs:0,",
"    realtimeChannel:null, timerId:null, pollId:null, serverOffsetMs:0,reloadPromise:null,reloadQueued:false,",
'reload state')
app=must_replace(app,
"developerPreview:false,developerPreviewRole:null,passierscheinWasActive:false\n  };",
"developerPreview:false,developerPreviewRole:null,passierscheinWasActive:false,\n    vorQuestionId:null,vorBearing:null,vorHeading:null,vorExpiresAt:0,vorGeoWatchId:null,vorOrientationHandler:null,vorCompassPermission:'unknown',vorLastBearingFetch:0,vorBearingBusy:false,vorRenderTimer:null\n  };",
'VOR state')

# ---------------------------------------------------------------------------
# Bus-line extraction. The existing v3.11.3 chunked transit refresh already
# stores OEFFLINIENOGD tile payloads in Supabase SQL. We read only the tiles
# covering the Endgame possible area + 1 km, so the browser never loads all
# Vienna buses into one giant JSON object.
# ---------------------------------------------------------------------------
bus_normalizer=r'''
  function busRefsFromProps(props){
    const values=Object.values(props||{}).filter(v=>typeof v==='string'&&v.trim());
    const text=values.join(' ');
    const preferred=firstStringProp(props,['LBEZEICHNUNG','LINIEN','LINIE','LINE','ROUTE','BEZEICHNUNG','LTEXT'])||text;
    const refs=[],seen=new Set();
    for(const m of preferred.toUpperCase().matchAll(/(?:^|[\s,;/])((?:N)?\d{1,3}[A-Z]?|VAL\s*\d{1,2})(?=$|[\s,;/])/g)){
      const ref=m[1].replace(/\s+/g,'');if(!seen.has(ref)){seen.add(ref);refs.push(ref);}
    }
    if(!refs.length)return [];
    const explicitMode=firstStringProp(props,['VERKEHRSMITTEL','VERKEHRSMITTELART','VMITTEL','MITTEL','MODE','TYP','ART'])||text;
    const modeSaysBus=/(?:^|\b)(?:autobus|stadtbus|regionalbus|nachtbus|schnellbus|bus)(?:\b|$)/i.test(explicitMode);
    const codeSaysBus=refs.some(r=>/^N\d/i.test(r)||/^\d{1,2}[A-Z]$/i.test(r)||/^\d{3}$/i.test(r)||/^VAL\d+/i.test(r));
    if(!modeSaysBus&&!codeSaysBus)return [];
    return refs.filter(r=>!/^U\d+/i.test(r)&&!/^S\d+/i.test(r));
  }
  function normalizeOfficialBusLines(geo){
    const out=[],seen=new Set();
    for(const f of (geo?.features||[])){
      const refs=busRefsFromProps(f.properties||{});if(!refs.length)continue;
      for(const line of flattenLineFeatures(f)){
        const key=`${refs.join(',')}|${JSON.stringify(line.geometry?.coordinates||[])}`;if(seen.has(key))continue;seen.add(key);
        line.properties={...(line.properties||{}),transitMode:'bus',routeRefs:refs,routeRef:refs[0]||'',routeName:refs.join(', '),source:'Stadt Wien OGD'};
        out.push(line);
      }
    }
    return out;
  }
'''
app=must_replace(app,"  function normalizeOfficialStations(ubahnGeo,allStopsGeo,railLines,city){",bus_normalizer+"\n  function normalizeOfficialStations(ubahnGeo,allStopsGeo,railLines,city){",'bus normalizer')

bus_helpers=r'''

  async function referenceChunkRowsForTiles(baseKey,tiles){
    initSupabaseIfNeeded();const keys=(tiles||[]).map(t=>chunkDatasetKey(baseKey,t.id));if(!keys.length)return [];
    const {data,error}=await state.supabase.from('reference_datasets').select('dataset_key,payload,source,content_hash,updated_at,checked_at').in('dataset_key',keys).order('dataset_key');
    if(error)throw error;return data||[];
  }
  function refreshTilesForGeometry(geometry,bufferM=0){
    if(!geometry)return [];let search=geometry;
    if(Number(bufferM)>0){try{search=turf.buffer(geometry,Number(bufferM)/1000,{units:'kilometers',steps:12});}catch(_){}}
    let box;try{box=turf.bbox(search);}catch(_){return [];}const [west,south,east,north]=box;
    return refreshGrid().filter(t=>t.east>=west&&t.west<=east&&t.north>=south&&t.south<=north);
  }
  async function ensureBusLines(possible=state.possibleArea,bufferM=BUS_TENTACLE_SEARCH_BUFFER_M){
    const tiles=refreshTilesForGeometry(possible,bufferM);if(!tiles.length)throw new Error('Could not determine Vienna transit tiles for the Endgame area.');
    const rows=await referenceChunkRowsForTiles(REF_RAW_TRANSIT_LINES,tiles),have=new Set(rows.map(r=>r.dataset_key));
    const missing=tiles.filter(t=>!have.has(chunkDatasetKey(REF_RAW_TRANSIT_LINES,t.id)));
    if(missing.length)throw new Error(`Vienna bus data are missing ${missing.length} required transit tile${missing.length===1?'':'s'}. Open Developer → Refresh districts + transit. Completed tiles are retained.`);
    const buses=normalizeOfficialBusLines(mergeFeatureCollections(rows));if(!buses.length)throw new Error('The cached Vienna transit tiles contain no usable bus-line geometry. Refresh districts + transit once.');
    state.mapData.busLines=buses;return buses;
  }
  function matchingBusFeatures(refs,features=state.mapData?.busLines||[]){const wanted=new Set((refs||[]).map(r=>String(r).toUpperCase()));return (features||[]).filter(f=>(f.properties?.routeRefs||[]).some(r=>wanted.has(String(r).toUpperCase())));}
  function busTentacleCandidates(possible,bufferM=BUS_TENTACLE_SEARCH_BUFFER_M){
    if(!possible)return [];let search=possible;try{search=turf.buffer(possible,Number(bufferM)/1000,{units:'kilometers',steps:12});}catch(_){}
    const refs=new Set();for(const f of state.mapData?.busLines||[]){try{if(!turf.booleanIntersects(f,search))continue;}catch(_){continue;}for(const r of f.properties?.routeRefs||[])if(r)refs.add(String(r).toUpperCase());}
    return [...refs].sort((a,b)=>a.localeCompare(b,'de',{numeric:true,sensitivity:'base'}));
  }
  function busFeaturesForArea(possible,refs,bufferM=BUS_TENTACLE_SEARCH_BUFFER_M){
    let search=possible;try{search=turf.buffer(possible,Number(bufferM)/1000,{units:'kilometers',steps:12});}catch(_){}
    return matchingBusFeatures(refs).filter(f=>{try{return turf.booleanIntersects(f,search);}catch(_){return false;}}).map(f=>{try{return turf.simplify(f,{tolerance:.00002,highQuality:false,mutate:false});}catch(_){return f;}});
  }
  function busFeatureGroups(refs,features=[]){const wanted=[...new Set((refs||[]).map(r=>String(r).toUpperCase()))],groups=new Map(wanted.map(r=>[r,[]]));for(const f of features||[])for(const r of f.properties?.routeRefs||[]){const k=String(r).toUpperCase();if(groups.has(k))groups.get(k).push(f);}return groups;}
  function distanceToBusFeatures(point,features){let best=Infinity;for(const f of features||[]){try{best=Math.min(best,turf.pointToLineDistance(point,f,{units:'meters'}));}catch(_){}}return best;}
  function nearestBusLineToPoint(point,refs,features=[]){
    const groups=busFeatureGroups(refs,features);let best=null,bestD=Infinity;
    for(const [ref,fs] of groups){const d=distanceToBusFeatures(point,fs);if(d<bestD){bestD=d;best=ref;}}
    return best?{line_ref:best,distance_m:bestD}:null;
  }
  function busLineNearestRegion(possible,selectedRef,refs,features=[]){
    if(!possible||!selectedRef)return null;const all=[...new Set((refs||[]).map(r=>String(r).toUpperCase()))],selected=String(selectedRef).toUpperCase();if(!all.includes(selected))return null;
    const groups=busFeatureGroups(all,features);if(!(groups.get(selected)||[]).length)return null;
    let cells;try{cells=turf.squareGrid(turf.bbox(possible),BUS_TENTACLE_GRID_M/1000,{units:'kilometers'}).features;}catch(e){console.warn('Bus Voronoi grid failed',e);return null;}
    let region=null;
    for(const cell of cells){
      let clipped;try{clipped=safeIntersect(cell,possible);}catch(_){clipped=null;}if(!clipped)continue;
      let probe;try{probe=turf.centroid(clipped);}catch(_){continue;}let winner=null,best=Infinity;
      for(const ref of all){const d=distanceToBusFeatures(probe,groups.get(ref)||[]);if(d<best-.25){best=d;winner=ref;}else if(Math.abs(d-best)<=.25&&ref===selected){winner=ref;}}
      if(winner===selected)region=safeUnion(region,clipped);
    }
    return region?(safeIntersect(region,possible)||region):null;
  }
  function showBusLinePreview(refs,selectedRef=null,features=[]){
    const wanted=new Set((refs||[]).map(r=>String(r).toUpperCase())),selected=selectedRef?String(selectedRef).toUpperCase():null;
    const fs=(features||[]).filter(f=>(f.properties?.routeRefs||[]).some(r=>wanted.has(String(r).toUpperCase())));if(!fs.length)return;
    state.mapLayers.pendingSameLine?.remove();state.mapLayers.pendingSameLine=L.geoJSON({type:'FeatureCollection',features:fs},{style:f=>{const chosen=selected&&(f.properties?.routeRefs||[]).some(r=>String(r).toUpperCase()===selected);return{color:chosen?'#dc2626':'#f59e0b',weight:chosen?7:4,opacity:chosen?.95:.62};},interactive:false}).addTo(state.gameMap);
  }
'''
anchor="""  function availableRailLineRefs(){
    const refs=new Set();
    for(const f of state.mapData?.railLines||[])for(const r of f.properties?.routeRefs||[])if(/^[US]\\d+/i.test(String(r)))refs.add(String(r).toUpperCase());
    for(const f of state.mapData?.stations||[])for(const r of f.properties?.lineRefs||[])if(/^[US]\\d+/i.test(String(r)))refs.add(String(r).toUpperCase());
    return [...refs].sort((a,b)=>{const pa=a[0]===b[0]?0:(a[0]==='U'?-1:1);if(pa)return pa;return Number(a.slice(1))-Number(b.slice(1))||a.localeCompare(b);});
  }"""
app=must_replace(app,anchor,anchor+bus_helpers,'bus helpers')

# Same Line = NO: preserve the v3.11.3 semantics but only process overlapping
# rail segments and clip them to the selected corridor. This removes the giant
# city-wide union and the blotchy overlay/freeze.
old_same=r'''  function sameLineExclusiveCorridor(refs,radiusM=250){
    const selected=(refs||[]).map(r=>String(r).toUpperCase());const selectedCorridor=sameLineCorridor(selected,radiusM);if(!selectedCorridor)return null;
    const selectedSet=new Set(selected),otherRefs=availableRailLineRefs().filter(r=>!selectedSet.has(String(r).toUpperCase()));
    const otherCorridor=sameLineCorridor(otherRefs,radiusM);const interchanges=interchangeStationArea(radiusM,selected);
    let preserve=otherCorridor;if(interchanges)preserve=safeUnion(preserve,interchanges);
    return preserve?(safeDifference(selectedCorridor,preserve)||null):selectedCorridor;
  }'''
new_same=r'''  function sameLineExclusiveCorridor(refs,radiusM=250){
    const selected=(refs||[]).map(r=>String(r).toUpperCase()),selectedSet=new Set(selected);const selectedCorridor=sameLineCorridor(selected,radiusM);if(!selectedCorridor)return null;
    let preserve=interchangeStationArea(radiusM,selected),search=selectedCorridor;
    try{search=turf.buffer(selectedCorridor,Number(radiusM)/1000,{units:'kilometers',steps:8});}catch(_){}
    for(const f of state.mapData?.railLines||[]){
      const routeRefs=(f.properties?.routeRefs||[]).map(r=>String(r).toUpperCase());if(!routeRefs.some(r=>!selectedSet.has(r)))continue;
      try{if(!turf.booleanIntersects(f,search))continue;const buffered=turf.buffer(f,Number(radiusM)/1000,{units:'kilometers',steps:8}),overlap=safeIntersect(buffered,selectedCorridor);if(overlap)preserve=safeUnion(preserve,overlap);}catch(_){}
    }
    return preserve?(safeDifference(selectedCorridor,preserve)||null):selectedCorridor;
  }'''
app=must_replace(app,old_same,new_same,'same line optimization')

# ---------------------------------------------------------------------------
# New question execution paths. These are true engine kinds now; ask_question_v4
# no longer rewrites them into generic Tentacle/Directional questions.
# ---------------------------------------------------------------------------
question_insert=r'''

    if(card.kind==='bus_line_tentacle'||card.engine_kind==='bus_line_tentacle'){
      cancelQuestionPreview();const bufferM=Number(card.search_buffer_m||BUS_TENTACLE_SEARCH_BUFFER_M);await ensureBusLines(state.possibleArea,bufferM);const refs=busTentacleCandidates(state.possibleArea,bufferM);
      if(!refs.length)return toast(`No Vienna bus line crosses or comes within ${Math.round(bufferM)} m of the remaining Endgame area.`);
      const busFeatures=busFeaturesForArea(state.possibleArea,refs,bufferM);if(!busFeatures.length)return toast('No usable bus geometry is available for this Endgame area. Refresh districts + transit once.');
      showBusLinePreview(refs,null,busFeatures);const payload={slot_key:card.slot,question_kind:'bus_line_tentacle',title:card.title,search_buffer_m:bufferM,candidate_line_refs:refs,bus_features:busFeatures};
      const ok=await confirmAction(`Ask ${card.title}?`,`${refs.length} Vienna bus line${refs.length===1?'':'s'} cross or come within ${Math.round(bufferM)} m of the remaining Endgame area.\n\nThe Hider confirms the line nearest to the actual hiding spot. The remaining map is cut to points closer to that line than to every other candidate line.`,`Ask Tentacle`);if(!ok){clearPendingOverlay();return;}
      const {error}=await state.supabase.rpc('ask_question_v4',{p_game_id:state.game.id,p_slot_key:card.slot,p_kind:'bus_line_tentacle',p_payload:payload});if(error)throw error;clearPendingOverlay();await reloadGameState();return;
    }

    if(card.kind==='vor_navigation'||card.engine_kind==='vor_navigation'){
      cancelQuestionPreview();const origin=await resolveQuestionOrigin(card,providedOrigin);if(!origin)return;
      try{await publishSeekerLivePosition(origin);}catch(e){console.warn('Could not pre-publish VOR seeker position',e);}
      const duration=Math.max(30,Math.min(300,Number(card.duration_seconds||VOR_NAV_DURATION_SECONDS))),payload={slot_key:card.slot,question_kind:'vor_navigation',title:card.title,duration_seconds:duration,origin};
      const ok=await confirmAction(`Start ${card.title}?`,`For 3 minutes a black direction display appears below the map. A fading red 30° sector points toward the Hider and updates from your GPS.\n\nWith compass/orientation permission it follows the phone heading. Without compass access it stays north-up with a white N at the top. The Hider does not answer manually.`,`Start VOR`);if(!ok)return;
      const {data:qId,error}=await state.supabase.rpc('ask_question_v4',{p_game_id:state.game.id,p_slot_key:card.slot,p_kind:'vor_navigation',p_payload:payload});if(error)throw error;
      const {error:activateError}=await state.supabase.rpc('activate_vor_navigation_v1',{p_game_id:state.game.id,p_question_action_id:qId});if(activateError)throw activateError;
      await reloadGameState();renderVorNavigation();return;
    }
'''
needle="""    if(state.previewQuestionSlot&&state.previewQuestionSlot!==card.slot)cancelQuestionPreview();

    if(card.kind==='tentacle'){"""
app=must_replace(app,needle,"    if(state.previewQuestionSlot&&state.previewQuestionSlot!==card.slot)cancelQuestionPreview();"+question_insert+"\n    if(card.kind==='tentacle'){",'new question handlers')

# Suggested Hider answer for Bus.
needle="""    if(p.question_kind==='thermometer'){const from=turf.point([p.from.lng,p.from.lat]),to=turf.point([p.to.lng,p.to.lat]);const df=turf.distance(target,from,{units:'meters'}),dt=turf.distance(target,to,{units:'meters'});const yes=dt<df;return {type:'boolean',value:yes,text:`${yes?'WARMER':'COLDER'} — ${Math.round(df)} m → ${Math.round(dt)} m from the private target.`};}
    if(p.question_kind==='tentacle'){"""
insert="""    if(p.question_kind==='thermometer'){const from=turf.point([p.from.lng,p.from.lat]),to=turf.point([p.to.lng,p.to.lat]);const df=turf.distance(target,from,{units:'meters'}),dt=turf.distance(target,to,{units:'meters'});const yes=dt<df;return {type:'boolean',value:yes,text:`${yes?'WARMER':'COLDER'} — ${Math.round(df)} m → ${Math.round(dt)} m from the private target.`};}
    if(p.question_kind==='bus_line_tentacle'){
      if(!state.secret?.endgame||!state.secret?.hidden)return {type:'bus_line_tentacle',status:'unavailable',text:'Nearest Bus Line requires the actual Endgame hiding spot.'};
      const refs=p.candidate_line_refs||[],best=nearestBusLineToPoint(target,refs,p.bus_features||[]);if(!best)return {type:'bus_line_tentacle',status:'unavailable',text:'No candidate bus-line geometry is available.'};
      return {type:'bus_line_tentacle',status:'line',line_ref:best.line_ref,nearest_distance_m:best.distance_m,text:`Closest line: ${best.line_ref}.`};
    }
    if(p.question_kind==='tentacle'){"""
app=must_replace(app,needle,insert,'bus suggested answer')

# Bus answer action.
answer_bus=r'''
  async function answerBusLineTentacle(q){
    const s=suggestedAnswer(q);if(s?.status!=='line'||!s.line_ref)return toast('No valid bus-line answer is available. Refresh districts + transit if necessary.');
    const answer={type:'bus_line_tentacle',status:'line',line_ref:s.line_ref},pen=currentQuestionPenaltyMinutes(q);
    const ok=await confirmAction('Send Nearest Bus Line answer?',`${questionLabel(q)}\n\nClosest line: ${s.line_ref}.\n\nOnly the line identity is published; the private distance is not.${pen?`\n\nCurrent late penalty: −${pen} min`:''}`,`Send answer`);if(!ok)return;
    const {error}=await state.supabase.rpc('answer_bus_line_tentacle_v1',{p_game_id:state.game.id,p_question_action_id:q.id,p_password:state.hiderPassword,p_answer:answer});if(error)throw error;await reloadGameState();
  }
'''
app=must_replace(app,"  async function autoVetoTentacle(q){",answer_bus+"\n  async function autoVetoTentacle(q){",'bus answer function')

# Apply Bus Voronoi constraint after answer.
needle="""    if(p.question_kind==='thermometer'){
      const half=warmerHalfPlane(possible,p.from,p.to,!!boolValue);if(!half)return possible;
      const cut=safeIntersect(possible,half);if(!cut){console.warn('Thermometer cut produced no geometry',p,answer);return null;}return cut;
    }
    if(p.question_kind==='tentacle'){"""
insert="""    if(p.question_kind==='thermometer'){
      const half=warmerHalfPlane(possible,p.from,p.to,!!boolValue);if(!half)return possible;
      const cut=safeIntersect(possible,half);if(!cut){console.warn('Thermometer cut produced no geometry',p,answer);return null;}return cut;
    }
    if(p.question_kind==='bus_line_tentacle'){
      if(answer?.status==='line'&&answer.line_ref){const region=busLineNearestRegion(possible,answer.line_ref,p.candidate_line_refs||[],p.bus_features||[]);if(!region)return possible;return invert?safeDifference(possible,region):region;}return possible;
    }
    if(p.question_kind==='tentacle'){"""
app=must_replace(app,needle,insert,'bus constraint')

# Hider overlay: show candidate buses and the privately calculated closest line only.
old="""    if(p.question_kind==='tentacle'){showPoiPreview(p.pois||[]);if(p.origin)showTentacleRangePreview(p.origin);const s=suggestedAnswer(q);if(s?.status==='poi')showTentacleCellPreview(q,s.poi);}else previewQuestionGeometry(p);"""
new="""    if(p.question_kind==='tentacle'){showPoiPreview(p.pois||[]);if(p.origin)showTentacleRangePreview(p.origin);const s=suggestedAnswer(q);if(s?.status==='poi')showTentacleCellPreview(q,s.poi);}else if(p.question_kind==='bus_line_tentacle'){const s=suggestedAnswer(q);showBusLinePreview(p.candidate_line_refs||[],s?.line_ref||null,p.bus_features||[]);}else previewQuestionGeometry(p);"""
app=must_replace(app,old,new,'pending bus overlay')

# Pending Hider controls for Bus.
old="""      if(kind==='tentacle'){
        if(s?.status==='auto_veto')controls=`<button class=\"danger full\" data-auto-veto-tentacle=\"${q.id}\">Confirm automatic veto</button>`;
        else if(s?.status==='poi')controls=`<button class=\"primary full\" data-send-tentacle=\"${q.id}\">Closest to ${escapeHtml(s.poi?.name||'…')}</button>`;
        else controls=`<div class=\"mini-status\">${escapeHtml(s?.text||'Tentacle unavailable.')}</div>`;
      }else if(kind==='photo'){"""
new="""      if(kind==='tentacle'){
        if(s?.status==='auto_veto')controls=`<button class=\"danger full\" data-auto-veto-tentacle=\"${q.id}\">Confirm automatic veto</button>`;
        else if(s?.status==='poi')controls=`<button class=\"primary full\" data-send-tentacle=\"${q.id}\">Closest to ${escapeHtml(s.poi?.name||'…')}</button>`;
        else controls=`<div class=\"mini-status\">${escapeHtml(s?.text||'Tentacle unavailable.')}</div>`;
      }else if(kind==='bus_line_tentacle'){
        if(s?.status==='line')controls=`<button class=\"primary full\" data-send-bus-line=\"${q.id}\">Closest to bus ${escapeHtml(s.line_ref)}</button>`;
        else controls=`<div class=\"mini-status\">${escapeHtml(s?.text||'Bus-line Tentacle unavailable.')}</div>`;
      }else if(kind==='photo'){"""
app=must_replace(app,old,new,'bus pending control')
app=must_replace(app,
"    $('pendingQuestions').querySelectorAll('[data-send-tentacle]').forEach(b=>b.addEventListener('click',()=>{const q=state.actions.find(a=>a.id===b.dataset.sendTentacle);if(q)answerTentacle(q).catch(handleError);}));",
"    $('pendingQuestions').querySelectorAll('[data-send-tentacle]').forEach(b=>b.addEventListener('click',()=>{const q=state.actions.find(a=>a.id===b.dataset.sendTentacle);if(q)answerTentacle(q).catch(handleError);}));\n    $('pendingQuestions').querySelectorAll('[data-send-bus-line]').forEach(b=>b.addEventListener('click',()=>{const q=state.actions.find(a=>a.id===b.dataset.sendBusLine);if(q)answerBusLineTentacle(q).catch(handleError);}));",
'bus pending listener')

# Labels/history keep old types and add new ones.
app=must_replace(app,
"if(p.question_kind==='same_line')return `Line · ${p.selected_line||(p.line_refs||[]).join(', ')}`;if(p.question_kind==='station_interchange')return 'Nearest Station an Interchange?';",
"if(p.question_kind==='same_line')return `Line · ${p.selected_line||(p.line_refs||[]).join(', ')}`;if(p.question_kind==='station_interchange')return 'Nearest Station an Interchange?';if(p.question_kind==='bus_line_tentacle')return 'Nearest Bus Line';if(p.question_kind==='vor_navigation')return 'VOR Navigation';",
'activity labels')
app=must_replace(app,
"if(p.question_kind==='same_line')return `Line: ${p.selected_line||(p.line_refs||[]).join(', ')}`;if(p.question_kind==='station_interchange')return 'Nearest Station an Interchange?';",
"if(p.question_kind==='same_line')return `Line: ${p.selected_line||(p.line_refs||[]).join(', ')}`;if(p.question_kind==='station_interchange')return 'Nearest Station an Interchange?';if(p.question_kind==='bus_line_tentacle')return 'Nearest Bus Line';if(p.question_kind==='vor_navigation')return 'VOR Navigation';",
'question labels')
app=must_replace(app,
"if(ans.type==='tentacle'&&ans.status==='poi')return `Hider is closest to ${ans.poi?.name||'selected POI'}`;",
"if(ans.type==='tentacle'&&ans.status==='poi')return `Hider is closest to ${ans.poi?.name||'selected POI'}`;if(ans.type==='bus_line_tentacle'&&ans.status==='line')return `Closest to bus ${ans.line_ref||'?'}`;if(ans.type==='vor_navigation')return '3 min VOR signal';",
'answer labels')

# ---------------------------------------------------------------------------
# VOR live display. Bearing is fetched server-side; hidden coordinates never
# enter the Seeker client. Server falls back to the question origin for the
# very first bearing, then uses the live seeker position table as GPS updates.
# ---------------------------------------------------------------------------
vor_code=r'''

  function normalizeDegrees(v){v=Number(v)%360;return v<0?v+360:v;}
  function vorHeadingFromEvent(e){
    let h=null;if(Number.isFinite(Number(e?.webkitCompassHeading)))h=Number(e.webkitCompassHeading);else if(e?.absolute&&Number.isFinite(Number(e.alpha)))h=360-Number(e.alpha);
    if(h===null)return null;const screenAngle=Number(screen.orientation?.angle??window.orientation??0)||0;return normalizeDegrees(h+screenAngle);
  }
  function attachVorOrientation(){
    if(state.vorOrientationHandler)return;state.vorOrientationHandler=e=>{const h=vorHeadingFromEvent(e);if(h===null)return;state.vorHeading=h;state.vorCompassPermission='granted';requestAnimationFrame(()=>renderVorNavigation());};
    window.addEventListener('deviceorientationabsolute',state.vorOrientationHandler,true);window.addEventListener('deviceorientation',state.vorOrientationHandler,true);
  }
  async function enableVorCompass(){
    try{if(typeof DeviceOrientationEvent==='undefined'){state.vorCompassPermission='unsupported';renderVorNavigation();return;}if(typeof DeviceOrientationEvent.requestPermission==='function'){const r=await DeviceOrientationEvent.requestPermission();if(r!=='granted'){state.vorCompassPermission='denied';renderVorNavigation();return;}}attachVorOrientation();state.vorCompassPermission='granted';renderVorNavigation();}catch(e){console.warn('Compass permission failed',e);state.vorCompassPermission='denied';renderVorNavigation();}
  }
  function activeVorNavigation(){
    const qs=effectiveActions('question').filter(q=>q.payload?.question_kind==='vor_navigation').sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
    for(const q of qs){const a=activeAnswerForQuestion(q.id),answer=a?.payload?.answer;if(answer?.type!=='vor_navigation')continue;const expiry=new Date(answer.expires_at).getTime();if(Number.isFinite(expiry)&&expiry>serverNowMs())return{question:q,answer,expiry};}return null;
  }
  async function requestVorBearing(q,{force=false}={}){
    if(!q||state.role!=='seeker'||state.vorBearingBusy)return;const now=Date.now();if(!force&&now-state.vorLastBearingFetch<1000)return;state.vorLastBearingFetch=now;state.vorBearingBusy=true;
    try{const {data,error}=await state.supabase.rpc('get_vor_navigation_bearing_v1',{p_game_id:state.game.id,p_question_action_id:q.id});if(error)throw error;const row=Array.isArray(data)?data[0]:data;if(row&&Number.isFinite(Number(row.bearing_deg))){state.vorBearing=normalizeDegrees(Number(row.bearing_deg));state.vorExpiresAt=new Date(row.expires_at).getTime();}}catch(e){console.warn('VOR bearing refresh failed',e);}finally{state.vorBearingBusy=false;}
  }
  function startVorTracking(q){
    if(state.role!=='seeker'||!q)return;
    if(state.vorGeoWatchId===null&&navigator.geolocation){state.vorGeoWatchId=navigator.geolocation.watchPosition(pos=>{const p={lat:pos.coords.latitude,lng:pos.coords.longitude,accuracy_m:pos.coords.accuracy,source:'gps'};state.lastGpsUpdateMs=Date.now();setCurrentPosition(p,{pan:false});publishSeekerLivePosition(p).then(()=>requestVorBearing(q,{force:true})).catch(e=>console.warn('VOR live GPS publish failed',e));},e=>console.warn('VOR live GPS unavailable',e),{enableHighAccuracy:true,maximumAge:1000,timeout:10000});}
    if(typeof DeviceOrientationEvent!=='undefined'&&typeof DeviceOrientationEvent.requestPermission!=='function'&&!state.vorOrientationHandler)attachVorOrientation();
    if(!state.vorRenderTimer)state.vorRenderTimer=setInterval(()=>renderVorNavigation(),1000);
  }
  function stopVorTracking(){
    if(state.vorGeoWatchId!==null&&navigator.geolocation){try{navigator.geolocation.clearWatch(state.vorGeoWatchId);}catch(_){}}state.vorGeoWatchId=null;
    if(state.vorOrientationHandler){window.removeEventListener('deviceorientationabsolute',state.vorOrientationHandler,true);window.removeEventListener('deviceorientation',state.vorOrientationHandler,true);}state.vorOrientationHandler=null;
    if(state.vorRenderTimer)clearInterval(state.vorRenderTimer);state.vorRenderTimer=null;state.vorQuestionId=null;state.vorBearing=null;state.vorHeading=null;state.vorExpiresAt=0;state.vorLastBearingFetch=0;state.vorBearingBusy=false;
  }
  function renderVorNavigation(){
    const panel=$('vorNavigationPanel');if(!panel)return;const active=state.role==='seeker'?activeVorNavigation():null;
    if(!active){panel.classList.add('hidden');if(state.vorQuestionId)stopVorTracking();return;}
    panel.classList.remove('hidden');state.vorQuestionId=active.question.id;state.vorExpiresAt=active.expiry;startVorTracking(active.question);requestVorBearing(active.question).catch(()=>{});
    const timer=$('vorNavigationTimer');if(timer)timer.textContent=formatCountdown(Math.max(0,Math.ceil((active.expiry-serverNowMs())/1000)));
    const sector=$('vorSector'),north=$('vorNorthRing'),status=$('vorNavigationStatus'),button=$('vorCompassButton'),heading=Number.isFinite(state.vorHeading)?state.vorHeading:null,bearing=Number.isFinite(state.vorBearing)?state.vorBearing:null;
    if(button&&!button.dataset.bound){button.dataset.bound='1';button.addEventListener('click',()=>enableVorCompass());}
    if(bearing!==null){sector?.style.setProperty('--vor-angle',`${normalizeDegrees(bearing-(heading??0))}deg`);sector?.classList.add('ready');}else sector?.classList.remove('ready');
    north?.style.setProperty('--vor-north-angle',`${heading===null?0:normalizeDegrees(-heading)}deg`);
    const needsPermission=typeof DeviceOrientationEvent!=='undefined'&&typeof DeviceOrientationEvent.requestPermission==='function'&&state.vorCompassPermission==='unknown';if(button)button.classList.toggle('hidden',!needsPermission);
    if(status){if(bearing===null)status.textContent='Waiting for a GPS direction fix…';else if(heading!==null)status.textContent='Live compass mode · red 30° sector points toward the Hider.';else status.textContent='North-up mode · N is fixed at the top; red 30° sector points toward the Hider.';}
  }
'''
app=must_replace(app,"\n  function renderAll(){",vor_code+"\n\n  function renderAll(){",'VOR functions')
app=must_replace(app,
"function renderAll(){renderQuestionDeck();renderPendingQuestions();renderCurseDraws();renderTimeTraps();renderActiveCurses();renderActivity();renderPossibleArea();renderHiderSecret();renderSeekerLiveForHider();renderSeekerEndgame();renderGameClock();renderTurntablesPanel();renderTurntablesFreezeControls();applyDeveloperPreviewReadOnly();}",
"function renderAll(){renderQuestionDeck();renderPendingQuestions();renderCurseDraws();renderTimeTraps();renderActiveCurses();renderActivity();renderPossibleArea();renderHiderSecret();renderSeekerLiveForHider();renderSeekerEndgame();renderGameClock();renderTurntablesPanel();renderTurntablesFreezeControls();renderVorNavigation();applyDeveloperPreviewReadOnly();}",
'render VOR')
app=must_replace(app,"stopGpsAutoTracking();clearPrivateMapLayers();","stopGpsAutoTracking();stopVorTracking();clearPrivateMapLayers();",'stop VOR on leave')

# Serialize/coalesce refreshes so realtime + polling do not redraw Turf/Leaflet simultaneously.
old_reload="""  async function reloadGameState(){
    await reloadGamePublic();await reloadActions();processActionNotifications();
    if(state.developerPreview&&state.role==='hider')await reloadDeveloperHiderPreview();
    else {if(state.role==='hider')await refreshHiderSecret();await reloadHiderPrivate();}
    deriveLocalState();await recomputePossibleArea();renderAll();
  }"""
new_reload="""  async function reloadGameStateOnce(){
    await reloadGamePublic();await reloadActions();processActionNotifications();
    if(state.developerPreview&&state.role==='hider')await reloadDeveloperHiderPreview();
    else {if(state.role==='hider')await refreshHiderSecret();await reloadHiderPrivate();}
    deriveLocalState();await recomputePossibleArea();renderAll();
  }
  function reloadGameState(){
    if(state.reloadPromise){state.reloadQueued=true;return state.reloadPromise;}
    state.reloadPromise=(async()=>{do{state.reloadQueued=false;await reloadGameStateOnce();}while(state.reloadQueued);})().finally(()=>{state.reloadPromise=null;});
    return state.reloadPromise;
  }"""
app=must_replace(app,old_reload,new_reload,'reload serialization')

# Developer editor understands the two additional engine kinds without removing old kinds.
app=must_replace(app,
"const QUESTION_KINDS=['district','same_line','station_interchange','street_shape','district_set','landmark_compare','directional','radar','thermometer','tentacle','photo'];",
"const QUESTION_KINDS=['district','same_line','station_interchange','street_shape','bus_line_tentacle','vor_navigation','district_set','landmark_compare','directional','radar','thermometer','tentacle','photo'];",
'developer kinds')

# ---------------------------------------------------------------------------
# HTML: v3.11.3 layout + one VOR panel directly below the map.
# ---------------------------------------------------------------------------
html=re.sub(r'styles\.css\?v=[0-9.]+','styles.css?v=3.13.0',html)
html=re.sub(r'app\.js\?v=[0-9.]+','app.js?v=3.13.0',html)
html=re.sub(r'DEVELOPER · BUILD [0-9.]+','DEVELOPER · BUILD 3.13.0',html)
vor_panel=r'''
          <section id="vorNavigationPanel" class="vor-navigation-panel hidden" aria-live="polite">
            <div class="vor-navigation-head"><strong>VOR Navigation</strong><span id="vorNavigationTimer">3:00</span></div>
            <div class="vor-navigation-body">
              <div id="vorDisk" class="vor-disk" aria-label="VOR direction display">
                <div id="vorSector" class="vor-sector"></div>
                <div id="vorNorthRing" class="vor-north-ring"><span>N</span></div>
                <span class="vor-center-dot"></span>
              </div>
              <div class="vor-navigation-copy"><div id="vorNavigationStatus">Waiting for a GPS direction fix…</div><button id="vorCompassButton" class="secondary small">Enable compass</button></div>
            </div>
          </section>

'''
html=must_replace(html,'          <section id="pendingQuestionsPanel"',vor_panel+'          <section id="pendingQuestionsPanel"','VOR panel')

# CSS only adds the VOR surface; every v3.11.3 style remains untouched.
css += r'''

/* v3.13.0 VOR Navigation -------------------------------------------------- */
.vor-navigation-panel{margin:10px 0 14px;padding:14px 16px;border-radius:16px;background:#111827;color:#f8fafc;box-shadow:0 10px 28px rgba(15,23,42,.16)}
.vor-navigation-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px}.vor-navigation-head strong{font-size:1rem}.vor-navigation-head span{font-variant-numeric:tabular-nums;font-weight:800;color:#fca5a5}
.vor-navigation-body{display:flex;align-items:center;gap:18px;flex-wrap:wrap}.vor-navigation-copy{flex:1;min-width:190px;color:#cbd5e1;line-height:1.45}.vor-navigation-copy button{margin-top:10px}
.vor-disk{position:relative;width:min(220px,62vw);aspect-ratio:1;border-radius:50%;overflow:hidden;flex:0 0 auto;background:radial-gradient(circle at 50% 50%,#111 0 30%,#080808 55%,#020202 100%);border:2px solid #475569;box-shadow:inset 0 0 28px rgba(255,255,255,.035),0 8px 22px rgba(0,0,0,.3)}
.vor-disk::before,.vor-disk::after{content:'';position:absolute;left:10%;right:10%;top:50%;height:1px;background:rgba(255,255,255,.10);transform-origin:center}.vor-disk::after{transform:rotate(90deg)}
.vor-sector{--vor-angle:0deg;position:absolute;inset:0;border-radius:50%;opacity:0;transform:rotate(var(--vor-angle));background:conic-gradient(from -15deg,rgba(239,68,68,.98) 0deg,rgba(239,68,68,.66) 15deg,rgba(239,68,68,.98) 30deg,transparent 30.1deg 360deg);-webkit-mask:radial-gradient(circle,transparent 0 24%,rgba(0,0,0,.12) 42%,rgba(0,0,0,.68) 72%,#000 100%);mask:radial-gradient(circle,transparent 0 24%,rgba(0,0,0,.12) 42%,rgba(0,0,0,.68) 72%,#000 100%);transition:transform .18s linear,opacity .2s}.vor-sector.ready{opacity:1}
.vor-north-ring{--vor-north-angle:0deg;position:absolute;inset:11px;border-radius:50%;transform:rotate(var(--vor-north-angle));transition:transform .18s linear;pointer-events:none}.vor-north-ring span{position:absolute;top:-2px;left:50%;transform:translateX(-50%);font-size:.92rem;font-weight:900;line-height:1;color:#fff;text-shadow:0 1px 3px #000}
.vor-center-dot{position:absolute;left:50%;top:50%;width:8px;height:8px;border-radius:50%;background:#fff;transform:translate(-50%,-50%);box-shadow:0 0 0 3px rgba(255,255,255,.12)}
@media(max-width:620px){.vor-navigation-body{justify-content:center}.vor-navigation-copy{flex-basis:100%;text-align:center}}
'''

# ---------------------------------------------------------------------------
# SQL migration. It explicitly restores the two v3.11.3 catalogue rows that
# v3.12.0 overwrote, adds NEW keys for Bus/VOR, and makes them real engine
# kinds so ask_question_v4 cannot turn them into generic Yes/No questions.
# ---------------------------------------------------------------------------
sql=r'''-- Hide & Seek: Vienna v3.13.0
-- Base application restored to v3.11.3 behavior, with two additive questions:
-- Nearest Bus Line and VOR Navigation.
-- Run once after the existing migrations. Then Developer -> Refresh districts + transit once.

create extension if not exists pgcrypto with schema extensions;

-- Restore the v3.11.3 questions if v3.12.0 previously repurposed their keys.
insert into public.question_catalog(question_key,category,title,description,question_kind,params,endgame_only,enabled,sort_order)
values
('station-interchange','MIXED','Nearest Station an Interchange?','Is the hiding station served by at least two U-/S-Bahn lines?','station_interchange','{"radius_m":250}'::jsonb,false,true,25),
('street-shape','MIXED','Current Street Shape','Receive a hand-drawn outline of the Hider''s nearest street.','street_shape','{}'::jsonb,true,true,30)
on conflict(question_key) do update set category=excluded.category,title=excluded.title,description=excluded.description,question_kind=excluded.question_kind,params=excluded.params,endgame_only=excluded.endgame_only,enabled=excluded.enabled,sort_order=excluded.sort_order,updated_at=now();

alter table public.question_catalog drop constraint if exists question_catalog_question_kind_check;
alter table public.question_catalog add constraint question_catalog_question_kind_check check(question_kind in(
  'radar','district','district_set','landmark_compare','directional','same_line','station_interchange',
  'thermometer','tentacle','photo','street_shape','bus_line_tentacle','vor_navigation'
));

insert into public.question_catalog(question_key,category,title,description,question_kind,params,endgame_only,enabled,sort_order)
values
('nearest-bus-line','TENTACLES','Nearest Bus Line','Endgame only: among Vienna bus lines crossing or within 1 km of the remaining area, keep the territory closest to the answered line.','bus_line_tentacle','{"search_buffer_m":1000}'::jsonb,true,true,32),
('vor-navigation','MIXED','VOR Navigation','Endgame only: for 3 minutes show Seekers a live 30 degree direction sector toward the hiding spot. No Hider answer is required.','vor_navigation','{"duration_seconds":180}'::jsonb,true,true,34)
on conflict(question_key) do update set category=excluded.category,title=excluded.title,description=excluded.description,question_kind=excluded.question_kind,params=excluded.params,endgame_only=excluded.endgame_only,enabled=excluded.enabled,sort_order=excluded.sort_order,updated_at=now();

-- Preserve v3.11.3 Turntables phase reuse while allowing the two new real engine kinds.
create or replace function public.ask_question_v4(p_game_id uuid,p_slot_key text,p_kind text,p_payload jsonb)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid;v_phase_start timestamptz:='epoch'::timestamptz;
begin
  if p_kind not in ('radar','district','district_set','landmark_compare','directional','same_line','station_interchange','thermometer','tentacle','photo','street_shape','bus_line_tentacle','vor_navigation') then raise exception 'Invalid question kind.';end if;
  if not exists(select 1 from public.games where id=p_game_id and status='active') then raise exception 'Game is not active.';end if;
  select coalesce(max(created_at),'epoch'::timestamptz) into v_phase_start from public.game_actions where game_id=p_game_id and kind='turntables_relocate' and is_active;
  if exists(select 1 from public.game_actions a where a.game_id=p_game_id and a.kind='question' and a.is_active and a.created_at>v_phase_start and a.payload->>'slot_key'=p_slot_key) then raise exception 'That question card is already active.';end if;
  insert into public.game_actions(game_id,actor,kind,payload) values(p_game_id,'seeker','question',coalesce(p_payload,'{}'::jsonb)||jsonb_build_object('slot_key',p_slot_key,'question_kind',p_kind,'answer_due_at',now()+interval '15 minutes')) returning id into v_id;
  return v_id;
end;$$;
grant execute on function public.ask_question_v4(uuid,text,text,jsonb) to anon,authenticated;

-- Bus answer: use the existing v3.11.3 answer pipeline (late penalties, Tiny House,
-- Turntables suppression) and upgrade a normal draw to Tentacle reward 4-pick-2.
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
    if jsonb_array_length(coalesce(v_extra,'[]'::jsonb))>0 then update public.curse_draws set cards=cards||v_extra,keep_limit=least(2,jsonb_array_length(cards||v_extra)) where question_action_id=p_question_action_id;end if;
  end if;
  return v_answer_id;
end;$$;
grant execute on function public.answer_bus_line_tentacle_v1(uuid,uuid,text,jsonb) to anon,authenticated;

-- VOR auto-resolves immediately, creates the Hider's 4-pick-2 reward, and never
-- exposes hidden coordinates. It deliberately has no manual Hider answer step.
create or replace function public.activate_vor_navigation_v1(p_game_id uuid,p_question_action_id uuid)
returns timestamptz language plpgsql security definer set search_path=public,extensions as $$
declare v_q public.game_actions%rowtype;v_duration integer;v_expires timestamptz;v_cards jsonb;v_reloc_time timestamptz;v_rewardless_limit integer:=0;v_question_ordinal integer:=0;v_suppress boolean:=false;
begin
  if not exists(select 1 from public.games where id=p_game_id and status='active') then raise exception 'Game is not active.';end if;
  select * into v_q from public.game_actions where id=p_question_action_id and game_id=p_game_id and kind='question' and is_active;
  if v_q.id is null or v_q.payload->>'question_kind'<>'vor_navigation' then raise exception 'Question is not VOR Navigation.';end if;
  if not exists(select 1 from public.game_secrets where game_id=p_game_id and endgame and hidden_lat is not null and hidden_lng is not null) then raise exception 'VOR Navigation requires Endgame and an actual hiding spot.';end if;
  if exists(select 1 from public.game_actions where parent_id=p_question_action_id and kind in('answer','question_veto') and is_active) then select (payload->'answer'->>'expires_at')::timestamptz into v_expires from public.game_actions where parent_id=p_question_action_id and kind='answer' and is_active order by created_at desc limit 1;return v_expires;end if;
  v_duration:=least(300,greatest(30,coalesce(nullif(v_q.payload->>'duration_seconds','')::integer,180)));v_expires:=now()+make_interval(secs=>v_duration);
  select r.created_at,coalesce((r.payload->>'rewardless_questions')::integer,0) into v_reloc_time,v_rewardless_limit from public.game_actions r where r.game_id=p_game_id and r.kind='turntables_relocate' and r.is_active order by r.created_at desc limit 1;
  if v_reloc_time is not null and v_q.created_at>v_reloc_time then select count(*) into v_question_ordinal from public.game_actions q where q.game_id=p_game_id and q.kind='question' and q.is_active and q.created_at>v_reloc_time and (q.created_at<v_q.created_at or(q.created_at=v_q.created_at and q.id::text<=p_question_action_id::text));v_suppress:=v_question_ordinal between 1 and v_rewardless_limit;end if;
  insert into public.game_actions(game_id,actor,kind,parent_id,payload) values(p_game_id,'system','answer',p_question_action_id,jsonb_build_object('answer',jsonb_build_object('type','vor_navigation','status','active','expires_at',v_expires,'duration_seconds',v_duration),'auto_resolved',true,'reward_suppressed',v_suppress,'late_penalty_minutes',0));
  if not v_suppress and not exists(select 1 from public.curse_draws where question_action_id=p_question_action_id) then v_cards:=public._draw_cards_v4(p_game_id,4);if jsonb_array_length(v_cards)>0 then insert into public.curse_draws(game_id,question_action_id,cards,keep_limit) values(p_game_id,p_question_action_id,v_cards,least(2,jsonb_array_length(v_cards))) on conflict(question_action_id) do nothing;end if;end if;
  return v_expires;
end;$$;
grant execute on function public.activate_vor_navigation_v1(uuid,uuid) to anon,authenticated;

create or replace function public.get_vor_navigation_bearing_v1(p_game_id uuid,p_question_action_id uuid)
returns table(bearing_deg double precision,expires_at timestamptz)
language plpgsql security definer set search_path=public,extensions as $$
declare v_q public.game_actions%rowtype;v_answer jsonb;v_seeker_lat double precision;v_seeker_lng double precision;v_target_lat double precision;v_target_lng double precision;v_expires timestamptz;v_y double precision;v_x double precision;v_bearing double precision;
begin
  select * into v_q from public.game_actions where id=p_question_action_id and game_id=p_game_id and kind='question' and is_active and payload->>'question_kind'='vor_navigation';if v_q.id is null then return;end if;
  select a.payload->'answer' into v_answer from public.game_actions a where a.parent_id=p_question_action_id and a.kind='answer' and a.is_active order by a.created_at desc limit 1;if coalesce(v_answer->>'type','')<>'vor_navigation' then return;end if;
  v_expires:=(v_answer->>'expires_at')::timestamptz;if v_expires is null or now()>=v_expires then return;end if;
  select lat,lng into v_seeker_lat,v_seeker_lng from public.seeker_live_positions where game_id=p_game_id;
  if v_seeker_lat is null or v_seeker_lng is null then v_seeker_lat:=nullif(v_q.payload->'origin'->>'lat','')::double precision;v_seeker_lng:=nullif(v_q.payload->'origin'->>'lng','')::double precision;end if;
  if v_seeker_lat is null or v_seeker_lng is null then return;end if;
  select hidden_lat,hidden_lng into v_target_lat,v_target_lng from public.game_secrets where game_id=p_game_id and endgame and hidden_lat is not null and hidden_lng is not null;if v_target_lat is null or v_target_lng is null then return;end if;
  v_y:=sin(radians(v_target_lng-v_seeker_lng))*cos(radians(v_target_lat));v_x:=cos(radians(v_seeker_lat))*sin(radians(v_target_lat))-sin(radians(v_seeker_lat))*cos(radians(v_target_lat))*cos(radians(v_target_lng-v_seeker_lng));v_bearing:=degrees(atan2(v_y,v_x));if v_bearing<0 then v_bearing:=v_bearing+360;end if;
  return query select v_bearing,v_expires;
end;$$;
grant execute on function public.get_vor_navigation_bearing_v1(uuid,uuid) to anon,authenticated;
'''

Path('app.js').write_text(app)
Path('index.html').write_text(html)
Path('styles.css').write_text(css)
Path('supabase-v3.13.0-migration.sql').write_text(sql)
print('v3.13.0 files generated from v3.11.3')
