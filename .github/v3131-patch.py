#!/usr/bin/env python3
from pathlib import Path


def replace_once(s, old, new, label):
    n=s.count(old)
    if n!=1:
        raise RuntimeError(f'{label}: expected 1 match, got {n}')
    return s.replace(old,new,1)

app=Path('app.js').read_text()
html=Path('index.html').read_text()

app=replace_once(app,"const APP_VERSION = '3.13.0';","const APP_VERSION = '3.13.1';",'version')
app=replace_once(app,
"  const VOR_NAV_DURATION_SECONDS = 180;\n  const CACHE_KEY",
"  const VOR_NAV_DURATION_SECONDS = 180;\n  const HEAVY_GEOMETRY_SIMPLIFY_DEG = 0.000018;\n  const HEAVY_GEOMETRY_MIN_VERTEX_M = 1.5;\n  const HEAVY_GEOMETRY_CACHE_LIMIT = 24;\n  const POSSIBLE_AREA_CACHE_LIMIT = 12;\n  const CACHE_KEY",
'geometry constants')

app=replace_once(app,
"    vorQuestionId:null,vorBearing:null,vorHeading:null,vorExpiresAt:0,vorGeoWatchId:null,vorOrientationHandler:null,vorCompassPermission:'unknown',vorLastBearingFetch:0,vorBearingBusy:false,vorRenderTimer:null\n  };",
"    vorQuestionId:null,vorBearing:null,vorHeading:null,vorExpiresAt:0,vorGeoWatchId:null,vorOrientationHandler:null,vorCompassPermission:'unknown',vorLastBearingFetch:0,vorBearingBusy:false,vorRenderTimer:null,\n    geometryCache:new Map(),geometryJobs:new Map(),geometryWarmScheduled:false,possibleAreaSignature:null,possibleAreaCache:new Map(),possibleAreaKm2:0,possibleExcludedArea:null,possibleRenderSignature:null\n  };",
'geometry state')

app=replace_once(app,
"    state.curseSoundPrimed=false;state.seenCurseIds=new Set();state.notificationPrimed=false;state.seenNotificationActionIds=new Set();state.photoUploadToken=null;state.photoUrlCache=new Map();state.previewQuestionSlot=null;state.previewQuestionCard=null;",
"    state.curseSoundPrimed=false;state.seenCurseIds=new Set();state.notificationPrimed=false;state.seenNotificationActionIds=new Set();state.photoUploadToken=null;state.photoUrlCache=new Map();state.previewQuestionSlot=null;state.previewQuestionCard=null;\n    state.geometryCache=new Map();state.geometryJobs=new Map();state.geometryWarmScheduled=false;state.possibleAreaSignature=null;state.possibleAreaCache=new Map();state.possibleAreaKm2=0;state.possibleExcludedArea=null;state.possibleRenderSignature=null;",
'game reset')

