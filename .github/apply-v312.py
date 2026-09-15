from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)


def insert_before(text, marker, addition, label):
    return replace_once(text, marker, addition + marker, label)


def insert_after(text, marker, addition, label):
    return replace_once(text, marker, marker + addition, label)


app_path = ROOT / "app.js"
app = app_path.read_text(encoding="utf-8")

# ---------------------------------------------------------------------------
# Version + the two deliberately replaced question slots.
# ---------------------------------------------------------------------------
app = replace_once(app, "const APP_VERSION = '3.11.3';", "const APP_VERSION = '3.12.0';", "app version")
app = replace_once(
    app,
    "  const TENTACLE_SEARCH_RADIUS_M = 5000;\n",
    "  const TENTACLE_SEARCH_RADIUS_M = 5000;\n"
    "  const BUS_TENTACLE_SEARCH_BUFFER_M = 1000;\n"
    "  const BUS_TENTACLE_GRID_M = 20;\n"
    "  const VOR_NAV_DURATION_SECONDS = 180;\n",
    "new constants",
)
app = replace_once(
    app,
    "    { slot:'station-interchange', category:'MIXED', title:'Nearest Station an Interchange?', detail:'Is the hiding station served by at least two U-/S-Bahn lines?', kind:'station_interchange' },\n"
    "    { slot:'street-shape', category:'MIXED', title:'Current Street Shape', detail:'Endgame only: receive a hand-drawn outline of the Hider’s nearest street.', kind:'street_shape', endgame_only:true },\n",
    "    { slot:'station-interchange', category:'TENTACLES', title:'Nearest Bus Line', detail:'Endgame only: among Vienna bus lines crossing or within 1 km of the remaining area, keep the area closest to the answered line.', kind:'bus_line_tentacle', endgame_only:true, search_buffer_m:BUS_TENTACLE_SEARCH_BUFFER_M },\n"
    "    { slot:'street-shape', category:'MIXED', title:'VOR Navigation', detail:'Endgame only: 3 minutes of a live 30° direction sector toward the hiding spot. No Hider answer required.', kind:'vor_navigation', endgame_only:true, duration_seconds:VOR_NAV_DURATION_SECONDS },\n",
    "default replacement questions",
)
app = replace_once(
    app,
    "    developerPassword:null,referenceMeta:{},sameLineSelection:null,developerCards:[],developerQuestions:[],questionCards:DEFAULT_QUESTION_CARDS.map(x=>({...x})),curseMapSignature:null,turntablesPickMode:false,turntablesCandidate:null,developerPreview:false,developerPreviewRole:null,passierscheinWasActive:false\n",
    "    developerPassword:null,referenceMeta:{},sameLineSelection:null,developerCards:[],developerQuestions:[],questionCards:DEFAULT_QUESTION_CARDS.map(x=>({...x})),curseMapSignature:null,turntablesPickMode:false,turntablesCandidate:null,developerPreview:false,developerPreviewRole:null,passierscheinWasActive:false,\n"
    "    vorQuestionId:null,vorBearing:null,vorHeading:null,vorExpiresAt:0,vorGeoWatchId:null,vorOrientationHandler:null,vorCompassPermission:'unknown',vorLastBearingFetch:0,vorBearingBusy:false,vorRenderTimer:null\n",
    "VOR state",
)
app = replace_once(
    app,
    "    return {slot:r.question_key,category:r.category,title:r.title,detail:r.description,kind:r.question_kind,endgame_only:!!r.endgame_only,...p};\n",
    "    return {slot:r.question_key,category:r.category,title:r.title,detail:r.description,kind:(p.engine_kind||r.question_kind),endgame_only:!!r.endgame_only,...p};\n",
    "catalog engine kind",
)

# ---------------------------------------------------------------------------
# Official Vienna bus geometry. OEFFLINIENOGD already contains all modes; the
# existing code previously discarded everything except U-/S-Bahn segments.
# ---------------------------------------------------------------------------
bus_normalizers = r'''  function busRefsFromProps(props){
    const values=Object.values(props||{}).filter(v=>typeof v==='string'&&v.trim());
    const modeText=values.join(' ');
    if(!/(?:^|\b)(?:autobus|stadtbus|regionalbus|nachtbus|bus)(?:\b|$)/i.test(modeText))return [];
    const preferred=firstStringProp(props,['LBEZEICHNUNG','LINIEN','LINIE','LINE','ROUTE','BEZEICHNUNG']);
    const source=preferred||modeText;const refs=[];const seen=new Set();
    for(const m of source.toUpperCase().matchAll(/(?:^|[\s,;/])((?:N)?\d{1,3}[A-Z]?|VAL\s*\d{1,2})(?=$|[\s,;/])/g)){
      const ref=m[1].replace(/\s+/g,'');if(!seen.has(ref)){seen.add(ref);refs.push(ref);}
    }
    return refs;
  }
  function normalizeOfficialBusLines(geo){
    const out=[];
    for(const f of (geo?.features||[])){
      const refs=busRefsFromProps(f.properties||{});if(!refs.length)continue;
      for(const line of flattenLineFeatures(f)){
        line.properties={...(line.properties||{}),transitMode:'bus',routeRefs:refs,routeRef:refs[0]||'',routeName:refs.join(', '),source:'Stadt Wien OGD'};
        out.push(line);
      }
    }
    return out;
  }
'''
app = insert_before(app, "  function pointFromFeature(f){\n", bus_normalizers, "bus normalizers")
app = replace_once(
    app,
    "    const railLines=normalizeOfficialTransitLines(lineGeo);\n    const stations=normalizeOfficialStations(ubahnStops,allStops,railLines,city);\n    if(stations.length<20)throw new Error(`Vienna official transport data produced only ${stations.length} U-/S-Bahn stations.`);\n    return {stations,railLines};\n",
    "    const railLines=normalizeOfficialTransitLines(lineGeo);\n    const busLines=normalizeOfficialBusLines(lineGeo);\n    const stations=normalizeOfficialStations(ubahnStops,allStops,railLines,city);\n    if(stations.length<20)throw new Error(`Vienna official transport data produced only ${stations.length} U-/S-Bahn stations.`);\n    return {stations,railLines,busLines};\n",
    "official transit bundle buses",
)
app = replace_once(
    app,
    "    state.mapData={city:admin.city,districts:admin.districts,stations:stations.stations,railLines:Array.isArray(transit?.railLines)?transit.railLines:[]};\n",
    "    state.mapData={city:admin.city,districts:admin.districts,stations:stations.stations,railLines:Array.isArray(transit?.railLines)?transit.railLines:[],busLines:Array.isArray(transit?.busLines)?transit.busLines:[]};\n",
    "load bus reference",
)
app = replace_once(
    app,
    "    statusEl.textContent='Building U-Bahn/S-Bahn network…';\n    await new Promise(r=>setTimeout(r,0));\n    const railLines=normalizeOfficialTransitLines(linesGeo);\n",
    "    statusEl.textContent='Building U-Bahn/S-Bahn and bus network…';\n    await new Promise(r=>setTimeout(r,0));\n    const railLines=normalizeOfficialTransitLines(linesGeo);\n    const busLines=normalizeOfficialBusLines(linesGeo);\n",
    "chunked bus normalization",
)
app = replace_once(
    app,
    "    statusEl.textContent=`Saving ${railLines.length} U-/S-Bahn line segments…`;\n    await saveReferenceDataset(REF_TRANSIT_KEY,{railLines},`Chunked Stadt Wien WFS · ${tiles.length} tiles`);\n    return {complete:true,results,stations:stations.length,lines:railLines.length};\n",
    "    statusEl.textContent=`Saving ${railLines.length} U-/S-Bahn + ${busLines.length} bus line segments…`;\n    await saveReferenceDataset(REF_TRANSIT_KEY,{railLines,busLines},`Chunked Stadt Wien WFS · ${tiles.length} tiles`);\n    return {complete:true,results,stations:stations.length,lines:railLines.length,buses:busLines.length};\n",
    "save bus reference",
)
app = replace_once(
    app,
    "    return {railLines:bundle.railLines};\n",
    "    return {railLines:bundle.railLines,busLines:bundle.busLines};\n",
    "transit reference getter",
)

