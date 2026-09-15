from pathlib import Path

p=Path('app.js')
s=p.read_text(encoding='utf-8')

def one(old,new,label):
    global s
    n=s.count(old)
    if n!=1:
        raise RuntimeError(f'{label}: expected 1 match, got {n}')
    s=s.replace(old,new,1)

one("const APP_VERSION = '3.12.0';","const APP_VERSION = '3.12.1';",'version')
one("    realtimeChannel:null, timerId:null, pollId:null, serverOffsetMs:0,\n","    realtimeChannel:null, timerId:null, pollId:null, serverOffsetMs:0,reloadPromise:null,reloadQueued:false,\n",'reload state')

one("""  async function fetchOfficialTransitBundle(city){
    const [lineGeo,ubahnStops,allStops]=await Promise.all([
      fetchViennaWfs(VIENNA_TRANSIT_LINES_LAYER,'Vienna public-transport lines'),
      fetchViennaWfs(VIENNA_UBAHN_STOPS_LAYER,'Vienna U-Bahn stops'),
      fetchViennaWfs(VIENNA_TRANSIT_STOPS_LAYER,'Vienna public-transport stops')
    ]);
    const railLines=normalizeOfficialTransitLines(lineGeo);
    const busLines=normalizeOfficialBusLines(lineGeo);
    const stations=normalizeOfficialStations(ubahnStops,allStops,railLines,city);
    if(stations.length<20)throw new Error(`Vienna official transport data produced only ${stations.length} U-/S-Bahn stations.`);
    return {stations,railLines,busLines};
  }
""","""  async function fetchOfficialTransitBundle(city){
    const [lineGeo,ubahnStops,allStops]=await Promise.all([
      fetchViennaWfs(VIENNA_TRANSIT_LINES_LAYER,'Vienna public-transport lines'),
      fetchViennaWfs(VIENNA_UBAHN_STOPS_LAYER,'Vienna U-Bahn stops'),
      fetchViennaWfs(VIENNA_TRANSIT_STOPS_LAYER,'Vienna public-transport stops')
    ]);
    const railLines=normalizeOfficialTransitLines(lineGeo);
    const stations=normalizeOfficialStations(ubahnStops,allStops,railLines,city);
    if(stations.length<20)throw new Error(`Vienna official transport data produced only ${stations.length} U-/S-Bahn stations.`);
    return {stations,railLines};
  }
""",'direct transit bundle')

one("""  async function referenceChunkRows(baseKey){
    initSupabaseIfNeeded();
    const {data,error}=await state.supabase.from('reference_datasets').select('dataset_key,payload,source,content_hash,updated_at,checked_at').like('dataset_key',`${baseKey}__chunk_%`).order('dataset_key');
    if(error)throw error;return data||[];
  }
""","""  async function referenceChunkRows(baseKey){
    initSupabaseIfNeeded();
    const {data,error}=await state.supabase.from('reference_datasets').select('dataset_key,payload,source,content_hash,updated_at,checked_at').like('dataset_key',`${baseKey}__chunk_%`).order('dataset_key');
    if(error)throw error;return data||[];
  }
  async function referenceChunkRowsForTiles(baseKey,tiles){
    initSupabaseIfNeeded();const keys=(tiles||[]).map(t=>chunkDatasetKey(baseKey,t.id));if(!keys.length)return [];
    const {data,error}=await state.supabase.from('reference_datasets').select('dataset_key,payload,source,content_hash,updated_at,checked_at').in('dataset_key',keys).order('dataset_key');
    if(error)throw error;return data||[];
  }
  function refreshTilesForGeometry(geometry,bufferM=0){
    if(!geometry)return [];
    let search=geometry;if(Number(bufferM)>0){try{search=turf.buffer(geometry,Number(bufferM)/1000,{units:'kilometers',steps:16});}catch(_){}}
    let box;try{box=turf.bbox(search);}catch(_){return [];}
    const [west,south,east,north]=box;
    return refreshGrid().filter(t=>t.east>=west&&t.west<=east&&t.north>=south&&t.south<=north);
  }
""",'tile subset helpers')

