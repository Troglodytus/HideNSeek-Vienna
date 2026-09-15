from pathlib import Path
import re

APP=Path('app.js')
IDX=Path('index.html')
SQL=Path('supabase-v3.13.2-migration.sql')
s=APP.read_text()


def once(old,new,label):
    global s
    n=s.count(old)
    if n!=1:
        raise SystemExit(f'{label}: expected 1 anchor, found {n}')
    s=s.replace(old,new,1)

once("const APP_VERSION = '3.13.1';","const APP_VERSION = '3.13.2';",'version')

once(
"    geometryCache:new Map(),geometryJobs:new Map(),geometryWarmScheduled:false,possibleAreaSignature:null,possibleAreaCache:new Map(),possibleAreaKm2:0,possibleExcludedArea:null,possibleRenderSignature:null",
"    geometryCache:new Map(),geometryJobs:new Map(),geometryWarmScheduled:false,possibleAreaSignature:null,possibleAreaCache:new Map(),possibleAreaKm2:0,possibleExcludedArea:null,possibleRenderSignature:null,\n    geometryWorker:null,geometryWorkerSeq:0,geometryWorkerPending:new Map(),heavyPrepared:new Map(),heavyPrepareJobs:new Map(),answerGeometryCache:new Map(),geometrySqlAvailable:null,heavyCanvasRenderer:null",
'state worker fields')

once(
"    state.geometryCache=new Map();state.geometryJobs=new Map();state.geometryWarmScheduled=false;state.possibleAreaSignature=null;state.possibleAreaCache=new Map();state.possibleAreaKm2=0;state.possibleExcludedArea=null;state.possibleRenderSignature=null;",
"    try{state.geometryWorker?.terminate();}catch(_){}state.geometryWorker=null;state.geometryWorkerSeq=0;state.geometryWorkerPending=new Map();\n    state.geometryCache=new Map();state.geometryJobs=new Map();state.geometryWarmScheduled=false;state.possibleAreaSignature=null;state.possibleAreaCache=new Map();state.possibleAreaKm2=0;state.possibleExcludedArea=null;state.possibleRenderSignature=null;state.heavyPrepared=new Map();state.heavyPrepareJobs=new Map();state.answerGeometryCache=new Map();state.geometrySqlAvailable=null;state.heavyCanvasRenderer=null;",
'game reset')

once(
"    if(!state.gameMap){\n      state.gameMap=L.map('gameMap',baseMapOptions());addBaseTiles(state.gameMap);state.gameMap.on('click',e=>handleGameMapClick(e.latlng));state.gameMap.on('moveend',saveGameMapView);\n    }\n    state.gameMap.invalidateSize(false);",
"    if(!state.gameMap){\n      state.gameMap=L.map('gameMap',baseMapOptions());addBaseTiles(state.gameMap);state.gameMap.on('click',e=>handleGameMapClick(e.latlng));state.gameMap.on('moveend',saveGameMapView);\n    }\n    if(!state.heavyCanvasRenderer)state.heavyCanvasRenderer=L.canvas({padding:.5,tolerance:4});\n    state.gameMap.invalidateSize(false);",
'canvas renderer')

geometry_job_anchor="""  function geometryJob(key,producer){
    const cached=geometryCacheGet(key);if(cached)return Promise.resolve(cached);
    if(state.geometryJobs?.has(key))return state.geometryJobs.get(key);
    const job=(async()=>{await geometryIdleYield();const value=await producer();return geometryCacheSet(key,value);})().finally(()=>state.geometryJobs?.delete(key));
    if(!state.geometryJobs)state.geometryJobs=new Map();state.geometryJobs.set(key,job);return job;
  }
"""
if s.count(geometry_job_anchor)!=1:
    raise SystemExit('geometryJob insert anchor mismatch')