helpers=r'''

  function geometryIdleYield(timeout=120){
    return new Promise(resolve=>{
      if(typeof window.requestIdleCallback==='function')window.requestIdleCallback(()=>resolve(),{timeout});
      else setTimeout(resolve,24);
    });
  }
  function geometryCacheGet(key){return state.geometryCache?.get(key)||null;}
  function geometryCacheSet(key,value){
    if(!value)return null;if(!state.geometryCache)state.geometryCache=new Map();
    state.geometryCache.delete(key);state.geometryCache.set(key,value);
    while(state.geometryCache.size>HEAVY_GEOMETRY_CACHE_LIMIT)state.geometryCache.delete(state.geometryCache.keys().next().value);
    return value;
  }
  function geometryJob(key,producer){
    const cached=geometryCacheGet(key);if(cached)return Promise.resolve(cached);
    if(state.geometryJobs?.has(key))return state.geometryJobs.get(key);
    const job=(async()=>{await geometryIdleYield();const value=await producer();return geometryCacheSet(key,value);})().finally(()=>state.geometryJobs?.delete(key));
    if(!state.geometryJobs)state.geometryJobs=new Map();state.geometryJobs.set(key,job);return job;
  }
  function ringPointDistanceM(a,b){
    if(!a||!b)return Infinity;const A=mercator(Number(a[1]),Number(a[0])),B=mercator(Number(b[1]),Number(b[0]));return Math.hypot(A.x-B.x,A.y-B.y);
  }
  function pruneCloseRingVertices(ring,minM=HEAVY_GEOMETRY_MIN_VERTEX_M){
    if(!Array.isArray(ring)||ring.length<5)return ring;const src=ring.slice(0,-1),out=[];
    for(const c of src){if(!out.length||ringPointDistanceM(out[out.length-1],c)>=minM)out.push(c);}
    if(out.length>3&&ringPointDistanceM(out[out.length-1],out[0])<minM)out.pop();
    if(out.length<3)return ring;return [...out,[...out[0]]];
  }
  function pruneClosePolygonVertices(feature,minM=HEAVY_GEOMETRY_MIN_VERTEX_M){
    if(!feature?.geometry)return feature;let geometry;
    try{geometry=JSON.parse(JSON.stringify(feature.geometry));}catch(_){return feature;}
    if(geometry.type==='Polygon')geometry.coordinates=(geometry.coordinates||[]).map(r=>pruneCloseRingVertices(r,minM)).filter(r=>r?.length>=4);
    else if(geometry.type==='MultiPolygon')geometry.coordinates=(geometry.coordinates||[]).map(poly=>(poly||[]).map(r=>pruneCloseRingVertices(r,minM)).filter(r=>r?.length>=4)).filter(poly=>poly.length);
    else return feature;
    return {type:'Feature',properties:{...(feature.properties||{})},geometry};
  }
  function optimizePolygonGeometry(feature,tolerance=HEAVY_GEOMETRY_SIMPLIFY_DEG){
    if(!feature)return null;let out=feature;
    try{out=turf.cleanCoords(out,{mutate:false})||out;}catch(_){}
    try{out=pruneClosePolygonVertices(out);}catch(_){}
    try{out=turf.simplify(out,{tolerance,highQuality:true,mutate:false})||out;}catch(_){}
    try{out=turf.cleanCoords(out,{mutate:false})||out;}catch(_){}
    return out;
  }
  async function unionGeometryListSlow(features){
    let level=(features||[]).filter(Boolean);if(!level.length)return null;
    while(level.length>1){
      const next=[];
      for(let i=0;i<level.length;i+=2){
        if(i+1>=level.length)next.push(level[i]);
        else next.push(safeUnion(level[i],level[i+1])||level[i]);
        if(i%4===0)await geometryIdleYield();
      }
      level=next;
    }
    return level[0]||null;
  }
  async function sameLineCorridorSlow(refs,radiusM=250){
    const parts=[],features=matchingTransitFeatures(refs);
    for(let i=0;i<features.length;i++){
      try{parts.push(turf.buffer(features[i],Number(radiusM)/1000,{units:'kilometers',steps:8}));}catch(_){}
      if(i%2===1)await geometryIdleYield();
    }
    return unionGeometryListSlow(parts);
  }
  async function interchangeStationAreaSlow(radiusM=250,onlyRefs=null){
    const parts=[],wanted=onlyRefs?new Set((onlyRefs||[]).map(r=>String(r).toUpperCase())):null,stations=state.mapData?.stations||[];
    for(let i=0;i<stations.length;i++){
      const f=stations[i],refs=[...new Set((f.properties?.lineRefs||[]).map(r=>String(r).toUpperCase()).filter(r=>/^[US]\\d+/i.test(r)))];
      if(refs.length<2||wanted&&!refs.some(r=>wanted.has(r)))continue;
      try{parts.push(turf.buffer(f,Number(radiusM)/1000,{units:'kilometers',steps:12}));}catch(_){}
      if(parts.length%3===0)await geometryIdleYield();
    }
    return unionGeometryListSlow(parts);
  }
  async function computeSameLineConstraintBundle(q){
    const selected=(q?.payload?.line_refs||[]).map(r=>String(r).toUpperCase()),selectedSet=new Set(selected);if(!selected.length)return null;
    const corridor=await sameLineCorridorSlow(selected,250);if(!corridor)return null;await geometryIdleYield();
    let preserve=await interchangeStationAreaSlow(250,selected),search=corridor;try{search=turf.buffer(corridor,.25,{units:'kilometers',steps:8});}catch(_){}
    const overlaps=[],rails=state.mapData?.railLines||[];
    for(let i=0;i<rails.length;i++){
      const f=rails[i],routeRefs=(f.properties?.routeRefs||[]).map(r=>String(r).toUpperCase());if(!routeRefs.some(r=>!selectedSet.has(r)))continue;
      try{if(!turf.booleanIntersects(f,search))continue;const b=turf.buffer(f,.25,{units:'kilometers',steps:8}),overlap=safeIntersect(b,corridor);if(overlap)overlaps.push(overlap);}catch(_){}
      if(i%3===0)await geometryIdleYield();
    }
    preserve=await unionGeometryListSlow([preserve,...overlaps]);await geometryIdleYield();
    const exclusive=preserve?(safeDifference(corridor,preserve)||null):corridor;
    return {yes:optimizePolygonGeometry(corridor),no:optimizePolygonGeometry(exclusive)};
  }
  function sameLineBundleKey(q){return `same-line:${q?.id||'unknown'}`;}
  async function ensureSameLineConstraintBundle(q){
    const key=sameLineBundleKey(q),cached=geometryCacheGet(key);if(cached)return cached;
    return geometryJob(key,()=>computeSameLineConstraintBundle(q));
  }
  async function nearestPoiCellSlow(selected,pois){
    let out=state.mapData?.city||null;if(!out||!selected)return null;const A={lat:selected.lat,lng:selected.lng},list=pois||[];
    for(let i=0;i<list.length;i++){
      const other=list[i];if(other.id===selected.id)continue;const half=closerHalfPlane(A,{lat:other.lat,lng:other.lng});if(half){out=safeIntersect(out,half);if(!out)break;}
      if(i%2===1)await geometryIdleYield();
    }
    return optimizePolygonGeometry(out);
  }
  function tentacleConstraintKey(q,poi){return `tentacle:${q?.id||'unknown'}:${poi?.id||poi?.name||'poi'}`;}
  async function ensureTentacleConstraintGeometry(q,poi){
    const key=tentacleConstraintKey(q,poi),cached=geometryCacheGet(key);if(cached)return cached;
    return geometryJob(key,()=>nearestPoiCellSlow(poi,q?.payload?.pois||[]));
  }
  async function busLineNearestRegionSlow(domain,selectedRef,refs,features=[]){
    if(!domain||!selectedRef)return null;const all=[...new Set((refs||[]).map(r=>String(r).toUpperCase()))],selected=String(selectedRef).toUpperCase();if(!all.includes(selected))return null;
    const groups=busFeatureGroups(all,features);if(!(groups.get(selected)||[]).length)return null;
    let cells;try{cells=turf.squareGrid(turf.bbox(domain),BUS_TENTACLE_GRID_M/1000,{units:'kilometers'}).features;}catch(e){console.warn('Bus background grid failed',e);return null;}
    const kept=[];
    for(let i=0;i<cells.length;i++){
      const cell=cells[i];let clipped;try{clipped=safeIntersect(cell,domain);}catch(_){clipped=null;}if(clipped){
        let probe;try{probe=turf.centroid(clipped);}catch(_){probe=null;}if(probe){let winner=null,best=Infinity;for(const ref of all){const d=distanceToBusFeatures(probe,groups.get(ref)||[]);if(d<best-.25){best=d;winner=ref;}else if(Math.abs(d-best)<=.25&&ref===selected){winner=ref;}}if(winner===selected)kept.push(clipped);}
      }
      if(i%2===1)await geometryIdleYield();
    }
    const region=await unionGeometryListSlow(kept);return optimizePolygonGeometry(region);
  }
  function busConstraintKey(q,lineRef){return `bus:${q?.id||'unknown'}:${String(lineRef||'').toUpperCase()}`;}
  async function ensureBusConstraintGeometry(q,lineRef){
    const key=busConstraintKey(q,lineRef),cached=geometryCacheGet(key);if(cached)return cached;const p=q?.payload||{},domain=p.domain_geometry||state.possibleArea;
    return geometryJob(key,()=>busLineNearestRegionSlow(domain,lineRef,p.candidate_line_refs||[],p.bus_features||[]));
  }
  function heavyPendingQuestions(){
    const phase=targetPhaseStartMs();return effectiveActions('question').filter(q=>(!phase||new Date(q.created_at).getTime()>phase)&&!activeAnswerForQuestion(q.id)&&!activeVetoForQuestion(q.id)).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
  }
  function scheduleHeavyGeometryWarmups(){
    if(state.geometryWarmScheduled||!state.game||!state.possibleArea)return;state.geometryWarmScheduled=true;
    setTimeout(async()=>{
      try{
        for(const q of heavyPendingQuestions()){
          const kind=q.payload?.question_kind;
          if(kind==='same_line')await ensureSameLineConstraintBundle(q);
          else if(state.role==='hider'&&kind==='tentacle'){const s=suggestedAnswer(q);if(s?.status==='poi'&&s.poi)await ensureTentacleConstraintGeometry(q,s.poi);}
          else if(state.role==='hider'&&kind==='bus_line_tentacle'){const s=suggestedAnswer(q);if(s?.status==='line'&&s.line_ref)await ensureBusConstraintGeometry(q,s.line_ref);}
          await geometryIdleYield(180);
        }
      }catch(e){console.warn('Background geometry warmup failed',e);}finally{state.geometryWarmScheduled=false;}
    },0);
  }
  function possibleAreaStateSignature(){
    const zone=latestAction('endgame_zone'),phase=targetPhaseStartMs(),flipped=[...passierscheinFlippedQuestionIds()].map(String).sort();
    const qs=effectiveActions('question').filter(q=>!phase||new Date(q.created_at).getTime()>phase).sort((a,b)=>new Date(a.created_at)-new Date(b.created_at)).map(q=>[q.id,activeAnswerForQuestion(q.id)?.id||'',activeVetoForQuestion(q.id)?.id||'']);
    return JSON.stringify([state.game?.id||'',zone?.id||'',currentAreaMultiplier(),tinyHouseRadiusFactor(),flipped,qs]);
  }
  function cachePossibleArea(signature,possible){
    if(!state.possibleAreaCache)state.possibleAreaCache=new Map();state.possibleAreaCache.delete(signature);state.possibleAreaCache.set(signature,possible);
    while(state.possibleAreaCache.size>POSSIBLE_AREA_CACHE_LIMIT)state.possibleAreaCache.delete(state.possibleAreaCache.keys().next().value);
  }
  function excludedGeometryKey(signature){return `excluded:${signature}`;}
  function applyExcludedGeometryIfCurrent(signature,geometry){
    if(state.possibleAreaSignature!==signature||state.possibleRenderSignature!==signature||!state.gameMap)return;state.possibleExcludedArea=geometry;
    state.mapLayers.excluded?.remove();state.mapLayers.excluded=null;if(geometry)state.mapLayers.excluded=L.geoJSON(geometry,{style:mapGeoStyle('excluded'),interactive:false}).addTo(state.gameMap);
    state.mapLayers['game-rails']?.bringToFront?.();state.mapLayers['game-stations']?.bringToFront?.();state.mapLayers.publicTimeTraps?.bringToFront?.();
  }
  function scheduleExcludedGeometry(signature,possible){
    if(!possible||!signature)return;const key=excludedGeometryKey(signature),cached=geometryCacheGet(key);if(cached){applyExcludedGeometryIfCurrent(signature,cached);return;}
    geometryJob(key,async()=>{await geometryIdleYield(180);const ex=safeDifference(state.mapData.city,possible);return optimizePolygonGeometry(ex,0.000025);}).then(ex=>applyExcludedGeometryIfCurrent(signature,ex)).catch(e=>console.warn('Excluded-area background build failed',e));
  }
'''
anchor="""  function availableRailLineRefs(){
    const refs=new Set();
    for(const f of state.mapData?.railLines||[])for(const r of f.properties?.routeRefs||[])if(/^[US]\\d+/i.test(String(r)))refs.add(String(r).toUpperCase());
    for(const f of state.mapData?.stations||[])for(const r of f.properties?.lineRefs||[])if(/^[US]\\d+/i.test(String(r)))refs.add(String(r).toUpperCase());
    return [...refs].sort((a,b)=>{const pa=a[0]===b[0]?0:(a[0]==='U'?-1:1);if(pa)return pa;return Number(a.slice(1))-Number(b.slice(1))||a.localeCompare(b);});
  }"""