one("""    statusEl.textContent='Building U-Bahn/S-Bahn and bus network…';
    await new Promise(r=>setTimeout(r,0));
    const railLines=normalizeOfficialTransitLines(linesGeo);
    const busLines=normalizeOfficialBusLines(linesGeo);
    if(!busLines.length)throw new Error('Vienna public-transport WFS returned no usable bus line geometry.');
""","""    statusEl.textContent='Building U-Bahn/S-Bahn network; bus geometry stays in transit tiles…';
    await new Promise(r=>setTimeout(r,0));
    const railLines=normalizeOfficialTransitLines(linesGeo);
""",'transit assembly')
one("""    statusEl.textContent=`Saving ${railLines.length} U-/S-Bahn + ${busLines.length} bus line segments…`;
    await saveReferenceDataset(REF_TRANSIT_KEY,{railLines,busLines},`Chunked Stadt Wien WFS · ${tiles.length} tiles`);
    return {complete:true,results,stations:stations.length,lines:railLines.length,buses:busLines.length};
""","""    statusEl.textContent=`Saving ${railLines.length} U-/S-Bahn segments; bus lines remain in ${tiles.length} cached transit tiles…`;
    await saveReferenceDataset(REF_TRANSIT_KEY,{railLines},`Chunked Stadt Wien WFS · ${tiles.length} tiles · bus geometry stored per tile`);
    return {complete:true,results,stations:stations.length,lines:railLines.length,bus_tiles:tiles.length};
""",'transit final save')
one("""  async function fetchTransitReference(){
    const admin=await referenceDataset(REF_ADMIN_KEY);const city=admin?.city||state.mapData?.city;
    const bundle=await fetchOfficialTransitBundle(city);
    return {railLines:bundle.railLines,busLines:bundle.busLines};
  }
""","""  async function fetchTransitReference(){
    const admin=await referenceDataset(REF_ADMIN_KEY);const city=admin?.city||state.mapData?.city;
    const bundle=await fetchOfficialTransitBundle(city);
    return {railLines:bundle.railLines};
  }
""",'legacy transit getter')
one("""      const rails=JSON.parse(localStorage.getItem(RAIL_CACHE_KEY)||'null');if(Array.isArray(rails)&&rails.length){const existingTransit=await referenceDataset(REF_TRANSIT_KEY);await saveReferenceDataset(REF_TRANSIT_KEY,{railLines:rails,busLines:Array.isArray(existingTransit?.busLines)?existingTransit.busLines:[]},'Imported browser cache');count++;}
""","""      const rails=JSON.parse(localStorage.getItem(RAIL_CACHE_KEY)||'null');if(Array.isArray(rails)&&rails.length){await saveReferenceDataset(REF_TRANSIT_KEY,{railLines:rails},'Imported browser cache · bus geometry remains tiled');count++;}
""",'browser transit import')

