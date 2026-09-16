(() => {
  'use strict';

  const CFG = window.HNS_CONFIG || {};
  const APP_VERSION = '3.13.4';
  const VIENNA_CENTER = [48.2082, 16.3738];
  const VIENNA_ZOOM = 12;
  const VIENNA_RELATION_ID = 109166;
  const VIENNA_AREA_ID = 3600109166;
  const BASE_HIDE_RADIUS_M = 250;
  const TENTACLE_VALID_DISTANCE_M = 250;
  const TENTACLE_SEARCH_RADIUS_M = 5000;
  const BUS_TENTACLE_SEARCH_BUFFER_M = 1000;
  const BUS_TENTACLE_GRID_M = 15;
  const VOR_NAV_DURATION_SECONDS = 180;
  const HEAVY_GEOMETRY_SIMPLIFY_DEG = 0.000018;
  const HEAVY_GEOMETRY_MIN_VERTEX_M = 1.5;
  const HEAVY_GEOMETRY_CACHE_LIMIT = 24;
  const POSSIBLE_AREA_CACHE_LIMIT = 12;
  const CACHE_KEY = 'hns_vienna_osm_v10';
  const CACHE_TS_KEY = 'hns_vienna_osm_v10_ts';
  const RAIL_CACHE_KEY = 'hns_vienna_transit_v6';
  const RAIL_CACHE_TS_KEY = 'hns_vienna_transit_v6_ts';
  const POI_CACHE_PREFIX = 'hns_vienna_poi_v3_';
  const REF_ADMIN_KEY='vienna_admin_v1';
  const REF_STATIONS_KEY='vienna_stations_v1';
  const REF_TRANSIT_KEY='vienna_transit_v1';
  const REF_POI_PREFIX='vienna_poi_';
  const VIENNA_WFS_BASE='https://data.wien.gv.at/daten/geo';
  const VIENNA_BBOX='48.117668,16.18218,48.322571,16.577511';
  const REFRESH_GRID_ROWS=4;
  const REFRESH_GRID_COLS=4;
  const REFRESH_CHUNK_MAX_AGE_DAYS=7;
  const REF_RAW_TRANSIT_LINES='vienna_raw_transit_lines_v1';
  const REF_RAW_UBAHN_STOPS='vienna_raw_ubahn_stops_v1';
  const REF_RAW_ALL_STOPS='vienna_raw_all_stops_v1';
  const VIENNA_DISTRICTS_LAYER='BEZIRKSGRENZEOGD';
  const VIENNA_TRANSIT_LINES_LAYER='OEFFLINIENOGD';
  const VIENNA_TRANSIT_STOPS_LAYER='OEFFHALTESTOGD';
  const VIENNA_UBAHN_STOPS_LAYER='UBAHNHALTOGD';
  const WFS_POI_LAYERS={museum:'MUSEUMOGD',park:'PARKANLAGEOGD',library:'BUECHEREIOGD',hospital:'KRANKENHAUSOGD'};
  const ACTIVE_POI_TYPES=['museum','park','library','cinema','hospital','cemetery','church','zoo'];
  const VIENNA_DISTRICT_ARCGIS='https://www.wien.gv.at/agssoe/rest/services/MapExport/MapExportService/MapServer/0/query?where=1%3D1&outFields=*&returnGeometry=true&outSR=4326&f=geojson';
  // Current 2026 Wiener Weinwandertag access/start/end points. The official event has
  // four main routes; Route 1 explicitly exposes several public entry points.
  const WINE_HIKE_POINTS=[
    {name:'Neustift am Walde',route:'Neustift – Nußdorf',lat:48.25105,lng:16.30183},
    {name:'Sievering',route:'Neustift – Nußdorf',lat:48.25416,lng:16.31728},
    {name:'Weingut Wien Cobenzl',route:'Neustift – Nußdorf',lat:48.26350,lng:16.32185},
    {name:'Grinzing',route:'Neustift – Nußdorf',lat:48.25510,lng:16.34188},
    {name:'Nußdorf / Beethovengang',route:'Neustift – Nußdorf',lat:48.25954,lng:16.36274},
    {name:'Strebersdorfer Platz',route:'Strebersdorf – Stammersdorf',lat:48.29495,lng:16.38988},
    {name:'Wien Stammersdorf',route:'Strebersdorf – Stammersdorf',lat:48.29805,lng:16.42053},
    {name:'Schloss Wilhelminenberg',route:'Ottakring',lat:48.21957,lng:16.28555},
    {name:'Franz-Asenbauer-Gasse',route:'Mauer',lat:48.15478,lng:16.27130},
    {name:'Zemlinskygasse / Willergasse',route:'Mauer',lat:48.13961,lng:16.25753}
  ];
  const MANUAL_CURSE_EFFECTS=new Set(['fiaker','schwarzkappler','wean_ned_schlecht_redn']);
  const MANUAL_STATION_LINE_OVERRIDES={
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
  function stationOverrideKey(name){return String(name||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/ß/g,'ss').toLowerCase().replace(/\s+/g,' ').trim();}
  function manualStationOverrideRefs(name){
    const key=stationOverrideKey(name);if(MANUAL_STATION_LINE_OVERRIDES[key])return MANUAL_STATION_LINE_OVERRIDES[key];
    for(const [base,refs] of Object.entries(MANUAL_STATION_LINE_OVERRIDES))if(key.startsWith(base+',')||key.startsWith(base+' '))return refs;
    return [];
  }
  function applyManualStationLineOverrides(stations){
    return (stations||[]).map(st=>{
      const extra=manualStationOverrideRefs(st?.properties?.stationName);if(!extra.length)return st;
      const refs=[...new Set([...(st.properties?.lineRefs||[]).map(r=>String(r).toUpperCase()),...extra])].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
      return {...st,properties:{...(st.properties||{}),lineRefs:refs,manualInterchangeOverride:true}};
    });
  }

  const DEFAULT_QUESTION_CARDS = [
    { slot:'same-district', category:'MIXED', title:'Same District', detail:'Same Vienna district?', kind:'district' },
    { slot:'same-line', category:'MIXED', title:'On This U-/S-Bahn Line?', detail:'Choose a line. Is the hiding station served by it?', kind:'same_line' },
    { slot:'station-interchange', category:'MIXED', title:'Nearest Station an Interchange?', detail:'Is the hiding station served by at least two U-/S-Bahn lines?', kind:'station_interchange' },
    { slot:'street-shape', category:'MIXED', title:'Current Street Shape', detail:'Endgame only: receive a hand-drawn outline of the Hider’s nearest street.', kind:'street_shape', endgame_only:true },
    { slot:'nearest-bus-line', category:'TENTACLES', title:'Nearest Bus Line', detail:'Endgame only: among Vienna bus lines crossing or within 1 km of the remaining area, keep the territory closest to the answered line.', kind:'bus_line_tentacle', endgame_only:true, search_buffer_m:BUS_TENTACLE_SEARCH_BUFFER_M },
    { slot:'vor-navigation', category:'MIXED', title:'VOR Navigation', detail:'Endgame only: 3 minutes of a live 30° direction sector toward the hiding spot. No Hider answer required.', kind:'vor_navigation', endgame_only:true, duration_seconds:VOR_NAV_DURATION_SECONDS },
    { slot:'transdanubia', category:'MIXED', title:'In Mordor?', detail:'Is the target across the Danube in district 21 or 22?', kind:'district_set', districts:[21,22], yes_label:'Yes', no_label:'No' },
    { slot:'inner-districts', category:'MIXED', title:'Inner Districts?', detail:'Is the target in districts 1–9?', kind:'district_set', districts:[1,2,3,4,5,6,7,8,9], yes_label:'Yes', no_label:'No' },
    { slot:'stephansdom-benchmark', category:'MIXED', title:'Closer to Stephansdom?', detail:'Is the target closer to Stephansdom than you are?', kind:'landmark_compare', landmark_name:'Stephansdom', landmark:{lat:48.20849,lng:16.37208} },
    { slot:'schoenbrunn-benchmark', category:'MIXED', title:'Closer to Schönbrunn?', detail:'Is the target closer to Schönbrunn Palace than you are?', kind:'landmark_compare', landmark_name:'Schönbrunn Palace', landmark:{lat:48.18452,lng:16.31217} },
    { slot:'donauturm-benchmark', category:'MIXED', title:'Closer to Donauturm?', detail:'Is the target closer to Donauturm than you are?', kind:'landmark_compare', landmark_name:'Donauturm', landmark:{lat:48.24035,lng:16.41008} },
    { slot:'riesenrad-benchmark', category:'MIXED', title:'Closer to the Riesenrad?', detail:'Is the target closer to the Wiener Riesenrad than you are?', kind:'landmark_compare', landmark_name:'Wiener Riesenrad', landmark:{lat:48.21667,lng:16.39588} },
    { slot:'north-of-me', category:'MIXED', title:'North of Me?', detail:'Is the target north of your position?', kind:'directional', axis:'lat', positive_label:'North', negative_label:'South' },
    { slot:'east-of-me', category:'MIXED', title:'East of Me?', detail:'Is the target east of your position?', kind:'directional', axis:'lng', positive_label:'East', negative_label:'West' },
    { slot:'radar-20000', category:'RADAR', title:'20 km Radar', detail:'Is the target within 20 km of this location?', kind:'radar', radius_m:20000 },
    { slot:'radar-10000', category:'RADAR', title:'10 km Radar', detail:'Is the target within 10 km of this location?', kind:'radar', radius_m:10000 },
    { slot:'radar-5000', category:'RADAR', title:'5 km Radar', detail:'Is the target within 5 km of this location?', kind:'radar', radius_m:5000 },
    { slot:'radar-1000', category:'RADAR', title:'1 km Radar', detail:'Is the target within 1 km of this location?', kind:'radar', radius_m:1000 },
    { slot:'radar-500', category:'RADAR', title:'500 m Radar', detail:'Is the target within 500 m of this location?', kind:'radar', radius_m:500 },
    { slot:'radar-100', category:'RADAR', title:'100 m Radar', detail:'Is the target within 100 m of this location?', kind:'radar', radius_m:100 },
    { slot:'thermo-250', category:'THERMOMETER', title:'250 m Thermometer', detail:'Start here; after moving ≥250 m ask whether you are warmer.', kind:'thermometer', min_travel_m:250 },
    { slot:'thermo-500', category:'THERMOMETER', title:'500 m Thermometer', detail:'Start here; after moving ≥500 m ask whether you are warmer.', kind:'thermometer', min_travel_m:500 },
    { slot:'thermo-2000', category:'THERMOMETER', title:'2 km Thermometer', detail:'Start here; after moving ≥2 km ask whether you are warmer.', kind:'thermometer', min_travel_m:2000 },
    { slot:'tentacle-museums', category:'TENTACLES', title:'Museums', detail:'5 km Tentacle.', kind:'tentacle', poi_type:'museum', endgame_only:true },
    { slot:'tentacle-parks', category:'TENTACLES', title:'Parks', detail:'5 km Tentacle.', kind:'tentacle', poi_type:'park', endgame_only:true },
    { slot:'tentacle-libraries', category:'TENTACLES', title:'Libraries', detail:'5 km Tentacle.', kind:'tentacle', poi_type:'library', endgame_only:true },
    { slot:'tentacle-cinemas', category:'TENTACLES', title:'Movie Theaters', detail:'5 km Tentacle.', kind:'tentacle', poi_type:'cinema', endgame_only:true },
    { slot:'tentacle-hospitals', category:'TENTACLES', title:'Hospitals', detail:'5 km Tentacle.', kind:'tentacle', poi_type:'hospital', endgame_only:true },
    { slot:'tentacle-cemeteries', category:'TENTACLES', title:'Cemeteries / Graveyards', detail:'5 km Tentacle.', kind:'tentacle', poi_type:'cemetery', endgame_only:true },
    { slot:'tentacle-churches', category:'TENTACLES', title:'Churches', detail:'5 km Tentacle.', kind:'tentacle', poi_type:'church', endgame_only:true },
    { slot:'tentacle-zoos', category:'TENTACLES', title:'Zoos / Aquariums', detail:'5 km Tentacle.', kind:'tentacle', poi_type:'zoo', endgame_only:true },
    { slot:'photo-water', category:'PHOTO', title:'Biggest body of water', detail:'Send a photo of the biggest body of water visible from the hiding area.', kind:'photo', photo_prompt:'Biggest body of water' },
    { slot:'photo-structure', category:'PHOTO', title:'Highest visible structure', detail:'Send a photo of the highest visible structure.', kind:'photo', photo_prompt:'Highest visible structure' },
    { slot:'photo-selfie', category:'PHOTO', title:'Selfie', detail:'Send a current selfie from the hiding location.', kind:'photo', photo_prompt:'Selfie' },
    { slot:'photo-four-houses', category:'PHOTO', title:'At least 4 houses in one image', detail:'One photo with at least four houses.', kind:'photo', photo_prompt:'At least 4 houses in one image' },
    { slot:'photo-lamp', category:'PHOTO', title:'Closest street light', detail:'Photograph the closest street light or lamp to the hiding spot.', kind:'photo', photo_prompt:'Closest street light / lamp' },
    { slot:'photo-up', category:'PHOTO', title:'View straight up', detail:'Photograph the view straight upward.', kind:'photo', photo_prompt:'View straight up' }
  ];

  const POI_QUERIES = {
    museum: '["tourism"="museum"]',
    park: '["leisure"="park"]',
    library: '["amenity"="library"]',
    cinema: '["amenity"="cinema"]',
    hospital: '["amenity"="hospital"]',
    cemetery: ['["landuse"="cemetery"]','["amenity"="grave_yard"]'],
    church: '["amenity"="place_of_worship"]["religion"="christian"]',
    zoo: ['["tourism"="zoo"]','["tourism"="aquarium"]'],
    aquarium: '["tourism"="aquarium"]',
    amusement_park: '["tourism"="theme_park"]'
  };

  const state = {
    supabase:null, mapData:null, createMap:null, gameMap:null, mapLayers:{},
    createStation:null,
    endgameCandidate:null, endgameAccuracyM:null, endgamePickMode:false, endgamePrepareMode:false, seekerEndgamePickMode:false,
    role:null, game:null, hiderPassword:null, secret:null,
    actions:[], hiderDraws:[], timeTraps:[], privateCardUses:[],
    seekerOriginMode:'gps', seekerPoint:null, seekerAccuracyM:null, seekerMarker:null, seekerAccuracyCircle:null,
    thermoReference:null, pendingQuestionCard:null, pickMode:null, trapPlacementCard:null,
    possibleArea:null, baseAllowedArea:null, baseRadiusBuilt:null,
    poiCache:{}, tentaclePreview:null, pendingOverlay:null,
    realtimeChannel:null, timerId:null, pollId:null, serverOffsetMs:0,reloadPromise:null,reloadQueued:false,
    overpassBadUntil:{}, railLoadPromise:null,
    confirmResolver:null,
    currentPosition:null,currentPositionMarker:null,currentPositionAccuracyCircle:null,
    gpsAutoTimer:null,gpsAutoEnabled:false,lastGpsUpdateMs:0,seekerLivePosition:null,deckStatus:null,castResolver:null,castCard:null,
    thermoReferences:{},previewQuestionSlot:null,previewQuestionCard:null,
    seenCurseIds:new Set(),curseSoundPrimed:false,audioCtx:null,notificationPrimed:false,seenNotificationActionIds:new Set(),photoUploadToken:null,photoUrlCache:new Map(),photoPreviewUrls:new Map(),photoFiles:new Map(),
    developerPassword:null,referenceMeta:{},sameLineSelection:null,developerCards:[],developerQuestions:[],questionCards:DEFAULT_QUESTION_CARDS.map(x=>({...x})),curseMapSignature:null,turntablesPickMode:false,turntablesCandidate:null,developerPreview:false,developerPreviewRole:null,passierscheinWasActive:false,
    vorQuestionId:null,vorBearing:null,vorHeading:null,vorExpiresAt:0,vorGeoWatchId:null,vorOrientationHandler:null,vorCompassPermission:'unknown',vorLastBearingFetch:0,vorBearingBusy:false,vorRenderTimer:null,
    geometryCache:new Map(),geometryJobs:new Map(),geometryWarmScheduled:false,possibleAreaSignature:null,possibleAreaCache:new Map(),possibleAreaKm2:0,possibleExcludedArea:null,possibleRenderSignature:null,
    geometryWorker:null,geometryWorkerSeq:0,geometryWorkerPending:new Map(),heavyPrepared:new Map(),heavyPrepareJobs:new Map(),answerGeometryCache:new Map(),geometrySqlAvailable:null,heavyCanvasRenderer:null,sameLineMasks:new Map(),heavyHistoryResults:new Map(),heavyHistoryJobs:new Map(),heavyFinalizeJobs:new Map(),heavyAreaPending:false
  };

  const $ = id => document.getElementById(id);
  const views = ['homeView','lobbyView','gameView','developerView'];

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

  function supabasePublicKey(){ return String(CFG.SUPABASE_PUBLISHABLE_KEY || CFG.SUPABASE_ANON_KEY || '').trim(); }
  function assertConfigured() {
    const url=String(CFG.SUPABASE_URL||'').trim();
    const key=supabasePublicKey();
    if(!url || url.includes('YOUR_PROJECT')) throw new Error('Supabase is not configured yet. Set SUPABASE_URL in config.js.');
    if(url.includes('supabase.com/dashboard')) throw new Error('SUPABASE_URL is the Dashboard address. Use the Project API URL instead, e.g. https://PROJECTREF.supabase.co.');
    if(!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(url)) throw new Error('SUPABASE_URL should look like https://PROJECTREF.supabase.co.');
    if(!key || key.includes('YOUR_') || key.includes('REPLACE_ME')) throw new Error('Add your Supabase Publishable key (sb_publishable_...) to config.js.');
    if(key.startsWith('sb_secret_')) throw new Error('Never use a Supabase secret key in this browser app. Use the sb_publishable_... key from Settings → API Keys.');
    if(key.startsWith('eyJ')) console.warn('Using a legacy anon JWT. Prefer the current sb_publishable_... key.');
    console.info(`HideNSeek build v${APP_VERSION}`);
  }
  function initSupabaseIfNeeded() {
    if (state.supabase) return;
    assertConfigured();
    state.supabase=window.supabase.createClient(String(CFG.SUPABASE_URL).replace(/\/$/,''),supabasePublicKey(),{auth:{persistSession:false,autoRefreshToken:false}});
  }


  function normalizeQuestionRow(r){
    const p=(r&&typeof r.params==='object'&&r.params)||{};
    return {slot:r.question_key,category:r.category,title:r.title,detail:r.description,kind:r.question_kind,endgame_only:!!r.endgame_only,...p};
  }
  async function loadQuestionCatalog(){
    initSupabaseIfNeeded();
    try{
      const {data,error}=await state.supabase.from('question_catalog').select('question_key,category,title,description,question_kind,params,endgame_only,enabled,sort_order').eq('enabled',true).order('sort_order',{ascending:true}).order('title',{ascending:true});
      if(error)throw error;
      if(Array.isArray(data)&&data.length)state.questionCards=data.map(normalizeQuestionRow);
      else state.questionCards=DEFAULT_QUESTION_CARDS.map(x=>({...x}));
    }catch(e){
      console.warn('Question catalogue unavailable; using built-in defaults.',e);
      state.questionCards=DEFAULT_QUESTION_CARDS.map(x=>({...x}));
    }
    return state.questionCards;
  }

  function baseMapOptions(){ return {center:VIENNA_CENTER,zoom:VIENNA_ZOOM,zoomControl:true,minZoom:10,maxZoom:19,preferCanvas:true}; }
  function addBaseTiles(map){
    // OpenFreeMap Positron vector tiles: free, no account/key. Hide every symbol layer so
    // the basemap stays deliberately quiet (roads/buildings/land/water, no labels or POIs).
    if(window.maplibregl && typeof L.maplibreGL==='function'){
      try{
        const glLayer=L.maplibreGL({style:'https://tiles.openfreemap.org/styles/positron',interactive:false,attributionControl:false}).addTo(map);
        const gl=glLayer.getMaplibreMap();
        let cleaned=false;
        const removeLabels=()=>{
          if(cleaned)return;
          const style=gl.getStyle?.();
          if(!style?.layers)return;
          for(const layer of style.layers){
            if(layer.type==='symbol'){try{gl.setLayoutProperty(layer.id,'visibility','none');}catch(_){}}
          }
          cleaned=true;
        };
        gl.on('load',removeLabels);
        gl.on('styledata',removeLabels);
        gl.on('error',e=>console.warn('OpenFreeMap basemap error',e?.error||e));
        map._hnsBaseLayer=glLayer;
        setTimeout(()=>map.invalidateSize(),160);
        return;
      }catch(e){console.warn('OpenFreeMap/MapLibre unavailable, using raster fallback.',e);}
    }
    const fallback=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',className:'minimal-basemap-tiles fallback-osm'}).addTo(map);
    fallback.on('tileerror',()=>toast('Basemap tile error. The transit overlay can still load.',3500));
    map._hnsBaseLayer=fallback;
    setTimeout(()=>map.invalidateSize(),120);
  }
  function isPolygon(f){ return f?.geometry && ['Polygon','MultiPolygon'].includes(f.geometry.type); }
  function safeArea(f){ try{return turf.area(f);}catch(_){return 0;} }
  function safeIntersect(a,b){ if(!a||!b)return null; try{return turf.intersect(turf.featureCollection([a,b]));}catch(e){console.warn('intersect',e);return null;} }
  function safeDifference(a,b){ if(!a)return null; if(!b)return a; try{return turf.difference(turf.featureCollection([a,b]));}catch(e){console.warn('difference',e);return a;} }
  function safeUnion(a,b){ if(!a)return b; if(!b)return a; try{return turf.union(turf.featureCollection([a,b]))||a;}catch(_){return a;} }

  function overpassEndpoints(){
    const configured=[];
    if(Array.isArray(CFG.OVERPASS_ENDPOINTS))configured.push(...CFG.OVERPASS_ENDPOINTS);
    if(CFG.OVERPASS_ENDPOINT)configured.push(CFG.OVERPASS_ENDPOINT);
    configured.push('https://overpass-api.de/api/interpreter','https://maps.mail.ru/osm/tools/overpass/api/interpreter','https://overpass.private.coffee/api/interpreter');
    return [...new Set(configured.filter(Boolean).map(x=>String(x).replace(/\/$/,'')))];
  }

  async function fetchOverpass(query,label='Overpass request',timeoutMs=45000){
    const endpoints=overpassEndpoints();let lastError=null;
    for(let round=0;round<2;round++){
      let candidates=endpoints.filter(endpoint=>(state.overpassBadUntil[endpoint]||0)<=Date.now());
      if(!candidates.length)candidates=[...endpoints];
      for(const endpoint of candidates){
        const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),timeoutMs);
        try{
          const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'},body:'data='+encodeURIComponent(query),signal:controller.signal});
          clearTimeout(timer);
          if(!response.ok){
            const err=new Error(`${label}: ${endpoint} returned HTTP ${response.status}.`);err.status=response.status;lastError=err;
            if([429,502,503,504].includes(response.status))state.overpassBadUntil[endpoint]=Date.now()+20e3;
            continue;
          }
          state.overpassBadUntil[endpoint]=0;return await response.json();
        }catch(e){
          clearTimeout(timer);lastError=e?.name==='AbortError'?new Error(`${label}: ${endpoint} timed out.`):e;state.overpassBadUntil[endpoint]=Date.now()+15e3;
        }
      }
      if(round===0)await new Promise(r=>setTimeout(r,900+Math.random()*600));
    }
    throw new Error(`${label} failed on all configured Overpass servers after retry. ${lastError?.message||''}`.trim());
  }

  function wfsUrl(layer,extra={}){
    const u=new URL(VIENNA_WFS_BASE);
    const params={service:'WFS',request:'GetFeature',version:'1.1.0',typeName:`ogdwien:${layer}`,srsName:'EPSG:4326',outputFormat:'json',...extra};
    for(const [k,v] of Object.entries(params))if(v!==undefined&&v!==null)u.searchParams.set(k,String(v));
    return u.toString();
  }
  async function fetchViennaWfs(layer,label=layer,extra={}){
    const url=wfsUrl(layer,extra);
    const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),25000);
    try{
      const r=await fetch(url,{cache:'no-store',signal:controller.signal});
      if(!r.ok)throw new Error(`${label}: Vienna WFS returned HTTP ${r.status}.`);
      const geo=await r.json();
      if(!geo||!Array.isArray(geo.features))throw new Error(`${label}: Vienna WFS did not return GeoJSON features.`);
      return geo;
    }catch(e){
      if(e?.name==='AbortError')throw new Error(`${label}: Vienna WFS timed out.`);
      throw e;
    }finally{clearTimeout(timer);}
  }
  async function fetchJsonUrl(url,label,timeoutMs=25000){
    const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),timeoutMs);
    try{
      const r=await fetch(url,{cache:'no-store',signal:controller.signal,headers:{'Accept':'application/json'}});
      if(!r.ok)throw new Error(`${label}: HTTP ${r.status}.`);
      const data=await r.json();
      if(!data)throw new Error(`${label}: empty JSON response.`);
      return data;
    }catch(e){
      if(e?.name==='AbortError')throw new Error(`${label}: request timed out.`);
      throw e;
    }finally{clearTimeout(timer);}
  }

  function firstStringProp(props,names=[]){
    for(const k of names){const v=props?.[k];if(typeof v==='string'&&v.trim())return v.trim();}
    return '';
  }
  function lineRefsFromText(text){
    const refs=[];const seen=new Set();
    for(const m of String(text||'').toUpperCase().matchAll(/\b([US]\d{1,2})\b/g)){
      const r=m[1];if(!seen.has(r)){seen.add(r);refs.push(r);}
    }
    return refs;
  }
  function lineRefsFromProps(props){
    const preferred=[props?.LBEZEICHNUNG,props?.LINIE,props?.LINIEN,props?.LINE,props?.ROUTE,props?.BEZEICHNUNG];
    let refs=lineRefsFromText(preferred.filter(Boolean).join(' '));
    if(!refs.length)refs=lineRefsFromText(Object.values(props||{}).filter(v=>typeof v==='string').join(' '));
    return refs;
  }
  function flattenLineFeatures(feature){
    const g=feature?.geometry;if(!g)return [];
    if(g.type==='LineString')return [feature];
    if(g.type==='MultiLineString')return (g.coordinates||[]).filter(c=>c.length>1).map(c=>turf.lineString(c,feature.properties||{}));
    return [];
  }
  function normalizeOfficialTransitLines(geo){
    const out=[];
    for(const f of (geo?.features||[])){
      const p=f.properties||{};const refs=lineRefsFromProps(p);
      const us=refs.filter(r=>/^U[1-6]$/.test(r));const ss=refs.filter(r=>/^S\d{1,2}$/.test(r));
      if(!us.length&&!ss.length)continue;
      const routeRefs=[...us,...ss];
      const railway=us.length&&!ss.length?'subway':ss.length&&!us.length?'s-bahn':'passenger-rail';
      for(const line of flattenLineFeatures(f)){
        line.properties={...(line.properties||{}),railway,routeRefs,routeRef:routeRefs[0]||'',routeName:routeRefs.join(', '),routeColour:us.length===1?(U_LINE_COLOURS[us[0]]||'#334155'):(ss.length?'#1769aa':'#475569'),source:'Stadt Wien OGD'};
        out.push(line);
      }
    }
    if(!out.length)throw new Error('Vienna public-transport WFS returned no U-Bahn/S-Bahn line geometry.');
    return out;
  }
  function pointFromFeature(f){
    if(!f?.geometry)return null;
    try{
      if(f.geometry.type==='Point')return turf.point(f.geometry.coordinates,f.properties||{});
      if(f.geometry.type==='MultiPoint'&&f.geometry.coordinates?.length)return turf.point(f.geometry.coordinates[0],f.properties||{});
      if(['Polygon','MultiPolygon','LineString','MultiLineString'].includes(f.geometry.type))return turf.centroid(f);
    }catch(_){}
    return null;
  }
  function stationNameFromProps(props){
    const explicit=firstStringProp(props,['HTXT','HALTESTELLE','HST_NAME','HSTNAME','STATION','NAME','NAMEK','BEZEICHNUNG','BEZEICHNUNG1','TEXT','BASIS_NAME','OBJEKT']);
    if(explicit)return explicit;
    for(const v of Object.values(props||{})){
      if(typeof v!=='string')continue;const t=v.trim();
      if(t.length>=2&&t.length<=80&&!/^https?:/i.test(t)&&!/^\d+$/.test(t)&&!/^([US]\d+[ ,]*)+$/i.test(t)&&!/^(U-Bahn|S- und Regionalbahn|Straßenbahn|Autobus)$/i.test(t))return t;
    }
    return '';
  }
  function nearestRefsForPoint(point,railLines,allowedPrefix,maxM){
    const best=new Map();
    for(const line of railLines){
      const refs=(line.properties?.routeRefs||lineRefsFromText(line.properties?.routeRef||'')).filter(r=>allowedPrefix.test(r));if(!refs.length)continue;
      let d;try{d=turf.pointToLineDistance(point,line,{units:'meters'});}catch(_){continue;}
      if(d>maxM)continue;
      for(const ref of refs){if(!best.has(ref)||d<best.get(ref))best.set(ref,d);}
    }
    return [...best.entries()].sort((a,b)=>a[1]-b[1]).map(x=>x[0]);
  }

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

  function normalizeOfficialStations(ubahnGeo,allStopsGeo,railLines,city){
    // v3.3.4: use the authoritative line attributes on the Vienna stop layers.
    // Previous builds tried to infer S-Bahn membership by measuring every one of
    // ~8,600 public-transport stops against every rail line. That was >1M Turf
    // point-to-line calculations and could freeze the browser after tile 16/16.
    const raw=[];
    const insideCity=(pt)=>{try{return !city||turf.booleanPointInPolygon(pt,city);}catch(_){return true;}};
    const push=(f,mode,refs)=>{
      refs=[...new Set((refs||[]).filter(Boolean))];if(!refs.length)return;
      const name=stationNameFromProps(f.properties||{});if(!name)return;
      const pt=pointFromFeature(f);if(!pt||!insideCity(pt))return;
      raw.push({pt,name,refs,mode});
    };
    // UBAHNHALTOGD provides LINFO as the U-Bahn line number (1..6).
    for(const f of (ubahnGeo?.features||[])){
      const p=f.properties||{};const n=Number(p.LINFO??p.linfo);
      const refs=(Number.isInteger(n)&&n>=1&&n<=6)?[`U${n}`]:lineRefsFromProps(p).filter(r=>/^U[1-6]$/.test(r));
      push(f,'subway',refs);
    }
    // OEFFHALTESTOGD provides HLINIEN, e.g. "S1,S2,S3,S4,S7,S80".
    // Filter by the attribute FIRST so bus/tram stops never enter geometry work.
    for(const f of (allStopsGeo?.features||[])){
      const p=f.properties||{};
      const refs=lineRefsFromText(String(p.HLINIEN??p.hlinien??'')).filter(r=>/^S\d{1,2}$/.test(r));
      if(!refs.length)continue;
      push(f,'rail',refs);
    }
    const groups=new Map();
    for(const r of raw){
      const key=r.name.toLocaleLowerCase('de-AT').replace(/\s+/g,' ').trim();
      const [lng,lat]=r.pt.geometry.coordinates;const g=groups.get(key)||{name:r.name,latSum:0,lngSum:0,count:0,refs:new Set(),modes:new Set()};
      g.latSum+=lat;g.lngSum+=lng;g.count++;r.refs.forEach(x=>g.refs.add(x));g.modes.add(r.mode);groups.set(key,g);
    }
    return [...groups.values()].map((g,i)=>turf.point([g.lngSum/g.count,g.latSum/g.count],{
      stationName:g.name,stationId:`wien-ogd/${i}/${g.name}`,transitModes:[...g.modes],lineRefs:[...g.refs].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true})),railway:g.modes.has('subway')&&!g.modes.has('rail')?'subway':'rail'
    })).sort((a,b)=>a.properties.stationName.localeCompare(b.properties.stationName,'de'));
  }
  async function fetchOfficialTransitBundle(city){
    const [lineGeo,ubahnStops,allStops]=await Promise.all([
      fetchViennaWfs(VIENNA_TRANSIT_LINES_LAYER,'Vienna public-transport lines'),
      fetchViennaWfs(VIENNA_UBAHN_STOPS_LAYER,'Vienna U-Bahn stops'),
      fetchViennaWfs(VIENNA_TRANSIT_STOPS_LAYER,'Vienna public-transport stops')
    ]);
    const railLines=normalizeOfficialTransitLines(lineGeo);
    const stations=normalizeOfficialStations(ubahnStops,allStops,railLines,city);
    if(stations.length<20)throw new Error(`Vienna official transport data produced only ${stations.length} U-/S-Bahn stations.`);
    return {stations:applyManualStationLineOverrides(stations),railLines};
  }
  function featureToPoi(feature,type,i){
    const pt=pointFromFeature(feature);if(!pt)return null;
    const p=feature.properties||{};
    const namesByType={park:['ANL_NAME','NAME','NAMEK','BEZEICHNUNG'],museum:['NAME','NAMEK','BEZEICHNUNG','MUSEUM'],library:['NAME','NAMEK','BEZEICHNUNG'],hospital:['NAME','NAMEK','BEZEICHNUNG','KRANKENHAUS']};
    const name=firstStringProp(p,namesByType[type]||[])||stationNameFromProps(p)||`${humanize(type)} ${i+1}`;
    const [lng,lat]=pt.geometry.coordinates;return {id:`wien-ogd/${type}/${feature.id??i}`,name,lat,lng};
  }
  async function fetchOfficialPoi(type){
    const layer=WFS_POI_LAYERS[type];if(!layer)return null;
    const geo=await fetchViennaWfs(layer,`${humanize(type)} (Stadt Wien)`);
    const pois=(geo.features||[]).map((f,i)=>featureToPoi(f,type,i)).filter(Boolean);
    if(!pois.length)throw new Error(`${humanize(type)}: Vienna WFS returned no usable features.`);
    return {pois};
  }

  function processBoundaryGeoJSON(geo){
    const features=geo.features||[];
    const polygons=features.filter(isPolygon);
    const city=polygons.find(f=>String(f.id||f.properties?.id||'').includes(String(VIENNA_RELATION_ID)))
      || polygons.filter(f=>{const t=f.properties?.tags||{};return t.boundary==='administrative'&&String(t.admin_level)==='4';}).sort((a,b)=>safeArea(b)-safeArea(a))[0]
      || polygons.sort((a,b)=>safeArea(b)-safeArea(a))[0];
    if(!city)throw new Error(`Vienna boundary relation ${VIENNA_RELATION_ID} was returned without usable polygon geometry.`);
    const districts=features.filter(f=>{const t=f.properties?.tags||{};return t.boundary==='administrative'&&String(t.admin_level)==='9'&&isPolygon(f);}).map(f=>({feature:f,number:districtNumber(f.properties?.tags||{}),name:(f.properties?.tags||{}).name||'District'})).filter(d=>d.number>=1&&d.number<=23);
    if(districts.length<20)console.warn(`Only ${districts.length} Vienna districts were returned.`);
    return {city,districts};
  }

  function parseStationElements(osm,city){
    const groups=new Map();
    for(const [i,e] of (osm.elements||[]).entries()){
      const lat=e.lat??e.center?.lat,lng=e.lon??e.center?.lon;
      if(!Number.isFinite(lat)||!Number.isFinite(lng))continue;
      const tags=e.tags||{};
      const rawName=(tags.name||tags['name:de']||tags.uic_name||'').trim();
      if(!rawName)continue;
      const p=turf.point([lng,lat]);
      try{if(city&&!turf.booleanPointInPolygon(p,city))continue;}catch(_){}
      const subway=tags.station==='subway'||tags.subway==='yes';
      const train=tags.train==='yes'||tags.station==='train'||(!subway&&['station','halt'].includes(tags.railway));
      if(!subway&&!train)continue;
      const key=rawName.toLocaleLowerCase('de-AT').replace(/\s+/g,' ').trim();
      const g=groups.get(key)||{name:rawName,latSum:0,lngSum:0,count:0,modes:new Set(),ids:[]};
      g.latSum+=lat;g.lngSum+=lng;g.count++;g.ids.push(`${e.type||'element'}/${e.id??i}`);
      if(subway)g.modes.add('subway');if(train)g.modes.add('rail');
      groups.set(key,g);
    }
    return [...groups.values()].map(g=>turf.point([g.lngSum/g.count,g.latSum/g.count],{
      stationName:g.name,stationId:g.ids[0],transitModes:[...g.modes],railway:g.modes.has('subway')&&!g.modes.has('rail')?'subway':'rail'
    })).sort((a,b)=>a.properties.stationName.localeCompare(b.properties.stationName,'de'));
  }

  async function referenceDataset(key){
    initSupabaseIfNeeded();
    const {data,error}=await state.supabase.from('reference_datasets').select('dataset_key,payload,source,content_hash,updated_at').eq('dataset_key',key).maybeSingle();
    if(error){console.warn('Reference dataset lookup failed',key,error);return null;}
    if(data)state.referenceMeta[key]={source:data.source,content_hash:data.content_hash,updated_at:data.updated_at};
    return data?.payload||null;
  }

  function validateDistricts(districts){
    if(!Array.isArray(districts))return false;
    const nums=[...new Set(districts.map(d=>Number(d.number)).filter(n=>Number.isInteger(n)))].sort((a,b)=>a-b);
    return nums.length===23 && nums.every((n,i)=>n===i+1) && districts.every(d=>isPolygon(d.feature));
  }
  function validateReferenceCore(admin,stations){
    return !!admin?.city && isPolygon(admin.city) && validateDistricts(admin.districts) && Array.isArray(stations?.stations) && stations.stations.length>20;
  }

  async function loadReferenceCore(){
    const [admin,stations,transit]=await Promise.all([
      referenceDataset(REF_ADMIN_KEY),referenceDataset(REF_STATIONS_KEY),referenceDataset(REF_TRANSIT_KEY)
    ]);
    if(!validateReferenceCore(admin,stations))return false;
    state.mapData={city:admin.city,districts:admin.districts,stations:applyManualStationLineOverrides(stations.stations),railLines:Array.isArray(transit?.railLines)?transit.railLines:[]};
    if(!state.mapData.railLines.length)setTimeout(()=>loadRailLinesInBackground(false),0);
    return true;
  }

  async function ensureMapData(force=false) {
    if (state.mapData && !force) return state.mapData;
    initSupabaseIfNeeded();

    // Preferred path: the reference dataset is stored once in Supabase. Every device then
    // downloads ordinary JSON from our own backend instead of querying public Overpass.
    if(!force){
      try{
        if(await loadReferenceCore())return state.mapData;
      }catch(e){console.warn('Supabase reference cache unavailable; trying browser/live fallback.',e);}
    }

    const ttl=(Number(CFG.OSM_CACHE_HOURS)||168)*3600e3;
    const ts=Number(localStorage.getItem(CACHE_TS_KEY)||0);
    if (!force && Date.now()-ts<ttl) {
      try {
        const cached=JSON.parse(localStorage.getItem(CACHE_KEY));
        if(cached?.city&&validateDistricts(cached?.districts)&&cached?.stations?.length){
          state.mapData=cached;state.mapData.railLines=state.mapData.railLines||[];loadRailLinesInBackground(false);return state.mapData;
        }
      } catch(_){}
    }

    throw new Error('Vienna reference data are not fully seeded in Supabase yet. Open Developer → Refresh districts + stations + network. The v3.3.3 refresh is resumable and stores each small tile immediately.');
  }

  const U_LINE_COLOURS={U1:'#e20613',U2:'#a862a4',U3:'#ef7c00',U4:'#009540',U5:'#008c95',U6:'#9d6930'};
  function relationRouteLines(osm){
    const out=[];
    for(const rel of (osm?.elements||[])){
      if(rel.type!=='relation')continue;
      const tags=rel.tags||{};
      const route=String(tags.route||'');
      const ref=String(tags.ref||'').trim();
      const networkText=`${tags.network||''} ${tags.operator||''} ${tags.name||''}`;
      let transitType='train';
      if(route==='subway'||/^U[1-6]$/i.test(ref))transitType='subway';
      else if(/^S\d+/i.test(ref)||/S-Bahn/i.test(networkText))transitType='s-bahn';
      const colour=(transitType==='subway'&&U_LINE_COLOURS[ref.toUpperCase()]) || (transitType==='s-bahn'?'#1769aa':(tags.colour||'#475569'));
      for(const m of (rel.members||[])){
        if(m.type!=='way'||!Array.isArray(m.geometry)||m.geometry.length<2)continue;
        const coords=m.geometry.filter(p=>Number.isFinite(p.lon)&&Number.isFinite(p.lat)).map(p=>[p.lon,p.lat]);
        if(coords.length<2)continue;
        out.push(turf.lineString(coords,{railway:transitType,routeRef:ref,routeName:tags.name||ref||'Passenger rail',routeColour:colour,relationId:rel.id}));
      }
    }
    return out;
  }
  function physicalRailLines(osm){
    const out=[];
    for(const e of (osm?.elements||[])){
      if(e.type!=='way'||!Array.isArray(e.geometry)||e.geometry.length<2)continue;
      const coords=e.geometry.filter(p=>Number.isFinite(p.lon)&&Number.isFinite(p.lat)).map(p=>[p.lon,p.lat]);
      if(coords.length<2)continue;
      out.push(turf.lineString(coords,{railway:'rail-physical',routeRef:'',routeName:'ÖBB / passenger rail'}));
    }
    return out;
  }

  async function loadRailLinesInBackground(force=false){
    if(!state.mapData)return;
    if(state.mapData.railLines?.length&&!force){refreshRailLayers();return;}
    if(state.railLoadPromise)return state.railLoadPromise;
    state.railLoadPromise=(async()=>{
      if(!force){
        try{
          const ref=await referenceDataset(REF_TRANSIT_KEY);
          if(Array.isArray(ref?.railLines)&&ref.railLines.length){state.mapData.railLines=ref.railLines;refreshRailLayers();return;}
        }catch(e){console.warn('Transit reference lookup failed',e);}
      }
      const ttl=(Number(CFG.OSM_CACHE_HOURS)||168)*3600e3;
      const ts=Number(localStorage.getItem(RAIL_CACHE_TS_KEY)||0);
      if(!force&&Date.now()-ts<ttl){try{const cached=JSON.parse(localStorage.getItem(RAIL_CACHE_KEY));if(Array.isArray(cached)&&cached.length){state.mapData.railLines=cached;refreshRailLayers();return;}}catch(_){}}
      try{
        const lineGeo=await fetchViennaWfs(VIENNA_TRANSIT_LINES_LAYER,'Vienna transit network');
        const lines=normalizeOfficialTransitLines(lineGeo);
        state.mapData.railLines=lines;localStorage.setItem(RAIL_CACHE_KEY,JSON.stringify(lines));localStorage.setItem(RAIL_CACHE_TS_KEY,String(Date.now()));refreshRailLayers();
      }catch(e){console.warn('Official Vienna transit network could not load',e);toast('Transit overlay could not load; station and game logic remain usable.',3500);}
    })().finally(()=>{state.railLoadPromise=null;});
    return state.railLoadPromise;
  }

  function refreshRailLayers(){
    [['create-',state.createMap],['game-',state.gameMap]].forEach(([prefix,map])=>{
      if(!map||!state.mapData)return;
      state.mapLayers[prefix+'rails']?.remove();
      state.mapLayers[prefix+'rails']=L.geoJSON(turf.featureCollection(state.mapData.railLines||[]),{style:f=>mapGeoStyle('rail',f),interactive:false}).addTo(map);
      state.mapLayers[prefix+'stations']?.bringToFront?.();
    });
  }

  function processOsmGeoJSON(geo) {
    const features=geo.features||[];
    const city=features.find(f=>String(f.id||f.properties?.id||'').includes(String(VIENNA_RELATION_ID))&&isPolygon(f))||features.filter(isPolygon).sort((a,b)=>safeArea(b)-safeArea(a))[0];
    if(!city)throw new Error(`Vienna boundary relation ${VIENNA_RELATION_ID} has no usable polygon geometry.`);
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

  function mapGeoStyle(kind,feature=null){
    if(kind==='city')return {color:'#9ca3af',weight:1.5,fillOpacity:0};
    if(kind==='district')return {color:'#cbd5e1',weight:.8,dashArray:'4 6',fillOpacity:0,opacity:.65};
    if(kind==='rail'){
      const p=feature?.properties||{};
      const railway=p?.tags?.railway||p.railway;
      if(railway==='subway')return {color:p.routeColour||'#2563eb',weight:7,opacity:.96,lineCap:'round',lineJoin:'round'};
      if(railway==='s-bahn')return {color:p.routeColour||'#1769aa',weight:5.5,opacity:.92,lineCap:'round',lineJoin:'round'};
      if(railway==='rail-physical')return {color:'#64748b',weight:3.2,opacity:.58,lineCap:'round',lineJoin:'round'};
      return {color:p.routeColour||'#334155',weight:4,opacity:.75,lineCap:'round',lineJoin:'round'};
    }
    if(kind==='possible')return {color:'#2563eb',weight:2,fillColor:'#3b82f6',fillOpacity:.16};
    if(kind==='excluded')return {color:'#4b5563',weight:0,fillColor:'#4b5563',fillOpacity:.46};
    return {};
  }

  const TRANSIT_LINE_COLOURS={U1:'#e20613',U2:'#a762a3',U3:'#ef7c00',U4:'#00963f',U5:'#00a6a6',U6:'#9d6930'};
  function transitLineColour(ref){const r=String(ref||'').toUpperCase();if(TRANSIT_LINE_COLOURS[r])return TRANSIT_LINE_COLOURS[r];if(/^S\d+/i.test(r))return '#1769aa';return '#475569';}
  function stationMarkerBackground(feature){const refs=(feature?.properties?.lineRefs||[]).filter(Boolean);const colours=[...new Set(refs.map(transitLineColour))];if(!colours.length)return '#475569';if(colours.length===1)return colours[0];const step=360/colours.length;return `conic-gradient(${colours.map((c,i)=>`${c} ${i*step}deg ${(i+1)*step}deg`).join(',')})`;}
  function stationDivIcon(feature){const bg=stationMarkerBackground(feature);return L.divIcon({className:'station-marker-shell',iconSize:[18,18],html:`<span class="station-dot-inner" style="--station-bg:${bg}"></span>`});}
  function updateStationMarkerSize(map){if(!map)return;const z=map.getZoom();const px=z<=10?11.5:z<=11?12.5:z<=12?13.5:z<=13?14.5:16;map.getContainer().style.setProperty('--station-size',`${px}px`);}
  function bindStationMarkerSizing(map){if(map._hnsStationSizingBound)return;map._hnsStationSizingBound=true;map.on('zoomend',()=>updateStationMarkerSize(map));updateStationMarkerSize(map);}

  function drawReferenceLayers(map,prefix,onStationClick=null){
    const md=state.mapData;
    ['city','districts','rails','stations'].forEach(k=>state.mapLayers[prefix+k]?.remove());
    state.mapLayers[prefix+'city']=L.geoJSON(md.city,{style:mapGeoStyle('city'),interactive:false}).addTo(map);
    if(prefix!=='create-')state.mapLayers[prefix+'districts']=L.geoJSON(turf.featureCollection(md.districts.map(d=>d.feature)),{style:mapGeoStyle('district'),interactive:false}).addTo(map);
    state.mapLayers[prefix+'rails']=L.geoJSON(turf.featureCollection(md.railLines),{style:f=>mapGeoStyle('rail',f),interactive:false}).addTo(map);
    state.mapLayers[prefix+'stations']=L.geoJSON(turf.featureCollection(md.stations),{
      pointToLayer:(f,ll)=>L.marker(ll,{icon:stationDivIcon(f)}),
      onEachFeature:(f,layer)=>{layer.bindTooltip(`${f.properties?.stationName||'Station'}${f.properties?.lineRefs?.length?` · ${f.properties.lineRefs.join(', ')}`:''}`,{direction:'top',offset:[0,-7]});if(onStationClick)layer.on('click',e=>{L.DomEvent.stopPropagation(e);onStationClick(f);});}
    }).addTo(map);bindStationMarkerSizing(map);
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

  function populateCreateStationSelect(){
    const sel=$('createStationSelect');if(!sel||!state.mapData)return;
    sel.innerHTML='<option value="">Choose a station…</option>'+state.mapData.stations.map(st=>`<option value="${escapeHtml(st.properties.stationId)}">${escapeHtml(st.properties.stationName)}</option>`).join('');
    if(state.createStation)sel.value=state.createStation.properties.stationId;
  }

  async function setupCreateMap(){
    if(!state.createMap){ state.createMap=L.map('createMap',baseMapOptions()); addBaseTiles(state.createMap); }
    $('createStationStatus').className='status-box';$('createStationStatus').textContent='Loading U-Bahn and passenger-rail stations…';
    await ensureMapData();
    drawReferenceLayers(state.createMap,'create-',f=>selectCreateStation(f));
    populateCreateStationSelect();
    if(!state.createStation){$('createStationStatus').className='status-box good';$('createStationStatus').textContent='Choose a station from the list or tap a station marker on the map.';}
    renderCreateSelection();
    state.createMap.fitBounds(L.geoJSON(state.mapData.city).getBounds(),{padding:[8,8],animate:false});
  }

  function selectCreateStation(feature){
    state.createStation=feature;
    const [lng,lat]=feature.geometry.coordinates; $('createStationStatus').className='status-box good'; $('createStationStatus').textContent=`Selected: ${feature.properties.stationName} · ${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    if($('createStationSelect'))$('createStationSelect').value=feature.properties.stationId;
    renderCreateSelection();
  }

  function renderCreateSelection(){
    state.mapLayers.createStationRing?.remove(); state.mapLayers.createStationRing=null; state.mapLayers.createSelectedStation?.remove();
    if(!state.createStation)return;
    const [lng,lat]=state.createStation.geometry.coordinates;
    // Station phase is city-wide. The 250 m hiding radius is deliberately not shown here;
    // it becomes relevant only when the hider prepares/starts Endgame.
    state.mapLayers.createSelectedStation=L.marker([lat,lng],{icon:L.divIcon({className:'station-selected',iconSize:[18,18]})}).addTo(state.createMap).bindTooltip(state.createStation.properties.stationName);
    state.createMap.panTo([lat,lng]);
  }

  function getGps(){
    return new Promise((resolve,reject)=>{ if(!navigator.geolocation)return reject(new Error('This browser does not support geolocation.')); navigator.geolocation.getCurrentPosition(p=>resolve({lat:p.coords.latitude,lng:p.coords.longitude,accuracy_m:p.coords.accuracy}),e=>reject(new Error(`Location failed: ${e.message}`)),{enableHighAccuracy:true,timeout:15000,maximumAge:3000}); });
  }

  async function loadGames(){ initSupabaseIfNeeded(); const {data,error}=await state.supabase.from('games').select('id,name,status,created_at,final_score_seconds,finished_at').order('created_at',{ascending:false}); if(error)throw error; renderGameChoices(data||[]); return data||[]; }
  function renderGameChoices(games){
    const active=games.filter(g=>g.status==='active');
    $('hiderGameSelect').innerHTML=active.length?active.map(g=>`<option value="${escapeHtml(g.id)}">${escapeHtml(g.name)}</option>`).join(''):'<option value="">No active games</option>';
    $('gameList').innerHTML=games.length?games.map(g=>{const finished=g.status==='finished';return `<div class="game-entry ${finished?'finished':''}"><div><strong>${escapeHtml(g.name)}</strong><span>${finished?`Finished · ${formatCountdown(Number(g.final_score_seconds||0))}`:new Date(g.created_at).toLocaleString()}</span></div>${finished?'<span class="answer-pill">Ended</span>':`<button class="primary" data-enter-seeker="${g.id}">Enter</button>`}</div>`;}).join(''):'<div class="status-box">No games yet.</div>';
    $('gameList').querySelectorAll('[data-enter-seeker]').forEach(b=>b.addEventListener('click',()=>enterSeeker(b.dataset.enterSeeker).catch(handleError)));
  }

  async function createGame(){
    initSupabaseIfNeeded(); const name=$('createGameName').value.trim(),password=$('createPassword').value;
    if(!name)return toast('Enter a game name.'); if(password.length<4)return toast('Use a password of at least 4 characters.'); if(!state.createStation)return toast('Choose the hiding station.');
    const [slng,slat]=state.createStation.geometry.coordinates;
    const ok=await confirmAction('Create game?',`${name}
Hiding station: ${state.createStation.properties.stationName}`,'Create'); if(!ok)return;
    const {data,error}=await state.supabase.rpc('create_game_v4',{p_name:name,p_password:password,p_station_name:state.createStation.properties.stationName,p_station_lat:slat,p_station_lng:slng}); if(error)throw error; await enterHider(data,password);
  }

  function secretFromRow(r){
    const hidden=r.hidden_lat!=null&&r.hidden_lng!=null&&Number.isFinite(Number(r.hidden_lat))&&Number.isFinite(Number(r.hidden_lng))?turf.point([Number(r.hidden_lng),Number(r.hidden_lat)]):null;
    return {hidden,station:turf.point([Number(r.station_lng),Number(r.station_lat)]),station_name:r.station_name,endgame:!!r.endgame,base_radius_m:r.base_radius_m||BASE_HIDE_RADIUS_M};
  }

  async function enterHider(gameId,password){
    initSupabaseIfNeeded(); if(!gameId)return toast('Choose a game.');
    const {data,error}=await state.supabase.rpc('get_hider_game_v4',{p_game_id:gameId,p_password:password}); if(error)throw error; const r=data?.[0]; if(!r)return toast('Wrong hider password.');
    state.developerPreview=false;state.developerPreviewRole=null;state.role='hider'; state.hiderPassword=password; state.game={id:r.game_id,name:r.game_name,status:r.game_status}; state.secret=secretFromRow(r); await enterGameCommon();
  }
  async function enterSeeker(gameId){ initSupabaseIfNeeded(); const {data,error}=await state.supabase.from('games').select('id,name,status').eq('id',gameId).single(); if(error)throw error; state.developerPreview=false;state.developerPreviewRole=null;state.role='seeker';state.hiderPassword=null;state.secret=null;state.game=data;await enterGameCommon(); }

  async function enterDeveloperGame(gameId,role){
    initSupabaseIfNeeded();if(!state.developerPassword)throw new Error('Developer login required.');if(!['hider','seeker'].includes(role))throw new Error('Invalid preview role.');
    const {data,error}=await state.supabase.from('games').select('*').eq('id',gameId).single();if(error)throw error;
    state.developerPreview=true;state.developerPreviewRole=role;state.role=role;state.hiderPassword=null;state.secret=null;state.game=data;await enterGameCommon();
  }
  function clearDeveloperPreviewLock(){
    document.querySelectorAll('#gameView [data-dev-preview-disabled="1"]').forEach(el=>{el.disabled=false;delete el.dataset.devPreviewDisabled;});
  }
  function applyDeveloperPreviewReadOnly(){
    if(!state.developerPreview)return;
    document.querySelectorAll('#gameView button,#gameView input,#gameView select,#gameView textarea').forEach(el=>{
      if(el.matches('[data-action="leave-game"]'))return;
      if(!el.disabled){el.dataset.devPreviewDisabled='1';el.disabled=true;}
    });
    $('syncBadge').textContent='READ ONLY';$('syncBadge').className='badge warn';
  }

  function gameMapViewKey(){
    if(!state.game?.id||!state.role)return null;
    return `hns_game_map_view_v1_${state.developerPreview?'dev_':''}${state.game.id}_${state.role}`;
  }
  function saveGameMapView(){
    const key=gameMapViewKey();if(!key||!state.gameMap)return;
    try{const c=state.gameMap.getCenter(),z=state.gameMap.getZoom();if(Number.isFinite(c.lat)&&Number.isFinite(c.lng)&&Number.isFinite(z))localStorage.setItem(key,JSON.stringify({lat:c.lat,lng:c.lng,zoom:z}));}catch(_){}
  }
  function restoreGameMapView(){
    const key=gameMapViewKey();if(!key||!state.gameMap)return false;
    try{const v=JSON.parse(localStorage.getItem(key)||'null');if(v&&Number.isFinite(Number(v.lat))&&Number.isFinite(Number(v.lng))&&Number.isFinite(Number(v.zoom))){state.gameMap.setView([Number(v.lat),Number(v.lng)],Number(v.zoom),{animate:false});return true;}}catch(_){}
    return false;
  }
  function applyRoleLayout(){
    const main=$('mainColumn'),side=$('sideColumn');if(!main||!side)return;
    const pending=$('pendingQuestionsPanel'),actions=$('hiderActionCluster'),position=$('currentPositionPanel'),hider=$('hiderControls'),hand=$('hiderHandMainPanel'),traps=$('timeTrapsPanel'),active=$('activeCursePanel'),activity=$('activityPanel'),questions=$('questionMenu'),seekerControls=$('seekerControls'),endgame=$('seekerEndgamePanel');
    $('gameView').classList.toggle('layout-hider',state.role==='hider');$('gameView').classList.toggle('layout-seeker',state.role==='seeker');
    $('seekerQuestionLocation').classList.toggle('hidden',state.role!=='seeker');$('seekerEndgamePanel').classList.toggle('hidden',state.role!=='seeker');$('hiderControls').classList.toggle('hidden',state.role!=='hider');$('hiderHandMainPanel').classList.toggle('hidden',state.role!=='hider');$('timeTrapsPanel').classList.toggle('hidden',state.role!=='hider');
    if(state.role==='hider'){
      $('currentPositionEyebrow').textContent='HIDER POSITION';$('currentPositionTitle').textContent='Location';$('questionOriginStatus').textContent='Private';$('currentGpsButton').textContent='Use phone GPS';
      [pending,actions,position,hider,hand,traps,active,activity,questions].forEach(el=>el&&main.appendChild(el));
      if(seekerControls)side.appendChild(seekerControls);
    }else{
      $('currentPositionEyebrow').textContent='GPS MODE';$('currentPositionTitle').textContent='GPS mode';$('questionOriginStatus').textContent=state.seekerOriginMode==='gps'?'Automatic GPS':'Manual marker';$('currentGpsButton').textContent='Refresh GPS';
      [actions,position,active,endgame,pending,questions].forEach(el=>el&&main.appendChild(el));
      [seekerControls,activity].forEach(el=>el&&side.appendChild(el));
    }
  }

  async function enterGameCommon(){
    state.curseSoundPrimed=false;state.seenCurseIds=new Set();state.notificationPrimed=false;state.seenNotificationActionIds=new Set();state.photoUploadToken=null;state.photoUrlCache=new Map();state.previewQuestionSlot=null;state.previewQuestionCard=null;
    try{state.geometryWorker?.terminate();}catch(_){}state.geometryWorker=null;state.geometryWorkerSeq=0;state.geometryWorkerPending=new Map();
    state.geometryCache=new Map();state.geometryJobs=new Map();state.geometryWarmScheduled=false;state.possibleAreaSignature=null;state.possibleAreaCache=new Map();state.possibleAreaKm2=0;state.possibleExcludedArea=null;state.possibleRenderSignature=null;state.heavyPrepared=new Map();state.heavyPrepareJobs=new Map();state.answerGeometryCache=new Map();state.geometrySqlAvailable=null;state.heavyCanvasRenderer=null;state.sameLineMasks=new Map();state.heavyHistoryResults=new Map();state.heavyHistoryJobs=new Map();state.heavyFinalizeJobs=new Map();state.heavyAreaPending=false;
    await Promise.all([ensureMapData(),loadQuestionCatalog()]);
    clearDeveloperPreviewLock();
    $('roleKicker').textContent=`${state.role.toUpperCase()}${state.developerPreview?' · DEV PREVIEW':''}`; $('gameTitle').textContent=state.game.name; $('seekerControls').classList.toggle('hidden',state.role!=='seeker');
    applyRoleLayout();showView('gameView');setupGameMap();
    await syncServerClock(); subscribeRealtime(); startTimers(); setTimeout(()=>{try{ensureGeometryWorker();}catch(e){console.warn('Geometry worker warm-up unavailable',e);}},0); await reloadGameState();
  }

  function setupGameMap(){
    if(!state.gameMap){
      state.gameMap=L.map('gameMap',baseMapOptions());addBaseTiles(state.gameMap);state.gameMap.on('click',e=>handleGameMapClick(e.latlng));state.gameMap.on('moveend',saveGameMapView);
    }
    if(!state.gameMap.getPane('heavyGeometryPane')){const pane=state.gameMap.createPane('heavyGeometryPane');pane.style.zIndex='350';pane.style.pointerEvents='none';}
    if(!state.heavyCanvasRenderer)state.heavyCanvasRenderer=L.canvas({pane:'heavyGeometryPane',padding:.5,tolerance:4});
    state.gameMap.invalidateSize(false);clearPrivateMapLayers();drawReferenceLayers(state.gameMap,'game-',f=>handleReferenceStationClick(f));
    state.gameMap.fitBounds(L.geoJSON(state.mapData.city).getBounds(),{padding:[8,8],animate:false});
    setTimeout(()=>{state.gameMap?.invalidateSize(false);state.gameMap?.fitBounds(L.geoJSON(state.mapData.city).getBounds(),{padding:[8,8],animate:false});},80);
  }

  function handleReferenceStationClick(feature){
    if(state.role==='hider'&&state.turntablesPickMode){selectTurntablesStation(feature);return;}
    if(state.role==='hider'&&state.trapPlacementCard){placeTimeTrapAtStation(feature).catch(handleError);return;}
    if(state.role==='seeker'&&state.seekerEndgamePickMode){startSeekerEndgameAtStation(feature).catch(handleError);return;}
  }

  function handleGameMapClick(latlng){
    if(state.pickMode==='current_position'){state.pickMode=null;setCurrentPosition({lat:latlng.lat,lng:latlng.lng,accuracy_m:null,source:'map'});return;}
    if(state.role==='hider'&&state.endgamePickMode){state.endgamePickMode=false;setEndgameCandidate(latlng.lat,latlng.lng,null,'map');return;}
    if(state.role!=='seeker')return;
    if(state.pickMode==='question'&&state.pendingQuestionCard){ const card=state.pendingQuestionCard; state.pickMode=null;state.pendingQuestionCard=null; const origin={lat:latlng.lat,lng:latlng.lng,accuracy_m:null,source:'map'};setCurrentPosition(origin,{pan:false});handleQuestionCard(card,origin).catch(handleError); return; }
  }

  function setSeekerPointDisplay(origin){
    state.seekerPoint=origin?turf.point([origin.lng,origin.lat]):null; state.seekerAccuracyM=origin?.accuracy_m??null; state.seekerMarker?.remove();state.seekerAccuracyCircle?.remove();
    if(!origin){$('seekerLocationStatus').textContent='No question location has been sent.';return;}
    state.seekerMarker=L.marker([origin.lat,origin.lng]).addTo(state.gameMap).bindTooltip('Latest seeker question location');
    if(origin.accuracy_m)state.seekerAccuracyCircle=L.circle([origin.lat,origin.lng],{radius:origin.accuracy_m,className:'accuracy-circle',weight:1,fillOpacity:.05}).addTo(state.gameMap);
    const warn=origin.accuracy_m&&origin.accuracy_m>100; $('seekerLocationStatus').className=`status-box ${warn?'warn':'good'}`; $('seekerLocationStatus').textContent=`${origin.lat.toFixed(5)}, ${origin.lng.toFixed(5)} · ${origin.source==='gps'?`GPS ±${Math.round(origin.accuracy_m||0)} m`:'manual map location'}`;
  }

  function setCurrentPosition(origin,{pan=true}={}){
    if(!origin)return;
    state.currentPosition={lat:Number(origin.lat),lng:Number(origin.lng),accuracy_m:origin.accuracy_m==null?null:Number(origin.accuracy_m),source:origin.source||'map'};
    state.currentPositionMarker?.remove();state.currentPositionAccuracyCircle?.remove();
    state.currentPositionMarker=L.marker([state.currentPosition.lat,state.currentPosition.lng],{draggable:true}).addTo(state.gameMap).bindTooltip('Current position');
    state.currentPositionMarker.on('dragend',e=>{const p=e.target.getLatLng();setCurrentPosition({lat:p.lat,lng:p.lng,accuracy_m:null,source:'map'},{pan:false});});
    if(state.currentPosition.accuracy_m)state.currentPositionAccuracyCircle=L.circle([state.currentPosition.lat,state.currentPosition.lng],{radius:state.currentPosition.accuracy_m,className:'accuracy-circle',weight:1,fillOpacity:.04}).addTo(state.gameMap);
    const acc=state.currentPosition.source==='gps'&&state.currentPosition.accuracy_m?`GPS ±${Math.round(state.currentPosition.accuracy_m)} m`:'manual map location';
    $('currentPositionStatus').className=`status-box ${state.currentPosition.accuracy_m>100?'warn':'good'}`;
    $('currentPositionStatus').textContent=`${state.currentPosition.lat.toFixed(5)}, ${state.currentPosition.lng.toFixed(5)} · ${acc}`;
    if(pan)state.gameMap.panTo([state.currentPosition.lat,state.currentPosition.lng]);
    if(state.role==='seeker')renderQuestionDeck();
  }
  async function publishSeekerLivePosition(p){if(state.role!=='seeker'||!state.game)return;if(activeTurntablesAction())throw new Error('Seekers are frozen by Curse of the Turntables.');const {error}=await state.supabase.rpc('set_seeker_live_position_v1',{p_game_id:state.game.id,p_lat:p.lat,p_lng:p.lng,p_accuracy_m:p.accuracy_m??null});if(error)throw error;}
  function stopGpsAutoTracking(){if(state.gpsAutoTimer)clearInterval(state.gpsAutoTimer);state.gpsAutoTimer=null;state.gpsAutoEnabled=false;}
  async function refreshGpsAutoPosition(){if(!state.game||!state.gpsAutoEnabled)return;if(state.role==='seeker'&&activeTurntablesAction())return;try{const p=await getGps();state.lastGpsUpdateMs=Date.now();setCurrentPosition({...p,source:'gps'},{pan:false});if(state.role==='seeker')await publishSeekerLivePosition(p);}catch(e){console.warn('Automatic GPS refresh failed',e);}}
  function startGpsAutoTracking(){stopGpsAutoTracking();state.gpsAutoEnabled=true;state.gpsAutoTimer=setInterval(()=>refreshGpsAutoPosition(),30*60*1000);}
  async function useCurrentGps(){if(state.role==='seeker'&&activeTurntablesAction())return toast('Turntables: Seekers must stay put until the red timer ends.',5000);const p=await getGps();state.lastGpsUpdateMs=Date.now();setCurrentPosition({...p,source:'gps'});if(state.role==='seeker')await publishSeekerLivePosition(p);startGpsAutoTracking();$('currentPositionStatus').textContent+=' · auto 30 min';toast('GPS set.');}
  function beginManualCurrentPosition(){if(state.role==='seeker'&&activeTurntablesAction())return toast('Turntables: Seekers must stay put until the red timer ends.',5000);stopGpsAutoTracking();state.pickMode='current_position';toast('Tap the map to set your position.');}


  function cancelQuestionPreview(){
    state.previewQuestionSlot=null;state.previewQuestionCard=null;state.pendingQuestionCard=null;if(state.pickMode==='question')state.pickMode=null;clearPendingOverlay();clearPoiPreview();
  }

  async function resolveQuestionOrigin(card,providedOrigin=null){
    if(providedOrigin)return providedOrigin;
    let origin=state.currentPosition;
    if(state.seekerOriginMode==='gps'){
      const p=await getGps();origin={...p,source:'gps'};setCurrentPosition(origin,{pan:false});
    }else if(!origin){
      state.pendingQuestionCard=card;state.pickMode='question';toast(`Tap the map to set the current position for ${card.title}.`);return null;
    }
    return {...origin};
  }

  function nearestRailStation(origin){
    if(!origin||!state.mapData?.stations?.length)return null;let best=null,bestD=Infinity;const pt=turf.point([Number(origin.lng),Number(origin.lat)]);
    for(const f of state.mapData.stations){const refs=(f.properties?.lineRefs||[]).filter(r=>/^[US]\d+/i.test(r));if(!refs.length)continue;const d=turf.distance(pt,f,{units:'meters'});if(d<bestD){bestD=d;best=f;}}
    return best?{feature:best,distance_m:bestD,lineRefs:(best.properties?.lineRefs||[]).filter(r=>/^[US]\d+/i.test(r))}:null;
  }
  function matchingTransitFeatures(refs){const wanted=new Set((refs||[]).map(String));return (state.mapData?.railLines||[]).filter(f=>(f.properties?.routeRefs||[]).some(r=>wanted.has(String(r))));}
  function sameLineCorridor(refs,radiusM=250){let out=null;for(const f of matchingTransitFeatures(refs)){try{const b=turf.buffer(f,Number(radiusM)/1000,{units:'kilometers',steps:12});out=safeUnion(out,b);}catch(_){}}return out;}
  function interchangeStationArea(radiusM=250,onlyRefs=null){
    let out=null;const wanted=onlyRefs?new Set((onlyRefs||[]).map(r=>String(r).toUpperCase())):null;
    for(const f of state.mapData?.stations||[]){
      const refs=[...new Set((f.properties?.lineRefs||[]).map(r=>String(r).toUpperCase()).filter(r=>/^[US]\d+/i.test(r)))];
      if(refs.length<2)continue;if(wanted&&!refs.some(r=>wanted.has(r)))continue;
      try{out=safeUnion(out,turf.buffer(f,Number(radiusM)/1000,{units:'kilometers',steps:24}));}catch(_){}
    }
    return out;
  }
  function sameLineExclusiveCorridor(refs,radiusM=250){
    const selected=(refs||[]).map(r=>String(r).toUpperCase()),selectedSet=new Set(selected);const selectedCorridor=sameLineCorridor(selected,radiusM);if(!selectedCorridor)return null;
    let preserve=interchangeStationArea(radiusM,selected),search=selectedCorridor;
    try{search=turf.buffer(selectedCorridor,Number(radiusM)/1000,{units:'kilometers',steps:8});}catch(_){}
    for(const f of state.mapData?.railLines||[]){
      const routeRefs=(f.properties?.routeRefs||[]).map(r=>String(r).toUpperCase());if(!routeRefs.some(r=>!selectedSet.has(r)))continue;
      try{if(!turf.booleanIntersects(f,search))continue;const buffered=turf.buffer(f,Number(radiusM)/1000,{units:'kilometers',steps:8}),overlap=safeIntersect(buffered,selectedCorridor);if(overlap)preserve=safeUnion(preserve,overlap);}catch(_){}
    }
    return preserve?(safeDifference(selectedCorridor,preserve)||null):selectedCorridor;
  }
  function availableRailLineRefs(){
    const refs=new Set();
    for(const f of state.mapData?.railLines||[])for(const r of f.properties?.routeRefs||[])if(/^[US]\d+/i.test(String(r)))refs.add(String(r).toUpperCase());
    for(const f of state.mapData?.stations||[])for(const r of f.properties?.lineRefs||[])if(/^[US]\d+/i.test(String(r)))refs.add(String(r).toUpperCase());
    return [...refs].sort((a,b)=>{const pa=a[0]===b[0]?0:(a[0]==='U'?-1:1);if(pa)return pa;return Number(a.slice(1))-Number(b.slice(1))||a.localeCompare(b);});
  }

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
  function geometryRpcMissing(error){
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
  function sameLineMaskMemoryKey(q,signature){return `${q?.id||'q'}|masks|${hashGeometryText(signature)}`;}
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
  function finalizeHeavyAnsweredQuestion(q,answer,answerActionId,variant,domain,signature){
    if(!q||!answer||!answerActionId||!domain||state.heavyAreaPending)return Promise.resolve();const gameId=state.game?.id,key=String(answerActionId);if(state.heavyFinalizeJobs.has(key))return state.heavyFinalizeJobs.get(key);
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
  }
  async function prepareHeavyQuestion(q){
    if(state.role!=='hider'||!q||!state.possibleArea||state.heavyAreaPending||!heavyCanUseCurrentDomain(q))return null;
    const kind=q.payload?.question_kind;if(!['same_line','tentacle','bus_line_tentacle'].includes(kind))return null;
    const signature=heavyDomainSignature(q),jobKey=`prepare:${q.id}:${hashGeometryText(signature)}`;
    if(state.heavyPrepareJobs.has(jobKey))return state.heavyPrepareJobs.get(jobKey);
    const job=(async()=>{
      const domain=state.possibleArea,p=q.payload||{};
      if(kind==='same_line')return prepareSameLineMasks(q,signature);
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
    if(!heavyCanUseCurrentDomain(q))return null;const prepared=await prepareHeavyQuestion(q);
    if(q.payload?.question_kind==='same_line')return null;rec=prepared?.cache_key?prepared:(state.heavyPrepared.get(mk)||null);return rec;
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
  function heavyHistoryKey(q,answer,invert,expected){const aid=activeAnswerForQuestion(q.id)?.id||'answer';return `${q.id}|${aid}|${hashGeometryText(expected)}|${invert?'i':'n'}`;}
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
      const f=stations[i],refs=[...new Set((f.properties?.lineRefs||[]).map(r=>String(r).toUpperCase()).filter(r=>/^[US]\d+/i.test(r)))];
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
    if(state.role!=='hider'||state.geometryWarmScheduled||!state.game||!state.possibleArea)return;state.geometryWarmScheduled=true;
    setTimeout(async()=>{
      try{for(const q of heavyPendingQuestions()){if(['same_line','tentacle','bus_line_tentacle'].includes(q.payload?.question_kind))await prepareHeavyQuestion(q);await geometryIdleYield(220);}}
      catch(e){console.warn('Background geometry warmup failed',e);}finally{state.geometryWarmScheduled=false;}
    },350);
  }
  function possibleAreaStateSignature(){
    const zone=latestAction('endgame_zone'),phase=targetPhaseStartMs(),flipped=[...passierscheinFlippedQuestionIds()].map(String).sort();
    const qs=effectiveActions('question').filter(q=>!phase||new Date(q.created_at).getTime()>phase).sort((a,b)=>new Date(a.created_at)-new Date(b.created_at)).map(q=>{const a=activeAnswerForQuestion(q.id);return[q.id,a?.id||'',a?.payload?.answer?.geometry_cache_key||'',activeVetoForQuestion(q.id)?.id||''];});
    return JSON.stringify([state.game?.id||'',zone?.id||'',currentAreaMultiplier(),tinyHouseRadiusFactor(),flipped,qs]);
  }
  function cachePossibleArea(signature,possible){
    if(!state.possibleAreaCache)state.possibleAreaCache=new Map();state.possibleAreaCache.delete(signature);state.possibleAreaCache.set(signature,possible);
    while(state.possibleAreaCache.size>POSSIBLE_AREA_CACHE_LIMIT)state.possibleAreaCache.delete(state.possibleAreaCache.keys().next().value);
  }
  function excludedGeometryKey(signature){return `excluded:${signature}`;}
  function applyExcludedGeometryIfCurrent(signature,geometry){
    if(state.possibleAreaSignature!==signature||state.possibleRenderSignature!==signature||!state.gameMap)return;state.possibleExcludedArea=geometry;
    state.mapLayers.excluded?.remove();state.mapLayers.excluded=null;if(geometry)state.mapLayers.excluded=L.geoJSON(geometry,{style:mapGeoStyle('excluded'),interactive:false,renderer:state.heavyCanvasRenderer,smoothFactor:2.5}).addTo(state.gameMap);
    state.mapLayers['game-rails']?.bringToFront?.();state.mapLayers['game-stations']?.bringToFront?.();state.mapLayers.publicTimeTraps?.bringToFront?.();
  }
  function scheduleExcludedGeometry(signature,possible){
    if(!possible||!signature||state.heavyAreaPending)return;if(possible===state.mapData.city){state.possibleExcludedArea=null;return;}const key=excludedGeometryKey(signature),cached=geometryCacheGet(key);if(cached){applyExcludedGeometryIfCurrent(signature,cached);return;}
    geometryJob(key,()=>runGeometryWorker('difference_optimize',{a:state.mapData.city,b:possible,tolerance:0.00004,min_vertex_m:4},90000)).then(ex=>applyExcludedGeometryIfCurrent(signature,ex)).catch(e=>console.warn('Excluded-area background build failed',e));
  }


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

  function districtSetGeometry(numbers){
    const wanted=new Set((numbers||[]).map(Number)),features=(state.mapData?.districts||[]).filter(d=>wanted.has(Number(d.number))).map(d=>d.feature);
    if(!features.length)return null;if(features.length===1)return features[0];
    try{return turf.combine(turf.featureCollection(features)).features[0]||null;}catch(e){console.warn('district set combine',e);let out=null;for(const f of features)out=safeUnion(out,f);return out;}
  }

  async function askQuestionPayload(card,payload,description){
    const ok=await confirmAction('Send this question?',`${description}\n\nThe Hider gets 15 minutes to resolve it before late-answer penalties begin.`,`Send ${card.title}`);
    if(!ok)return false;
    const {error}=await state.supabase.rpc('ask_question_v4',{p_game_id:state.game.id,p_slot_key:card.slot,p_kind:card.kind,p_payload:payload});
    if(error)throw error;
    cancelQuestionPreview();await reloadGameState();return true;
  }

  async function handleQuestionCard(card,providedOrigin=null){
    if(state.role!=='seeker')return;
    if(activeTurntablesAction())return toast('Turntables: stay put. Questions unlock when the red timer reaches 0:00.',5000);
    const blockingCurse=activeCurseActions().find(a=>['fiaker','side_quest'].includes(a.payload?.effect_key));
    if(blockingCurse){
      const effect=blockingCurse.payload?.effect_key;
      const message=effect==='fiaker'
        ? 'Spot a Fiaker and clear the curse before asking another question.'
        : 'The Side Quest is still active. New questions unlock when its 45-minute timer ends.';
      return toast(message,5000);
    }
    if(activeQuestionForSlot(card.slot))return toast('That question has already been asked.');
    if(card.endgame_only&&!latestAction('endgame_zone'))return toast(`${card.title} is available in Endgame.`);
    if(state.previewQuestionSlot&&state.previewQuestionSlot!==card.slot)cancelQuestionPreview();

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

    if(card.kind==='tentacle'){
      if(state.previewQuestionSlot===card.slot&&state.previewQuestionCard?.pois&&state.previewQuestionCard?.origin){
        const pois=state.previewQuestionCard.pois,origin=state.previewQuestionCard.origin;
        const payload={slot_key:card.slot,question_kind:'tentacle',title:card.title,poi_type:card.poi_type,valid_distance_m:TENTACLE_VALID_DISTANCE_M,search_radius_m:TENTACLE_SEARCH_RADIUS_M,origin,pois};
        const ok=await confirmAction(`Ask ${card.title} Tentacle?`,`${pois.length} ${card.title.toLowerCase()} are within 5 km.\n\nIf the Hider is more than 250 m from your position, this becomes a 250 m miss and that circle is ruled out. Otherwise the nearest-POI cut applies.`,`Ask Tentacle`);
        if(!ok){cancelQuestionPreview();renderQuestionDeck();return;}
        const {error}=await state.supabase.rpc('ask_question_v4',{p_game_id:state.game.id,p_slot_key:card.slot,p_kind:'tentacle',p_payload:payload});if(error)throw error;
        cancelQuestionPreview();await reloadGameState();return;
      }
      const origin=await resolveQuestionOrigin(card,providedOrigin);if(!origin)return;
      toast(`Loading ${card.title}…`,3000);
      const all=await loadPoiType(card.poi_type),originPoint=turf.point([origin.lng,origin.lat]);
      const candidates=all.filter(p=>turf.distance(originPoint,p,{units:'meters'})<=TENTACLE_SEARCH_RADIUS_M+1);
      const pois=candidates.map(p=>({id:p.properties.poiId,name:p.properties.poiName,lat:p.geometry.coordinates[1],lng:p.geometry.coordinates[0]}));
      state.previewQuestionSlot=card.slot;state.previewQuestionCard={...card,pois,origin};showPoiPreview(pois);showTentacleRangePreview(origin);renderQuestionDeck();
      toast(`${pois.length} ${card.title.toLowerCase()} within 5 km. Tap the same Tentacle again to ask it.`,5000);return;
    }

    if(card.kind==='photo'){
      cancelQuestionPreview();
      const payload={slot_key:card.slot,question_kind:'photo',title:card.title,photo_prompt:card.photo_prompt};
      await askQuestionPayload(card,payload,`Photo question: ${card.photo_prompt}`);return;
    }

    if(card.kind==='street_shape'){
      cancelQuestionPreview();
      const payload={slot_key:card.slot,question_kind:'street_shape',title:card.title};
      await askQuestionPayload(card,payload,'Current Street Shape · Endgame');return;
    }

    if(card.kind==='thermometer'){
      const ref=state.thermoReferences?.[card.slot]||null;
      const origin=await resolveQuestionOrigin(card,providedOrigin);if(!origin)return;
      if(!ref){
        const ok=await confirmAction(`Start ${card.title}?`,`Point A: ${origin.lat.toFixed(5)}, ${origin.lng.toFixed(5)}${origin.accuracy_m?`\nGPS accuracy ±${Math.round(origin.accuracy_m)} m.`:'\nManual map location.'}\n\nMove ${formatDistance(card.min_travel_m)}; the card turns green when ready.`,`Start Thermometer`);
        if(!ok)return;
        const {error}=await state.supabase.rpc('start_thermometer_v1',{p_game_id:state.game.id,p_slot_key:card.slot,p_min_travel_m:card.min_travel_m,p_lat:origin.lat,p_lng:origin.lng,p_accuracy_m:origin.accuracy_m??null,p_source:origin.source||'gps'});if(error)throw error;
        cancelQuestionPreview();await reloadGameState();return;
      }
      const travelled=turf.distance(turf.point([Number(ref.lng),Number(ref.lat)]),turf.point([origin.lng,origin.lat]),{units:'meters'});
      if(travelled+0.5<card.min_travel_m){renderQuestionDeck();return toast(`${card.title}: ${Math.round(travelled)} / ${card.min_travel_m} m.`);}
      const payload={slot_key:card.slot,question_kind:'thermometer',title:card.title,origin,from:{lat:Number(ref.lat),lng:Number(ref.lng)},to:{lat:origin.lat,lng:origin.lng},min_travel_m:card.min_travel_m};
      previewQuestionGeometry(payload);state.previewQuestionSlot=card.slot;state.previewQuestionCard=card;
      const desc=`${card.title}\nTravelled: ${Math.round(travelled)} m\n\nThe yellow perpendicular is the exact WARMER/COLDER cut.`;
      const sent=await askQuestionPayload(card,payload,desc);if(!sent){state.previewQuestionSlot=card.slot;state.previewQuestionCard=card;renderQuestionDeck();}return;
    }

    if(card.kind==='same_line'){
      const line=state.sameLineSelection||availableRailLineRefs()[0];if(!line)return toast('No U-/S-Bahn line data are available.');
      const payload={slot_key:card.slot,question_kind:'same_line',title:card.title,selected_line:line,line_refs:[line]};
      previewQuestionGeometry(payload);state.previewQuestionSlot=card.slot;state.previewQuestionCard=card;
      const sent=await askQuestionPayload(card,payload,`${card.title}\nSelected line: ${line}`);if(!sent){state.previewQuestionSlot=card.slot;state.previewQuestionCard=card;renderQuestionDeck();}return;
    }

    if(card.kind==='station_interchange'){
      const payload={slot_key:card.slot,question_kind:'station_interchange',title:card.title,radius_m:250};
      previewQuestionGeometry(payload);state.previewQuestionSlot=card.slot;state.previewQuestionCard=card;
      const sent=await askQuestionPayload(card,payload,`${card.title}\nInterchange = at least two U-/S-Bahn lines.`);if(!sent){state.previewQuestionSlot=card.slot;state.previewQuestionCard=card;renderQuestionDeck();}return;
    }

    if(card.kind==='district_set'){
      const payload={slot_key:card.slot,question_kind:'district_set',title:card.title,districts:card.districts,yes_label:card.yes_label||'Yes',no_label:card.no_label||'No'};
      previewQuestionGeometry(payload);state.previewQuestionSlot=card.slot;state.previewQuestionCard=card;
      const sent=await askQuestionPayload(card,payload,`${card.title}\nDistricts: ${card.districts.join(', ')}`);if(!sent){state.previewQuestionSlot=card.slot;state.previewQuestionCard=card;renderQuestionDeck();}return;
    }

    const origin=await resolveQuestionOrigin(card,providedOrigin);if(!origin)return;
    let payload={slot_key:card.slot,question_kind:card.kind,title:card.title,origin};let description=`${card.title}\nOrigin: ${origin.lat.toFixed(5)}, ${origin.lng.toFixed(5)}${origin.accuracy_m?` · GPS ±${Math.round(origin.accuracy_m)} m`:' · manual'}`;
    if(card.kind==='landmark_compare'){
      const landmark=card.landmark;const r=Math.round(turf.distance(turf.point([origin.lng,origin.lat]),turf.point([landmark.lng,landmark.lat]),{units:'meters'}));
      payload.landmark_name=card.landmark_name;payload.landmark=landmark;payload.radius_m=r;description+=`\nYour distance to ${card.landmark_name}: ${formatDistance(r)}`;previewQuestionGeometry(payload);
    }else if(card.kind==='radar'){
      payload.center={lat:origin.lat,lng:origin.lng};payload.radius_m=card.radius_m;previewQuestionGeometry(payload);
      if(origin.accuracy_m&&origin.accuracy_m>Math.max(25,card.radius_m/2))description+=`\nGPS accuracy ±${Math.round(origin.accuracy_m)} m.`;
    }else if(card.kind==='district'){
      const d=pointDistrict(turf.point([origin.lng,origin.lat]));if(!d)return toast('This position is outside Vienna.');payload.district_number=d.number;payload.district_name=d.name;description+=`\nDistrict: ${d.number}. ${d.name}`;previewQuestionGeometry(payload);
    }else if(card.kind==='directional'){
      payload.axis=card.axis;payload.positive_label=card.positive_label;payload.negative_label=card.negative_label;previewQuestionGeometry(payload);
    }
    state.previewQuestionSlot=card.slot;state.previewQuestionCard=card;
    const sent=await askQuestionPayload(card,payload,description);if(!sent){state.previewQuestionSlot=card.slot;state.previewQuestionCard=card;renderQuestionDeck();}
  }

  async function loadPoiType(type){
    if(state.poiCache[type])return state.poiCache[type];
    const sourceTypes=type==='zoo'?['zoo','aquarium']:[type];
    const merged=[];const seen=new Set();
    for(const sourceType of sourceTypes){
      let pois=null;
      try{const ref=await referenceDataset(REF_POI_PREFIX+sourceType+'_v1');if(Array.isArray(ref?.pois))pois=ref.pois;}catch(e){console.warn('POI reference lookup failed',sourceType,e);}
      if(!pois){const cached=localStorage.getItem(POI_CACHE_PREFIX+sourceType);if(cached){try{const obj=JSON.parse(cached);if(Array.isArray(obj.pois))pois=obj.pois;}catch(_){}}}
      for(const p of pois||[]){const key=String(p.id||`${Number(p.lat).toFixed(6)},${Number(p.lng).toFixed(6)},${p.name||''}`);if(seen.has(key))continue;seen.add(key);merged.push(turf.point([p.lng,p.lat],{poiId:p.id,poiName:p.name,poiType:type,sourcePoiType:sourceType}));}
    }
    if(merged.length){state.poiCache[type]=merged;return merged;}
    throw new Error(`${humanize(type)} reference data are not fully seeded in Supabase. Open Developer and refresh that category.`);
  }
  function parsePoiElements(osm,type){
    return (osm.elements||[]).map((e,i)=>{const lat=e.lat??e.center?.lat,lng=e.lon??e.center?.lon;if(!Number.isFinite(lat)||!Number.isFinite(lng))return null;return{id:`${e.type}/${e.id??i}`,name:e.tags?.name||e.tags?.['name:de']||`${humanize(type)} ${i+1}`,lat,lng};}).filter(Boolean);
  }

  function humanize(s){return String(s).replaceAll('_',' ').replace(/\b\w/g,c=>c.toUpperCase());}
  function pointInPossible(p){try{return !!state.possibleArea&&turf.booleanPointInPolygon(p,state.possibleArea);}catch(_){return false;}}

  function showPoiPreview(pois){
    clearPoiPreview(); const fc=turf.featureCollection(pois.map(p=>turf.point([p.lng,p.lat],{name:p.name,id:p.id})));
    state.mapLayers.poiPreview=L.geoJSON(fc,{pointToLayer:(f,ll)=>L.marker(ll,{icon:L.divIcon({className:'poi-dot',iconSize:[11,11]})}),onEachFeature:(f,l)=>l.bindTooltip(f.properties.name)}).addTo(state.gameMap);
  }
  function showTentacleRangePreview(origin){
    state.mapLayers.pendingTentacleSearch?.remove();state.mapLayers.pendingTentacleVeto?.remove();
    state.mapLayers.pendingTentacleSearch=L.circle([origin.lat,origin.lng],{radius:TENTACLE_SEARCH_RADIUS_M,color:'#f59e0b',weight:3,dashArray:'8 6',fillColor:'#f59e0b',fillOpacity:.025}).addTo(state.gameMap).bindTooltip('Tentacle POIs · 5 km');
    state.mapLayers.pendingTentacleVeto=L.circle([origin.lat,origin.lng],{radius:TENTACLE_VALID_DISTANCE_M,color:'#dc2626',weight:2,dashArray:'5 5',fillColor:'#ef4444',fillOpacity:.06}).addTo(state.gameMap).bindTooltip('250 m automatic-veto range');
    state.mapLayers.poiPreview?.bringToFront?.();
  }
  function clearPoiPreview(){state.mapLayers.poiPreview?.remove();state.mapLayers.poiReach?.remove();state.mapLayers.poiPreview=null;state.mapLayers.poiReach=null;}
  function clearPendingOverlay(){
    ['pendingCircle','pendingLine','pendingDistrict','pendingBisector','pendingThermoPath','pendingDirection','pendingSameLine','pendingDistrictSet','pendingTentacleCell','pendingTentacleSearch','pendingTentacleVeto'].forEach(k=>{state.mapLayers[k]?.remove();state.mapLayers[k]=null;});
  }
  function thermometerBisectorLine(from,to){
    const A=mercator(from.lat,from.lng),B=mercator(to.lat,to.lng);const dx=B.x-A.x,dy=B.y-A.y,len=Math.hypot(dx,dy);if(len<1)return null;
    const tx=-dy/len,ty=dx/len,M={x:(A.x+B.x)/2,y:(A.y+B.y)/2},L=150000;return [unmercator({x:M.x+tx*L,y:M.y+ty*L}),unmercator({x:M.x-tx*L,y:M.y-ty*L})];
  }
  function previewQuestionGeometry(p){
    clearPendingOverlay();
    if(p.question_kind==='radar')state.mapLayers.pendingCircle=L.circle([p.center.lat,p.center.lng],{radius:p.radius_m,color:'#f59e0b',weight:3,dashArray:'7 5',fillColor:'#f59e0b',fillOpacity:.13}).addTo(state.gameMap);
    if(p.question_kind==='district'){
      const d=state.mapData?.districts?.find(x=>x.number===Number(p.district_number));
      if(d)state.mapLayers.pendingDistrict=L.geoJSON(d.feature,{style:{color:'#f59e0b',weight:3,dashArray:'7 5',fillColor:'#f59e0b',fillOpacity:.15},interactive:false}).addTo(state.gameMap);
    }
    if(p.question_kind==='district_set'){
      const g=districtSetGeometry(p.districts||[]);if(g)state.mapLayers.pendingDistrictSet=L.geoJSON(g,{style:{color:'#f59e0b',weight:3,dashArray:'7 5',fillColor:'#f59e0b',fillOpacity:.15},interactive:false}).addTo(state.gameMap);
    }
    if(p.question_kind==='landmark_compare'&&p.landmark&&Number.isFinite(Number(p.radius_m))){
      state.mapLayers.pendingCircle=L.circle([Number(p.landmark.lat),Number(p.landmark.lng)],{radius:Number(p.radius_m),color:'#f59e0b',weight:3,dashArray:'7 5',fillColor:'#f59e0b',fillOpacity:.13}).addTo(state.gameMap).bindTooltip(`${p.landmark_name||'Landmark'} benchmark`);
    }
    if(p.question_kind==='same_line'&&Array.isArray(p.line_refs)){
      const features=matchingTransitFeatures(p.line_refs);if(features.length)state.mapLayers.pendingSameLine=L.geoJSON({type:'FeatureCollection',features},{style:{color:'#f59e0b',weight:7,opacity:.8},interactive:false}).addTo(state.gameMap);
    }
    if(p.question_kind==='station_interchange'){
      const g=interchangeStationArea(Number(p.radius_m||250));if(g)state.mapLayers.pendingDistrictSet=L.geoJSON(g,{style:{color:'#f59e0b',weight:3,dashArray:'7 5',fillColor:'#f59e0b',fillOpacity:.13},interactive:false}).addTo(state.gameMap).bindTooltip('Interchange station areas');
    }
    if(p.question_kind==='directional'&&p.origin){
      const lat=Number(p.origin.lat),lng=Number(p.origin.lng),line=p.axis==='lat'?[[lat,lng-1],[lat,lng+1]]:[[lat-1,lng],[lat+1,lng]];
      state.mapLayers.pendingDirection=L.polyline(line,{color:'#f59e0b',weight:4,dashArray:'8 5',opacity:.95}).addTo(state.gameMap);
    }
    if(p.question_kind==='thermometer'){
      state.mapLayers.pendingThermoPath=L.polyline([[p.from.lat,p.from.lng],[p.to.lat,p.to.lng]],{color:'#fbbf24',weight:2,dashArray:'4 6',opacity:.8}).addTo(state.gameMap);
      const line=thermometerBisectorLine(p.from,p.to);if(line)state.mapLayers.pendingBisector=L.polyline(line.map(x=>[x.lat,x.lng]),{color:'#f59e0b',weight:4,dashArray:'8 5',opacity:.95}).addTo(state.gameMap);
    }
  }

  function actionMap(){return new Map(state.actions.map(a=>[a.id,a]));}
  function isActionEffective(action,byId=actionMap(),memo=new Map()){
    if(!action||!action.is_active)return false;if(memo.has(action.id))return memo.get(action.id);let effective=true;if(action.parent_id)effective=isActionEffective(byId.get(action.parent_id),byId,memo);
    memo.set(action.id,effective);return effective;
  }
  function effectiveActions(kind=null){const byId=actionMap(),memo=new Map();return state.actions.filter(a=>(!kind||a.kind===kind)&&isActionEffective(a,byId,memo));}
  function targetPhaseStartMs(){const r=latestAction('turntables_relocate');return r?new Date(r.created_at).getTime():0;}
  function activeQuestionForSlot(slot){const phase=targetPhaseStartMs();return effectiveActions('question').find(a=>(!phase||new Date(a.created_at).getTime()>phase)&&a.payload?.slot_key===slot)||null;}
  function activeAnswerForQuestion(id){return effectiveActions('answer').filter(a=>a.parent_id===id).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at))[0]||null;}
  function activeVetoForQuestion(id){return effectiveActions('question_veto').find(a=>a.parent_id===id)||null;}
  function latestAction(kind){return effectiveActions(kind).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at))[0]||null;}

  function hiderTargetPoint(){if(state.role!=='hider'||!state.secret)return null;return state.secret.endgame?(state.secret.hidden||state.secret.station):state.secret.station;}
  function suggestedAnswer(q){
    const target=hiderTargetPoint(); if(!target)return null; const p=q.payload||{};
    if(p.question_kind==='radar'){const d=turf.distance(target,turf.point([p.center.lng,p.center.lat]),{units:'meters'});return {type:'boolean',value:d<=Number(p.radius_m),text:d<=Number(p.radius_m)?`HIT — target is ${Math.round(d)} m away.`:`MISS — target is ${Math.round(d)} m away.`};}
    if(p.question_kind==='district'){const d=pointDistrict(target);const yes=d?.number===Number(p.district_number);return {type:'boolean',value:yes,text:yes?`YES — target is in ${p.district_number}. ${p.district_name}.`:`NO — target is in ${d?`${d.number}. ${d.name}`:'another area'}.`};}
    if(p.question_kind==='district_set'){const d=pointDistrict(target),yes=!!d&&(p.districts||[]).map(Number).includes(Number(d.number));return {type:'boolean',value:yes,text:`${yes?(p.yes_label||'YES'):(p.no_label||'NO')} — target district: ${d?`${d.number}. ${d.name}`:'unknown'}.`};}
    if(p.question_kind==='landmark_compare'){const landmark=turf.point([Number(p.landmark.lng),Number(p.landmark.lat)]),d=turf.distance(target,landmark,{units:'meters'}),yes=d<=Number(p.radius_m);return {type:'boolean',value:yes,text:`${yes?'YES':'NO'} — target is ${Math.round(d)} m from ${p.landmark_name||'the landmark'}.`};}
    if(p.question_kind==='same_line'){const [lng,lat]=state.secret.station.geometry.coordinates;const hs=nearestRailStation({lat,lng});const targetRefs=new Set(hs?.lineRefs||[]),common=(p.line_refs||[]).filter(r=>targetRefs.has(r));const yes=common.length>0;return {type:'boolean',value:yes,text:yes?`YES — ${common.join(', ')} serves the hiding station.`:`NO — ${(p.line_refs||[]).join(', ')} does not serve the hiding station.`};}
    if(p.question_kind==='station_interchange'){const [lng,lat]=state.secret.station.geometry.coordinates;const hs=nearestRailStation({lat,lng});const refs=[...new Set(hs?.lineRefs||[])];const yes=refs.length>=2;return {type:'boolean',value:yes,text:yes?`YES — hiding station serves ${refs.join(', ')}.`:`NO — hiding station serves ${refs.join(', ')||'one U-/S-Bahn line'}.`};}
    if(p.question_kind==='directional'){const [lng,lat]=target.geometry.coordinates;const yes=p.axis==='lat'?lat>=Number(p.origin.lat):lng>=Number(p.origin.lng);return {type:'boolean',value:yes,text:`${yes?(p.positive_label||'YES'):(p.negative_label||'NO')}.`};}
    if(p.question_kind==='thermometer'){const from=turf.point([p.from.lng,p.from.lat]),to=turf.point([p.to.lng,p.to.lat]);const df=turf.distance(target,from,{units:'meters'}),dt=turf.distance(target,to,{units:'meters'});const yes=dt<df;return {type:'boolean',value:yes,text:`${yes?'WARMER':'COLDER'} — ${Math.round(df)} m → ${Math.round(dt)} m from the private target.`};}
    if(p.question_kind==='bus_line_tentacle'){
      if(!state.secret?.endgame||!state.secret?.hidden)return {type:'bus_line_tentacle',status:'unavailable',text:'Nearest Bus Line requires the actual Endgame hiding spot.'};
      const refs=p.candidate_line_refs||[],best=nearestBusLineToPoint(target,refs,p.bus_features||[]);if(!best)return {type:'bus_line_tentacle',status:'unavailable',text:'No candidate bus-line geometry is available.'};
      return {type:'bus_line_tentacle',status:'line',line_ref:best.line_ref,nearest_distance_m:best.distance_m,text:`Closest line: ${best.line_ref}.`};
    }
    if(p.question_kind==='tentacle'){
      if(!state.secret?.endgame||!state.secret?.hidden)return {type:'tentacle',status:'unavailable',text:'Tentacles require the actual Endgame hiding spot.'};
      const limit=Number(p.valid_distance_m||TENTACLE_VALID_DISTANCE_M),origin=p.origin;if(!origin)return {type:'tentacle',status:'unavailable',text:'Tentacle origin is missing.'};
      const seekerD=turf.distance(target,turf.point([Number(origin.lng),Number(origin.lat)]),{units:'meters'});
      if(seekerD>limit)return {type:'tentacle',status:'auto_veto',radar_miss:true,text:`AUTO-VETO — Hider is outside the ${limit} m Tentacle range. The ${limit} m circle will be ruled out.`};
      const pois=p.pois||[];let best=null,bestD=Infinity;for(const poi of pois){const d=turf.distance(target,turf.point([poi.lng,poi.lat]),{units:'meters'});if(d<bestD){bestD=d;best=poi;}}
      if(!best)return {type:'tentacle',status:'auto_veto',radar_miss:false,text:'AUTO-VETO — no candidate POI exists inside the 5 km Tentacle search area.'};
      return {type:'tentacle',status:'poi',poi:best,nearest_distance_m:bestD,text:`Suggested answer: closest to ${best.name}.`};
    }
    return null;
  }

  function booleanResolutionLabel(q,value){const k=q.payload?.question_kind;if(k==='thermometer')return value?'Warmer':'Colder';if(k==='radar')return value?'Hit':'Miss';if(k==='directional')return value?(q.payload?.positive_label||'Yes'):(q.payload?.negative_label||'No');return value?'Yes':'No';}
  async function answerBoolean(q,value){
    const s=suggestedAnswer(q),pen=currentQuestionPenaltyMinutes(q),label=booleanResolutionLabel(q,value);const ok=await confirmAction(`Send ${label}?`,`${questionLabel(q)}\n\nPreview: ${s?.text||'Unavailable'}${pen?`\n\nLate penalty: −${pen} min`:''}`,`Send ${label}`);if(!ok)return;
    const answer={type:'boolean',value};let finalize=null;
    if(q.payload?.question_kind==='same_line'){const variant=value?'yes':'no',signature=heavyDomainSignature(q),domain=state.possibleArea;answer.geometry_variant=variant;answer.geometry_domain_signature=signature;finalize={variant,signature,domain};}
    const {data,error}=await state.supabase.rpc('answer_question_v5',{p_game_id:state.game.id,p_question_action_id:q.id,p_password:state.hiderPassword,p_answer:answer});if(error)throw error;
    if(finalize&&data)finalizeHeavyAnsweredQuestion(q,answer,data,finalize.variant,finalize.domain,finalize.signature);
    await reloadGameState();
  }
  async function answerTentacle(q){
    const s=suggestedAnswer(q); if(s?.status!=='poi'||!s.poi)return toast('This Tentacle does not currently have a valid POI answer.');
    const answer={type:'tentacle',status:'poi',poi:s.poi};
    const ok=await confirmAction('Send Tentacle answer?',`${questionLabel(q)}

Public answer:
Hider is closest to ${s.poi.name}.

Automatic private check: ${s.text}

Only the POI name is sent publicly; the private validation distance is never included in the answer.${currentQuestionPenaltyMinutes(q)?`\n\nCurrent late penalty: −${currentQuestionPenaltyMinutes(q)} min`:''}`,`Send answer`);if(!ok)return;
    const variant=`poi:${s.poi.id||s.poi.name||'poi'}`,signature=heavyDomainSignature(q),domain=state.possibleArea;answer.geometry_variant=variant;answer.geometry_domain_signature=signature;
    const {data,error}=await state.supabase.rpc('answer_question_v5',{p_game_id:state.game.id,p_question_action_id:q.id,p_password:state.hiderPassword,p_answer:answer});if(error)throw error;
    if(data)finalizeHeavyAnsweredQuestion(q,answer,data,variant,domain,signature);await reloadGameState();
  }

  async function answerBusLineTentacle(q){
    const s=suggestedAnswer(q);if(s?.status!=='line'||!s.line_ref)return toast('No valid bus-line answer is available. Refresh districts + transit if necessary.');
    const answer={type:'bus_line_tentacle',status:'line',line_ref:s.line_ref},pen=currentQuestionPenaltyMinutes(q);
    const ok=await confirmAction('Send Nearest Bus Line answer?',`${questionLabel(q)}\n\nClosest line: ${s.line_ref}.\n\nOnly the line identity is published; the private distance is not.${pen?`\n\nCurrent late penalty: −${pen} min`:''}`,`Send answer`);if(!ok)return;
    const variant=`line:${String(s.line_ref).toUpperCase()}`,signature=heavyDomainSignature(q),domain=state.possibleArea;answer.geometry_variant=variant;answer.geometry_domain_signature=signature;
    const {data,error}=await state.supabase.rpc('answer_bus_line_tentacle_v1',{p_game_id:state.game.id,p_question_action_id:q.id,p_password:state.hiderPassword,p_answer:answer});if(error)throw error;
    if(data)finalizeHeavyAnsweredQuestion(q,answer,data,variant,domain,signature);await reloadGameState();
  }

  async function autoVetoTentacle(q){
    const s=suggestedAnswer(q); if(s?.status!=='auto_veto')return toast('This Tentacle has a valid POI answer and should not be automatically vetoed.');
    const ok=await confirmAction('Confirm automatic Tentacle veto?',`${questionLabel(q)}

${s.text}

This does not consume a Veto card and awards no card draw. If the Hider is outside the 250 m range, the Seekers' 250 m circle is ruled out. No private distance is published.${currentQuestionPenaltyMinutes(q)?`\n\nCurrent late penalty: −${currentQuestionPenaltyMinutes(q)} min`:''}`,`Veto Tentacle`,true);if(!ok)return;
    const {error}=await state.supabase.rpc('auto_veto_tentacle_v5',{p_game_id:state.game.id,p_question_action_id:q.id,p_password:state.hiderPassword});if(error)throw error;await reloadGameState();
  }

  function photoExtension(file){
    const name=String(file?.name||'').toLowerCase();const ext=name.includes('.')?name.split('.').pop():'';
    if(['jpg','jpeg','png','webp','heic','heif'].includes(ext))return ext==='jpeg'?'jpg':ext;
    const type=String(file?.type||'');if(type==='image/png')return'png';if(type==='image/webp')return'webp';if(type==='image/heic')return'heic';if(type==='image/heif')return'heif';return'jpg';
  }
  function photoMime(file){const type=String(file?.type||'');if(type.startsWith('image/'))return type;const ext=photoExtension(file);return ext==='png'?'image/png':ext==='webp'?'image/webp':ext==='heic'?'image/heic':ext==='heif'?'image/heif':'image/jpeg';}
  async function uploadPhotoAnswer(q,file){
    if(!file)return toast('Choose a photo first.');
    if(file.type&&!String(file.type).startsWith('image/'))return toast('Please choose an image file.');
    if(file.size>25*1024*1024)return toast('Photo is larger than the 25 MB upload limit.');
    const penalty=currentQuestionPenaltyMinutes(q);
    const ok=await confirmAction('Send this photo?',`${questionLabel(q)}\n\n${file.name||'Selected image'} · ${(file.size/1024/1024).toFixed(1)} MB${penalty?`\nCurrent late-answer penalty: −${penalty} min`:''}\n\nThe original image will be uploaded and becomes visible to the seekers in the activity log.`,`Upload & send`);if(!ok)return;
    const {data:path,error:ticketErr}=await state.supabase.rpc('create_photo_upload_ticket_v1',{p_game_id:state.game.id,p_password:state.hiderPassword,p_extension:photoExtension(file)});if(ticketErr)throw ticketErr;if(!path)throw new Error('Could not create a photo upload ticket.');
    const {error:upErr}=await state.supabase.storage.from('game-photos').upload(path,file,{cacheControl:'3600',upsert:false,contentType:photoMime(file)});if(upErr)throw upErr;
    const answer={type:'photo',photo_path:path,filename:file.name||'photo',mime_type:file.type||null,size_bytes:file.size,prompt:q.payload?.photo_prompt||q.payload?.title||'Photo'};
    const {error}=await state.supabase.rpc('answer_question_v5',{p_game_id:state.game.id,p_question_action_id:q.id,p_password:state.hiderPassword,p_answer:answer});if(error)throw error;
    const old=state.photoPreviewUrls.get(q.id);if(old)URL.revokeObjectURL(old);state.photoPreviewUrls.delete(q.id);state.photoFiles.delete(q.id);await reloadGameState();
  }
  async function nearestStreetGeometryForHider(){
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
  function streetShapeBlob(street){
    const canvas=document.createElement('canvas');canvas.width=600;canvas.height=600;const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,600,600);
    // Keep true map orientation: east stays right and north stays up. Only the stroke is stylized.
    const pts=street.coords.map(([lng,lat])=>mercator(lat,lng));const xs=pts.map(p=>p.x),ys=pts.map(p=>p.y),w=Math.max(1,Math.max(...xs)-Math.min(...xs)),h=Math.max(1,Math.max(...ys)-Math.min(...ys)),scale=Math.min(440/w,440/h);const mx=(Math.max(...xs)+Math.min(...xs))/2,my=(Math.max(...ys)+Math.min(...ys))/2;
    let seed=Number(street.id||17)%9973;const rnd=()=>{seed=(seed*9301+49297)%233280;return seed/233280;};
    const pix=pts.map(p=>({x:300+(p.x-mx)*scale,y:300-(p.y-my)*scale}));ctx.lineCap='round';ctx.lineJoin='round';
    for(let pass=0;pass<3;pass++){ctx.beginPath();for(let i=0;i<pix.length;i++){const jx=(rnd()-.5)*(pass===0?5:3),jy=(rnd()-.5)*(pass===0?5:3),x=pix[i].x+jx,y=pix[i].y+jy;if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);}ctx.strokeStyle=pass===0?'rgba(0,0,0,.50)':pass===1?'rgba(0,0,0,.70)':'rgba(0,0,0,.90)';ctx.lineWidth=pass===0?8:pass===1?5:2.5;ctx.stroke();}
    return new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('Could not render street shape.')),'image/png'));
  }
  async function prepareStreetShape(q){
    const street=await nearestStreetGeometryForHider(),blob=await streetShapeBlob(street),file=new File([blob],'street-shape.png',{type:'image/png'});const old=state.photoPreviewUrls.get(q.id);if(old)URL.revokeObjectURL(old);const url=URL.createObjectURL(blob);state.photoPreviewUrls.set(q.id,url);state.photoFiles.set(q.id,file);renderPendingQuestions();toast('Street shape ready.');
  }

  async function signedPhotoUrl(path){
    if(!path)return null;const cached=state.photoUrlCache.get(path);if(cached&&cached.expires>Date.now()+30000)return cached.url;
    const {data,error}=await state.supabase.storage.from('game-photos').createSignedUrl(path,3600);if(error)throw error;
    const url=data?.signedUrl||null;if(url)state.photoUrlCache.set(path,{url,expires:Date.now()+3500*1000});return url;
  }
  async function hydratePhotoMedia(){
    const nodes=[...document.querySelectorAll('[data-photo-path]')];
    await Promise.all(nodes.map(async el=>{const path=el.dataset.photoPath;if(!path)return;try{const url=await signedPhotoUrl(path);if(!url)return;if(el.tagName==='IMG')el.src=url;else{const img=el.querySelector('img');if(img)img.src=url;el.onclick=()=>openPhotoModal(url,el.dataset.photoTitle||'Photo answer');}}catch(e){console.warn('Photo load failed',e);}}));
  }
  function openPhotoModal(url,title='Photo answer'){$('photoModalTitle').textContent=title;$('photoModalImage').src=url;$('photoModal').classList.remove('hidden');}
  function closePhotoModal(){$('photoModal').classList.add('hidden');$('photoModalImage').removeAttribute('src');}

  function availableHandCards(effectKey=null){
    const cards=[];
    for(const d of state.hiderDraws){
      if(!drawIsEarned(d))continue;
      const kept=new Set(d.kept_card_keys||[]),used=new Set(d.used_card_keys||[]);
      for(const c of d.cards||[])if(kept.has(c.card_key)&&!used.has(c.card_key)&&(!effectKey||c.effect_key===effectKey))cards.push({...c,draw_id:d.id});
    }
    // Duplicate creates a genuine second hand instance stored privately in Supabase.
    // It deliberately does not alter the original draw or the source card.
    for(const u of state.privateCardUses||[]){
      if(!u?.is_active||u.effect_key!=='duplicate_copy')continue;
      const c=u.metadata?.card;
      if(!c||typeof c!=='object')continue;
      const copy={...c,card_key:u.card_key||c.card_key,duplicate_instance:true,duplicate_use_id:u.id};
      if(!effectKey||copy.effect_key===effectKey)cards.push(copy);
    }
    return cards;
  }
  async function vetoQuestion(q){
    const veto=availableHandCards('veto_question')[0];if(!veto)return toast('No unused Veto Question card is in your hand.');
    const pen=currentQuestionPenaltyMinutes(q);const ok=await confirmAction('Veto this question?',`${questionLabel(q)}

This consumes ${veto.title}. No answer is sent and this question remains used/greyed out.${pen?`

Current late penalty: −${pen} min`:''}`,'Use veto',true);if(!ok)return;
    const {error}=await state.supabase.rpc('veto_question_v4',{p_game_id:state.game.id,p_question_action_id:q.id,p_password:state.hiderPassword,p_card_key:veto.card_key});if(error)throw error;await reloadGameState();
  }

  async function toggleKeepCard(draw,cardKey,active){const c=draw.cards.find(x=>x.card_key===cardKey);const ok=await confirmAction(`${active?'Keep':'Undo keep'} card?`,`${c?.title||cardKey}\n${c?.description||''}\n\nThis draw lets you keep ${draw.keep_limit} card${draw.keep_limit===1?'':'s'}.`,active?'Keep card':'Undo keep',!active);if(!ok)return;const {error}=await state.supabase.rpc('toggle_keep_card_v3',{p_game_id:state.game.id,p_draw_id:draw.id,p_password:state.hiderPassword,p_card_key:cardKey,p_active:active});if(error)throw error;await reloadGameState();}

  async function discardHeldCard(card){const ok=await confirmAction('Discard this card?',`${card.title}\n\nIt leaves your hand and goes to the discard pile until a future reshuffle.`,'Discard',true);if(!ok)return;const {error}=await state.supabase.rpc('discard_held_card_v1',{p_game_id:state.game.id,p_password:state.hiderPassword,p_card_key:card.card_key});if(error)throw error;await reloadGameState();}

  function cardCostKind(card){return card?.cast_cost_kind||((Number(card?.cast_cost_minutes||0)>0)?'time':'none');}
  function castCategoryLabel(category){return ({curse:'another Curse',veto:'a Veto',time_bonus:'a Time Bonus',powerup:'a Power-up',time_trap:'a Time Trap'})[category]||'the required card';}
  function cardMatchesCastCategory(card,category){if(category==='curse')return card?.card_kind==='curse';if(category==='veto')return card?.effect_key==='veto_question';if(category==='time_bonus')return card?.card_kind==='time_bonus';if(category==='powerup')return card?.card_kind==='powerup';if(category==='time_trap')return card?.effect_key==='time_trap'||card?.card_kind==='time_trap';return false;}
  function cardCostLabel(card){const kind=cardCostKind(card);if(kind==='time')return `${Number(card.cast_cost_minutes||0)} min`;if(kind==='custom')return card.cast_cost_text||'Custom cost';if(kind==='discard_any')return 'Discard 1 other card';if(kind==='discard_category')return `Discard ${castCategoryLabel(card.cast_cost_category)}`;return '';}
  function chooseCastingCost(card,excludedKeys=[]){
    const kind=cardCostKind(card),cost=Number(card.cast_cost_minutes||0),excluded=new Set(excludedKeys.filter(Boolean));excluded.add(card.card_key);
    if(kind==='none'||kind==='custom')return Promise.resolve([]);
    if(kind==='time'){
      const bonuses=availableHandCards().filter(c=>c.card_kind==='time_bonus'&&!excluded.has(c.card_key));
      if(cost<=0)return Promise.resolve([]);if(bonuses.reduce((sum,c)=>sum+Number(c.value_int||0),0)<cost){toast(`You need ${cost} minutes of time bonuses to cast ${card.title}.`);return Promise.resolve(null);}
      return new Promise(resolve=>{state.castResolver=resolve;state.castCard=card;$('castTitle').textContent=`Pay ${cost} min to cast ${card.title}`;if($('castHelp'))$('castHelp').textContent='Select time-bonus cards to spend. Whole cards are consumed, so overpayment is allowed.';$('castOptions').innerHTML=bonuses.map(c=>`<label class="cast-option"><input type="checkbox" value="${escapeHtml(c.card_key)}" data-value="${Number(c.value_int||0)}"><span><strong>${escapeHtml(c.title)}</strong><small>${Number(c.value_int||0)} min</small></span></label>`).join('');const update=()=>{const checked=[...$('castOptions').querySelectorAll('input:checked')];const total=checked.reduce((sum,x)=>sum+Number(x.dataset.value||0),0);$('castTotal').textContent=`Selected: ${total} / ${cost} min${total>cost?` · ${total-cost} min overpayment`:''}`;$('castConfirm').disabled=total<cost;};$('castOptions').querySelectorAll('input').forEach(x=>x.addEventListener('change',update));update();$('castConfirm').textContent='Use selected bonuses';$('castModal').classList.remove('hidden');});
    }
    if(kind==='discard_any'||kind==='discard_category'){
      const category=card.cast_cost_category||'',candidates=availableHandCards().filter(c=>!excluded.has(c.card_key)&&(kind==='discard_any'||cardMatchesCastCategory(c,category)));
      if(!candidates.length){toast(kind==='discard_any'?`You need another held card to cast ${card.title}.`:`You need ${castCategoryLabel(category)} in your hand to cast ${card.title}.`);return Promise.resolve(null);}
      return new Promise(resolve=>{state.castResolver=resolve;state.castCard=card;$('castTitle').textContent=`Discard a card to cast ${card.title}`;if($('castHelp'))$('castHelp').textContent=kind==='discard_any'?'Choose one other held card. It will be consumed as the casting cost.':`Choose ${castCategoryLabel(category)}. It will be consumed as the casting cost.`;$('castOptions').innerHTML=candidates.map(c=>`<label class="cast-option"><input type="radio" name="discard-cast-card" value="${escapeHtml(c.card_key)}"><span><strong>${escapeHtml(c.title)}</strong><small>${escapeHtml(c.card_kind==='time_bonus'?`${Number(c.value_int||0)} min bonus`:humanize(c.card_kind))}</small></span></label>`).join('');const update=()=>{const checked=$('castOptions').querySelector('input:checked');$('castTotal').textContent=checked?'1 card selected':'Choose 1 card';$('castConfirm').disabled=!checked;};$('castOptions').querySelectorAll('input').forEach(x=>x.addEventListener('change',update));update();$('castConfirm').textContent='Discard & cast';$('castModal').classList.remove('hidden');});
    }
    return Promise.resolve([]);
  }
  function closeCastModal(value){$('castModal').classList.add('hidden');const r=state.castResolver;state.castResolver=null;state.castCard=null;r?.(value);}

  function clearProsperousPreview(){state.mapLayers.prosperousPreview?.remove();state.mapLayers.prosperousPreview=null;}
  function previewProsperousZone(extraEffects=1){
    clearProsperousPreview();if(state.role!=='hider'||!state.secret?.station||!state.gameMap)return;
    const [lng,lat]=state.secret.station.geometry.coordinates;const base=Number(state.secret?.base_radius_m||BASE_HIDE_RADIUS_M);const radius=base*Math.sqrt(currentAreaMultiplier()*Math.pow(2,extraEffects))*tinyHouseRadiusFactor();
    state.mapLayers.prosperousPreview=L.circle([lat,lng],{radius,color:'#eab308',weight:3,dashArray:'7 6',fillColor:'#fde047',fillOpacity:.10}).addTo(state.gameMap).bindTooltip(`Prosperous Home preview · ${Math.round(radius)} m`);
  }

  function clearCursePreview(){state.mapLayers.cursePreview?.remove();state.mapLayers.cursePreview=null;}
  function wineHikeLayer(style='preview'){
    const group=L.layerGroup();
    for(const p of WINE_HIKE_POINTS){
      const icon=L.divIcon({className:`wine-hike-marker ${style}`,html:'<span>🍷</span>',iconSize:[28,28],iconAnchor:[14,14]});
      L.marker([p.lat,p.lng],{icon}).bindTooltip(`${p.name} · ${p.route}`).addTo(group);
    }
    return group;
  }
  function forbiddenDistrictLayer(numbers){
    const wanted=new Set((numbers||[]).map(Number)),features=(state.mapData?.districts||[]).filter(d=>wanted.has(Number(d.number))).map(d=>d.feature);
    if(!features.length)return null;return L.geoJSON(turf.featureCollection(features),{style:{color:'#dc2626',weight:2,fillColor:'#ef4444',fillOpacity:.22},interactive:false});
  }
  function showCursePreview(card,payload={}){
    clearCursePreview();if(state.role!=='hider'||!state.gameMap)return;
    const group=L.layerGroup(),effect=card.effect_key;
    if(effect==='wean_ned_schlecht_redn')wineHikeLayer('preview').eachLayer(l=>group.addLayer(l));
    if(effect==='haute_vollee'){const l=forbiddenDistrictLayer([1,18,19]);if(l)group.addLayer(l);}
    if(effect==='deutsche_bahn'&&payload.blocked_line){for(const f of matchingTransitFeatures([payload.blocked_line]))L.geoJSON(f,{style:{color:'#dc2626',weight:8,opacity:.78},interactive:false}).bindTooltip(`${payload.blocked_line} blocked`).addTo(group);}
    if(effect==='mordor_curse'){
      const blocked=payload.mode==='inside'?(state.mapData?.districts||[]).map(d=>Number(d.number)).filter(n=>![21,22].includes(n)):[21,22];const l=forbiddenDistrictLayer(blocked);if(l)group.addLayer(l);
    }
    if(group.getLayers().length){group.addTo(state.gameMap);state.mapLayers.cursePreview=group;}
  }
  async function effectPayloadForCard(card){
    if(card.effect_key==='deutsche_bahn'){
      const refs=availableRailLineRefs();if(!refs.length){toast('Transit line data are not loaded yet.');return null;}
      let suggested='';if(state.seekerLivePosition){const n=nearestRailStation({lat:Number(state.seekerLivePosition.lat),lng:Number(state.seekerLivePosition.lng)});suggested=n?.lineRefs?.[0]||'';}
      const raw=window.prompt(`Which U-/S-Bahn line is blocked?

${refs.join(', ')}`,suggested||refs[0]);if(raw===null)return null;const line=String(raw).trim().toUpperCase();if(!refs.includes(line)){toast('Choose a line from the cached Vienna network.');return null;}return {blocked_line:line};
    }
    if(card.effect_key==='mordor_curse'){
      let inside=null;if(state.seekerLivePosition){const d=pointDistrict(turf.point([Number(state.seekerLivePosition.lng),Number(state.seekerLivePosition.lat)]));if(d)inside=[21,22].includes(Number(d.number));}
      if(inside===null)inside=window.confirm(`Are the Seekers currently in district 21 or 22?\n\nOK = yes, they must stay in Mordor.\nCancel = no, they may not enter Mordor.`);
      return {mode:inside?'inside':'outside'};
    }
    return {};
  }

  async function playHandCard(card){
    if(card.card_kind==='time_bonus')return toast('Time bonuses stay in your hand until scoring or casting.');
    if(card.effect_key==='veto_question')return toast('Use Veto on an open question.');
    if(card.effect_key==='time_trap'){state.trapPlacementCard=card;toast('Tap a station to place the Time Trap.');return;}
    if(card.effect_key==='duplicate'){await useDuplicate(card);return;}
    if(card.effect_key==='turntables'){await playTurntables(card);return;}
    if(card.effect_key==='double_or_nothing'){await useDoubleOrNothing(card);return;}
    if(card.effect_key==='ma48'){await useMA48(card);return;}
    if(card.effect_key==='kleingedrucktes'){await useKleingedrucktes(card);return;}
    if(card.effect_key==='same_day_delivery'){await useSameDayDelivery(card);return;}
    if(card.effect_key==='deceptive_tiny_house'){await useDeceptiveTinyHouse(card);return;}
    if(card.effect_key==='passierschein_a38'){await usePassierscheinA38(card);return;}
    if(card.effect_key==='reshuffle_deck'){const ok=await confirmAction('Fresh Shuffle?','Reshuffle the discard pile into a new draw pile. Cards in your hand stay out.','Shuffle');if(!ok)return;const {error}=await state.supabase.rpc('use_reshuffle_card_v1',{p_game_id:state.game.id,p_password:state.hiderPassword,p_card_key:card.card_key});if(error)throw error;await reloadGameState();return;}
    const prosperous=card.effect_key==='prosperous_home';if(prosperous)previewProsperousZone(1);
    let effectPayload={};
    try{
      effectPayload=await effectPayloadForCard(card);if(effectPayload===null)return;showCursePreview(card,effectPayload);
      const costKeys=await chooseCastingCost(card);if(costKeys===null)return;
      let msg=card.description||'Curse';if(card.duration_seconds)msg+=`
Duration: ${formatDuration(card.duration_seconds)}.`;
      if(prosperous){const r=Number(state.secret?.base_radius_m||BASE_HIDE_RADIUS_M)*Math.sqrt(currentAreaMultiplier()*2)*tinyHouseRadiusFactor();msg+=`
Hiding radius: ${Math.round(currentEndgameRadius())} m → ${Math.round(r)} m.`;}
      const costLabel=cardCostLabel(card);if(costLabel)msg+=`
Cost: ${costLabel}.`;
      if(card.effect_key==='deutsche_bahn')msg+=`
Blocked line: ${effectPayload.blocked_line}.`;
      if(card.effect_key==='wean_ned_schlecht_redn')msg+=`\nThe server checks Vienna time when cast: Monday through Tuesday 11:59 = 1 h halt; otherwise the Weinwanderweg access points become the objective.`;
      if(card.effect_key==='mordor_curse')msg+=`
Mode: ${effectPayload.mode==='inside'?'Seekers must stay in districts 21/22':'Seekers must stay out of districts 21/22'}.`;
      const ok=await confirmAction(`Play ${card.title}?`,msg,'Play');if(!ok)return;
      const {error}=await state.supabase.rpc('play_card_v5',{p_game_id:state.game.id,p_password:state.hiderPassword,p_card_key:card.card_key,p_copy_card_key:null,p_cost_card_keys:costKeys||[],p_effect_payload:effectPayload});if(error)throw error;await reloadGameState();
    } finally {if(prosperous)clearProsperousPreview();clearCursePreview();}
  }

  async function usePassierscheinA38(card){
    const ok=await confirmAction('Play Curse of the Passierschein A38?',`${card.description||'For 10 minutes, previous deductions may be displayed incorrectly.'}

Casting cost: roll an odd number on a die.

Confirm only after the Hider has rolled an odd number.`, 'I rolled odd');
    if(!ok)return;
    const {error}=await state.supabase.rpc('use_passierschein_a38_v1',{p_game_id:state.game.id,p_password:state.hiderPassword,p_card_key:card.card_key});if(error)throw error;
    await reloadGameState();toast('Passierschein A38 active for 10 minutes.',5000);
  }
  function activePassierscheinAction(){return activeCurseActions().find(a=>a.payload?.effect_key==='passierschein_a38')||null;}
  function passierscheinFlippedQuestionIds(){const a=activePassierscheinAction();return new Set(Array.isArray(a?.payload?.flipped_question_ids)?a.payload.flipped_question_ids.map(String):[]);}

  async function playTurntables(card){
    if(activeTurntablesAction())return toast('Curse of the Turntables is already active.');
    const ok=await confirmAction('Play Curse of the Turntables?',`${card.description||''}

The main clock freezes for 20 minutes. Seekers cannot move or ask questions. Pick a different hiding station before the red timer expires. Confirming the new station resets the target phase, Endgame and Prosperous Home effects. The next 3 Seeker questions give no card reward.`,`Turn the tables`);
    if(!ok)return;
    const {error}=await state.supabase.rpc('play_turntables_v1',{p_game_id:state.game.id,p_password:state.hiderPassword,p_card_key:card.card_key});if(error)throw error;
    state.turntablesPickMode=false;state.turntablesCandidate=null;await reloadGameState();toast('Turntables! Pick a new station within 20 minutes.',5000);
  }
  function activeTurntablesAction(){return activeCurseActions().find(a=>a.payload?.effect_key==='turntables')||null;}
  function turntablesRelocationFor(action){if(!action)return null;return effectiveActions('turntables_relocate').find(a=>a.parent_id===action.id)||null;}
  function clearTurntablesCandidate(){state.turntablesPickMode=false;state.turntablesCandidate=null;state.mapLayers.turntablesCandidate?.remove();state.mapLayers.turntablesCandidate=null;renderTurntablesPanel();}
  function selectTurntablesStation(feature){
    const active=activeTurntablesAction();if(!active||turntablesRelocationFor(active))return;
    if(feature.properties?.stationName===state.secret?.station_name)return toast('Turntables requires another hiding station.');
    state.turntablesCandidate=feature;state.turntablesPickMode=false;state.mapLayers.turntablesCandidate?.remove();
    const [lng,lat]=feature.geometry.coordinates;state.mapLayers.turntablesCandidate=L.marker([lat,lng],{icon:L.divIcon({className:'turntables-candidate',html:'↻',iconSize:[28,28],iconAnchor:[14,14]})}).addTo(state.gameMap).bindTooltip(`New station: ${feature.properties.stationName}`);
    renderTurntablesPanel();
  }
  async function confirmTurntablesStation(){
    const active=activeTurntablesAction(),feature=state.turntablesCandidate;if(!active||!feature)return toast('Choose a different station first.');
    const [lng,lat]=feature.geometry.coordinates;const ok=await confirmAction('Relocate here?',`${feature.properties.stationName}

This becomes the new secret station. Previous deductions and Endgame reset; Prosperous Home returns to the base 250 m zone. The next 3 answered Seeker questions give no card reward. The main clock still resumes only when the 20-minute Turntables timer ends.`,`Confirm station`);if(!ok)return;
    const {error}=await state.supabase.rpc('relocate_turntables_v1',{p_game_id:state.game.id,p_password:state.hiderPassword,p_curse_action_id:active.id,p_station_name:feature.properties.stationName,p_station_lat:lat,p_station_lng:lng});if(error)throw error;
    clearTurntablesCandidate();await reloadGameState();toast('New hiding station locked in.');
  }
  function renderTurntablesPanel(){
    const panel=$('turntablesPanel');if(!panel)return;const active=activeTurntablesAction();
    if(state.role!=='hider'||!active){panel.classList.add('hidden');clearTurntablesCandidateSilently();return;}
    panel.classList.remove('hidden');const relocation=turntablesRelocationFor(active),end=new Date(active.payload.ends_at).getTime(),rem=Math.max(0,Math.ceil((end-serverNowMs())/1000));
    $('turntablesPanelTimer').textContent=formatCountdown(rem);
    const status=$('turntablesStatus'),pick=$('turntablesPickButton'),confirm=$('turntablesConfirmButton'),cancel=$('turntablesCancelButton');
    if(relocation){status.textContent='New station selected. Seekers remain frozen until the red timer reaches 0:00. The next 3 Seeker questions give no card reward.';pick.classList.add('hidden');confirm.classList.add('hidden');cancel.classList.add('hidden');return;}
    if(state.turntablesCandidate){status.textContent=`Selected: ${state.turntablesCandidate.properties.stationName}`;pick.textContent='Choose another station';confirm.classList.remove('hidden');cancel.classList.remove('hidden');}
    else{status.textContent=state.turntablesPickMode?'Tap a station marker on the map.':'Choose a different hiding station before time runs out.';pick.textContent=state.turntablesPickMode?'Choosing…':'Choose new station';confirm.classList.add('hidden');cancel.classList.toggle('hidden',!state.turntablesPickMode);}
    pick.classList.remove('hidden');
  }
  function clearTurntablesCandidateSilently(){state.turntablesPickMode=false;state.turntablesCandidate=null;state.mapLayers.turntablesCandidate?.remove();state.mapLayers.turntablesCandidate=null;}

  function renderTurntablesFreezeControls(){const frozen=state.role==='seeker'&&!!activeTurntablesAction();['currentGpsButton','currentMapButton','currentClearButton','seekerEndgameButton'].forEach(id=>{const el=$(id);if(el)el.disabled=frozen;});const pos=$('currentPositionStatus');if(frozen&&pos){pos.textContent='Turntables · stay put until the red timer ends.';}else if(state.role==='seeker'&&pos&&pos.textContent.startsWith('Turntables')){if(state.currentPosition)setCurrentPosition({...state.currentPosition},{pan:false});else pos.textContent='No current position set.';}}

  async function useDoubleOrNothing(card){
    const targets=availableHandCards().filter(c=>c.card_key!==card.card_key&&c.card_kind==='curse'&&cardCostKind(c)==='time'&&Number(c.cast_cost_minutes||0)>0&&Number(c.duration_seconds||0)>0);
    if(!targets.length)return toast('Double or Nothing needs a timed Curse with a time-bonus casting cost.');
    const raw=window.prompt(`Choose the Curse to double:\n${targets.map((c,i)=>`${i+1}. ${c.title} · ${Number(c.cast_cost_minutes)} min → ${Number(c.cast_cost_minutes)*2} min · ${formatDuration(c.duration_seconds)} → ${formatDuration(Number(c.duration_seconds)*2)}`).join('\n')}`);
    if(raw===null)return;const idx=Number(raw)-1;if(!Number.isInteger(idx)||idx<0||idx>=targets.length)return toast('Invalid choice.');const target=targets[idx];
    const effectPayload=await effectPayloadForCard(target);if(effectPayload===null)return;showCursePreview(target,effectPayload);
    try{
      const doubled={...target,cast_cost_minutes:Number(target.cast_cost_minutes||0)*2,cast_cost_kind:'time'};
      const costKeys=await chooseCastingCost(doubled,[card.card_key,target.card_key]);if(costKeys===null)return;
      const ok=await confirmAction('Double or Nothing?',`${target.title}\n\nCasting cost: ${Number(target.cast_cost_minutes)} → ${Number(target.cast_cost_minutes)*2} min\nDuration: ${formatDuration(target.duration_seconds)} → ${formatDuration(Number(target.duration_seconds)*2)}\n\nBoth Double or Nothing and the Curse are consumed.`,`Double it`);if(!ok)return;
      const {error}=await state.supabase.rpc('use_double_or_nothing_v1',{p_game_id:state.game.id,p_password:state.hiderPassword,p_powerup_card_key:card.card_key,p_curse_card_key:target.card_key,p_cost_card_keys:costKeys||[],p_effect_payload:effectPayload});if(error)throw error;
      await reloadGameState();
    } finally {clearCursePreview();}
  }

  async function useMA48(card){
    const {data,error}=await state.supabase.rpc('get_ma48_candidates_v1',{p_game_id:state.game.id,p_password:state.hiderPassword});if(error)throw error;
    const candidates=(data||[]).filter(x=>x.spent_card_key&&x.title);if(!candidates.length)return toast('MA48 has nothing to recycle yet.');
    const raw=window.prompt(`Choose a card from the discard/played pile:\n${candidates.map((c,i)=>`${i+1}. ${c.title}`).join('\n')}`);if(raw===null)return;
    const idx=Number(raw)-1;if(!Number.isInteger(idx)||idx<0||idx>=candidates.length)return toast('Invalid choice.');const target=candidates[idx];
    const visibleHand=availableHandCards().filter(c=>c.card_key!==card.card_key).map(c=>c.title);
    const ok=await confirmAction('Call MA48?',`Recycle “${target.title}” into your hand.\n\nSeekers will see your current hand in the activity log BEFORE the recycled card is added:\n${visibleHand.length?visibleHand.join('\n'):'(empty hand)'}`,`Recycle`);if(!ok)return;
    const {error:useError}=await state.supabase.rpc('use_ma48_v1',{p_game_id:state.game.id,p_password:state.hiderPassword,p_card_key:card.card_key,p_revive_card_key:target.spent_card_key});if(useError)throw useError;
    await reloadGameState();
  }

  async function useKleingedrucktes(card){
    const {data,error}=await state.supabase.rpc('get_kleingedrucktes_targets_v1',{p_game_id:state.game.id,p_password:state.hiderPassword});if(error)throw error;
    const targets=data||[];if(!targets.length)return toast('No active Curse currently has hidden fine print.');
    const raw=window.prompt(`Reveal the fine print of which active Curse?\n${targets.map((t,i)=>`${i+1}. ${t.title}`).join('\n')}`);if(raw===null)return;
    const idx=Number(raw)-1;if(!Number.isInteger(idx)||idx<0||idx>=targets.length)return toast('Invalid choice.');const target=targets[idx];
    const effect=target.effect_text||target.engine_key||'Hidden secondary effect';
    const ok=await confirmAction('Play Kleingedrucktes?',`${target.title}\n\nThe Seekers will now see its hidden secondary effect:\n${effect}`,`Reveal fine print`);if(!ok)return;
    const {error:useError}=await state.supabase.rpc('use_kleingedrucktes_v1',{p_game_id:state.game.id,p_password:state.hiderPassword,p_card_key:card.card_key,p_target_action_id:target.action_id});if(useError)throw useError;
    await reloadGameState();
  }

  async function useSameDayDelivery(card){
    const drawCount=Math.max(1,Math.min(10,Number(card.draw_count||3))),keepLimit=Math.max(1,Math.min(drawCount,Number(card.keep_limit||2)));
    const costKeys=await chooseCastingCost(card);if(costKeys===null)return;const cost=cardCostLabel(card);
    const ok=await confirmAction(`${card.title||'Delivery'}?`,`${cost?`Casting cost: ${cost}\n\n`:''}Draw ${drawCount} cards immediately and keep ${keepLimit}.`,`Draw cards`);if(!ok)return;
    const {error}=await state.supabase.rpc('use_same_day_delivery_v1',{p_game_id:state.game.id,p_password:state.hiderPassword,p_card_key:card.card_key,p_cost_card_keys:costKeys||[]});if(error)throw error;
    await reloadGameState();
  }

  async function useDeceptiveTinyHouse(card){
    const current=Math.round(currentEndgameRadius()),next=Math.round(currentEndgameRadius()/3);
    const ok=await confirmAction('Play Deceptive Tiny House?',`${card.description||''}\n\nThis is PRIVATE until Endgame. The next answered Seeker question may be answered falsely.\nFinal hiding radius: ${current} m → ${next} m.`,`Play secretly`);if(!ok)return;
    const {error}=await state.supabase.rpc('use_deceptive_tiny_house_v1',{p_game_id:state.game.id,p_password:state.hiderPassword,p_card_key:card.card_key});if(error)throw error;
    await reloadGameState();toast('Deceptive Tiny House armed privately.');
  }

  async function useDuplicate(card){
    const targets=availableHandCards().filter(c=>c.card_key!==card.card_key&&['time_bonus','curse'].includes(c.card_kind));
    if(!targets.length)return toast('Duplicate needs another held bonus or curse.');
    const choices=targets.map((c,i)=>`${i+1}. ${c.title}`).join('\n');
    const raw=window.prompt(`Choose a card to copy:\n${choices}`);
    if(!raw)return;
    const idx=Number(raw)-1;
    if(!Number.isInteger(idx)||idx<0||idx>=targets.length)return toast('Invalid choice.');
    const target=targets[idx];
    const ok=await confirmAction('Use Duplicate?',`Create another “${target.title}” in your hand.\n\nThe original stays in your hand and the Duplicate card is consumed.`,'Duplicate');
    if(!ok)return;
    const {error}=await state.supabase.rpc('use_duplicate_v1',{
      p_game_id:state.game.id,
      p_password:state.hiderPassword,
      p_duplicate_card_key:card.card_key,
      p_copy_card_key:target.card_key
    });
    if(error)throw error;
    await reloadGameState();
  }

  async function placeTimeTrapAtStation(feature){
    const card=state.trapPlacementCard;if(!card)return;state.trapPlacementCard=null;const [lng,lat]=feature.geometry.coordinates;const ok=await confirmAction('Place Time Trap?',`${feature.properties.stationName}\n\nA clock marker will be visible to everyone immediately.`,'Place');if(!ok)return;
    const {error}=await state.supabase.rpc('place_time_trap_v4',{p_game_id:state.game.id,p_password:state.hiderPassword,p_card_key:card.card_key,p_station_name:feature.properties.stationName,p_station_lat:lat,p_station_lng:lng});if(error)throw error;await reloadGameState();
  }
  async function triggerTimeTrap(trap,active=true){
    const verb=active?'Trigger':'Undo trigger';const ok=await confirmAction(`${verb} Time Trap?`,`${trap.station_name}\n${active?'Its current bonus is added to the final score.':'The bonus is removed; the clock marker stays on the map.'}`,verb,!active);if(!ok)return;
    const {error}=await state.supabase.rpc('set_time_trap_trigger_v3',{p_game_id:state.game.id,p_trap_id:trap.id,p_password:state.hiderPassword,p_active:active});if(error)throw error;await reloadGameState();
  }

  function currentEndgameRadius(){return Number(state.secret?.base_radius_m||BASE_HIDE_RADIUS_M)*Math.sqrt(currentAreaMultiplier())*tinyHouseRadiusFactor();}

  function publicEndgameRadius(){
    const zone=latestAction('endgame_zone');if(!zone)return null;const p=zone.payload||{},dynamic=p.dynamic_radius===true;
    const base=Number(p.base_radius_m)||(dynamic?BASE_HIDE_RADIUS_M:(Number(p.radius_m)||BASE_HIDE_RADIUS_M));return dynamic?base*Math.sqrt(currentAreaMultiplier())*tinyHouseRadiusFactor():(Number(p.radius_m)||base);
  }
  function renderSeekerEndgame(){
    const panel=$('seekerEndgamePanel');if(!panel)return;panel.classList.toggle('hidden',state.role!=='seeker');if(state.role!=='seeker')return;
    const zone=latestAction('endgame_zone'),status=$('seekerEndgameStatus'),btn=$('seekerEndgameButton');
    if(zone?.payload?.center){const r=publicEndgameRadius();status.textContent=`${zone.payload.station_name||'Station'} · ${Math.round(r||BASE_HIDE_RADIUS_M)} m`;btn.textContent='Change Endgame station';}
    else{status.textContent='Not started';btn.textContent='Start Endgame';}
  }
  async function startSeekerEndgameAtStation(feature){
    if(state.role!=='seeker'||!state.seekerEndgamePickMode)return;state.seekerEndgamePickMode=false;
    const [lng,lat]=feature.geometry.coordinates,name=feature.properties.stationName||'Station';
    const ok=await confirmAction('Start Endgame?',`${name}\n\nThe map will reset to this station's dynamic Endgame zone.`,`Start Endgame`);if(!ok)return;
    const {error}=await state.supabase.rpc('start_seeker_endgame_v1',{p_game_id:state.game.id,p_station_name:name,p_station_lat:lat,p_station_lng:lng});if(error)throw error;await reloadGameState();
  }

  function setEndgameCandidate(lat,lng,accuracyM=null,source='map'){
    if(state.role!=='hider'||!state.secret)return;
    const point=turf.point([lng,lat]);const d=distanceM(point,state.secret.station);const limit=currentEndgameRadius();
    state.endgameCandidate=point;state.endgameAccuracyM=Number.isFinite(Number(accuracyM))?Number(accuracyM):null;
    state.mapLayers.endgameCandidate?.remove();state.mapLayers.endgameCandidateAccuracy?.remove();
    state.mapLayers.endgameCandidate=L.marker([lat,lng],{draggable:true}).addTo(state.gameMap).bindTooltip('Private proposed hiding spot');
    state.mapLayers.endgameCandidate.on('dragend',e=>{const p=e.target.getLatLng();setEndgameCandidate(p.lat,p.lng,null,'map');});
    if(state.endgameAccuracyM)state.mapLayers.endgameCandidateAccuracy=L.circle([lat,lng],{radius:state.endgameAccuracyM,className:'accuracy-circle',fillOpacity:.05,weight:1}).addTo(state.gameMap);
    const ok=d<=limit+0.5;const acc=state.endgameAccuracyM?` · GPS ±${Math.round(state.endgameAccuracyM)} m`:' · manual map point';
    $('endgameLocationStatus').className=`status-box ${ok?(state.endgameAccuracyM>100?'warn':'good'):'bad'}`;
    $('endgameLocationStatus').textContent=ok?`Proposed hiding spot: ${Math.round(d)} m from ${state.secret.station_name}${acc}`:`Outside the current hiding zone: ${Math.round(d)} m from station; maximum ${Math.round(limit)} m.`;
    renderHiderSecret();
  }

  function clearEndgameCandidate(){
    state.endgameCandidate=null;state.endgameAccuracyM=null;state.endgamePickMode=false;state.endgamePrepareMode=false;
    state.mapLayers.endgameCandidate?.remove();state.mapLayers.endgameCandidateAccuracy?.remove();state.mapLayers.endgameCandidate=null;state.mapLayers.endgameCandidateAccuracy=null;
    if($('endgameLocationStatus')){$('endgameLocationStatus').className='status-box';$('endgameLocationStatus').textContent='Choose the actual spot only when you are ready to start Endgame.';}
  }

  async function toggleEndgame(){
    if(state.role!=='hider')return;
    if(state.secret.endgame){
      const ok=await confirmAction('Undo Endgame?',`${state.secret.station_name} becomes the target again.`,'Undo Endgame',true);if(!ok)return;
      const {error}=await state.supabase.rpc('set_hider_endgame_target_v1',{p_game_id:state.game.id,p_password:state.hiderPassword,p_endgame:false,p_hidden_lat:null,p_hidden_lng:null});if(error)throw error;await refreshHiderSecret();await reloadGameState();return;
    }
    if(!state.endgameCandidate)return toast('Choose your actual hiding location first, using GPS or a map tap.');
    const d=distanceM(state.endgameCandidate,state.secret.station),limit=currentEndgameRadius();if(d>limit+0.5)return toast(`The hiding spot must be within ${Math.round(limit)} m of the station.`);
    const [lng,lat]=state.endgameCandidate.geometry.coordinates;
    const ok=await confirmAction('Start Endgame?',`Hiding spot: ${lat.toFixed(5)}, ${lng.toFixed(5)}
Distance from station: ${Math.round(d)} m
Zone: ${Math.round(limit)} m`,'Start Endgame');if(!ok)return;
    const {error}=await state.supabase.rpc('set_hider_endgame_target_v1',{p_game_id:state.game.id,p_password:state.hiderPassword,p_endgame:true,p_hidden_lat:lat,p_hidden_lng:lng});if(error)throw error;clearEndgameCandidate();await refreshHiderSecret();await reloadGameState();
  }
  async function refreshHiderSecret(){if(state.role!=='hider')return;const {data,error}=await state.supabase.rpc('get_hider_game_v4',{p_game_id:state.game.id,p_password:state.hiderPassword});if(error)throw error;const r=data?.[0];if(r)state.secret=secretFromRow(r);}

  async function setActionActive(action,active){const verb=active?'Redo':'Undo';const ok=await confirmAction(`${verb} this action?`,`${actionLabel(action)}\n\n${active?'It becomes active again.':'It remains in history but stops affecting the game.'}`,verb,!active);if(!ok)return;const {error}=await state.supabase.rpc('set_action_active_v3',{p_game_id:state.game.id,p_action_id:action.id,p_password:state.role==='hider'?state.hiderPassword:null,p_active:active});if(error)throw error;await reloadGameState();}

  async function reloadActions(){const {data,error}=await state.supabase.from('game_actions').select('*').eq('game_id',state.game.id).order('created_at',{ascending:true});if(error)throw error;state.actions=data||[];}
  async function reloadHiderPrivate(){
    if(state.role!=='hider'){state.hiderDraws=[];state.timeTraps=[];state.privateCardUses=[];state.seekerLivePosition=null;state.deckStatus=null;return;}
    const [d,t,u,l,ds]=await Promise.all([
      state.supabase.rpc('get_hider_draws_v3',{p_game_id:state.game.id,p_password:state.hiderPassword}),
      state.supabase.rpc('get_time_traps_v3',{p_game_id:state.game.id,p_password:state.hiderPassword}),
      state.supabase.rpc('get_private_card_uses_v3',{p_game_id:state.game.id,p_password:state.hiderPassword}),
      state.supabase.rpc('get_seeker_live_position_v1',{p_game_id:state.game.id,p_password:state.hiderPassword}),
      state.supabase.rpc('get_card_deck_status_v1',{p_game_id:state.game.id,p_password:state.hiderPassword})
    ]); if(d.error)throw d.error;if(t.error)throw t.error;if(u.error)throw u.error;if(l.error)throw l.error;if(ds.error)throw ds.error;
    state.hiderDraws=(d.data||[]).map(r=>({...r,cards:Array.isArray(r.cards)?r.cards:[],kept_card_keys:Array.isArray(r.kept_card_keys)?r.kept_card_keys:[],used_card_keys:Array.isArray(r.used_card_keys)?r.used_card_keys:[]}));state.timeTraps=t.data||[];state.privateCardUses=u.data||[];state.seekerLivePosition=(l.data||[])[0]||null;state.deckStatus=(ds.data||[])[0]||null;
  }
  async function reloadGamePublic(){const {data,error}=await state.supabase.from('games').select('*').eq('id',state.game.id).single();if(error)throw error;state.game={...state.game,...data};}
  async function reloadDeveloperHiderPreview(){
    const {data,error}=await state.supabase.rpc('admin_get_game_preview_v1',{p_password:state.developerPassword,p_game_id:state.game.id});if(error)throw error;const snap=data||{};
    if(snap.secret)state.secret=secretFromRow(snap.secret);
    state.hiderDraws=(snap.draws||[]).map(r=>({...r,cards:Array.isArray(r.cards)?r.cards:[],kept_card_keys:Array.isArray(r.kept_card_keys)?r.kept_card_keys:[],used_card_keys:Array.isArray(r.used_card_keys)?r.used_card_keys:[]}));
    state.timeTraps=snap.time_traps||[];state.privateCardUses=snap.private_card_uses||[];state.seekerLivePosition=snap.seeker_live_position||null;state.deckStatus=snap.deck_status||null;
  }
  async function reloadGameStateOnce(){
    await reloadGamePublic();await reloadActions();processActionNotifications();
    if(state.developerPreview&&state.role==='hider')await reloadDeveloperHiderPreview();
    else {if(state.role==='hider')await refreshHiderSecret();await reloadHiderPrivate();}
    deriveLocalState();await recomputePossibleArea();renderAll();scheduleHeavyGeometryWarmups();
  }
  function reloadGameState(){
    if(state.reloadPromise){state.reloadQueued=true;return state.reloadPromise;}
    state.reloadPromise=(async()=>{do{state.reloadQueued=false;await reloadGameStateOnce();}while(state.reloadQueued);})().finally(()=>{state.reloadPromise=null;});
    return state.reloadPromise;
  }

  function deriveLocalState(){
    const questions=effectiveActions('question').sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));const q=questions[0];if(q?.payload?.origin)setSeekerPointDisplay(q.payload.origin);else setSeekerPointDisplay(null);
    state.thermoReferences={};const targetPhase=targetPhaseStartMs();
    for(const ref of effectiveActions('thermo_reference').filter(a=>!targetPhase||new Date(a.created_at).getTime()>targetPhase).sort((a,b)=>new Date(a.created_at)-new Date(b.created_at))){
      const slot=ref.payload?.slot_key;if(slot)state.thermoReferences[slot]={...ref.payload,action_id:ref.id,created_at:ref.created_at};
    }
    renderHiderSecret();renderPendingQuestionOverlay();
  }

  function currentAreaMultiplier(){const p=effectiveActions('curse_play').filter(a=>a.payload?.effect_key==='prosperous_home');return Math.pow(2,p.length);}
  function privateTinyHouseUses(){return (state.privateCardUses||[]).filter(u=>u?.is_active&&u.effect_key==='deceptive_tiny_house');}
  function publicTinyHouseCount(){return effectiveActions('curse_play').filter(a=>a.payload?.effect_key==='deceptive_tiny_house').length;}
  function tinyHouseRadiusFactor(){const n=state.role==='hider'?privateTinyHouseUses().length:publicTinyHouseCount();return Math.pow(1/3,n);}
  function tinyHouseLieArmed(){return privateTinyHouseUses().some(u=>u.metadata?.lie_consumed!==true&&u.metadata?.lie_consumed!=='true');}
  function tinyHouseLieQuestionIds(){
    const ids=new Set(),qs=effectiveActions('question').filter(q=>!activeAnswerForQuestion(q.id)&&!activeVetoForQuestion(q.id)).sort((a,b)=>new Date(a.created_at)-new Date(b.created_at));
    for(const u of privateTinyHouseUses().filter(x=>x.metadata?.lie_consumed!==true&&x.metadata?.lie_consumed!=='true')){
      const t=new Date(u.metadata?.played_at||u.created_at).getTime(),q=qs.find(x=>new Date(x.created_at).getTime()>t);if(q)ids.add(q.id);
    }
    return ids;
  }
  function turntablesRewardlessRemaining(){
    const r=latestAction('turntables_relocate');if(!r)return 0;const limit=Number(r.payload?.rewardless_questions||0);if(limit<=0)return 0;const t=new Date(r.created_at).getTime();
    const asked=effectiveActions('question').filter(q=>new Date(q.created_at).getTime()>t).length;
    return Math.max(0,limit-asked);
  }
  async function recomputePossibleArea(){
    const signature=possibleAreaStateSignature();if(signature===state.possibleAreaSignature)return;state.heavyAreaPending=false;
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
        if(veto.payload?.automatic_tentacle&&veto.payload?.radar_miss&&q.payload?.origin){
          const r=Number(veto.payload?.radius_m||q.payload?.valid_distance_m||TENTACLE_VALID_DISTANCE_M),c=turf.buffer(turf.point([Number(q.payload.origin.lng),Number(q.payload.origin.lat)]),r/1000,{units:'kilometers',steps:32}),k=`auto-veto|${q.id}|${veto.id}|${hashGeometryText(heavyDomainSignature(q))}`,ready=state.heavyHistoryResults.get(k);
          if(ready)possible=ready;else{state.heavyAreaPending=true;if(!state.heavyHistoryJobs.has(k)){const gameId=state.game?.id,domain=possible,job=(async()=>{await geometryIdleYield(250);return runGeometryWorker('difference_optimize',{a:domain,b:c,tolerance:0.00003,min_vertex_m:3},90000);})().then(result=>{if(state.game?.id!==gameId)return;if(result)state.heavyHistoryResults.set(k,result);state.possibleAreaSignature=null;state.possibleAreaCache.clear();return recomputePossibleArea().then(()=>renderPossibleArea());}).catch(e=>console.warn('Deferred Tentacle veto geometry failed',e)).finally(()=>state.heavyHistoryJobs.delete(k));state.heavyHistoryJobs.set(k,job);}}
        }
        continue;
      }
      const a=activeAnswerForQuestion(q.id);if(!a)continue;possible=await applyConstraint(possible,q,a.payload?.answer,a38Flipped.has(String(q.id)));if(!possible)break;await geometryIdleYield(80);
    }
    state.possibleArea=possible;state.possibleAreaSignature=signature;state.possibleAreaKm2=possible?turf.area(possible)/1e6:0;state.possibleExcludedArea=geometryCacheGet(excludedGeometryKey(signature));if(state.heavyAreaPending)state.possibleAreaCache.delete(signature);else cachePossibleArea(signature,possible);
  }

  async function applyConstraint(possible,q,answer,invert=false){
    if(!possible)return null;const p=q.payload||{},boolValue=answer?.type==='boolean'?(invert?!answer.value:!!answer.value):null;
    if(p.question_kind==='radar'){const c=turf.buffer(turf.point([p.center.lng,p.center.lat]),Number(p.radius_m)/1000,{units:'kilometers',steps:48});return boolValue?safeIntersect(possible,c):safeDifference(possible,c);}
    if(p.question_kind==='district'){const d=state.mapData.districts.find(x=>x.number===Number(p.district_number));return d?(boolValue?safeIntersect(possible,d.feature):safeDifference(possible,d.feature)):possible;}
    if(p.question_kind==='district_set'){const g=districtSetGeometry(p.districts||[]);return g?(boolValue?safeIntersect(possible,g):safeDifference(possible,g)):possible;}
    if(p.question_kind==='landmark_compare'){const c=turf.buffer(turf.point([Number(p.landmark.lng),Number(p.landmark.lat)]),Number(p.radius_m)/1000,{units:'kilometers',steps:48});return boolValue?safeIntersect(possible,c):safeDifference(possible,c);}
    if(p.question_kind==='same_line')return resolveHeavyFinalGeometry(possible,q,answer,invert);
    if(p.question_kind==='station_interchange'){const g=interchangeStationArea(Number(p.radius_m||250));return g?(boolValue?safeIntersect(possible,g):safeDifference(possible,g)):possible;}
    if(p.question_kind==='directional'){const half=directionHalfPlane(p.origin,p.axis,!!boolValue);return half?safeIntersect(possible,half):possible;}
    if(p.question_kind==='thermometer'){const half=warmerHalfPlane(possible,p.from,p.to,!!boolValue);if(!half)return possible;const cut=safeIntersect(possible,half);if(!cut){console.warn('Thermometer cut produced no geometry',p,answer);return null;}return cut;}
    if(p.question_kind==='bus_line_tentacle')return resolveHeavyFinalGeometry(possible,q,answer,invert);
    if(p.question_kind==='tentacle')return resolveHeavyFinalGeometry(possible,q,answer,invert);
    return possible;
  }

  function nearestPoiCell(possible,selected,pois){let out=possible;const A={lat:selected.lat,lng:selected.lng};for(const other of pois){if(other.id===selected.id)continue;const half=closerHalfPlane(A,{lat:other.lat,lng:other.lng});if(half){out=safeIntersect(out,half);if(!out)break;}}return out;}
  function closerHalfPlane(a,b){
    const A=mercator(a.lat,a.lng),B=mercator(b.lat,b.lng);let nx=A.x-B.x,ny=A.y-B.y;const len=Math.hypot(nx,ny);if(len<1)return null;nx/=len;ny/=len;const tx=-ny,ty=nx,M={x:(A.x+B.x)/2,y:(A.y+B.y)/2},L=120000,D=120000;const pts=[{x:M.x+tx*L,y:M.y+ty*L},{x:M.x-tx*L,y:M.y-ty*L},{x:M.x-tx*L+nx*D,y:M.y-ty*L+ny*D},{x:M.x+tx*L+nx*D,y:M.y+ty*L+ny*D}].map(unmercator);return turf.polygon([[...pts.map(p=>[p.lng,p.lat]),[pts[0].lng,pts[0].lat]]]);
  }
  function halfPlanePolygon(M,nx,ny){
    const len=Math.hypot(nx,ny);if(len<1)return null;nx/=len;ny/=len;const tx=-ny,ty=nx;
    // Far larger than Vienna so clipping is stable even after many deductions.
    const L=1000000,D=1000000;
    const pts=[{x:M.x+tx*L,y:M.y+ty*L},{x:M.x-tx*L,y:M.y-ty*L},{x:M.x-tx*L+nx*D,y:M.y-ty*L+ny*D},{x:M.x+tx*L+nx*D,y:M.y+ty*L+ny*D}].map(unmercator);
    return turf.polygon([[...pts.map(p=>[p.lng,p.lat]),[pts[0].lng,pts[0].lat]]]);
  }
  function clipRectToHalfPlane(rect,M,nx,ny){
    const len=Math.hypot(nx,ny);if(len<1)return null;nx/=len;ny/=len;
    const side=P=>(P.x-M.x)*nx+(P.y-M.y)*ny;
    const out=[];
    for(let i=0;i<rect.length;i++){
      const A=rect[i],B=rect[(i+1)%rect.length],da=side(A),db=side(B),ina=da>=-1e-6,inb=db>=-1e-6;
      if(ina)out.push(A);
      if(ina!==inb){const t=da/(da-db);out.push({x:A.x+(B.x-A.x)*t,y:A.y+(B.y-A.y)*t});}
    }
    return out.length>=3?out:null;
  }
  function halfPlaneForFeature(feature,M,nx,ny){
    if(!feature)return null;const [w,s,e,n]=turf.bbox(feature),a=mercator(s,w),b=mercator(n,e),pad=20000;
    const rect=[{x:a.x-pad,y:a.y-pad},{x:b.x+pad,y:a.y-pad},{x:b.x+pad,y:b.y+pad},{x:a.x-pad,y:b.y+pad}];
    const pts=clipRectToHalfPlane(rect,M,nx,ny);if(!pts)return null;const ll=pts.map(unmercator);return turf.polygon([[...ll.map(p=>[p.lng,p.lat]),[ll[0].lng,ll[0].lat]]]);
  }
  function warmerHalfPlane(possible,from,to,warmer){
    const A=mercator(from.lat,from.lng),B=mercator(to.lat,to.lng),M={x:(A.x+B.x)/2,y:(A.y+B.y)/2};
    let nx=B.x-A.x,ny=B.y-A.y;if(!warmer){nx*=-1;ny*=-1;}return halfPlaneForFeature(possible,M,nx,ny);
  }
  function directionHalfPlane(origin,axis,positive){
    if(!origin)return null;const M=mercator(Number(origin.lat),Number(origin.lng));
    if(axis==='lat')return halfPlanePolygon(M,0,positive?1:-1);
    return halfPlanePolygon(M,positive?1:-1,0);
  }
  function mercator(lat,lng){const R=6378137;return{x:R*lng*Math.PI/180,y:R*Math.log(Math.tan(Math.PI/4+lat*Math.PI/360))};}
  function unmercator(p){const R=6378137;return{lng:p.x/R*180/Math.PI,lat:(2*Math.atan(Math.exp(p.y/R))-Math.PI/2)*180/Math.PI};}

  function renderPossibleArea(){
    const signature=state.possibleAreaSignature||'none',alreadyDrawn=state.possibleRenderSignature===signature&&((state.possibleArea&&state.mapLayers.possible)||(!state.possibleArea&&!state.mapLayers.possible));
    if(!alreadyDrawn){
      state.mapLayers.possible?.remove();state.mapLayers.excluded?.remove();state.mapLayers.possible=null;state.mapLayers.excluded=null;
      if(state.possibleArea){state.mapLayers.possible=L.geoJSON(state.possibleArea,{style:mapGeoStyle('possible'),interactive:false,renderer:state.heavyCanvasRenderer,smoothFactor:2.5}).addTo(state.gameMap);if(state.possibleExcludedArea)state.mapLayers.excluded=L.geoJSON(state.possibleExcludedArea,{style:mapGeoStyle('excluded'),interactive:false,renderer:state.heavyCanvasRenderer,smoothFactor:2.5}).addTo(state.gameMap);else scheduleExcludedGeometry(signature,state.possibleArea);}state.possibleRenderSignature=signature;
    }else if(state.possibleArea&&!state.mapLayers.excluded&&!state.possibleExcludedArea)scheduleExcludedGeometry(signature,state.possibleArea);
    const km2=Number(state.possibleAreaKm2||0);$('remainingAreaText').textContent=state.possibleArea?`${km2.toFixed(km2>=10?1:2)} km² possible${state.heavyAreaPending?' · map updating…':''}`:'0 km² possible';
    renderPublicEndgameZone();renderPublicTimeTraps();state.mapLayers['game-rails']?.bringToFront?.();state.mapLayers['game-stations']?.bringToFront?.();state.mapLayers.publicTimeTraps?.bringToFront?.();
  }

  function renderPublicEndgameZone(){
    state.mapLayers.publicEndgameZone?.remove();state.mapLayers.publicEndgameZone=null;
    const zone=latestAction('endgame_zone');if(!zone?.payload?.center)return;
    const dynamic=zone.payload.dynamic_radius===true,base=Number(zone.payload.base_radius_m)||(dynamic?BASE_HIDE_RADIUS_M:(Number(zone.payload.radius_m)||BASE_HIDE_RADIUS_M));
    const radius=dynamic?base*Math.sqrt(currentAreaMultiplier()):(Number(zone.payload.radius_m)||base);
    state.mapLayers.publicEndgameZone=L.circle([Number(zone.payload.center.lat),Number(zone.payload.center.lng)],{radius,color:'#16a34a',weight:2,fillColor:'#22c55e',fillOpacity:.08}).addTo(state.gameMap).bindTooltip(`Endgame zone · ${Math.round(radius)} m`);
  }

  function clearPrivateMapLayers(){['hiderStation','hiderSpot','hiderZone','prosperousPreview','seekerLive','seekerLiveAccuracy','turntablesCandidate'].forEach(k=>{state.mapLayers[k]?.remove();state.mapLayers[k]=null;});}
  function renderSeekerLiveForHider(){state.mapLayers.seekerLive?.remove();state.mapLayers.seekerLiveAccuracy?.remove();state.mapLayers.seekerLive=null;state.mapLayers.seekerLiveAccuracy=null;const el=$('hiderSeekerLiveStatus');if(!el)return;if(state.role!=='hider'||!state.seekerLivePosition){el.textContent='No seeker GPS position has been published yet.';return;}const p=state.seekerLivePosition;const age=Math.max(0,Math.round((serverNowMs()-new Date(p.updated_at).getTime())/60000));el.textContent=`${Number(p.lat).toFixed(5)}, ${Number(p.lng).toFixed(5)} · GPS ±${Math.round(Number(p.accuracy_m||0))} m · updated ${age} min ago`;state.mapLayers.seekerLive=L.marker([Number(p.lat),Number(p.lng)],{icon:L.divIcon({className:'seeker-live-marker',html:'<span>S</span>',iconSize:[24,24]})}).addTo(state.gameMap).bindTooltip('Latest seeker GPS');if(Number(p.accuracy_m)>0)state.mapLayers.seekerLiveAccuracy=L.circle([Number(p.lat),Number(p.lng)],{radius:Number(p.accuracy_m),color:'#0f766e',weight:1,dashArray:'4 4',fillOpacity:.04}).addTo(state.gameMap);}

  function renderHiderSecret(){
    ['hiderStation','hiderSpot','hiderZone'].forEach(k=>{state.mapLayers[k]?.remove();state.mapLayers[k]=null;});
    if(state.role!=='hider'||!state.secret)return;
    const [slng,slat]=state.secret.station.geometry.coordinates;const phase=state.secret.endgame?'<span class="phase-endgame">ENDGAME / actual spot</span>':'<span class="phase-station">STATION PHASE</span>';
    const hiddenText=state.secret.endgame&&state.secret.hidden?(()=>{const [hlng,hlat]=state.secret.hidden.geometry.coordinates;return `<br>Hiding spot: ${hlat.toFixed(5)}, ${hlng.toFixed(5)} · ${Math.round(distanceM(state.secret.station,state.secret.hidden))} m from station.`;})():'';
    $('hiderSecretStatus').innerHTML=`${phase}<br><strong>${escapeHtml(state.secret.station_name)}</strong> · ${slat.toFixed(5)}, ${slng.toFixed(5)}${hiddenText}`;
    const prep=$('prepareEndgameButton'),controls=$('endgameLocationControls'),toggle=$('toggleEndgameButton');
    if(state.secret.endgame){
      prep?.classList.add('hidden');controls?.classList.add('hidden');toggle?.classList.remove('hidden');toggle.textContent='Undo Endgame';
    }else if(state.endgamePrepareMode){
      prep?.classList.add('hidden');controls?.classList.remove('hidden');toggle?.classList.remove('hidden');toggle.textContent='Start Endgame';
    }else{
      prep?.classList.remove('hidden');controls?.classList.add('hidden');toggle?.classList.add('hidden');
    }
    state.mapLayers.hiderStation?.remove();state.mapLayers.hiderSpot?.remove();state.mapLayers.hiderZone?.remove();
    state.mapLayers.hiderStation=L.marker([slat,slng],{icon:L.divIcon({className:'station-selected',iconSize:[18,18]})}).addTo(state.gameMap).bindTooltip(`Private station: ${state.secret.station_name}`);
    if(state.secret.hidden){const [hlng,hlat]=state.secret.hidden.geometry.coordinates;state.mapLayers.hiderSpot=L.marker([hlat,hlng]).addTo(state.gameMap).bindTooltip('Actual hiding spot');}
    const r=currentEndgameRadius();
    state.mapLayers.hiderZone=L.circle([slat,slng],{radius:r,color:'#16a34a',weight:2,fillColor:'#22c55e',fillOpacity:.10}).addTo(state.gameMap).bindTooltip(`Hiding zone · ${Math.round(r)} m`);
    $('hiderSecretStatus').insertAdjacentHTML('beforeend',`<br><strong>Hiding zone: ${Math.round(r)} m</strong>`);
  }

  function thermometerProgress(card){
    const ref=state.thermoReferences?.[card.slot];if(!ref)return null;
    let travelled=null;if(state.role==='seeker'&&state.currentPosition){try{travelled=turf.distance(turf.point([Number(ref.lng),Number(ref.lat)]),turf.point([state.currentPosition.lng,state.currentPosition.lat]),{units:'meters'});}catch(_){}}
    return {ref,travelled,ready:Number.isFinite(travelled)&&travelled+0.5>=Number(card.min_travel_m)};
  }
  function renderQuestionDeck(){
    const cardsAll=state.questionCards?.length?state.questionCards:DEFAULT_QUESTION_CARDS,phase=targetPhaseStartMs();const used=new Set(effectiveActions('question').filter(a=>!phase||new Date(a.created_at).getTime()>phase).map(a=>a.payload?.slot_key));const rewardless=turntablesRewardlessRemaining();$('questionDeckStatus').textContent=`${used.size}/${cardsAll.length} asked${rewardless?` · ${rewardless} no-reward left`:''}`;
    const groups=[['MIXED','Mixed'],['RADAR','Radars'],['THERMOMETER','Thermometers'],['TENTACLES','Tentacles'],['PHOTO','Photo questions']],endgame=!!latestAction('endgame_zone'),lines=availableRailLineRefs();
    if(!state.sameLineSelection&&lines.length)state.sameLineSelection=lines[0];
    $('questionDeck').innerHTML=(rewardless?`<div class="status-box warn question-rewardless"><strong>Turntables</strong> · next ${rewardless} answered question${rewardless===1?'':'s'} award no cards.</div>`:'')+groups.map(([key,label])=>{
      const cards=cardsAll.filter(c=>c.category===key);if(!cards.length)return'';
      const html=cards.map(c=>{
        const frozen=state.role==='seeker'&&!!activeTurntablesAction(),isUsed=used.has(c.slot),locked=!!c.endgame_only&&!endgame,disabled=state.role!=='seeker'||isUsed||locked||frozen||state.game?.status==='finished',preview=state.previewQuestionSlot===c.slot;let extra='',qstate=isUsed?'Asked':locked?'Endgame only':frozen?'Frozen by Turntables':(state.role==='seeker'?'Available':'Not asked');
        if(c.kind==='thermometer'&&!isUsed&&!locked){const prog=thermometerProgress(c);if(prog){if(state.role==='seeker'&&prog.ready){extra='thermo-ready';qstate=`Ready · moved ${Math.round(prog.travelled)} m`; }else{extra='thermo-armed';qstate=state.role==='seeker'&&Number.isFinite(prog.travelled)?`Armed · ${Math.round(prog.travelled)}/${c.min_travel_m} m`:'Armed';}}}
        if(preview)extra+=` preview-active`;
        if(c.kind==='same_line'&&!isUsed){
          const options=lines.map(r=>`<option value="${escapeHtml(r)}" ${state.sameLineSelection===r?'selected':''}>${escapeHtml(r)}</option>`).join('');
          return `<div class="question-card-shell ${disabled?'disabled':''} ${preview?'preview-active':''}"><div class="question-card-copy"><div><div class="q-category">${escapeHtml(c.category)}</div><div class="q-title">${escapeHtml(c.title)}</div><div class="q-detail">${escapeHtml(c.detail)}</div></div><div class="q-state">${escapeHtml(qstate)}</div></div><div class="same-line-row"><select data-same-line-select="${c.slot}" ${disabled?'disabled':''}>${options}</select><button class="primary small" data-question-slot="${c.slot}" ${disabled?'disabled':''}>Ask</button></div></div>`;
        }
        return `<button class="question-card-button ${isUsed?'used':''} ${state.role==='hider'?'hider-view':''} ${extra}" data-question-slot="${c.slot}" ${disabled?'disabled':''}><div><div class="q-category">${escapeHtml(c.category)}</div><div class="q-title">${escapeHtml(c.title)}</div><div class="q-detail">${escapeHtml(c.detail)}</div></div><div class="q-state">${escapeHtml(qstate)}</div></button>`;
      }).join('');
      return `<section class="question-group"><div class="question-group-title">${label}</div><div class="question-group-grid">${html}</div></section>`;
    }).join('');
    $('questionDeck').querySelectorAll('[data-same-line-select]').forEach(sel=>sel.addEventListener('change',()=>{state.sameLineSelection=sel.value;const p={question_kind:'same_line',line_refs:[sel.value]};previewQuestionGeometry(p);state.previewQuestionSlot='same-line';renderQuestionDeck();}));
    $('questionDeck').querySelectorAll('[data-question-slot]').forEach(b=>b.addEventListener('click',()=>{const c=cardsAll.find(x=>x.slot===b.dataset.questionSlot);if(c)handleQuestionCard(c).catch(handleError);}));
  }

  function showTentacleCellPreview(q,poi){
    state.mapLayers.pendingTentacleCell?.remove(); state.mapLayers.pendingTentacleCell=null;
    if(!q||!poi||!state.possibleArea)return;
    const cell=nearestPoiCell(state.possibleArea,poi,q.payload?.pois||[]); if(!cell)return;
    state.mapLayers.pendingTentacleCell=L.geoJSON(cell,{style:{color:'#f59e0b',weight:2,dashArray:'6 5',fillColor:'#f59e0b',fillOpacity:.14},interactive:false}).addTo(state.gameMap);
    state.mapLayers.poiPreview?.bringToFront?.();
  }

  function renderPendingQuestionOverlay(){
    clearPendingOverlay();clearPoiPreview();if(state.role!=='hider')return;const phase=targetPhaseStartMs(),pending=effectiveActions('question').filter(q=>(!phase||new Date(q.created_at).getTime()>phase)&&!activeAnswerForQuestion(q.id)&&!activeVetoForQuestion(q.id));const q=pending[pending.length-1];if(!q)return;const p=q.payload||{};if(p.question_kind==='tentacle'){showPoiPreview(p.pois||[]);if(p.origin)showTentacleRangePreview(p.origin);}else if(p.question_kind==='bus_line_tentacle'){/* geometry is precomputed while pending; avoid redrawing all bus segments */}else previewQuestionGeometry(p);
  }

  function currentQuestionPenaltyMinutes(q,nowMs=serverNowMs()){
    const asked=new Date(q.created_at).getTime();if(!Number.isFinite(asked))return 0;const late=Math.max(0,(nowMs-asked)/1000-900);return late>=600?Math.floor(late/600)*20:0;
  }
  function questionDeadlineText(q,nowMs=serverNowMs()){
    const asked=new Date(q.created_at).getTime(),due=asked+15*60*1000,delta=due-nowMs;
    if(delta>=0)return {text:`${formatCountdown(Math.ceil(delta/1000))} to answer`,cls:'deadline-ok',penalty:0};
    const overdue=Math.ceil(-delta/1000),penalty=currentQuestionPenaltyMinutes(q,nowMs);return {text:penalty?`OVERDUE ${formatCountdown(overdue)} · −${penalty} min`:`OVERDUE ${formatCountdown(overdue)} · first −20 min at 10:00 late`,cls:'deadline-overdue',penalty};
  }
  function renderAnswerDeadlines(){
    document.querySelectorAll('[data-question-deadline]').forEach(el=>{const q=state.actions.find(a=>a.id===el.dataset.questionDeadline);if(!q)return;const d=questionDeadlineText(q);el.textContent=d.text;el.className=`answer-deadline ${d.cls}`;});
  }

  function renderPendingQuestions(){
    const phase=targetPhaseStartMs(),pending=effectiveActions('question').filter(q=>(!phase||new Date(q.created_at).getTime()>phase)&&!activeAnswerForQuestion(q.id)&&!activeVetoForQuestion(q.id));
    if($('pendingQuestionCount'))$('pendingQuestionCount').textContent=pending.length?`${pending.length} open`:'None';
    if(!pending.length){$('pendingQuestions').innerHTML='<div class="mini-status">No ongoing questions.</div>';return;}
    if(state.role==='seeker'){
      $('pendingQuestions').innerHTML=pending.map((q,i)=>`<div class="question-item"><div class="row-between pending-question-head"><strong>Question ${i+1} · ${escapeHtml(activityQuestionName(q))}</strong><span class="answer-pill pending">Waiting</span></div><div class="meta">${new Date(q.created_at).toLocaleTimeString()}</div></div>`).join('');
      return;
    }
    if(state.role!=='hider')return;
    const hasVeto=availableHandCards('veto_question').length>0,lieTargets=tinyHouseLieQuestionIds();
    $('pendingQuestions').innerHTML=pending.map(q=>{
      const kind=q.payload?.question_kind,s=['photo','street_shape'].includes(kind)?null:suggestedAnswer(q);let controls='';
      if(kind==='tentacle'){
        if(s?.status==='auto_veto')controls=`<button class="danger full" data-auto-veto-tentacle="${q.id}">Confirm automatic veto</button>`;
        else if(s?.status==='poi')controls=`<button class="primary full" data-send-tentacle="${q.id}">Closest to ${escapeHtml(s.poi?.name||'…')}</button>`;
        else controls=`<div class="mini-status">${escapeHtml(s?.text||'Tentacle unavailable.')}</div>`;
      }else if(kind==='bus_line_tentacle'){
        if(s?.status==='line')controls=`<button class="primary full" data-send-bus-line="${q.id}">Closest to bus ${escapeHtml(s.line_ref)}</button>`;
        else controls=`<div class="mini-status">${escapeHtml(s?.text||'Bus-line Tentacle unavailable.')}</div>`;
      }else if(kind==='photo'){
        const existing=state.photoPreviewUrls.get(q.id)||'';
        controls=`<div class="photo-answer-box"><label class="photo-file-label">Choose photo<input type="file" accept="image/*" data-photo-input="${q.id}"></label><div class="photo-local-preview ${existing?'':'hidden'}" data-photo-preview-wrap="${q.id}"><img data-photo-preview="${q.id}" ${existing?`src="${escapeHtml(existing)}"`:''} alt="Selected photo preview"></div><button class="primary full" data-send-photo="${q.id}" ${state.photoFiles.has(q.id)?'':'disabled'}>Send photo</button></div>`;
      }else if(kind==='street_shape'){
        const existing=state.photoPreviewUrls.get(q.id)||'';
        controls=`<div class="photo-answer-box"><button class="secondary full" data-generate-street="${q.id}">${existing?'Regenerate':'Generate street shape'}</button><div class="photo-local-preview ${existing?'':'hidden'}"><img ${existing?`src="${escapeHtml(existing)}"`:''} alt="Street shape preview"></div><button class="primary full" data-send-photo="${q.id}" ${state.photoFiles.has(q.id)?'':'disabled'}>Send street shape</button></div>`;
      }else{
        let yesLabel='Yes',noLabel='No';
        if(kind==='thermometer'){yesLabel='Warmer';noLabel='Colder';}
        if(kind==='radar'){yesLabel='Hit';noLabel='Miss';}
        if(kind==='directional'){yesLabel=q.payload?.positive_label||'Yes';noLabel=q.payload?.negative_label||'No';}
        controls=`<div class="answer-row"><button class="primary answer-yes" data-answer-question="${q.id}" data-answer-value="true">${escapeHtml(yesLabel)}</button><button class="primary answer-no" data-answer-question="${q.id}" data-answer-value="false">${escapeHtml(noLabel)}</button></div>`;
      }
      const suggestion=kind==='photo'?`<div class="suggestion photo-request"><strong>Photo</strong>${escapeHtml(q.payload?.photo_prompt||q.payload?.title||'Photo')}</div>`:kind==='street_shape'?`<div class="suggestion photo-request"><strong>Street shape</strong>Generate a stylized outline of your nearest street, then send it.</div>`:`<div class="suggestion"><strong>Preview</strong>${escapeHtml(s?.text||'Could not calculate.')}</div>`;
      const lieNote=lieTargets.has(q.id)?`<div class="status-box warn tiny-house-answer"><strong>Deceptive Tiny House</strong> · this is the protected next question. You may answer it untruthfully.</div>`:'';
      return `<div class="question-item"><div class="row-between pending-question-head"><strong>${escapeHtml(activityQuestionName(q))}</strong><span data-question-deadline="${q.id}" class="answer-deadline"></span></div>${lieNote}${suggestion}${controls}${hasVeto?`<button class="danger tiny activity-undo" data-veto-question="${q.id}">Veto</button>`:''}</div>`;
    }).join('');
    renderAnswerDeadlines();
    $('pendingQuestions').querySelectorAll('[data-answer-question]').forEach(b=>b.addEventListener('click',()=>{const q=state.actions.find(a=>a.id===b.dataset.answerQuestion);if(q)answerBoolean(q,b.dataset.answerValue==='true').catch(handleError);}));
    $('pendingQuestions').querySelectorAll('[data-send-tentacle]').forEach(b=>b.addEventListener('click',()=>{const q=state.actions.find(a=>a.id===b.dataset.sendTentacle);if(q)answerTentacle(q).catch(handleError);}));
    $('pendingQuestions').querySelectorAll('[data-send-bus-line]').forEach(b=>b.addEventListener('click',()=>{const q=state.actions.find(a=>a.id===b.dataset.sendBusLine);if(q)answerBusLineTentacle(q).catch(handleError);}));
    $('pendingQuestions').querySelectorAll('[data-auto-veto-tentacle]').forEach(b=>b.addEventListener('click',()=>{const q=state.actions.find(a=>a.id===b.dataset.autoVetoTentacle);if(q)autoVetoTentacle(q).catch(handleError);}));
    $('pendingQuestions').querySelectorAll('[data-veto-question]').forEach(b=>b.addEventListener('click',()=>{const q=state.actions.find(a=>a.id===b.dataset.vetoQuestion);if(q)vetoQuestion(q).catch(handleError);}));
    $('pendingQuestions').querySelectorAll('[data-photo-input]').forEach(inp=>inp.addEventListener('change',()=>{const qid=inp.dataset.photoInput,file=inp.files?.[0];if(!file)return;const old=state.photoPreviewUrls.get(qid);if(old)URL.revokeObjectURL(old);const url=URL.createObjectURL(file);state.photoPreviewUrls.set(qid,url);state.photoFiles.set(qid,file);const img=$('pendingQuestions').querySelector(`[data-photo-preview="${CSS.escape(qid)}"]`),wrap=$('pendingQuestions').querySelector(`[data-photo-preview-wrap="${CSS.escape(qid)}"]`),btn=$('pendingQuestions').querySelector(`[data-send-photo="${CSS.escape(qid)}"]`);if(img)img.src=url;if(wrap)wrap.classList.remove('hidden');if(btn)btn.disabled=false;}));
    $('pendingQuestions').querySelectorAll('[data-generate-street]').forEach(b=>b.addEventListener('click',()=>{const q=state.actions.find(a=>a.id===b.dataset.generateStreet);if(q)prepareStreetShape(q).catch(handleError);}));
    $('pendingQuestions').querySelectorAll('[data-send-photo]').forEach(b=>b.addEventListener('click',()=>{const q=state.actions.find(a=>a.id===b.dataset.sendPhoto),file=state.photoFiles.get(b.dataset.sendPhoto);if(q)uploadPhotoAnswer(q,file).catch(handleError);}));
  }

  function drawIsEarned(d){const q=state.actions.find(a=>a.id===d.question_action_id);const veto=q?activeVetoForQuestion(q.id):null;return !!(q&&isActionEffective(q)&&(q.kind==='powerup_draw'||!!activeAnswerForQuestion(q.id)||!!veto?.payload?.automatic_tentacle));}
  function renderCurseDraws(){
    if(state.role!=='hider')return;const earned=state.hiderDraws.filter(drawIsEarned);const hand=availableHandCards();const timeBonus=hand.filter(c=>c.card_kind==='time_bonus').reduce((sum,c)=>sum+Number(c.value_int||0),0)+state.privateCardUses.filter(u=>u.effect_key==='duplicate_bonus'&&u.is_active).reduce((sum,u)=>sum+Number(u.value_int||0),0)+state.timeTraps.filter(t=>t.trigger_active).reduce((sum,t)=>sum+Number(t.bonus_minutes||0),0);const deck=state.deckStatus;$('bonusTotal').textContent=`${timeBonus} min held/earned${deck?` · deck ${deck.remaining}/${deck.total} · cycle ${deck.cycle}`:''}`;
    const unresolved=earned.filter(d=>(d.kept_card_keys||[]).length<Number(d.keep_limit||1));
    const drawsHtml=unresolved.length?unresolved.map(d=>{const kept=new Set(d.kept_card_keys||[]),used=new Set(d.used_card_keys||[]),count=kept.size;return `<div class="curse-draw"><div class="curse-draw-title">New draw · choose ${d.keep_limit-count} more <span class="mini-status">(${count}/${d.keep_limit} kept)</span></div><div class="curse-options">${d.cards.map(c=>{if(kept.has(c.card_key)||used.has(c.card_key))return'';return `<div class="curse-option"><div class="card-kind">${escapeHtml(c.card_kind)}</div><strong>${escapeHtml(c.title)}</strong><p>${escapeHtml(c.description)}${c.duration_seconds?` · ${formatDuration(c.duration_seconds)}`:''}${cardCostLabel(c)?` · costs ${escapeHtml(cardCostLabel(c))}`:''}</p><button class="primary small keep-toggle" data-keep-card="${c.card_key}" data-draw-id="${d.id}" data-keep-active="true" ${count>=d.keep_limit?'disabled':''}>Keep</button></div>`;}).join('')}</div></div>`;}).join(''):'<div class="mini-status">No card pick is waiting.</div>';
    const handHtml=hand.length?`<div class="hand-grid">${hand.map(c=>`<div class="hand-card"><div class="card-kind">${escapeHtml(c.card_kind)}</div><strong>${escapeHtml(c.title)}</strong><div class="card-meta">${escapeHtml(c.description)}${cardCostLabel(c)?` · Casting cost: ${escapeHtml(cardCostLabel(c))}`:''}</div><div class="hand-actions">${c.card_kind==='time_bonus'?'<span class="answer-pill pending">TIME BONUS</span>':`<button class="primary small" data-play-card="${c.card_key}">${c.effect_key==='veto_question'?'Use on question':c.effect_key==='time_trap'?'Place':'Play'}</button>`}<button class="secondary small" data-discard-card="${c.card_key}">Discard</button></div></div>`).join('')}</div>`:'<div class="mini-status">Your hand is empty.</div>';
    const tiny=privateTinyHouseUses(),armed=tinyHouseLieArmed();const privateEffects=tiny.length?`<div class="card-section-title hand-title">Private effects</div><div class="status-box warn"><strong>Deceptive Tiny House ×${tiny.length}</strong><br>${armed?'Next answered question may be a lie.':'Lie permission already used.'} Final hiding radius ×${Math.pow(1/3,tiny.length).toFixed(tiny.length>1?3:2)}. Hidden from Seekers until Endgame.</div>`:'';
    $('curseDraws').innerHTML=`<div class="card-section-title">Pending picks</div>${drawsHtml}<div class="card-section-title hand-title">Current hand</div>${handHtml}${privateEffects}`;
    $('curseDraws').querySelectorAll('[data-keep-card]').forEach(b=>b.addEventListener('click',()=>{const d=state.hiderDraws.find(x=>x.id===b.dataset.drawId);if(d)toggleKeepCard(d,b.dataset.keepCard,true).catch(handleError);}));$('curseDraws').querySelectorAll('[data-play-card]').forEach(b=>b.addEventListener('click',()=>{const c=availableHandCards().find(x=>x.card_key===b.dataset.playCard);if(c)playHandCard(c).catch(handleError);}));$('curseDraws').querySelectorAll('[data-discard-card]').forEach(b=>b.addEventListener('click',()=>{const c=availableHandCards().find(x=>x.card_key===b.dataset.discardCard);if(c)discardHeldCard(c).catch(handleError);}));
  }

  function renderPublicTimeTraps(){
    state.mapLayers.publicTimeTraps?.remove();state.mapLayers.publicTimeTraps=null;
    const placements=effectiveActions('time_trap_place');if(!placements.length||!state.gameMap)return;
    const triggered=new Set(effectiveActions('time_trap_trigger').map(a=>String(a.payload?.trap_id||'')));
    const group=L.layerGroup();
    placements.forEach(a=>{const p=a.payload||{},lat=Number(p.lat),lng=Number(p.lng);if(!Number.isFinite(lat)||!Number.isFinite(lng))return;const isTriggered=triggered.has(String(p.trap_id||''));const icon=L.divIcon({className:`time-trap-map ${isTriggered?'triggered':''}`,html:'<span>⏱</span>',iconSize:[26,26],iconAnchor:[13,13]});L.marker([lat,lng],{icon}).bindTooltip(`Time Trap · ${p.station_name||'Station'}${isTriggered?' · triggered':''}`).addTo(group);});
    group.addTo(state.gameMap);state.mapLayers.publicTimeTraps=group;
  }

  function renderTimeTraps(){
    if(state.role!=='hider')return;$('timeTraps').innerHTML=state.timeTraps.length?state.timeTraps.map(t=>`<div class="question-item ${t.trigger_active?'time-trap-triggered':'time-trap-armed'}"><strong>${escapeHtml(t.station_name)}</strong><div class="meta">Armed ${new Date(t.armed_at).toLocaleString()} · current value ${Number(t.current_bonus_minutes||t.bonus_minutes||0)} min</div><button class="${t.trigger_active?'secondary':'primary'} small full" data-trigger-trap="${t.id}" data-trap-active="${t.trigger_active?'false':'true'}">${t.trigger_active?'Undo trigger':'Trigger now'}</button></div>`).join(''):'<div class="mini-status">No Time Traps placed.</div>';
    $('timeTraps').querySelectorAll('[data-trigger-trap]').forEach(b=>b.addEventListener('click',()=>{const t=state.timeTraps.find(x=>x.id===b.dataset.triggerTrap);if(t)triggerTimeTrap(t,b.dataset.trapActive==='true').catch(handleError);}));
  }

  const SEEKER_CURSE_EFFECTS=new Set([
    'gamblers_feet','impenetrable_fog','express_route','rewind','dice_tax','spotty_memory','statue','photo_op','right_turn','passenger_princess','hide_seek_ception','wurst_stand','melange','strassenbahn_only','opernball','custom_rule',
    'side_quest','deutsche_bahn','passierschein_a38','wean_ned_schlecht_redn','haute_vollee','one_ring','schwarzkappler','wiener_grantler','fiaker','mordor_curse','broken_lift','gemeindebau','quick_escalation','false_prophet','turntables','deceptive_tiny_house'
  ]);
  const ONE_QUESTION_CURSES=new Set(['rewind','statue','photo_op','hide_seek_ception','wurst_stand','melange','opernball','custom_rule','one_ring','wiener_grantler','gemeindebau']);
  function curseIsCompleted(a){return effectiveActions('curse_complete').some(c=>c.parent_id===a.id);}
  function activeCurseActions(now=serverNowMs()){
    return effectiveActions('curse_play').filter(a=>{
      if(curseIsCompleted(a))return false;
      const end=a.payload?.ends_at?new Date(a.payload.ends_at).getTime():null;if(end&&end<=now)return false;
      if(!end&&ONE_QUESTION_CURSES.has(a.payload?.effect_key)){const t=new Date(a.created_at).getTime();if(effectiveActions('question').some(q=>q.actor==='seeker'&&new Date(q.created_at).getTime()>t))return false;}
      return true;
    }).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
  }
  function curseExtraText(a){
    const p=a.payload||{},e=p.effect_key;
    if(e==='deutsche_bahn')return p.blocked_line?`Blocked line: ${p.blocked_line}`:'';
    if(e==='passierschein_a38')return 'Some previous deductions are temporarily displayed incorrectly.';
    if(e==='side_quest')return p.side_quest||'';
    if(e==='wean_ned_schlecht_redn')return p.mode==='work_hours'?'Work hours: stay put until the timer ends.':'Reach any marked Weinwanderweg access point, then check the curse off.';
    if(e==='haute_vollee')return 'Forbidden: districts 1, 18 and 19.';
    if(e==='mordor_curse')return p.mode==='inside'?'Stay inside districts 21/22.':'Do not enter districts 21/22.';
    if(e==='turntables')return state.role==='seeker'?'STOP MOVING · game clock paused · after relocation the next 3 questions give no card reward.':'Relocate to a different hiding station before the timer ends · next 3 questions give no card reward.';
    return '';
  }
  function renderCurseMapOverlays(curses){
    if(!state.gameMap)return;const relevant=(curses||[]).filter(a=>['deutsche_bahn','wean_ned_schlecht_redn','haute_vollee','mordor_curse'].includes(a.payload?.effect_key));
    const sig=relevant.map(a=>`${a.id}:${a.payload?.effect_key}:${a.payload?.blocked_line||''}:${a.payload?.mode||''}`).join('|');if(sig===state.curseMapSignature)return;state.curseMapSignature=sig;
    state.mapLayers.curseEffects?.remove();state.mapLayers.curseEffects=null;if(!relevant.length)return;const group=L.layerGroup();
    for(const a of relevant){const p=a.payload||{},e=p.effect_key;
      if(e==='deutsche_bahn'&&p.blocked_line){for(const f of matchingTransitFeatures([p.blocked_line]))L.geoJSON(f,{style:{color:'#dc2626',weight:8,opacity:.78},interactive:false}).bindTooltip(`${p.blocked_line} blocked`).addTo(group);}
      if(e==='haute_vollee'){const l=forbiddenDistrictLayer([1,18,19]);if(l)group.addLayer(l);}
      if(e==='mordor_curse'){const blocked=p.mode==='inside'?(state.mapData?.districts||[]).map(d=>Number(d.number)).filter(n=>![21,22].includes(n)):[21,22];const l=forbiddenDistrictLayer(blocked);if(l)group.addLayer(l);}
      if(e==='wean_ned_schlecht_redn'&&p.mode==='wine_hike')wineHikeLayer('active').eachLayer(l=>group.addLayer(l));
    }
    if(group.getLayers().length){group.addTo(state.gameMap);state.mapLayers.curseEffects=group;}
  }
  function manualCurseButton(a){
    if(state.role!=='seeker'||!MANUAL_CURSE_EFFECTS.has(a.payload?.effect_key))return '';
    if(a.payload?.effect_key==='wean_ned_schlecht_redn'&&a.payload?.mode!=='wine_hike')return '';
    const label=a.payload?.effect_key==='fiaker'?'✓ Fiaker spotted':a.payload?.effect_key==='schwarzkappler'?'✓ Ticket bought':'✓ Reached a Weinwanderweg point';
    return `<button class="secondary tiny curse-complete" data-complete-curse="${a.id}">${label}</button>`;
  }
  async function completePublicCurse(actionId){
    const a=state.actions.find(x=>x.id===actionId);if(!a)return;const ok=await confirmAction('Clear this curse?',`${a.payload?.title||'Curse'}\n\nConfirm that the required task has been completed.`,'Clear curse');if(!ok)return;
    const {error}=await state.supabase.rpc('complete_curse_v1',{p_game_id:state.game.id,p_curse_action_id:actionId});if(error)throw error;await reloadGameState();
  }
  function unlockCurseAudio(){try{const Ctx=window.AudioContext||window.webkitAudioContext;if(!Ctx)return;if(!state.audioCtx)state.audioCtx=new Ctx();if(state.audioCtx.state==='suspended')state.audioCtx.resume().catch(()=>{});}catch(_){} }
  function playToneSequence(notes,{volume=.11,type='sine'}={}){
    try{unlockCurseAudio();const ctx=state.audioCtx;if(!ctx||ctx.state==='suspended')return;const start=ctx.currentTime+.01;notes.forEach((n,i)=>{const o=ctx.createOscillator(),g=ctx.createGain(),t=start+(n.at??i*.12),dur=n.duration??.16;o.type=n.type||type;o.frequency.setValueAtTime(n.freq,t);g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(n.volume??volume,t+.015);g.gain.exponentialRampToValueAtTime(.0001,t+dur);o.connect(g);g.connect(ctx.destination);o.start(t);o.stop(t+dur+.02);});}catch(e){console.warn('Notification sound unavailable',e);}
  }
  function playQuestionSound(kind){
    if(kind==='asked')playToneSequence([{freq:659,duration:.14},{freq:880,at:.13,duration:.2}],{volume:.10,type:'sine'});
    else playToneSequence([{freq:523,duration:.12},{freq:659,at:.11,duration:.12},{freq:784,at:.22,duration:.22}],{volume:.095,type:'triangle'});
  }
  function playCurseSound(){playToneSequence([{freq:988,duration:.18,type:'square'},{freq:659,at:.12,duration:.24,type:'triangle'},{freq:392,at:.28,duration:.38,type:'sine'}],{volume:.09});}
  function processActionNotifications(){
    const rows=(state.actions||[]).filter(a=>['question','answer','question_veto','curse_play'].includes(a.kind));const ids=new Set(rows.map(a=>String(a.id)));
    if(!state.notificationPrimed){state.seenNotificationActionIds=ids;state.notificationPrimed=true;return;}
    const incoming=rows.filter(a=>!state.seenNotificationActionIds.has(String(a.id))).sort((a,b)=>new Date(a.created_at)-new Date(b.created_at));
    incoming.forEach(a=>{state.seenNotificationActionIds.add(String(a.id));if(a.kind==='question')playQuestionSound('asked');else if(a.kind==='answer'||a.kind==='question_veto')playQuestionSound('answered');else if(a.kind==='curse_play')playCurseSound();});
  }
  function renderActiveCurses(){
    const now=serverNowMs();const curses=activeCurseActions(now);renderCurseMapOverlays(curses);
    const misc=effectiveActions().filter(a=>['time_trap_trigger','question_veto'].includes(a.kind)).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));const visible=[...curses,...misc].sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
    $('activeCurses').innerHTML=visible.length?visible.map(a=>{
      if(a.kind==='question_veto')return `<div class="curse-item"><strong>${a.payload?.automatic_tentacle?'Tentacle automatically vetoed':'Question vetoed'}</strong><div class="meta">${escapeHtml(a.payload?.question_title||'A question')} ${a.payload?.automatic_tentacle?(a.payload?.radar_miss?`cleared the ${Number(a.payload?.radius_m||TENTACLE_VALID_DISTANCE_M)} m Tentacle circle.`:'had no usable POIs in range.'):'was vetoed.'}</div></div>`;
      if(a.kind==='time_trap_trigger')return `<div class="curse-item"><strong>Time Trap triggered</strong><div class="meta">${escapeHtml(a.payload?.station_name||'Station')} · +${Number(a.payload?.bonus_minutes||0)} min</div></div>`;
      const end=a.payload?.ends_at?new Date(a.payload.ends_at).getTime():null,rem=end?Math.max(0,Math.ceil((end-now)/1000)):null,extra=curseExtraText(a);return `<div class="curse-item curse-active"><strong>${escapeHtml(a.payload?.title||'Card')}</strong><div class="meta">${escapeHtml(a.payload?.description||'')}${extra?`<br><strong>${escapeHtml(extra)}</strong>`:''}</div><div class="curse-countdown">${rem===null?'ACTIVE':formatCountdown(rem)}</div>${manualCurseButton(a)}</div>`;
    }).join(''):'<div class="mini-status">No public card effect is active.</div>';

    document.querySelectorAll('[data-complete-curse]').forEach(b=>{if(b.dataset.bound)return;b.dataset.bound='1';b.addEventListener('click',()=>completePublicCurse(b.dataset.completeCurse).catch(handleError));});

    const strip=$('seekerCurseStrip');if(!strip)return;const seekerCurses=curses.filter(a=>SEEKER_CURSE_EFFECTS.has(a.payload?.effect_key));
    if(state.role!=='seeker'||!seekerCurses.length){strip.classList.add('hidden');strip.innerHTML='';if(state.role!=='seeker'){state.curseSoundPrimed=false;state.seenCurseIds=new Set();}return;}
    strip.classList.remove('hidden');strip.innerHTML=seekerCurses.map(a=>{const end=a.payload?.ends_at?new Date(a.payload.ends_at).getTime():null,rem=end?Math.max(0,Math.ceil((end-now)/1000)):null,extra=curseExtraText(a);return `<div class="curse-chip curse-chip-wide"><span class="curse-chip-icon">⚠</span><span><strong>${escapeHtml(a.payload?.title||'Curse')}</strong>${extra?`<em>${escapeHtml(extra)}</em>`:''}<small>${rem===null?'ACTIVE':formatCountdown(rem)}</small>${manualCurseButton(a)}</span></div>`;}).join('');
    strip.querySelectorAll('[data-complete-curse]').forEach(b=>{if(b.dataset.bound)return;b.dataset.bound='1';b.addEventListener('click',()=>completePublicCurse(b.dataset.completeCurse).catch(handleError));});
    const ids=new Set(seekerCurses.map(a=>a.id));if(!state.curseSoundPrimed){state.seenCurseIds=ids;state.curseSoundPrimed=true;}else{const incoming=seekerCurses.filter(a=>!state.seenCurseIds.has(a.id));if(incoming.length){incoming.forEach(a=>state.seenCurseIds.add(a.id));toast(`CURSED: ${incoming.map(a=>a.payload?.title||'Curse').join(', ')}`,5000);}}
  }

  function canToggleAction(a){if(['time_trap_place','time_trap_trigger','endgame_zone','game_finish','turntables_relocate','powerup_play','powerup_draw'].includes(a.kind))return false;if(a.kind==='curse_play'&&(a.payload?.effect_key==='turntables'||a.payload?.reset_by_turntables))return false;if(state.role==='hider')return a.actor==='hider';if(state.role==='seeker')return a.actor==='seeker';return false;}
  function activityQuestionName(q){
    const p=q.payload||{};
    if(p.question_kind==='district')return `District = ${p.district_name||p.district_number||'?'}`;
    if(p.question_kind==='radar')return `${formatDistance(p.radius_m)} Radar`;
    if(p.question_kind==='same_line')return `Line · ${p.selected_line||(p.line_refs||[]).join(', ')}`;if(p.question_kind==='station_interchange')return 'Nearest Station an Interchange?';if(p.question_kind==='bus_line_tentacle')return 'Nearest Bus Line';if(p.question_kind==='vor_navigation')return 'VOR Navigation';
    if(p.question_kind==='district_set')return p.title||'District group';
    if(p.question_kind==='landmark_compare')return p.title||'Landmark comparison';
    if(p.question_kind==='street_shape')return 'Current Street Shape';
    if(p.question_kind==='thermometer')return `${formatDistance(p.min_travel_m)} Thermometer`;
    if(p.question_kind==='tentacle')return `${humanize(p.poi_type)} Tentacle`;
    if(p.question_kind==='photo')return `Photo – ${p.photo_prompt||p.title||'Photo'}`;
    return p.title||p.slot_key||'Question';
  }
  function rawResolutionForQuestion(id){
    const rows=state.actions.filter(a=>a.parent_id===id&&['answer','question_veto'].includes(a.kind)).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
    return rows.find(a=>isActionEffective(a))||rows[0]||null;
  }
  function activityResolutionMarkup(q,r){
    if(!r){const phase=targetPhaseStartMs();if(phase&&new Date(q.created_at).getTime()<=phase)return '<span class="activity-resolution vetoed">Reset by Turntables</span>';return '<span class="activity-resolution pending">Pending</span>';}
    if(r.kind==='question_veto')return `<span class="activity-resolution vetoed">Vetoed</span>`;
    const a=r.payload?.answer||{};
    if(a.type==='photo'&&a.photo_path)return `<button class="activity-photo-thumb" data-photo-path="${escapeHtml(a.photo_path)}" data-photo-title="${escapeHtml(q.payload?.photo_prompt||'Photo answer')}"><img alt="Photo thumbnail"><span>Photo</span></button>`;
    if(q.payload?.question_kind==='thermometer'&&a.type==='boolean')return `<span class="activity-resolution ${a.value?'yes':'no'}">${a.value?'Warmer':'Colder'}</span>`;
    if(q.payload?.question_kind==='radar'&&a.type==='boolean')return `<span class="activity-resolution ${a.value?'yes':'no'}">${a.value?'Hit':'Miss'}</span>`;
    if(q.payload?.question_kind==='directional'&&a.type==='boolean')return `<span class="activity-resolution ${a.value?'yes':'no'}">${escapeHtml(a.value?(q.payload?.positive_label||'Yes'):(q.payload?.negative_label||'No'))}</span>`;
    if(a.type==='boolean')return `<span class="activity-resolution ${a.value?'yes':'no'}">${a.value?'Yes':'No'}</span>`;
    if(a.type==='tentacle'&&a.status==='poi')return `<span class="activity-resolution yes">Closest to ${escapeHtml(a.poi?.name||'POI')}</span>`;
    return '<span class="activity-resolution">Answered</span>';
  }
  function renderActivity(){
    const a38Flipped=passierscheinFlippedQuestionIds();
    const entries=[
      ...state.actions.filter(a=>a.kind==='question').map(q=>({type:'question',at:q.created_at,q})),
      ...state.actions.filter(a=>!['question','answer','question_veto','thermo_reference','endgame_zone'].includes(a.kind)).map(a=>({type:'action',at:a.created_at,a}))
    ].sort((x,y)=>new Date(x.at)-new Date(y.at));
    const orderedQuestions=state.actions.filter(a=>a.kind==='question').sort((a,b)=>new Date(a.created_at)-new Date(b.created_at)),questionNumber=new Map(orderedQuestions.map((q,i)=>[q.id,i+1]));
    $('activityHistory').innerHTML=entries.length?entries.map(entry=>{
      if(entry.type==='question'){
        const q=entry.q,r=rawResolutionForQuestion(q.id),pen=Number(r?.payload?.late_penalty_minutes||0),noReward=!!r?.payload?.reward_suppressed,qEffective=isActionEffective(q),rEffective=r?isActionEffective(r):false;
        const a38=a38Flipped.has(String(q.id));
        return `<div class="activity-item grouped ${qEffective?'':'inactive'} ${a38?'a38-distorted':''}"><div class="activity-question-line"><strong>Question ${questionNumber.get(q.id)||'?'} – ${escapeHtml(activityQuestionName(q))}</strong>${!qEffective?' <span class="answer-pill undone">UNDONE</span>':''}${a38?' <span class="answer-pill a38">A38 distorted</span>':''}${activityResolutionMarkup(q,r)}</div><div class="meta">${new Date(q.created_at).toLocaleString()}${r?` · resolved ${new Date(r.created_at).toLocaleTimeString()}${!rEffective?' · resolution undone':''}`:''}${noReward?' · <strong>no card reward</strong>':''}${pen?` · <strong>−${pen} min late penalty</strong>`:''}</div><div class="activity-actions compact">${canToggleAction(q)?`<button class="${q.is_active?'danger':'secondary'} tiny activity-undo" data-toggle-action="${q.id}" data-active="${q.is_active?'false':'true'}">${q.is_active?'Undo question':'Redo question'}</button>`:''}${r&&canToggleAction(r)?`<button class="${r.is_active?'danger':'secondary'} tiny activity-undo" data-toggle-action="${r.id}" data-active="${r.is_active?'false':'true'}">${r.is_active?'Undo answer':'Redo answer'}</button>`:''}</div></div>`;
      }
      const a=entry.a;return `<div class="activity-item ${a.is_active?'':'inactive'}"><div><strong>${escapeHtml(actionLabel(a))}</strong>${!a.is_active?' <span class="answer-pill undone">UNDONE</span>':''}</div><div class="meta">${new Date(a.created_at).toLocaleString()} · ${escapeHtml(a.actor)}</div>${canToggleAction(a)?`<div class="activity-actions compact"><button class="${a.is_active?'danger':'secondary'} tiny activity-undo" data-toggle-action="${a.id}" data-active="${a.is_active?'false':'true'}">${a.is_active?'Undo':'Redo'}</button></div>`:''}</div>`;
    }).join(''):'<div class="mini-status">No game activity yet.</div>';
    $('activityHistory').querySelectorAll('[data-toggle-action]').forEach(b=>b.addEventListener('click',()=>{const a=state.actions.find(x=>x.id===b.dataset.toggleAction);if(a)setActionActive(a,b.dataset.active==='true').catch(handleError);}));
    hydratePhotoMedia().catch(e=>console.warn(e));
  }


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
  async function publishHiderVorLivePosition(q,p){
    if(state.role!=='hider'||!state.hiderPassword||!state.game||!q||!p)return;
    const {error}=await state.supabase.rpc('set_hider_vor_live_position_v1',{p_game_id:state.game.id,p_question_action_id:q.id,p_password:state.hiderPassword,p_lat:Number(p.lat),p_lng:Number(p.lng),p_accuracy_m:p.accuracy_m??null});if(error)throw error;
  }
  function startVorTracking(q){
    if(state.developerPreview||!q||!['seeker','hider'].includes(state.role))return;
    if(state.vorGeoWatchId===null&&navigator.geolocation){state.vorGeoWatchId=navigator.geolocation.watchPosition(pos=>{
      const p={lat:pos.coords.latitude,lng:pos.coords.longitude,accuracy_m:pos.coords.accuracy,source:'gps'};state.lastGpsUpdateMs=Date.now();setCurrentPosition(p,{pan:false});
      if(state.role==='seeker')publishSeekerLivePosition(p).then(()=>requestVorBearing(q,{force:true})).catch(e=>console.warn('VOR live Seeker GPS publish failed',e));
      else publishHiderVorLivePosition(q,p).catch(e=>console.warn('VOR private Hider GPS publish failed',e));
    },e=>console.warn('VOR live GPS unavailable',e),{enableHighAccuracy:true,maximumAge:500,timeout:10000});}
    if(state.role==='seeker'&&typeof DeviceOrientationEvent!=='undefined'&&typeof DeviceOrientationEvent.requestPermission!=='function'&&!state.vorOrientationHandler)attachVorOrientation();
    if(!state.vorRenderTimer)state.vorRenderTimer=setInterval(()=>renderVorNavigation(),1000);
  }
  function stopVorTracking(){
    if(state.vorGeoWatchId!==null&&navigator.geolocation){try{navigator.geolocation.clearWatch(state.vorGeoWatchId);}catch(_){}}state.vorGeoWatchId=null;
    if(state.vorOrientationHandler){window.removeEventListener('deviceorientationabsolute',state.vorOrientationHandler,true);window.removeEventListener('deviceorientation',state.vorOrientationHandler,true);}state.vorOrientationHandler=null;
    if(state.vorRenderTimer)clearInterval(state.vorRenderTimer);state.vorRenderTimer=null;state.vorQuestionId=null;state.vorBearing=null;state.vorHeading=null;state.vorExpiresAt=0;state.vorLastBearingFetch=0;state.vorBearingBusy=false;
  }
  function renderVorNavigation(){
    const panel=$('vorNavigationPanel');if(!panel)return;const active=['seeker','hider'].includes(state.role)?activeVorNavigation():null;
    if(!active){panel.classList.add('hidden');if(state.vorQuestionId)stopVorTracking();return;}
    state.vorQuestionId=active.question.id;state.vorExpiresAt=active.expiry;startVorTracking(active.question);
    if(state.role==='hider'){panel.classList.add('hidden');return;}
    if(state.role!=='seeker'){panel.classList.add('hidden');return;}
    panel.classList.remove('hidden');requestVorBearing(active.question).catch(()=>{});
    const timer=$('vorNavigationTimer');if(timer)timer.textContent=formatCountdown(Math.max(0,Math.ceil((active.expiry-serverNowMs())/1000)));
    const sector=$('vorSector'),north=$('vorNorthRing'),status=$('vorNavigationStatus'),button=$('vorCompassButton'),heading=Number.isFinite(state.vorHeading)?state.vorHeading:null,bearing=Number.isFinite(state.vorBearing)?state.vorBearing:null;
    if(button&&!button.dataset.bound){button.dataset.bound='1';button.addEventListener('click',()=>enableVorCompass());}
    if(bearing!==null){sector?.style.setProperty('--vor-angle',`${normalizeDegrees(bearing-(heading??0))}deg`);sector?.classList.add('ready');}else sector?.classList.remove('ready');
    north?.style.setProperty('--vor-north-angle',`${heading===null?0:normalizeDegrees(-heading)}deg`);
    const needsPermission=typeof DeviceOrientationEvent!=='undefined'&&typeof DeviceOrientationEvent.requestPermission==='function'&&state.vorCompassPermission==='unknown';if(button)button.classList.toggle('hidden',!needsPermission);
    if(status){if(bearing===null)status.textContent='Waiting for a GPS direction fix…';else if(heading!==null)status.textContent='Live compass mode · red 30° sector points toward the Hider.';else status.textContent='North-up mode · N is fixed at the top; red 30° sector points toward the Hider.';}
  }


  function renderAll(){renderQuestionDeck();renderPendingQuestions();renderCurseDraws();renderTimeTraps();renderActiveCurses();renderActivity();renderPossibleArea();renderHiderSecret();renderSeekerLiveForHider();renderSeekerEndgame();renderGameClock();renderTurntablesPanel();renderTurntablesFreezeControls();renderVorNavigation();applyDeveloperPreviewReadOnly();}

  function questionLabel(q){const p=q.payload||{};if(p.question_kind==='radar')return `${formatDistance(p.radius_m)} Radar from ${formatCoord(p.center)}`;if(p.question_kind==='district')return `Same District: ${p.district_number}. ${p.district_name}`;if(p.question_kind==='same_line')return `Line: ${p.selected_line||(p.line_refs||[]).join(', ')}`;if(p.question_kind==='station_interchange')return 'Nearest Station an Interchange?';if(p.question_kind==='bus_line_tentacle')return 'Nearest Bus Line';if(p.question_kind==='vor_navigation')return 'VOR Navigation';if(p.question_kind==='district_set')return p.title||'District group';if(p.question_kind==='landmark_compare')return p.title||'Landmark comparison';if(p.question_kind==='street_shape')return 'Current Street Shape';if(p.question_kind==='directional')return p.title||'Direction';if(p.question_kind==='thermometer')return `${formatDistance(p.min_travel_m)} Thermometer: ${formatCoord(p.from)} → ${formatCoord(p.to)}`;if(p.question_kind==='tentacle')return `${humanize(p.poi_type)} Tentacle · ${p.pois?.length||0} POIs within 5 km`;if(p.question_kind==='photo')return `Photo · ${p.photo_prompt||p.title||'Photo'}`;return p.title||p.slot_key||'Question';}
  function answerLabel(ans){if(!ans)return'';if(ans.type==='boolean')return ans.value?'YES':'NO';if(ans.type==='tentacle'&&ans.status==='poi')return `Hider is closest to ${ans.poi?.name||'selected POI'}`;if(ans.type==='bus_line_tentacle'&&ans.status==='line')return `Closest to bus ${ans.line_ref||'?'}`;if(ans.type==='vor_navigation')return '3 min VOR signal';if(ans.type==='photo')return 'PHOTO';return 'ANSWER';}
  function actionLabel(a){const p=a.payload||{};if(a.kind==='question')return `Question · ${questionLabel(a)}`;if(a.kind==='answer'){const q=state.actions.find(x=>x.id===a.parent_id);return `Answer · ${q?questionLabel(q):'question'} · ${answerLabel(p.answer)}`;}if(a.kind==='thermo_reference')return `Thermometer start · ${Number(p.lat).toFixed(4)}, ${Number(p.lng).toFixed(4)}`;if(a.kind==='curse_play'&&p.effect_key==='deceptive_tiny_house'&&p.revealed_at_endgame)return 'Curse revealed · Deceptive Tiny House';if(a.kind==='curse_play')return `Card played · ${p.title||p.card_key||'Curse'}`;if(a.kind==='question_veto')return `${p.automatic_tentacle?'Automatic Tentacle veto':'Veto'} · ${p.question_title||'Question'}`;if(a.kind==='time_trap_place')return `Time Trap placed · ${p.station_name||'Station'}`;if(a.kind==='time_trap_trigger')return `Time Trap triggered · ${p.station_name} · +${p.bonus_minutes} min`;if(a.kind==='game_finish')return `Hider Found · final ${formatCountdown(Number(p.final_seconds||0))}`;if(a.kind==='turntables_relocate')return 'Turntables · new hiding station selected';
    if(a.kind==='powerup_draw'&&p.effect_key==='same_day_delivery')return `${p.title||'Delivery'} · drew ${Number(p.draw_count||3)} cards, keep ${Number(p.keep_limit||2)}`;
    if(a.kind==='powerup_play'&&p.effect_key==='ma48')return `MA48 · Hider hand: ${(p.hand_snapshot||[]).join(', ')||'(empty)'}`;
    if(a.kind==='powerup_play'&&p.effect_key==='kleingedrucktes')return `Kleingedrucktes · ${p.target_title||'Curse'} · ${p.secondary_effect_text||p.secondary_engine_key||'secondary effect revealed'}`;
    if(a.kind==='powerup_play')return p.title||'Power-up played';return a.kind;}
  function formatDistance(m){return Number(m)>=1000?`${Number(m)/1000} km`:`${Number(m)} m`;}
  function formatCoord(p){return p?`${Number(p.lat).toFixed(4)}, ${Number(p.lng).toFixed(4)}`:'?';}
  function gameClockSeconds(){if(!state.game)return 0;let sec=Number(state.game.clock_elapsed_seconds||0);if(state.game.clock_running&&state.game.clock_started_at)sec+=Math.max(0,(serverNowMs()-new Date(state.game.clock_started_at).getTime())/1000);return Math.floor(sec);}
  function answerPenaltyTotal(){return effectiveActions().filter(a=>['answer','question_veto'].includes(a.kind)).reduce((sum,a)=>sum+Number(a.payload?.late_penalty_minutes||0),0);}
  function renderGameClock(){
    const el=$('gameClockDisplay');if(!el||!state.game)return;const finished=state.game.status==='finished';
    const turntables=activeTurntablesAction();const raw=finished?Number(state.game.final_raw_seconds??state.game.clock_elapsed_seconds??0):gameClockSeconds();
    const final=finished?Number(state.game.final_score_seconds??raw):raw;el.textContent=formatCountdown(final);el.classList.toggle('running',!finished&&!!state.game.clock_running&&!turntables);
    const tt=$('turntablesClock');if(tt){if(turntables&&!finished){const rem=Math.max(0,Math.ceil((new Date(turntables.payload.ends_at).getTime()-serverNowMs())/1000));tt.classList.remove('hidden');tt.textContent=`↻ ${formatCountdown(rem)}`;}else{tt.classList.add('hidden');tt.textContent='';}}
    const meta=$('gameScoreMeta');if(meta)meta.textContent=finished?`Raw ${formatCountdown(raw)} · +${Number(state.game.final_bonus_minutes||0)} cards · +${Number(state.game.final_trap_minutes||0)} traps · −${Number(state.game.final_penalty_minutes||0)} penalties`:'';
    const controls=$('gameClockControls');if(controls)controls.classList.toggle('hidden',state.role!=='hider'||finished);
    const start=$('startGameClockButton'),pause=$('pauseGameClockButton');if(start){start.textContent=Number(state.game.clock_elapsed_seconds||0)>0?'Resume':'Start';start.disabled=!!state.game.clock_running||!!turntables;}if(pause)pause.disabled=!state.game.clock_running||!!turntables;
    const status=$('gameClockStatus');if(status)status.textContent=turntables?'Turntables pause':(state.game.clock_running?'Running':'Paused');
    const found=$('hiderFoundButton'),summary=$('finalScoreSummary');if(found){found.disabled=finished;found.textContent=finished?'Game Finished':'Hider Found';}
    if(summary){if(finished){summary.classList.remove('hidden');summary.innerHTML=`<strong>Final time: ${formatCountdown(final)}</strong><span>Raw ${formatCountdown(raw)} · Cards +${Number(state.game.final_bonus_minutes||0)} min · Traps +${Number(state.game.final_trap_minutes||0)} min · Penalties −${Number(state.game.final_penalty_minutes||0)} min</span>`;}else{summary.classList.add('hidden');summary.innerHTML='';}}
  }
  async function setGameClock(action){const title=action==='pause'?'Pause clock?':(Number(state.game.clock_elapsed_seconds||0)>0?'Resume clock?':'Start clock?');const ok=await confirmAction(title,'',action==='pause'?'Pause':'Start');if(!ok)return;const {error}=await state.supabase.rpc('set_game_clock_v1',{p_game_id:state.game.id,p_password:state.hiderPassword,p_action:action});if(error)throw error;await reloadGameState();}
  async function finishGame(){
    if(!state.game||state.game.status==='finished')return;const ok=await confirmAction('Hider Found?','End the game and calculate the final time from held bonuses, triggered Time Traps, and answer penalties.','End Game',true);if(!ok)return;
    const {error}=await state.supabase.rpc('finish_game_v1',{p_game_id:state.game.id,p_actor:state.role,p_password:state.role==='hider'?state.hiderPassword:null});if(error)throw error;await reloadGameState();
  }


  function formatDuration(s){s=Number(s)||0;if(s%3600===0&&s>=3600)return`${s/3600} h`;if(s%60===0)return`${s/60} min`;return`${s} sec`;}
  function formatCountdown(s){s=Math.max(0,Math.floor(s));const h=Math.floor(s/3600),m=Math.floor((s%3600)/60),sec=s%60;return h?`${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`:`${m}:${String(sec).padStart(2,'0')}`;}

  async function syncServerClock(){try{const before=Date.now();const {data,error}=await state.supabase.rpc('server_now');const after=Date.now();if(error)throw error;state.serverOffsetMs=new Date(data).getTime()-(before+after)/2;$('serverClockStatus').textContent='Synced';}catch(_){state.serverOffsetMs=0;$('serverClockStatus').textContent='Local clock';}}
  function serverNowMs(){return Date.now()+state.serverOffsetMs;}
  function startTimers(){clearInterval(state.timerId);state.timerId=setInterval(()=>{if(state.game){const a38=!!activePassierscheinAction();if(state.passierscheinWasActive&&!a38){state.passierscheinWasActive=false;recomputePossibleArea().then(()=>{renderPossibleArea();renderActivity();}).catch(console.warn);}else if(a38)state.passierscheinWasActive=true;renderActiveCurses();renderTimeTraps();renderGameClock();renderAnswerDeadlines();renderTurntablesPanel();renderTurntablesFreezeControls();if(state.role==='hider')renderSeekerLiveForHider();if(state.role==='seeker')renderQuestionDeck();applyDeveloperPreviewReadOnly();}},1000);}

  function subscribeRealtime(){
    if(state.realtimeChannel)state.supabase.removeChannel(state.realtimeChannel);$('syncBadge').textContent=state.developerPreview?'READ ONLY':'Live';$('syncBadge').className=state.developerPreview?'badge warn':'badge ok';state.realtimeChannel=state.supabase.channel(`game-${state.game.id}`).on('postgres_changes',{event:'*',schema:'public',table:'game_actions',filter:`game_id=eq.${state.game.id}`},()=>reloadGameState().catch(handleError)).on('postgres_changes',{event:'UPDATE',schema:'public',table:'games',filter:`id=eq.${state.game.id}`},()=>reloadGameState().catch(handleError)).subscribe(status=>{if(status==='SUBSCRIBED'){$('syncBadge').textContent=state.developerPreview?'READ ONLY':'Live';$('syncBadge').className=state.developerPreview?'badge warn':'badge ok';}else if(['CHANNEL_ERROR','TIMED_OUT'].includes(status)){$('syncBadge').textContent='Polling';$('syncBadge').className='badge warn';}});clearInterval(state.pollId);state.pollId=setInterval(()=>{if(state.game)reloadGameState().catch(()=>{});},15000);
  }

  async function hashPayload(obj){
    const text=JSON.stringify(obj);const bytes=new TextEncoder().encode(text);const digest=await crypto.subtle.digest('SHA-256',bytes);return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
  }
  async function saveReferenceDataset(key,payload,source){
    const hash=await hashPayload(payload);
    const {data,error}=await state.supabase.rpc('admin_save_reference_dataset_v1',{p_password:state.developerPassword,p_dataset_key:key,p_payload:payload,p_source:source,p_content_hash:hash});
    if(error)throw error;return data;
  }
  function refreshGrid(rows=REFRESH_GRID_ROWS,cols=REFRESH_GRID_COLS){
    const [south,west,north,east]=VIENNA_BBOX.split(',').map(Number);
    const dLat=(north-south)/rows,dLng=(east-west)/cols,out=[];
    for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){
      const s=south+r*dLat,n=south+(r+1)*dLat,w=west+c*dLng,e=west+(c+1)*dLng;
      out.push({id:`r${r}c${c}`,row:r,col:c,south:s,west:w,north:n,east:e,overpass:`${s},${w},${n},${e}`,wfs:`${w},${s},${e},${n},EPSG:4326`});
    }
    return out;
  }
  function chunkDatasetKey(baseKey,tileId){return `${baseKey}__chunk_${tileId}`;}
  async function referenceChunkRows(baseKey){
    initSupabaseIfNeeded();
    const {data,error}=await state.supabase.from('reference_datasets').select('dataset_key,payload,source,content_hash,updated_at,checked_at').like('dataset_key',`${baseKey}__chunk_%`).order('dataset_key');
    if(error)throw error;return data||[];
  }
  function rowFresh(row){
    const t=Date.parse(row?.checked_at||row?.updated_at||'');
    return Number.isFinite(t) && Date.now()-t < REFRESH_CHUNK_MAX_AGE_DAYS*86400e3;
  }
  function stableFeatureKey(f){
    const p=f?.properties||{};
    const id=f?.id??p.OBJECTID??p.FID??p.OGC_FID??p.ID??p.OBJECTID_1;
    if(id!==undefined&&id!==null)return String(id);
    return JSON.stringify([f?.geometry?.type,f?.geometry?.coordinates,p.NAME??p.NAMEK??p.BEZEICHNUNG??'']);
  }
  function mergeFeatureCollections(rows){
    const seen=new Set(),features=[];
    for(const row of rows){
      for(const f of (row?.payload?.features||[])){const k=stableFeatureKey(f);if(seen.has(k))continue;seen.add(k);features.push(f);}
    }
    return {type:'FeatureCollection',features};
  }
  function mergePoiRows(rows){
    const by=new Map();
    for(const row of rows)for(const p of (row?.payload?.pois||[])){
      const k=String(p.id||`${Number(p.lat).toFixed(6)},${Number(p.lng).toFixed(6)},${p.name||''}`);
      if(!by.has(k))by.set(k,p);
    }
    return {pois:[...by.values()]};
  }
  async function saveChunk(baseKey,tile,payload,source){return saveReferenceDataset(chunkDatasetKey(baseKey,tile.id),payload,source);}
  async function fetchWfsTile(layer,label,tile){return fetchViennaWfs(layer,`${label} · ${tile.id}`,{bbox:tile.wfs});}
  async function refreshWfsLayerChunks(baseKey,layer,label,statusEl,{force=false}={}){
    const tiles=refreshGrid();const existing=await referenceChunkRows(baseKey);const by=new Map(existing.map(r=>[r.dataset_key,r]));const failures=[];let saved=0,skipped=0;
    for(let i=0;i<tiles.length;i++){
      const tile=tiles[i],key=chunkDatasetKey(baseKey,tile.id),old=by.get(key);
      if(!force&&old&&rowFresh(old)){skipped++;statusEl.textContent=`${label}: tile ${i+1}/${tiles.length} already cached`;continue;}
      statusEl.textContent=`${label}: downloading tile ${i+1}/${tiles.length} (${tile.id})…`;
      try{const geo=await fetchWfsTile(layer,label,tile);await saveChunk(baseKey,tile,{features:geo.features||[]},`Stadt Wien WFS · ${layer} · ${tile.id}`);saved++;}
      catch(e){failures.push(`${tile.id}: ${e.message}`);console.warn(label,tile.id,e);}
      await new Promise(r=>setTimeout(r,120));
    }
    const rows=await referenceChunkRows(baseKey);const have=new Set(rows.map(r=>r.dataset_key));const missing=tiles.filter(t=>!have.has(chunkDatasetKey(baseKey,t.id)));
    return {rows,tiles,missing,failures,saved,skipped,complete:missing.length===0};
  }
  async function fetchPoiTile(type,tile){
    const filter=POI_QUERIES[type];if(!filter)throw new Error(`No data source for ${type}.`);
    const layer=WFS_POI_LAYERS[type];
    if(layer){
      try{
        const geo=await fetchWfsTile(layer,`${humanize(type)} (Stadt Wien)`,tile);
        return {pois:(geo.features||[]).map((f,i)=>featureToPoi(f,type,i)).filter(Boolean),source:`Stadt Wien WFS · ${layer}`};
      }catch(e){console.warn(`${humanize(type)} WFS tile ${tile.id} failed, falling back to small Overpass tile`,e);}
    }
    const filters=Array.isArray(filter)?filter:[filter];const body=filters.map(f=>`nwr${f}(${tile.overpass});`).join('');
    const q=`[out:json][timeout:20];(${body});out center tags qt;`;
    const osm=await fetchOverpass(q,`${humanize(type)} tile ${tile.id}`,25000);
    return {pois:parsePoiElements(osm,type),source:'OpenStreetMap / Overpass'};
  }
  async function refreshPoiChunked(type,statusEl,{force=false}={}){
    const finalKey=REF_POI_PREFIX+type+'_v1',tiles=refreshGrid();const existing=await referenceChunkRows(finalKey);const by=new Map(existing.map(r=>[r.dataset_key,r]));const failures=[];let saved=0,skipped=0;
    for(let i=0;i<tiles.length;i++){
      const tile=tiles[i],key=chunkDatasetKey(finalKey,tile.id),old=by.get(key);
      if(!force&&old&&rowFresh(old)){skipped++;statusEl.textContent=`${humanize(type)}: tile ${i+1}/${tiles.length} already cached`;continue;}
      statusEl.textContent=`${humanize(type)}: downloading tile ${i+1}/${tiles.length} (${tile.id})…`;
      try{const part=await fetchPoiTile(type,tile);await saveChunk(finalKey,tile,{pois:part.pois},`${part.source} · ${tile.id}`);saved++;}
      catch(e){failures.push(`${tile.id}: ${e.message}`);console.warn(type,tile.id,e);}
      await new Promise(r=>setTimeout(r,180));
    }
    const rows=await referenceChunkRows(finalKey);const have=new Set(rows.map(r=>r.dataset_key));const missing=tiles.filter(t=>!have.has(chunkDatasetKey(finalKey,t.id)));
    if(!missing.length){const merged=mergePoiRows(rows);await saveReferenceDataset(finalKey,merged,`Chunked Vienna refresh · ${tiles.length} tiles`);return {complete:true,missing,failures,saved,skipped,count:merged.pois.length};}
    return {complete:false,missing,failures,saved,skipped,count:mergePoiRows(rows).pois.length};
  }
  async function refreshTransitChunked(city,statusEl,{force=false}={}){
    const defs=[
      [REF_RAW_TRANSIT_LINES,VIENNA_TRANSIT_LINES_LAYER,'Transit lines'],
      [REF_RAW_UBAHN_STOPS,VIENNA_UBAHN_STOPS_LAYER,'U-Bahn stops'],
      [REF_RAW_ALL_STOPS,VIENNA_TRANSIT_STOPS_LAYER,'Public transport stops']
    ];
    const results=[];
    for(const [base,layer,label] of defs)results.push(await refreshWfsLayerChunks(base,layer,label,statusEl,{force}));
    const [lineRows,uRows,sRows]=await Promise.all([referenceChunkRows(REF_RAW_TRANSIT_LINES),referenceChunkRows(REF_RAW_UBAHN_STOPS),referenceChunkRows(REF_RAW_ALL_STOPS)]);
    const tiles=refreshGrid();const complete=[lineRows,uRows,sRows].every(rows=>new Set(rows.map(r=>r.dataset_key)).size>=tiles.length);
    if(!complete)return {complete:false,results};
    statusEl.textContent='Assembling cached transit chunks…';
    await new Promise(r=>setTimeout(r,0));
    const linesGeo=mergeFeatureCollections(lineRows),uGeo=mergeFeatureCollections(uRows),stopsGeo=mergeFeatureCollections(sRows);
    statusEl.textContent='Building U-Bahn/S-Bahn network…';
    await new Promise(r=>setTimeout(r,0));
    const railLines=normalizeOfficialTransitLines(linesGeo);
    statusEl.textContent='Building station list from Vienna line attributes…';
    await new Promise(r=>setTimeout(r,0));
    const stations=normalizeOfficialStations(uGeo,stopsGeo,railLines,city);
    if(stations.length<20)throw new Error(`Chunked Vienna transport data produced only ${stations.length} U-/S-Bahn stations.`);
    statusEl.textContent=`Saving ${stations.length} stations…`;
    await saveReferenceDataset(REF_STATIONS_KEY,{stations},`Chunked Stadt Wien WFS · ${tiles.length} tiles`);
    statusEl.textContent=`Saving ${railLines.length} U-/S-Bahn line segments…`;
    await saveReferenceDataset(REF_TRANSIT_KEY,{railLines},`Chunked Stadt Wien WFS · ${tiles.length} tiles`);
    return {complete:true,results,stations:stations.length,lines:railLines.length};
  }
  function normalizeOfficialDistricts(geo){
    const features=(geo?.features||[]).filter(isPolygon);const districts=[];
    for(const f of features){const p=f.properties||{};const n=Number(p.BEZNR??p.BEZ??p.beznr??p.bez);if(!Number.isInteger(n)||n<1||n>23)continue;districts.push({feature:f,number:n,name:p.BEZ_NAMEG||p.NAMEG||p.NAMEK||p.BEZ_NAME||p.name||`${n}. Bezirk`});}
    districts.sort((a,b)=>a.number-b.number);
    if(!validateDistricts(districts))throw new Error(`Official Vienna district service returned ${districts.length} valid districts; expected 23.`);
    let city=null;for(const d of districts)city=safeUnion(city,d.feature);if(!city)throw new Error('Could not build Vienna boundary from the 23 official districts.');
    return {city,districts};
  }
  async function fetchOfficialAdminData(){
    // Prefer Vienna's official ArcGIS Feature Layer. It returns WGS84 GeoJSON directly
    // and avoids WFS CRS/axis-order quirks that caused incomplete/invalid district refreshes.
    try{
      const geo=await fetchJsonUrl(VIENNA_DISTRICT_ARCGIS,'Vienna district boundaries (ArcGIS)',25000);
      return normalizeOfficialDistricts(geo);
    }catch(primaryError){
      console.warn('Vienna ArcGIS district source failed; trying official WFS fallback',primaryError);
      const geo=await fetchViennaWfs(VIENNA_DISTRICTS_LAYER,'Vienna district boundaries (WFS)');
      return normalizeOfficialDistricts(geo);
    }
  }
  async function fetchStationReference(){
    const admin=await referenceDataset(REF_ADMIN_KEY);const city=admin?.city||state.mapData?.city;
    const bundle=await fetchOfficialTransitBundle(city);
    return {stations:bundle.stations};
  }
  async function fetchTransitReference(){
    const admin=await referenceDataset(REF_ADMIN_KEY);const city=admin?.city||state.mapData?.city;
    const bundle=await fetchOfficialTransitBundle(city);
    return {railLines:bundle.railLines};
  }
  async function refreshOnePoi(type,statusEl=$('developerReferenceStatus'),options={}){
    return refreshPoiChunked(type,statusEl,options);
  }
  async function refreshReferenceData(scope='core',options={}){
    if(!state.developerPassword)return toast('Log in to Developer first.');
    const status=$('developerReferenceStatus');status.textContent=`v${APP_VERSION} · Resumable refresh starting…`;
    const failures=[];let changed=0;
    if(scope==='core'||scope==='all'){
      let admin=null;
      try{
        status.textContent='Refreshing official Vienna districts…';
        admin=await fetchOfficialAdminData();await saveReferenceDataset(REF_ADMIN_KEY,admin,'Stadt Wien official districts');changed++;
      }catch(e){failures.push(`Districts: ${e.message}`);}
      if(admin){
        try{
          const tr=await refreshTransitChunked(admin.city,status,options);
          if(!tr.complete){const miss=tr.results.flatMap(x=>x.missing||[]).length;failures.push(`Transit cache is incomplete (${miss} tile-layer chunks still missing). Run refresh again; completed chunks are already saved.`);}
          else changed+=2;
        }catch(e){failures.push(`Transit: ${e.message}`);}
      }
    }
    if(scope==='pois'||scope==='all'){
      for(const type of ACTIVE_POI_TYPES){
        try{
          const r=await refreshPoiChunked(type,status,options);
          if(r.complete)changed++;
          else failures.push(`${humanize(type)}: ${r.missing.length}/${refreshGrid().length} tiles still missing. Run refresh again; successful tiles are already stored.`);
        }catch(e){failures.push(`${humanize(type)}: ${e.message}`);}
      }
    }
    state.mapData=null;state.poiCache={};
    status.textContent=`v${APP_VERSION} · refresh finished · ${changed} assembled dataset${changed===1?'':'s'}${failures.length?` · ${failures.length} incomplete/failed`:''}`;
    if(failures.length)toast(`Refresh is resumable. Some parts are still incomplete:
${failures.join('\n')}`,9000);
    await loadDeveloperDashboard();
  }
  async function refreshSelectedPoi(){
    if(!state.developerPassword)return toast('Log in to Developer first.');
    const type=$('developerPoiSelect')?.value;if(!type)return;const status=$('developerReferenceStatus');
    try{const r=await refreshPoiChunked(type,status,{});status.textContent=r.complete?`${humanize(type)} complete · ${r.count} POIs`:`${humanize(type)} partial · ${r.missing.length} tiles missing`;if(!r.complete)toast('Partial data were saved. Press the same refresh again to retry only missing/old tiles.',6000);await loadDeveloperDashboard();}
    catch(e){handleError(e);}
  }
  async function importBrowserReferenceCache(){
    if(!state.developerPassword)return;
    let count=0;
    try{
      const core=JSON.parse(localStorage.getItem(CACHE_KEY)||'null');
      if(core?.city&&validateDistricts(core.districts)&&core.stations?.length){await saveReferenceDataset(REF_ADMIN_KEY,{city:core.city,districts:core.districts},'Imported browser cache');await saveReferenceDataset(REF_STATIONS_KEY,{stations:core.stations},'Imported browser cache');count+=2;}
      const rails=JSON.parse(localStorage.getItem(RAIL_CACHE_KEY)||'null');if(Array.isArray(rails)&&rails.length){await saveReferenceDataset(REF_TRANSIT_KEY,{railLines:rails},'Imported browser cache');count++;}
      for(const type of ACTIVE_POI_TYPES){const obj=JSON.parse(localStorage.getItem(POI_CACHE_PREFIX+type)||'null');if(Array.isArray(obj?.pois)){await saveReferenceDataset(REF_POI_PREFIX+type+'_v1',{pois:obj.pois},'Imported browser cache');count++;}}
      toast(`Imported ${count} cached dataset${count===1?'':'s'} to Supabase.`);await loadDeveloperDashboard();
    }catch(e){handleError(e);}
  }
  function showDeveloperTab(name){
    document.querySelectorAll('[data-developer-tab]').forEach(b=>b.classList.toggle('active',b.dataset.developerTab===name));
    $('developerReferenceTab').classList.toggle('hidden',name!=='reference');
    $('developerCardsTab').classList.toggle('hidden',name!=='cards');
    $('developerQuestionsTab').classList.toggle('hidden',name!=='questions');
    $('developerGamesTab').classList.toggle('hidden',name!=='games');
  }
  function minuteCostOptions(selected){
    const values=[];for(let m=5;m<=60;m+=5)values.push(m);values.push(90,120);
    return values.map(m=>`<option value="${m}" ${Number(selected)===m?'selected':''}>${m} min</option>`).join('');
  }
  function durationOptions(seconds){
    const options=[[null,'No timer'],[600,'10 min'],[1200,'20 min'],[1800,'30 min'],[2400,'40 min'],[2700,'45 min'],[3600,'60 min'],[5400,'90 min'],[7200,'120 min']];
    return options.map(([v,label])=>`<option value="${v??''}" ${String(seconds??'')===String(v??'')?'selected':''}>${label}</option>`).join('');
  }
  function deckCountOptions(selected){
    const vals=[];for(let n=0;n<=20;n++)vals.push(n);vals.push(25,30,40,50);
    return vals.map(n=>`<option value="${n}" ${Number(selected??1)===n?'selected':''}>${n}</option>`).join('');
  }
  function drawKeepCountOptions(selected){
    const n=Math.max(1,Math.min(10,Number(selected||1)));return Array.from({length:10},(_,i)=>i+1).map(v=>`<option value="${v}" ${n===v?'selected':''}>${v}</option>`).join('');
  }
  function developerCardHtml(c={},isNew=false){
    const costKind=c.cast_cost_kind||((Number(c.cast_cost_minutes||0)>0)?'time':'none'),secMode=c.secondary_effect_mode||'none';
    const key=c.card_key||'',isCurse=isNew||(c.card_kind||'curse')==='curse',special=!!c.special_engine,isDrawKeep=c.effect_key==='same_day_delivery';
    return `<div class="developer-card ${Number(c.deck_count??1)===0?'disabled':''}" data-developer-card="${escapeHtml(key)}" data-new-card="${isNew?'true':'false'}" data-special-card="${special?'true':'false'}">
      <div class="card-key">${isNew?'New card · key created on save':escapeHtml(key)}${special?' · engine effect: '+escapeHtml(c.effect_key||''):''}</div>
      <div class="developer-card-grid">
        <label>Title<input class="dev-card-title" maxlength="120" value="${escapeHtml(c.title||'')}"></label>
        <label>Type<select class="dev-card-kind" disabled><option value="curse" ${(c.card_kind||'curse')==='curse'?'selected':''}>Curse</option><option value="powerup" ${c.card_kind==='powerup'?'selected':''}>Power-up</option><option value="time_bonus" ${c.card_kind==='time_bonus'?'selected':''}>Time bonus</option><option value="time_trap" ${c.card_kind==='time_trap'?'selected':''}>Time trap</option></select></label>
        <label>Duration<select class="dev-card-duration">${durationOptions(c.duration_seconds)}</select></label>
        <label>Copies<select class="dev-card-count card-count-select">${deckCountOptions(c.deck_count??1)}</select></label>
        ${isDrawKeep?`<label>Cards drawn<select class="dev-card-draw-count">${drawKeepCountOptions(c.draw_count||3)}</select></label><label>Cards kept<select class="dev-card-keep-limit">${drawKeepCountOptions(c.keep_limit||2)}</select></label>`:''}
      </div>
      <label>Card text<textarea class="dev-card-description" maxlength="1200">${escapeHtml(c.description||'')}</textarea></label>
      <div class="card-cost-row ${isCurse||isDrawKeep?'':'hidden'}">
        <label>Casting cost<select class="dev-card-cost-kind"><option value="none" ${costKind==='none'?'selected':''}>None</option><option value="time" ${costKind==='time'?'selected':''}>Time bonus</option><option value="discard_any" ${costKind==='discard_any'?'selected':''}>Discard any other card</option><option value="discard_category" ${costKind==='discard_category'?'selected':''}>Discard card by category</option><option value="custom" ${costKind==='custom'?'selected':''}>Custom / physical</option></select></label>
        <label class="card-cost-minutes ${costKind==='time'?'':'hidden'}">Minutes<select class="dev-card-cost-minutes">${minuteCostOptions(c.cast_cost_minutes||5)}</select></label>
        <label class="card-cost-category ${costKind==='discard_category'?'':'hidden'}">Card category<select class="dev-card-cost-category"><option value="curse" ${c.cast_cost_category==='curse'?'selected':''}>Curse</option><option value="veto" ${c.cast_cost_category==='veto'?'selected':''}>Veto</option><option value="time_bonus" ${c.cast_cost_category==='time_bonus'?'selected':''}>Time bonus</option><option value="powerup" ${c.cast_cost_category==='powerup'?'selected':''}>Power-up</option><option value="time_trap" ${c.cast_cost_category==='time_trap'?'selected':''}>Time Trap</option></select></label>
        <label class="card-cost-custom ${costKind==='custom'?'':'hidden'}">Custom cost<input class="dev-card-cost-text" maxlength="240" value="${escapeHtml(c.cast_cost_text||'')}" placeholder="e.g. Spot a person standing left on an escalator"></label>
      </div>
      ${isCurse?`<div class="card-secondary-row">
        <label>Hidden fine print<select class="dev-card-secondary-mode"><option value="none" ${secMode==='none'?'selected':''}>None</option><option value="custom" ${secMode==='custom'?'selected':''}>Custom text</option><option value="engine" ${secMode==='engine'?'selected':''}>Engine effect</option></select></label>
        <label class="secondary-effect-text ${secMode==='none'?'hidden':''}">Secondary text<textarea class="dev-card-secondary-text" maxlength="1200" placeholder="Hidden until Kleingedrucktes is played">${escapeHtml(c.secondary_effect_text||'')}</textarea></label>
        <label class="secondary-engine-key ${secMode==='engine'?'':'hidden'}">Engine key<input class="dev-card-secondary-key" maxlength="120" value="${escapeHtml(c.secondary_engine_key||'')}" placeholder="future_engine_effect"></label>
        <label class="secondary-engine-payload ${secMode==='engine'?'':'hidden'}">Engine config (JSON)<textarea class="dev-card-secondary-payload" placeholder='{"value":1}'>${escapeHtml(JSON.stringify(c.secondary_engine_payload||{},null,2))}</textarea></label>
      </div>`:''}
      ${special?'<div class="mini-status">Built-in primary effect. Its engine behavior is intentionally not editable here.</div>':(!isCurse?'<div class="mini-status">This special card uses its built-in action.</div>':'')}
      <div class="developer-card-actions"><button class="secondary" data-save-developer-card>Save</button>${isNew||special?'':`<button class="danger" data-delete-developer-card>Remove</button>`}</div>
    </div>`;
  }
  function renderDeveloperCards(cards){
    state.developerCards=cards||[];
    const regular=state.developerCards.filter(c=>!c.special_engine),special=state.developerCards.filter(c=>c.special_engine);
    $('developerCards').innerHTML=regular.length?regular.map(c=>developerCardHtml(c,false)).join(''):'<div class="status-box">No editable cards.</div>';
    $('developerSpecialCards').innerHTML=special.length?special.map(c=>developerCardHtml(c,false)).join(''):'<div class="status-box">No engine cards.</div>';
    bindDeveloperCardRows();
  }
  function bindDeveloperCardRows(){
    document.querySelectorAll('#developerCards .dev-card-cost-kind,#developerSpecialCards .dev-card-cost-kind').forEach(sel=>{if(sel.dataset.bound)return;sel.dataset.bound='1';sel.addEventListener('change',()=>{const row=sel.closest('.developer-card'),kind=sel.value;row.querySelector('.card-cost-minutes')?.classList.toggle('hidden',kind!=='time');row.querySelector('.card-cost-category')?.classList.toggle('hidden',kind!=='discard_category');row.querySelector('.card-cost-custom')?.classList.toggle('hidden',kind!=='custom');});});
    document.querySelectorAll('#developerCards .dev-card-secondary-mode,#developerSpecialCards .dev-card-secondary-mode').forEach(sel=>{if(sel.dataset.bound)return;sel.dataset.bound='1';sel.addEventListener('change',()=>{const row=sel.closest('.developer-card'),mode=sel.value;row.querySelector('.secondary-effect-text')?.classList.toggle('hidden',mode==='none');row.querySelector('.secondary-engine-key')?.classList.toggle('hidden',mode!=='engine');row.querySelector('.secondary-engine-payload')?.classList.toggle('hidden',mode!=='engine');});});
    document.querySelectorAll('#developerCards [data-save-developer-card],#developerSpecialCards [data-save-developer-card]').forEach(b=>{if(b.dataset.bound)return;b.dataset.bound='1';b.addEventListener('click',()=>adminSaveCard(b.closest('.developer-card')).catch(handleError));});
    document.querySelectorAll('#developerCards [data-delete-developer-card]').forEach(b=>{if(b.dataset.bound)return;b.dataset.bound='1';b.addEventListener('click',()=>adminDeleteCard(b.closest('.developer-card')).catch(handleError));});
  }
  function addDeveloperCardForm(){
    if($('developerCards').querySelector('[data-new-card="true"]'))return toast('Finish or remove the new card form first.');
    $('developerCards').insertAdjacentHTML('afterbegin',developerCardHtml({card_kind:'curse',effect_key:'custom_rule',deck_count:1,cast_cost_kind:'none'},true));bindDeveloperCardRows();
    $('developerCards').querySelector('[data-new-card="true"] .dev-card-title')?.focus();
  }
  async function adminSaveCard(row){
    const isNew=row.dataset.newCard==='true',costKind=row.querySelector('.dev-card-cost-kind')?.value||'none';
    const old=state.developerCards.find(c=>c.card_key===row.dataset.developerCard),isDrawKeep=old?.effect_key==='same_day_delivery';
    const secMode=row.querySelector('.dev-card-secondary-mode')?.value||'none';let secPayload={};
    if(secMode==='engine'){try{secPayload=JSON.parse(row.querySelector('.dev-card-secondary-payload')?.value||'{}');if(!secPayload||Array.isArray(secPayload)||typeof secPayload!=='object')throw new Error();}catch(_){return toast('Secondary engine config must be a JSON object.');}}
    const args={
      p_password:state.developerPassword,p_card_key:isNew?'':row.dataset.developerCard,
      p_title:row.querySelector('.dev-card-title').value.trim(),p_description:row.querySelector('.dev-card-description').value.trim(),
      p_duration_seconds:row.querySelector('.dev-card-duration').value===''?null:Number(row.querySelector('.dev-card-duration').value),
      p_card_kind:row.querySelector('.dev-card-kind').value,p_effect_key:isNew?'custom_rule':(old?.effect_key||'custom_rule'),
      p_value_int:isNew?null:(old?.value_int??null),p_cast_cost_kind:costKind,
      p_cast_cost_minutes:costKind==='time'?Number(row.querySelector('.dev-card-cost-minutes').value):0,
      p_cast_cost_text:costKind==='custom'?row.querySelector('.dev-card-cost-text').value.trim():null,
      p_cast_cost_category:costKind==='discard_category'?row.querySelector('.dev-card-cost-category').value:null,
      p_deck_count:Number(row.querySelector('.dev-card-count').value),
      p_draw_count:isDrawKeep?Number(row.querySelector('.dev-card-draw-count')?.value||3):null,p_keep_limit:isDrawKeep?Number(row.querySelector('.dev-card-keep-limit')?.value||2):null,
      p_secondary_effect_mode:secMode,p_secondary_effect_text:secMode==='none'?null:(row.querySelector('.dev-card-secondary-text')?.value.trim()||null),
      p_secondary_engine_key:secMode==='engine'?(row.querySelector('.dev-card-secondary-key')?.value.trim()||null):null,
      p_secondary_engine_payload:secMode==='engine'?secPayload:{}
    };
    const ok=await confirmAction(isNew?'Add this card?':'Save card changes?',`${args.p_title}\nCopies: ${args.p_deck_count}\n\n${args.p_description}`,'Save');if(!ok)return;
    const {error}=await state.supabase.rpc('admin_save_card_v5',args);if(error)throw error;await loadDeveloperDashboard();showDeveloperTab('cards');
  }
  async function adminDeleteCard(row){
    const key=row.dataset.developerCard,title=row.querySelector('.dev-card-title').value.trim();
    const ok=await confirmAction('Delete this card definition?',`${title}\n\nAlready-drawn cards in running games keep their snapshot.`,'Delete',true);if(!ok)return;
    const {error}=await state.supabase.rpc('admin_delete_card_v1',{p_password:state.developerPassword,p_card_key:key});if(error)throw error;await loadDeveloperDashboard();showDeveloperTab('cards');
  }

  const QUESTION_KINDS=['district','same_line','station_interchange','street_shape','bus_line_tentacle','vor_navigation','district_set','landmark_compare','directional','radar','thermometer','tentacle','photo'];
  function questionParamFields(q={}){
    const p=q.params||{};switch(q.question_kind||'radar'){
      case 'radar':return `<label>Radius (m)<input class="dev-q-radius" type="number" min="10" step="10" value="${Number(p.radius_m??1000)}"></label>`;
      case 'thermometer':return `<label>Minimum movement (m)<input class="dev-q-travel" type="number" min="10" step="10" value="${Number(p.min_travel_m??500)}"></label>`;
      case 'district_set':return `<label>Districts (comma separated)<input class="dev-q-districts" value="${escapeHtml((p.districts||[]).join(','))}"></label><label>Yes label<input class="dev-q-yes" value="${escapeHtml(p.yes_label||'Yes')}"></label><label>No label<input class="dev-q-no" value="${escapeHtml(p.no_label||'No')}"></label>`;
      case 'landmark_compare':return `<label>Landmark<input class="dev-q-landmark-name" value="${escapeHtml(p.landmark_name||'Landmark')}"></label><label>Latitude<input class="dev-q-lat" type="number" step="0.000001" value="${Number(p.landmark?.lat??48.20849)}"></label><label>Longitude<input class="dev-q-lng" type="number" step="0.000001" value="${Number(p.landmark?.lng??16.37208)}"></label>`;
      case 'directional':return `<label>Axis<select class="dev-q-axis"><option value="lat" ${p.axis==='lat'?'selected':''}>North / South</option><option value="lng" ${p.axis==='lng'?'selected':''}>East / West</option></select></label><label>Positive label<input class="dev-q-positive" value="${escapeHtml(p.positive_label||'Yes')}"></label><label>Negative label<input class="dev-q-negative" value="${escapeHtml(p.negative_label||'No')}"></label>`;
      case 'tentacle':return `<label>POI category<select class="dev-q-poi">${ACTIVE_POI_TYPES.map(t=>`<option value="${t}" ${p.poi_type===t?'selected':''}>${humanize(t)}</option>`).join('')}</select></label>`;
      case 'photo':return `<label>Photo prompt<input class="dev-q-photo" value="${escapeHtml(p.photo_prompt||q.title||'Photo')}"></label>`;
      default:return `<div class="mini-status">No numeric parameters for this rule type.</div>`;
    }
  }
  function questionRulePreview(q={}){
    const p=q.params||{},k=q.question_kind||q.kind;switch(k){
      case 'radar':return `Internal comparison:\ndistance(target, seeker_origin) <= ${Number(p.radius_m??q.radius_m??0)} m\nMap cut: keep circle on YES; remove circle on NO.`;
      case 'thermometer':return `Internal comparison:\ndistance(target, B) < distance(target, A)\nA = armed start; B = current seeker point after >= ${Number(p.min_travel_m??q.min_travel_m??0)} m.\nMap cut: perpendicular bisector; keep B side for Warmer, A side for Colder.`;
      case 'district':return `Reference: ${REF_ADMIN_KEY}\nInternal: district(target) == district(seeker_origin).\nUses point-in-polygon against the 23 stored Vienna district polygons.`;
      case 'district_set':return `Reference: ${REF_ADMIN_KEY}\nInternal: district(target) IN [${(p.districts||q.districts||[]).join(', ')}].`;
      case 'landmark_compare':{const lm=p.landmark||q.landmark||{};return `Internal comparison:\ndistance(target, [${lm.lat}, ${lm.lng}]) < distance(seeker_origin, [${lm.lat}, ${lm.lng}])\nMap cut: landmark-centered circle at the Seeker's current landmark distance.`;}
      case 'directional':return `Internal comparison:\n${(p.axis||q.axis)==='lat'?'target.latitude > seeker.latitude':'target.longitude > seeker.longitude'}\nMap cut: horizontal/vertical half-plane.`;
      case 'same_line':return `References: ${REF_STATIONS_KEY} + ${REF_TRANSIT_KEY}\nInternal: selected U-/S-Bahn line is present in target station lineRefs.\nYES: keep 250 m selected-line corridor.\nNO: remove only the selected line's exclusive 250 m corridor; preserve overlaps/crossings with other lines and interchange station areas.`;
      case 'station_interchange':return `Reference: ${REF_STATIONS_KEY}\nInternal: hiding station has at least two distinct U-/S-Bahn lineRefs.\nMap cut: keep/remove 250 m buffers around interchange stations.`;
      case 'tentacle':{const type=p.poi_type||q.poi_type||'museum',filter=POI_QUERIES[type];const fs=(Array.isArray(filter)?filter:[filter]).filter(Boolean).map(x=>`nwr${x}(S,W,N,E);`).join('\n');return `Reference dataset: ${REF_POI_PREFIX}${type}_v1\nDeveloper refresh Overpass fallback:\n[out:json][timeout:20];\n(${fs})\nout center tags qt;\n\nEndgame rule: if target-seeker >250 m -> automatic veto + exclude 250 m seeker circle. Otherwise use candidate POIs within 5 km and keep the answered POI's Voronoi cell.`;}
      case 'photo':return `No spatial comparison. The Hider sends the configured photo prompt through the private game-photo upload flow.`;
      case 'street_shape':return `Endgame engine rule: query nearest highway geometry around the private hiding point, preserve its real map orientation, remove labels/context, render a jittered black-on-white PNG, then send only the image.`;
      default:return 'Built-in rule.';
    }
  }
  function developerQuestionHtml(q={},isNew=false){
    const key=q.question_key||'',kind=q.question_kind||'radar',category=q.category||'MIXED';
    return `<div class="developer-question ${q.enabled===false?'disabled':''}" data-developer-question="${escapeHtml(key)}" data-new-question="${isNew?'true':'false'}">
      <div class="card-key">${isNew?'New question · key created on save':escapeHtml(key)}</div>
      <div class="developer-question-grid">
        <label>Title<input class="dev-q-title" maxlength="120" value="${escapeHtml(q.title||'')}"></label>
        <label>Category<select class="dev-q-category">${['MIXED','RADAR','THERMOMETER','TENTACLES','PHOTO'].map(x=>`<option value="${x}" ${category===x?'selected':''}>${x}</option>`).join('')}</select></label>
        <label>Rule type<select class="dev-q-kind">${QUESTION_KINDS.map(x=>`<option value="${x}" ${kind===x?'selected':''}>${x}</option>`).join('')}</select></label>
        <label>Order<input class="dev-q-order" type="number" step="10" value="${Number(q.sort_order??100)}"></label>
      </div>
      <label>Question text<textarea class="dev-q-description" maxlength="800">${escapeHtml(q.description||'')}</textarea></label>
      <div class="question-param-grid">${questionParamFields(q)}</div>
      <div class="row wrap"><label class="check-row"><input type="checkbox" class="dev-q-enabled" ${q.enabled===false?'':'checked'}> Enabled</label><label class="check-row"><input type="checkbox" class="dev-q-endgame" ${q.endgame_only?'checked':''}> Endgame only</label></div>
      <div><div class="mini-status">Rule / query preview</div><pre class="developer-rule-preview">${escapeHtml(questionRulePreview(q))}</pre></div>
      <div class="developer-card-actions"><button class="secondary" data-save-developer-question>Save</button>${isNew?'':`<button class="secondary" data-duplicate-developer-question>Duplicate</button><button class="danger" data-delete-developer-question>Remove</button>`}</div>
    </div>`;
  }
  function renderDeveloperQuestions(items){
    state.developerQuestions=items||[];
    $('developerQuestions').innerHTML=state.developerQuestions.length?state.developerQuestions.map(q=>developerQuestionHtml(q,false)).join(''):'<div class="status-box">No questions.</div>';
    bindDeveloperQuestionRows();
  }
  function currentQuestionFormObject(row){
    const kind=row.querySelector('.dev-q-kind').value;let params={};
    if(kind==='radar')params.radius_m=Number(row.querySelector('.dev-q-radius')?.value||1000);
    else if(kind==='thermometer')params.min_travel_m=Number(row.querySelector('.dev-q-travel')?.value||500);
    else if(kind==='district_set')params={districts:String(row.querySelector('.dev-q-districts')?.value||'').split(',').map(x=>Number(x.trim())).filter(x=>Number.isInteger(x)&&x>=1&&x<=23),yes_label:row.querySelector('.dev-q-yes')?.value.trim()||'Yes',no_label:row.querySelector('.dev-q-no')?.value.trim()||'No'};
    else if(kind==='landmark_compare')params={landmark_name:row.querySelector('.dev-q-landmark-name')?.value.trim()||'Landmark',landmark:{lat:Number(row.querySelector('.dev-q-lat')?.value),lng:Number(row.querySelector('.dev-q-lng')?.value)}};
    else if(kind==='directional')params={axis:row.querySelector('.dev-q-axis')?.value||'lat',positive_label:row.querySelector('.dev-q-positive')?.value.trim()||'Yes',negative_label:row.querySelector('.dev-q-negative')?.value.trim()||'No'};
    else if(kind==='tentacle')params={poi_type:row.querySelector('.dev-q-poi')?.value||'museum'};
    else if(kind==='photo')params={photo_prompt:row.querySelector('.dev-q-photo')?.value.trim()||row.querySelector('.dev-q-title').value.trim()};
    return {question_key:row.dataset.newQuestion==='true'?'':row.dataset.developerQuestion,category:row.querySelector('.dev-q-category').value,title:row.querySelector('.dev-q-title').value.trim(),description:row.querySelector('.dev-q-description').value.trim(),question_kind:kind,params,endgame_only:row.querySelector('.dev-q-endgame').checked,enabled:row.querySelector('.dev-q-enabled').checked,sort_order:Number(row.querySelector('.dev-q-order').value||100)};
  }
  function rebuildQuestionParamArea(row){
    const q=currentQuestionFormObject(row);row.querySelector('.question-param-grid').innerHTML=questionParamFields(q);row.querySelector('.developer-rule-preview').textContent=questionRulePreview(q);
    row.querySelector('.question-param-grid').querySelectorAll('input,select').forEach(el=>el.addEventListener('input',()=>{row.querySelector('.developer-rule-preview').textContent=questionRulePreview(currentQuestionFormObject(row));}));
  }
  function bindDeveloperQuestionRows(){
    $('developerQuestions').querySelectorAll('.developer-question').forEach(row=>{
      const kind=row.querySelector('.dev-q-kind');if(!kind.dataset.bound){kind.dataset.bound='1';kind.addEventListener('change',()=>rebuildQuestionParamArea(row));}
      row.querySelectorAll('.question-param-grid input,.question-param-grid select').forEach(el=>{if(el.dataset.bound)return;el.dataset.bound='1';el.addEventListener('input',()=>{row.querySelector('.developer-rule-preview').textContent=questionRulePreview(currentQuestionFormObject(row));});});
    });
    $('developerQuestions').querySelectorAll('[data-save-developer-question]').forEach(b=>b.addEventListener('click',()=>adminSaveQuestion(b.closest('.developer-question')).catch(handleError)));
    $('developerQuestions').querySelectorAll('[data-delete-developer-question]').forEach(b=>b.addEventListener('click',()=>adminDeleteQuestion(b.closest('.developer-question')).catch(handleError)));
    $('developerQuestions').querySelectorAll('[data-duplicate-developer-question]').forEach(b=>b.addEventListener('click',()=>duplicateDeveloperQuestion(b.closest('.developer-question'))));
  }
  function addDeveloperQuestionForm(seed=null){
    if($('developerQuestions').querySelector('[data-new-question="true"]'))return toast('Finish or remove the new question form first.');
    const q=seed?{...seed,question_key:'',title:`${seed.title} copy`,enabled:true}:{category:'RADAR',title:'New Radar',description:'',question_kind:'radar',params:{radius_m:1000},endgame_only:false,enabled:true,sort_order:999};
    $('developerQuestions').insertAdjacentHTML('afterbegin',developerQuestionHtml(q,true));bindDeveloperQuestionRows();$('developerQuestions').querySelector('[data-new-question="true"] .dev-q-title')?.focus();
  }
  function duplicateDeveloperQuestion(row){const q=state.developerQuestions.find(x=>x.question_key===row.dataset.developerQuestion);if(q)addDeveloperQuestionForm(q);}
  async function adminSaveQuestion(row){
    const q=currentQuestionFormObject(row),isNew=row.dataset.newQuestion==='true';
    const ok=await confirmAction(isNew?'Add this question?':'Save question changes?',`${q.title}\n${q.question_kind}`,'Save');if(!ok)return;
    const {error}=await state.supabase.rpc('admin_save_question_v1',{p_password:state.developerPassword,p_question_key:q.question_key,p_category:q.category,p_title:q.title,p_description:q.description,p_question_kind:q.question_kind,p_params:q.params,p_endgame_only:q.endgame_only,p_enabled:q.enabled,p_sort_order:q.sort_order});if(error)throw error;
    await loadDeveloperDashboard();await loadQuestionCatalog();showDeveloperTab('questions');
  }
  async function adminDeleteQuestion(row){
    const q=state.developerQuestions.find(x=>x.question_key===row.dataset.developerQuestion),title=q?.title||row.querySelector('.dev-q-title').value;
    const ok=await confirmAction('Delete this question?',`${title}\n\nAlready-asked questions in existing games remain in their activity history.`,'Delete',true);if(!ok)return;
    const {error}=await state.supabase.rpc('admin_delete_question_v1',{p_password:state.developerPassword,p_question_key:row.dataset.developerQuestion});if(error)throw error;
    await loadDeveloperDashboard();await loadQuestionCatalog();showDeveloperTab('questions');
  }

  async function developerLogin(){
    initSupabaseIfNeeded();const pw=$('developerPassword').value;if(!pw)return toast('Enter the developer password.');
    const {data,error}=await state.supabase.rpc('admin_list_games_v1',{p_password:pw});if(error)throw error;state.developerPassword=pw;$('developerLoginPanel').classList.add('hidden');$('developerPanel').classList.remove('hidden');renderDeveloperGames(data||[]);showDeveloperTab('reference');await loadDeveloperDashboard();
  }
  async function loadDeveloperDashboard(){
    if(!state.developerPassword)return;
    const [gamesRes,refsRes,cardsRes,questionsRes]=await Promise.all([
      state.supabase.rpc('admin_list_games_v1',{p_password:state.developerPassword}),
      state.supabase.from('reference_datasets').select('dataset_key,source,content_hash,updated_at,checked_at').order('dataset_key'),
      state.supabase.rpc('admin_list_cards_v5',{p_password:state.developerPassword}),
      state.supabase.rpc('admin_list_questions_v1',{p_password:state.developerPassword})
    ]);
    if(gamesRes.error)throw gamesRes.error;if(refsRes.error)throw refsRes.error;if(cardsRes.error)throw cardsRes.error;if(questionsRes.error)throw questionsRes.error;
    renderDeveloperGames(gamesRes.data||[]);renderReferenceStatus(refsRes.data||[]);renderDeveloperCards(cardsRes.data||[]);renderDeveloperQuestions(questionsRes.data||[]);
  }
  function renderReferenceStatus(refs){
    const required=[REF_ADMIN_KEY,REF_STATIONS_KEY,REF_TRANSIT_KEY,...ACTIVE_POI_TYPES.map(t=>REF_POI_PREFIX+t+'_v1')],by=new Map(refs.map(r=>[r.dataset_key,r])),tiles=refreshGrid();
    $('developerReferenceList').innerHTML=required.map(k=>{
      const r=by.get(k),poiType=k.startsWith(REF_POI_PREFIX)?k.slice(REF_POI_PREFIX.length,-3):null;
      let chunkHtml='';
      if(poiType){
        const have=new Set(refs.filter(x=>x.dataset_key.startsWith(`${k}__chunk_`)).map(x=>x.dataset_key));
        const missing=tiles.filter(t=>!have.has(chunkDatasetKey(k,t.id))).map(t=>t.id);
        if(missing.length){
          const shown=missing.slice(0,8),more=missing.length-shown.length;chunkHtml=`<div class="reference-missing-tiles"><span>${tiles.length-missing.length}/${tiles.length} tiles</span>${shown.map(x=>`<code>${x}</code>`).join('')}${more>0?`<span>+${more} more</span>`:''}<button class="secondary small" data-retry-poi="${escapeHtml(poiType)}">Retry missing</button></div>`;
        }else if(have.size){chunkHtml=`<div class="mini-status">${tiles.length}/${tiles.length} tiles stored</div>`;}
      }
      return `<div class="reference-row ${r?'ok':'missing'}"><strong>${escapeHtml(k)}</strong><span>${r?`${escapeHtml(r.source||'saved')} · changed ${new Date(r.updated_at).toLocaleString()}${r.checked_at?` · checked ${new Date(r.checked_at).toLocaleString()}`:''}`:'MISSING'}</span>${chunkHtml}</div>`;
    }).join('');
    $('developerReferenceList').querySelectorAll('[data-retry-poi]').forEach(b=>b.addEventListener('click',async()=>{try{const type=b.dataset.retryPoi,status=$('developerReferenceStatus');const r=await refreshPoiChunked(type,status,{});status.textContent=r.complete?`${humanize(type)} complete · ${r.count} POIs`:`${humanize(type)} partial · ${r.missing.length} tiles missing`;await loadDeveloperDashboard();}catch(e){handleError(e);}}));
  }
  function renderDeveloperGames(games){
    $('developerGames').innerHTML=games.length?games.map(g=>`<div class="developer-game" data-admin-game="${g.id}"><input class="admin-game-name" value="${escapeHtml(g.name)}" maxlength="80"><select class="admin-game-status"><option value="active" ${g.status==='active'?'selected':''}>active</option><option value="finished" ${g.status==='finished'?'selected':''}>finished</option></select><div class="meta">${escapeHtml(g.station_name||'No station')} · ${new Date(g.created_at).toLocaleString()}</div><div class="developer-game-actions"><button class="secondary" data-admin-preview-hider="${g.id}">View as Hider</button><button class="secondary" data-admin-preview-seeker="${g.id}">View as Seeker</button><button class="secondary" data-admin-save="${g.id}">Save</button><button class="danger" data-admin-delete="${g.id}">Delete</button></div></div>`).join(''):'<div class="status-box">No games.</div>';
    $('developerGames').querySelectorAll('[data-admin-preview-hider]').forEach(b=>b.addEventListener('click',()=>enterDeveloperGame(b.dataset.adminPreviewHider,'hider').catch(handleError)));
    $('developerGames').querySelectorAll('[data-admin-preview-seeker]').forEach(b=>b.addEventListener('click',()=>enterDeveloperGame(b.dataset.adminPreviewSeeker,'seeker').catch(handleError)));
    $('developerGames').querySelectorAll('[data-admin-save]').forEach(b=>b.addEventListener('click',()=>adminSaveGame(b.dataset.adminSave).catch(handleError)));
    $('developerGames').querySelectorAll('[data-admin-delete]').forEach(b=>b.addEventListener('click',()=>adminDeleteGame(b.dataset.adminDelete).catch(handleError)));
  }
  async function adminSaveGame(id){const row=document.querySelector(`[data-admin-game="${CSS.escape(id)}"]`);const name=row.querySelector('.admin-game-name').value.trim(),status=row.querySelector('.admin-game-status').value;const ok=await confirmAction('Save game changes?',`${name}\nStatus: ${status}`,'Save');if(!ok)return;const {error}=await state.supabase.rpc('admin_update_game_v1',{p_password:state.developerPassword,p_game_id:id,p_name:name,p_status:status});if(error)throw error;await loadDeveloperDashboard();}
  async function adminDeleteGame(id){const row=document.querySelector(`[data-admin-game="${CSS.escape(id)}"]`);const name=row.querySelector('.admin-game-name').value;const ok=await confirmAction('Delete this game permanently?',`${name}\n\nThis deletes its questions, cards, secrets and history. This cannot be undone.`,'Delete game',true);if(!ok)return;const {error}=await state.supabase.rpc('admin_delete_game_v1',{p_password:state.developerPassword,p_game_id:id});if(error)throw error;await loadDeveloperDashboard();}
  function openDeveloper(){state.developerPassword=null;state.developerCards=[];state.developerQuestions=[];$('developerPassword').value='';$('developerLoginPanel').classList.remove('hidden');$('developerPanel').classList.add('hidden');showView('developerView');}

  function leaveGame(){
    const returnToDeveloper=!!state.developerPreview;
    if(state.realtimeChannel&&state.supabase)state.supabase.removeChannel(state.realtimeChannel);clearInterval(state.timerId);clearInterval(state.pollId);stopGpsAutoTracking();stopVorTracking();clearPrivateMapLayers();state.mapLayers.curseEffects?.remove();state.mapLayers.cursePreview?.remove();state.mapLayers.curseEffects=null;state.mapLayers.cursePreview=null;state.curseMapSignature=null;clearDeveloperPreviewLock();Object.assign(state,{role:null,game:null,hiderPassword:null,secret:null,actions:[],hiderDraws:[],timeTraps:[],privateCardUses:[],thermoReference:null,pendingQuestionCard:null,pickMode:null,trapPlacementCard:null,endgameCandidate:null,endgameAccuracyM:null,endgamePickMode:false,endgamePrepareMode:false,seekerEndgamePickMode:false,currentPosition:null,seekerLivePosition:null,deckStatus:null,thermoReferences:{},previewQuestionSlot:null,previewQuestionCard:null,photoUploadToken:null,photoUrlCache:new Map(),photoPreviewUrls:new Map(),photoFiles:new Map(),seenCurseIds:new Set(),curseSoundPrimed:false,notificationPrimed:false,seenNotificationActionIds:new Set(),sameLineSelection:null,turntablesPickMode:false,turntablesCandidate:null,developerPreview:false,developerPreviewRole:null,passierscheinWasActive:false});state.currentPositionMarker?.remove();state.currentPositionAccuracyCircle?.remove();state.currentPositionMarker=null;state.currentPositionAccuracyCircle=null;clearPoiPreview();clearPendingOverlay();
    $('gameView').classList.remove('layout-hider','layout-seeker');if(returnToDeveloper&&state.developerPassword){showView('developerView');$('developerLoginPanel').classList.add('hidden');$('developerPanel').classList.remove('hidden');showDeveloperTab('games');loadDeveloperDashboard().catch(handleError);}else showView('homeView');
  }

  function openLobby(role){$('hiderLobby').classList.toggle('hidden',role!=='hider');$('seekerLobby').classList.toggle('hidden',role!=='seeker');$('lobbyKicker').textContent=role.toUpperCase();$('lobbyTitle').textContent=role==='hider'?'Create or open a game':'Choose a game';showView('lobbyView');(async()=>{try{if(role==='hider')await setupCreateMap();await loadGames();}catch(e){handleError(e);}})();}

  function bindUi(){
    document.querySelector('[data-action="open-developer"]').addEventListener('click',openDeveloper);document.querySelector('[data-action="developer-home"]').addEventListener('click',()=>showView('homeView'));$('developerLoginButton').addEventListener('click',()=>developerLogin().catch(handleError));$('developerRefreshCore').addEventListener('click',()=>refreshReferenceData('core').catch(handleError));$('developerRefreshPois').addEventListener('click',()=>refreshReferenceData('pois').catch(handleError));$('developerRefreshOnePoi')?.addEventListener('click',()=>refreshSelectedPoi().catch(handleError));$('developerRefreshAll').addEventListener('click',()=>refreshReferenceData('all').catch(handleError));$('developerImportCache').addEventListener('click',importBrowserReferenceCache);$('developerAddCard').addEventListener('click',addDeveloperCardForm);$('developerAddQuestion').addEventListener('click',()=>addDeveloperQuestionForm());document.querySelectorAll('[data-developer-tab]').forEach(b=>b.addEventListener('click',()=>showDeveloperTab(b.dataset.developerTab)));
    document.querySelector('[data-action="open-hider"]').addEventListener('click',()=>openLobby('hider'));document.querySelector('[data-action="open-seeker"]').addEventListener('click',()=>openLobby('seeker'));document.querySelector('[data-action="home"]').addEventListener('click',()=>showView('homeView'));document.querySelector('[data-action="leave-game"]').addEventListener('click',leaveGame);
    document.querySelectorAll('[data-tab]').forEach(btn=>btn.addEventListener('click',()=>{document.querySelectorAll('[data-tab]').forEach(x=>x.classList.toggle('active',x===btn));$('createTab').classList.toggle('active',btn.dataset.tab==='create');$('openTab').classList.toggle('active',btn.dataset.tab==='open');setTimeout(()=>state.createMap?.invalidateSize(),50);}));
    $('confirmCancel').addEventListener('click',()=>closeConfirm(false));$('confirmOk').addEventListener('click',()=>closeConfirm(true));$('confirmModal').addEventListener('click',e=>{if(e.target===$('confirmModal'))closeConfirm(false);});
    $('createStationSelect').addEventListener('change',()=>{const f=state.mapData?.stations?.find(x=>x.properties.stationId===$('createStationSelect').value);if(f)selectCreateStation(f);});$('createGameButton').addEventListener('click',()=>createGame().catch(handleError));$('openHiderGameButton').addEventListener('click',()=>enterHider($('hiderGameSelect').value,$('openPassword').value).catch(handleError));$('refreshGamesButton').addEventListener('click',()=>loadGames().catch(handleError));
    document.querySelectorAll('[data-origin-mode]').forEach(b=>b.addEventListener('click',()=>{state.seekerOriginMode=b.dataset.originMode;document.querySelectorAll('[data-origin-mode]').forEach(x=>x.classList.toggle('active',x===b));$('questionOriginStatus').textContent=state.seekerOriginMode==='gps'?'Automatic GPS':'Manual marker';}));
    $('currentGpsButton').addEventListener('click',()=>useCurrentGps().catch(handleError));$('currentMapButton').addEventListener('click',beginManualCurrentPosition);$('currentClearButton').addEventListener('click',()=>{stopGpsAutoTracking();state.currentPosition=null;state.currentPositionMarker?.remove();state.currentPositionAccuracyCircle?.remove();state.currentPositionMarker=null;state.currentPositionAccuracyCircle=null;$('currentPositionStatus').className='status-box';$('currentPositionStatus').textContent='No current position set.';renderQuestionDeck();});$('endgameCurrentButton').addEventListener('click',()=>{if(!state.currentPosition)return toast('Set your current position first.');setEndgameCandidate(state.currentPosition.lat,state.currentPosition.lng,state.currentPosition.accuracy_m,state.currentPosition.source);});$('prepareEndgameButton').addEventListener('click',()=>{state.endgamePrepareMode=true;renderHiderSecret();toast('Choose your hiding spot.');});$('endgameGpsButton').addEventListener('click',()=>getGps().then(p=>setEndgameCandidate(p.lat,p.lng,p.accuracy_m,'gps')).catch(handleError));$('endgamePickButton').addEventListener('click',()=>{state.endgamePickMode=true;toast('Tap the map to choose your hiding spot.');});$('toggleEndgameButton').addEventListener('click',()=>toggleEndgame().catch(handleError));$('seekerEndgameButton').addEventListener('click',()=>{state.seekerEndgamePickMode=true;cancelQuestionPreview();toast('Tap the station you believe is correct.');});$('hiderFoundButton').addEventListener('click',()=>finishGame().catch(handleError));$('startGameClockButton').addEventListener('click',()=>setGameClock('start').catch(handleError));$('pauseGameClockButton').addEventListener('click',()=>setGameClock('pause').catch(handleError));$('turntablesPickButton').addEventListener('click',()=>{if(!activeTurntablesAction())return;state.turntablesPickMode=true;state.turntablesCandidate=null;state.mapLayers.turntablesCandidate?.remove();state.mapLayers.turntablesCandidate=null;renderTurntablesPanel();toast('Tap a different station marker on the map.');});$('turntablesConfirmButton').addEventListener('click',()=>confirmTurntablesStation().catch(handleError));$('turntablesCancelButton').addEventListener('click',clearTurntablesCandidate);$('castCancel').addEventListener('click',()=>closeCastModal(null));$('castConfirm').addEventListener('click',()=>closeCastModal([...$('castOptions').querySelectorAll('input:checked')].map(x=>x.value)));$('photoModalClose').addEventListener('click',closePhotoModal);$('photoModal').addEventListener('click',e=>{if(e.target===$('photoModal'))closePhotoModal();});
  }

  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&state.gpsAutoEnabled&&Date.now()-state.lastGpsUpdateMs>=30*60*1000)refreshGpsAutoPosition();});
  document.addEventListener('pointerdown',unlockCurseAudio,{passive:true});
  bindUi();
})();
