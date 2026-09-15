from pathlib import Path

APP=Path('app.js'); IDX=Path('index.html'); WORKER=Path('geometry-worker.js')
s=APP.read_text()

def once(old,new,label):
    global s
    n=s.count(old)
    if n!=1: raise SystemExit(f'{label}: expected 1, found {n}')
    s=s.replace(old,new,1)

once("  const APP_VERSION = '3.13.2';","  const APP_VERSION = '3.13.3';",'version')

once(
"    geometryWorker:null,geometryWorkerSeq:0,geometryWorkerPending:new Map(),heavyPrepared:new Map(),heavyPrepareJobs:new Map(),answerGeometryCache:new Map(),geometrySqlAvailable:null,heavyCanvasRenderer:null",
"    geometryWorker:null,geometryWorkerSeq:0,geometryWorkerPending:new Map(),heavyPrepared:new Map(),heavyPrepareJobs:new Map(),answerGeometryCache:new Map(),geometrySqlAvailable:null,heavyCanvasRenderer:null,sameLineMasks:new Map(),heavyHistoryResults:new Map(),heavyHistoryJobs:new Map(),heavyAreaPending:false",
'state geometry fields')

once(
"    state.geometryCache=new Map();state.geometryJobs=new Map();state.geometryWarmScheduled=false;state.possibleAreaSignature=null;state.possibleAreaCache=new Map();state.possibleAreaKm2=0;state.possibleExcludedArea=null;state.possibleRenderSignature=null;state.heavyPrepared=new Map();state.heavyPrepareJobs=new Map();state.answerGeometryCache=new Map();state.geometrySqlAvailable=null;state.heavyCanvasRenderer=null;",
"    state.geometryCache=new Map();state.geometryJobs=new Map();state.geometryWarmScheduled=false;state.possibleAreaSignature=null;state.possibleAreaCache=new Map();state.possibleAreaKm2=0;state.possibleExcludedArea=null;state.possibleRenderSignature=null;state.heavyPrepared=new Map();state.heavyPrepareJobs=new Map();state.answerGeometryCache=new Map();state.geometrySqlAvailable=null;state.heavyCanvasRenderer=null;state.sameLineMasks=new Map();state.heavyHistoryResults=new Map();state.heavyHistoryJobs=new Map();state.heavyAreaPending=false;",
'game reset geometry')

once(
"    await syncServerClock(); await reloadGameState(); subscribeRealtime(); startTimers();",
"    await syncServerClock(); subscribeRealtime(); startTimers(); setTimeout(()=>{try{ensureGeometryWorker();}catch(e){console.warn('Geometry worker warm-up unavailable',e);}},0); await reloadGameState();",
'nonblocking game connection')

old_map="""    state.gameMap.invalidateSize(false);clearPrivateMapLayers();drawReferenceLayers(state.gameMap,'game-',f=>handleReferenceStationClick(f));
    if(!restoreGameMapView())state.gameMap.fitBounds(L.geoJSON(state.mapData.city).getBounds(),{padding:[8,8],animate:false});
    setTimeout(()=>{state.gameMap?.invalidateSize(false);if(!restoreGameMapView())state.gameMap?.fitBounds(L.geoJSON(state.mapData.city).getBounds(),{padding:[8,8],animate:false});},80);"""
new_map="""    state.gameMap.invalidateSize(false);clearPrivateMapLayers();drawReferenceLayers(state.gameMap,'game-',f=>handleReferenceStationClick(f));
    state.gameMap.fitBounds(L.geoJSON(state.mapData.city).getBounds(),{padding:[8,8],animate:false});
    setTimeout(()=>{state.gameMap?.invalidateSize(false);state.gameMap?.fitBounds(L.geoJSON(state.mapData.city).getBounds(),{padding:[8,8],animate:false});},80);"""
once(old_map,new_map,'fresh game Vienna view')

old_create="""    drawReferenceLayers(state.createMap,'create-',f=>selectCreateStation(f));
    populateCreateStationSelect();
    state.createMap.fitBounds(L.geoJSON(state.mapData.city).getBounds(),{padding:[8,8]});
    if(!state.createStation){$('createStationStatus').className='status-box good';$('createStationStatus').textContent='Choose a station from the list or tap a station marker on the map.';}
    renderCreateSelection();"""