one("""  function sameLineExclusiveCorridor(refs,radiusM=250){
    const selected=(refs||[]).map(r=>String(r).toUpperCase());const selectedCorridor=sameLineCorridor(selected,radiusM);if(!selectedCorridor)return null;
    const selectedSet=new Set(selected),otherRefs=availableRailLineRefs().filter(r=>!selectedSet.has(String(r).toUpperCase()));
    const otherCorridor=sameLineCorridor(otherRefs,radiusM);const interchanges=interchangeStationArea(radiusM,selected);
    let preserve=otherCorridor;if(interchanges)preserve=safeUnion(preserve,interchanges);
    return preserve?(safeDifference(selectedCorridor,preserve)||null):selectedCorridor;
  }
""","""  function sameLineExclusiveCorridor(refs,radiusM=250){
    const selected=(refs||[]).map(r=>String(r).toUpperCase());const selectedCorridor=sameLineCorridor(selected,radiusM);if(!selectedCorridor)return null;
    const selectedSet=new Set(selected);let preserve=interchangeStationArea(radiusM,selected);
    // NO used to buffer+union the complete rest of Vienna's rail network before clipping it.
    // Only other-line corridors close enough to overlap the selected corridor can matter.
    let search=selectedCorridor;try{search=turf.buffer(selectedCorridor,Number(radiusM)/1000,{units:'kilometers',steps:8});}catch(_){}
    for(const f of state.mapData?.railLines||[]){
      const routeRefs=(f.properties?.routeRefs||[]).map(r=>String(r).toUpperCase());if(!routeRefs.some(r=>!selectedSet.has(r)))continue;
      try{if(!turf.booleanIntersects(f,search))continue;const b=turf.buffer(f,Number(radiusM)/1000,{units:'kilometers',steps:8});const local=safeIntersect(b,selectedCorridor);if(local)preserve=safeUnion(preserve,local);}catch(_){}
    }
    return preserve?(safeDifference(selectedCorridor,preserve)||null):selectedCorridor;
  }
""",'same-line local overlap')