app=replace_once(app,anchor,anchor+helpers,'geometry helper insertion')

app=replace_once(app,
"      showBusLinePreview(refs,null,busFeatures);const payload={slot_key:card.slot,question_kind:'bus_line_tentacle',title:card.title,search_buffer_m:bufferM,candidate_line_refs:refs,bus_features:busFeatures};",
"      showBusLinePreview(refs,null,busFeatures);const payload={slot_key:card.slot,question_kind:'bus_line_tentacle',title:card.title,search_buffer_m:bufferM,candidate_line_refs:refs,bus_features:busFeatures,domain_geometry:optimizePolygonGeometry(state.possibleArea,0.000012)};",
'bus domain snapshot')

old_answer_bool="""  async function answerBoolean(q,value){
    const s=suggestedAnswer(q),pen=currentQuestionPenaltyMinutes(q),label=booleanResolutionLabel(q,value);const ok=await confirmAction(`Send ${label}?`,`${questionLabel(q)}\\n\\nPreview: ${s?.text||'Unavailable'}${pen?`\\n\\nLate penalty: −${pen} min`:''}`,`Send ${label}`);if(!ok)return;
    const {error}=await state.supabase.rpc('answer_question_v5',{p_game_id:state.game.id,p_question_action_id:q.id,p_password:state.hiderPassword,p_answer:{type:'boolean',value}});if(error)throw error;await reloadGameState();
  }"""