new_create="""    drawReferenceLayers(state.createMap,'create-',f=>selectCreateStation(f));
    populateCreateStationSelect();
    if(!state.createStation){$('createStationStatus').className='status-box good';$('createStationStatus').textContent='Choose a station from the list or tap a station marker on the map.';}
    renderCreateSelection();
    state.createMap.fitBounds(L.geoJSON(state.mapData.city).getBounds(),{padding:[8,8],animate:false});"""
once(old_create,new_create,'fresh create Vienna view')

# Insert optimized Same-Line mask preparation and post-answer attachment helpers.
anchor="""  async function persistPrepared(q,variant,signature,geometry){
    const existing=rememberHeavyPrepared(q,variant,signature,geometry,heavySqlKey(q,variant,signature),false);if(!existing||state.role!=='hider'||!state.hiderPassword||state.geometrySqlAvailable===false)return existing;
    const {data,error}=await state.supabase.rpc('save_question_geometry_v1',{p_game_id:state.game.id,p_question_action_id:q.id,p_password:state.hiderPassword,p_cache_key:existing.cache_key,p_domain_signature:signature,p_geometry:geometry});
    if(error){if(geometryRpcMissing(error))state.geometrySqlAvailable=false;else console.warn('Geometry-cache save failed',error);return existing;}
    state.geometrySqlAvailable=true;existing.persisted=!!data;state.heavyPrepared.set(heavyMemoryKey(q,variant,signature),existing);if(existing.persisted)state.answerGeometryCache.set(existing.cache_key,existing);return existing;
  }
"""
insert=anchor+"""  function sameLineMaskMemoryKey(q,signature){return `${q?.id||'q'}|masks|${hashGeometryText(signature)}`;}
  async function prepareSameLineMasks(q,signature=heavyDomainSignature(q)){
    const key=sameLineMaskMemoryKey(q,signature),cached=state.sameLineMasks.get(key);if(cached)return cached;
    const jobKey=`same-line-masks:${key}`;if(state.heavyPrepareJobs.has(jobKey))return state.heavyPrepareJobs.get(jobKey);
    const p=q?.payload||{};
    const job=runGeometryWorker('same_line_prepare',{line_refs:p.line_refs||[],radius_m:250,rail_lines:state.mapData?.railLines||[],stations:state.mapData?.stations||[]},120000)
      .then(masks=>{if(masks?.corridor)state.sameLineMasks.set(key,masks);return masks;})
      .finally(()=>state.heavyPrepareJobs.delete(jobKey));
    state.heavyPrepareJobs.set(jobKey,job);return job;
  }
  async function attachAnswerGeometry(q,answerActionId,rec){
    if(!q||!answerActionId||!rec?.persisted||state.role!=='hider'||!state.hiderPassword||state.geometrySqlAvailable===false)return false;
    const {error}=await state.supabase.rpc('attach_answer_geometry_v1',{p_game_id:state.game.id,p_question_action_id:q.id,p_answer_action_id:answerActionId,p_password:state.hiderPassword,p_cache_key:rec.cache_key,p_domain_signature:rec.domain_signature});
    if(error){if(geometryRpcMissing(error))state.geometrySqlAvailable=false;else console.warn('Geometry-cache attachment failed',error);return false;}
    state.geometrySqlAvailable=true;return true;
  }
  async function finalizeHeavyAnsweredQuestion(q,answer,answerActionId,variant,domain,signature){
    if(!q||!answer||!answerActionId||!domain)return;
    try{
      let rec=null,geometry=null;
      if(q.payload?.question_kind==='same_line'){
        const masks=await prepareSameLineMasks(q,signature);if(!masks?.corridor)return;
        geometry=await runGeometryWorker('same_line_apply',{domain,corridor:masks.corridor,preserve:masks.preserve||null,value:!!answer.value,invert:false},90000);
        if(geometry)rec=await persistPrepared(q,variant,signature,geometry);
      }else{
        const mk=heavyMemoryKey(q,variant,signature);rec=state.heavyPrepared.get(mk)||null;
        if(!rec){const prepared=await prepareHeavyQuestion(q);rec=prepared?.cache_key?prepared:(state.heavyPrepared.get(mk)||null);}
      }
      if(await attachAnswerGeometry(q,answerActionId,rec)){state.possibleAreaSignature=null;state.possibleAreaCache.clear();reloadGameState().catch(console.warn);}
    }catch(e){console.warn('Heavy answer geometry finalization failed; answer itself is already recorded.',e);}
  }
"""
if s.count(anchor)!=1: raise SystemExit('persist helper anchor mismatch')
s=s.replace(anchor,insert,1)