one("""  async function ensureBusLines(){
    if(Array.isArray(state.mapData?.busLines)&&state.mapData.busLines.length)return state.mapData.busLines;
    const ref=await referenceDataset(REF_TRANSIT_KEY);
    if(Array.isArray(ref?.busLines)&&ref.busLines.length){state.mapData.busLines=ref.busLines;return ref.busLines;}
    throw new Error('Vienna bus-line reference data are not seeded yet. Open Developer → Refresh districts + transit once so every player uses the same bus geometry.');
  }
  function matchingBusFeatures(refs){const wanted=new Set((refs||[]).map(r=>String(r).toUpperCase()));return (state.mapData?.busLines||[]).filter(f=>(f.properties?.routeRefs||[]).some(r=>wanted.has(String(r).toUpperCase())));}
""","""  async function ensureBusLines(possible=state.possibleArea,bufferM=BUS_TENTACLE_SEARCH_BUFFER_M){
    const tiles=refreshTilesForGeometry(possible,bufferM);if(!tiles.length)throw new Error('Could not determine transit tiles for the remaining Endgame area.');
    const rows=await referenceChunkRowsForTiles(REF_RAW_TRANSIT_LINES,tiles);const have=new Set(rows.map(r=>r.dataset_key));const missing=tiles.filter(t=>!have.has(chunkDatasetKey(REF_RAW_TRANSIT_LINES,t.id)));
    if(missing.length)throw new Error(`Vienna bus data are missing ${missing.length} required transit tile${missing.length===1?'':'s'}. Open Developer → Refresh districts + transit; completed tiles are kept.`);
    const buses=normalizeOfficialBusLines(mergeFeatureCollections(rows));if(!buses.length)throw new Error('The required transit tiles contain no usable Vienna bus geometry.');
    state.mapData.busLines=buses;return buses;
  }
  function matchingBusFeatures(refs,features=state.mapData?.busLines||[]){const wanted=new Set((refs||[]).map(r=>String(r).toUpperCase()));return (features||[]).filter(f=>(f.properties?.routeRefs||[]).some(r=>wanted.has(String(r).toUpperCase())));}
  function busFeaturesForArea(possible,refs,bufferM=BUS_TENTACLE_SEARCH_BUFFER_M){
    let search=possible;try{search=turf.buffer(possible,Number(bufferM)/1000,{units:'kilometers',steps:16});}catch(_){}
    return matchingBusFeatures(refs).filter(f=>{try{return turf.booleanIntersects(f,search);}catch(_){return false;}});
  }
""",'bus tile loader')
one("""  function busFeatureGroups(refs){
    const wanted=[...new Set((refs||[]).map(r=>String(r).toUpperCase()))],groups=new Map(wanted.map(r=>[r,[]]));
    for(const f of state.mapData?.busLines||[])for(const r of f.properties?.routeRefs||[]){const key=String(r).toUpperCase();if(groups.has(key))groups.get(key).push(f);}
    return groups;
  }
""","""  function busFeatureGroups(refs,features=state.mapData?.busLines||[]){
    const wanted=[...new Set((refs||[]).map(r=>String(r).toUpperCase()))],groups=new Map(wanted.map(r=>[r,[]]));
    for(const f of features||[])for(const r of f.properties?.routeRefs||[]){const key=String(r).toUpperCase();if(groups.has(key))groups.get(key).push(f);}
    return groups;
  }
""",'bus groups')
one("""  function nearestBusLineToPoint(point,refs){
    const groups=busFeatureGroups(refs);let best=null,bestD=Infinity;
""","""  function nearestBusLineToPoint(point,refs,features=state.mapData?.busLines||[]){
    const groups=busFeatureGroups(refs,features);let best=null,bestD=Infinity;
""",'nearest bus optional features')
one("""  function busLineNearestRegion(possible,selectedRef,refs){
    if(!possible||!selectedRef)return null;const all=[...new Set((refs||[]).map(r=>String(r).toUpperCase()))];const selected=String(selectedRef).toUpperCase();if(!all.includes(selected))return null;
    const groups=busFeatureGroups(all);if(!(groups.get(selected)||[]).length)return null;
""","""  function busLineNearestRegion(possible,selectedRef,refs,features=state.mapData?.busLines||[]){
    if(!possible||!selectedRef)return null;const all=[...new Set((refs||[]).map(r=>String(r).toUpperCase()))];const selected=String(selectedRef).toUpperCase();if(!all.includes(selected))return null;
    const groups=busFeatureGroups(all,features);if(!(groups.get(selected)||[]).length)return null;
""",'bus region optional features')
one("""  function showBusLinePreview(refs,selectedRef=null){
    state.mapLayers.pendingBusLines?.remove();state.mapLayers.pendingBusLines=null;const features=matchingBusFeatures(refs);if(!features.length||!state.gameMap)return;
""","""  function showBusLinePreview(refs,selectedRef=null,features=state.mapData?.busLines||[]){
    state.mapLayers.pendingBusLines?.remove();state.mapLayers.pendingBusLines=null;features=matchingBusFeatures(refs,features);if(!features.length||!state.gameMap)return;
""",'bus preview optional features')
one("""  function showBusLineRegionPreview(possible,selectedRef,refs){
    state.mapLayers.pendingBusRegion?.remove();state.mapLayers.pendingBusRegion=null;const g=busLineNearestRegion(possible,selectedRef,refs);if(!g||!state.gameMap)return;
""","""  function showBusLineRegionPreview(possible,selectedRef,refs,features=state.mapData?.busLines||[]){
    state.mapLayers.pendingBusRegion?.remove();state.mapLayers.pendingBusRegion=null;const g=busLineNearestRegion(possible,selectedRef,refs,features);if(!g||!state.gameMap)return;
""",'bus region preview optional features')