worker_helpers=r'''  function geometryRpcMissing(error){
    const m=String(error?.message||'').toLowerCase();return error?.code==='PGRST202'||m.includes('could not find the function')||m.includes('schema cache');
  }
  function ensureGeometryWorker(){
    if(state.geometryWorker)return state.geometryWorker;
    if(typeof Worker==='undefined')throw new Error('This browser does not support the background geometry worker required by v3.13.2.');
    const worker=new Worker(`./geometry-worker.js?v=${APP_VERSION}`);
    worker.onmessage=e=>{
      const msg=e.data||{},pending=state.geometryWorkerPending?.get(msg.id);if(!pending)return;
      clearTimeout(pending.timer);state.geometryWorkerPending.delete(msg.id);
      if(msg.ok)pending.resolve(msg.result);else pending.reject(new Error(msg.error||'Background geometry calculation failed.'));
    };
    worker.onerror=e=>{
      const err=new Error(e?.message||'Background geometry worker failed.');
      for(const pending of state.geometryWorkerPending?.values()||[]){clearTimeout(pending.timer);pending.reject(err);}state.geometryWorkerPending?.clear();
      try{worker.terminate();}catch(_){}if(state.geometryWorker===worker)state.geometryWorker=null;
    };
    state.geometryWorker=worker;return worker;
  }
  function runGeometryWorker(op,payload,timeoutMs=180000){
    const worker=ensureGeometryWorker(),id=`g${++state.geometryWorkerSeq}-${Date.now()}`;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{state.geometryWorkerPending.delete(id);reject(new Error(`Background geometry timed out (${op}).`));},timeoutMs);
      state.geometryWorkerPending.set(id,{resolve,reject,timer});
      try{worker.postMessage({id,op,payload});}catch(e){clearTimeout(timer);state.geometryWorkerPending.delete(id);reject(e);}
    });
  }
  function hashGeometryText(text){
    let h=2166136261;for(let i=0;i<String(text).length;i++){h^=String(text).charCodeAt(i);h=Math.imul(h,16777619);}return (h>>>0).toString(16).padStart(8,'0');
  }
  function questionChronoCompare(a,b){
    const ta=new Date(a?.created_at||0).getTime(),tb=new Date(b?.created_at||0).getTime();return ta-tb||String(a?.id||'').localeCompare(String(b?.id||''));
  }
  function heavyDomainSignature(q){
    const phase=targetPhaseStartMs(),zone=latestAction('endgame_zone'),flipped=[...passierscheinFlippedQuestionIds()].map(String).sort();
    const prior=effectiveActions('question').filter(x=>(!phase||new Date(x.created_at).getTime()>phase)&&questionChronoCompare(x,q)<0).sort(questionChronoCompare).map(x=>[x.id,activeAnswerForQuestion(x.id)?.id||'',activeVetoForQuestion(x.id)?.id||'']);
    return JSON.stringify([state.game?.id||'',zone?.id||'',currentAreaMultiplier(),tinyHouseRadiusFactor(),flipped,prior]);
  }
  function heavyCanUseCurrentDomain(q){
    const phase=targetPhaseStartMs();return !effectiveActions('question').some(x=>(!phase||new Date(x.created_at).getTime()>phase)&&questionChronoCompare(x,q)>0&&(activeAnswerForQuestion(x.id)||activeVetoForQuestion(x.id)));
  }
  function heavyMemoryKey(q,variant,signature){return `${q?.id||'q'}|${variant}|${hashGeometryText(signature)}`;}
  function heavySqlKey(q,variant,signature){
    const safe=String(variant||'result').replace(/[^a-zA-Z0-9_.:-]/g,'_').slice(0,48);return `qgeom:${q.id}:${safe}:${hashGeometryText(signature)}`;
  }
  function rememberHeavyPrepared(q,variant,signature,geometry,cacheKey,persisted=false){
    if(!geometry)return null;const rec={question_id:q.id,variant,domain_signature:signature,geometry,cache_key:cacheKey||heavySqlKey(q,variant,signature),persisted:!!persisted};
    state.heavyPrepared.set(heavyMemoryKey(q,variant,signature),rec);if(rec.persisted)state.answerGeometryCache.set(rec.cache_key,rec);return rec;
  }
  async function loadPrivatePrepared(q,variant,signature){
    const mk=heavyMemoryKey(q,variant,signature),mem=state.heavyPrepared.get(mk);if(mem)return mem;
    if(state.role!=='hider'||!state.hiderPassword||state.geometrySqlAvailable===false)return null;
    const cacheKey=heavySqlKey(q,variant,signature);
    const {data,error}=await state.supabase.rpc('get_hider_question_geometry_v1',{p_game_id:state.game.id,p_question_action_id:q.id,p_password:state.hiderPassword,p_cache_key:cacheKey});
    if(error){if(geometryRpcMissing(error))state.geometrySqlAvailable=false;else console.warn('Private geometry-cache lookup failed',error);return null;}
    state.geometrySqlAvailable=true;const row=(data||[])[0];if(!row?.geometry||row.domain_signature!==signature)return null;
    return rememberHeavyPrepared(q,variant,signature,row.geometry,row.cache_key,true);
  }
  async function persistPrepared(q,variant,signature,geometry){
    const existing=rememberHeavyPrepared(q,variant,signature,geometry,heavySqlKey(q,variant,signature),false);if(!existing||state.role!=='hider'||!state.hiderPassword||state.geometrySqlAvailable===false)return existing;
    const {data,error}=await state.supabase.rpc('save_question_geometry_v1',{p_game_id:state.game.id,p_question_action_id:q.id,p_password:state.hiderPassword,p_cache_key:existing.cache_key,p_domain_signature:signature,p_geometry:geometry});
    if(error){if(geometryRpcMissing(error))state.geometrySqlAvailable=false;else console.warn('Geometry-cache save failed',error);return existing;}
    state.geometrySqlAvailable=true;existing.persisted=!!data;state.heavyPrepared.set(heavyMemoryKey(q,variant,signature),existing);if(existing.persisted)state.answerGeometryCache.set(existing.cache_key,existing);return existing;
  }
  async function prepareHeavyQuestion(q){
    if(state.role!=='hider'||!q||!state.possibleArea||!heavyCanUseCurrentDomain(q))return null;
    const kind=q.payload?.question_kind;if(!['same_line','tentacle','bus_line_tentacle'].includes(kind))return null;
    const signature=heavyDomainSignature(q),jobKey=`prepare:${q.id}:${hashGeometryText(signature)}`;
    if(state.heavyPrepareJobs.has(jobKey))return state.heavyPrepareJobs.get(jobKey);
    const job=(async()=>{
      const domain=state.possibleArea,p=q.payload||{};
      if(kind==='same_line'){
        let yes=await loadPrivatePrepared(q,'yes',signature),no=await loadPrivatePrepared(q,'no',signature);if(yes&&no)return {yes,no};
        const bundle=await runGeometryWorker('same_line_final',{domain,line_refs:p.line_refs||[],radius_m:250,rail_lines:state.mapData?.railLines||[],stations:state.mapData?.stations||[]});
        if(bundle?.yes)yes=await persistPrepared(q,'yes',signature,bundle.yes);if(bundle?.no)no=await persistPrepared(q,'no',signature,bundle.no);return {yes,no};
      }
      const suggested=suggestedAnswer(q);
      if(kind==='tentacle'){
        if(suggested?.status!=='poi'||!suggested.poi)return null;const variant=`poi:${suggested.poi.id||suggested.poi.name||'poi'}`;let rec=await loadPrivatePrepared(q,variant,signature);if(rec)return rec;
        const geometry=await runGeometryWorker('tentacle_final',{domain,selected:suggested.poi,pois:p.pois||[],invert:false});return geometry?persistPrepared(q,variant,signature,geometry):null;
      }
      if(suggested?.status!=='line'||!suggested.line_ref)return null;const variant=`line:${String(suggested.line_ref).toUpperCase()}`;let rec=await loadPrivatePrepared(q,variant,signature);if(rec)return rec;
      const geometry=await runGeometryWorker('bus_final',{domain,selected_ref:suggested.line_ref,refs:p.candidate_line_refs||[],features:p.bus_features||[],grid_m:BUS_TENTACLE_GRID_M,invert:false});return geometry?persistPrepared(q,variant,signature,geometry):null;
    })().finally(()=>state.heavyPrepareJobs.delete(jobKey));
    state.heavyPrepareJobs.set(jobKey,job);return job;
  }
  async function preparedForAnswer(q,variant){
    const signature=heavyDomainSignature(q),mk=heavyMemoryKey(q,variant,signature);let rec=state.heavyPrepared.get(mk);if(rec)return rec;
    if(!heavyCanUseCurrentDomain(q))return null;toast('Finalizing map geometry in the background…',2200);const prepared=await prepareHeavyQuestion(q);
    if(q.payload?.question_kind==='same_line')rec=prepared?.[variant]||null;else rec=prepared||null;return rec;
  }
  async function loadPublishedAnswerGeometry(q,answer,expectedSignature){
    if(!answer?.geometry_cache_key||answer.geometry_domain_signature!==expectedSignature)return null;
    const key=answer.geometry_cache_key,mem=state.answerGeometryCache.get(key);if(mem?.domain_signature===expectedSignature&&mem.geometry)return mem.geometry;
    if(state.geometrySqlAvailable===false)return null;
    const {data,error}=await state.supabase.rpc('get_answer_geometry_v1',{p_game_id:state.game.id,p_question_action_id:q.id,p_cache_key:key});
    if(error){if(geometryRpcMissing(error))state.geometrySqlAvailable=false;else console.warn('Published geometry-cache lookup failed',error);return null;}
    state.geometrySqlAvailable=true;const row=(data||[])[0];if(!row?.geometry||row.domain_signature!==expectedSignature)return null;
    state.answerGeometryCache.set(key,{geometry:row.geometry,domain_signature:row.domain_signature,cache_key:row.cache_key,persisted:true});return row.geometry;
  }
  async function resolveHeavyFinalGeometry(possible,q,answer,invert=false){
    if(!possible||!q||!answer)return possible;const p=q.payload||{},expected=heavyDomainSignature(q);
    if(!invert){const published=await loadPublishedAnswerGeometry(q,answer,expected);if(published)return published;}
    const ansId=activeAnswerForQuestion(q.id)?.id||'answer',fallbackKey=`heavy-final:${q.id}:${ansId}:${hashGeometryText(expected)}:${invert?'i':'n'}`,cached=geometryCacheGet(fallbackKey);if(cached)return cached;
    return geometryJob(fallbackKey,async()=>{
      if(p.question_kind==='same_line'){
        const bundle=await runGeometryWorker('same_line_final',{domain:possible,line_refs:p.line_refs||[],radius_m:250,rail_lines:state.mapData?.railLines||[],stations:state.mapData?.stations||[]});
        const value=answer?.type==='boolean'?(invert?!answer.value:!!answer.value):false;return value?bundle?.yes:bundle?.no;
      }
      if(p.question_kind==='tentacle'&&answer?.status==='poi'&&answer.poi)return runGeometryWorker('tentacle_final',{domain:possible,selected:answer.poi,pois:p.pois||[],invert:!!invert});
      if(p.question_kind==='bus_line_tentacle'&&answer?.status==='line'&&answer.line_ref){
        if(!(p.bus_features||[]).length){console.warn('Bus fallback geometry unavailable: question input was compacted before a persisted result could be loaded.');return possible;}
        return runGeometryWorker('bus_final',{domain:possible,selected_ref:answer.line_ref,refs:p.candidate_line_refs||[],features:p.bus_features||[],grid_m:BUS_TENTACLE_GRID_M,invert:!!invert});
      }
      return possible;
    });
  }
'''
s=s.replace(geometry_job_anchor,geometry_job_anchor+worker_helpers,1)