old_same_prepare="""      if(kind==='same_line'){
        let yes=await loadPrivatePrepared(q,'yes',signature),no=await loadPrivatePrepared(q,'no',signature);if(yes&&no)return {yes,no};
        const bundle=await runGeometryWorker('same_line_final',{domain,line_refs:p.line_refs||[],radius_m:250,rail_lines:state.mapData?.railLines||[],stations:state.mapData?.stations||[]});
        if(bundle?.yes)yes=await persistPrepared(q,'yes',signature,bundle.yes);if(bundle?.no)no=await persistPrepared(q,'no',signature,bundle.no);return {yes,no};
      }"""
once(old_same_prepare,"      if(kind==='same_line')return prepareSameLineMasks(q,signature);",'same-line prepare masks only')

old_prepared="""  async function preparedForAnswer(q,variant){
    const signature=heavyDomainSignature(q),mk=heavyMemoryKey(q,variant,signature);let rec=state.heavyPrepared.get(mk);if(rec)return rec;
    if(!heavyCanUseCurrentDomain(q))return null;toast('Finalizing map geometry in the background…',2200);const prepared=await prepareHeavyQuestion(q);
    if(q.payload?.question_kind==='same_line')rec=prepared?.[variant]||null;else rec=prepared||null;return rec;
  }"""
new_prepared="""  async function preparedForAnswer(q,variant){
    const signature=heavyDomainSignature(q),mk=heavyMemoryKey(q,variant,signature);let rec=state.heavyPrepared.get(mk);if(rec)return rec;
    if(!heavyCanUseCurrentDomain(q))return null;const prepared=await prepareHeavyQuestion(q);
    if(q.payload?.question_kind==='same_line')return null;rec=prepared?.cache_key?prepared:(state.heavyPrepared.get(mk)||null);return rec;
  }"""
once(old_prepared,new_prepared,'prepared no foreground wait')

