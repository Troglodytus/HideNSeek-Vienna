(() => {
  'use strict';

  const CFG = window.HNS_CONFIG || {};
  const APP_VERSION = '3.3.4';
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
    createStation:null,
    endgameCandidate:null, endgameAccuracyM:null, endgamePickMode:false, endgamePrepareMode:false,
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

  function stationIconClass(feature){
    const modes=feature?.properties?.transitModes||[];
    if(modes.includes('subway')&&modes.includes('rail'))return 'station-dot station-interchange';
    if(modes.includes('subway'))return 'station-dot station-subway';
    return 'station-dot station-rail';
  }

  function drawReferenceLayers(map,prefix,onStationClick=null){
    const md=state.mapData;
    ['city','districts','rails','stations'].forEach(k=>state.mapLayers[prefix+k]?.remove());
    state.mapLayers[prefix+'city']=L.geoJSON(md.city,{style:mapGeoStyle('city'),interactive:false}).addTo(map);
    if(prefix!=='create-')state.mapLayers[prefix+'districts']=L.geoJSON(turf.featureCollection(md.districts.map(d=>d.feature)),{style:mapGeoStyle('district'),interactive:false}).addTo(map);
    state.mapLayers[prefix+'rails']=L.geoJSON(turf.featureCollection(md.railLines),{style:f=>mapGeoStyle('rail',f),interactive:false}).addTo(map);
    state.mapLayers[prefix+'stations']=L.geoJSON(turf.featureCollection(md.stations),{
      pointToLayer:(f,ll)=>L.marker(ll,{icon:L.divIcon({className:stationIconClass(f),iconSize:[18,18]})}),
      onEachFeature:(f,layer)=>{ layer.bindTooltip(`${f.properties?.stationName||'Station'}${f.properties?.lineRefs?.length?` · ${f.properties.lineRefs.join(', ')}`:''}`,{direction:'top',offset:[0,-7]}); if(onStationClick)layer.on('click',e=>{L.DomEvent.stopPropagation(e);onStationClick(f);}); }
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

  async function loadGames(){ initSupabaseIfNeeded(); const {data,error}=await state.supabase.from('games').select('id,name,status,created_at').eq('status','active').order('created_at',{ascending:false}); if(error)throw error; renderGameChoices(data||[]); return data||[]; }
  function renderGameChoices(games){
    $('hiderGameSelect').innerHTML=games.length?games.map(g=>`<option value="${escapeHtml(g.id)}">${escapeHtml(g.name)}</option>`).join(''):'<option value="">No active games</option>';
    $('gameList').innerHTML=games.length?games.map(g=>`<div class="game-entry"><div><strong>${escapeHtml(g.name)}</strong><span>${new Date(g.created_at).toLocaleString()}</span></div><button class="primary" data-enter-seeker="${g.id}">Enter</button></div>`).join(''):'<div class="status-box">No active games yet.</div>';
    $('gameList').querySelectorAll('[data-enter-seeker]').forEach(b=>b.addEventListener('click',()=>enterSeeker(b.dataset.enterSeeker).catch(handleError)));
  }

  async function createGame(){
    initSupabaseIfNeeded(); const name=$('createGameName').value.trim(),password=$('createPassword').value;
    if(!name)return toast('Enter a game name.'); if(password.length<4)return toast('Use a password of at least 4 characters.'); if(!state.createStation)return toast('Choose the hiding station.');
    const [slng,slat]=state.createStation.geometry.coordinates;
    const ok=await confirmAction('Create this game?',`Game: ${name}
Secret station target: ${state.createStation.properties.stationName}

You do NOT choose the final hiding spot yet. Until you privately start Endgame, every answer is calculated against this station coordinate.`,'Create game'); if(!ok)return;
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
    await ensureMapData(); setupGameMap();
    $('roleKicker').textContent=state.role.toUpperCase(); $('gameTitle').textContent=state.game.name; $('seekerControls').classList.toggle('hidden',state.role!=='seeker'); $('seekerQuestionLocation').classList.toggle('hidden',state.role!=='seeker'); $('hiderControls').classList.toggle('hidden',state.role!=='hider');
    showView('gameView'); await syncServerClock(); await reloadGameState(); subscribeRealtime(); startTimers();
  }

  function setupGameMap(){
    if(!state.gameMap){ state.gameMap=L.map('gameMap',baseMapOptions()); addBaseTiles(state.gameMap); state.gameMap.on('click',e=>handleGameMapClick(e.latlng)); }
    drawReferenceLayers(state.gameMap,'game-',f=>{ if(state.role==='hider'&&state.trapPlacementCard)placeTimeTrapAtStation(f).catch(handleError); });
    state.gameMap.fitBounds(L.geoJSON(state.mapData.city).getBounds(),{padding:[5,5]});
  }

  function handleGameMapClick(latlng){
    if(state.pickMode==='current_position'){state.pickMode=null;setCurrentPosition({lat:latlng.lat,lng:latlng.lng,accuracy_m:null,source:'map'});return;}
    if(state.role==='hider'&&state.endgamePickMode){state.endgamePickMode=false;setEndgameCandidate(latlng.lat,latlng.lng,null,'map');return;}
    if(state.role!=='seeker')return;
    if(state.pickMode==='question'&&state.pendingQuestionCard){ const card=state.pendingQuestionCard; state.pickMode=null;state.pendingQuestionCard=null; const origin={lat:latlng.lat,lng:latlng.lng,accuracy_m:null,source:'map'};setCurrentPosition(origin,{pan:false});prepareAndAskQuestion(card,origin).catch(handleError); return; }
    if(state.pickMode==='thermo'){ state.pickMode=null; const origin={lat:latlng.lat,lng:latlng.lng,accuracy_m:null,source:'map'};setCurrentPosition(origin,{pan:false});submitThermoReference(origin).catch(handleError); }
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
  }
  async function useCurrentGps(){const p=await getGps();setCurrentPosition({...p,source:'gps'});}
  function beginManualCurrentPosition(){state.pickMode='current_position';toast('Tap anywhere on the map to set your current position. You can also drag the marker afterward.');}

  async function chooseQuestionOrigin(card){
    let origin=state.currentPosition;
    if(state.seekerOriginMode==='gps'){
      const p=await getGps();origin={...p,source:'gps'};setCurrentPosition(origin,{pan:false});
    }else if(!origin){
      state.pendingQuestionCard=card;state.pickMode='question';toast(`Tap the map to set the current/question location for ${card.title}.`);return;
    }
    await prepareAndAskQuestion(card,{...origin});
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
      toast(`Loading ${card.title} reference data…`,3500); const all=await loadPoiType(card.poi_type);
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

  function hiderTargetPoint(){if(state.role!=='hider'||!state.secret)return null;return state.secret.endgame?(state.secret.hidden||state.secret.station):state.secret.station;}
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

  function currentEndgameRadius(){return BASE_HIDE_RADIUS_M*Math.sqrt(currentAreaMultiplier());}

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
      const ok=await confirmAction('Return privately to station phase?',`Automatic answer previews will again use ${state.secret.station_name}.

Seekers receive no phase flag or notification. The stored hiding spot remains private so you can re-enter Endgame later.`,'Undo endgame',true);if(!ok)return;
      const {error}=await state.supabase.rpc('set_endgame_v5',{p_game_id:state.game.id,p_password:state.hiderPassword,p_endgame:false,p_hidden_lat:null,p_hidden_lng:null});if(error)throw error;await refreshHiderSecret();await reloadGameState();return;
    }
    if(!state.endgameCandidate)return toast('Choose your actual hiding location first, using GPS or a map tap.');
    const d=distanceM(state.endgameCandidate,state.secret.station),limit=currentEndgameRadius();if(d>limit+0.5)return toast(`The hiding spot must be within ${Math.round(limit)} m of the station.`);
    const [lng,lat]=state.endgameCandidate.geometry.coordinates;
    const ok=await confirmAction('Start Endgame privately?',`Actual hiding spot: ${lat.toFixed(5)}, ${lng.toFixed(5)}
Distance from ${state.secret.station_name}: ${Math.round(d)} m
Allowed radius: ${Math.round(limit)} m

From the next question onward, automatic answer previews use this actual location. Seekers receive no phase flag or notification.`,'Enter endgame');if(!ok)return;
    const {error}=await state.supabase.rpc('set_endgame_v5',{p_game_id:state.game.id,p_password:state.hiderPassword,p_endgame:true,p_hidden_lat:lat,p_hidden_lng:lng});if(error)throw error;clearEndgameCandidate();await refreshHiderSecret();await reloadGameState();
  }
  async function refreshHiderSecret(){if(state.role!=='hider')return;const {data,error}=await state.supabase.rpc('get_hider_game_v4',{p_game_id:state.game.id,p_password:state.hiderPassword});if(error)throw error;const r=data?.[0];if(r)state.secret=secretFromRow(r);}

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
  async function recomputePossibleArea(){
    // Station phase: the hiding STATION can be anywhere inside Vienna. Do not pre-limit
    // the map to 250 m buffers around every station; that radius only matters in Endgame.
    const endgameZone=latestAction('endgame_zone');
    let possible=state.mapData.city;
    let phaseStartMs=0;
    if(endgameZone?.payload?.center){
      const radius=Number(endgameZone.payload.radius_m)||BASE_HIDE_RADIUS_M;
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
    if(state.role!=='hider'||!state.secret)return;
    const [slng,slat]=state.secret.station.geometry.coordinates;const phase=state.secret.endgame?'<span class="phase-endgame">ENDGAME / actual spot</span>':'<span class="phase-station">STATION PHASE</span>';
    const hiddenText=state.secret.endgame&&state.secret.hidden?(()=>{const [hlng,hlat]=state.secret.hidden.geometry.coordinates;return `<br>Actual spot: ${hlat.toFixed(5)}, ${hlng.toFixed(5)} · ${Math.round(distanceM(state.secret.station,state.secret.hidden))} m from station.`;})():'<br>Final hiding coordinate is not needed until you decide the seekers have reached the correct station.';
    $('hiderSecretStatus').innerHTML=`${phase}<br><strong>${escapeHtml(state.secret.station_name)}</strong> · ${slat.toFixed(5)}, ${slng.toFixed(5)}${hiddenText}`;
    const prep=$('prepareEndgameButton'),controls=$('endgameLocationControls'),toggle=$('toggleEndgameButton');
    if(state.secret.endgame){
      prep?.classList.add('hidden');controls?.classList.add('hidden');toggle?.classList.remove('hidden');toggle.textContent='Undo endgame: use station again';
    }else if(state.endgamePrepareMode){
      prep?.classList.add('hidden');controls?.classList.remove('hidden');toggle?.classList.remove('hidden');toggle.textContent='Start private endgame with selected spot';
    }else{
      prep?.classList.remove('hidden');controls?.classList.add('hidden');toggle?.classList.add('hidden');
    }
    state.mapLayers.hiderStation?.remove();state.mapLayers.hiderSpot?.remove();state.mapLayers.hiderZone?.remove();
    state.mapLayers.hiderStation=L.marker([slat,slng],{icon:L.divIcon({className:'station-selected',iconSize:[18,18]})}).addTo(state.gameMap).bindTooltip(`Private station: ${state.secret.station_name}`);
    if(state.secret.hidden){const [hlng,hlat]=state.secret.hidden.geometry.coordinates;state.mapLayers.hiderSpot=L.marker([hlat,hlng]).addTo(state.gameMap).bindTooltip('Private actual hiding spot');}
    if(state.secret.endgame||state.endgamePrepareMode){
      const r=currentEndgameRadius();state.mapLayers.hiderZone=L.circle([slat,slng],{radius:r,color:'#7c3aed',weight:2,dashArray:'5 4',fillOpacity:.04}).addTo(state.gameMap);
    }
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

  function canToggleAction(a){if(a.kind==='time_trap_trigger'||a.kind==='endgame_zone')return false;if(state.role==='hider')return a.actor==='hider';if(state.role==='seeker')return a.actor==='seeker';return false;}
  function renderActivity(){
    const rows=[...state.actions].filter(a=>a.kind!=='endgame_zone').reverse();$('activityHistory').innerHTML=rows.length?rows.map(a=>`<div class="activity-item ${a.is_active?'':'inactive'}"><div><strong>${escapeHtml(actionLabel(a))}</strong>${!a.is_active?' <span class="answer-pill undone">UNDONE</span>':''}</div><div class="meta">${new Date(a.created_at).toLocaleString()} · ${escapeHtml(a.actor)}</div>${canToggleAction(a)?`<div class="activity-actions"><button class="${a.is_active?'danger':'secondary'} small full" data-toggle-action="${a.id}" data-active="${a.is_active?'false':'true'}">${a.is_active?'Undo':'Redo'}</button></div>`:''}</div>`).join(''):'<div class="mini-status">No game activity yet.</div>';
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

  function leaveGame(){if(state.realtimeChannel&&state.supabase)state.supabase.removeChannel(state.realtimeChannel);clearInterval(state.timerId);clearInterval(state.pollId);Object.assign(state,{role:null,game:null,hiderPassword:null,secret:null,actions:[],hiderDraws:[],timeTraps:[],privateCardUses:[],thermoReference:null,pendingQuestionCard:null,pickMode:null,trapPlacementCard:null,endgameCandidate:null,endgameAccuracyM:null,endgamePickMode:false,endgamePrepareMode:false,currentPosition:null});state.currentPositionMarker?.remove();state.currentPositionAccuracyCircle?.remove();state.currentPositionMarker=null;state.currentPositionAccuracyCircle=null;clearPoiPreview();clearPendingOverlay();showView('homeView');}
  function openLobby(role){$('hiderLobby').classList.toggle('hidden',role!=='hider');$('seekerLobby').classList.toggle('hidden',role!=='seeker');$('lobbyKicker').textContent=role.toUpperCase();$('lobbyTitle').textContent=role==='hider'?'Create or open a game':'Choose a game';showView('lobbyView');(async()=>{try{if(role==='hider')await setupCreateMap();await loadGames();}catch(e){handleError(e);}})();}

  function bindUi(){
    document.querySelector('[data-action="open-developer"]').addEventListener('click',openDeveloper);document.querySelector('[data-action="developer-home"]').addEventListener('click',()=>showView('homeView'));$('developerLoginButton').addEventListener('click',()=>developerLogin().catch(handleError));$('developerRefreshCore').addEventListener('click',()=>refreshReferenceData('core').catch(handleError));$('developerRefreshPois').addEventListener('click',()=>refreshReferenceData('pois').catch(handleError));$('developerRefreshOnePoi')?.addEventListener('click',()=>refreshSelectedPoi().catch(handleError));$('developerRefreshAll').addEventListener('click',()=>refreshReferenceData('all').catch(handleError));$('developerImportCache').addEventListener('click',importBrowserReferenceCache);
    document.querySelector('[data-action="open-hider"]').addEventListener('click',()=>openLobby('hider'));document.querySelector('[data-action="open-seeker"]').addEventListener('click',()=>openLobby('seeker'));document.querySelector('[data-action="home"]').addEventListener('click',()=>showView('homeView'));document.querySelector('[data-action="leave-game"]').addEventListener('click',leaveGame);
    document.querySelectorAll('[data-tab]').forEach(btn=>btn.addEventListener('click',()=>{document.querySelectorAll('[data-tab]').forEach(x=>x.classList.toggle('active',x===btn));$('createTab').classList.toggle('active',btn.dataset.tab==='create');$('openTab').classList.toggle('active',btn.dataset.tab==='open');setTimeout(()=>state.createMap?.invalidateSize(),50);}));
    $('confirmCancel').addEventListener('click',()=>closeConfirm(false));$('confirmOk').addEventListener('click',()=>closeConfirm(true));$('confirmModal').addEventListener('click',e=>{if(e.target===$('confirmModal'))closeConfirm(false);});
    $('createStationSelect').addEventListener('change',()=>{const f=state.mapData?.stations?.find(x=>x.properties.stationId===$('createStationSelect').value);if(f)selectCreateStation(f);});$('createGameButton').addEventListener('click',()=>createGame().catch(handleError));$('openHiderGameButton').addEventListener('click',()=>enterHider($('hiderGameSelect').value,$('openPassword').value).catch(handleError));$('refreshGamesButton').addEventListener('click',()=>loadGames().catch(handleError));
    document.querySelectorAll('[data-origin-mode]').forEach(b=>b.addEventListener('click',()=>{state.seekerOriginMode=b.dataset.originMode;document.querySelectorAll('[data-origin-mode]').forEach(x=>x.classList.toggle('active',x===b));$('questionOriginStatus').textContent=state.seekerOriginMode==='gps'?'Fresh GPS for each question':'Use the current/manual map marker';if(state.seekerOriginMode==='map')beginManualCurrentPosition();}));
    $('currentGpsButton').addEventListener('click',()=>useCurrentGps().catch(handleError));$('currentMapButton').addEventListener('click',beginManualCurrentPosition);$('currentClearButton').addEventListener('click',()=>{state.currentPosition=null;state.currentPositionMarker?.remove();state.currentPositionAccuracyCircle?.remove();state.currentPositionMarker=null;state.currentPositionAccuracyCircle=null;$('currentPositionStatus').className='status-box';$('currentPositionStatus').textContent='No current position set.';});$('endgameCurrentButton').addEventListener('click',()=>{if(!state.currentPosition)return toast('Set your current position first.');setEndgameCandidate(state.currentPosition.lat,state.currentPosition.lng,state.currentPosition.accuracy_m,state.currentPosition.source);});$('setThermoGpsButton').addEventListener('click',()=>getGps().then(p=>submitThermoReference({...p,source:'gps'})).catch(handleError));$('setThermoMapButton').addEventListener('click',()=>{state.pickMode='thermo';toast('Tap the map to set Thermometer point A.');});$('prepareEndgameButton').addEventListener('click',()=>{state.endgamePrepareMode=true;renderHiderSecret();toast('Choose your actual hiding spot with GPS or on the map, then start Endgame.');});$('endgameGpsButton').addEventListener('click',()=>getGps().then(p=>setEndgameCandidate(p.lat,p.lng,p.accuracy_m,'gps')).catch(handleError));$('endgamePickButton').addEventListener('click',()=>{state.endgamePickMode=true;toast('Tap the map to choose your private final hiding spot.');});$('toggleEndgameButton').addEventListener('click',()=>toggleEndgame().catch(handleError));
  }

  bindUi();
})();