# Replace v3.13.1 warm-up with true worker/SQL preparation, Hider only.
pattern=r"  function scheduleHeavyGeometryWarmups\(\)\{.*?\n  \}\n  function possibleAreaStateSignature\(\)\{"
replacement="""  function scheduleHeavyGeometryWarmups(){
    if(state.role!=='hider'||state.geometryWarmScheduled||!state.game||!state.possibleArea)return;state.geometryWarmScheduled=true;
    setTimeout(async()=>{
      try{for(const q of heavyPendingQuestions()){if(['same_line','tentacle','bus_line_tentacle'].includes(q.payload?.question_kind))await prepareHeavyQuestion(q);await geometryIdleYield(220);}}
      catch(e){console.warn('Background geometry warmup failed',e);}finally{state.geometryWarmScheduled=false;}
    },0);
  }
  function possibleAreaStateSignature(){"""
s,n=re.subn(pattern,replacement,s,count=1,flags=re.S)
if n!=1: raise SystemExit(f'warmup replacement: {n}')

# Excluded-area geometry must also be off-main-thread, and render on Leaflet Canvas.
once(
"    state.mapLayers.excluded?.remove();state.mapLayers.excluded=null;if(geometry)state.mapLayers.excluded=L.geoJSON(geometry,{style:mapGeoStyle('excluded'),interactive:false}).addTo(state.gameMap);",
"    state.mapLayers.excluded?.remove();state.mapLayers.excluded=null;if(geometry)state.mapLayers.excluded=L.geoJSON(geometry,{style:mapGeoStyle('excluded'),interactive:false,renderer:state.heavyCanvasRenderer,smoothFactor:2.5}).addTo(state.gameMap);",
'excluded canvas')
once(
"    geometryJob(key,async()=>{await geometryIdleYield(180);const ex=safeDifference(state.mapData.city,possible);return optimizePolygonGeometry(ex,0.000025);}).then(ex=>applyExcludedGeometryIfCurrent(signature,ex)).catch(e=>console.warn('Excluded-area background build failed',e));",
"    geometryJob(key,()=>runGeometryWorker('difference_optimize',{a:state.mapData.city,b:possible,tolerance:0.00004,min_vertex_m:4})).then(ex=>applyExcludedGeometryIfCurrent(signature,ex)).catch(e=>console.warn('Excluded-area background build failed',e));",
'excluded worker')