# ---------------------------------------------------------------------------
# Bus-line Tentacle geometry helpers. The line Voronoi is approximated on a
# fine 20 m grid inside the small Endgame polygon, then clipped to that polygon.
# This avoids expensive polygon bisectors between complex polyline geometries.
# ---------------------------------------------------------------------------
bus_helpers = r'''  async function ensureBusLines(){
    if(Array.isArray(state.mapData?.busLines)&&state.mapData.busLines.length)return state.mapData.busLines;
    try{
      const ref=await referenceDataset(REF_TRANSIT_KEY);
      if(Array.isArray(ref?.busLines)&&ref.busLines.length){state.mapData.busLines=ref.busLines;return ref.busLines;}
    }catch(e){console.warn('Bus reference lookup failed',e);}
    const lineGeo=await fetchViennaWfs(VIENNA_TRANSIT_LINES_LAYER,'Vienna bus network');
    const buses=normalizeOfficialBusLines(lineGeo);if(!buses.length)throw new Error('Vienna bus-line data are not seeded yet. Open Developer → Refresh districts + transit.');
    state.mapData.busLines=buses;return buses;
  }
  function matchingBusFeatures(refs){const wanted=new Set((refs||[]).map(r=>String(r).toUpperCase()));return (state.mapData?.busLines||[]).filter(f=>(f.properties?.routeRefs||[]).some(r=>wanted.has(String(r).toUpperCase())));}
  function availableBusLineRefs(){
    const refs=new Set();for(const f of state.mapData?.busLines||[])for(const r of f.properties?.routeRefs||[])if(r)refs.add(String(r).toUpperCase());
    return [...refs].sort((a,b)=>a.localeCompare(b,'de',{numeric:true,sensitivity:'base'}));
  }
  function busTentacleCandidates(possible,bufferM=BUS_TENTACLE_SEARCH_BUFFER_M){
    if(!possible)return [];let search=possible;try{search=turf.buffer(possible,Number(bufferM)/1000,{units:'kilometers',steps:24});}catch(_){}
    const refs=new Set();for(const f of state.mapData?.busLines||[]){try{if(!turf.booleanIntersects(f,search))continue;}catch(_){continue;}for(const r of f.properties?.routeRefs||[])if(r)refs.add(String(r).toUpperCase());}
    return [...refs].sort((a,b)=>a.localeCompare(b,'de',{numeric:true,sensitivity:'base'}));
  }
  function busFeatureGroups(refs){
    const wanted=[...new Set((refs||[]).map(r=>String(r).toUpperCase()))],groups=new Map(wanted.map(r=>[r,[]]));
    for(const f of state.mapData?.busLines||[])for(const r of f.properties?.routeRefs||[]){const key=String(r).toUpperCase();if(groups.has(key))groups.get(key).push(f);}
    return groups;
  }
  function distanceToBusFeatures(point,features){let best=Infinity;for(const f of features||[]){try{best=Math.min(best,turf.pointToLineDistance(point,f,{units:'meters'}));}catch(_){}}return best;}
  function nearestBusLineToPoint(point,refs){
    const groups=busFeatureGroups(refs);let best=null,bestD=Infinity;
    for(const [ref,features] of groups){const d=distanceToBusFeatures(point,features);if(d<bestD){bestD=d;best=ref;}}
    return best?{line_ref:best,distance_m:bestD}:null;
  }
  function busLineNearestRegion(possible,selectedRef,refs){
    if(!possible||!selectedRef)return null;const all=[...new Set((refs||[]).map(r=>String(r).toUpperCase()))];const selected=String(selectedRef).toUpperCase();if(!all.includes(selected))return null;
    const groups=busFeatureGroups(all);if(!(groups.get(selected)||[]).length)return null;
    let cells=[];try{cells=turf.squareGrid(turf.bbox(possible),BUS_TENTACLE_GRID_M/1000,{units:'kilometers'}).features;}catch(e){console.warn('Bus-line grid failed',e);return null;}
    const kept=[];
    for(const cell of cells){
      try{if(!turf.booleanIntersects(cell,possible))continue;}catch(_){continue;}
      let sample;try{const clipped=safeIntersect(cell,possible);sample=turf.centroid(clipped||cell);}catch(_){sample=turf.centroid(cell);}
      let winner=null,winnerD=Infinity;
      for(const ref of all){const d=distanceToBusFeatures(sample,groups.get(ref));if(d<winnerD-0.01){winnerD=d;winner=ref;}}
      if(winner===selected)kept.push(cell);
    }
    if(!kept.length)return null;let region=null;try{region=turf.combine(turf.featureCollection(kept)).features[0]||null;}catch(_){for(const c of kept)region=safeUnion(region,c);}
    return region?safeIntersect(possible,region):null;
  }
  function showBusLinePreview(refs,selectedRef=null){
    state.mapLayers.pendingBusLines?.remove();state.mapLayers.pendingBusLines=null;const features=matchingBusFeatures(refs);if(!features.length||!state.gameMap)return;
    const selected=selectedRef?String(selectedRef).toUpperCase():null;
    state.mapLayers.pendingBusLines=L.geoJSON(turf.featureCollection(features),{style:f=>{const hit=selected&&(f.properties?.routeRefs||[]).some(r=>String(r).toUpperCase()===selected);return{color:hit?'#dc2626':'#f59e0b',weight:hit?7:4,opacity:hit?.95:.55,lineCap:'round',lineJoin:'round'};},interactive:false}).addTo(state.gameMap);
  }
  function showBusLineRegionPreview(possible,selectedRef,refs){
    state.mapLayers.pendingBusRegion?.remove();state.mapLayers.pendingBusRegion=null;const g=busLineNearestRegion(possible,selectedRef,refs);if(!g||!state.gameMap)return;
    state.mapLayers.pendingBusRegion=L.geoJSON(g,{style:{color:'#dc2626',weight:2,dashArray:'6 5',fillColor:'#ef4444',fillOpacity:.13},interactive:false}).addTo(state.gameMap).bindTooltip(`Closest to bus ${selectedRef}`);
  }
'''
app = insert_before(app, "  function districtSetGeometry(numbers){\n", bus_helpers, "bus geometry helpers")
app = replace_once(
    app,
    "    ['pendingCircle','pendingLine','pendingDistrict','pendingBisector','pendingThermoPath','pendingDirection','pendingSameLine','pendingDistrictSet','pendingTentacleCell','pendingTentacleSearch','pendingTentacleVeto'].forEach(k=>{state.mapLayers[k]?.remove();state.mapLayers[k]=null;});\n",
    "    ['pendingCircle','pendingLine','pendingDistrict','pendingBisector','pendingThermoPath','pendingDirection','pendingSameLine','pendingDistrictSet','pendingTentacleCell','pendingTentacleSearch','pendingTentacleVeto','pendingBusLines','pendingBusRegion'].forEach(k=>{state.mapLayers[k]?.remove();state.mapLayers[k]=null;});\n",
    "clear bus previews",
)