new_answer_bool="""  async function answerBoolean(q,value){
    const s=suggestedAnswer(q),pen=currentQuestionPenaltyMinutes(q),label=booleanResolutionLabel(q,value);const ok=await confirmAction(`Send ${label}?`,`${questionLabel(q)}\\n\\nPreview: ${s?.text||'Unavailable'}${pen?`\\n\\nLate penalty: −${pen} min`:''}`,`Send ${label}`);if(!ok)return;
    const answer={type:'boolean',value};
    if(q.payload?.question_kind==='same_line'){
      const bundle=await ensureSameLineConstraintBundle(q);if(bundle){answer.constraint_geometry_yes=bundle.yes;answer.constraint_geometry_no=bundle.no;}
    }
    const {error}=await state.supabase.rpc('answer_question_v5',{p_game_id:state.game.id,p_question_action_id:q.id,p_password:state.hiderPassword,p_answer:answer});if(error)throw error;await reloadGameState();
  }"""
app=replace_once(app,old_answer_bool,new_answer_bool,'same line saved geometry')

old_tent="""    const answer={type:'tentacle',status:'poi',poi:s.poi};
    const ok=await confirmAction('Send Tentacle answer?',`${questionLabel(q)}"""
new_tent="""    const answer={type:'tentacle',status:'poi',poi:s.poi};
    const ok=await confirmAction('Send Tentacle answer?',`${questionLabel(q)}"""