# Bus no longer embeds the whole possible-area domain in every question row.
once(
"showBusLinePreview(refs,null,busFeatures);const payload={slot_key:card.slot,question_kind:'bus_line_tentacle',title:card.title,search_buffer_m:bufferM,candidate_line_refs:refs,bus_features:busFeatures,domain_geometry:state.possibleArea};",
"showBusLinePreview(refs,null,busFeatures);const payload={slot_key:card.slot,question_kind:'bus_line_tentacle',title:card.title,search_buffer_m:bufferM,candidate_line_refs:refs,bus_features:busFeatures};",
'bus payload compaction')

# Answers carry only a small SQL cache reference. Never inline heavy polygons in game_actions.
old="""    const answer={type:'boolean',value};
    if(q.payload?.question_kind==='same_line'){
      const bundle=await ensureSameLineConstraintBundle(q);if(bundle){answer.constraint_geometry_yes=bundle.yes;answer.constraint_geometry_no=bundle.no;}
    }
    const {error}=await state.supabase.rpc('answer_question_v5',{p_game_id:state.game.id,p_question_action_id:q.id,p_password:state.hiderPassword,p_answer:answer});if(error)throw error;await reloadGameState();"""
new="""    const answer={type:'boolean',value};
    if(q.payload?.question_kind==='same_line'){
      const variant=value?'yes':'no',rec=await preparedForAnswer(q,variant);answer.geometry_variant=variant;if(rec){answer.geometry_domain_signature=rec.domain_signature;if(rec.persisted)answer.geometry_cache_key=rec.cache_key;}
    }
    const {error}=await state.supabase.rpc('answer_question_v5',{p_game_id:state.game.id,p_question_action_id:q.id,p_password:state.hiderPassword,p_answer:answer});if(error)throw error;await reloadGameState();"""