# ---------------------------------------------------------------------------
# 3-minute VOR instrument. Bearing comes from Supabase; hidden coordinates never
# enter the seeker client. Compass permission is user-gesture driven on iOS.
# ---------------------------------------------------------------------------
vor_client = r'''  function normalizeDegrees(v){v=Number(v)%360;return v<0?v+360:v;}
  function vorHeadingFromEvent(e){
    let h=null;if(Number.isFinite(Number(e?.webkitCompassHeading)))h=Number(e.webkitCompassHeading);
    else if(e?.absolute&&Number.isFinite(Number(e.alpha)))h=360-Number(e.alpha);
    if(h===null)return null;const screenAngle=Number(screen.orientation?.angle??window.orientation??0)||0;return normalizeDegrees(h+screenAngle);
  }
  function attachVorOrientation(){
    if(state.vorOrientationHandler)return;state.vorOrientationHandler=e=>{const h=vorHeadingFromEvent(e);if(h===null)return;state.vorHeading=h;state.vorCompassPermission='granted';renderVorNavigation();};
    window.addEventListener('deviceorientationabsolute',state.vorOrientationHandler,true);window.addEventListener('deviceorientation',state.vorOrientationHandler,true);
  }
  async function enableVorCompass(){
    try{
      if(typeof DeviceOrientationEvent==='undefined'){state.vorCompassPermission='unsupported';renderVorNavigation();return;}
      if(typeof DeviceOrientationEvent.requestPermission==='function'){
        const result=await DeviceOrientationEvent.requestPermission();if(result!=='granted'){state.vorCompassPermission='denied';renderVorNavigation();return;}
      }
      attachVorOrientation();state.vorCompassPermission='granted';renderVorNavigation();
    }catch(e){console.warn('Compass permission failed',e);state.vorCompassPermission='denied';renderVorNavigation();}
  }
  function activeVorNavigation(){
    const questions=effectiveActions('question').filter(q=>q.payload?.question_kind==='vor_navigation').sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
    for(const q of questions){const a=activeAnswerForQuestion(q.id),answer=a?.payload?.answer;if(answer?.type!=='vor_navigation')continue;const expiry=new Date(answer.expires_at||new Date(q.created_at).getTime()+Number(q.payload?.duration_seconds||VOR_NAV_DURATION_SECONDS)*1000).getTime();if(expiry>serverNowMs())return{question:q,answer,expiry};}
    return null;
  }
  async function requestVorBearing(q,{force=false}={}){
    if(!q||state.role!=='seeker'||state.vorBearingBusy)return;const now=Date.now();if(!force&&now-state.vorLastBearingFetch<1200)return;state.vorLastBearingFetch=now;state.vorBearingBusy=true;
    try{const {data,error}=await state.supabase.rpc('get_vor_navigation_bearing_v1',{p_game_id:state.game.id,p_question_action_id:q.id});if(error)throw error;const row=(data||[])[0];if(row&&Number.isFinite(Number(row.bearing_deg))){state.vorBearing=normalizeDegrees(Number(row.bearing_deg));state.vorExpiresAt=new Date(row.expires_at).getTime();}}
    catch(e){console.warn('VOR bearing refresh failed',e);}finally{state.vorBearingBusy=false;}
  }
  function startVorTracking(q){
    if(state.role!=='seeker'||!q)return;
    if(state.vorGeoWatchId===null&&navigator.geolocation){
      state.vorGeoWatchId=navigator.geolocation.watchPosition(pos=>{const p={lat:pos.coords.latitude,lng:pos.coords.longitude,accuracy_m:pos.coords.accuracy,source:'gps'};state.lastGpsUpdateMs=Date.now();setCurrentPosition(p,{pan:false});publishSeekerLivePosition(p).then(()=>requestVorBearing(q,{force:true})).catch(e=>console.warn('VOR live GPS publish failed',e));},e=>console.warn('VOR live GPS unavailable',e),{enableHighAccuracy:true,maximumAge:1000,timeout:10000});
    }
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
    const remaining=Math.max(0,Math.ceil((active.expiry-serverNowMs())/1000));$('vorNavigationTimer').textContent=formatCountdown(remaining);
    const sector=$('vorSector'),north=$('vorNorthRing'),heading=Number.isFinite(state.vorHeading)?state.vorHeading:null,bearing=Number.isFinite(state.vorBearing)?state.vorBearing:null;
    if(bearing!==null){const angle=normalizeDegrees(bearing-(heading??0));sector?.style.setProperty('--vor-angle',`${angle}deg`);sector?.classList.add('ready');}
    else sector?.classList.remove('ready');
    north?.style.setProperty('--vor-north-angle',`${heading===null?0:normalizeDegrees(-heading)}deg`);
    const compassLive=heading!==null;const status=$('vorNavigationStatus');if(status)status.textContent=bearing===null?'Waiting for current GPS bearing…':compassLive?'Live compass · red 30° sector points toward the Hider.':'North-up fallback · red 30° sector points toward the Hider.';
    const button=$('vorCompassButton');if(button){const canAsk=typeof DeviceOrientationEvent!=='undefined'&&typeof DeviceOrientationEvent.requestPermission==='function';button.classList.toggle('hidden',compassLive||!canAsk);button.textContent=state.vorCompassPermission==='denied'?'Compass denied · north-up mode':'Enable compass';}
    if(remaining<=0){panel.classList.add('hidden');stopVorTracking();}
  }
'''
app = insert_before(app, "\n\n  function cancelQuestionPreview(){\n", "\n" + vor_client, "VOR client")