# Replace blocking heavy resolver with published-cache-first + nonblocking historical rebuild.
start=s.index("  async function resolveHeavyFinalGeometry(possible,q,answer,invert=false){")
end=s.index("  function ringPointDistanceM",start)
old=s[start:end]
new="""  function heavyHistoryKey(q,answer,invert,expected){const aid=activeAnswerForQuestion(q.id)?.id||'answer';return `${q.id}|${aid}|${hashGeometryText(expected)}|${invert?'i':'n'}`;}
  async function calculateHeavyFallback(possible,q,answer,invert=false){
    const p=q.payload||{};
    if(p.question_kind==='same_line'){
      const masks=await runGeometryWorker('same_line_prepare',{line_refs:p.line_refs||[],radius_m:250,rail_lines:state.mapData?.railLines||[],stations:state.mapData?.stations||[]},120000);
      if(!masks?.corridor)return possible;const value=answer?.type==='boolean'?(invert?!answer.value:!!answer.value):false;
      return runGeometryWorker('same_line_apply',{domain:possible,corridor:masks.corridor,preserve:masks.preserve||null,value,invert:false},90000);
    }
    if(p.question_kind==='tentacle'&&answer?.status==='poi'&&answer.poi)return runGeometryWorker('tentacle_final',{domain:possible,selected:answer.poi,pois:p.pois||[],invert:!!invert},120000);
    if(p.question_kind==='bus_line_tentacle'&&answer?.status==='line'&&answer.line_ref){
      if(!(p.bus_features||[]).length){console.warn('Bus fallback geometry unavailable: source geometry was already compacted.');return possible;}
      return runGeometryWorker('bus_final',{domain:possible,selected_ref:answer.line_ref,refs:p.candidate_line_refs||[],features:p.bus_features||[],grid_m:BUS_TENTACLE_GRID_M,invert:!!invert},120000);
    }
    return possible;
  }
  function scheduleHeavyHistoryReplay(possible,q,answer,invert,expected){
    const key=heavyHistoryKey(q,answer,invert,expected);if(state.heavyHistoryResults.has(key)||state.heavyHistoryJobs.has(key))return;
    state.heavyAreaPending=true;
    const job=(async()=>{await geometryIdleYield(250);return calculateHeavyFallback(possible,q,answer,invert);})()
      .then(result=>{if(result)state.heavyHistoryResults.set(key,result);return result;})
      .then(()=>{state.possibleAreaSignature=null;state.possibleAreaCache.clear();return recomputePossibleArea().then(()=>{renderPossibleArea();});})
      .catch(e=>console.warn('Deferred historical geometry rebuild failed',e))
      .finally(()=>state.heavyHistoryJobs.delete(key));
    state.heavyHistoryJobs.set(key,job);
  }
  async function resolveHeavyFinalGeometry(possible,q,answer,invert=false){
    if(!possible||!q||!answer)return possible;const expected=heavyDomainSignature(q),key=heavyHistoryKey(q,answer,invert,expected),local=state.heavyHistoryResults.get(key);if(local)return local;
    if(!invert&&answer?.geometry_cache_key){const published=await loadPublishedAnswerGeometry(q,answer,expected);if(published)return published;}
    scheduleHeavyHistoryReplay(possible,q,answer,invert,expected);return possible;
  }
"""
s=s[:start]+new+s[end:]

# Answers are timestamped immediately. Geometry is finalized only after the RPC returns.
old_answer_bool="""  async function answerBoolean(q,value){
    const s=suggestedAnswer(q),pen=currentQuestionPenaltyMinutes(q),label=booleanResolutionLabel(q,value);const ok=await confirmAction(`Send ${label}?`,`${questionLabel(q)}\\n\\nPreview: ${s?.text||'Unavailable'}${pen?`\\n\\nLate penalty: −${pen} min`:''}`,`Send ${label}`);if(!ok)return;
    const answer={type:'boolean',value};
    if(q.payload?.question_kind==='same_line'){
      const variant=value?'yes':'no',rec=await preparedForAnswer(q,variant);answer.geometry_variant=variant;if(rec){answer.geometry_domain_signature=rec.domain_signature;if(rec.persisted)answer.geometry_cache_key=rec.cache_key;}
    }
    const {error}=await state.supabase.rpc('answer_question_v5',{p_game_id:state.game.id,p_question_action_id:q.id,p_password:state.hiderPassword,p_answer:answer});if(error)throw error;await reloadGameState();
  }"""
new_answer_bool="""  async function answerBoolean(q,value){
    const s=suggestedAnswer(q),pen=currentQuestionPenaltyMinutes(q),label=booleanResolutionLabel(q,value);const ok=await confirmAction(`Send ${label}?`,`${questionLabel(q)}\\n\\nPreview: ${s?.text||'Unavailable'}${pen?`\\n\\nLate penalty: −${pen} min`:''}`,`Send ${label}`);if(!ok)return;
    const answer={type:'boolean',value};let finalize=null;
    if(q.payload?.question_kind==='same_line'){const variant=value?'yes':'no',signature=heavyDomainSignature(q),domain=state.possibleArea;answer.geometry_variant=variant;answer.geometry_domain_signature=signature;finalize={variant,signature,domain};}
    const {data,error}=await state.supabase.rpc('answer_question_v5',{p_game_id:state.game.id,p_question_action_id:q.id,p_password:state.hiderPassword,p_answer:answer});if(error)throw error;
    if(finalize&&data)finalizeHeavyAnsweredQuestion(q,answer,data,finalize.variant,finalize.domain,finalize.signature);
    await reloadGameState();
  }"""
once(old_answer_bool,new_answer_bool,'immediate same-line answer')