once(old,new,'same-line answer')

once(
"    const cell=await ensureTentacleConstraintGeometry(q,s.poi);if(cell)answer.constraint_geometry=cell;\n    const {error}=await state.supabase.rpc('answer_question_v5',{p_game_id:state.game.id,p_question_action_id:q.id,p_password:state.hiderPassword,p_answer:answer});if(error)throw error;await reloadGameState();",
"    const variant=`poi:${s.poi.id||s.poi.name||'poi'}`,rec=await preparedForAnswer(q,variant);answer.geometry_variant=variant;if(rec){answer.geometry_domain_signature=rec.domain_signature;if(rec.persisted)answer.geometry_cache_key=rec.cache_key;}\n    const {error}=await state.supabase.rpc('answer_question_v5',{p_game_id:state.game.id,p_question_action_id:q.id,p_password:state.hiderPassword,p_answer:answer});if(error)throw error;await reloadGameState();",
'tentacle answer')
once(
"    const region=await ensureBusConstraintGeometry(q,s.line_ref);if(region)answer.constraint_geometry=region;\n    const {error}=await state.supabase.rpc('answer_bus_line_tentacle_v1',{p_game_id:state.game.id,p_question_action_id:q.id,p_password:state.hiderPassword,p_answer:answer});if(error)throw error;await reloadGameState();",
"    const variant=`line:${String(s.line_ref).toUpperCase()}`,rec=await preparedForAnswer(q,variant);answer.geometry_variant=variant;if(rec){answer.geometry_domain_signature=rec.domain_signature;if(rec.persisted)answer.geometry_cache_key=rec.cache_key;}\n    const {error}=await state.supabase.rpc('answer_bus_line_tentacle_v1',{p_game_id:state.game.id,p_question_action_id:q.id,p_password:state.hiderPassword,p_answer:answer});if(error)throw error;await reloadGameState();",
'bus answer')

# Avoid the v3.13.1 final main-thread simplify over the entire map.
once(
"    possible=optimizePolygonGeometry(possible,0.000012);state.possibleArea=possible;state.possibleAreaSignature=signature;",
"    state.possibleArea=possible;state.possibleAreaSignature=signature;",
'global simplify removal')

