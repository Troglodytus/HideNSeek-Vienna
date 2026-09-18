from pathlib import Path
import re

APP=Path('app.js'); IDX=Path('index.html'); CSS=Path('styles.css'); SQL=Path('supabase-v3.13.5-migration.sql')
s=APP.read_text()

def once(old,new,label):
    global s
    n=s.count(old)
    if n!=1: raise SystemExit(f'{label}: expected 1 exact match, got {n}')
    s=s.replace(old,new,1)

def sub_once(pattern,repl,label,flags=0):
    global s
    s2,n=re.subn(pattern,lambda m:repl,s,count=1,flags=flags)
    if n!=1: raise SystemExit(f'{label}: expected 1 regex match, got {n}')
    s=s2

once(
"  function renderQuestionDeck(){\n    const cardsAll=",
"  function renderQuestionDeck(){\n    if(document.activeElement?.matches?.('#questionDeck [data-same-line-select]')){state.questionDeckRefreshPending=true;return;}state.questionDeckRefreshPending=false;\n    const cardsAll=",
"protect open same-line select"
)

once(
"    developerPassword:null,referenceMeta:{},sameLineSelection:null,developerCards:[],developerQuestions:[],developerPlayers:[],developerPlayerRuns:[],questionCards:DEFAULT_QUESTION_CARDS.map(x=>({...x})),curseMapSignature:null,turntablesPickMode:false,turntablesCandidate:null,developerPreview:false,developerPreviewRole:null,passierscheinWasActive:false,lastTurntablesFrozen:false,",
"    developerPassword:null,referenceMeta:{},sameLineSelection:null,developerCards:[],developerQuestions:[],developerPlayers:[],developerPlayerRuns:[],mapManualItems:[],mapManualItemsLoaded:false,developerMap:null,developerMapLayer:null,developerMapSelection:null,developerMapAddMode:null,developerMapDraftCoords:[],developerMapDraftLayer:null,developerMapCategory:'station',developerMapLoaded:false,questionDeckRefreshPending:false,questionCards:DEFAULT_QUESTION_CARDS.map(x=>({...x})),curseMapSignature:null,turntablesPickMode:false,turntablesCandidate:null,developerPreview:false,developerPreviewRole:null,passierscheinWasActive:false,lastTurntablesFrozen:false,",
"map editor state"
)