# ---------------------------------------------------------------------------
# Asking the two questions.
# ---------------------------------------------------------------------------
question_branches = r'''    if(card.kind==='bus_line_tentacle'){
      cancelQuestionPreview();await ensureBusLines();const bufferM=Number(card.search_buffer_m||BUS_TENTACLE_SEARCH_BUFFER_M),refs=busTentacleCandidates(state.possibleArea,bufferM);
      if(!refs.length)return toast(`No Vienna bus line crosses or comes within ${Math.round(bufferM)} m of the remaining Endgame area.`);
      showBusLinePreview(refs);const payload={slot_key:card.slot,question_kind:'bus_line_tentacle',title:card.title,search_buffer_m:bufferM,candidate_line_refs:refs};
      const ok=await confirmAction(`Ask ${card.title}?`,`${refs.length} Vienna bus line${refs.length===1?'':'s'} cross or come within ${Math.round(bufferM)} m of the remaining Endgame area.\n\nThe Hider answers which of those lines is nearest to the actual hiding spot. The map then keeps only the area closer to that bus line than to the other candidate lines.`,`Ask Tentacle`);if(!ok){clearPendingOverlay();return;}
      const {error}=await state.supabase.rpc('ask_question_v4',{p_game_id:state.game.id,p_slot_key:card.slot,p_kind:'tentacle',p_payload:payload});if(error)throw error;clearPendingOverlay();await reloadGameState();return;
    }

    if(card.kind==='vor_navigation'){
      cancelQuestionPreview();const origin=await resolveQuestionOrigin(card,providedOrigin);if(!origin)return;await publishSeekerLivePosition(origin);
      const duration=Math.max(30,Math.min(300,Number(card.duration_seconds||VOR_NAV_DURATION_SECONDS)));const payload={slot_key:card.slot,question_kind:'vor_navigation',title:card.title,duration_seconds:duration,origin};
      const ok=await confirmAction(`Start ${card.title}?`,`For ${Math.round(duration/60)} minutes a black VOR display appears below the map. A fading red 30° sector points toward the Hider and updates with your GPS.\n\nIf phone compass/orientation is available, the sector is relative to the phone heading. Otherwise the display stays north-up with N at the top. The Hider does not answer this question.`,`Start VOR`);if(!ok)return;
      const {data:qId,error}=await state.supabase.rpc('ask_question_v4',{p_game_id:state.game.id,p_slot_key:card.slot,p_kind:'directional',p_payload:payload});if(error)throw error;
      const {error:activateError}=await state.supabase.rpc('activate_vor_navigation_v1',{p_game_id:state.game.id,p_question_action_id:qId});if(activateError)throw activateError;
      await reloadGameState();renderVorNavigation();return;
    }

'''
app = insert_before(app, "    if(card.kind==='photo'){\n", question_branches, "new question branches")