old_tent="""    const variant=`poi:${s.poi.id||s.poi.name||'poi'}`,rec=await preparedForAnswer(q,variant);answer.geometry_variant=variant;if(rec){answer.geometry_domain_signature=rec.domain_signature;if(rec.persisted)answer.geometry_cache_key=rec.cache_key;}
    const {error}=await state.supabase.rpc('answer_question_v5',{p_game_id:state.game.id,p_question_action_id:q.id,p_password:state.hiderPassword,p_answer:answer});if(error)throw error;await reloadGameState();"""
new_tent="""    const variant=`poi:${s.poi.id||s.poi.name||'poi'}`,signature=heavyDomainSignature(q),domain=state.possibleArea;answer.geometry_variant=variant;answer.geometry_domain_signature=signature;
    const {data,error}=await state.supabase.rpc('answer_question_v5',{p_game_id:state.game.id,p_question_action_id:q.id,p_password:state.hiderPassword,p_answer:answer});if(error)throw error;
    if(data)finalizeHeavyAnsweredQuestion(q,answer,data,variant,domain,signature);await reloadGameState();"""
once(old_tent,new_tent,'immediate tentacle answer')

old_bus="""    const variant=`line:${String(s.line_ref).toUpperCase()}`,rec=await preparedForAnswer(q,variant);answer.geometry_variant=variant;if(rec){answer.geometry_domain_signature=rec.domain_signature;if(rec.persisted)answer.geometry_cache_key=rec.cache_key;}
    const {error}=await state.supabase.rpc('answer_bus_line_tentacle_v1',{p_game_id:state.game.id,p_question_action_id:q.id,p_password:state.hiderPassword,p_answer:answer});if(error)throw error;await reloadGameState();"""
new_bus="""    const variant=`line:${String(s.line_ref).toUpperCase()}`,signature=heavyDomainSignature(q),domain=state.possibleArea;answer.geometry_variant=variant;answer.geometry_domain_signature=signature;
    const {data,error}=await state.supabase.rpc('answer_bus_line_tentacle_v1',{p_game_id:state.game.id,p_question_action_id:q.id,p_password:state.hiderPassword,p_answer:answer});if(error)throw error;
    if(data)finalizeHeavyAnsweredQuestion(q,answer,data,variant,domain,signature);await reloadGameState();"""
once(old_bus,new_bus,'immediate bus answer')

# Heavy pending prep remains background-only, with a short delay so the UI paints first.
once(
"    setTimeout(async()=>{\n      try{for(const q of heavyPendingQuestions()){if(['same_line','tentacle','bus_line_tentacle'].includes(q.payload?.question_kind))await prepareHeavyQuestion(q);await geometryIdleYield(220);}}\n      catch(e){console.warn('Background geometry warmup failed',e);}finally{state.geometryWarmScheduled=false;}\n    },0);",
"    setTimeout(async()=>{\n      try{for(const q of heavyPendingQuestions()){if(['same_line','tentacle','bus_line_tentacle'].includes(q.payload?.question_kind))await prepareHeavyQuestion(q);await geometryIdleYield(220);}}\n      catch(e){console.warn('Background geometry warmup failed',e);}finally{state.geometryWarmScheduled=false;}\n    },350);",
'warmup delay')

# Recompute may temporarily skip a missing heavy cache, but must never cache that provisional area.
once(
"  async function recomputePossibleArea(){\n    const signature=possibleAreaStateSignature();",
"  async function recomputePossibleArea(){\n    state.heavyAreaPending=false;const signature=possibleAreaStateSignature();",
'recompute pending reset')
once(
"    state.possibleArea=possible;state.possibleAreaSignature=signature;state.possibleAreaKm2=possible?turf.area(possible)/1e6:0;state.possibleExcludedArea=geometryCacheGet(excludedGeometryKey(signature));cachePossibleArea(signature,possible);",
"    state.possibleArea=possible;state.possibleAreaSignature=signature;state.possibleAreaKm2=possible?turf.area(possible)/1e6:0;state.possibleExcludedArea=geometryCacheGet(excludedGeometryKey(signature));if(state.heavyAreaPending)state.possibleAreaCache.delete(signature);else cachePossibleArea(signature,possible);",
'provisional area not cached')

