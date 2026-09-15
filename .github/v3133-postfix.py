from pathlib import Path
p=Path('app.js');s=p.read_text()

def once(old,new,label):
    global s
    n=s.count(old)
    if n!=1: raise SystemExit(f'{label}: expected 1, found {n}')
    s=s.replace(old,new,1)

once(
"    geometryWorker:null,geometryWorkerSeq:0,geometryWorkerPending:new Map(),heavyPrepared:new Map(),heavyPrepareJobs:new Map(),answerGeometryCache:new Map(),geometrySqlAvailable:null,heavyCanvasRenderer:null,sameLineMasks:new Map(),heavyHistoryResults:new Map(),heavyHistoryJobs:new Map(),heavyAreaPending:false",
"    geometryWorker:null,geometryWorkerSeq:0,geometryWorkerPending:new Map(),heavyPrepared:new Map(),heavyPrepareJobs:new Map(),answerGeometryCache:new Map(),geometrySqlAvailable:null,heavyCanvasRenderer:null,sameLineMasks:new Map(),heavyHistoryResults:new Map(),heavyHistoryJobs:new Map(),heavyFinalizeJobs:new Map(),heavyAreaPending:false",
'finalize state')
once(
"state.sameLineMasks=new Map();state.heavyHistoryResults=new Map();state.heavyHistoryJobs=new Map();state.heavyAreaPending=false;",
"state.sameLineMasks=new Map();state.heavyHistoryResults=new Map();state.heavyHistoryJobs=new Map();state.heavyFinalizeJobs=new Map();state.heavyAreaPending=false;",
'finalize reset')

# Track finalization promises so reloads never start duplicate calculations for the same answer.
old="""  async function finalizeHeavyAnsweredQuestion(q,answer,answerActionId,variant,domain,signature){
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
  }"""
new="""  function finalizeHeavyAnsweredQuestion(q,answer,answerActionId,variant,domain,signature){
    if(!q||!answer||!answerActionId||!domain)return Promise.resolve();const gameId=state.game?.id,key=String(answerActionId);if(state.heavyFinalizeJobs.has(key))return state.heavyFinalizeJobs.get(key);
    const job=(async()=>{try{
      let rec=null,geometry=null;if(state.game?.id!==gameId)return;
      if(q.payload?.question_kind==='same_line'){
        const masks=await prepareSameLineMasks(q,signature);if(state.game?.id!==gameId||!masks?.corridor)return;
        geometry=await runGeometryWorker('same_line_apply',{domain,corridor:masks.corridor,preserve:masks.preserve||null,value:!!answer.value,invert:false},90000);if(state.game?.id!==gameId)return;
        if(geometry)rec=await persistPrepared(q,variant,signature,geometry);
      }else{
        const mk=heavyMemoryKey(q,variant,signature);rec=state.heavyPrepared.get(mk)||null;
        if(!rec){const prepared=await prepareHeavyQuestion(q);if(state.game?.id!==gameId)return;rec=prepared?.cache_key?prepared:(state.heavyPrepared.get(mk)||null);}
      }
      if(state.game?.id===gameId&&await attachAnswerGeometry(q,answerActionId,rec)){state.possibleAreaSignature=null;state.possibleAreaCache.clear();reloadGameState().catch(console.warn);}
    }catch(e){console.warn('Heavy answer geometry finalization failed; answer itself is already recorded.',e);}})().finally(()=>state.heavyFinalizeJobs.delete(key));
    state.heavyFinalizeJobs.set(key,job);return job;
  }"""
once(old,new,'finalization lock')

# Historical fallback waits briefly for the Hider's cache update, and is game-session guarded.
old="""  function scheduleHeavyHistoryReplay(possible,q,answer,invert,expected){
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
  }"""