manual_helpers = r'''
  async function loadMapManualItems(force=false){
    if(state.mapManualItemsLoaded&&!force)return state.mapManualItems;
    try{
      const {data,error}=await state.supabase.rpc('list_map_manual_items_v1');
      if(error)throw error;state.mapManualItems=data||[];state.mapManualItemsLoaded=true;return state.mapManualItems;
    }catch(e){
      console.warn('Manual map edits unavailable; continuing with reference cache only.',e);
      state.mapManualItems=[];state.mapManualItemsLoaded=true;return state.mapManualItems;
    }
  }
  function manualMapItems(category){return (state.mapManualItems||[]).filter(x=>x.enabled!==false&&x.category===category);}
  function manualMapItemById(id){return (state.mapManualItems||[]).find(x=>String(x.item_id)===String(id))||null;}
  function stationMapSourceKey(st){return String(st?.properties?.mapSourceKey??st?.properties?.stationId??'');}
  function transitMapSourceKey(f){return String(f?.properties?.mapSourceKey||stableFeatureKey(f));}
  function applyManualStationEdits(stations){
    const rows=manualMapItems('station'),by=new Map(rows.filter(x=>x.source_key).map(x=>[String(x.source_key),x])),out=[];
    for(const st0 of stations||[]){
      const key=stationMapSourceKey(st0),edit=by.get(key),st=JSON.parse(JSON.stringify(st0)),p=st.properties||{};
      const coords=st.geometry?.coordinates||[];let lng=Number(coords[0]),lat=Number(coords[1]);
      if(edit&&Number.isFinite(Number(edit.lng))&&Number.isFinite(Number(edit.lat))){lng=Number(edit.lng);lat=Number(edit.lat);}
      const refs=Array.isArray(edit?.properties?.line_refs)?edit.properties.line_refs:(p.lineRefs||[]);
      st.geometry={type:'Point',coordinates:[lng,lat]};st.properties={...p,stationName:edit?.name||p.stationName||'Station',lineRefs:[...new Set((refs||[]).map(String).filter(Boolean))],mapSourceKey:key,mapEditId:edit?.item_id||null,manualMap:!!edit};
      out.push(st);
    }
    for(const edit of rows.filter(x=>!x.source_key)){
      if(!Number.isFinite(Number(edit.lat))||!Number.isFinite(Number(edit.lng)))continue;
      const refs=Array.isArray(edit.properties?.line_refs)?edit.properties.line_refs:[];
      out.push(turf.point([Number(edit.lng),Number(edit.lat)],{stationName:edit.name||'Manual station',stationId:`manual:${edit.item_id}`,lineRefs:[...new Set(refs.map(String).filter(Boolean))],railway:'rail',mapSourceKey:null,mapEditId:edit.item_id,manualMap:true}));
    }
    return out;
  }
  function transitEditType(edit,base){
    return String(edit?.properties?.transit_type||base?.properties?.transitMode||base?.properties?.railway||'passenger-rail').toLowerCase();
  }
  function applyManualTransitEdits(lines,scope='rail'){
    const rows=manualMapItems('transit'),by=new Map(rows.filter(x=>x.source_key).map(x=>[String(x.source_key),x])),out=[];
    const keepType=t=>scope==='bus'?t==='bus':t!=='bus';
    for(const f0 of lines||[]){
      const key=transitMapSourceKey(f0),edit=by.get(key),f=JSON.parse(JSON.stringify(f0)),type=transitEditType(edit,f0);if(!keepType(type))continue;
      const baseRefs=f.properties?.routeRefs||[];const refs=Array.isArray(edit?.properties?.route_refs)?edit.properties.route_refs:baseRefs;
      const geom=edit?.geometry&&['LineString','MultiLineString'].includes(edit.geometry.type)?edit.geometry:f.geometry;
      const colour=edit?.properties?.route_colour||f.properties?.routeColour||(type==='bus'?'#ef4444':'#475569');
      f.geometry=geom;f.properties={...(f.properties||{}),railway:type,transitMode:type==='bus'?'bus':(f.properties?.transitMode||type),routeRefs:[...new Set((refs||[]).map(String).filter(Boolean))],routeRef:String((refs||[])[0]||''),routeName:edit?.name||edit?.properties?.route_name||f.properties?.routeName||String((refs||[]).join(', ')),routeColour:colour,mapSourceKey:key,mapEditId:edit?.item_id||null,manualMap:!!edit};
      out.push(f);
    }
    for(const edit of rows.filter(x=>!x.source_key)){
      const type=transitEditType(edit,null);if(!keepType(type)||!edit.geometry||!['LineString','MultiLineString'].includes(edit.geometry.type))continue;
      const refs=Array.isArray(edit.properties?.route_refs)?edit.properties.route_refs:[];
      out.push({type:'Feature',geometry:edit.geometry,properties:{railway:type,transitMode:type==='bus'?'bus':type,routeRefs:[...new Set(refs.map(String).filter(Boolean))],routeRef:String(refs[0]||''),routeName:edit.name||edit.properties?.route_name||String(refs.join(', '))||'Manual transit line',routeColour:edit.properties?.route_colour||(type==='bus'?'#ef4444':'#475569'),source:'Developer map',mapSourceKey:null,mapEditId:edit.item_id,manualMap:true}});
    }
    return out;
  }
  function applyManualPoiEdits(type,pois){
    const rows=manualMapItems(type),by=new Map(rows.filter(x=>x.source_key).map(x=>[String(x.source_key),x])),out=[];
    for(const p0 of pois||[]){
      const key=String(p0._mapSourceKey??p0.id??''),edit=by.get(key),p={...p0};
      if(edit){p.name=edit.name||p.name;if(Number.isFinite(Number(edit.lat)))p.lat=Number(edit.lat);if(Number.isFinite(Number(edit.lng)))p.lng=Number(edit.lng);p._mapEditId=edit.item_id;}
      p._mapSourceKey=key;out.push(p);
    }
    for(const edit of rows.filter(x=>!x.source_key)){
      if(!Number.isFinite(Number(edit.lat))||!Number.isFinite(Number(edit.lng)))continue;
      out.push({id:`manual:${edit.item_id}`,name:edit.name||`Manual ${humanize(type)}`,lat:Number(edit.lat),lng:Number(edit.lng),_mapSourceKey:null,_mapEditId:edit.item_id});
    }
    return out;
  }

'''
once("  function validateDistricts(districts){", manual_helpers+"  function validateDistricts(districts){", "manual map helpers")

once(
"    if(!validateReferenceCore(admin,stations))return false;\n    state.mapData={city:admin.city,districts:admin.districts,stations:applyManualStationLineOverrides(stations.stations),railLines:Array.isArray(transit?.railLines)?transit.railLines:[]};",
"    if(!validateReferenceCore(admin,stations))return false;\n    await loadMapManualItems();\n    state.mapData={city:admin.city,districts:admin.districts,stations:applyManualStationEdits(applyManualStationLineOverrides(stations.stations)),railLines:applyManualTransitEdits(Array.isArray(transit?.railLines)?transit.railLines:[],'rail')};",
"apply manual core edits"
)
once(
"          state.mapData=cached;state.mapData.railLines=state.mapData.railLines||[];loadRailLinesInBackground(false);return state.mapData;",
"          await loadMapManualItems();state.mapData=cached;state.mapData.stations=applyManualStationEdits(applyManualStationLineOverrides(state.mapData.stations||[]));state.mapData.railLines=applyManualTransitEdits(state.mapData.railLines||[],'rail');loadRailLinesInBackground(false);return state.mapData;",
"manual cached fallback"
)
once("state.mapData.railLines=ref.railLines;refreshRailLayers();return;","state.mapData.railLines=applyManualTransitEdits(ref.railLines,'rail');refreshRailLayers();return;","manual background ref rail")
once("state.mapData.railLines=cached;refreshRailLayers();return;","state.mapData.railLines=applyManualTransitEdits(cached,'rail');refreshRailLayers();return;","manual background cached rail")
once("state.mapData.railLines=lines;localStorage.setItem(RAIL_CACHE_KEY,JSON.stringify(lines));","state.mapData.railLines=applyManualTransitEdits(lines,'rail');localStorage.setItem(RAIL_CACHE_KEY,JSON.stringify(lines));","manual background fetched rail")
once(
"    const buses=normalizeOfficialBusLines(mergeFeatureCollections(rows));if(!buses.length)throw new Error('The cached Vienna transit tiles contain no usable bus-line geometry. Refresh districts + transit once.');",
"    await loadMapManualItems();const buses=applyManualTransitEdits(normalizeOfficialBusLines(mergeFeatureCollections(rows)),'bus');if(!buses.length)throw new Error('The cached Vienna transit tiles contain no usable bus-line geometry. Refresh districts + transit once.');",
"manual bus edits"
)