# confirmation stays identical; add geometry after confirmation using a second exact replacement
app=replace_once(app,old_tent,new_tent,'tentacle anchor')
app=replace_once(app,
"Only the POI name is sent publicly; the private validation distance is never included in the answer.${currentQuestionPenaltyMinutes(q)?`\\n\\nCurrent late penalty: −${currentQuestionPenaltyMinutes(q)} min`:''}`,`Send answer`);if(!ok)return;\n    const {error}=await state.supabase.rpc('answer_question_v5',{p_game_id:state.game.id,p_question_action_id:q.id,p_password:state.hiderPassword,p_answer:answer});",
"Only the POI name is sent publicly; the private validation distance is never included in the answer.${currentQuestionPenaltyMinutes(q)?`\\n\\nCurrent late penalty: −${currentQuestionPenaltyMinutes(q)} min`:''}`,`Send answer`);if(!ok)return;\n    const cell=await ensureTentacleConstraintGeometry(q,s.poi);if(cell)answer.constraint_geometry=cell;\n    const {error}=await state.supabase.rpc('answer_question_v5',{p_game_id:state.game.id,p_question_action_id:q.id,p_password:state.hiderPassword,p_answer:answer});",
'tentacle save geometry')

app=replace_once(app,
"    const answer={type:'bus_line_tentacle',status:'line',line_ref:s.line_ref},pen=currentQuestionPenaltyMinutes(q);\n    const ok=await confirmAction('Send Nearest Bus Line answer?',`${questionLabel(q)}\\n\\nClosest line: ${s.line_ref}.\\n\\nOnly the line identity is published; the private distance is not.${pen?`\\n\\nCurrent late penalty: −${pen} min`:''}`,`Send answer`);if(!ok)return;\n    const {error}=await state.supabase.rpc('answer_bus_line_tentacle_v1',{p_game_id:state.game.id,p_question_action_id:q.id,p_password:state.hiderPassword,p_answer:answer});",
"    const answer={type:'bus_line_tentacle',status:'line',line_ref:s.line_ref},pen=currentQuestionPenaltyMinutes(q);\n    const ok=await confirmAction('Send Nearest Bus Line answer?',`${questionLabel(q)}\\n\\nClosest line: ${s.line_ref}.\\n\\nOnly the line identity is published; the private distance is not.${pen?`\\n\\nCurrent late penalty: −${pen} min`:''}`,`Send answer`);if(!ok)return;\n    const region=await ensureBusConstraintGeometry(q,s.line_ref);if(region)answer.constraint_geometry=region;\n    const {error}=await state.supabase.rpc('answer_bus_line_tentacle_v1',{p_game_id:state.game.id,p_question_action_id:q.id,p_password:state.hiderPassword,p_answer:answer});",
'bus save geometry')

app=replace_once(app,
"    deriveLocalState();await recomputePossibleArea();renderAll();",
"    deriveLocalState();await recomputePossibleArea();renderAll();scheduleHeavyGeometryWarmups();",
'warm after reload')