new="""  function scheduleHeavyHistoryReplay(possible,q,answer,invert,expected){
    const key=heavyHistoryKey(q,answer,invert,expected);if(state.heavyHistoryResults.has(key)||state.heavyHistoryJobs.has(key))return;const gameId=state.game?.id;
    state.heavyAreaPending=true;
    const job=(async()=>{
      await new Promise(r=>setTimeout(r,2500));if(state.game?.id!==gameId)return null;
      const latest=activeAnswerForQuestion(q.id)?.payload?.answer;if(!invert&&latest?.geometry_cache_key)return null;
      await geometryIdleYield(250);return calculateHeavyFallback(possible,q,answer,invert);
    })()
      .then(result=>{if(state.game?.id!==gameId)return null;if(result)state.heavyHistoryResults.set(key,result);return result;})
      .then(result=>{if(state.game?.id!==gameId)return;if(!result){state.possibleAreaSignature=null;return reloadGameState();}state.possibleAreaSignature=null;state.possibleAreaCache.clear();return recomputePossibleArea().then(()=>{renderPossibleArea();});})
      .catch(e=>console.warn('Deferred historical geometry rebuild failed',e))
      .finally(()=>state.heavyHistoryJobs.delete(key));
    state.heavyHistoryJobs.set(key,job);
  }
  async function resolveHeavyFinalGeometry(possible,q,answer,invert=false){
    if(!possible||!q||!answer)return possible;const expected=heavyDomainSignature(q),key=heavyHistoryKey(q,answer,invert,expected),local=state.heavyHistoryResults.get(key);if(local)return local;
    if(!invert&&answer?.geometry_cache_key){const published=await loadPublishedAnswerGeometry(q,answer,expected);if(published)return published;}
    const aid=activeAnswerForQuestion(q.id)?.id;if(aid&&state.heavyFinalizeJobs.has(String(aid))){state.heavyAreaPending=true;return possible;}
    scheduleHeavyHistoryReplay(possible,q,answer,invert,expected);return possible;
  }"""
once(old,new,'history grace and lock')

# Preserve pending state across ordinary poll/realtime reloads of the same provisional signature.
once(
"  async function recomputePossibleArea(){\n    state.heavyAreaPending=false;const signature=possibleAreaStateSignature();\n    if(signature===state.possibleAreaSignature)return;",
"  async function recomputePossibleArea(){\n    const signature=possibleAreaStateSignature();if(signature===state.possibleAreaSignature)return;state.heavyAreaPending=false;",
'pending reset order')

# Automatic Tentacle-miss geometry must also never block game entry.
old_auto="""        if(veto.payload?.automatic_tentacle&&veto.payload?.radar_miss&&q.payload?.origin){const r=Number(veto.payload?.radius_m||q.payload?.valid_distance_m||TENTACLE_VALID_DISTANCE_M),c=turf.buffer(turf.point([Number(q.payload.origin.lng),Number(q.payload.origin.lat)]),r/1000,{units:'kilometers',steps:32});possible=await runGeometryWorker('difference_optimize',{a:possible,b:c,tolerance:0.00003,min_vertex_m:3})||possible;}"""
new_auto="""        if(veto.payload?.automatic_tentacle&&veto.payload?.radar_miss&&q.payload?.origin){
          const r=Number(veto.payload?.radius_m||q.payload?.valid_distance_m||TENTACLE_VALID_DISTANCE_M),c=turf.buffer(turf.point([Number(q.payload.origin.lng),Number(q.payload.origin.lat)]),r/1000,{units:'kilometers',steps:32}),k=`auto-veto|${q.id}|${veto.id}|${hashGeometryText(heavyDomainSignature(q))}`,ready=state.heavyHistoryResults.get(k);
          if(ready)possible=ready;else{state.heavyAreaPending=true;if(!state.heavyHistoryJobs.has(k)){const gameId=state.game?.id,job=(async()=>{await geometryIdleYield(250);return runGeometryWorker('difference_optimize',{a:possible,b:c,tolerance:0.00003,min_vertex_m:3},90000);})().then(result=>{if(state.game?.id!==gameId)return;if(result)state.heavyHistoryResults.set(k,result);state.possibleAreaSignature=null;state.possibleAreaCache.clear();return recomputePossibleArea().then(()=>renderPossibleArea());}).catch(e=>console.warn('Deferred Tentacle veto geometry failed',e)).finally(()=>state.heavyHistoryJobs.delete(k));state.heavyHistoryJobs.set(k,job);}}
        }"""
once(old_auto,new_auto,'nonblocking auto veto')

p.write_text(s)