sub_once(
r"  async function loadPoiType\(type\)\{.*?\n  \}\n  function parsePoiElements",
r'''  async function loadPoiType(type){
    if(state.poiCache[type])return state.poiCache[type];
    await loadMapManualItems();
    const sourceTypes=type==='zoo'?['zoo','aquarium']:[type],objects=[],seen=new Set();
    for(const sourceType of sourceTypes){
      let pois=null;
      try{const ref=await referenceDataset(REF_POI_PREFIX+sourceType+'_v1');if(Array.isArray(ref?.pois))pois=ref.pois;}catch(e){console.warn('POI reference lookup failed',sourceType,e);}
      if(!pois){const cached=localStorage.getItem(POI_CACHE_PREFIX+sourceType);if(cached){try{const obj=JSON.parse(cached);if(Array.isArray(obj.pois))pois=obj.pois;}catch(_){}}}
      for(const p of pois||[]){const key=String(p.id||`${Number(p.lat).toFixed(6)},${Number(p.lng).toFixed(6)},${p.name||''}`);if(seen.has(key))continue;seen.add(key);objects.push({...p,_mapSourceKey:key});}
    }
    const edited=applyManualPoiEdits(type,objects);
    if(edited.length){
      const merged=edited.map(p=>turf.point([Number(p.lng),Number(p.lat)],{poiId:p.id,poiName:p.name,poiType:type,sourcePoiType:type,mapSourceKey:p._mapSourceKey??null,mapEditId:p._mapEditId??null,manualMap:!!p._mapEditId}));
      state.poiCache[type]=merged;return merged;
    }
    throw new Error(`${humanize(type)} reference data are not fully seeded in Supabase. Open Developer and refresh that category.`);
  }
  function parsePoiElements''',
"manual POIs",
flags=re.S
)

sub_once(
r"  function setSeekerPointDisplay\(origin\)\{.*?\n  \}\n\n  function ownLocationIcon",
r'''  function setSeekerPointDisplay(origin){
    state.seekerPoint=origin?turf.point([origin.lng,origin.lat]):null;state.seekerAccuracyM=origin?.accuracy_m??null;state.seekerMarker?.remove();state.seekerAccuracyCircle?.remove();state.seekerMarker=null;state.seekerAccuracyCircle=null;
    if(!origin){$('seekerLocationStatus').textContent='No question location has been sent.';return;}
    const warn=origin.accuracy_m&&origin.accuracy_m>100;$('seekerLocationStatus').className=`status-box ${warn?'warn':'good'}`;$('seekerLocationStatus').textContent=`${origin.lat.toFixed(5)}, ${origin.lng.toFixed(5)} · ${origin.source==='gps'?`GPS ±${Math.round(origin.accuracy_m||0)} m`:'manual map location'}`;
  }

  function ownLocationIcon''',
"remove generic question-origin marker",
flags=re.S
)

sub_once(
r"  function renderTimeTraps\(\)\{.*?\n  \}\n\n  const SEEKER_CURSE_EFFECTS",
r'''  function renderTimeTraps(){
    if(state.role!=='hider')return;$('timeTraps').innerHTML=state.timeTraps.length?state.timeTraps.map(t=>{const autoValue=Number(t.current_bonus_minutes||t.bonus_minutes||t.base_bonus_minutes||5),base=Number(t.base_bonus_minutes||5),accrued=Math.max(0,autoValue-base);return `<div class="question-item ${t.trigger_active?'time-trap-triggered':'time-trap-armed'}"><strong>${escapeHtml(t.station_name)}</strong><div class="meta">${t.trigger_active?`Triggered · locked at ${Number(t.bonus_minutes||base)} min`:`Manual trigger: +${base} min · auto trigger now: +${autoValue} min${accrued?` (${base} base + ${accrued} accrued)`:''} · +5 every full 10 min · auto within 50 m`}</div><button class="${t.trigger_active?'secondary':'primary'} small full" data-trigger-trap="${t.id}" data-trap-active="${t.trigger_active?'false':'true'}">${t.trigger_active?'Undo trigger':`Trigger now (+${base} min)`}</button></div>`;}).join(''):'<div class="mini-status">No Time Traps placed.</div>';
    $('timeTraps').querySelectorAll('[data-trigger-trap]').forEach(b=>b.addEventListener('click',()=>{const t=state.timeTraps.find(x=>x.id===b.dataset.triggerTrap);if(t)triggerTimeTrap(t,b.dataset.trapActive==='true').catch(handleError);}));
  }

  const SEEKER_CURSE_EFFECTS''',
"time trap UI",
flags=re.S
)
sub_once(
r"  async function triggerTimeTrap\(trap,active=true\)\{.*?\n  \}\n\n  function currentEndgameRadius",
r'''  async function triggerTimeTrap(trap,active=true){
    const verb=active?'Trigger':'Undo trigger',base=Number(trap.base_bonus_minutes||5);const ok=await confirmAction(`${verb} Time Trap?`,`${trap.station_name}\n${active?`Manual trigger locks this trap at its base +${base} min. Accrued time is awarded only when a Seeker automatically triggers it within 50 m.`:'The bonus is removed; the clock marker stays on the map.'}`,verb,!active);if(!ok)return;
    const {error}=await state.supabase.rpc('set_time_trap_trigger_v3',{p_game_id:state.game.id,p_trap_id:trap.id,p_password:state.hiderPassword,p_active:active});if(error)throw error;await reloadGameState();
  }

  function currentEndgameRadius''',
"time trap confirm",
flags=re.S
)

