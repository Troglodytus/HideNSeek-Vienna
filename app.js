(() => {
  'use strict';

  const CFG = window.HNS_CONFIG || {};
  const APP_VERSION = '3.6.0';
  const VIENNA_CENTER = [48.2082, 16.3738];
  const VIENNA_ZOOM = 12;
  const VIENNA_RELATION_ID = 109166;
  const VIENNA_AREA_ID = 3600109166;
  const BASE_HIDE_RADIUS_M = 250;
  const TENTACLE_VALID_DISTANCE_M = 250;
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
  const VIENNA_DISTRICT_ARCGIS='https://www.wien.gv.at/agssoe/rest/services/MapExport/MapExportService/MapServer/0/query?where=1%3D1&outFields=*&returnGeometry=true&outSR=4326&f=geojson';

  const QUESTION_CARDS = [
    { slot:'same-district', category:'MIXED', title:'Same District', detail:'Same Vienna district?', kind:'district' },
    { slot:'same-line', category:'MIXED', title:'Same U-/S-Bahn Line?', detail:'Does the hiding station share a U-Bahn or S-Bahn line with your nearest rail station?', kind:'same_line' },
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
    { slot:'tentacle-museums', category:'TENTACLES', title:'Museums', detail:'Which mapped museum in the remaining zone is the hider closest to?', kind:'tentacle', poi_type:'museum' },
    { slot:'tentacle-parks', category:'TENTACLES', title:'Parks', detail:'Which mapped park in the remaining zone is the hider closest to?', kind:'tentacle', poi_type:'park' },
    { slot:'tentacle-libraries', category:'TENTACLES', title:'Libraries', detail:'Which mapped library in the remaining zone is the hider closest to?', kind:'tentacle', poi_type:'library' },
    { slot:'tentacle-cinemas', category:'TENTACLES', title:'Movie Theaters', detail:'Which mapped cinema in the remaining zone is the hider closest to?', kind:'tentacle', poi_type:'cinema' },
    { slot:'tentacle-hospitals', category:'TENTACLES', title:'Hospitals', detail:'Which mapped hospital in the remaining zone is the hider closest to?', kind:'tentacle', poi_type:'hospital' },
    { slot:'tentacle-zoos', category:'TENTACLES', title:'Zoos', detail:'Which mapped zoo in the remaining zone is the hider closest to?', kind:'tentacle', poi_type:'zoo' },
    { slot:'tentacle-aquariums', category:'TENTACLES', title:'Aquariums', detail:'Which mapped aquarium in the remaining zone is the hider closest to?', kind:'tentacle', poi_type:'aquarium' },
    { slot:'tentacle-amusement', category:'TENTACLES', title:'Amusement Parks', detail:'Which mapped amusement park in the remaining zone is the hider closest to?', kind:'tentacle', poi_type:'amusement_park' },
    { slot:'photo-water', category:'PHOTO', title:'Biggest body of water', detail:'Send a photo of the biggest body of water visible from the hiding area.', kind:'photo', photo_prompt:'Biggest body of water' },
    { slot:'photo-structure', category:'PHOTO', title:'Highest visible structure', detail:'Send a photo of the highest visible structure.', kind:'photo', photo_prompt:'Highest visible structure' },
    { slot:'photo-selfie', category:'PHOTO', title:'Selfie', detail:'Send a current selfie from the hiding location.', kind:'photo', photo_prompt:'Selfie' },
    { slot:'photo-four-houses', category:'PHOTO', title:'At least 4 houses in one image', detail:'One photo with at least four houses.', kind:'photo', photo_prompt:'At least 4 houses in one image' },
    { slot:'photo-street-sign', category:'PHOTO', title:'Nearest street sign', detail:'Photograph the nearest street-name sign.', kind:'photo', photo_prompt:'Nearest street sign' },
    { slot:'photo-up', category:'PHOTO', title:'View straight up', detail:'Photograph the view straight upward.', kind:'photo', photo_prompt:'View straight up' },
    { slot:'photo-transit', category:'PHOTO', title:'Nearest transit sign', detail:'Photograph the nearest public-transport stop or station sign.', kind:'photo', photo_prompt:'Nearest public transport sign' }
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
    createStation:null,
    endgameCandidate:null, endgameAccuracyM:null, endgamePickMode:false, endgamePrepareMode:false, seekerEndgamePickMode:false,
    role:null, game:null, hiderPassword:null, secret:null,
    actions:[], hiderDraws:[], timeTraps:[], privateCardUses:[],
    seekerOriginMode:'gps', seekerPoint:null, seekerAccuracyM:null, seekerMarker:null, seekerAccuracyCircle:null,
    thermoReference:null, pendingQuestionCard:null, pickMode:null, trapPlacementCard:null,
    possibleArea:null, baseAllowedArea:null, baseRadiusBuilt:null,
    poiCache:{}, tentaclePreview:null, pendingOverlay:null,
    realtimeChannel:null, timerId:null, pollId:null, serverOffsetMs:0,
    overpassBadUntil:{}, railLoadPromise:null,
    confirmResolver:null,
    currentPosition:null,currentPositionMarker:null,currentPositionAccuracyCircle:null,
    gpsAutoTimer:null,gpsAutoEnabled:false,lastGpsUpdateMs:0,seekerLivePosition:null,deckStatus:null,castResolver:null,castCard:null,
    thermoReferences:{},previewQuestionSlot:null,previewQuestionCard:null,
    seenCurseIds:new Set(),curseSoundPrimed:false,audioCtx:null,photoUploadToken:null,photoUrlCache:new Map(),photoPreviewUrls:new Map(),photoFiles:new Map(),
    developerPassword:null,referenceMeta:{}
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
    const endpoints=overpassEndpoints();
    let lastError=null;
    for(const endpoint of endpoints){
      if((state.overpassBadUntil[endpoint]||0)>Date.now())continue;
      const controller=new AbortController();
      const timer=setTimeout(()=>controller.abort(),timeoutMs);
      try{
        const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'},body:'data='+encodeURIComponent(query),signal:controller.signal});
        clearTimeout(timer);
        if(!response.ok){
          const err=new Error(`${label}: ${endpoint} returned HTTP ${response.status}.`);
          err.status=response.status;
          if([429,502,503,504].includes(response.status))state.overpassBadUntil[endpoint]=Date.now()+5*60e3;
          lastError=err;
          continue;
        }
        return await response.json();
      }catch(e){
        clearTimeout(timer);
        if(e?.name==='AbortError')lastError=new Error(`${label}: ${endpoint} timed out.`);
        else lastError=e;
        state.overpassBadUntil[endpoint]=Date.now()+2*60e3;
      }
    }
    throw new Error(`${label} failed on all configured Overpass servers. ${lastError?.message||''}`.trim());
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
    return {stations,railLines};
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
    state.mapData={city:admin.city,districts:admin.districts,stations:stations.stations,railLines:Array.isArray(transit?.railLines)?transit.railLines:[]};
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
    state.createMap.fitBounds(L.geoJSON(state.mapData.city).getBounds(),{padding:[8,8]});
    if(!state.createStation){$('createStationStatus').className='status-box good';$('createStationStatus').textContent='Choose a station from the list or tap a station marker on the map.';}
    renderCreateSelection();
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
    const hidden=Number.isFinite(Number(r.hidden_lat))&&Number.isFinite(Number(r.hidden_lng))?turf.point([Number(r.hidden_lng),Number(r.hidden_lat)]):null;
    return {hidden,station:turf.point([Number(r.station_lng),Number(r.station_lat)]),station_name:r.station_name,endgame:!!r.endgame,base_radius_m:r.base_radius_m||BASE_HIDE_RADIUS_M};
  }

  async function enterHider(gameId,password){
    initSupabaseIfNeeded(); if(!gameId)return toast('Choose a game.');
    const {data,error}=await state.supabase.rpc('get_hider_game_v4',{p_game_id:gameId,p_password:password}); if(error)throw error; const r=data?.[0]; if(!r)return toast('Wrong hider password.');
    state.role='hider'; state.hiderPassword=password; state.game={id:r.game_id,name:r.game_name,status:r.game_status}; state.secret=secretFromRow(r); await enterGameCommon();
  }
  async function enterSeeker(gameId){ initSupabaseIfNeeded(); const {data,error}=await state.supabase.from('games').select('id,name,status').eq('id',gameId).single(); if(error)throw error; state.role='seeker';state.hiderPassword=null;state.secret=null;state.game=data;await enterGameCommon(); }

  async function enterGameCommon(){
    state.curseSoundPrimed=false;state.seenCurseIds=new Set();state.photoUploadToken=null;state.photoUrlCache=new Map();state.previewQuestionSlot=null;state.previewQuestionCard=null;
    await ensureMapData(); setupGameMap();
    $('roleKicker').textContent=state.role.toUpperCase(); $('gameTitle').textContent=state.game.name; $('seekerControls').classList.toggle('hidden',state.role!=='seeker'); $('seekerQuestionLocation').classList.toggle('hidden',state.role!=='seeker'); $('seekerEndgamePanel').classList.toggle('hidden',state.role!=='seeker'); $('hiderControls').classList.toggle('hidden',state.role!=='hider');
    showView('gameView'); await syncServerClock(); await reloadGameState(); subscribeRealtime(); startTimers();
  }

  function setupGameMap(){
    if(!state.gameMap){ state.gameMap=L.map('gameMap',baseMapOptions()); addBaseTiles(state.gameMap); state.gameMap.on('click',e=>handleGameMapClick(e.latlng)); }
    clearPrivateMapLayers();
    drawReferenceLayers(state.gameMap,'game-',f=>handleReferenceStationClick(f));
    state.gameMap.fitBounds(L.geoJSON(state.mapData.city).getBounds(),{padding:[5,5]});
  }

  function handleReferenceStationClick(feature){
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
  async function publishSeekerLivePosition(p){if(state.role!=='seeker'||!state.game)return;const {error}=await state.supabase.rpc('set_seeker_live_position_v1',{p_game_id:state.game.id,p_lat:p.lat,p_lng:p.lng,p_accuracy_m:p.accuracy_m??null});if(error)throw error;}
  function stopGpsAutoTracking(){if(state.gpsAutoTimer)clearInterval(state.gpsAutoTimer);state.gpsAutoTimer=null;state.gpsAutoEnabled=false;}
  async function refreshGpsAutoPosition(){if(!state.game||!state.gpsAutoEnabled)return;try{const p=await getGps();state.lastGpsUpdateMs=Date.now();setCurrentPosition({...p,source:'gps'},{pan:false});if(state.role==='seeker')await publishSeekerLivePosition(p);}catch(e){console.warn('Automatic GPS refresh failed',e);}}
  function startGpsAutoTracking(){stopGpsAutoTracking();state.gpsAutoEnabled=true;state.gpsAutoTimer=setInterval(()=>refreshGpsAutoPosition(),30*60*1000);}
  async function useCurrentGps(){const p=await getGps();state.lastGpsUpdateMs=Date.now();setCurrentPosition({...p,source:'gps'});if(state.role==='seeker')await publishSeekerLivePosition(p);startGpsAutoTracking();$('currentPositionStatus').textContent+=' · auto 30 min';toast('GPS set.');}
  function beginManualCurrentPosition(){stopGpsAutoTracking();state.pickMode='current_position';toast('Tap the map to set your position.');}


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
  function sameLineCorridor(refs){let out=null;for(const f of matchingTransitFeatures(refs)){try{const b=turf.buffer(f,.4,{units:'kilometers',steps:12});out=safeUnion(out,b);}catch(_){}}return out;}

  async function askQuestionPayload(card,payload,description){
    const ok=await confirmAction('Send this question?',`${description}\n\nThe Hider gets 15 minutes to resolve it before late-answer penalties begin.`,`Send ${card.title}`);
    if(!ok)return false;
    const {error}=await state.supabase.rpc('ask_question_v4',{p_game_id:state.game.id,p_slot_key:card.slot,p_kind:card.kind,p_payload:payload});
    if(error)throw error;
    cancelQuestionPreview();await reloadGameState();return true;
  }

  async function handleQuestionCard(card,providedOrigin=null){
    if(state.role!=='seeker')return;
    if(activeQuestionForSlot(card.slot))return toast('That question has already been asked.');
    if(state.previewQuestionSlot&&state.previewQuestionSlot!==card.slot)cancelQuestionPreview();

    if(card.kind==='tentacle'){
      if(state.previewQuestionSlot===card.slot&&state.previewQuestionCard?.pois){
        const pois=state.previewQuestionCard.pois;
        const payload={slot_key:card.slot,question_kind:'tentacle',title:card.title,poi_type:card.poi_type,valid_distance_m:TENTACLE_VALID_DISTANCE_M,pois};
        const ok=await confirmAction(`Ask ${card.title} Tentacle?`,`${pois.length} candidate ${card.title.toLowerCase()} are highlighted on the map.\n\nSend this Tentacle question now?`,`Ask Tentacle`);
        if(!ok){cancelQuestionPreview();renderQuestionDeck();return;}
        const {error}=await state.supabase.rpc('ask_question_v4',{p_game_id:state.game.id,p_slot_key:card.slot,p_kind:'tentacle',p_payload:payload});if(error)throw error;
        cancelQuestionPreview();await reloadGameState();return;
      }
      toast(`Loading ${card.title} reference data…`,3000);
      const all=await loadPoiType(card.poi_type);const candidates=all.filter(p=>pointInPossible(p));
      const pois=candidates.map(p=>({id:p.properties.poiId,name:p.properties.poiName,lat:p.geometry.coordinates[1],lng:p.geometry.coordinates[0]}));
      state.previewQuestionSlot=card.slot;state.previewQuestionCard={...card,pois};showPoiPreview(pois);renderQuestionDeck();
      toast(`${pois.length} ${card.title.toLowerCase()} highlighted. Tap the same Tentacle again to ask it, or choose another question to cancel.` ,5500);return;
    }

    if(card.kind==='photo'){
      cancelQuestionPreview();
      const payload={slot_key:card.slot,question_kind:'photo',title:card.title,photo_prompt:card.photo_prompt};
      await askQuestionPayload(card,payload,`Photo question: ${card.photo_prompt}\n\nThe Hider will upload one image from the camera roll.`);return;
    }

    if(card.kind==='thermometer'){
      const ref=state.thermoReferences?.[card.slot]||null;
      const origin=await resolveQuestionOrigin(card,providedOrigin);if(!origin)return;
      if(!ref){
        const ok=await confirmAction(`Start ${card.title}?`,`Point A: ${origin.lat.toFixed(5)}, ${origin.lng.toFixed(5)}${origin.accuracy_m?`\nGPS accuracy ±${Math.round(origin.accuracy_m)} m.`:'\nManual map location.'}\n\nThe card will turn red while you move ${formatDistance(card.min_travel_m)}. Once you are far enough it turns green; tap it again to ask the Thermometer.`,`Start Thermometer`);
        if(!ok)return;
        const {error}=await state.supabase.rpc('start_thermometer_v1',{p_game_id:state.game.id,p_slot_key:card.slot,p_min_travel_m:card.min_travel_m,p_lat:origin.lat,p_lng:origin.lng,p_accuracy_m:origin.accuracy_m??null,p_source:origin.source||'gps'});if(error)throw error;
        cancelQuestionPreview();await reloadGameState();return;
      }
      const travelled=turf.distance(turf.point([Number(ref.lng),Number(ref.lat)]),turf.point([origin.lng,origin.lat]),{units:'meters'});
      if(travelled+0.5<card.min_travel_m){renderQuestionDeck();return toast(`${card.title} is armed. You have moved ${Math.round(travelled)} m; ${Math.round(card.min_travel_m-travelled)} m remain.`);}
      const payload={slot_key:card.slot,question_kind:'thermometer',title:card.title,origin,from:{lat:Number(ref.lat),lng:Number(ref.lng)},to:{lat:origin.lat,lng:origin.lng},min_travel_m:card.min_travel_m};
      previewQuestionGeometry(payload);state.previewQuestionSlot=card.slot;state.previewQuestionCard=card;
      const desc=`${card.title}\nTravelled: ${Math.round(travelled)} m\n\nThe yellow perpendicular bisector is the exact line that will divide the map into WARMER/COLDER halves.`;
      const sent=await askQuestionPayload(card,payload,desc);if(!sent){state.previewQuestionSlot=card.slot;state.previewQuestionCard=card;renderQuestionDeck();}return;
    }

    const origin=await resolveQuestionOrigin(card,providedOrigin);if(!origin)return;
    let payload={slot_key:card.slot,question_kind:card.kind,title:card.title,origin};let description=`${card.title}\nOrigin: ${origin.lat.toFixed(5)}, ${origin.lng.toFixed(5)}${origin.accuracy_m?` · GPS ±${Math.round(origin.accuracy_m)} m`:' · manual'}`;
    if(card.kind==='same_line'){
      const near=nearestRailStation(origin);if(!near||!near.lineRefs.length)return toast('No U-/S-Bahn station with line data found nearby.');
      payload.seeker_station_name=near.feature.properties?.stationName||'Station';payload.line_refs=near.lineRefs;payload.station_distance_m=Math.round(near.distance_m);
      description+=`\nNearest rail station: ${payload.seeker_station_name} · ${payload.line_refs.join(', ')}`;previewQuestionGeometry(payload);
    }else if(card.kind==='radar'){
      payload.center={lat:origin.lat,lng:origin.lng};payload.radius_m=card.radius_m;previewQuestionGeometry(payload);
      if(origin.accuracy_m&&origin.accuracy_m>Math.max(25,card.radius_m/2))description+=`\nWARNING: GPS accuracy (±${Math.round(origin.accuracy_m)} m) is poor relative to this Radar radius.`;
    }else if(card.kind==='district'){
      const d=pointDistrict(turf.point([origin.lng,origin.lat]));if(!d)return toast('This question origin is outside Vienna.');payload.district_number=d.number;payload.district_name=d.name;description+=`\nDistrict: ${d.number}. ${d.name}`;previewQuestionGeometry(payload);
    }else if(card.kind==='directional'){
      payload.axis=card.axis;payload.positive_label=card.positive_label;payload.negative_label=card.negative_label;previewQuestionGeometry(payload);
    }
    state.previewQuestionSlot=card.slot;state.previewQuestionCard=card;
    const sent=await askQuestionPayload(card,payload,description);if(!sent){state.previewQuestionSlot=card.slot;state.previewQuestionCard=card;renderQuestionDeck();}
  }

  async function loadPoiType(type){
    if(state.poiCache[type])return state.poiCache[type];
    try{
      const ref=await referenceDataset(REF_POI_PREFIX+type+'_v1');
      if(Array.isArray(ref?.pois)){
        state.poiCache[type]=ref.pois.map(p=>turf.point([p.lng,p.lat],{poiId:p.id,poiName:p.name,poiType:type}));
        return state.poiCache[type];
      }
    }catch(e){console.warn('POI reference lookup failed',type,e);}
    const key=POI_CACHE_PREFIX+type,cached=localStorage.getItem(key);
    if(cached){try{const obj=JSON.parse(cached);if(Array.isArray(obj.pois)){state.poiCache[type]=obj.pois.map(p=>turf.point([p.lng,p.lat],{poiId:p.id,poiName:p.name,poiType:type}));return state.poiCache[type];}}catch(_){}}
    throw new Error(`${humanize(type)} reference data are not fully seeded in Supabase. Open Developer and refresh that category; gameplay no longer performs large live Overpass/WFS queries.`);
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
  function clearPoiPreview(){state.mapLayers.poiPreview?.remove();state.mapLayers.poiReach?.remove();state.mapLayers.poiPreview=null;state.mapLayers.poiReach=null;}
  function clearPendingOverlay(){
    ['pendingCircle','pendingLine','pendingDistrict','pendingBisector','pendingThermoPath','pendingDirection','pendingSameLine','pendingTentacleCell'].forEach(k=>{state.mapLayers[k]?.remove();state.mapLayers[k]=null;});
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
    if(p.question_kind==='same_line'&&Array.isArray(p.line_refs)){
      const features=matchingTransitFeatures(p.line_refs);if(features.length)state.mapLayers.pendingSameLine=L.geoJSON({type:'FeatureCollection',features},{style:{color:'#f59e0b',weight:7,opacity:.8},interactive:false}).addTo(state.gameMap);
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
  function activeQuestionForSlot(slot){return effectiveActions('question').find(a=>a.payload?.slot_key===slot)||null;}
  function activeAnswerForQuestion(id){return effectiveActions('answer').filter(a=>a.parent_id===id).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at))[0]||null;}
  function activeVetoForQuestion(id){return effectiveActions('question_veto').find(a=>a.parent_id===id)||null;}
  function latestAction(kind){return effectiveActions(kind).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at))[0]||null;}

  function hiderTargetPoint(){if(state.role!=='hider'||!state.secret)return null;return state.secret.endgame?(state.secret.hidden||state.secret.station):state.secret.station;}
  function suggestedAnswer(q){
    const target=hiderTargetPoint(); if(!target)return null; const p=q.payload||{};
    if(p.question_kind==='radar'){const d=turf.distance(target,turf.point([p.center.lng,p.center.lat]),{units:'meters'});return {type:'boolean',value:d<=Number(p.radius_m),text:d<=Number(p.radius_m)?`HIT — target is ${Math.round(d)} m away.`:`MISS — target is ${Math.round(d)} m away.`};}
    if(p.question_kind==='district'){const d=pointDistrict(target);const yes=d?.number===Number(p.district_number);return {type:'boolean',value:yes,text:yes?`YES — target is in ${p.district_number}. ${p.district_name}.`:`NO — target is in ${d?`${d.number}. ${d.name}`:'another area'}.`};}
    if(p.question_kind==='same_line'){const [lng,lat]=state.secret.station.geometry.coordinates;const hs=nearestRailStation({lat,lng});const targetRefs=new Set(hs?.lineRefs||[]),common=(p.line_refs||[]).filter(r=>targetRefs.has(r));const yes=common.length>0;return {type:'boolean',value:yes,text:yes?`YES — shared line: ${common.join(', ')}.`:'NO — no shared U-/S-Bahn line.'};}
    if(p.question_kind==='directional'){const [lng,lat]=target.geometry.coordinates;const yes=p.axis==='lat'?lat>=Number(p.origin.lat):lng>=Number(p.origin.lng);return {type:'boolean',value:yes,text:`${yes?(p.positive_label||'YES'):(p.negative_label||'NO')}.`};}
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
    const s=suggestedAnswer(q),pen=currentQuestionPenaltyMinutes(q); const ok=await confirmAction(`Send ${value?'YES':'NO'}?`,`${questionLabel(q)}\n\nAutomatic hider preview: ${s?.text||'Unavailable'}${pen?`\n\nCurrent late penalty: −${pen} min`:''}\n\nYou are still choosing the final answer manually.`,`Send ${value?'YES':'NO'}`);if(!ok)return;
    const {error}=await state.supabase.rpc('answer_question_v5',{p_game_id:state.game.id,p_question_action_id:q.id,p_password:state.hiderPassword,p_answer:{type:'boolean',value}});if(error)throw error;await reloadGameState();
  }
  async function answerTentacle(q){
    const s=suggestedAnswer(q); if(s?.status!=='poi'||!s.poi)return toast('This Tentacle does not currently have a valid POI answer.');
    const answer={type:'tentacle',status:'poi',poi:s.poi};
    const ok=await confirmAction('Send Tentacle answer?',`${questionLabel(q)}

Public answer:
Hider is closest to ${s.poi.name}.

Automatic private check: ${s.text}

Only the POI name is sent publicly; the private validation distance is never included in the answer.${currentQuestionPenaltyMinutes(q)?`\n\nCurrent late penalty: −${currentQuestionPenaltyMinutes(q)} min`:''}`,`Send answer`);if(!ok)return;
    const {error}=await state.supabase.rpc('answer_question_v5',{p_game_id:state.game.id,p_question_action_id:q.id,p_password:state.hiderPassword,p_answer:answer});if(error)throw error;await reloadGameState();
  }
  async function autoVetoTentacle(q){
    const s=suggestedAnswer(q); if(s?.status!=='auto_veto')return toast('This Tentacle has a valid POI answer and should not be automatically vetoed.');
    const ok=await confirmAction('Confirm automatic Tentacle veto?',`${questionLabel(q)}

${s.text}

This does not consume a Veto card and awards no card draw. Seekers will only be told that the Tentacle was automatically vetoed because no listed option was within ${Number(q.payload?.valid_distance_m||TENTACLE_VALID_DISTANCE_M)} m of the target.${currentQuestionPenaltyMinutes(q)?`\n\nCurrent late penalty: −${currentQuestionPenaltyMinutes(q)} min`:''}`,`Veto Tentacle`,true);if(!ok)return;
    const {error}=await state.supabase.rpc('auto_veto_tentacle_v4',{p_game_id:state.game.id,p_question_action_id:q.id,p_password:state.hiderPassword});if(error)throw error;await reloadGameState();
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
    const cards=[]; for(const d of state.hiderDraws){if(!drawIsEarned(d))continue;const kept=new Set(d.kept_card_keys||[]),used=new Set(d.used_card_keys||[]);for(const c of d.cards||[])if(kept.has(c.card_key)&&!used.has(c.card_key)&&(!effectKey||c.effect_key===effectKey))cards.push({...c,draw_id:d.id});} return cards;
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

  function chooseCastingCost(card){const cost=Number(card.cast_cost_minutes||0);if(cost<=0)return Promise.resolve([]);const bonuses=availableHandCards().filter(c=>c.card_kind==='time_bonus');if(bonuses.reduce((sum,c)=>sum+Number(c.value_int||0),0)<cost){toast(`You need ${cost} minutes of time bonuses to cast ${card.title}.`);return Promise.resolve(null);}return new Promise(resolve=>{state.castResolver=resolve;state.castCard=card;$('castTitle').textContent=`Pay ${cost} min to cast ${card.title}`;$('castOptions').innerHTML=bonuses.map(c=>`<label class="cast-option"><input type="checkbox" value="${escapeHtml(c.card_key)}" data-value="${Number(c.value_int||0)}"><span><strong>${escapeHtml(c.title)}</strong><small>${Number(c.value_int||0)} min</small></span></label>`).join('');const update=()=>{const checked=[...$('castOptions').querySelectorAll('input:checked')];const total=checked.reduce((sum,x)=>sum+Number(x.dataset.value||0),0);$('castTotal').textContent=`Selected: ${total} / ${cost} min${total>cost?` · ${total-cost} min overpayment`:''}`;$('castConfirm').disabled=total<cost;};$('castOptions').querySelectorAll('input').forEach(x=>x.addEventListener('change',update));update();$('castModal').classList.remove('hidden');});}
  function closeCastModal(value){$('castModal').classList.add('hidden');const r=state.castResolver;state.castResolver=null;state.castCard=null;r?.(value);}

  function clearProsperousPreview(){state.mapLayers.prosperousPreview?.remove();state.mapLayers.prosperousPreview=null;}
  function previewProsperousZone(extraEffects=1){
    clearProsperousPreview();if(state.role!=='hider'||!state.secret?.station||!state.gameMap)return;
    const [lng,lat]=state.secret.station.geometry.coordinates;const base=Number(state.secret?.base_radius_m||BASE_HIDE_RADIUS_M);const radius=base*Math.sqrt(currentAreaMultiplier()*Math.pow(2,extraEffects));
    state.mapLayers.prosperousPreview=L.circle([lat,lng],{radius,color:'#eab308',weight:3,dashArray:'7 6',fillColor:'#fde047',fillOpacity:.10}).addTo(state.gameMap).bindTooltip(`Prosperous Home preview · ${Math.round(radius)} m`);
  }

  async function playHandCard(card){
    if(card.card_kind==='time_bonus')return toast('Time bonuses stay in your hand until scoring or casting.');
    if(card.effect_key==='veto_question')return toast('Use Veto on an open question.');
    if(card.effect_key==='time_trap'){state.trapPlacementCard=card;toast('Tap a station to place the Time Trap.');return;}
    if(card.effect_key==='duplicate'){await useDuplicate(card);return;}
    if(card.effect_key==='reshuffle_deck'){const ok=await confirmAction('Fresh Shuffle?','Reshuffle the discard pile into a new draw pile. Cards in your hand stay out.','Shuffle');if(!ok)return;const {error}=await state.supabase.rpc('use_reshuffle_card_v1',{p_game_id:state.game.id,p_password:state.hiderPassword,p_card_key:card.card_key});if(error)throw error;await reloadGameState();return;}
    const prosperous=card.effect_key==='prosperous_home';if(prosperous)previewProsperousZone(1);
    try{
      const costKeys=await chooseCastingCost(card);if(costKeys===null)return;
      const cost=Number(card.cast_cost_minutes||0);let msg=card.description||'';
      if(card.duration_seconds)msg+=`\nDuration: ${formatDuration(card.duration_seconds)}.`;
      if(prosperous){const r=Number(state.secret?.base_radius_m||BASE_HIDE_RADIUS_M)*Math.sqrt(currentAreaMultiplier()*2);msg+=`\nHiding radius: ${Math.round(currentEndgameRadius())} m → ${Math.round(r)} m.`;}
      if(cost)msg+=`\nCost: ${cost} min.`;
      const ok=await confirmAction(`Play ${card.title}?`,msg,'Play');if(!ok)return;
      const {error}=await state.supabase.rpc('play_card_v4',{p_game_id:state.game.id,p_password:state.hiderPassword,p_card_key:card.card_key,p_copy_card_key:null,p_cost_card_keys:costKeys||[]});if(error)throw error;await reloadGameState();
    } finally {if(prosperous)clearProsperousPreview();}
  }

  async function useDuplicate(card){
    const targets=availableHandCards().filter(c=>c.card_key!==card.card_key&&['time_bonus','curse'].includes(c.card_kind));if(!targets.length)return toast('Duplicate needs another held bonus or curse.');
    const choices=targets.map((c,i)=>`${i+1}. ${c.title}`).join('\n');const raw=window.prompt(`Choose a card to copy:\n${choices}`);if(!raw)return;const idx=Number(raw)-1;if(!Number.isInteger(idx)||idx<0||idx>=targets.length)return toast('Invalid choice.');const target=targets[idx];
    const prosperous=target.effect_key==='prosperous_home';if(prosperous)previewProsperousZone(1);
    try{
      let costKeys=[];if(target.card_kind==='curse'){costKeys=await chooseCastingCost(target);if(costKeys===null)return;}
      let msg=`Copy “${target.title}”. The original stays in your hand.`;if(prosperous){const r=Number(state.secret?.base_radius_m||BASE_HIDE_RADIUS_M)*Math.sqrt(currentAreaMultiplier()*2);msg+=`\nHiding radius: ${Math.round(currentEndgameRadius())} m → ${Math.round(r)} m.`;}if(Number(target.cast_cost_minutes||0))msg+=`\nCost: ${target.cast_cost_minutes} min.`;
      const ok=await confirmAction('Use Duplicate?',msg,'Duplicate');if(!ok)return;
      const {error}=await state.supabase.rpc('play_card_v4',{p_game_id:state.game.id,p_password:state.hiderPassword,p_card_key:card.card_key,p_copy_card_key:target.card_key,p_cost_card_keys:costKeys||[]});if(error)throw error;await reloadGameState();
    } finally {if(prosperous)clearProsperousPreview();}
  }

  async function placeTimeTrapAtStation(feature){
    const card=state.trapPlacementCard;if(!card)return;state.trapPlacementCard=null;const [lng,lat]=feature.geometry.coordinates;const ok=await confirmAction('Place Time Trap?',`${feature.properties.stationName}\n\nA clock marker will be visible to everyone immediately.`,'Place');if(!ok)return;
    const {error}=await state.supabase.rpc('place_time_trap_v4',{p_game_id:state.game.id,p_password:state.hiderPassword,p_card_key:card.card_key,p_station_name:feature.properties.stationName,p_station_lat:lat,p_station_lng:lng});if(error)throw error;await reloadGameState();
  }
  async function triggerTimeTrap(trap,active=true){
    const verb=active?'Trigger':'Undo trigger';const ok=await confirmAction(`${verb} Time Trap?`,`${trap.station_name}\n${active?'Its current bonus is added to the final score.':'The bonus is removed; the clock marker stays on the map.'}`,verb,!active);if(!ok)return;
    const {error}=await state.supabase.rpc('set_time_trap_trigger_v3',{p_game_id:state.game.id,p_trap_id:trap.id,p_password:state.hiderPassword,p_active:active});if(error)throw error;await reloadGameState();
  }

  function currentEndgameRadius(){return Number(state.secret?.base_radius_m||BASE_HIDE_RADIUS_M)*Math.sqrt(currentAreaMultiplier());}

  function publicEndgameRadius(){
    const zone=latestAction('endgame_zone');if(!zone)return null;const p=zone.payload||{},dynamic=p.dynamic_radius===true;
    const base=Number(p.base_radius_m)||(dynamic?BASE_HIDE_RADIUS_M:(Number(p.radius_m)||BASE_HIDE_RADIUS_M));return dynamic?base*Math.sqrt(currentAreaMultiplier()):(Number(p.radius_m)||base);
  }
  function renderSeekerEndgame(){
    const panel=$('seekerEndgamePanel');if(!panel)return;panel.classList.toggle('hidden',state.role!=='seeker');if(state.role!=='seeker')return;
    const zone=latestAction('endgame_zone'),status=$('seekerEndgameStatus'),btn=$('seekerEndgameButton');
    if(zone?.payload?.center){const r=publicEndgameRadius();status.textContent=`${zone.payload.station_name||'Station'} · ${Math.round(r||BASE_HIDE_RADIUS_M)} m`;btn.textContent='Change Endgame station';}
    else{status.textContent='Not started';btn.textContent='Start Endgame';}
  }
  async function startSeekerEndgameAtStation(feature){
    if(state.role!=='seeker'||!state.seekerEndgamePickMode)return;state.seekerEndgamePickMode=false;
    const [lng,lat]=feature.geometry.coordinates,name=feature.properties.stationName||'Station';const radius=BASE_HIDE_RADIUS_M*Math.sqrt(currentAreaMultiplier());
    const ok=await confirmAction('Start Endgame?',`${name}\nZone radius: ${Math.round(radius)} m\n\nThe map will reset to this station zone.`,`Start Endgame`);if(!ok)return;
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
  async function reloadGameState(){await reloadGamePublic();await reloadActions();if(state.role==='hider')await refreshHiderSecret();await reloadHiderPrivate();deriveLocalState();await recomputePossibleArea();renderAll();}

  function deriveLocalState(){
    const questions=effectiveActions('question').sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));const q=questions[0];if(q?.payload?.origin)setSeekerPointDisplay(q.payload.origin);else setSeekerPointDisplay(null);
    state.thermoReferences={};
    for(const ref of effectiveActions('thermo_reference').sort((a,b)=>new Date(a.created_at)-new Date(b.created_at))){
      const slot=ref.payload?.slot_key;if(slot)state.thermoReferences[slot]={...ref.payload,action_id:ref.id,created_at:ref.created_at};
    }
    renderHiderSecret();renderPendingQuestionOverlay();
  }

  function currentAreaMultiplier(){const p=effectiveActions('curse_play').filter(a=>a.payload?.effect_key==='prosperous_home');return Math.pow(2,p.length);}
  async function recomputePossibleArea(){
    // Station phase: the hiding STATION can be anywhere inside Vienna. Do not pre-limit
    // the map to 250 m buffers around every station; that radius only matters in Endgame.
    const endgameZone=latestAction('endgame_zone');
    let possible=state.mapData.city;
    let phaseStartMs=0;
    if(endgameZone?.payload?.center){
      const dynamic=endgameZone.payload.dynamic_radius===true;
      const base=Number(endgameZone.payload.base_radius_m)||(dynamic?BASE_HIDE_RADIUS_M:(Number(endgameZone.payload.radius_m)||BASE_HIDE_RADIUS_M));
      const radius=dynamic?base*Math.sqrt(currentAreaMultiplier()):(Number(endgameZone.payload.radius_m)||base);
      const center=turf.point([Number(endgameZone.payload.center.lng),Number(endgameZone.payload.center.lat)]);
      const zone=turf.buffer(center,radius/1000,{units:'kilometers',steps:64});
      possible=safeIntersect(state.mapData.city,zone)||zone;
      phaseStartMs=new Date(endgameZone.created_at).getTime();
    }
    const qs=effectiveActions('question')
      .filter(q=>!phaseStartMs || new Date(q.created_at).getTime()>phaseStartMs)
      .sort((a,b)=>new Date(a.created_at)-new Date(b.created_at));
    for(const q of qs){
      if(activeVetoForQuestion(q.id))continue;
      const a=activeAnswerForQuestion(q.id);if(!a)continue;
      possible=applyConstraint(possible,q,a.payload?.answer);if(!possible)break;
    }
    state.possibleArea=possible;
  }

  function applyConstraint(possible,q,answer){
    if(!possible)return null;const p=q.payload||{};
    if(p.question_kind==='radar'){const c=turf.buffer(turf.point([p.center.lng,p.center.lat]),Number(p.radius_m)/1000,{units:'kilometers',steps:64});return answer?.value?safeIntersect(possible,c):safeDifference(possible,c);}
    if(p.question_kind==='district'){const d=state.mapData.districts.find(x=>x.number===Number(p.district_number));return d?(answer?.value?safeIntersect(possible,d.feature):safeDifference(possible,d.feature)):possible;}
    if(p.question_kind==='same_line'){const corridor=sameLineCorridor(p.line_refs||[]);return corridor?(answer?.value?safeIntersect(possible,corridor):safeDifference(possible,corridor)):possible;}
    if(p.question_kind==='directional'){const half=directionHalfPlane(p.origin,p.axis,!!answer?.value);return half?safeIntersect(possible,half):possible;}
    if(p.question_kind==='thermometer'){
      // WARMER keeps the side of the perpendicular bisector containing point B;
      // COLDER keeps the opposite side. Exactly one half-plane survives.
      const half=warmerHalfPlane(p.from,p.to,!!answer?.value);
      if(!half)return possible;
      const cut=safeIntersect(possible,half);
      return cut||null;
    }
    if(p.question_kind==='tentacle'){
      if(answer?.status==='poi'&&answer.poi)return nearestPoiCell(possible,answer.poi,p.pois||[]); return possible;
    }
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
  function warmerHalfPlane(from,to,warmer){
    const A=mercator(from.lat,from.lng),B=mercator(to.lat,to.lng),M={x:(A.x+B.x)/2,y:(A.y+B.y)/2};
    let nx=B.x-A.x,ny=B.y-A.y;if(!warmer){nx*=-1;ny*=-1;}return halfPlanePolygon(M,nx,ny);
  }
  function directionHalfPlane(origin,axis,positive){
    if(!origin)return null;const M=mercator(Number(origin.lat),Number(origin.lng));
    if(axis==='lat')return halfPlanePolygon(M,0,positive?1:-1);
    return halfPlanePolygon(M,positive?1:-1,0);
  }
  function mercator(lat,lng){const R=6378137;return{x:R*lng*Math.PI/180,y:R*Math.log(Math.tan(Math.PI/4+lat*Math.PI/360))};}
  function unmercator(p){const R=6378137;return{lng:p.x/R*180/Math.PI,lat:(2*Math.atan(Math.exp(p.y/R))-Math.PI/2)*180/Math.PI};}

  function renderPossibleArea(){
    state.mapLayers.possible?.remove();state.mapLayers.excluded?.remove();if(state.possibleArea){state.mapLayers.possible=L.geoJSON(state.possibleArea,{style:mapGeoStyle('possible'),interactive:false}).addTo(state.gameMap);const ex=safeDifference(state.mapData.city,state.possibleArea);if(ex)state.mapLayers.excluded=L.geoJSON(ex,{style:mapGeoStyle('excluded'),interactive:false}).addTo(state.gameMap);const km2=turf.area(state.possibleArea)/1e6;$('remainingAreaText').textContent=`${km2.toFixed(km2>=10?1:2)} km² possible`;}else{$('remainingAreaText').textContent='0 km² possible';}
    renderPublicEndgameZone();renderPublicTimeTraps();
    state.mapLayers['game-rails']?.bringToFront?.();state.mapLayers['game-stations']?.bringToFront?.();state.mapLayers.publicTimeTraps?.bringToFront?.();
  }

  function renderPublicEndgameZone(){
    state.mapLayers.publicEndgameZone?.remove();state.mapLayers.publicEndgameZone=null;
    const zone=latestAction('endgame_zone');if(!zone?.payload?.center)return;
    const dynamic=zone.payload.dynamic_radius===true,base=Number(zone.payload.base_radius_m)||(dynamic?BASE_HIDE_RADIUS_M:(Number(zone.payload.radius_m)||BASE_HIDE_RADIUS_M));
    const radius=dynamic?base*Math.sqrt(currentAreaMultiplier()):(Number(zone.payload.radius_m)||base);
    state.mapLayers.publicEndgameZone=L.circle([Number(zone.payload.center.lat),Number(zone.payload.center.lng)],{radius,color:'#16a34a',weight:2,fillColor:'#22c55e',fillOpacity:.08}).addTo(state.gameMap).bindTooltip(`Endgame zone · ${Math.round(radius)} m`);
  }

  function clearPrivateMapLayers(){['hiderStation','hiderSpot','hiderZone','prosperousPreview','seekerLive','seekerLiveAccuracy'].forEach(k=>{state.mapLayers[k]?.remove();state.mapLayers[k]=null;});}
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
    const used=new Set(effectiveActions('question').map(a=>a.payload?.slot_key));$('questionDeckStatus').textContent=`${used.size}/${QUESTION_CARDS.length} asked`;
    const groups=[['MIXED','Mixed'],['RADAR','Radars'],['THERMOMETER','Thermometers'],['TENTACLES','Tentacles'],['PHOTO','Photo questions']];
    $('questionDeck').innerHTML=groups.map(([key,label])=>{
      const cards=QUESTION_CARDS.filter(c=>c.category===key);if(!cards.length)return'';
      const html=cards.map(c=>{
        const isUsed=used.has(c.slot),disabled=state.role!=='seeker'||isUsed||state.game?.status==='finished',preview=state.previewQuestionSlot===c.slot;let extra='',qstate=isUsed?'Asked':(state.role==='seeker'?'Available':'Not asked');
        if(c.kind==='thermometer'&&!isUsed){const prog=thermometerProgress(c);if(prog){if(state.role==='seeker'&&prog.ready){extra='thermo-ready';qstate=`Ready · moved ${Math.round(prog.travelled)} m`; }else{extra='thermo-armed';qstate=state.role==='seeker'&&Number.isFinite(prog.travelled)?`Armed · ${Math.round(prog.travelled)}/${c.min_travel_m} m`:'Armed';}}}
        if(preview)extra+=` preview-active`;
        return `<button class="question-card-button ${isUsed?'used':''} ${state.role==='hider'?'hider-view':''} ${extra}" data-question-slot="${c.slot}" ${disabled?'disabled':''}><div><div class="q-category">${escapeHtml(c.category)}</div><div class="q-title">${escapeHtml(c.title)}</div><div class="q-detail">${escapeHtml(c.detail)}</div></div><div class="q-state">${escapeHtml(qstate)}</div></button>`;
      }).join('');
      return `<section class="question-group"><div class="question-group-title">${label}</div><div class="question-group-grid">${html}</div></section>`;
    }).join('');
    $('questionDeck').querySelectorAll('[data-question-slot]').forEach(b=>b.addEventListener('click',()=>{const c=QUESTION_CARDS.find(x=>x.slot===b.dataset.questionSlot);if(c)handleQuestionCard(c).catch(handleError);}));
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
    const pending=effectiveActions('question').filter(q=>!activeAnswerForQuestion(q.id)&&!activeVetoForQuestion(q.id));
    if($('pendingQuestionCount'))$('pendingQuestionCount').textContent=pending.length?`${pending.length} open`:'None';
    if(!pending.length){$('pendingQuestions').innerHTML='<div class="mini-status">No ongoing questions.</div>';return;}
    if(state.role==='seeker'){
      $('pendingQuestions').innerHTML=pending.map((q,i)=>`<div class="question-item"><div class="row-between pending-question-head"><strong>Question ${i+1} · ${escapeHtml(activityQuestionName(q))}</strong><span class="answer-pill pending">Waiting</span></div><div class="meta">${new Date(q.created_at).toLocaleTimeString()}</div></div>`).join('');
      return;
    }
    if(state.role!=='hider')return;
    const hasVeto=availableHandCards('veto_question').length>0;
    $('pendingQuestions').innerHTML=pending.map(q=>{
      const kind=q.payload?.question_kind,s=kind==='photo'?null:suggestedAnswer(q);let controls='';
      if(kind==='tentacle'){
        if(s?.status==='auto_veto')controls=`<button class="danger full" data-auto-veto-tentacle="${q.id}">Confirm automatic veto</button>`;
        else controls=`<button class="primary full" data-send-tentacle="${q.id}">Closest to ${escapeHtml(s?.poi?.name||'…')}</button>`;
      }else if(kind==='photo'){
        const existing=state.photoPreviewUrls.get(q.id)||'';
        controls=`<div class="photo-answer-box"><label class="photo-file-label">Choose photo<input type="file" accept="image/*" data-photo-input="${q.id}"></label><div class="photo-local-preview ${existing?'':'hidden'}" data-photo-preview-wrap="${q.id}"><img data-photo-preview="${q.id}" ${existing?`src="${escapeHtml(existing)}"`:''} alt="Selected photo preview"></div><button class="primary full" data-send-photo="${q.id}" ${state.photoFiles.has(q.id)?'':'disabled'}>Send photo</button></div>`;
      }else{
        let yesLabel='Yes',noLabel='No';
        if(kind==='thermometer'){yesLabel='Warmer';noLabel='Colder';}
        if(kind==='radar'){yesLabel='Hit';noLabel='Miss';}
        if(kind==='directional'){yesLabel=q.payload?.positive_label||'Yes';noLabel=q.payload?.negative_label||'No';}
        controls=`<div class="answer-row"><button class="primary answer-yes" data-answer-question="${q.id}" data-answer-value="true">${escapeHtml(yesLabel)}</button><button class="primary answer-no" data-answer-question="${q.id}" data-answer-value="false">${escapeHtml(noLabel)}</button></div>`;
      }
      const suggestion=kind==='photo'?`<div class="suggestion photo-request"><strong>Photo</strong>${escapeHtml(q.payload?.photo_prompt||q.payload?.title||'Photo')}</div>`:`<div class="suggestion"><strong>Preview</strong>${escapeHtml(s?.text||'Could not calculate.')}</div>`;
      return `<div class="question-item"><div class="row-between pending-question-head"><strong>${escapeHtml(activityQuestionName(q))}</strong><span data-question-deadline="${q.id}" class="answer-deadline"></span></div>${suggestion}${controls}${hasVeto?`<button class="danger tiny activity-undo" data-veto-question="${q.id}">Veto</button>`:''}</div>`;
    }).join('');
    renderAnswerDeadlines();
    $('pendingQuestions').querySelectorAll('[data-answer-question]').forEach(b=>b.addEventListener('click',()=>{const q=state.actions.find(a=>a.id===b.dataset.answerQuestion);if(q)answerBoolean(q,b.dataset.answerValue==='true').catch(handleError);}));
    $('pendingQuestions').querySelectorAll('[data-send-tentacle]').forEach(b=>b.addEventListener('click',()=>{const q=state.actions.find(a=>a.id===b.dataset.sendTentacle);if(q)answerTentacle(q).catch(handleError);}));
    $('pendingQuestions').querySelectorAll('[data-auto-veto-tentacle]').forEach(b=>b.addEventListener('click',()=>{const q=state.actions.find(a=>a.id===b.dataset.autoVetoTentacle);if(q)autoVetoTentacle(q).catch(handleError);}));
    $('pendingQuestions').querySelectorAll('[data-veto-question]').forEach(b=>b.addEventListener('click',()=>{const q=state.actions.find(a=>a.id===b.dataset.vetoQuestion);if(q)vetoQuestion(q).catch(handleError);}));
    $('pendingQuestions').querySelectorAll('[data-photo-input]').forEach(inp=>inp.addEventListener('change',()=>{const qid=inp.dataset.photoInput,file=inp.files?.[0];if(!file)return;const old=state.photoPreviewUrls.get(qid);if(old)URL.revokeObjectURL(old);const url=URL.createObjectURL(file);state.photoPreviewUrls.set(qid,url);state.photoFiles.set(qid,file);const img=$('pendingQuestions').querySelector(`[data-photo-preview="${CSS.escape(qid)}"]`),wrap=$('pendingQuestions').querySelector(`[data-photo-preview-wrap="${CSS.escape(qid)}"]`),btn=$('pendingQuestions').querySelector(`[data-send-photo="${CSS.escape(qid)}"]`);if(img)img.src=url;if(wrap)wrap.classList.remove('hidden');if(btn)btn.disabled=false;}));
    $('pendingQuestions').querySelectorAll('[data-send-photo]').forEach(b=>b.addEventListener('click',()=>{const q=state.actions.find(a=>a.id===b.dataset.sendPhoto),file=state.photoFiles.get(b.dataset.sendPhoto);if(q)uploadPhotoAnswer(q,file).catch(handleError);}));
  }

  function drawIsEarned(d){const q=state.actions.find(a=>a.id===d.question_action_id);return q&&isActionEffective(q)&&!!activeAnswerForQuestion(q.id);}
  function renderCurseDraws(){
    if(state.role!=='hider')return;const earned=state.hiderDraws.filter(drawIsEarned);const hand=availableHandCards();const timeBonus=hand.filter(c=>c.card_kind==='time_bonus').reduce((sum,c)=>sum+Number(c.value_int||0),0)+state.privateCardUses.filter(u=>u.effect_key==='duplicate_bonus'&&u.is_active).reduce((sum,u)=>sum+Number(u.value_int||0),0)+state.timeTraps.filter(t=>t.trigger_active).reduce((sum,t)=>sum+Number(t.bonus_minutes||0),0);const deck=state.deckStatus;$('bonusTotal').textContent=`${timeBonus} min held/earned${deck?` · deck ${deck.remaining}/${deck.total} · cycle ${deck.cycle}`:''}`;
    const unresolved=earned.filter(d=>(d.kept_card_keys||[]).length<Number(d.keep_limit||1));
    const drawsHtml=unresolved.length?unresolved.map(d=>{const kept=new Set(d.kept_card_keys||[]),used=new Set(d.used_card_keys||[]),count=kept.size;return `<div class="curse-draw"><div class="curse-draw-title">New draw · choose ${d.keep_limit-count} more <span class="mini-status">(${count}/${d.keep_limit} kept)</span></div><div class="curse-options">${d.cards.map(c=>{if(kept.has(c.card_key)||used.has(c.card_key))return'';return `<div class="curse-option"><div class="card-kind">${escapeHtml(c.card_kind)}</div><strong>${escapeHtml(c.title)}</strong><p>${escapeHtml(c.description)}${c.duration_seconds?` · ${formatDuration(c.duration_seconds)}`:''}${Number(c.cast_cost_minutes||0)?` · costs ${c.cast_cost_minutes} min to cast`:''}</p><button class="primary small keep-toggle" data-keep-card="${c.card_key}" data-draw-id="${d.id}" data-keep-active="true" ${count>=d.keep_limit?'disabled':''}>Keep</button></div>`;}).join('')}</div></div>`;}).join(''):'<div class="mini-status">No card pick is waiting.</div>';
    const handHtml=hand.length?`<div class="hand-grid">${hand.map(c=>`<div class="hand-card"><div class="card-kind">${escapeHtml(c.card_kind)}</div><strong>${escapeHtml(c.title)}</strong><div class="card-meta">${escapeHtml(c.description)}${Number(c.cast_cost_minutes||0)?` · Casting cost: ${c.cast_cost_minutes} min`:''}</div><div class="hand-actions">${c.card_kind==='time_bonus'?'<span class="answer-pill pending">TIME BONUS</span>':`<button class="primary small" data-play-card="${c.card_key}">${c.effect_key==='veto_question'?'Use on question':c.effect_key==='time_trap'?'Place':'Play'}</button>`}<button class="secondary small" data-discard-card="${c.card_key}">Discard</button></div></div>`).join('')}</div>`:'<div class="mini-status">Your hand is empty.</div>';
    $('curseDraws').innerHTML=`<div class="card-section-title">Pending picks</div>${drawsHtml}<div class="card-section-title hand-title">Current hand</div>${handHtml}`;
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

  const SEEKER_CURSE_EFFECTS=new Set(['gamblers_feet','impenetrable_fog','express_route','rewind','dice_tax','spotty_memory','statue','photo_op']);
  const ONE_QUESTION_CURSES=new Set(['rewind','statue','photo_op']);
  function unlockCurseAudio(){try{const Ctx=window.AudioContext||window.webkitAudioContext;if(!Ctx)return;if(!state.audioCtx)state.audioCtx=new Ctx();if(state.audioCtx.state==='suspended')state.audioCtx.resume().catch(()=>{});}catch(_){}}
  function playCurseSound(){
    try{
      unlockCurseAudio();const ctx=state.audioCtx;if(!ctx||ctx.state==='suspended')return;const gain=ctx.createGain();gain.connect(ctx.destination);gain.gain.setValueAtTime(.0001,ctx.currentTime);gain.gain.exponentialRampToValueAtTime(.16,ctx.currentTime+.02);gain.gain.exponentialRampToValueAtTime(.0001,ctx.currentTime+.7);
      const o1=ctx.createOscillator(),o2=ctx.createOscillator();o1.type='sine';o2.type='triangle';o1.frequency.setValueAtTime(740,ctx.currentTime);o1.frequency.exponentialRampToValueAtTime(420,ctx.currentTime+.55);o2.frequency.setValueAtTime(1110,ctx.currentTime);o2.frequency.exponentialRampToValueAtTime(620,ctx.currentTime+.55);o1.connect(gain);o2.connect(gain);o1.start();o2.start(ctx.currentTime+.08);o1.stop(ctx.currentTime+.65);o2.stop(ctx.currentTime+.65);
    }catch(e){console.warn('Curse sound unavailable',e);}
  }
  function renderActiveCurses(){
    const now=serverNowMs();const all=effectiveActions().filter(a=>['curse_play','time_trap_trigger','question_veto'].includes(a.kind));const visible=all.filter(a=>{const end=a.payload?.ends_at?new Date(a.payload.ends_at).getTime():null;if(end)return end>now;if(a.kind==='curse_play'&&ONE_QUESTION_CURSES.has(a.payload?.effect_key)){const t=new Date(a.created_at).getTime();return !effectiveActions('question').some(q=>q.actor==='seeker'&&new Date(q.created_at).getTime()>t);}return true;}).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
    $('activeCurses').innerHTML=visible.length?visible.map(a=>{if(a.kind==='question_veto')return `<div class="curse-item"><strong>${a.payload?.automatic_tentacle?'Tentacle automatically vetoed':'Question vetoed'}</strong><div class="meta">${escapeHtml(a.payload?.question_title||'A question')} ${a.payload?.automatic_tentacle?`had no qualifying option within ${Number(a.payload?.valid_distance_m||TENTACLE_VALID_DISTANCE_M)} m of the hider target.`:'was vetoed.'}</div></div>`;if(a.kind==='time_trap_trigger')return `<div class="curse-item"><strong>Time Trap triggered</strong><div class="meta">${escapeHtml(a.payload?.station_name||'Station')} · +${Number(a.payload?.bonus_minutes||0)} min</div></div>`;const end=a.payload?.ends_at?new Date(a.payload.ends_at).getTime():null;const rem=end?Math.max(0,Math.ceil((end-now)/1000)):null;return `<div class="curse-item curse-active"><strong>${escapeHtml(a.payload?.title||'Card')}</strong><div class="meta">${escapeHtml(a.payload?.description||'')}</div><div class="curse-countdown">${rem===null?'ACTIVE':formatCountdown(rem)}</div></div>`;}).join(''):'<div class="mini-status">No public card effect is active.</div>';

    const strip=$('seekerCurseStrip');if(!strip)return;
    const seekerCurses=visible.filter(a=>a.kind==='curse_play'&&SEEKER_CURSE_EFFECTS.has(a.payload?.effect_key));
    if(state.role!=='seeker'||!seekerCurses.length){strip.classList.add('hidden');strip.innerHTML='';if(state.role!=='seeker'){state.curseSoundPrimed=false;state.seenCurseIds=new Set();}return;}
    strip.classList.remove('hidden');strip.innerHTML=seekerCurses.map(a=>{const end=a.payload?.ends_at?new Date(a.payload.ends_at).getTime():null;const rem=end?Math.max(0,Math.ceil((end-now)/1000)):null;return `<div class="curse-chip"><span class="curse-chip-icon">⚠</span><span><strong>${escapeHtml(a.payload?.title||'Curse')}</strong><small>${rem===null?'ACTIVE':formatCountdown(rem)}</small></span></div>`;}).join('');
    const ids=new Set(seekerCurses.map(a=>a.id));
    if(!state.curseSoundPrimed){state.seenCurseIds=ids;state.curseSoundPrimed=true;}
    else{
      const incoming=seekerCurses.filter(a=>!state.seenCurseIds.has(a.id));
      if(incoming.length){incoming.forEach(a=>state.seenCurseIds.add(a.id));playCurseSound();toast(`CURSED: ${incoming.map(a=>a.payload?.title||'Curse').join(', ')}`,5000);}
    }
  }

  function canToggleAction(a){if(['time_trap_place','time_trap_trigger','endgame_zone','game_finish'].includes(a.kind))return false;if(state.role==='hider')return a.actor==='hider';if(state.role==='seeker')return a.actor==='seeker';return false;}
  function activityQuestionName(q){
    const p=q.payload||{};
    if(p.question_kind==='district')return `District = ${p.district_name||p.district_number||'?'}`;
    if(p.question_kind==='radar')return `${formatDistance(p.radius_m)} Radar`;
    if(p.question_kind==='same_line')return `Same Line · ${p.seeker_station_name||'rail station'}`;
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
    if(!r)return '<span class="activity-resolution pending">Pending</span>';
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
    const entries=[
      ...state.actions.filter(a=>a.kind==='question').map(q=>({type:'question',at:q.created_at,q})),
      ...state.actions.filter(a=>!['question','answer','question_veto','thermo_reference','endgame_zone'].includes(a.kind)).map(a=>({type:'action',at:a.created_at,a}))
    ].sort((x,y)=>new Date(x.at)-new Date(y.at));
    const orderedQuestions=state.actions.filter(a=>a.kind==='question').sort((a,b)=>new Date(a.created_at)-new Date(b.created_at)),questionNumber=new Map(orderedQuestions.map((q,i)=>[q.id,i+1]));
    $('activityHistory').innerHTML=entries.length?entries.map(entry=>{
      if(entry.type==='question'){
        const q=entry.q,r=rawResolutionForQuestion(q.id),pen=Number(r?.payload?.late_penalty_minutes||0),qEffective=isActionEffective(q),rEffective=r?isActionEffective(r):false;
        return `<div class="activity-item grouped ${qEffective?'':'inactive'}"><div class="activity-question-line"><strong>Question ${questionNumber.get(q.id)||'?'} – ${escapeHtml(activityQuestionName(q))}</strong>${!qEffective?' <span class="answer-pill undone">UNDONE</span>':''}${activityResolutionMarkup(q,r)}</div><div class="meta">${new Date(q.created_at).toLocaleString()}${r?` · resolved ${new Date(r.created_at).toLocaleTimeString()}${!rEffective?' · resolution undone':''}`:''}${pen?` · <strong>−${pen} min late penalty</strong>`:''}</div><div class="activity-actions compact">${canToggleAction(q)?`<button class="${q.is_active?'danger':'secondary'} tiny activity-undo" data-toggle-action="${q.id}" data-active="${q.is_active?'false':'true'}">${q.is_active?'Undo question':'Redo question'}</button>`:''}${r&&canToggleAction(r)?`<button class="${r.is_active?'danger':'secondary'} tiny activity-undo" data-toggle-action="${r.id}" data-active="${r.is_active?'false':'true'}">${r.is_active?'Undo answer':'Redo answer'}</button>`:''}</div></div>`;
      }
      const a=entry.a;return `<div class="activity-item ${a.is_active?'':'inactive'}"><div><strong>${escapeHtml(actionLabel(a))}</strong>${!a.is_active?' <span class="answer-pill undone">UNDONE</span>':''}</div><div class="meta">${new Date(a.created_at).toLocaleString()} · ${escapeHtml(a.actor)}</div>${canToggleAction(a)?`<div class="activity-actions compact"><button class="${a.is_active?'danger':'secondary'} tiny activity-undo" data-toggle-action="${a.id}" data-active="${a.is_active?'false':'true'}">${a.is_active?'Undo':'Redo'}</button></div>`:''}</div>`;
    }).join(''):'<div class="mini-status">No game activity yet.</div>';
    $('activityHistory').querySelectorAll('[data-toggle-action]').forEach(b=>b.addEventListener('click',()=>{const a=state.actions.find(x=>x.id===b.dataset.toggleAction);if(a)setActionActive(a,b.dataset.active==='true').catch(handleError);}));
    hydratePhotoMedia().catch(e=>console.warn(e));
  }

  function renderAll(){renderQuestionDeck();renderPendingQuestions();renderCurseDraws();renderTimeTraps();renderActiveCurses();renderActivity();renderPossibleArea();renderHiderSecret();renderSeekerLiveForHider();renderSeekerEndgame();renderGameClock();}

  function questionLabel(q){const p=q.payload||{};if(p.question_kind==='radar')return `${formatDistance(p.radius_m)} Radar from ${formatCoord(p.center)}`;if(p.question_kind==='district')return `Same District: ${p.district_number}. ${p.district_name}`;if(p.question_kind==='same_line')return `Same Line from ${p.seeker_station_name||'rail station'} (${(p.line_refs||[]).join(', ')})`;if(p.question_kind==='directional')return p.title||'Direction';if(p.question_kind==='thermometer')return `${formatDistance(p.min_travel_m)} Thermometer: ${formatCoord(p.from)} → ${formatCoord(p.to)}`;if(p.question_kind==='tentacle')return `${humanize(p.poi_type)} Tentacle · ${p.pois?.length||0} options in remaining zone`;if(p.question_kind==='photo')return `Photo · ${p.photo_prompt||p.title||'Photo'}`;return p.title||p.slot_key||'Question';}
  function answerLabel(ans){if(!ans)return'';if(ans.type==='boolean')return ans.value?'YES':'NO';if(ans.type==='tentacle'&&ans.status==='poi')return `Hider is closest to ${ans.poi?.name||'selected POI'}`;if(ans.type==='photo')return 'PHOTO';return 'ANSWER';}
  function actionLabel(a){const p=a.payload||{};if(a.kind==='question')return `Question · ${questionLabel(a)}`;if(a.kind==='answer'){const q=state.actions.find(x=>x.id===a.parent_id);return `Answer · ${q?questionLabel(q):'question'} · ${answerLabel(p.answer)}`;}if(a.kind==='thermo_reference')return `Thermometer start · ${Number(p.lat).toFixed(4)}, ${Number(p.lng).toFixed(4)}`;if(a.kind==='curse_play')return `Card played · ${p.title||p.card_key||'Curse'}`;if(a.kind==='question_veto')return `${p.automatic_tentacle?'Automatic Tentacle veto':'Veto'} · ${p.question_title||'Question'}`;if(a.kind==='time_trap_place')return `Time Trap placed · ${p.station_name||'Station'}`;if(a.kind==='time_trap_trigger')return `Time Trap triggered · ${p.station_name} · +${p.bonus_minutes} min`;if(a.kind==='game_finish')return `Hider Found · final ${formatCountdown(Number(p.final_seconds||0))}`;return a.kind;}
  function formatDistance(m){return Number(m)>=1000?`${Number(m)/1000} km`:`${Number(m)} m`;}
  function formatCoord(p){return p?`${Number(p.lat).toFixed(4)}, ${Number(p.lng).toFixed(4)}`:'?';}
  function gameClockSeconds(){if(!state.game)return 0;let sec=Number(state.game.clock_elapsed_seconds||0);if(state.game.clock_running&&state.game.clock_started_at)sec+=Math.max(0,(serverNowMs()-new Date(state.game.clock_started_at).getTime())/1000);return Math.floor(sec);}
  function answerPenaltyTotal(){return effectiveActions().filter(a=>['answer','question_veto'].includes(a.kind)).reduce((sum,a)=>sum+Number(a.payload?.late_penalty_minutes||0),0);}
  function renderGameClock(){
    const el=$('gameClockDisplay');if(!el||!state.game)return;const finished=state.game.status==='finished';
    const raw=finished?Number(state.game.final_raw_seconds??state.game.clock_elapsed_seconds??0):gameClockSeconds();
    const final=finished?Number(state.game.final_score_seconds??raw):raw;el.textContent=formatCountdown(final);el.classList.toggle('running',!finished&&!!state.game.clock_running);
    const meta=$('gameScoreMeta');if(meta)meta.textContent=finished?`Raw ${formatCountdown(raw)} · +${Number(state.game.final_bonus_minutes||0)} cards · +${Number(state.game.final_trap_minutes||0)} traps · −${Number(state.game.final_penalty_minutes||0)} penalties`:'';
    const controls=$('gameClockControls');if(controls)controls.classList.toggle('hidden',state.role!=='hider'||finished);
    const start=$('startGameClockButton'),pause=$('pauseGameClockButton');if(start){start.textContent=Number(state.game.clock_elapsed_seconds||0)>0?'Resume':'Start';start.disabled=!!state.game.clock_running;}if(pause)pause.disabled=!state.game.clock_running;
    const status=$('gameClockStatus');if(status)status.textContent=state.game.clock_running?'Running':'Paused';
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
  function startTimers(){clearInterval(state.timerId);state.timerId=setInterval(()=>{if(state.game){renderActiveCurses();renderTimeTraps();renderGameClock();renderAnswerDeadlines();if(state.role==='hider')renderSeekerLiveForHider();if(state.role==='seeker')renderQuestionDeck();}},1000);}

  function subscribeRealtime(){
    if(state.realtimeChannel)state.supabase.removeChannel(state.realtimeChannel);$('syncBadge').textContent='Live';$('syncBadge').className='badge ok';state.realtimeChannel=state.supabase.channel(`game-${state.game.id}`).on('postgres_changes',{event:'*',schema:'public',table:'game_actions',filter:`game_id=eq.${state.game.id}`},()=>reloadGameState().catch(handleError)).on('postgres_changes',{event:'UPDATE',schema:'public',table:'games',filter:`id=eq.${state.game.id}`},()=>reloadGameState().catch(handleError)).subscribe(status=>{if(status==='SUBSCRIBED'){$('syncBadge').textContent='Live';$('syncBadge').className='badge ok';}else if(['CHANNEL_ERROR','TIMED_OUT'].includes(status)){$('syncBadge').textContent='Polling';$('syncBadge').className='badge warn';}});clearInterval(state.pollId);state.pollId=setInterval(()=>{if(state.game)reloadGameState().catch(()=>{});},15000);
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
    const q=`[out:json][timeout:20];nwr${filter}(${tile.overpass});out center tags qt;`;
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
      for(const type of Object.keys(POI_QUERIES)){
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
      for(const type of Object.keys(POI_QUERIES)){const obj=JSON.parse(localStorage.getItem(POI_CACHE_PREFIX+type)||'null');if(Array.isArray(obj?.pois)){await saveReferenceDataset(REF_POI_PREFIX+type+'_v1',{pois:obj.pois},'Imported browser cache');count++;}}
      toast(`Imported ${count} cached dataset${count===1?'':'s'} to Supabase.`);await loadDeveloperDashboard();
    }catch(e){handleError(e);}
  }
  async function developerLogin(){
    initSupabaseIfNeeded();const pw=$('developerPassword').value;if(!pw)return toast('Enter the developer password.');
    const {data,error}=await state.supabase.rpc('admin_list_games_v1',{p_password:pw});if(error)throw error;state.developerPassword=pw;$('developerLoginPanel').classList.add('hidden');$('developerPanel').classList.remove('hidden');renderDeveloperGames(data||[]);await loadDeveloperDashboard();
  }
  async function loadDeveloperDashboard(){
    if(!state.developerPassword)return;
    const [{data:games,error}, {data:refs,error:refErr}]=await Promise.all([state.supabase.rpc('admin_list_games_v1',{p_password:state.developerPassword}),state.supabase.from('reference_datasets').select('dataset_key,source,content_hash,updated_at,checked_at').order('dataset_key')]);if(error)throw error;if(refErr)throw refErr;renderDeveloperGames(games||[]);renderReferenceStatus(refs||[]);
  }
  function renderReferenceStatus(refs){
    const required=[REF_ADMIN_KEY,REF_STATIONS_KEY,REF_TRANSIT_KEY,...Object.keys(POI_QUERIES).map(t=>REF_POI_PREFIX+t+'_v1')];const by=new Map(refs.map(r=>[r.dataset_key,r]));
    $('developerReferenceList').innerHTML=required.map(k=>{const r=by.get(k);return `<div class="reference-row ${r?'ok':'missing'}"><strong>${escapeHtml(k)}</strong><span>${r?`${escapeHtml(r.source||'saved')} · changed ${new Date(r.updated_at).toLocaleString()}${r.checked_at?` · checked ${new Date(r.checked_at).toLocaleString()}`:''}`:'MISSING'}</span></div>`;}).join('');
  }
  function renderDeveloperGames(games){
    $('developerGames').innerHTML=games.length?games.map(g=>`<div class="developer-game" data-admin-game="${g.id}"><input class="admin-game-name" value="${escapeHtml(g.name)}" maxlength="80"><select class="admin-game-status"><option value="active" ${g.status==='active'?'selected':''}>active</option><option value="finished" ${g.status==='finished'?'selected':''}>finished</option></select><div class="meta">${escapeHtml(g.station_name||'No station')} · ${new Date(g.created_at).toLocaleString()}</div><div class="developer-game-actions"><button class="secondary" data-admin-save="${g.id}">Save</button><button class="danger" data-admin-delete="${g.id}">Delete</button></div></div>`).join(''):'<div class="status-box">No games.</div>';
    $('developerGames').querySelectorAll('[data-admin-save]').forEach(b=>b.addEventListener('click',()=>adminSaveGame(b.dataset.adminSave).catch(handleError)));
    $('developerGames').querySelectorAll('[data-admin-delete]').forEach(b=>b.addEventListener('click',()=>adminDeleteGame(b.dataset.adminDelete).catch(handleError)));
  }
  async function adminSaveGame(id){const row=document.querySelector(`[data-admin-game="${CSS.escape(id)}"]`);const name=row.querySelector('.admin-game-name').value.trim(),status=row.querySelector('.admin-game-status').value;const ok=await confirmAction('Save game changes?',`${name}\nStatus: ${status}`,'Save');if(!ok)return;const {error}=await state.supabase.rpc('admin_update_game_v1',{p_password:state.developerPassword,p_game_id:id,p_name:name,p_status:status});if(error)throw error;await loadDeveloperDashboard();}
  async function adminDeleteGame(id){const row=document.querySelector(`[data-admin-game="${CSS.escape(id)}"]`);const name=row.querySelector('.admin-game-name').value;const ok=await confirmAction('Delete this game permanently?',`${name}\n\nThis deletes its questions, cards, secrets and history. This cannot be undone.`,'Delete game',true);if(!ok)return;const {error}=await state.supabase.rpc('admin_delete_game_v1',{p_password:state.developerPassword,p_game_id:id});if(error)throw error;await loadDeveloperDashboard();}
  function openDeveloper(){state.developerPassword=null;$('developerPassword').value='';$('developerLoginPanel').classList.remove('hidden');$('developerPanel').classList.add('hidden');showView('developerView');}

  function leaveGame(){if(state.realtimeChannel&&state.supabase)state.supabase.removeChannel(state.realtimeChannel);clearInterval(state.timerId);clearInterval(state.pollId);stopGpsAutoTracking();clearPrivateMapLayers();Object.assign(state,{role:null,game:null,hiderPassword:null,secret:null,actions:[],hiderDraws:[],timeTraps:[],privateCardUses:[],thermoReference:null,pendingQuestionCard:null,pickMode:null,trapPlacementCard:null,endgameCandidate:null,endgameAccuracyM:null,endgamePickMode:false,endgamePrepareMode:false,seekerEndgamePickMode:false,currentPosition:null,seekerLivePosition:null,deckStatus:null,thermoReferences:{},previewQuestionSlot:null,previewQuestionCard:null,photoUploadToken:null,photoUrlCache:new Map(),photoPreviewUrls:new Map(),photoFiles:new Map(),seenCurseIds:new Set(),curseSoundPrimed:false});state.currentPositionMarker?.remove();state.currentPositionAccuracyCircle?.remove();state.currentPositionMarker=null;state.currentPositionAccuracyCircle=null;clearPoiPreview();clearPendingOverlay();showView('homeView');}
  function openLobby(role){$('hiderLobby').classList.toggle('hidden',role!=='hider');$('seekerLobby').classList.toggle('hidden',role!=='seeker');$('lobbyKicker').textContent=role.toUpperCase();$('lobbyTitle').textContent=role==='hider'?'Create or open a game':'Choose a game';showView('lobbyView');(async()=>{try{if(role==='hider')await setupCreateMap();await loadGames();}catch(e){handleError(e);}})();}

  function bindUi(){
    document.querySelector('[data-action="open-developer"]').addEventListener('click',openDeveloper);document.querySelector('[data-action="developer-home"]').addEventListener('click',()=>showView('homeView'));$('developerLoginButton').addEventListener('click',()=>developerLogin().catch(handleError));$('developerRefreshCore').addEventListener('click',()=>refreshReferenceData('core').catch(handleError));$('developerRefreshPois').addEventListener('click',()=>refreshReferenceData('pois').catch(handleError));$('developerRefreshOnePoi')?.addEventListener('click',()=>refreshSelectedPoi().catch(handleError));$('developerRefreshAll').addEventListener('click',()=>refreshReferenceData('all').catch(handleError));$('developerImportCache').addEventListener('click',importBrowserReferenceCache);
    document.querySelector('[data-action="open-hider"]').addEventListener('click',()=>openLobby('hider'));document.querySelector('[data-action="open-seeker"]').addEventListener('click',()=>openLobby('seeker'));document.querySelector('[data-action="home"]').addEventListener('click',()=>showView('homeView'));document.querySelector('[data-action="leave-game"]').addEventListener('click',leaveGame);
    document.querySelectorAll('[data-tab]').forEach(btn=>btn.addEventListener('click',()=>{document.querySelectorAll('[data-tab]').forEach(x=>x.classList.toggle('active',x===btn));$('createTab').classList.toggle('active',btn.dataset.tab==='create');$('openTab').classList.toggle('active',btn.dataset.tab==='open');setTimeout(()=>state.createMap?.invalidateSize(),50);}));
    $('confirmCancel').addEventListener('click',()=>closeConfirm(false));$('confirmOk').addEventListener('click',()=>closeConfirm(true));$('confirmModal').addEventListener('click',e=>{if(e.target===$('confirmModal'))closeConfirm(false);});
    $('createStationSelect').addEventListener('change',()=>{const f=state.mapData?.stations?.find(x=>x.properties.stationId===$('createStationSelect').value);if(f)selectCreateStation(f);});$('createGameButton').addEventListener('click',()=>createGame().catch(handleError));$('openHiderGameButton').addEventListener('click',()=>enterHider($('hiderGameSelect').value,$('openPassword').value).catch(handleError));$('refreshGamesButton').addEventListener('click',()=>loadGames().catch(handleError));
    document.querySelectorAll('[data-origin-mode]').forEach(b=>b.addEventListener('click',()=>{state.seekerOriginMode=b.dataset.originMode;document.querySelectorAll('[data-origin-mode]').forEach(x=>x.classList.toggle('active',x===b));$('questionOriginStatus').textContent=state.seekerOriginMode==='gps'?'Fresh GPS for each question':'Use the current/manual map marker';if(state.seekerOriginMode==='map')beginManualCurrentPosition();}));
    $('currentGpsButton').addEventListener('click',()=>useCurrentGps().catch(handleError));$('currentMapButton').addEventListener('click',beginManualCurrentPosition);$('currentClearButton').addEventListener('click',()=>{stopGpsAutoTracking();state.currentPosition=null;state.currentPositionMarker?.remove();state.currentPositionAccuracyCircle?.remove();state.currentPositionMarker=null;state.currentPositionAccuracyCircle=null;$('currentPositionStatus').className='status-box';$('currentPositionStatus').textContent='No current position set.';renderQuestionDeck();});$('endgameCurrentButton').addEventListener('click',()=>{if(!state.currentPosition)return toast('Set your current position first.');setEndgameCandidate(state.currentPosition.lat,state.currentPosition.lng,state.currentPosition.accuracy_m,state.currentPosition.source);});$('prepareEndgameButton').addEventListener('click',()=>{state.endgamePrepareMode=true;renderHiderSecret();toast('Choose your hiding spot.');});$('endgameGpsButton').addEventListener('click',()=>getGps().then(p=>setEndgameCandidate(p.lat,p.lng,p.accuracy_m,'gps')).catch(handleError));$('endgamePickButton').addEventListener('click',()=>{state.endgamePickMode=true;toast('Tap the map to choose your hiding spot.');});$('toggleEndgameButton').addEventListener('click',()=>toggleEndgame().catch(handleError));$('seekerEndgameButton').addEventListener('click',()=>{state.seekerEndgamePickMode=true;cancelQuestionPreview();toast('Tap the station you believe is correct.');});$('hiderFoundButton').addEventListener('click',()=>finishGame().catch(handleError));$('startGameClockButton').addEventListener('click',()=>setGameClock('start').catch(handleError));$('pauseGameClockButton').addEventListener('click',()=>setGameClock('pause').catch(handleError));$('castCancel').addEventListener('click',()=>closeCastModal(null));$('castConfirm').addEventListener('click',()=>closeCastModal([...$('castOptions').querySelectorAll('input:checked')].map(x=>x.value)));$('photoModalClose').addEventListener('click',closePhotoModal);$('photoModal').addEventListener('click',e=>{if(e.target===$('photoModal'))closePhotoModal();});
  }

  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&state.gpsAutoEnabled&&Date.now()-state.lastGpsUpdateMs>=30*60*1000)refreshGpsAutoPosition();});
  document.addEventListener('pointerdown',unlockCurseAudio,{passive:true});
  bindUi();
})();