# ---------------------------------------------------------------------------
# Hider answer + spatial result for the bus-line Tentacle.
# ---------------------------------------------------------------------------
app = insert_before(
    app,
    "    if(p.question_kind==='tentacle'){\n",
    "    if(p.question_kind==='bus_line_tentacle'){\n"
    "      if(!state.secret?.endgame||!state.secret?.hidden)return {type:'bus_line_tentacle',status:'unavailable',text:'Nearest Bus Line requires the actual Endgame hiding spot.'};\n"
    "      const refs=p.candidate_line_refs||[],best=nearestBusLineToPoint(target,refs);if(!best)return {type:'bus_line_tentacle',status:'unavailable',text:'No candidate bus line geometry is available.'};\n"
    "      return {type:'bus_line_tentacle',status:'line',line_ref:best.line_ref,nearest_distance_m:best.distance_m,text:`Suggested answer: closest to bus line ${best.line_ref}.`};\n"
    "    }\n",
    "bus suggested answer",
)
app = insert_after(
    app,
    "  async function answerTentacle(q){\n    const s=suggestedAnswer(q); if(s?.status!=='poi'||!s.poi)return toast('This Tentacle does not currently have a valid POI answer.');\n    const answer={type:'tentacle',status:'poi',poi:s.poi};\n    const ok=await confirmAction('Send Tentacle answer?',`${questionLabel(q)}\n\nPublic answer:\nHider is closest to ${s.poi.name}.\n\nAutomatic private check: ${s.text}\n\nOnly the POI name is sent publicly; the private validation distance is never included in the answer.${currentQuestionPenaltyMinutes(q)?`\\n\\nCurrent late penalty: −${currentQuestionPenaltyMinutes(q)} min`:''}`,`Send answer`);if(!ok)return;\n    const {error}=await state.supabase.rpc('answer_question_v5',{p_game_id:state.game.id,p_question_action_id:q.id,p_password:state.hiderPassword,p_answer:answer});if(error)throw error;await reloadGameState();\n  }\n",
    "  async function answerBusLineTentacle(q){\n"
    "    const s=suggestedAnswer(q);if(s?.status!=='line'||!s.line_ref)return toast('No valid bus-line answer is available. Refresh the Vienna transit reference if needed.');\n"
    "    const answer={type:'bus_line_tentacle',status:'line',line_ref:s.line_ref};const pen=currentQuestionPenaltyMinutes(q);\n"
    "    const ok=await confirmAction('Send bus-line Tentacle answer?',`${questionLabel(q)}\\n\\nPublic answer: closest to bus line ${s.line_ref}.\\n\\nThe private distance to the line is not published.${pen?`\\n\\nCurrent late penalty: −${pen} min`:''}`,`Send answer`);if(!ok)return;\n"
    "    const {error}=await state.supabase.rpc('answer_bus_line_tentacle_v1',{p_game_id:state.game.id,p_question_action_id:q.id,p_password:state.hiderPassword,p_answer:answer});if(error)throw error;await reloadGameState();\n"
    "  }\n",
    "bus answer function",
)
app = replace_once(
    app,
    "      if(kind==='tentacle'){\n        if(s?.status==='auto_veto')controls=`<button class=\"danger full\" data-auto-veto-tentacle=\"${q.id}\">Confirm automatic veto</button>`;\n        else if(s?.status==='poi')controls=`<button class=\"primary full\" data-send-tentacle=\"${q.id}\">Closest to ${escapeHtml(s.poi?.name||'…')}</button>`;\n        else controls=`<div class=\"mini-status\">${escapeHtml(s?.text||'Tentacle unavailable.')}</div>`;\n      }else if(kind==='photo'){\n",
    "      if(kind==='tentacle'){\n        if(s?.status==='auto_veto')controls=`<button class=\"danger full\" data-auto-veto-tentacle=\"${q.id}\">Confirm automatic veto</button>`;\n        else if(s?.status==='poi')controls=`<button class=\"primary full\" data-send-tentacle=\"${q.id}\">Closest to ${escapeHtml(s.poi?.name||'…')}</button>`;\n        else controls=`<div class=\"mini-status\">${escapeHtml(s?.text||'Tentacle unavailable.')}</div>`;\n      }else if(kind==='bus_line_tentacle'){\n        if(s?.status==='line')controls=`<button class=\"primary full\" data-send-bus-line=\"${q.id}\">Closest to bus ${escapeHtml(s.line_ref)}</button>`;\n        else controls=`<div class=\"mini-status\">${escapeHtml(s?.text||'Bus-line Tentacle unavailable.')}</div>`;\n      }else if(kind==='photo'){\n",
    "bus pending controls",
)
app = insert_after(
    app,
    "    $('pendingQuestions').querySelectorAll('[data-send-tentacle]').forEach(b=>b.addEventListener('click',()=>{const q=state.actions.find(a=>a.id===b.dataset.sendTentacle);if(q)answerTentacle(q).catch(handleError);}));\n",
    "    $('pendingQuestions').querySelectorAll('[data-send-bus-line]').forEach(b=>b.addEventListener('click',()=>{const q=state.actions.find(a=>a.id===b.dataset.sendBusLine);if(q)answerBusLineTentacle(q).catch(handleError);}));\n",
    "bus pending binding",
)
app = replace_once(
    app,
    "    clearPendingOverlay();clearPoiPreview();if(state.role!=='hider')return;const phase=targetPhaseStartMs(),pending=effectiveActions('question').filter(q=>(!phase||new Date(q.created_at).getTime()>phase)&&!activeAnswerForQuestion(q.id)&&!activeVetoForQuestion(q.id));const q=pending[pending.length-1];if(!q)return;const p=q.payload||{};if(p.question_kind==='tentacle'){showPoiPreview(p.pois||[]);if(p.origin)showTentacleRangePreview(p.origin);const s=suggestedAnswer(q);if(s?.status==='poi')showTentacleCellPreview(q,s.poi);}else previewQuestionGeometry(p);\n",
    "    clearPendingOverlay();clearPoiPreview();if(state.role!=='hider')return;const phase=targetPhaseStartMs(),pending=effectiveActions('question').filter(q=>(!phase||new Date(q.created_at).getTime()>phase)&&!activeAnswerForQuestion(q.id)&&!activeVetoForQuestion(q.id));const q=pending[pending.length-1];if(!q)return;const p=q.payload||{};if(p.question_kind==='tentacle'){showPoiPreview(p.pois||[]);if(p.origin)showTentacleRangePreview(p.origin);const s=suggestedAnswer(q);if(s?.status==='poi')showTentacleCellPreview(q,s.poi);}else if(p.question_kind==='bus_line_tentacle'){const s=suggestedAnswer(q);showBusLinePreview(p.candidate_line_refs||[],s?.line_ref||null);if(s?.status==='line')showBusLineRegionPreview(state.possibleArea,s.line_ref,p.candidate_line_refs||[]);}else previewQuestionGeometry(p);\n",
    "bus hider overlay",
)
app = insert_before(
    app,
    "    if(p.question_kind==='tentacle'){\n      if(answer?.status==='poi'&&answer.poi){const cell=nearestPoiCell(possible,answer.poi,p.pois||[]);return invert?(cell?safeDifference(possible,cell):possible):cell;} return possible;\n    }\n",
    "    if(p.question_kind==='bus_line_tentacle'){\n"
    "      if(answer?.status==='line'&&answer.line_ref){const region=busLineNearestRegion(possible,answer.line_ref,p.candidate_line_refs||[]);if(!region)return possible;return invert?safeDifference(possible,region):region;}return possible;\n"
    "    }\n",
    "bus map constraint",
)

# Activity labels/resolutions.
app = replace_once(
    app,
    "    if(p.question_kind==='same_line')return `Line · ${p.selected_line||(p.line_refs||[]).join(', ')}`;if(p.question_kind==='station_interchange')return 'Nearest Station an Interchange?';\n",
    "    if(p.question_kind==='same_line')return `Line · ${p.selected_line||(p.line_refs||[]).join(', ')}`;if(p.question_kind==='station_interchange')return 'Nearest Station an Interchange?';if(p.question_kind==='bus_line_tentacle')return 'Nearest Bus Line';if(p.question_kind==='vor_navigation')return 'VOR Navigation';\n",
    "activity names",
)
app = insert_before(
    app,
    "    if(a.type==='tentacle'&&a.status==='poi')return `<span class=\"activity-resolution yes\">Closest to ${escapeHtml(a.poi?.name||'POI')}</span>`;\n",
    "    if(a.type==='bus_line_tentacle'&&a.status==='line')return `<span class=\"activity-resolution yes\">Closest to bus ${escapeHtml(a.line_ref||'?')}</span>`;\n"
    "    if(a.type==='vor_navigation')return `<span class=\"activity-resolution yes\">3 min VOR signal</span>`;\n",
    "activity new resolutions",
)
app = replace_once(
    app,
    "  function renderAll(){renderQuestionDeck();renderPendingQuestions();renderCurseDraws();renderTimeTraps();renderActiveCurses();renderActivity();renderPossibleArea();renderHiderSecret();renderSeekerLiveForHider();renderSeekerEndgame();renderGameClock();renderTurntablesPanel();renderTurntablesFreezeControls();applyDeveloperPreviewReadOnly();}\n",
    "  function renderAll(){renderQuestionDeck();renderPendingQuestions();renderCurseDraws();renderTimeTraps();renderActiveCurses();renderActivity();renderPossibleArea();renderHiderSecret();renderSeekerLiveForHider();renderSeekerEndgame();renderGameClock();renderTurntablesPanel();renderTurntablesFreezeControls();renderVorNavigation();applyDeveloperPreviewReadOnly();}\n",
    "render VOR",
)
app = replace_once(
    app,
    "if(p.question_kind==='station_interchange')return 'Nearest Station an Interchange?';if(p.question_kind==='district_set')",
    "if(p.question_kind==='station_interchange')return 'Nearest Station an Interchange?';if(p.question_kind==='bus_line_tentacle')return 'Nearest Bus Line';if(p.question_kind==='vor_navigation')return 'VOR Navigation';if(p.question_kind==='district_set')",
    "question labels",
)