dev_map_block = r'''
  function developerMapCategory(){return $('developerMapCategory')?.value||state.developerMapCategory||'station';}
  function clearDeveloperMapDraft(){
    state.developerMapDraftLayer?.remove();state.developerMapDraftLayer=null;state.developerMapDraftCoords=[];state.developerMapAddMode=null;
    $('developerMapFinishLine')?.classList.add('hidden');$('developerMapCancelAdd')?.classList.add('hidden');
  }
  function developerMapEditForSelection(sel){return sel?.editId?manualMapItemById(sel.editId):null;}
  function developerMapSelectionFromFeature(category,f){
    const p=f?.properties||{},editId=p.mapEditId||null,sourceKey=p.mapSourceKey??null,edit=editId?manualMapItemById(editId):null;
    if(category==='station'){const [lng,lat]=f.geometry.coordinates;return{category,editId,sourceKey,name:p.stationName||'Station',lat,lng,properties:{line_refs:p.lineRefs||[],notes:edit?.properties?.notes||''}};}
    if(category==='transit'){const refs=p.routeRefs||[];return{category,editId,sourceKey,name:p.routeName||refs.join(', ')||'Transit line',geometry:JSON.parse(JSON.stringify(f.geometry)),properties:{route_refs:refs,transit_type:p.transitMode||p.railway||'passenger-rail',route_colour:p.routeColour||'',notes:edit?.properties?.notes||''}};}
    const [lng,lat]=f.geometry.coordinates;return{category,editId,sourceKey:p.mapSourceKey??p.poiId??null,name:p.poiName||p.name||humanize(category),lat,lng,properties:{notes:edit?.properties?.notes||''}};
  }
  function renderDeveloperMapEditor(sel=state.developerMapSelection){
    const el=$('developerMapEditor');if(!el)return;
    if(!sel){el.innerHTML='<div class="status-box">Click an item on the map, or use <strong>Add new</strong>.</div>';return;}
    const manual=!!sel.editId,source=sel.sourceKey?'Reference item':'Manual item';
    if(sel.category==='transit'){
      const refs=(sel.properties?.route_refs||[]).join(', '),type=sel.properties?.transit_type||'passenger-rail',points=sel.geometry?.type==='LineString'?(sel.geometry.coordinates?.length||0):(sel.geometry?.coordinates||[]).reduce((n,x)=>n+(x?.length||0),0);
      el.innerHTML=`<div class="developer-map-form"><div class="row-between"><strong>${escapeHtml(source)}</strong><span class="mini-status">${points} geometry points</span></div><label>Name<input id="developerMapName" maxlength="120" value="${escapeHtml(sel.name||'')}"></label><label>Line/ref(s), comma separated<input id="developerMapRefs" value="${escapeHtml(refs)}" placeholder="e.g. U4 or 13A"></label><label>Transit type<select id="developerMapTransitType"><option value="bus" ${type==='bus'?'selected':''}>Bus</option><option value="subway" ${type==='subway'?'selected':''}>U-Bahn</option><option value="s-bahn" ${type==='s-bahn'?'selected':''}>S-Bahn</option><option value="passenger-rail" ${!['bus','subway','s-bahn'].includes(type)?'selected':''}>Passenger rail</option></select></label><label>Line colour<input id="developerMapColour" value="${escapeHtml(sel.properties?.route_colour||'')}" placeholder="#ef4444"></label><label>Details / notes<textarea id="developerMapNotes" maxlength="1000">${escapeHtml(sel.properties?.notes||'')}</textarea></label><div class="developer-map-form-actions"><button class="primary" data-save-map-item>Save</button>${manual?`<button class="danger" data-delete-map-item>${sel.sourceKey?'Revert override':'Delete manual line'}</button>`:''}</div></div>`;
    }else{
      const station=sel.category==='station',refs=station?(sel.properties?.line_refs||[]).join(', '):'';
      el.innerHTML=`<div class="developer-map-form"><div class="row-between"><strong>${escapeHtml(source)}</strong><span class="mini-status">${escapeHtml(humanize(sel.category))}</span></div><label>Name<input id="developerMapName" maxlength="120" value="${escapeHtml(sel.name||'')}"></label>${station?`<label>U-/S-Bahn refs, comma separated<input id="developerMapRefs" value="${escapeHtml(refs)}" placeholder="e.g. U1, U3"></label>`:''}<div class="developer-map-coordinate-grid"><label>Latitude<input id="developerMapLat" type="number" step="0.000001" value="${Number(sel.lat).toFixed(6)}"></label><label>Longitude<input id="developerMapLng" type="number" step="0.000001" value="${Number(sel.lng).toFixed(6)}"></label></div><label>Details / notes<textarea id="developerMapNotes" maxlength="1000">${escapeHtml(sel.properties?.notes||'')}</textarea></label><div class="developer-map-form-actions"><button class="primary" data-save-map-item>Save</button>${manual?`<button class="danger" data-delete-map-item>${sel.sourceKey?'Revert override':'Delete manual item'}</button>`:''}</div></div>`;
    }
    el.querySelector('[data-save-map-item]')?.addEventListener('click',()=>saveDeveloperMapItem().catch(handleError));
    el.querySelector('[data-delete-map-item]')?.addEventListener('click',()=>deleteDeveloperMapItem().catch(handleError));
  }
  function selectDeveloperMapFeature(category,f){
    state.developerMapSelection=developerMapSelectionFromFeature(category,f);renderDeveloperMapEditor();$('developerMapStatus').textContent=`Selected ${state.developerMapSelection.name}`;
  }
  async function renderDeveloperMap(){
    if(!state.developerMap)return;const category=developerMapCategory();state.developerMapCategory=category;state.developerMapLayer?.remove();state.developerMapLayer=null;state.developerMapSelection=null;renderDeveloperMapEditor(null);
    const group=L.layerGroup(),status=$('developerMapStatus');status.textContent=`Loading ${humanize(category)}…`;
    if(category==='station'){
      for(const f of state.mapData?.stations||[]){const [lng,lat]=f.geometry.coordinates;L.marker([lat,lng],{icon:stationDivIcon(f)}).bindTooltip(`${f.properties?.stationName||'Station'}${f.properties?.lineRefs?.length?` · ${f.properties.lineRefs.join(', ')}`:''}`).on('click',()=>selectDeveloperMapFeature(category,f)).addTo(group);}
    }else if(category==='transit'){
      let bus=[];try{bus=await ensureBusLines(state.mapData.city,0);}catch(e){console.warn('Developer bus layer unavailable',e);}
      for(const f of [...(state.mapData?.railLines||[]),...bus]){
        const isBus=(f.properties?.transitMode||f.properties?.railway)==='bus',style=isBus?{color:f.properties?.routeColour||'#ef4444',weight:4,opacity:.72}:mapGeoStyle('rail',f);
        L.geoJSON(f,{style,interactive:true,onEachFeature:(ff,l)=>l.bindTooltip(`${(ff.properties?.routeRefs||[]).join(', ')||ff.properties?.routeName||'Transit'}`).on('click',()=>selectDeveloperMapFeature(category,ff))}).addTo(group);
      }
    }else{
      const pois=await loadPoiType(category);for(const f of pois){const [lng,lat]=f.geometry.coordinates;L.circleMarker([lat,lng],{radius:6,weight:2,fillOpacity:.7}).bindTooltip(f.properties?.poiName||humanize(category)).on('click',()=>selectDeveloperMapFeature(category,f)).addTo(group);}
    }
    group.addTo(state.developerMap);state.developerMapLayer=group;status.textContent=`${group.getLayers().length} ${humanize(category)} item${group.getLayers().length===1?'':'s'} · click to edit`;
  }
  async function setupDeveloperMap(){
    if(!state.developerPassword)return;await ensureMapData();await loadMapManualItems(true);
    if(!state.developerMap){
      state.developerMap=L.map('developerMap',baseMapOptions());addBaseTiles(state.developerMap);state.developerMap.on('click',e=>handleDeveloperMapClick(e.latlng));
    }
    state.developerMap.invalidateSize(false);
    if(!state.developerMapLoaded){state.developerMap.fitBounds(L.geoJSON(state.mapData.city).getBounds(),{padding:[8,8],animate:false});state.developerMapLoaded=true;}
    await renderDeveloperMap();
  }
  function beginDeveloperMapAdd(){
    clearDeveloperMapDraft();state.developerMapSelection=null;renderDeveloperMapEditor(null);const category=developerMapCategory();
    if(category==='transit'){state.developerMapAddMode='line';$('developerMapFinishLine').classList.remove('hidden');$('developerMapFinishLine').disabled=true;$('developerMapCancelAdd').classList.remove('hidden');$('developerMapStatus').textContent='New transit line: click at least two points on the map, then Finish line.';}
    else{state.developerMapAddMode='point';$('developerMapCancelAdd').classList.remove('hidden');$('developerMapStatus').textContent=`New ${humanize(category)}: click its position on the map.`;}
  }
  function handleDeveloperMapClick(latlng){
    if(!state.developerMapAddMode)return;const category=developerMapCategory();
    if(state.developerMapAddMode==='point'){
      state.developerMapSelection={category,editId:null,sourceKey:null,name:`New ${humanize(category)}`,lat:latlng.lat,lng:latlng.lng,properties:{line_refs:[],notes:''}};clearDeveloperMapDraft();renderDeveloperMapEditor();$('developerMapStatus').textContent='New item positioned · edit details and Save.';return;
    }
    state.developerMapDraftCoords.push([latlng.lng,latlng.lat]);state.developerMapDraftLayer?.remove();state.developerMapDraftLayer=L.polyline(state.developerMapDraftCoords.map(x=>[x[1],x[0]]),{color:'#7c3aed',weight:5,dashArray:'7 5'}).addTo(state.developerMap);$('developerMapFinishLine').disabled=state.developerMapDraftCoords.length<2;$('developerMapStatus').textContent=`New transit line · ${state.developerMapDraftCoords.length} points`;
  }
  function finishDeveloperMapLine(){
    if(state.developerMapAddMode!=='line'||state.developerMapDraftCoords.length<2)return;const coords=state.developerMapDraftCoords.slice();state.developerMapDraftLayer?.remove();state.developerMapDraftLayer=null;state.developerMapDraftCoords=[];state.developerMapAddMode=null;$('developerMapFinishLine').classList.add('hidden');$('developerMapCancelAdd').classList.add('hidden');
    state.developerMapSelection={category:'transit',editId:null,sourceKey:null,name:'New transit line',geometry:{type:'LineString',coordinates:coords},properties:{route_refs:[],transit_type:'bus',route_colour:'#ef4444',notes:''}};renderDeveloperMapEditor();$('developerMapStatus').textContent='New line drawn · edit details and Save.';
  }
  function cancelDeveloperMapAdd(){clearDeveloperMapDraft();state.developerMapSelection=null;renderDeveloperMapEditor(null);$('developerMapStatus').textContent='Add cancelled.';}
  async function saveDeveloperMapItem(){
    const sel=state.developerMapSelection;if(!sel)return;const name=$('developerMapName')?.value.trim();if(!name)return toast('Enter a name.');
    let lat=null,lng=null,geometry=null,properties={notes:$('developerMapNotes')?.value.trim()||''};
    if(sel.category==='transit'){
      const refs=($('developerMapRefs')?.value||'').split(',').map(x=>x.trim()).filter(Boolean);properties={...properties,route_refs:refs,route_name:name,transit_type:$('developerMapTransitType')?.value||'passenger-rail',route_colour:$('developerMapColour')?.value.trim()||null};geometry=sel.sourceKey?null:sel.geometry;
      if(!sel.sourceKey&&!geometry)throw new Error('A new transit line needs geometry.');
    }else{
      lat=Number($('developerMapLat')?.value);lng=Number($('developerMapLng')?.value);if(!Number.isFinite(lat)||!Number.isFinite(lng))throw new Error('Enter valid coordinates.');
      if(sel.category==='station')properties.line_refs=($('developerMapRefs')?.value||'').split(',').map(x=>x.trim().toUpperCase()).filter(Boolean);
    }
    const {data,error}=await state.supabase.rpc('admin_save_map_item_v1',{p_password:state.developerPassword,p_item_id:sel.editId||null,p_category:sel.category,p_source_key:sel.sourceKey||null,p_name:name,p_lat:lat,p_lng:lng,p_geometry:geometry,p_properties:properties});if(error)throw error;
    toast('Map item saved.');state.mapManualItemsLoaded=false;await loadMapManualItems(true);state.mapData=null;state.poiCache={};await ensureMapData();state.developerMapSelection=null;await renderDeveloperMap();
  }
  async function deleteDeveloperMapItem(){
    const sel=state.developerMapSelection;if(!sel?.editId)return;const label=sel.sourceKey?'Revert this manual override?':'Delete this manual map item?';const ok=await confirmAction(label,sel.name||'Map item',sel.sourceKey?'Revert':'Delete',true);if(!ok)return;
    const {error}=await state.supabase.rpc('admin_delete_map_item_v1',{p_password:state.developerPassword,p_item_id:sel.editId});if(error)throw error;
    state.mapManualItemsLoaded=false;await loadMapManualItems(true);state.mapData=null;state.poiCache={};await ensureMapData();state.developerMapSelection=null;await renderDeveloperMap();
  }

'''
once("  async function developerLogin(){",dev_map_block+"  async function developerLogin(){","developer map functions")