one("""    if(card.kind==='bus_line_tentacle'){
      cancelQuestionPreview();await ensureBusLines();const bufferM=Number(card.search_buffer_m||BUS_TENTACLE_SEARCH_BUFFER_M),refs=busTentacleCandidates(state.possibleArea,bufferM);
      if(!refs.length)return toast(`No Vienna bus line crosses or comes within ${Math.round(bufferM)} m of the remaining Endgame area.`);
      showBusLinePreview(refs);const payload={slot_key:card.slot,question_kind:'bus_line_tentacle',title:card.title,search_buffer_m:bufferM,candidate_line_refs:refs};
""","""    if(card.kind==='bus_line_tentacle'){
      cancelQuestionPreview();const bufferM=Number(card.search_buffer_m||BUS_TENTACLE_SEARCH_BUFFER_M);await ensureBusLines(state.possibleArea,bufferM);const refs=busTentacleCandidates(state.possibleArea,bufferM);
      if(!refs.length)return toast(`No Vienna bus line crosses or comes within ${Math.round(bufferM)} m of the remaining Endgame area.`);
      const busFeatures=busFeaturesForArea(state.possibleArea,refs,bufferM);showBusLinePreview(refs,null,busFeatures);const payload={slot_key:card.slot,question_kind:'bus_line_tentacle',title:card.title,search_buffer_m:bufferM,candidate_line_refs:refs,bus_features:busFeatures};
""",'bus question payload')
one("""      const refs=p.candidate_line_refs||[],best=nearestBusLineToPoint(target,refs);if(!best)return {type:'bus_line_tentacle',status:'unavailable',text:'No candidate bus line geometry is available.'};
""","""      const refs=p.candidate_line_refs||[],best=nearestBusLineToPoint(target,refs,p.bus_features||[]);if(!best)return {type:'bus_line_tentacle',status:'unavailable',text:'No candidate bus line geometry is available.'};
""",'bus suggested answer')
one("""      if(answer?.status==='line'&&answer.line_ref){const region=busLineNearestRegion(possible,answer.line_ref,p.candidate_line_refs||[]);if(!region)return possible;return invert?safeDifference(possible,region):region;}return possible;
""","""      if(answer?.status==='line'&&answer.line_ref){const region=busLineNearestRegion(possible,answer.line_ref,p.candidate_line_refs||[],p.bus_features||[]);if(!region)return possible;return invert?safeDifference(possible,region):region;}return possible;
""",'bus apply constraint')
one("""    if(p.question_kind==='tentacle'){showPoiPreview(p.pois||[]);if(p.origin)showTentacleRangePreview(p.origin);const s=suggestedAnswer(q);if(s?.status==='poi')showTentacleCellPreview(q,s.poi);}else if(p.question_kind==='bus_line_tentacle'){const s=suggestedAnswer(q);showBusLinePreview(p.candidate_line_refs||[],s?.line_ref||null);if(s?.status==='line')showBusLineRegionPreview(state.possibleArea,s.line_ref,p.candidate_line_refs||[]);}else previewQuestionGeometry(p);
""","""    if(p.question_kind==='tentacle'){showPoiPreview(p.pois||[]);if(p.origin)showTentacleRangePreview(p.origin);const s=suggestedAnswer(q);if(s?.status==='poi')showTentacleCellPreview(q,s.poi);}else if(p.question_kind==='bus_line_tentacle'){const s=suggestedAnswer(q);showBusLinePreview(p.candidate_line_refs||[],s?.line_ref||null,p.bus_features||[]);}else previewQuestionGeometry(p);
""",'pending bus preview')

one("""  async function reloadGameState(){
    await reloadGamePublic();await reloadActions();processActionNotifications();
    if(state.developerPreview&&state.role==='hider')await reloadDeveloperHiderPreview();
    else {if(state.role==='hider')await refreshHiderSecret();await reloadHiderPrivate();}
    deriveLocalState();await recomputePossibleArea();renderAll();
  }
""","""  async function reloadGameStateOnce(){
    await reloadGamePublic();await reloadActions();processActionNotifications();
    if(state.developerPreview&&state.role==='hider')await reloadDeveloperHiderPreview();
    else {if(state.role==='hider')await refreshHiderSecret();await reloadHiderPrivate();}
    deriveLocalState();await recomputePossibleArea();renderAll();
  }
  function reloadGameState(){
    if(state.reloadPromise){state.reloadQueued=true;return state.reloadPromise;}
    state.reloadPromise=(async()=>{do{state.reloadQueued=false;await reloadGameStateOnce();}while(state.reloadQueued);})().finally(()=>{state.reloadPromise=null;});
    return state.reloadPromise;
  }
""",'serialized reload')

p.write_text(s,encoding='utf-8')