# ---------------------------------------------------------------------------
# Developer preview: preserve the private engine marker even though the stored
# database kind intentionally remains an existing safe kind.
# ---------------------------------------------------------------------------
app = replace_once(
    app,
    "    const p=q.params||{},k=q.question_kind||q.kind;switch(k){\n",
    "    const p=q.params||{},k=p.engine_kind||q.question_kind||q.kind;switch(k){\n",
    "developer engine preview selector",
)
app = insert_before(
    app,
    "      case 'photo':return `No spatial comparison. The Hider sends the configured photo prompt through the private game-photo upload flow.`;\n",
    "      case 'bus_line_tentacle':return `Reference: ${REF_TRANSIT_KEY} → busLines from Vienna OEFFLINIENOGD.\\nCandidates: every bus line crossing the current Endgame possible area or within ${Number(p.search_buffer_m||BUS_TENTACLE_SEARCH_BUFFER_M)} m.\\nAnswer: the line nearest the private hiding point.\\nMap cut: keep the ~${BUS_TENTACLE_GRID_M} m generalized line-Voronoi cells closest to the answered bus line.`;\n"
    "      case 'vor_navigation':return `Endgame-only automatic signal. Server computes initial bearing from the published Seeker GPS to the private hiding point without exposing coordinates.\\nDisplay: ${Number(p.duration_seconds||VOR_NAV_DURATION_SECONDS)} seconds, 30° red direction sector; phone compass when permitted, otherwise north-up fallback.\\nReward: automatic 4-card draw, keep 2.`;\n",
    "developer new rule previews",
)
app = replace_once(
    app,
    "    else if(kind==='photo')params={photo_prompt:row.querySelector('.dev-q-photo')?.value.trim()||row.querySelector('.dev-q-title').value.trim()};\n    return {question_key:row.dataset.newQuestion==='true'?'':row.dataset.developerQuestion,category:row.querySelector('.dev-q-category').value,title:row.querySelector('.dev-q-title').value.trim(),description:row.querySelector('.dev-q-description').value.trim(),question_kind:kind,params,endgame_only:row.querySelector('.dev-q-endgame').checked,enabled:row.querySelector('.dev-q-enabled').checked,sort_order:Number(row.querySelector('.dev-q-order').value||100)};\n",
    "    else if(kind==='photo')params={photo_prompt:row.querySelector('.dev-q-photo')?.value.trim()||row.querySelector('.dev-q-title').value.trim()};\n"
    "    const original=state.developerQuestions.find(x=>x.question_key===row.dataset.developerQuestion);if(original?.params?.engine_kind)params={...params,...original.params};\n"
    "    return {question_key:row.dataset.newQuestion==='true'?'':row.dataset.developerQuestion,category:row.querySelector('.dev-q-category').value,title:row.querySelector('.dev-q-title').value.trim(),description:row.querySelector('.dev-q-description').value.trim(),question_kind:kind,params,endgame_only:row.querySelector('.dev-q-endgame').checked,enabled:row.querySelector('.dev-q-enabled').checked,sort_order:Number(row.querySelector('.dev-q-order').value||100)};\n",
    "preserve engine params",
)

# Stop VOR hardware listeners when leaving, and bind the iOS permission button.
app = replace_once(app, "if(state.realtimeChannel&&state.supabase)state.supabase.removeChannel(state.realtimeChannel);clearInterval(state.timerId);clearInterval(state.pollId);stopGpsAutoTracking();", "if(state.realtimeChannel&&state.supabase)state.supabase.removeChannel(state.realtimeChannel);clearInterval(state.timerId);clearInterval(state.pollId);stopGpsAutoTracking();stopVorTracking();", "stop VOR on leave")
app = insert_after(app, "    $('confirmCancel').addEventListener('click',()=>closeConfirm(false));$('confirmOk').addEventListener('click',()=>closeConfirm(true));$('confirmModal').addEventListener('click',e=>{if(e.target===$('confirmModal'))closeConfirm(false);});\n", "    $('vorCompassButton')?.addEventListener('click',()=>enableVorCompass().catch(handleError));\n", "VOR compass binding")

app_path.write_text(app, encoding="utf-8")

# ---------------------------------------------------------------------------
# UI panel directly under the map.
# ---------------------------------------------------------------------------
index_path = ROOT / "index.html"
index = index_path.read_text(encoding="utf-8")
index = index.replace("3.11.3", "3.12.0")
vor_markup = '''          <section id="vorNavigationPanel" class="vor-navigation-panel hidden" aria-live="polite">
            <div class="vor-navigation-head"><strong>VOR Navigation</strong><span id="vorNavigationTimer">3:00</span></div>
            <div class="vor-navigation-body">
              <div id="vorDisk" class="vor-disk" aria-label="VOR direction display">
                <div id="vorSector" class="vor-sector"></div>
                <div id="vorNorthRing" class="vor-north-ring"><span>N</span></div>
                <span class="vor-center-dot"></span>
              </div>
              <div class="vor-navigation-copy"><div id="vorNavigationStatus">Waiting for current GPS bearing…</div><button id="vorCompassButton" class="secondary small">Enable compass</button></div>
            </div>
          </section>

'''
index = replace_once(index, "          <section id=\"pendingQuestionsPanel\" class=\"panel pending-questions-panel\">\n", vor_markup + "          <section id=\"pendingQuestionsPanel\" class=\"panel pending-questions-panel\">\n", "VOR panel markup")
index_path.write_text(index, encoding="utf-8")