once(
"    $('developerQuestionsTab').classList.toggle('hidden',name!=='questions');\n    $('developerPlayersTab').classList.toggle('hidden',name!=='players');",
"    $('developerQuestionsTab').classList.toggle('hidden',name!=='questions');\n    $('developerMapTab').classList.toggle('hidden',name!=='map');\n    $('developerPlayersTab').classList.toggle('hidden',name!=='players');\n    if(name==='map')setTimeout(()=>setupDeveloperMap().catch(handleError),0);",
"map tab visibility"
)

once(
"    document.querySelectorAll('[data-origin-mode]').forEach(b=>b.addEventListener('click',()=>{state.seekerOriginMode=b.dataset.originMode;document.querySelectorAll('[data-origin-mode]').forEach(x=>x.classList.toggle('active',x===b));$('questionOriginStatus').textContent=state.seekerOriginMode==='gps'?'Automatic GPS':'Manual marker';}));",
"    document.querySelectorAll('[data-origin-mode]').forEach(b=>b.addEventListener('click',()=>{state.seekerOriginMode=b.dataset.originMode;document.querySelectorAll('[data-origin-mode]').forEach(x=>x.classList.toggle('active',x===b));$('questionOriginStatus').textContent=state.seekerOriginMode==='gps'?'Automatic GPS':'Manual marker';}));\n    $('questionDeck').addEventListener('focusout',e=>{if(e.target?.matches?.('[data-same-line-select]')&&state.questionDeckRefreshPending)setTimeout(()=>renderQuestionDeck(),0);});\n    $('developerMapCategory')?.addEventListener('change',()=>{clearDeveloperMapDraft();state.developerMapSelection=null;renderDeveloperMap().catch(handleError);});$('developerMapAddItem')?.addEventListener('click',beginDeveloperMapAdd);$('developerMapFinishLine')?.addEventListener('click',finishDeveloperMapLine);$('developerMapCancelAdd')?.addEventListener('click',cancelDeveloperMapAdd);",
"bind map editor and picker focus"
)