old_recompute=r'''  async function recomputePossibleArea(){
    // Station phase: the hiding STATION can be anywhere inside Vienna. Do not pre-limit
    // the map to 250 m buffers around every station; that radius only matters in Endgame.
    const endgameZone=latestAction('endgame_zone');
    let possible=state.mapData.city;
    let phaseStartMs=targetPhaseStartMs();
    if(endgameZone?.payload?.center){
      const dynamic=endgameZone.payload.dynamic_radius===true;
      const base=Number(endgameZone.payload.base_radius_m)||(dynamic?BASE_HIDE_RADIUS_M:(Number(endgameZone.payload.radius_m)||BASE_HIDE_RADIUS_M));
      const radius=dynamic?base*Math.sqrt(currentAreaMultiplier())*tinyHouseRadiusFactor():(Number(endgameZone.payload.radius_m)||base);
      const center=turf.point([Number(endgameZone.payload.center.lng),Number(endgameZone.payload.center.lat)]);
      const zone=turf.buffer(center,radius/1000,{units:'kilometers',steps:64});
      possible=safeIntersect(state.mapData.city,zone)||zone;
      phaseStartMs=Math.max(phaseStartMs,new Date(endgameZone.created_at).getTime());
    }
    const a38Flipped=passierscheinFlippedQuestionIds();
    const qs=effectiveActions('question')
      .filter(q=>!phaseStartMs || new Date(q.created_at).getTime()>phaseStartMs)
      .sort((a,b)=>new Date(a.created_at)-new Date(b.created_at));
    for(const q of qs){
      const veto=activeVetoForQuestion(q.id);
      if(veto){
        if(veto.payload?.automatic_tentacle&&veto.payload?.radar_miss&&q.payload?.origin){
          const r=Number(veto.payload?.radius_m||q.payload?.valid_distance_m||TENTACLE_VALID_DISTANCE_M);
          const c=turf.buffer(turf.point([Number(q.payload.origin.lng),Number(q.payload.origin.lat)]),r/1000,{units:'kilometers',steps:48});
          possible=safeDifference(possible,c);
        }
        continue;
      }
      const a=activeAnswerForQuestion(q.id);if(!a)continue;
      possible=applyConstraint(possible,q,a.payload?.answer,a38Flipped.has(String(q.id)));if(!possible)break;
    }
    state.possibleArea=possible;
  }

  function applyConstraint(possible,q,answer,invert=false){
    if(!possible)return null;const p=q.payload||{},boolValue=answer?.type==='boolean'?(invert?!answer.value:!!answer.value):null;
    if(p.question_kind==='radar'){const c=turf.buffer(turf.point([p.center.lng,p.center.lat]),Number(p.radius_m)/1000,{units:'kilometers',steps:64});return boolValue?safeIntersect(possible,c):safeDifference(possible,c);}
    if(p.question_kind==='district'){const d=state.mapData.districts.find(x=>x.number===Number(p.district_number));return d?(boolValue?safeIntersect(possible,d.feature):safeDifference(possible,d.feature)):possible;}
    if(p.question_kind==='district_set'){const g=districtSetGeometry(p.districts||[]);return g?(boolValue?safeIntersect(possible,g):safeDifference(possible,g)):possible;}
    if(p.question_kind==='landmark_compare'){const c=turf.buffer(turf.point([Number(p.landmark.lng),Number(p.landmark.lat)]),Number(p.radius_m)/1000,{units:'kilometers',steps:64});return boolValue?safeIntersect(possible,c):safeDifference(possible,c);}
    if(p.question_kind==='same_line'){
      const corridor=sameLineCorridor(p.line_refs||[],250);if(!corridor)return possible;
      if(boolValue)return safeIntersect(possible,corridor);
      // A NO removes only the selected line's exclusive 250 m corridor. Areas where another
      // U-/S-Bahn line overlaps/crosses it, plus interchange stations, stay possible.
      const exclusive=sameLineExclusiveCorridor(p.line_refs||[],250);return exclusive?safeDifference(possible,exclusive):possible;
    }
    if(p.question_kind==='station_interchange'){const g=interchangeStationArea(Number(p.radius_m||250));return g?(boolValue?safeIntersect(possible,g):safeDifference(possible,g)):possible;}
    if(p.question_kind==='directional'){const half=directionHalfPlane(p.origin,p.axis,!!boolValue);return half?safeIntersect(possible,half):possible;}
    if(p.question_kind==='thermometer'){
      const half=warmerHalfPlane(possible,p.from,p.to,!!boolValue);if(!half)return possible;
      const cut=safeIntersect(possible,half);if(!cut){console.warn('Thermometer cut produced no geometry',p,answer);return null;}return cut;
    }
    if(p.question_kind==='bus_line_tentacle'){
      if(answer?.status==='line'&&answer.line_ref){const region=busLineNearestRegion(possible,answer.line_ref,p.candidate_line_refs||[],p.bus_features||[]);if(!region)return possible;return invert?safeDifference(possible,region):region;}return possible;
    }
    if(p.question_kind==='tentacle'){
      if(answer?.status==='poi'&&answer.poi){const cell=nearestPoiCell(possible,answer.poi,p.pois||[]);return invert?(cell?safeDifference(possible,cell):possible):cell;} return possible;
    }
    return possible;
  }'''