# Do not waste the worker on city-minus-city or an area known to be provisional.
old_ex="""  function scheduleExcludedGeometry(signature,possible){
    if(!possible||!signature)return;const key=excludedGeometryKey(signature),cached=geometryCacheGet(key);if(cached){applyExcludedGeometryIfCurrent(signature,cached);return;}
    geometryJob(key,()=>runGeometryWorker('difference_optimize',{a:state.mapData.city,b:possible,tolerance:0.00004,min_vertex_m:4})).then(ex=>applyExcludedGeometryIfCurrent(signature,ex)).catch(e=>console.warn('Excluded-area background build failed',e));
  }"""
new_ex="""  function scheduleExcludedGeometry(signature,possible){
    if(!possible||!signature||state.heavyAreaPending)return;if(possible===state.mapData.city){state.possibleExcludedArea=null;return;}const key=excludedGeometryKey(signature),cached=geometryCacheGet(key);if(cached){applyExcludedGeometryIfCurrent(signature,cached);return;}
    geometryJob(key,()=>runGeometryWorker('difference_optimize',{a:state.mapData.city,b:possible,tolerance:0.00004,min_vertex_m:4},90000)).then(ex=>applyExcludedGeometryIfCurrent(signature,ex)).catch(e=>console.warn('Excluded-area background build failed',e));
  }"""
once(old_ex,new_ex,'excluded worker priority')

once(
"    const km2=Number(state.possibleAreaKm2||0);$('remainingAreaText').textContent=state.possibleArea?`${km2.toFixed(km2>=10?1:2)} km² possible`:'0 km² possible';",
"    const km2=Number(state.possibleAreaKm2||0);$('remainingAreaText').textContent=state.possibleArea?`${km2.toFixed(km2>=10?1:2)} km² possible${state.heavyAreaPending?' · map updating…':''}`:'0 km² possible';",
'pending map label')

APP.write_text(s)

# Worker: optimize inputs before boolean operations and split Same-Line into reusable masks + fast final cut.
w=WORKER.read_text()
w=w.replace('/* Hide & Seek Vienna v3.13.2 — heavy geometry worker.','/* Hide & Seek Vienna v3.13.3 — optimized heavy geometry worker.',1)
start=w.index('function sameLineFinal(payload){')
end=w.index('\nfunction closerHalfPlane',start)
new_same=r'''function bboxOverlaps(a,b){ return !(a[2]<b[0] || a[0]>b[2] || a[3]<b[1] || a[1]>b[3]); }
function simplifyLine(feature,tolerance=0.000035){
  if(!feature) return null;
  try { return turf.simplify(feature,{tolerance,highQuality:false,mutate:false}) || feature; } catch(_){ return feature; }
}
function sameLinePrepare(payload){
  const refs=(payload.line_refs||[]).map(r=>String(r).toUpperCase()),radiusM=Number(payload.radius_m||250);
  if(!refs.length) return {corridor:null,preserve:null};
  const selectedSet=new Set(refs),selectedFeatures=matchingRouteFeatures(payload.rail_lines||[],refs).map(f=>simplifyLine(f)).filter(Boolean);
  let corridor=unionList(selectedFeatures.map(f=>{ try{return turf.buffer(f,radiusM/1000,{units:'kilometers',steps:6});}catch(_){return null;} }));
  corridor=optimize(corridor,0.000025,2.5);if(!corridor)return {corridor:null,preserve:null};

  const stationParts=[];
  for(const f of payload.stations||[]){
    const lineRefs=[...new Set((f.properties?.lineRefs||[]).map(r=>String(r).toUpperCase()).filter(r=>/^[US]\d+/i.test(r)))];
    if(lineRefs.length<2 || !lineRefs.some(r=>selectedSet.has(r))) continue;
    try { stationParts.push(turf.buffer(f,radiusM/1000,{units:'kilometers',steps:6})); } catch(_){}
  }
  let preserve=optimize(unionList(stationParts),0.00003,2.5),search=corridor;
  try { search=turf.buffer(corridor,radiusM/1000,{units:'kilometers',steps:4}); } catch(_){}
  let searchBox=null;try{searchBox=turf.bbox(search);}catch(_){}
  const overlaps=[];
  for(const raw of payload.rail_lines||[]){
    const routeRefs=(raw.properties?.routeRefs||[]).map(r=>String(r).toUpperCase());
    if(!routeRefs.some(r=>!selectedSet.has(r))) continue;
    try {
      if(searchBox&&!bboxOverlaps(turf.bbox(raw),searchBox))continue;
      const f=simplifyLine(raw);if(!turf.booleanIntersects(f,search)) continue;
      const b=turf.buffer(f,radiusM/1000,{units:'kilometers',steps:4}),overlap=intersect2(b,corridor);
      if(overlap) overlaps.push(optimize(overlap,0.00003,2.5));
    } catch(_){}
  }
  preserve=optimize(unionList([preserve,...overlaps]),0.00003,2.5);
  return {corridor,preserve};
}
function sameLineApply(payload){
  let domain=optimize(payload.domain,0.000025,2.5),corridor=optimize(payload.corridor,0.000025,2.5),preserve=optimize(payload.preserve,0.00003,2.5);
  if(!domain||!corridor)return domain||null;const yes=!!payload.value;
  if(yes)return optimize(intersect2(domain,corridor)||domain,0.000025,2.5);
  const outside=difference2(domain,corridor),keep=preserve?intersect2(domain,preserve):null;
  return optimize(union2(outside,keep)||outside||keep||domain,0.000025,2.5);
}
function sameLineFinal(payload){
  const masks=sameLinePrepare(payload);if(!payload.domain)return {yes:null,no:null};
  return {yes:sameLineApply({domain:payload.domain,...masks,value:true}),no:sameLineApply({domain:payload.domain,...masks,value:false})};
}
'''
w=w[:start]+new_same+w[end:]