APP.write_text(s)

h=IDX.read_text()
old='''            <button class="segment" data-developer-tab="questions">Questions</button>
            <button class="segment" data-developer-tab="players">Players</button>'''
new='''            <button class="segment" data-developer-tab="questions">Questions</button>
            <button class="segment" data-developer-tab="map">Map</button>
            <button class="segment" data-developer-tab="players">Players</button>'''
if h.count(old)!=1: raise SystemExit('index map tab button mismatch')
h=h.replace(old,new,1)
marker='''

          <div id="developerPlayersTab" class="developer-tab-panel hidden">'''
panel='''

          <div id="developerMapTab" class="developer-tab-panel hidden">
            <section class="panel">
              <div class="row-between"><div><div class="eyebrow">MAP EDITOR</div><h3>Dynamic Vienna reference map</h3></div><span id="developerMapStatus" class="mini-status">Choose a category.</span></div>
              <div class="developer-map-toolbar">
                <label>Category<select id="developerMapCategory">
                  <option value="station">Stations</option>
                  <option value="transit">Transit lines</option>
                  <option value="museum">Tentacle · Museums</option>
                  <option value="park">Tentacle · Parks</option>
                  <option value="library">Tentacle · Libraries</option>
                  <option value="cinema">Tentacle · Cinemas</option>
                  <option value="hospital">Tentacle · Hospitals</option>
                  <option value="cemetery">Tentacle · Cemeteries</option>
                  <option value="church">Tentacle · Churches</option>
                  <option value="zoo">Tentacle · Zoos / aquariums</option>
                </select></label>
                <button id="developerMapAddItem" class="primary">Add new</button>
                <button id="developerMapFinishLine" class="primary hidden" disabled>Finish line</button>
                <button id="developerMapCancelAdd" class="secondary hidden">Cancel</button>
              </div>
              <p class="hint">Click an existing station, transit line, or Tentacle POI to override its details. Manual additions are stored separately from the official Vienna cache, so a later reference-data refresh does not erase them.</p>
              <div class="developer-map-layout">
                <div id="developerMap" class="map developer-map"></div>
                <div class="developer-map-side"><div id="developerMapEditor"><div class="status-box">Click an item on the map, or use <strong>Add new</strong>.</div></div></div>
              </div>
            </section>
          </div>'''
