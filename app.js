(() => {
  'use strict';

  const CFG = window.HNS_CONFIG || {};
  const VIENNA_CENTER = [48.2082, 16.3738];
  const VIENNA_ZOOM = 12;
  const BASE_HIDE_RADIUS_M = 250;
  const TENTACLE_VALID_DISTANCE_M = 250;
  const CACHE_KEY = 'hns_vienna_osm_v4';
  const CACHE_TS_KEY = 'hns_vienna_osm_v4_ts';
  const POI_CACHE_PREFIX = 'hns_vienna_poi_v1_';

  const QUESTION_CARDS = [
    { slot:'radar-20000', category:'RADAR', title:'20 km Radar', detail:'Is the target within 20 km of this location?', kind:'radar', radius_m:20000 },
    { slot:'radar-10000', category:'RADAR', title:'10 km Radar', detail:'Is the target within 10 km of this location?', kind:'radar', radius_m:10000 },
    { slot:'radar-5000', category:'RADAR', title:'5 km Radar', detail:'Is the target within 5 km of this location?', kind:'radar', radius_m:5000 },
    { slot:'radar-1000', category:'RADAR', title:'1 km Radar', detail:'Is the target within 1 km of this location?', kind:'radar', radius_m:1000 },
    { slot:'radar-500', category:'RADAR', title:'500 m Radar', detail:'Is the target within 500 m of this location?', kind:'radar', radius_m:500 },
    { slot:'radar-100', category:'RADAR', title:'100 m Radar', detail:'Is the target within 100 m of this location?', kind:'radar', radius_m:100 },
    { slot:'thermo-250', category:'THERMOMETER', title:'250 m Thermometer', detail:'After travelling ≥250 m, are you warmer?', kind:'thermometer', min_travel_m:250 },
    { slot:'thermo-500', category:'THERMOMETER', title:'500 m Thermometer', detail:'After travelling ≥500 m, are you warmer?', kind:'thermometer', min_travel_m:500 },
    { slot:'thermo-2000', category:'THERMOMETER', title:'2 km Thermometer', detail:'After travelling ≥2 km, are you warmer?', kind:'thermometer', min_travel_m:2000 },
    { slot:'same-district', category:'MATCHING', title:'Same District', detail:'Are you in the same Vienna Bezirk?', kind:'district' },
    { slot:'tentacle-museums', category:'TENTACLES', title:'Museums', detail:'Which mapped museum in the remaining zone is the hider closest to?', kind:'tentacle', poi_type:'museum' },
    { slot:'tentacle-parks', category:'TENTACLES', title:'Parks', detail:'Which mapped park in the remaining zone is the hider closest to?', kind:'tentacle', poi_type:'park' },
    { slot:'tentacle-libraries', category:'TENTACLES', title:'Libraries', detail:'Which mapped library in the remaining zone is the hider closest to?', kind:'tentacle', poi_type:'library' },
    { slot:'tentacle-cinemas', category:'TENTACLES', title:'Movie Theaters', detail:'Which mapped cinema in the remaining zone is the hider closest to?', kind:'tentacle', poi_type:'cinema' },
    { slot:'tentacle-hospitals', category:'TENTACLES', title:'Hospitals', detail:'Which mapped hospital in the remaining zone is the hider closest to?', kind:'tentacle', poi_type:'hospital' },
    { slot:'tentacle-zoos', category:'TENTACLES', title:'Zoos', detail:'Which mapped zoo in the remaining zone is the hider closest to?', kind:'tentacle', poi_type:'zoo' },
    { slot:'tentacle-aquariums', category:'TENTACLES', title:'Aquariums', detail:'Which mapped aquarium in the remaining zone is the hider closest to?', kind:'tentacle', poi_type:'aquarium' },
    { slot:'tentacle-amusement', category:'TENTACLES', title:'Amusement Parks', detail:'Which mapped amusement park in the remaining zone is the hider closest to?', kind:'tentacle', poi_type:'amusement_park' }
  ];

  const POI_QUERIES = {
    museum: '["tourism"="museum"]',
    park: '["leisure"="park"]',
    library: '["amenity"="library"]',
    cinema: '["amenity"="cinema"]',
    hospital: '["amenity"="hospital"]',
    zoo: '["tourism"="zoo"]',
    aquarium: '["tourism"="aquarium"]',
    amusement_park: '["tourism"="theme_park"]'
  };

  const state = {
    supabase:null, mapData:null, createMap:null, gameMap:null, mapLayers:{},
    createStation:null, createPoint:null, createAccuracyM:null, createPickMode:false,
    role:null, game:null, hiderPassword:null, secret:null,
    actions:[], hiderDraws:[], timeTraps:[], privateCardUses:[],
    seekerOriginMode:'gps', seekerPoint:null, seekerAccuracyM:null, seekerMarker:null, seekerAccuracyCircle:null,
    thermoReference:null, pendingQuestionCard:null, pickMode:null, trapPlacementCard:null,
    possibleArea:null, baseAllowedArea:null, baseRadiusBuilt:null,
    poiCache:{}, tentaclePreview:null, pendingOverlay:null,
    realtimeChannel:null, timerId:null, pollId:null, serverOffsetMs:0,
    confirmResolver:null
  };

  const $ = id => document.getElementById(id);
  const views = ['homeView','lobbyView','gameView'];

  function showView(id) {
    views.forEach(v => $(v).classList.toggle('active', v === id));
    setTimeout(() => { state.createMap?.invalidateSize(); state.gameMap?.invalidateSize(); }, 80);
  }
  function toast(message, ms=3000) {
    const el=$('toast'); el.textContent=message; el.classList.add('show'); clearTimeout(toast._t); toast._t=setTimeout(()=>el.classList.remove('show'),ms);
  }
  function confirmAction(title,message,label='Confirm',danger=false) {
    return new Promise(resolve => {
      if (state.confirmResolver) state.confirmResolver(false);
      state.confirmResolver=resolve; $('confirmTitle').textContent=title; $('confirmMessage').textContent=message; $('confirmOk').textContent=label;
      $('confirmModal').querySelector('.modal-card').classList.toggle('danger',danger); $('confirmModal').classList.remove('hidden');
    });
  }
  function closeConfirm(value) { $('confirmModal').classList.add('hidden'); const r=state.confirmResolver; state.confirmResolver=null; r?.(value); }
  function escapeHtml(s) { return String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
  function handleError(e) { console.error(e); toast(e?.message || String(e), 5000); }

  function assertConfigured() {
    if (!CFG.SUPABASE_URL || !CFG.SUPABASE_ANON_KEY || CFG.SUPABASE_URL.includes('YOUR_PROJECT') || CFG.SUPABASE_ANON_KEY.includes('YOUR_')) throw new Error('Supabase is not configured yet. Edit config.js first.');
  }
  function initSupabaseIfNeeded() {
    if (state.supabase) return;
    assertConfigured();
    state.supabase=window.supabase.createClient(CFG.SUPABASE_URL,CFG.SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  }

  function baseMapOptions(){ return {center:VIENNA_CENTER,zoom:VIENNA_ZOOM,zoomControl:true,minZoom:10,maxZoom:19}; }
  function addBaseTiles(map){ L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>'}).addTo(map); }
  function isPolygon(f){ return f?.geometry && ['Polygon','MultiPolygon'].includes(f.geometry.type); }
  function safeArea(f){ try{return turf.area(f);}catch(_){return 0;} }
  function safeIntersect(a,b){ if(!a||!b)return null; try{return turf.intersect(turf.featureCollection([a,b]));}catch(e){console.warn('intersect',e);return null;} }
  function safeDifference(a,b){ if(!a)return null; if(!b)return a; try{return turf.difference(turf.featureCollection([a,b]));}catch(e){console.warn('difference',e);return a;} }
  function safeUnion(a,b){ if(!a)return b; if(!b)return a; try{return turf.union(turf.featureCollection([a,b]))||a;}catch(_){return a;} }

  async function ensureMapData(force=false) {
    if (state.mapData && !force) return state.mapData;
    const ttl=(Number(CFG.OSM_CACHE_HOURS)||168)*3600e3;
    const ts=Number(localStorage.getItem(CACHE_TS_KEY)||0);
    if (!force && Date.now()-ts<ttl) {
      try { const cached=JSON.parse(localStorage.getItem(CACHE_KEY)); if(cached?.features?.length){ state.mapData=processOsmGeoJSON(cached); return state.mapData; } } catch(_){}
    }
    const endpoint=CFG.OVERPASS_ENDPOINT||'https://overpass-api.de/api/interpreter';
    const query=`[out:json][timeout:90];
area["boundary"="administrative"]["admin_level"="4"]["name"="Wien"]->.vienna;
(
 relation["boundary"="administrative"]["admin_level"="4"]["name"="Wien"];
 relation(area.vienna)["boundary"="administrative"]["admin_level"="9"];
 nwr(area.vienna)["railway"~"^(station|halt)$"]["access"!="private"];
 way(area.vienna)["railway"~"^(rail|subway)$"];
);
out body;>;out skel qt;`;
    toast('Loading Vienna districts, stations and rail lines…',5000);
    const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'},body:'data='+encodeURIComponent(query)});
    if(!response.ok)throw new Error(`Overpass returned HTTP ${response.status}.`);
    const osm=await response.json(); const geo=osmtogeojson(osm);
    localStorage.setItem(CACHE_KEY,JSON.stringify(geo)); localStorage.setItem(CACHE_TS_KEY,String(Date.now()));
    state.mapData=processOsmGeoJSON(geo); return state.mapData;
  }

  function processOsmGeoJSON(geo) {
    const features=geo.features||[];
    const city=features.filter(f=>{const t=f.properties?.tags||{};return t.boundary==='administrative'&&t.admin_level==='4'&&t.name==='Wien'&&isPolygon(f);}).sort((a,b)=>safeArea(b)-safeArea(a))[0];
    if(!city)throw new Error('Could not identify the Vienna boundary.');
    const districts=features.filter(f=>{const t=f.properties?.tags||{};return t.boundary==='administrative'&&t.admin_level==='9'&&isPolygon(f);}).map(f=>({feature:f,number:districtNumber(f.properties?.tags||{}),name:(f.properties?.tags||{}).name||'District'})).filter(d=>d.number>=1&&d.number<=23);
    const stations=features.filter(f=>['station','halt'].includes(f.properties?.tags?.railway)).map((f,i)=>{
      const p=f.geometry?.type==='Point'?JSON.parse(JSON.stringify(f)):turf.centroid(f); const tags=f.properties?.tags||{};
      p.properties={...(p.properties||{}),stationName:tags.name||'Unnamed station',stationId:String(f.id||`station-${i}`),railway:tags.railway,subway:tags.subway||null}; return p;
    });
    const seen=new Set();
    const deduped=stations.filter(s=>{const [lng,lat]=s.geometry.coordinates;const k=`${s.properties.stationName}|${lat.toFixed(5)}|${lng.toFixed(5)}`;if(seen.has(k))return false;seen.add(k);return true;});
    const railLines=features.filter(f=>['rail','subway'].includes(f.properties?.tags?.railway)&&['LineString','MultiLineString'].includes(f.geometry?.type));
    if(!districts.length||!deduped.length)throw new Error('Vienna district/station data was incomplete.');
    return {raw:geo,city,districts,stations:deduped,railLines};
  }
  function districtNumber(tags){ const g=tags['ref:at:gkz']; if(/^9\d{2}$/.test(g||''))return Number(g.slice(1)); const m=String(tags.ref||tags.name||'').match(/(?:^|\D)(\d{1,2})(?:\D|$)/); return m?Number(m[1]):null; }
  function pointDistrict(point){ if(!point)return null; return state.mapData.districts.find(d=>{try{return turf.booleanPointInPolygon(point,d.feature);}catch(_){return false;}})||null; }

  function mapGeoStyle(kind){
    if(kind==='city')return {color:'#374151',weight:2,fillOpacity:0};
    if(kind==='district')return {color:'#6b7280',weight:1,dashArray:'4 5',fillOpacity:0};
    if(kind==='rail')return {color:'#111827',weight:2.5,opacity:.65};
    if(kind==='possible')return {color:'#2563eb',weight:2,fillColor:'#3b82f6',fillOpacity:.16};
    if(kind==='excluded')return {color:'#4b5563',weight:0,fillColor:'#4b5563',fillOpacity:.46};
    return {};
  }

  function drawReferenceLayers(map,prefix,onStationClick=null){
    const md=state.mapData;
    ['city','districts','rails','stations'].forEach(k=>state.mapLayers[prefix+k]?.remove());
    state.mapLayers[prefix+'city']=L.geoJSON(md.city,{style:mapGeoStyle('city')}).addTo(map);
    state.mapLayers[prefix+'districts']=L.geoJSON(turf.featureCollection(md.districts.map(d=>d.feature)),{style:mapGeoStyle('district')}).addTo(map);
    state.mapLayers[prefix+'rails']=L.geoJSON(turf.featureCollection(md.railLines),{style:mapGeoStyle('rail')}).addTo(map);
    state.mapLayers[prefix+'stations']=L.geoJSON(turf.featureCollection(md.stations),{
      pointToLayer:(f,ll)=>L.marker(ll,{icon:L.divIcon({className:'station-dot',iconSize:[10,10]})}),
      onEachFeature:(f,layer)=>{ layer.bindTooltip(f.properties?.stationName||'Station',{direction:'top'}); if(onStationClick)layer.on('click',e=>{L.DomEvent.stopPropagation(e);onStationClick(f);}); }
    }).addTo(map);
  }

  async function buildBaseAllowedArea(radiusM=BASE_HIDE_RADIUS_M){
    if(state.baseAllowedArea&&state.baseRadiusBuilt===radiusM)return state.baseAllowedArea;
    const buffers=state.mapData.stations.map(s=>turf.buffer(s,radiusM/1000,{units:'kilometers',steps:12}));
    let unioned=null; for(const b of buffers)unioned=safeUnion(unioned,b);
    state.baseAllowedArea=safeIntersect(state.mapData.city,unioned); state.baseRadiusBuilt=radiusM;
    if(!state.baseAllowedArea)throw new Error('Could not construct the station hiding zones.');
    return state.baseAllowedArea;
  }

  function selectedStationPoint(){ return state.createStation ? turf.point(state.createStation.geometry.coordinates) : null; }
  function distanceM(a,b){ return turf.distance(a,b,{units:'meters'}); }
  function hidingSpotValid(){ return !!(state.createPoint&&state.createStation&&distanceM(state.createPoint,selectedStationPoint())<=BASE_HIDE_RADIUS_M+0.5); }

  async function setupCreateMap(){
    await ensureMapData();
    if(!state.createMap){ state.createMap=L.map('createMap',baseMapOptions()); addBaseTiles(state.createMap); state.createMap.on('click',e=>{if(!state.createPickMode)return;state.createPickMode=false;setCreatePoint(e.latlng.lat,e.latlng.lng,null,'map');}); }
    drawReferenceLayers(state.createMap,'create-',f=>selectCreateStation(f));
    state.createMap.fitBounds(L.geoJSON(state.mapData.city).getBounds(),{padding:[8,8]});
    renderCreateSelection();
  }

  function selectCreateStation(feature){
    state.createStation=feature;
    const [lng,lat]=feature.geometry.coordinates; $('createStationStatus').className='status-box good'; $('createStationStatus').textContent=`Selected: ${feature.properties.stationName} · ${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    renderCreateSelection(); if(state.createPoint)setCreatePoint(state.createPoint.geometry.coordinates[1],state.createPoint.geometry.coordinates[0],state.createAccuracyM,state.createAccuracyM?'gps':'map');
  }

  function renderCreateSelection(){
    state.mapLayers.createStationRing?.remove(); state.mapLayers.createSelectedStation?.remove();
    if(!state.createStation)return;
    const [lng,lat]=state.createStation.geometry.coordinates;
    state.mapLayers.createStationRing=L.circle([lat,lng],{radius:BASE_HIDE_RADIUS_M,color:'#7c3aed',weight:2,fillColor:'#7c3aed',fillOpacity:.08}).addTo(state.createMap);
    state.mapLayers.createSelectedStation=L.marker([lat,lng],{icon:L.divIcon({className:'station-selected',iconSize:[14,14]})}).addTo(state.createMap).bindTooltip(state.createStation.properties.stationName);
  }

  function setCreatePoint(lat,lng,accuracyM=null,source='map'){
    const point=turf.point([lng,lat]); state.createPoint=point; state.createAccuracyM=Number.isFinite(Number(accuracyM))?Number(accuracyM):null;
    state.mapLayers.createSpot?.remove(); state.mapLayers.createAccuracy?.remove();
    state.mapLayers.createSpot=L.marker([lat,lng],{draggable:true}).addTo(state.createMap); state.mapLayers.createSpot.on('dragend',e=>{const p=e.target.getLatLng();setCreatePoint(p.lat,p.lng,null,'map');});
    if(state.createAccuracyM)state.mapLayers.createAccuracy=L.circle([lat,lng],{radius:state.createAccuracyM,className:'accuracy-circle',fillOpacity:.07,weight:1}).addTo(state.createMap);
    const el=$('createLocationStatus');
    if(!state.createStation){el.className='status-box bad';el.textContent='Choose the hiding station first.';return;}
    const d=distanceM(point,selectedStationPoint()); const ok=d<=BASE_HIDE_RADIUS_M+0.5; const acc=state.createAccuracyM?` · GPS ±${Math.round(state.createAccuracyM)} m`:' · manual map point';
    el.className=`status-box ${ok?(state.createAccuracyM>100?'warn':'good'):'bad'}`; el.textContent=ok?`Valid actual hiding spot · ${Math.round(d)} m from ${state.createStation.properties.stationName}${acc}`:`Invalid: ${Math.round(d)} m from station; maximum is ${BASE_HIDE_RADIUS_M} m.`;
  }

  function getGps(){
    return new Promise((resolve,reject)=>{ if(!navigator.geolocation)return reject(new Error('This browser does not support geolocation.')); navigator.geolocation.getCurrentPosition(p=>resolve({lat:p.coords.latitude,lng:p.coords.longitude,accuracy_m:p.coords.accuracy}),e=>reject(new Error(`Location failed: ${e.message}`)),{enableHighAccuracy:true,timeout:15000,maximumAge:3000}); });
  }

  async function loadGames(){ initSupabaseIfNeeded(); const {data,error}=await state.supabase.from('games').select('id,name,status,created_at').eq('status','active').order('created_at',{ascending:false}); if(error)throw error; renderGameChoices(data||[]); return data||[]; }
  function renderGameChoices(games){
    $('hiderGameSelect').innerHTML=games.length?games.map(g=>`<option value="${escapeHtml(g.id)}">${escapeHtml(g.name)}</option>`).join(''):'<option value="">No active games</option>';
    $('gameList').innerHTML=games.length?games.map(g=>`<div class="game-entry"><div><strong>${escapeHtml(g.name)}</strong><span>${new Date(g.created_at).toLocaleString()}</span></div><button class="primary" data-enter-seeker="${g.id}">Enter</button></div>`).join(''):'<div class="status-box">No active games yet.</div>';
    $('gameList').querySelectorAll('[data-enter-seeker]').forEach(b=>b.addEventListener('click',()=>enterSeeker(b.dataset.enterSeeker).catch(handleError)));
  }

  async function createGame(){
    initSupabaseIfNeeded(); const name=$('createGameName').value.trim(),password=$('createPassword').value;
    if(!name)return toast('Enter a game name.'); if(password.length<4)return toast('Use a password of at least 4 characters.'); if(!state.createStation)return toast('Choose the hiding station.'); if(!state.createPoint)return toast('Choose the actual hiding spot.'); if(!hidingSpotValid())return toast('The actual hiding spot must be within 250 m of the selected station.');
    const [slng,slat]=state.createStation.geometry.coordinates,[hlng,hlat]=state.createPoint.geometry.coordinates;
    const ok=await confirmAction('Create this game?',`Game: ${name}\nLong-game target: ${state.createStation.properties.stationName}\nActual hiding spot: ${hlat.toFixed(5)}, ${hlng.toFixed(5)}\nDistance from station: ${Math.round(distanceM(state.createPoint,selectedStationPoint()))} m\n\nBoth target coordinates are protected from seekers.`,'Create game'); if(!ok)return;
    const {data,error}=await state.supabase.rpc('create_game_v3',{p_name:name,p_password:password,p_station_name:state.createStation.properties.stationName,p_station_lat:slat,p_station_lng:slng,p_hidden_lat:hlat,p_hidden_lng:hlng}); if(error)throw error; await enterHider(data,password);
  }

  async function enterHider(gameId,password){
    initSupabaseIfNeeded(); if(!gameId)return toast('Choose a game.');
    const {data,error}=await state.supabase.rpc('get_hider_game_v3',{p_game_id:gameId,p_password:password}); if(error)throw error; const r=data?.[0]; if(!r)return toast('Wrong hider password.');
    state.role='hider'; state.hiderPassword=password; state.game={id:r.game_id,name:r.game_name,status:r.game_status}; state.secret={hidden:turf.point([r.hidden_lng,r.hidden_lat]),station:turf.point([r.station_lng,r.station_lat]),station_name:r.station_name,endgame:r.endgame,base_radius_m:r.base_radius_m||BASE_HIDE_RADIUS_M}; await enterGameCommon();
  }
  async function enterSeeker(gameId){ initSupabaseIfNeeded(); const {data,error}=await state.supabase.from('games').select('id,name,status').eq('id',gameId).single(); if(error)throw error; state.role='seeker';state.hiderPassword=null;state.secret=null;state.game=data;await enterGameCommon(); }

  async function enterGameCommon(){
    await ensureMapData(); await buildBaseAllowedArea(BASE_HIDE_RADIUS_M); setupGameMap();
    $('roleKicker').textContent=state.role.toUpperCase(); $('gameTitle').textContent=state.game.name; $('seekerControls').classList.toggle('hidden',state.role!=='seeker'); $('seekerQuestionLocation').classList.toggle('hidden',state.role!=='seeker'); $('hiderControls').classList.toggle('hidden',state.role!=='hider');
    showView('gameView'); await syncServerClock(); await reloadGameState(); subscribeRealtime(); startTimers();
  }

  function setupGameMap(){
    if(!state.gameMap){ state.gameMap=L.map('gameMap',baseMapOptions()); addBaseTiles(state.gameMap); state.gameMap.on('click',e=>handleGameMapClick(e.latlng)); }
    drawReferenceLayers(state.gameMap,'game-',f=>{ if(state.role==='hider'&&state.trapPlacementCard)placeTimeTrapAtStation(f).catch(handleError); });
    state.gameMap.fitBounds(L.geoJSON(state.mapData.city).getBounds(),{padding:[5,5]});
  }

  function handleGameMapClick(latlng){
    if(state.role!=='seeker')return;
    if(state.pickMode==='question'&&state.pendingQuestionCard){ const card=state.pendingQuestionCard; state.pickMode=null;state.pendingQuestionCard=null; prepareAndAskQuestion(card,{lat:latlng.lat,lng:latlng.lng,accuracy_m:null,source:'map'}).catch(handleError); return; }
    if(state.pickMode==='thermo'){ state.pickMode=null; submitThermoReference({lat:latlng.lat,lng:latlng.lng,accuracy_m:null,source:'map'}).catch(handleError); }
  }

  function setSeekerPointDisplay(origin){
    state.seekerPoint=origin?turf.point([origin.lng,origin.lat]):null; state.seekerAccuracyM=origin?.accuracy_m??null; state.seekerMarker?.remove();state.seekerAccuracyCircle?.remove();
    if(!origin){$('seekerLocationStatus').textContent='No question location has been sent.';return;}
    state.seekerMarker=L.marker([origin.lat,origin.lng]).addTo(state.gameMap).bindTooltip('Latest seeker question location');
    if(origin.accuracy_m)state.seekerAccuracyCircle=L.circle([origin.lat,origin.lng],{radius:origin.accuracy_m,className:'accuracy-circle',weight:1,fillOpacity:.05}).addTo(state.gameMap);
    const warn=origin.accuracy_m&&origin.accuracy_m>100; $('seekerLocationStatus').className=`status-box ${warn?'warn':'good'}`; $('seekerLocationStatus').textContent=`${origin.lat.toFixed(5)}, ${origin.lng.toFixed(5)} · ${origin.source==='gps'?`GPS ±${Math.round(origin.accuracy_m||0)} m`:'manual map location'}`;
  }

  async function chooseQuestionOrigin(card){
    if(state.seekerOriginMode==='map'){ state.pendingQuestionCard=card; state.pickMode='question'; toast(`Tap the map to choose the origin for ${card.title}.`); return; }
    const p=await getGps(); await prepareAndAskQuestion(card,{...p,source:'gps'});
  }

  async function prepareAndAskQuestion(card,origin){
    if(activeQuestionForSlot(card.slot))return toast('That question has already been asked.');
    let payload={slot_key:card.slot,question_kind:card.kind,title:card.title,origin}; let description=`${card.title}\nOrigin: ${origin.lat.toFixed(5)}, ${origin.lng.toFixed(5)}${origin.accuracy_m?` · GPS ±${Math.round(origin.accuracy_m)} m`:' · manual'}`;
    clearPoiPreview();
    if(card.kind==='radar'){ payload.center={lat:origin.lat,lng:origin.lng};payload.radius_m=card.radius_m; previewQuestionGeometry(payload); }
    else if(card.kind==='district'){ const d=pointDistrict(turf.point([origin.lng,origin.lat])); if(!d)return toast('This question origin is outside Vienna.'); payload.district_number=d.number;payload.district_name=d.name;description+=`\nDistrict: ${d.number}. ${d.name}`; }
    else if(card.kind==='thermometer'){
      if(!state.thermoReference)return toast('Set a Thermometer start point first.'); const [flng,flat]=state.thermoReference.geometry.coordinates; const travelled=turf.distance(state.thermoReference,turf.point([origin.lng,origin.lat]),{units:'meters'}); if(travelled+0.5<card.min_travel_m)return toast(`You have only moved ${Math.round(travelled)} m; this card requires at least ${card.min_travel_m} m.`);
      payload.from={lat:flat,lng:flng};payload.to={lat:origin.lat,lng:origin.lng};payload.min_travel_m=card.min_travel_m;description+=`\nTravelled: ${Math.round(travelled)} m`;previewQuestionGeometry(payload);
    } else if(card.kind==='tentacle'){
      toast(`Loading ${card.title} from Overpass…`,5000); const all=await loadPoiType(card.poi_type);
      const candidates=all.filter(p=>pointInPossible(p));
      const pois=candidates.map(p=>({id:p.properties.poiId,name:p.properties.poiName,lat:p.geometry.coordinates[1],lng:p.geometry.coordinates[0]}));
      payload.poi_type=card.poi_type;payload.valid_distance_m=TENTACLE_VALID_DISTANCE_M;payload.pois=pois;description+=`
${pois.length} mapped ${card.title.toLowerCase()} inside the remaining playable area.`; showPoiPreview(pois);
    }
    if(origin.accuracy_m&&card.kind==='radar'&&origin.accuracy_m>Math.max(25,card.radius_m/2))description+=`\nWARNING: reported GPS accuracy (±${Math.round(origin.accuracy_m)} m) is poor relative to this Radar radius.`;
    const ok=await confirmAction('Send this question?',`${description}\n\nThe hider will receive the same question preview plus a privately calculated suggested answer.`,`Send ${card.title}`); if(!ok){clearPendingOverlay();clearPoiPreview();return;}
    const {error}=await state.supabase.rpc('ask_question_v3',{p_game_id:state.game.id,p_slot_key:card.slot,p_kind:card.kind,p_payload:payload}); if(error)throw error; await reloadGameState();
  }

  async function submitThermoReference(origin){
    const ok=await confirmAction('Set Thermometer start?',`Point A: ${origin.lat.toFixed(5)}, ${origin.lng.toFixed(5)}${origin.accuracy_m?`\nGPS reported accuracy ±${Math.round(origin.accuracy_m)} m.`:'\nManual map location.'}\n\nThis replaces the current active Thermometer start point.`,'Set start'); if(!ok)return;
    const {error}=await state.supabase.rpc('add_thermo_reference_v3',{p_game_id:state.game.id,p_lat:origin.lat,p_lng:origin.lng,p_accuracy_m:origin.accuracy_m,p_source:origin.source}); if(error)throw error; await reloadGameState();
  }

  async function loadPoiType(type){
    if(state.poiCache[type])return state.poiCache[type];
    const key=POI_CACHE_PREFIX+type, cached=localStorage.getItem(key);
    if(cached){try{const obj=JSON.parse(cached);if(Date.now()-obj.ts<24*3600e3&&Array.isArray(obj.pois)){state.poiCache[type]=obj.pois.map(p=>turf.point([p.lng,p.lat],{poiId:p.id,poiName:p.name,poiType:type}));return state.poiCache[type];}}catch(_){}}
    const filter=POI_QUERIES[type]; if(!filter)throw new Error(`No Overpass filter for ${type}.`); const endpoint=CFG.OVERPASS_ENDPOINT||'https://overpass-api.de/api/interpreter';
    const query=`[out:json][timeout:60];area["boundary"="administrative"]["admin_level"="4"]["name"="Wien"]->.vienna;nwr(area.vienna)${filter};out center tags;`;
    const res=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'},body:'data='+encodeURIComponent(query)}); if(!res.ok)throw new Error(`Overpass POI query returned HTTP ${res.status}.`);
    const osm=await res.json(); const raw=(osm.elements||[]).map((e,i)=>{const lat=e.lat??e.center?.lat,lng=e.lon??e.center?.lon;if(!Number.isFinite(lat)||!Number.isFinite(lng))return null;return{id:`${e.type}/${e.id??i}`,name:e.tags?.name||e.tags?.['name:de']||`${humanize(type)} ${i+1}`,lat,lng};}).filter(Boolean);
    localStorage.setItem(key,JSON.stringify({ts:Date.now(),pois:raw})); state.poiCache[type]=raw.map(p=>turf.point([p.lng,p.lat],{poiId:p.id,poiName:p.name,poiType:type}));return state.poiCache[type];
  }
  function humanize(s){return String(s).replaceAll('_',' ').replace(/\b\w/g,c=>c.toUpperCase());}
  function pointInPossible(p){try{return !!state.possibleArea&&turf.booleanPointInPolygon(p,state.possibleArea);}catch(_){return false;}}

  function showPoiPreview(pois){
    clearPoiPreview(); const fc=turf.featureCollection(pois.map(p=>turf.point([p.lng,p.lat],{name:p.name,id:p.id})));
    state.mapLayers.poiPreview=L.geoJSON(fc,{pointToLayer:(f,ll)=>L.marker(ll,{icon:L.divIcon({className:'poi-dot',iconSize:[11,11]})}),onEachFeature:(f,l)=>l.bindTooltip(f.properties.name)}).addTo(state.gameMap);
  }
  function clearPoiPreview(){state.mapLayers.poiPreview?.remove();state.mapLayers.poiReach?.remove();state.mapLayers.poiPreview=null;state.mapLayers.poiReach=null;}
  function clearPendingOverlay(){state.mapLayers.pendingCircle?.remove();state.mapLayers.pendingLine?.remove();state.mapLayers.pendingTentacleCell?.remove();state.mapLayers.pendingCircle=null;state.mapLayers.pendingLine=null;state.mapLayers.pendingTentacleCell=null;}
  function previewQuestionGeometry(p){
    clearPendingOverlay();
    if(p.question_kind==='radar')state.mapLayers.pendingCircle=L.circle([p.center.lat,p.center.lng],{radius:p.radius_m,color:'#f59e0b',weight:2,dashArray:'6 5',fillOpacity:.04}).addTo(state.gameMap);
    if(p.question_kind==='thermometer')state.mapLayers.pendingLine=L.polyline([[p.from.lat,p.from.lng],[p.to.lat,p.to.lng]],{color:'#f59e0b',weight:3,dashArray:'6 5'}).addTo(state.gameMap);
  }

  function actionMap(){return new Map(state.actions.map(a=>[a.id,a]));}
  function isActionEffective(action,byId=actionMap(),memo=new Map()){
    if(!action||!action.is_active)return false;if(memo.has(action.id))return memo.get(action.id);let effective=true;if(action.parent_id)effective=isActionEffective(byId.get(action.parent_id),byId,memo);
    memo.set(action.id,effective);return effective;
  }
  function effectiveActions(kind=null){const byId=actionMap(),memo=new Map();return state.actions.filter(a=>(!kind||a.kind===kind)&&isActionEffective(a,byId,memo));}
  function activeQuestionForSlot(slot){return effectiveActions('question').find(a=>a.payload?.slot_key===slot)||null;}
  function activeAnswerForQuestion(id){return effectiveActions('answer').filter(a=>a.parent_id===id).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at))[0]||null;}
  function activeVetoForQuestion(id){return effectiveActions('question_veto').find(a=>a.parent_id===id)||null;}
  function latestAction(kind){return effectiveActions(kind).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at))[0]||null;}

  function hiderTargetPoint(){if(state.role!=='hider'||!state.secret)return null;return state.secret.endgame?state.secret.hidden:state.secret.station;}
  function suggestedAnswer(q){
    const target=hiderTargetPoint(); if(!target)return null; const p=q.payload||{};
    if(p.question_kind==='radar'){const d=turf.distance(target,turf.point([p.center.lng,p.center.lat]),{units:'meters'});return {type:'boolean',value:d<=Number(p.radius_m),text:d<=Number(p.radius_m)?`HIT — target is ${Math.round(d)} m away.`:`MISS — target is ${Math.round(d)} m away.`};}
    if(p.question_kind==='district'){const d=pointDistrict(target);const yes=d?.number===Number(p.district_number);return {type:'boolean',value:yes,text:yes?`YES — target is in ${p.district_number}. ${p.district_name}.`:`NO — target is in ${d?`${d.number}. ${d.name}`:'another area'}.`};}
    if(p.question_kind==='thermometer'){const from=turf.point([p.from.lng,p.from.lat]),to=turf.point([p.to.lng,p.to.lat]);const df=turf.distance(target,from,{units:'meters'}),dt=turf.distance(target,to,{units:'meters'});const yes=dt<df;return {type:'boolean',value:yes,text:`${yes?'WARMER':'COLDER'} — ${Math.round(df)} m → ${Math.round(dt)} m from the private target.`};}
    if(p.question_kind==='tentacle'){
      const pois=p.pois||[];let best=null,bestD=Infinity;for(const poi of pois){const d=turf.distance(target,turf.point([poi.lng,poi.lat]),{units:'meters'});if(d<bestD){bestD=d;best=poi;}}
      if(!best)return {type:'tentacle',status:'auto_veto',text:'AUTO-VETO — no candidate POI is available in the remaining zone.'};
      const limit=Number(p.valid_distance_m||TENTACLE_VALID_DISTANCE_M);
      if(bestD>limit)return {type:'tentacle',status:'auto_veto',nearest:best,nearest_distance_m:bestD,text:`AUTO-VETO — nearest option is ${best.name}, but the private target is ${Math.round(bestD)} m away (> ${limit} m).`};
      return {type:'tentacle',status:'poi',poi:best,nearest_distance_m:bestD,text:`Suggested answer: hider is closest to ${best.name}. Private validation distance: ${Math.round(bestD)} m.`};
    }
    return null;
  }

  async function answerBoolean(q,value){
    const s=suggestedAnswer(q); const ok=await confirmAction(`Send ${value?'YES':'NO'}?`,`${questionLabel(q)}\n\nAutomatic hider preview: ${s?.text||'Unavailable'}\n\nYou are still choosing the final answer manually.`,`Send ${value?'YES':'NO'}`);if(!ok)return;
    const {error}=await state.supabase.rpc('answer_question_v3',{p_game_id:state.game.id,p_question_action_id:q.id,p_password:state.hiderPassword,p_answer:{type:'boolean',value}});if(error)throw error;await reloadGameState();
  }
  async function answerTentacle(q){
    const s=suggestedAnswer(q); if(s?.status!=='poi'||!s.poi)return toast('This Tentacle does not currently have a valid POI answer.');
    const answer={type:'tentacle',status:'poi',poi:s.poi};
    const ok=await confirmAction('Send Tentacle answer?',`${questionLabel(q)}

Public answer:
Hider is closest to ${s.poi.name}.

Automatic private check: ${s.text}

Only the POI name is sent publicly; the private validation distance is never included in the answer.`,`Send answer`);if(!ok)return;
    const {error}=await state.supabase.rpc('answer_question_v3',{p_game_id:state.game.id,p_question_action_id:q.id,p_password:state.hiderPassword,p_answer:answer});if(error)throw error;await reloadGameState();
  }
  async function autoVetoTentacle(q){
    const s=suggestedAnswer(q); if(s?.status!=='auto_veto')return toast('This Tentacle has a valid POI answer and should not be automatically vetoed.');
    const ok=await confirmAction('Confirm automatic Tentacle veto?',`${questionLabel(q)}

${s.text}

This does not consume a Veto card and awards no card draw. Seekers will only be told that the Tentacle was automatically vetoed because no listed option was within ${Number(q.payload?.valid_distance_m||TENTACLE_VALID_DISTANCE_M)} m of the target.`,`Veto Tentacle`,true);if(!ok)return;
    const {error}=await state.supabase.rpc('auto_veto_tentacle_v3',{p_game_id:state.game.id,p_question_action_id:q.id,p_password:state.hiderPassword});if(error)throw error;await reloadGameState();
  }

  function availableHandCards(effectKey=null){
    const cards=[]; for(const d of state.hiderDraws){if(!drawIsEarned(d))continue;const kept=new Set(d.kept_card_keys||[]),used=new Set(d.used_card_keys||[]);for(const c of d.cards||[])if(kept.has(c.card_key)&&!used.has(c.card_key)&&(!effectKey||c.effect_key===effectKey))cards.push({...c,draw_id:d.id});} return cards;
  }
  async function vetoQuestion(q){
    const veto=availableHandCards('veto_question')[0];if(!veto)return toast('No unused Veto Question card is in your hand.');const ok=await confirmAction('Veto this question?',`${questionLabel(q)}\n\nThis consumes ${veto.title}. No answer is sent and this question remains used/greyed out.`,'Use veto',true);if(!ok)return;
    const {error}=await state.supabase.rpc('veto_question_v3',{p_game_id:state.game.id,p_question_action_id:q.id,p_password:state.hiderPassword,p_card_key:veto.card_key});if(error)throw error;await reloadGameState();
  }

  async function toggleKeepCard(draw,cardKey,active){const c=draw.cards.find(x=>x.card_key===cardKey);const ok=await confirmAction(`${active?'Keep':'Undo keep'} card?`,`${c?.title||cardKey}\n${c?.description||''}\n\nThis draw lets you keep ${draw.keep_limit} card${draw.keep_limit===1?'':'s'}.`,active?'Keep card':'Undo keep',!active);if(!ok)return;const {error}=await state.supabase.rpc('toggle_keep_card_v3',{p_game_id:state.game.id,p_draw_id:draw.id,p_password:state.hiderPassword,p_card_key:cardKey,p_active:active});if(error)throw error;await reloadGameState();}

  async function playHandCard(card){
    if(card.card_kind==='time_bonus')return toast('Time-bonus cards stay in your hand and are added to the final score.');
    if(card.effect_key==='veto_question')return toast('Use the Veto button on a pending question.');
    if(card.effect_key==='time_trap'){state.trapPlacementCard=card;toast('Tap a station marker on the map to place this Time Trap.');return;}
    if(card.effect_key==='duplicate'){await useDuplicate(card);return;}
    const duration=card.duration_seconds?`\nA synchronized ${formatDuration(card.duration_seconds)} timer will start.`:'';const extra=card.effect_key==='prosperous_home'?`\nThis implementation doubles the final hiding AREA: 250 m radius → ${(BASE_HIDE_RADIUS_M*Math.sqrt(2)).toFixed(1)} m radius.`:'';
    const ok=await confirmAction(`Play ${card.title}?`,`${card.description}${duration}${extra}`,'Play card');if(!ok)return;
    const {error}=await state.supabase.rpc('play_card_v3',{p_game_id:state.game.id,p_password:state.hiderPassword,p_card_key:card.card_key,p_copy_card_key:null});if(error)throw error;await reloadGameState();
  }

  async function useDuplicate(card){
    const targets=availableHandCards().filter(c=>c.card_key!==card.card_key&&['time_bonus','curse'].includes(c.card_kind));if(!targets.length)return toast('Duplicate currently needs another held time bonus or curse card.');
    const choices=targets.map((c,i)=>`${i+1}. ${c.title}`).join('\n');const raw=window.prompt(`Choose the card Duplicate should copy:\n${choices}`);if(!raw)return;const idx=Number(raw)-1;if(!Number.isInteger(idx)||idx<0||idx>=targets.length)return toast('Invalid Duplicate choice.');const target=targets[idx];const ok=await confirmAction('Use Duplicate?',`Duplicate will copy “${target.title}”. The original ${target.title} remains in your hand; Duplicate is consumed.`,'Use Duplicate');if(!ok)return;
    const {error}=await state.supabase.rpc('play_card_v3',{p_game_id:state.game.id,p_password:state.hiderPassword,p_card_key:card.card_key,p_copy_card_key:target.card_key});if(error)throw error;await reloadGameState();
  }

  async function placeTimeTrapAtStation(feature){
    const card=state.trapPlacementCard;if(!card)return;state.trapPlacementCard=null;const [lng,lat]=feature.geometry.coordinates;const ok=await confirmAction('Place Time Trap here?',`Station: ${feature.properties.stationName}\n\nThe trap placement remains secret from seekers until it is triggered. Its value starts at the card's base bonus and increases by 10 minutes per full hour armed.`,'Place trap');if(!ok)return;
    const {error}=await state.supabase.rpc('place_time_trap_v3',{p_game_id:state.game.id,p_password:state.hiderPassword,p_card_key:card.card_key,p_station_name:feature.properties.stationName,p_station_lat:lat,p_station_lng:lng});if(error)throw error;await reloadGameState();
  }
  async function triggerTimeTrap(trap,active=true){
    const verb=active?'Trigger':'Undo trigger';const ok=await confirmAction(`${verb} Time Trap?`,`${trap.station_name}\n${active?'This publishes the trap and its current time bonus to the seekers.':'This removes the triggered bonus from the active score/history; the placement remains secret.'}`,verb,!active);if(!ok)return;
    const {error}=await state.supabase.rpc('set_time_trap_trigger_v3',{p_game_id:state.game.id,p_trap_id:trap.id,p_password:state.hiderPassword,p_active:active});if(error)throw error;await reloadGameState();
  }

  async function toggleEndgame(){
    if(state.role!=='hider')return;const next=!state.secret.endgame;const ok=await confirmAction(next?'Switch privately to endgame?':'Return privately to station phase?',next?`From the next question onward, automatic answer previews use your exact hiding coordinate instead of ${state.secret.station_name}.\n\nSeekers receive no phase flag or notification.`:`Automatic answer previews will again use ${state.secret.station_name}.\n\nSeekers receive no phase flag or notification.`,next?'Enter endgame':'Undo endgame',!next);if(!ok)return;
    const {error}=await state.supabase.rpc('set_endgame_v3',{p_game_id:state.game.id,p_password:state.hiderPassword,p_endgame:next});if(error)throw error;await refreshHiderSecret();await reloadGameState();
  }
  async function refreshHiderSecret(){if(state.role!=='hider')return;const {data,error}=await state.supabase.rpc('get_hider_game_v3',{p_game_id:state.game.id,p_password:state.hiderPassword});if(error)throw error;const r=data?.[0];if(r)state.secret={hidden:turf.point([r.hidden_lng,r.hidden_lat]),station:turf.point([r.station_lng,r.station_lat]),station_name:r.station_name,endgame:r.endgame,base_radius_m:r.base_radius_m||BASE_HIDE_RADIUS_M};}

  async function setActionActive(action,active){const verb=active?'Redo':'Undo';const ok=await confirmAction(`${verb} this action?`,`${actionLabel(action)}\n\n${active?'It becomes active again.':'It remains in history but stops affecting the game.'}`,verb,!active);if(!ok)return;const {error}=await state.supabase.rpc('set_action_active_v3',{p_game_id:state.game.id,p_action_id:action.id,p_password:state.role==='hider'?state.hiderPassword:null,p_active:active});if(error)throw error;await reloadGameState();}

  async function reloadActions(){const {data,error}=await state.supabase.from('game_actions').select('*').eq('game_id',state.game.id).order('created_at',{ascending:true});if(error)throw error;state.actions=data||[];}
  async function reloadHiderPrivate(){
    if(state.role!=='hider'){state.hiderDraws=[];state.timeTraps=[];state.privateCardUses=[];return;}
    const [d,t,u]=await Promise.all([
      state.supabase.rpc('get_hider_draws_v3',{p_game_id:state.game.id,p_password:state.hiderPassword}),
      state.supabase.rpc('get_time_traps_v3',{p_game_id:state.game.id,p_password:state.hiderPassword}),
      state.supabase.rpc('get_private_card_uses_v3',{p_game_id:state.game.id,p_password:state.hiderPassword})
    ]); if(d.error)throw d.error;if(t.error)throw t.error;if(u.error)throw u.error;
    state.hiderDraws=(d.data||[]).map(r=>({...r,cards:Array.isArray(r.cards)?r.cards:[],kept_card_keys:Array.isArray(r.kept_card_keys)?r.kept_card_keys:[],used_card_keys:Array.isArray(r.used_card_keys)?r.used_card_keys:[]}));state.timeTraps=t.data||[];state.privateCardUses=u.data||[];
  }
  async function reloadGameState(){await reloadActions();if(state.role==='hider')await refreshHiderSecret();await reloadHiderPrivate();deriveLocalState();await recomputePossibleArea();renderAll();}

  function deriveLocalState(){
    const questions=effectiveActions('question').sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));const q=questions[0];if(q?.payload?.origin)setSeekerPointDisplay(q.payload.origin);else setSeekerPointDisplay(null);
    const ref=latestAction('thermo_reference');if(ref){state.thermoReference=turf.point([Number(ref.payload.lng),Number(ref.payload.lat)]);$('thermoStatus').textContent=`${Number(ref.payload.lat).toFixed(4)}, ${Number(ref.payload.lng).toFixed(4)}`;}else{state.thermoReference=null;$('thermoStatus').textContent='None';}
    renderHiderSecret(); renderPendingQuestionOverlay();
  }

  function currentAreaMultiplier(){const p=effectiveActions('curse_play').filter(a=>a.payload?.effect_key==='prosperous_home');return Math.pow(2,p.length);}
  async function recomputePossibleArea(){const radius=BASE_HIDE_RADIUS_M*Math.sqrt(currentAreaMultiplier());await buildBaseAllowedArea(radius);let possible=state.baseAllowedArea;const qs=effectiveActions('question').sort((a,b)=>new Date(a.created_at)-new Date(b.created_at));for(const q of qs){if(activeVetoForQuestion(q.id))continue;const a=activeAnswerForQuestion(q.id);if(!a)continue;possible=applyConstraint(possible,q,a.payload?.answer);if(!possible)break;}state.possibleArea=possible;}

  function applyConstraint(possible,q,answer){
    if(!possible)return null;const p=q.payload||{};
    if(p.question_kind==='radar'){const c=turf.buffer(turf.point([p.center.lng,p.center.lat]),Number(p.radius_m)/1000,{units:'kilometers',steps:64});return answer?.value?safeIntersect(possible,c):safeDifference(possible,c);}
    if(p.question_kind==='district'){const d=state.mapData.districts.find(x=>x.number===Number(p.district_number));return d?(answer?.value?safeIntersect(possible,d.feature):safeDifference(possible,d.feature)):possible;}
    if(p.question_kind==='thermometer'){const half=warmerHalfPlane(p.from,p.to,!!answer?.value);return half?safeIntersect(possible,half):possible;}
    if(p.question_kind==='tentacle'){
      if(answer?.status==='poi'&&answer.poi)return nearestPoiCell(possible,answer.poi,p.pois||[]); return possible;
    }
    return possible;
  }

  function nearestPoiCell(possible,selected,pois){let out=possible;const A={lat:selected.lat,lng:selected.lng};for(const other of pois){if(other.id===selected.id)continue;const half=closerHalfPlane(A,{lat:other.lat,lng:other.lng});if(half){out=safeIntersect(out,half);if(!out)break;}}return out;}
  function closerHalfPlane(a,b){
    const A=mercator(a.lat,a.lng),B=mercator(b.lat,b.lng);let nx=A.x-B.x,ny=A.y-B.y;const len=Math.hypot(nx,ny);if(len<1)return null;nx/=len;ny/=len;const tx=-ny,ty=nx,M={x:(A.x+B.x)/2,y:(A.y+B.y)/2},L=120000,D=120000;const pts=[{x:M.x+tx*L,y:M.y+ty*L},{x:M.x-tx*L,y:M.y-ty*L},{x:M.x-tx*L+nx*D,y:M.y-ty*L+ny*D},{x:M.x+tx*L+nx*D,y:M.y+ty*L+ny*D}].map(unmercator);return turf.polygon([[...pts.map(p=>[p.lng,p.lat]),[pts[0].lng,pts[0].lat]]]);
  }
  function warmerHalfPlane(from,to,yes){const A=mercator(from.lat,from.lng),B=mercator(to.lat,to.lng);let nx=B.x-A.x,ny=B.y-A.y;const len=Math.hypot(nx,ny);if(len<1)return null;nx/=len;ny/=len;if(!yes){nx*=-1;ny*=-1;}const tx=-ny,ty=nx,M={x:(A.x+B.x)/2,y:(A.y+B.y)/2},L=120000,D=120000;const pts=[{x:M.x+tx*L,y:M.y+ty*L},{x:M.x-tx*L,y:M.y-ty*L},{x:M.x-tx*L+nx*D,y:M.y-ty*L+ny*D},{x:M.x+tx*L+nx*D,y:M.y+ty*L+ny*D}].map(unmercator);return turf.polygon([[...pts.map(p=>[p.lng,p.lat]),[pts[0].lng,pts[0].lat]]]);}
  function mercator(lat,lng){const R=6378137;return{x:R*lng*Math.PI/180,y:R*Math.log(Math.tan(Math.PI/4+lat*Math.PI/360))};}
  function unmercator(p){const R=6378137;return{lng:p.x/R*180/Math.PI,lat:(2*Math.atan(Math.exp(p.y/R))-Math.PI/2)*180/Math.PI};}

  function renderPossibleArea(){
    state.mapLayers.possible?.remove();state.mapLayers.excluded?.remove();if(state.possibleArea){state.mapLayers.possible=L.geoJSON(state.possibleArea,{style:mapGeoStyle('possible'),interactive:false}).addTo(state.gameMap);const ex=safeDifference(state.mapData.city,state.possibleArea);if(ex)state.mapLayers.excluded=L.geoJSON(ex,{style:mapGeoStyle('excluded'),interactive:false}).addTo(state.gameMap);const km2=turf.area(state.possibleArea)/1e6;$('remainingAreaText').textContent=`${km2.toFixed(km2>=10?1:2)} km² possible`;}else{$('remainingAreaText').textContent='0 km² possible';}
    state.mapLayers['game-rails']?.bringToFront?.();state.mapLayers['game-stations']?.bringToFront?.();
  }

  function renderHiderSecret(){
    if(state.role!=='hider'||!state.secret)return;const [slng,slat]=state.secret.station.geometry.coordinates,[hlng,hlat]=state.secret.hidden.geometry.coordinates;const phase=state.secret.endgame?'<span class="phase-endgame">ENDGAME / actual spot</span>':'<span class="phase-station">STATION PHASE</span>';
    $('hiderSecretStatus').innerHTML=`${phase}<br><strong>${escapeHtml(state.secret.station_name)}</strong> · ${slat.toFixed(5)}, ${slng.toFixed(5)}<br>Actual spot: ${hlat.toFixed(5)}, ${hlng.toFixed(5)} · ${Math.round(distanceM(state.secret.station,state.secret.hidden))} m from station.`;
    $('toggleEndgameButton').textContent=state.secret.endgame?'Undo endgame: use station again':'Switch privately to endgame';
    state.mapLayers.hiderStation?.remove();state.mapLayers.hiderSpot?.remove();state.mapLayers.hiderZone?.remove();
    state.mapLayers.hiderStation=L.marker([slat,slng],{icon:L.divIcon({className:'station-selected',iconSize:[14,14]})}).addTo(state.gameMap).bindTooltip(`Private station: ${state.secret.station_name}`);
    state.mapLayers.hiderSpot=L.marker([hlat,hlng]).addTo(state.gameMap).bindTooltip('Private actual hiding spot');
    const r=BASE_HIDE_RADIUS_M*Math.sqrt(currentAreaMultiplier());state.mapLayers.hiderZone=L.circle([slat,slng],{radius:r,color:'#7c3aed',weight:2,dashArray:'5 4',fillOpacity:.04}).addTo(state.gameMap);
  }

  function renderQuestionDeck(){
    const used=new Set(effectiveActions('question').map(a=>a.payload?.slot_key));$('questionDeckStatus').textContent=`${used.size}/${QUESTION_CARDS.length} asked`;
    $('questionDeck').innerHTML=QUESTION_CARDS.map(c=>{const isUsed=used.has(c.slot),disabled=state.role!=='seeker'||isUsed;return `<button class="question-card-button ${isUsed?'used':''} ${state.role==='hider'?'hider-view':''}" data-question-slot="${c.slot}" ${disabled?'disabled':''}><div><div class="q-category">${c.category}</div><div class="q-title">${escapeHtml(c.title)}</div><div class="q-detail">${escapeHtml(c.detail)}</div></div><div class="q-state">${isUsed?'Asked':(state.role==='seeker'?'Available':'Not asked')}</div></button>`;}).join('');
    $('questionDeck').querySelectorAll('[data-question-slot]').forEach(b=>b.addEventListener('click',()=>{const c=QUESTION_CARDS.find(x=>x.slot===b.dataset.questionSlot);if(c)chooseQuestionOrigin(c).catch(handleError);}));
  }

  function showTentacleCellPreview(q,poi){
    state.mapLayers.pendingTentacleCell?.remove(); state.mapLayers.pendingTentacleCell=null;
    if(!q||!poi||!state.possibleArea)return;
    const cell=nearestPoiCell(state.possibleArea,poi,q.payload?.pois||[]); if(!cell)return;
    state.mapLayers.pendingTentacleCell=L.geoJSON(cell,{style:{color:'#f59e0b',weight:2,dashArray:'6 5',fillColor:'#f59e0b',fillOpacity:.14},interactive:false}).addTo(state.gameMap);
    state.mapLayers.poiPreview?.bringToFront?.();
  }

  function renderPendingQuestionOverlay(){
    clearPendingOverlay();clearPoiPreview();if(state.role!=='hider')return;const pending=effectiveActions('question').filter(q=>!activeAnswerForQuestion(q.id)&&!activeVetoForQuestion(q.id));const q=pending[pending.length-1];if(!q)return;const p=q.payload||{};if(p.question_kind==='tentacle'){showPoiPreview(p.pois||[]);const s=suggestedAnswer(q);if(s?.status==='poi')showTentacleCellPreview(q,s.poi);}else previewQuestionGeometry(p);
  }

  function renderPendingQuestions(){
    if(state.role!=='hider')return;const pending=effectiveActions('question').filter(q=>!activeAnswerForQuestion(q.id)&&!activeVetoForQuestion(q.id));const hasVeto=availableHandCards('veto_question').length>0;
    $('pendingQuestions').innerHTML=pending.length?pending.map(q=>{const s=suggestedAnswer(q);let controls='';if(q.payload?.question_kind==='tentacle'){if(s?.status==='auto_veto'){controls=`<button class="danger full" data-auto-veto-tentacle="${q.id}">Confirm automatic Tentacle veto</button>`;}else{controls=`<button class="primary full" data-send-tentacle="${q.id}">Send “Hider is closest to ${escapeHtml(s?.poi?.name||'…')}”</button>`;}}else{controls=`<div class="answer-row"><button class="primary answer-yes" data-answer-question="${q.id}" data-answer-value="true">Yes</button><button class="primary answer-no" data-answer-question="${q.id}" data-answer-value="false">No</button></div>`;}
      return `<div class="question-item"><strong>${escapeHtml(questionLabel(q))}</strong> <span class="answer-pill pending">Pending</span><div class="meta">${new Date(q.created_at).toLocaleString()}</div><div class="suggestion"><strong>Automatic private preview</strong>${escapeHtml(s?.text||'Could not calculate.')}</div>${q.payload?.question_kind==='tentacle'?`<div class="tentacle-summary">${(q.payload.pois||[]).length} candidate POIs from the remaining zone. Valid only if the private target is within ${Number(q.payload?.valid_distance_m||TENTACLE_VALID_DISTANCE_M)} m of at least one.</div>`:''}${controls}${hasVeto?`<button class="danger full small" data-veto-question="${q.id}">Use Veto Question</button>`:''}</div>`;
    }).join(''):'<div class="mini-status">Nothing waiting for an answer.</div>';
    $('pendingQuestions').querySelectorAll('[data-answer-question]').forEach(b=>b.addEventListener('click',()=>{const q=state.actions.find(a=>a.id===b.dataset.answerQuestion);if(q)answerBoolean(q,b.dataset.answerValue==='true').catch(handleError);}));
    $('pendingQuestions').querySelectorAll('[data-send-tentacle]').forEach(b=>b.addEventListener('click',()=>{const q=state.actions.find(a=>a.id===b.dataset.sendTentacle);if(q)answerTentacle(q).catch(handleError);}));
    $('pendingQuestions').querySelectorAll('[data-auto-veto-tentacle]').forEach(b=>b.addEventListener('click',()=>{const q=state.actions.find(a=>a.id===b.dataset.autoVetoTentacle);if(q)autoVetoTentacle(q).catch(handleError);}));
    $('pendingQuestions').querySelectorAll('[data-veto-question]').forEach(b=>b.addEventListener('click',()=>{const q=state.actions.find(a=>a.id===b.dataset.vetoQuestion);if(q)vetoQuestion(q).catch(handleError);}));
  }

  function drawIsEarned(d){const q=state.actions.find(a=>a.id===d.question_action_id);return q&&isActionEffective(q)&&!!activeAnswerForQuestion(q.id);}
  function renderCurseDraws(){
    if(state.role!=='hider')return;const earned=state.hiderDraws.filter(drawIsEarned);const hand=availableHandCards();const timeBonus=hand.filter(c=>c.card_kind==='time_bonus').reduce((s,c)=>s+Number(c.value_int||0),0)+state.privateCardUses.filter(u=>u.effect_key==='duplicate_bonus'&&u.is_active).reduce((s,u)=>s+Number(u.value_int||0),0)+state.timeTraps.filter(t=>t.trigger_active).reduce((s,t)=>s+Number(t.bonus_minutes||0),0);$('bonusTotal').textContent=`${timeBonus} min held/earned`;
    $('curseDraws').innerHTML=earned.length?earned.map(d=>{const kept=new Set(d.kept_card_keys||[]),used=new Set(d.used_card_keys||[]),count=kept.size;return `<div class="curse-draw"><div class="curse-draw-title">Draw ${d.cards.length} · keep ${d.keep_limit} <span class="mini-status">(${count}/${d.keep_limit} selected)</span></div><div class="curse-options">${d.cards.map(c=>{const isKept=kept.has(c.card_key),isUsed=used.has(c.card_key);return `<div class="curse-option ${isKept?'kept':''} ${isUsed?'used':''}"><div class="card-kind">${escapeHtml(c.card_kind)}</div><strong>${escapeHtml(c.title)}</strong><p>${escapeHtml(c.description)}${c.duration_seconds?` · ${formatDuration(c.duration_seconds)}`:''}</p>${!isUsed?`<button class="secondary small keep-toggle" data-keep-card="${c.card_key}" data-draw-id="${d.id}" data-keep-active="${isKept?'false':'true'}" ${( !isKept && count>=d.keep_limit)?'disabled':''}>${isKept?'Undo keep':'Keep'}</button>`:''}${isKept&&!isUsed?`<button class="primary small" data-play-card="${c.card_key}">${c.card_kind==='time_bonus'?'Held for final score':c.effect_key==='veto_question'?'Use on pending question':c.effect_key==='time_trap'?'Place Time Trap':'Play'}</button>`:''}${isUsed?'<span class="answer-pill undone">USED</span>':''}</div>`;}).join('')}</div></div>`;}).join(''):'<div class="mini-status">No earned card draws yet.</div>';
    $('curseDraws').querySelectorAll('[data-keep-card]').forEach(b=>b.addEventListener('click',()=>{const d=state.hiderDraws.find(x=>x.id===b.dataset.drawId);if(d)toggleKeepCard(d,b.dataset.keepCard,b.dataset.keepActive==='true').catch(handleError);}));
    $('curseDraws').querySelectorAll('[data-play-card]').forEach(b=>b.addEventListener('click',()=>{const c=availableHandCards().find(x=>x.card_key===b.dataset.playCard);if(c)playHandCard(c).catch(handleError);}));
  }

  function renderTimeTraps(){
    if(state.role!=='hider')return;$('timeTraps').innerHTML=state.timeTraps.length?state.timeTraps.map(t=>`<div class="question-item ${t.trigger_active?'time-trap-triggered':'time-trap-armed'}"><strong>${escapeHtml(t.station_name)}</strong><div class="meta">Armed ${new Date(t.armed_at).toLocaleString()} · current value ${Number(t.current_bonus_minutes||t.bonus_minutes||0)} min</div><button class="${t.trigger_active?'secondary':'primary'} small full" data-trigger-trap="${t.id}" data-trap-active="${t.trigger_active?'false':'true'}">${t.trigger_active?'Undo trigger':'Trigger now'}</button></div>`).join(''):'<div class="mini-status">No Time Traps placed.</div>';
    $('timeTraps').querySelectorAll('[data-trigger-trap]').forEach(b=>b.addEventListener('click',()=>{const t=state.timeTraps.find(x=>x.id===b.dataset.triggerTrap);if(t)triggerTimeTrap(t,b.dataset.trapActive==='true').catch(handleError);}));
  }

  function renderActiveCurses(){
    const now=serverNowMs();const all=effectiveActions().filter(a=>['curse_play','time_trap_trigger','question_veto'].includes(a.kind));const visible=all.filter(a=>{const end=a.payload?.ends_at?new Date(a.payload.ends_at).getTime():null;return !end||end>now;}).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
    $('activeCurses').innerHTML=visible.length?visible.map(a=>{if(a.kind==='question_veto')return `<div class="curse-item"><strong>${a.payload?.automatic_tentacle?'Tentacle automatically vetoed':'Question vetoed'}</strong><div class="meta">${escapeHtml(a.payload?.question_title||'A question')} ${a.payload?.automatic_tentacle?`had no qualifying option within ${Number(a.payload?.valid_distance_m||TENTACLE_VALID_DISTANCE_M)} m of the hider target.`:'was vetoed.'}</div></div>`;if(a.kind==='time_trap_trigger')return `<div class="curse-item"><strong>Time Trap triggered</strong><div class="meta">${escapeHtml(a.payload?.station_name||'Station')} · +${Number(a.payload?.bonus_minutes||0)} min</div></div>`;const end=a.payload?.ends_at?new Date(a.payload.ends_at).getTime():null;const rem=end?Math.max(0,Math.ceil((end-now)/1000)):null;return `<div class="curse-item curse-active"><strong>${escapeHtml(a.payload?.title||'Card')}</strong><div class="meta">${escapeHtml(a.payload?.description||'')}</div><div class="curse-countdown">${rem===null?'ACTIVE':formatCountdown(rem)}</div></div>`;}).join(''):'<div class="mini-status">No public card effect is active.</div>';
  }

  function canToggleAction(a){if(a.kind==='time_trap_trigger')return false;if(state.role==='hider')return a.actor==='hider';if(state.role==='seeker')return a.actor==='seeker';return false;}
  function renderActivity(){
    const rows=[...state.actions].reverse();$('activityHistory').innerHTML=rows.length?rows.map(a=>`<div class="activity-item ${a.is_active?'':'inactive'}"><div><strong>${escapeHtml(actionLabel(a))}</strong>${!a.is_active?' <span class="answer-pill undone">UNDONE</span>':''}</div><div class="meta">${new Date(a.created_at).toLocaleString()} · ${escapeHtml(a.actor)}</div>${canToggleAction(a)?`<div class="activity-actions"><button class="${a.is_active?'danger':'secondary'} small full" data-toggle-action="${a.id}" data-active="${a.is_active?'false':'true'}">${a.is_active?'Undo':'Redo'}</button></div>`:''}</div>`).join(''):'<div class="mini-status">No game activity yet.</div>';
    $('activityHistory').querySelectorAll('[data-toggle-action]').forEach(b=>b.addEventListener('click',()=>{const a=state.actions.find(x=>x.id===b.dataset.toggleAction);if(a)setActionActive(a,b.dataset.active==='true').catch(handleError);}));
  }

  function renderAll(){renderQuestionDeck();renderPendingQuestions();renderCurseDraws();renderTimeTraps();renderActiveCurses();renderActivity();renderPossibleArea();renderHiderSecret();}

  function questionLabel(q){const p=q.payload||{};if(p.question_kind==='radar')return `${formatDistance(p.radius_m)} Radar from ${formatCoord(p.center)}`;if(p.question_kind==='district')return `Same District: ${p.district_number}. ${p.district_name}`;if(p.question_kind==='thermometer')return `${formatDistance(p.min_travel_m)} Thermometer: ${formatCoord(p.from)} → ${formatCoord(p.to)}`;if(p.question_kind==='tentacle')return `${humanize(p.poi_type)} Tentacle · ${p.pois?.length||0} options in remaining zone`;return p.title||p.slot_key||'Question';}
  function answerLabel(ans){if(!ans)return'';if(ans.type==='boolean')return ans.value?'YES':'NO';if(ans.type==='tentacle'&&ans.status==='poi')return `Hider is closest to ${ans.poi?.name||'selected POI'}`;return 'ANSWER';}
  function actionLabel(a){const p=a.payload||{};if(a.kind==='question')return `Question · ${questionLabel(a)}`;if(a.kind==='answer'){const q=state.actions.find(x=>x.id===a.parent_id);return `Answer · ${q?questionLabel(q):'question'} · ${answerLabel(p.answer)}`;}if(a.kind==='thermo_reference')return `Thermometer start · ${Number(p.lat).toFixed(4)}, ${Number(p.lng).toFixed(4)}`;if(a.kind==='curse_play')return `Card played · ${p.title||p.card_key||'Curse'}`;if(a.kind==='question_veto')return `${p.automatic_tentacle?'Automatic Tentacle veto':'Veto'} · ${p.question_title||'Question'}`;if(a.kind==='time_trap_trigger')return `Time Trap · ${p.station_name} · +${p.bonus_minutes} min`;return a.kind;}
  function formatDistance(m){return Number(m)>=1000?`${Number(m)/1000} km`:`${Number(m)} m`;}
  function formatCoord(p){return p?`${Number(p.lat).toFixed(4)}, ${Number(p.lng).toFixed(4)}`:'?';}
  function formatDuration(s){s=Number(s)||0;if(s%3600===0&&s>=3600)return`${s/3600} h`;if(s%60===0)return`${s/60} min`;return`${s} sec`;}
  function formatCountdown(s){s=Math.max(0,Math.floor(s));const h=Math.floor(s/3600),m=Math.floor((s%3600)/60),sec=s%60;return h?`${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`:`${m}:${String(sec).padStart(2,'0')}`;}

  async function syncServerClock(){try{const before=Date.now();const {data,error}=await state.supabase.rpc('server_now');const after=Date.now();if(error)throw error;state.serverOffsetMs=new Date(data).getTime()-(before+after)/2;$('serverClockStatus').textContent='server-synced';}catch(_){state.serverOffsetMs=0;$('serverClockStatus').textContent='device clock';}}
  function serverNowMs(){return Date.now()+state.serverOffsetMs;}
  function startTimers(){clearInterval(state.timerId);state.timerId=setInterval(()=>{if(state.game){renderActiveCurses();renderTimeTraps();}},1000);}

  function subscribeRealtime(){
    if(state.realtimeChannel)state.supabase.removeChannel(state.realtimeChannel);$('syncBadge').textContent='Live';$('syncBadge').className='badge ok';state.realtimeChannel=state.supabase.channel(`actions-${state.game.id}`).on('postgres_changes',{event:'*',schema:'public',table:'game_actions',filter:`game_id=eq.${state.game.id}`},()=>reloadGameState().catch(handleError)).subscribe(status=>{if(status==='SUBSCRIBED'){$('syncBadge').textContent='Live';$('syncBadge').className='badge ok';}else if(['CHANNEL_ERROR','TIMED_OUT'].includes(status)){$('syncBadge').textContent='Polling';$('syncBadge').className='badge warn';}});clearInterval(state.pollId);state.pollId=setInterval(()=>{if(state.game)reloadGameState().catch(()=>{});},15000);
  }

  function leaveGame(){if(state.realtimeChannel&&state.supabase)state.supabase.removeChannel(state.realtimeChannel);clearInterval(state.timerId);clearInterval(state.pollId);Object.assign(state,{role:null,game:null,hiderPassword:null,secret:null,actions:[],hiderDraws:[],timeTraps:[],privateCardUses:[],thermoReference:null,pendingQuestionCard:null,pickMode:null,trapPlacementCard:null});clearPoiPreview();clearPendingOverlay();showView('homeView');}
  function openLobby(role){$('hiderLobby').classList.toggle('hidden',role!=='hider');$('seekerLobby').classList.toggle('hidden',role!=='seeker');$('lobbyKicker').textContent=role.toUpperCase();$('lobbyTitle').textContent=role==='hider'?'Create or open a game':'Choose a game';showView('lobbyView');(async()=>{try{if(role==='hider')await setupCreateMap();await loadGames();}catch(e){handleError(e);}})();}

  function bindUi(){
    document.querySelector('[data-action="open-hider"]').addEventListener('click',()=>openLobby('hider'));document.querySelector('[data-action="open-seeker"]').addEventListener('click',()=>openLobby('seeker'));document.querySelector('[data-action="home"]').addEventListener('click',()=>showView('homeView'));document.querySelector('[data-action="leave-game"]').addEventListener('click',leaveGame);
    document.querySelectorAll('[data-tab]').forEach(btn=>btn.addEventListener('click',()=>{document.querySelectorAll('[data-tab]').forEach(x=>x.classList.toggle('active',x===btn));$('createTab').classList.toggle('active',btn.dataset.tab==='create');$('openTab').classList.toggle('active',btn.dataset.tab==='open');setTimeout(()=>state.createMap?.invalidateSize(),50);}));
    $('confirmCancel').addEventListener('click',()=>closeConfirm(false));$('confirmOk').addEventListener('click',()=>closeConfirm(true));$('confirmModal').addEventListener('click',e=>{if(e.target===$('confirmModal'))closeConfirm(false);});
    $('createGpsButton').addEventListener('click',()=>getGps().then(p=>setCreatePoint(p.lat,p.lng,p.accuracy_m,'gps')).catch(handleError));$('createPickButton').addEventListener('click',()=>{state.createPickMode=true;toast('Tap the map to set the actual hiding spot.');});$('createGameButton').addEventListener('click',()=>createGame().catch(handleError));$('openHiderGameButton').addEventListener('click',()=>enterHider($('hiderGameSelect').value,$('openPassword').value).catch(handleError));$('refreshGamesButton').addEventListener('click',()=>loadGames().catch(handleError));
    document.querySelectorAll('[data-origin-mode]').forEach(b=>b.addEventListener('click',()=>{state.seekerOriginMode=b.dataset.originMode;document.querySelectorAll('[data-origin-mode]').forEach(x=>x.classList.toggle('active',x===b));$('questionOriginStatus').textContent=state.seekerOriginMode==='gps'?'Fresh GPS for each question':'Tap map after choosing question';}));
    $('setThermoGpsButton').addEventListener('click',()=>getGps().then(p=>submitThermoReference({...p,source:'gps'})).catch(handleError));$('setThermoMapButton').addEventListener('click',()=>{state.pickMode='thermo';toast('Tap the map to set Thermometer point A.');});$('toggleEndgameButton').addEventListener('click',()=>toggleEndgame().catch(handleError));
  }

  bindUi();
})();