# Automatic Tentacle veto can also hit a complex polygon; move the difference into the worker.
once(
"        if(veto.payload?.automatic_tentacle&&veto.payload?.radar_miss&&q.payload?.origin){const r=Number(veto.payload?.radius_m||q.payload?.valid_distance_m||TENTACLE_VALID_DISTANCE_M),c=turf.buffer(turf.point([Number(q.payload.origin.lng),Number(q.payload.origin.lat)]),r/1000,{units:'kilometers',steps:32});possible=safeDifference(possible,c);}",
"        if(veto.payload?.automatic_tentacle&&veto.payload?.radar_miss&&q.payload?.origin){const r=Number(veto.payload?.radius_m||q.payload?.valid_distance_m||TENTACLE_VALID_DISTANCE_M),c=turf.buffer(turf.point([Number(q.payload.origin.lng),Number(q.payload.origin.lat)]),r/1000,{units:'kilometers',steps:32});possible=await runGeometryWorker('difference_optimize',{a:possible,b:c,tolerance:0.00003,min_vertex_m:3})||possible;}",
'auto-veto worker')

# Heavy answered constraints now return a completed final possible-area polygon directly.
pattern=r"    if\(p\.question_kind==='same_line'\)\{.*?\n    \}\n    if\(p\.question_kind==='station_interchange'\)"
replacement="""    if(p.question_kind==='same_line')return resolveHeavyFinalGeometry(possible,q,answer,invert);
    if(p.question_kind==='station_interchange')"""
s,n=re.subn(pattern,replacement,s,count=1,flags=re.S)
if n!=1: raise SystemExit(f'same-line apply replacement: {n}')

pattern=r"    if\(p\.question_kind==='bus_line_tentacle'\)\{.*?\n    \}\n    if\(p\.question_kind==='tentacle'\)\{.*?\n    \}\n    return possible;"
replacement="""    if(p.question_kind==='bus_line_tentacle')return resolveHeavyFinalGeometry(possible,q,answer,invert);
    if(p.question_kind==='tentacle')return resolveHeavyFinalGeometry(possible,q,answer,invert);
    return possible;"""
s,n=re.subn(pattern,replacement,s,count=1,flags=re.S)
if n!=1: raise SystemExit(f'tentacle/bus apply replacement: {n}')

# Keep heavy polygons on a single Canvas renderer rather than huge SVG paths.
once(
"      if(state.possibleArea){state.mapLayers.possible=L.geoJSON(state.possibleArea,{style:mapGeoStyle('possible'),interactive:false}).addTo(state.gameMap);if(state.possibleExcludedArea)state.mapLayers.excluded=L.geoJSON(state.possibleExcludedArea,{style:mapGeoStyle('excluded'),interactive:false}).addTo(state.gameMap);else scheduleExcludedGeometry(signature,state.possibleArea);}state.possibleRenderSignature=signature;",
"      if(state.possibleArea){state.mapLayers.possible=L.geoJSON(state.possibleArea,{style:mapGeoStyle('possible'),interactive:false,renderer:state.heavyCanvasRenderer,smoothFactor:2.5}).addTo(state.gameMap);if(state.possibleExcludedArea)state.mapLayers.excluded=L.geoJSON(state.possibleExcludedArea,{style:mapGeoStyle('excluded'),interactive:false,renderer:state.heavyCanvasRenderer,smoothFactor:2.5}).addTo(state.gameMap);else scheduleExcludedGeometry(signature,state.possibleArea);}state.possibleRenderSignature=signature;",
'possible canvas')

APP.write_text(s)

# Cache-bust the new worker/app and expose build number only; no layout/content changes.
i=IDX.read_text().replace('styles.css?v=3.13.1','styles.css?v=3.13.2').replace('BUILD 3.13.1','BUILD 3.13.2').replace('app.js?v=3.13.1','app.js?v=3.13.2')
IDX.write_text(i)

# Only remove Bus source geometry after a persisted final result really exists.
q=SQL.read_text()
old="  update public.game_actions set payload=payload-'bus_features'-'domain_geometry' where id=p_question_action_id;"
new="  if nullif(p_answer->>'geometry_cache_key','') is not null then\n    update public.game_actions set payload=payload-'bus_features'-'domain_geometry' where id=p_question_action_id;\n  end if;"
if q.count(old)!=1: raise SystemExit('SQL bus compact anchor mismatch')
SQL.write_text(q.replace(old,new,1))