if h.count(marker)!=1: raise SystemExit('index map panel marker mismatch')
h=h.replace(marker,panel+marker,1)
IDX.write_text(h)

c=CSS.read_text()
css_add=r'''

/* v3.13.5 developer dynamic map editor */
.developer-map-toolbar{display:grid;grid-template-columns:minmax(220px,1fr) auto auto auto;gap:8px;align-items:end;margin:8px 0 12px}
.developer-map-toolbar label{margin:0}
.developer-map-layout{display:grid;grid-template-columns:minmax(0,1.65fr) minmax(280px,.75fr);gap:12px;align-items:start}
.developer-map{height:min(68vh,720px);min-height:480px;border:1px solid var(--line);border-radius:14px;overflow:hidden}
.developer-map-side{position:sticky;top:84px}
.developer-map-form{display:grid;gap:8px;border:1px solid var(--line);border-radius:13px;padding:12px;background:#fff}
.developer-map-form label{margin:0}
.developer-map-form textarea{min-height:84px;resize:vertical}
.developer-map-coordinate-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.developer-map-form-actions{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:4px}
@media(max-width:900px){.developer-map-layout{grid-template-columns:1fr}.developer-map-side{position:static}.developer-map-toolbar{grid-template-columns:1fr 1fr}.developer-map{height:52vh;min-height:390px}}
@media(max-width:520px){.developer-map-toolbar,.developer-map-form-actions,.developer-map-coordinate-grid{grid-template-columns:1fr}.developer-map{min-height:340px}}
'''
if '/* v3.13.5 developer dynamic map editor */' in c: raise SystemExit('css map editor already present')
CSS.write_text(c+css_add)

q=SQL.read_text()
old="    v_bonus:=public._time_trap_value_v4(v_trap.base_bonus_minutes,v_trap.armed_at,now());\n    update public.time_traps set triggered_at=now(),bonus_minutes=v_bonus,trigger_active=true where id=p_trap_id;"
new="    -- Manual trigger intentionally awards only the base value. Accrual belongs to the automatic 50 m trigger.\n    v_bonus:=coalesce(v_trap.base_bonus_minutes,5);\n    update public.time_traps set triggered_at=now(),bonus_minutes=v_bonus,trigger_active=true where id=p_trap_id;"
if q.count(old)!=1: raise SystemExit(f'manual trap SQL mismatch {q.count(old)}')
q=q.replace(old,new,1)

old_vor=r'''  if v_player is not null then
    select lat,lng into v_seeker_lat,v_seeker_lng from public.seeker_player_positions
      where game_id=p_game_id and player_id=v_player and updated_at>=now()-interval '20 seconds';
  end if;
  if v_seeker_lat is null or v_seeker_lng is null then
    select lat,lng into v_seeker_lat,v_seeker_lng from public.seeker_live_positions
      where game_id=p_game_id and updated_at>=now()-interval '20 seconds';
  end if;
  if v_seeker_lat is null or v_seeker_lng is null then
    v_seeker_lat:=nullif(v_q.payload#>>'{origin,lat}','')::double precision;
    v_seeker_lng:=nullif(v_q.payload#>>'{origin,lng}','')::double precision;
  end if;'''
new_vor=r'''  if v_player is not null then
    select lat,lng into v_seeker_lat,v_seeker_lng from public.seeker_player_positions
      where game_id=p_game_id and player_id=v_player and updated_at>=now()-interval '20 seconds';
    -- An identified VOR question may fall back only to its own asking origin,
    -- never to the legacy row which might currently belong to another Seeker.
    if v_seeker_lat is null or v_seeker_lng is null then
      v_seeker_lat:=nullif(v_q.payload#>>'{origin,lat}','')::double precision;
      v_seeker_lng:=nullif(v_q.payload#>>'{origin,lng}','')::double precision;
    end if;
  else
    select lat,lng into v_seeker_lat,v_seeker_lng from public.seeker_live_positions
      where game_id=p_game_id and updated_at>=now()-interval '20 seconds';
    if v_seeker_lat is null or v_seeker_lng is null then
      v_seeker_lat:=nullif(v_q.payload#>>'{origin,lat}','')::double precision;
      v_seeker_lng:=nullif(v_q.payload#>>'{origin,lng}','')::double precision;
    end if;
  end if;'''