new_recompute=r'''  async function recomputePossibleArea(){
    const signature=possibleAreaStateSignature();
    if(signature===state.possibleAreaSignature)return;
    if(state.possibleAreaCache?.has(signature)){
      state.possibleArea=state.possibleAreaCache.get(signature);state.possibleAreaSignature=signature;state.possibleAreaKm2=state.possibleArea?turf.area(state.possibleArea)/1e6:0;state.possibleExcludedArea=geometryCacheGet(excludedGeometryKey(signature));return;
    }
    // Station phase: the hiding STATION can be anywhere inside Vienna. Do not pre-limit
    // the map to 250 m buffers around every station; that radius only matters in Endgame.
    const endgameZone=latestAction('endgame_zone');let possible=state.mapData.city;let phaseStartMs=targetPhaseStartMs();
    if(endgameZone?.payload?.center){
      const dynamic=endgameZone.payload.dynamic_radius===true,base=Number(endgameZone.payload.base_radius_m)||(dynamic?BASE_HIDE_RADIUS_M:(Number(endgameZone.payload.radius_m)||BASE_HIDE_RADIUS_M));
      const radius=dynamic?base*Math.sqrt(currentAreaMultiplier())*tinyHouseRadiusFactor():(Number(endgameZone.payload.radius_m)||base),center=turf.point([Number(endgameZone.payload.center.lng),Number(endgameZone.payload.center.lat)]),zone=turf.buffer(center,radius/1000,{units:'kilometers',steps:48});
      possible=safeIntersect(state.mapData.city,zone)||zone;phaseStartMs=Math.max(phaseStartMs,new Date(endgameZone.created_at).getTime());
    }
    const a38Flipped=passierscheinFlippedQuestionIds(),qs=effectiveActions('question').filter(q=>!phaseStartMs||new Date(q.created_at).getTime()>phaseStartMs).sort((a,b)=>new Date(a.created_at)-new Date(b.created_at));
    for(const q of qs){
      const veto=activeVetoForQuestion(q.id);
      if(veto){
        if(veto.payload?.automatic_tentacle&&veto.payload?.radar_miss&&q.payload?.origin){const r=Number(veto.payload?.radius_m||q.payload?.valid_distance_m||TENTACLE_VALID_DISTANCE_M),c=turf.buffer(turf.point([Number(q.payload.origin.lng),Number(q.payload.origin.lat)]),r/1000,{units:'kilometers',steps:32});possible=safeDifference(possible,c);}
        continue;
      }
      const a=activeAnswerForQuestion(q.id);if(!a)continue;possible=await applyConstraint(possible,q,a.payload?.answer,a38Flipped.has(String(q.id)));if(!possible)break;await geometryIdleYield(80);
    }
    possible=optimizePolygonGeometry(possible,0.000012);state.possibleArea=possible;state.possibleAreaSignature=signature;state.possibleAreaKm2=possible?turf.area(possible)/1e6:0;state.possibleExcludedArea=geometryCacheGet(excludedGeometryKey(signature));cachePossibleArea(signature,possible);
  }

  async function applyConstraint(possible,q,answer,invert=false){
    if(!possible)return null;const p=q.payload||{},boolValue=answer?.type==='boolean'?(invert?!answer.value:!!answer.value):null;
    if(p.question_kind==='radar'){const c=turf.buffer(turf.point([p.center.lng,p.center.lat]),Number(p.radius_m)/1000,{units:'kilometers',steps:48});return boolValue?safeIntersect(possible,c):safeDifference(possible,c);}
    if(p.question_kind==='district'){const d=state.mapData.districts.find(x=>x.number===Number(p.district_number));return d?(boolValue?safeIntersect(possible,d.feature):safeDifference(possible,d.feature)):possible;}
    if(p.question_kind==='district_set'){const g=districtSetGeometry(p.districts||[]);return g?(boolValue?safeIntersect(possible,g):safeDifference(possible,g)):possible;}
    if(p.question_kind==='landmark_compare'){const c=turf.buffer(turf.point([Number(p.landmark.lng),Number(p.landmark.lat)]),Number(p.radius_m)/1000,{units:'kilometers',steps:48});return boolValue?safeIntersect(possible,c):safeDifference(possible,c);}
    if(p.question_kind==='same_line'){
      let yes=answer?.constraint_geometry_yes,no=answer?.constraint_geometry_no;
      if(!yes||!no){const bundle=geometryCacheGet(sameLineBundleKey(q))||await ensureSameLineConstraintBundle(q);yes=yes||bundle?.yes;no=no||bundle?.no;}
      if(boolValue)return yes?safeIntersect(possible,yes):possible;return no?safeDifference(possible,no):possible;
    }
    if(p.question_kind==='station_interchange'){const g=interchangeStationArea(Number(p.radius_m||250));return g?(boolValue?safeIntersect(possible,g):safeDifference(possible,g)):possible;}
    if(p.question_kind==='directional'){const half=directionHalfPlane(p.origin,p.axis,!!boolValue);return half?safeIntersect(possible,half):possible;}
    if(p.question_kind==='thermometer'){const half=warmerHalfPlane(possible,p.from,p.to,!!boolValue);if(!half)return possible;const cut=safeIntersect(possible,half);if(!cut){console.warn('Thermometer cut produced no geometry',p,answer);return null;}return cut;}
    if(p.question_kind==='bus_line_tentacle'){
      if(answer?.status==='line'&&answer.line_ref){const region=answer.constraint_geometry||geometryCacheGet(busConstraintKey(q,answer.line_ref))||await ensureBusConstraintGeometry(q,answer.line_ref);if(!region)return possible;return invert?safeDifference(possible,region):safeIntersect(possible,region);}return possible;
    }
    if(p.question_kind==='tentacle'){
      if(answer?.status==='poi'&&answer.poi){const cell=answer.constraint_geometry||geometryCacheGet(tentacleConstraintKey(q,answer.poi))||await ensureTentacleConstraintGeometry(q,answer.poi);if(!cell)return possible;return invert?safeDifference(possible,cell):safeIntersect(possible,cell);}return possible;
    }
    return possible;
  }'''