# Tentacles: skip Turf intersections when the current polygon already lies wholly on the kept side.
old_tent=r'''function tentacleFinal(payload){
  const domain=payload.domain;let out=domain;const selected=payload.selected,pois=payload.pois||[];
  if(!out || !selected) return out||null;
  const A={lat:Number(selected.lat),lng:Number(selected.lng)};
  for(const other of pois){
    if(String(other.id)===String(selected.id)) continue;
    const half=closerHalfPlane(A,{lat:Number(other.lat),lng:Number(other.lng)});
    if(half){ out=intersect2(out,half); if(!out) break; }
  }
  if(payload.invert && out) out=difference2(domain,out) || domain;
  return optimize(out);
}'''
new_tent=r'''function geometrySideRange(feature,M,nx,ny){
  let min=Infinity,max=-Infinity;const visit=c=>{if(!Array.isArray(c))return;if(typeof c[0]==='number'&&typeof c[1]==='number'){const p=mercator(Number(c[1]),Number(c[0])),d=(p.x-M.x)*nx+(p.y-M.y)*ny;min=Math.min(min,d);max=Math.max(max,d);return;}for(const x of c)visit(x);};visit(feature?.geometry?.coordinates);return {min,max};
}
function tentacleFinal(payload){
  const domain=optimize(payload.domain,0.000025,2.5);let out=domain;const selected=payload.selected,pois=(payload.pois||[]).slice();
  if(!out || !selected) return out||null;
  const A={lat:Number(selected.lat),lng:Number(selected.lng)},AM=mercator(A.lat,A.lng);
  pois.sort((x,y)=>Math.hypot(mercator(Number(x.lat),Number(x.lng)).x-AM.x,mercator(Number(x.lat),Number(x.lng)).y-AM.y)-Math.hypot(mercator(Number(y.lat),Number(y.lng)).x-AM.x,mercator(Number(y.lat),Number(y.lng)).y-AM.y));
  for(const other of pois){
    if(String(other.id)===String(selected.id)) continue;
    const B=mercator(Number(other.lat),Number(other.lng));let nx=AM.x-B.x,ny=AM.y-B.y;const len=Math.hypot(nx,ny);if(len<1)continue;nx/=len;ny/=len;const M={x:(AM.x+B.x)/2,y:(AM.y+B.y)/2},range=geometrySideRange(out,M,nx,ny);
    if(range.min>=-.05)continue;if(range.max<.05){out=null;break;}
    const half=closerHalfPlane(A,{lat:Number(other.lat),lng:Number(other.lng)});if(half){out=intersect2(out,half);if(!out)break;out=optimize(out,0.000025,2.5);}
  }
  if(payload.invert && out) out=difference2(domain,out) || domain;
  return optimize(out,0.000025,2.5);
}'''
if w.count(old_tent)!=1: raise SystemExit('worker tentacle anchor mismatch')
w=w.replace(old_tent,new_tent,1)