# ---------------------------------------------------------------------------
# VOR styling: black disk, fading 30° red sector, north reference.
# ---------------------------------------------------------------------------
styles_path = ROOT / "styles.css"
styles = styles_path.read_text(encoding="utf-8")
styles += r'''

/* v3.12 VOR Navigation ---------------------------------------------------- */
.vor-navigation-panel{margin:10px 0 14px;padding:14px 16px;border-radius:16px;background:#111827;color:#f8fafc;box-shadow:0 10px 28px rgba(15,23,42,.16)}
.vor-navigation-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px}.vor-navigation-head strong{font-size:1rem}.vor-navigation-head span{font-variant-numeric:tabular-nums;font-weight:800;color:#fca5a5}
.vor-navigation-body{display:flex;align-items:center;gap:18px;flex-wrap:wrap}.vor-navigation-copy{flex:1;min-width:190px;color:#cbd5e1;line-height:1.45}.vor-navigation-copy button{margin-top:10px}
.vor-disk{position:relative;width:min(220px,62vw);aspect-ratio:1;border-radius:50%;overflow:hidden;flex:0 0 auto;background:radial-gradient(circle at 50% 50%,#111 0 30%,#080808 55%,#020202 100%);border:2px solid #475569;box-shadow:inset 0 0 28px rgba(255,255,255,.035),0 8px 22px rgba(0,0,0,.3)}
.vor-disk::before,.vor-disk::after{content:'';position:absolute;inset:50% 10%;height:1px;background:rgba(255,255,255,.10);transform-origin:center}.vor-disk::after{transform:rotate(90deg)}
.vor-sector{--vor-angle:0deg;position:absolute;inset:0;border-radius:50%;opacity:0;transform:rotate(var(--vor-angle));background:conic-gradient(from -15deg,rgba(239,68,68,.98) 0deg,rgba(239,68,68,.72) 16deg,rgba(239,68,68,.98) 30deg,transparent 30.1deg 360deg);-webkit-mask:radial-gradient(circle,transparent 0 24%,rgba(0,0,0,.12) 42%,rgba(0,0,0,.68) 72%,#000 100%);mask:radial-gradient(circle,transparent 0 24%,rgba(0,0,0,.12) 42%,rgba(0,0,0,.68) 72%,#000 100%);transition:transform .18s linear,opacity .2s}.vor-sector.ready{opacity:1}
.vor-north-ring{--vor-north-angle:0deg;position:absolute;inset:11px;border-radius:50%;transform:rotate(var(--vor-north-angle));transition:transform .18s linear;pointer-events:none}.vor-north-ring span{position:absolute;top:-2px;left:50%;transform:translateX(-50%);font-size:.92rem;font-weight:900;line-height:1;color:#fff;text-shadow:0 1px 3px #000}
.vor-center-dot{position:absolute;left:50%;top:50%;width:8px;height:8px;border-radius:50%;background:#fff;transform:translate(-50%,-50%);box-shadow:0 0 0 3px rgba(255,255,255,.12)}
@media(max-width:620px){.vor-navigation-body{justify-content:center}.vor-navigation-copy{flex-basis:100%;text-align:center}}
'''
styles_path.write_text(styles, encoding="utf-8")