app=replace_once(app,old_recompute,new_recompute,'async cached recompute')

old_render="""  function renderPossibleArea(){
    state.mapLayers.possible?.remove();state.mapLayers.excluded?.remove();if(state.possibleArea){state.mapLayers.possible=L.geoJSON(state.possibleArea,{style:mapGeoStyle('possible'),interactive:false}).addTo(state.gameMap);const ex=safeDifference(state.mapData.city,state.possibleArea);if(ex)state.mapLayers.excluded=L.geoJSON(ex,{style:mapGeoStyle('excluded'),interactive:false}).addTo(state.gameMap);const km2=turf.area(state.possibleArea)/1e6;$('remainingAreaText').textContent=`${km2.toFixed(km2>=10?1:2)} km² possible`;}else{$('remainingAreaText').textContent='0 km² possible';}
    renderPublicEndgameZone();renderPublicTimeTraps();
    state.mapLayers['game-rails']?.bringToFront?.();state.mapLayers['game-stations']?.bringToFront?.();state.mapLayers.publicTimeTraps?.bringToFront?.();
  }"""
new_render="""  function renderPossibleArea(){
    const signature=state.possibleAreaSignature||'none',alreadyDrawn=state.possibleRenderSignature===signature&&((state.possibleArea&&state.mapLayers.possible)||(!state.possibleArea&&!state.mapLayers.possible));
    if(!alreadyDrawn){
      state.mapLayers.possible?.remove();state.mapLayers.excluded?.remove();state.mapLayers.possible=null;state.mapLayers.excluded=null;
      if(state.possibleArea){state.mapLayers.possible=L.geoJSON(state.possibleArea,{style:mapGeoStyle('possible'),interactive:false}).addTo(state.gameMap);if(state.possibleExcludedArea)state.mapLayers.excluded=L.geoJSON(state.possibleExcludedArea,{style:mapGeoStyle('excluded'),interactive:false}).addTo(state.gameMap);else scheduleExcludedGeometry(signature,state.possibleArea);}state.possibleRenderSignature=signature;
    }else if(state.possibleArea&&!state.mapLayers.excluded&&!state.possibleExcludedArea)scheduleExcludedGeometry(signature,state.possibleArea);
    const km2=Number(state.possibleAreaKm2||0);$('remainingAreaText').textContent=state.possibleArea?`${km2.toFixed(km2>=10?1:2)} km² possible`:'0 km² possible';
    renderPublicEndgameZone();renderPublicTimeTraps();state.mapLayers['game-rails']?.bringToFront?.();state.mapLayers['game-stations']?.bringToFront?.();state.mapLayers.publicTimeTraps?.bringToFront?.();
  }"""
app=replace_once(app,old_render,new_render,'render cache')

app=replace_once(app,
"    clearPendingOverlay();clearPoiPreview();if(state.role!=='hider')return;const phase=targetPhaseStartMs(),pending=effectiveActions('question').filter(q=>(!phase||new Date(q.created_at).getTime()>phase)&&!activeAnswerForQuestion(q.id)&&!activeVetoForQuestion(q.id));const q=pending[pending.length-1];if(!q)return;const p=q.payload||{};if(p.question_kind==='tentacle'){showPoiPreview(p.pois||[]);if(p.origin)showTentacleRangePreview(p.origin);const s=suggestedAnswer(q);if(s?.status==='poi')showTentacleCellPreview(q,s.poi);}else if(p.question_kind==='bus_line_tentacle'){const s=suggestedAnswer(q);showBusLinePreview(p.candidate_line_refs||[],s?.line_ref||null,p.bus_features||[]);}else previewQuestionGeometry(p);",
"    clearPendingOverlay();clearPoiPreview();if(state.role!=='hider')return;const phase=targetPhaseStartMs(),pending=effectiveActions('question').filter(q=>(!phase||new Date(q.created_at).getTime()>phase)&&!activeAnswerForQuestion(q.id)&&!activeVetoForQuestion(q.id));const q=pending[pending.length-1];if(!q)return;const p=q.payload||{};if(p.question_kind==='tentacle'){showPoiPreview(p.pois||[]);if(p.origin)showTentacleRangePreview(p.origin);}else if(p.question_kind==='bus_line_tentacle'){const s=suggestedAnswer(q);showBusLinePreview(p.candidate_line_refs||[],s?.line_ref||null,p.bus_features||[]);}else previewQuestionGeometry(p);",
'no synchronous pending tentacle polygon')

html=replace_once(html,'styles.css?v=3.13.0','styles.css?v=3.13.1','css cache')
html=replace_once(html,'DEVELOPER · BUILD 3.13.0','DEVELOPER · BUILD 3.13.1','dev version')
html=replace_once(html,'app.js?v=3.13.0','app.js?v=3.13.1','js cache')

Path('app.js').write_text(app)
Path('index.html').write_text(html)
print('v3.13.1 patch applied')