if q.count(old_vor)!=1: raise SystemExit(f'vor fallback SQL mismatch {q.count(old_vor)}')
q=q.replace(old_vor,new_vor,1)

map_sql=r'''

-- ---------------------------------------------------------------------------
-- Developer dynamic map editor.
-- Manual additions/overrides are deliberately separate from official caches,
-- so refreshing Vienna datasets never destroys hand corrections.
-- ---------------------------------------------------------------------------
create table if not exists public.map_manual_items(
  id uuid primary key default gen_random_uuid(),
  category text not null check(category in ('station','transit','museum','park','library','cinema','hospital','cemetery','church','zoo')),
  source_key text,
  name text not null,
  lat double precision,
  lng double precision,
  geometry jsonb,
  properties jsonb not null default '{}'::jsonb,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists map_manual_items_source_unique
  on public.map_manual_items(category,source_key) where source_key is not null;
alter table public.map_manual_items enable row level security;
revoke all on public.map_manual_items from anon,authenticated;

create or replace function public.list_map_manual_items_v1()
returns table(item_id uuid,category text,source_key text,name text,lat double precision,lng double precision,geometry jsonb,properties jsonb,enabled boolean,created_at timestamptz,updated_at timestamptz)
language sql stable security definer set search_path=public as $$
  select m.id,m.category,m.source_key,m.name,m.lat,m.lng,m.geometry,m.properties,m.enabled,m.created_at,m.updated_at
  from public.map_manual_items m where m.enabled order by m.category,m.name;
$$;
grant execute on function public.list_map_manual_items_v1() to anon,authenticated;

create or replace function public.admin_save_map_item_v1(
  p_password text,p_item_id uuid,p_category text,p_source_key text,p_name text,
  p_lat double precision,p_lng double precision,p_geometry jsonb,p_properties jsonb
) returns uuid
language plpgsql security definer set search_path=public as $$
declare v_id uuid;v_props jsonb:=coalesce(p_properties,'{}'::jsonb);
begin
  if not public._admin_password_ok(p_password) then perform pg_sleep(.35);raise exception 'Invalid developer password.';end if;
  if p_category not in ('station','transit','museum','park','library','cinema','hospital','cemetery','church','zoo') then raise exception 'Invalid map category.';end if;
  if char_length(trim(coalesce(p_name,''))) not between 1 and 120 then raise exception 'Map item name must be 1-120 characters.';end if;
  if jsonb_typeof(v_props)<>'object' then raise exception 'Map item properties must be a JSON object.';end if;
  if p_category='transit' then
    if p_source_key is null and (p_geometry is null or coalesce(p_geometry->>'type','') not in ('LineString','MultiLineString')) then raise exception 'A new transit line needs LineString geometry.';end if;
    if p_geometry is not null and coalesce(p_geometry->>'type','') not in ('LineString','MultiLineString') then raise exception 'Transit geometry must be LineString or MultiLineString.';end if;
  else
    if p_lat is null or p_lng is null or p_lat not between 48.00 and 48.40 or p_lng not between 16.00 and 16.70 then raise exception 'Map point must be inside the Vienna editing guardrail.';end if;
  end if;

  if p_item_id is not null then
    update public.map_manual_items set category=p_category,source_key=nullif(p_source_key,''),name=trim(p_name),lat=p_lat,lng=p_lng,geometry=p_geometry,properties=v_props,enabled=true,updated_at=now()
    where id=p_item_id returning id into v_id;
    if v_id is null then raise exception 'Manual map item not found.';end if;
    return v_id;
  end if;

  if nullif(p_source_key,'') is not null then
    select id into v_id from public.map_manual_items where category=p_category and source_key=p_source_key for update;
    if v_id is not null then
      update public.map_manual_items set name=trim(p_name),lat=p_lat,lng=p_lng,geometry=p_geometry,properties=v_props,enabled=true,updated_at=now() where id=v_id;
      return v_id;
    end if;
  end if;

  insert into public.map_manual_items(category,source_key,name,lat,lng,geometry,properties)
  values(p_category,nullif(p_source_key,''),trim(p_name),p_lat,p_lng,p_geometry,v_props)
  returning id into v_id;
  return v_id;
end;$$;
grant execute on function public.admin_save_map_item_v1(text,uuid,text,text,text,double precision,double precision,jsonb,jsonb) to anon,authenticated;

create or replace function public.admin_delete_map_item_v1(p_password text,p_item_id uuid)
returns boolean language plpgsql security definer set search_path=public as $$
begin
  if not public._admin_password_ok(p_password) then perform pg_sleep(.35);raise exception 'Invalid developer password.';end if;
  delete from public.map_manual_items where id=p_item_id;return found;
end;$$;
grant execute on function public.admin_delete_map_item_v1(text,uuid) to anon,authenticated;
'''
if 'create table if not exists public.map_manual_items' in q: raise SystemExit('map SQL already present')
q=q.rstrip()+map_sql+'\n'
SQL.write_text(q)