# ---------------------------------------------------------------------------
# Supabase migration. The catalogue keeps existing database-safe kinds and uses
# params.engine_kind for the new client engines, minimizing changes to old RPCs.
# ---------------------------------------------------------------------------
migration = r'''-- Hide & Seek: Vienna v3.12.0
-- Replace Nearest Station / Current Street Shape with Nearest Bus Line + VOR Navigation.
-- Run ONCE after v3.11.2, then Developer -> Refresh districts + transit once so
-- vienna_transit_v1 contains the new busLines geometry alongside railLines.

create extension if not exists pgcrypto with schema extensions;

insert into public.question_catalog(question_key,category,title,description,question_kind,params,endgame_only,enabled,sort_order)
values(
  'station-interchange','TENTACLES','Nearest Bus Line',
  'Endgame only: among Vienna bus lines crossing or within 1 km of the remaining area, keep the area closest to the answered line.',
  'tentacle','{"engine_kind":"bus_line_tentacle","search_buffer_m":1000}'::jsonb,true,true,25
)
on conflict(question_key) do update set
  category=excluded.category,title=excluded.title,description=excluded.description,
  question_kind=excluded.question_kind,params=excluded.params,endgame_only=excluded.endgame_only,
  enabled=excluded.enabled,sort_order=excluded.sort_order;

insert into public.question_catalog(question_key,category,title,description,question_kind,params,endgame_only,enabled,sort_order)
values(
  'street-shape','MIXED','VOR Navigation',
  'Endgame only: 3 minutes of a live 30 degree direction sector toward the hiding spot. No Hider answer required.',
  'directional','{"engine_kind":"vor_navigation","duration_seconds":180}'::jsonb,true,true,30
)
on conflict(question_key) do update set
  category=excluded.category,title=excluded.title,description=excluded.description,
  question_kind=excluded.question_kind,params=excluded.params,endgame_only=excluded.endgame_only,
  enabled=excluded.enabled,sort_order=excluded.sort_order;

-- Preserve answer_question_v5 (late penalties, Turntables suppression and Tiny House)
-- for the bus-line Tentacle, then upgrade its normal 3-pick-1 reward to 4-pick-2.
create or replace function public.answer_bus_line_tentacle_v1(
  p_game_id uuid,p_question_action_id uuid,p_password text,p_answer jsonb
) returns uuid
language plpgsql security definer set search_path=public,extensions as $$
declare
  v_answer_id uuid;v_extra jsonb;v_kind text;
begin
  select payload->>'question_kind' into v_kind
  from public.game_actions
  where id=p_question_action_id and game_id=p_game_id and kind='question' and is_active;
  if v_kind is distinct from 'bus_line_tentacle' then raise exception 'Question is not a bus-line Tentacle.';end if;
  if coalesce(p_answer->>'type','')<>'bus_line_tentacle' or coalesce(p_answer->>'status','')<>'line' or nullif(trim(p_answer->>'line_ref'),'') is null then
    raise exception 'Invalid bus-line Tentacle answer.';
  end if;

  v_answer_id:=public.answer_question_v5(p_game_id,p_question_action_id,p_password,p_answer);

  -- Turntables reward suppression deliberately creates no draw row; leave that intact.
  if exists(select 1 from public.curse_draws where question_action_id=p_question_action_id) then
    v_extra:=public._draw_cards_v4(p_game_id,1);
    if jsonb_array_length(coalesce(v_extra,'[]'::jsonb))>0 then
      update public.curse_draws
      set cards=cards||v_extra,
          keep_limit=least(2,jsonb_array_length(cards||v_extra))
      where question_action_id=p_question_action_id;
    end if;
  end if;
  return v_answer_id;
end;$$;
grant execute on function public.answer_bus_line_tentacle_v1(uuid,uuid,text,jsonb) to anon,authenticated;

-- VOR is resolved by the server immediately: the Hider never receives an answer UI.
-- It still counts as a question for Turntables and receives the Tentacle reward (4 pick 2)
-- unless that question falls inside Turntables' rewardless window.
create or replace function public.activate_vor_navigation_v1(
  p_game_id uuid,p_question_action_id uuid
) returns timestamptz
language plpgsql security definer set search_path=public,extensions as $$
declare
  v_q public.game_actions%rowtype;v_duration integer;v_expires timestamptz;v_answer_id uuid;
  v_cards jsonb;v_reloc_time timestamptz;v_rewardless_limit integer:=0;v_question_ordinal integer:=0;v_suppress boolean:=false;
begin
  if not exists(select 1 from public.games where id=p_game_id and status='active') then raise exception 'Game is not active.';end if;
  select * into v_q from public.game_actions
  where id=p_question_action_id and game_id=p_game_id and kind='question' and is_active;
  if v_q.id is null or v_q.payload->>'question_kind'<>'vor_navigation' then raise exception 'Question is not VOR Navigation.';end if;
  if not exists(select 1 from public.game_secrets where game_id=p_game_id and endgame and hidden_lat is not null and hidden_lng is not null) then raise exception 'VOR Navigation requires Endgame.';end if;
  if exists(select 1 from public.game_actions where parent_id=p_question_action_id and kind in('answer','question_veto') and is_active) then
    select coalesce((payload->'answer'->>'expires_at')::timestamptz,v_q.created_at+interval '180 seconds') into v_expires
    from public.game_actions where parent_id=p_question_action_id and kind='answer' and is_active order by created_at desc limit 1;
    return v_expires;
  end if;

  v_duration:=least(300,greatest(30,coalesce(nullif(v_q.payload->>'duration_seconds','')::integer,180)));
  v_expires:=v_q.created_at+make_interval(secs=>v_duration);

  select r.created_at,coalesce((r.payload->>'rewardless_questions')::integer,0)
    into v_reloc_time,v_rewardless_limit
  from public.game_actions r
  where r.game_id=p_game_id and r.kind='turntables_relocate' and r.is_active
  order by r.created_at desc limit 1;
  if v_reloc_time is not null and v_q.created_at>v_reloc_time then
    select count(*) into v_question_ordinal from public.game_actions q
    where q.game_id=p_game_id and q.kind='question' and q.is_active and q.created_at>v_reloc_time
      and (q.created_at<v_q.created_at or (q.created_at=v_q.created_at and q.id::text<=p_question_action_id::text));
    v_suppress:=v_question_ordinal between 1 and v_rewardless_limit;
  end if;

  insert into public.game_actions(game_id,actor,kind,parent_id,payload)
  values(p_game_id,'system','answer',p_question_action_id,jsonb_build_object(
    'answer',jsonb_build_object('type','vor_navigation','status','active','expires_at',v_expires,'duration_seconds',v_duration),
    'auto_resolved',true,'reward_suppressed',v_suppress,'late_penalty_minutes',0
  )) returning id into v_answer_id;

  if not v_suppress and not exists(select 1 from public.curse_draws where question_action_id=p_question_action_id) then
    v_cards:=public._draw_cards_v4(p_game_id,4);
    if jsonb_array_length(v_cards)>0 then
      insert into public.curse_draws(game_id,question_action_id,cards,keep_limit)
      values(p_game_id,p_question_action_id,v_cards,least(2,jsonb_array_length(v_cards)))
      on conflict(question_action_id) do nothing;
    end if;
  end if;
  return v_expires;
end;$$;
grant execute on function public.activate_vor_navigation_v1(uuid,uuid) to anon,authenticated;

-- Return only the bearing, never the private target coordinates.
create or replace function public.get_vor_navigation_bearing_v1(
  p_game_id uuid,p_question_action_id uuid
) returns table(bearing_deg double precision,expires_at timestamptz)
language plpgsql security definer set search_path=public,extensions as $$
declare
  v_q public.game_actions%rowtype;v_answer jsonb;v_seeker_lat double precision;v_seeker_lng double precision;
  v_target_lat double precision;v_target_lng double precision;v_expires timestamptz;
  v_y double precision;v_x double precision;v_bearing double precision;
begin
  select * into v_q from public.game_actions
  where id=p_question_action_id and game_id=p_game_id and kind='question' and is_active and payload->>'question_kind'='vor_navigation';
  if v_q.id is null then return;end if;
  select a.payload->'answer' into v_answer from public.game_actions a
  where a.parent_id=p_question_action_id and a.kind='answer' and a.is_active
  order by a.created_at desc limit 1;
  if coalesce(v_answer->>'type','')<>'vor_navigation' then return;end if;
  v_expires:=(v_answer->>'expires_at')::timestamptz;if v_expires is null or now()>=v_expires then return;end if;

  select lat,lng into v_seeker_lat,v_seeker_lng from public.seeker_live_positions where game_id=p_game_id;
  if v_seeker_lat is null or v_seeker_lng is null then return;end if;
  select hidden_lat,hidden_lng into v_target_lat,v_target_lng from public.game_secrets
  where game_id=p_game_id and endgame and hidden_lat is not null and hidden_lng is not null;
  if v_target_lat is null or v_target_lng is null then return;end if;

  v_y:=sin(radians(v_target_lng-v_seeker_lng))*cos(radians(v_target_lat));
  v_x:=cos(radians(v_seeker_lat))*sin(radians(v_target_lat))
       -sin(radians(v_seeker_lat))*cos(radians(v_target_lat))*cos(radians(v_target_lng-v_seeker_lng));
  v_bearing:=degrees(atan2(v_y,v_x));if v_bearing<0 then v_bearing:=v_bearing+360;end if;
  return query select v_bearing,v_expires;
end;$$;
grant execute on function public.get_vor_navigation_bearing_v1(uuid,uuid) to anon,authenticated;
'''
(ROOT / "supabase-v3.12.0-migration.sql").write_text(migration, encoding="utf-8")

# Basic invariants for accidental broad edits.
assert "Nearest Bus Line" in app and "VOR Navigation" in app
assert "Current Street Shape', detail:" not in app
assert "APP_VERSION = '3.12.0'" in app
print("v3.12 patch applied")