# Bus: classify grid-cell centroids and clip the union once, instead of polygon-intersecting every cell.
old_bus=r'''function busFinal(payload){
  const domain=payload.domain,selected=String(payload.selected_ref||'').toUpperCase(),all=[...new Set((payload.refs||[]).map(r=>String(r).toUpperCase()))];
  if(!domain || !selected || !all.includes(selected)) return domain||null;
  const groups=busGroups(all,payload.features||[]);if(!(groups.get(selected)||[]).length)return domain;
  let cells=[];try{cells=turf.squareGrid(turf.bbox(domain),Number(payload.grid_m||15)/1000,{units:'kilometers'}).features;}catch(_){return domain;}
  const kept=[];
  for(const cell of cells){
    const clipped=intersect2(cell,domain);if(!clipped)continue;
    let probe;try{probe=turf.centroid(clipped);}catch(_){continue;}
    let winner=null,best=Infinity;
    for(const ref of all){
      const d=distanceToLines(probe,groups.get(ref)||[]);
      if(d<best-.25){best=d;winner=ref;} else if(Math.abs(d-best)<=.25 && ref===selected){winner=ref;}
    }
    if(winner===selected) kept.push(clipped);
  }
  let region=unionList(kept);
  if(!region) return optimize(domain);
  if(payload.invert) region=difference2(domain,region) || domain;
  return optimize(region);
}'''
new_bus=r'''function busFinal(payload){
  const domain=optimize(payload.domain,0.000025,2.5),selected=String(payload.selected_ref||'').toUpperCase(),all=[...new Set((payload.refs||[]).map(r=>String(r).toUpperCase()))];
  if(!domain || !selected || !all.includes(selected)) return domain||null;
  const groups=busGroups(all,payload.features||[]);if(!(groups.get(selected)||[]).length)return domain;
  let cells=[];try{cells=turf.squareGrid(turf.bbox(domain),Number(payload.grid_m||15)/1000,{units:'kilometers'}).features;}catch(_){return domain;}
  const kept=[];
  for(const cell of cells){
    let probe;try{probe=turf.centroid(cell);if(!turf.booleanPointInPolygon(probe,domain))continue;}catch(_){continue;}
    let winner=null,best=Infinity;
    for(const ref of all){const d=distanceToLines(probe,groups.get(ref)||[]);if(d<best-.25){best=d;winner=ref;}else if(Math.abs(d-best)<=.25&&ref===selected){winner=ref;}}
    if(winner===selected)kept.push(cell);
  }
  let region=unionList(kept);if(!region)return optimize(domain,0.000025,2.5);
  region=intersect2(region,domain)||region;if(payload.invert)region=difference2(domain,region)||domain;
  return optimize(region,0.000025,2.5);
}'''
if w.count(old_bus)!=1: raise SystemExit('worker bus anchor mismatch')
w=w.replace(old_bus,new_bus,1)

w=w.replace("    if(op==='same_line_final') result=sameLineFinal(payload||{});","    if(op==='same_line_prepare') result=sameLinePrepare(payload||{});\n    else if(op==='same_line_apply') result=sameLineApply(payload||{});\n    else if(op==='same_line_final') result=sameLineFinal(payload||{});",1)
WORKER.write_text(w)

# Cache bust/build label.
i=IDX.read_text().replace('styles.css?v=3.13.2','styles.css?v=3.13.3').replace('BUILD 3.13.2','BUILD 3.13.3').replace('app.js?v=3.13.2','app.js?v=3.13.3')
IDX.write_text(i)
