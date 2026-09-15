/* Hide & Seek Vienna v3.13.2 — heavy geometry worker.
   All expensive Turf polygon operations live here so they cannot block Leaflet/UI. */
'use strict';

importScripts('https://unpkg.com/@turf/turf@7.2.0/turf.min.js');

const R = 6378137;

function fc(features){ return turf.featureCollection((features || []).filter(Boolean)); }
function union2(a,b){
  if(!a) return b || null;
  if(!b) return a || null;
  try { return turf.union(fc([a,b])); }
  catch(e1){ try { return turf.union(a,b); } catch(e2){ return a; } }
}
function intersect2(a,b){
  if(!a || !b) return null;
  try { return turf.intersect(fc([a,b])); }
  catch(e1){ try { return turf.intersect(a,b); } catch(e2){ return null; } }
}
function difference2(a,b){
  if(!a) return null;
  if(!b) return a;
  try { return turf.difference(fc([a,b])); }
  catch(e1){ try { return turf.difference(a,b); } catch(e2){ return a; } }
}
function unionList(features){
  let level=(features || []).filter(Boolean);
  if(!level.length) return null;
  while(level.length>1){
    const next=[];
    for(let i=0;i<level.length;i+=2) next.push(i+1<level.length ? union2(level[i],level[i+1]) : level[i]);
    level=next;
  }
  return level[0] || null;
}

function mercator(lat,lng){ return {x:R*lng*Math.PI/180,y:R*Math.log(Math.tan(Math.PI/4+lat*Math.PI/360))}; }
function unmercator(p){ return {lng:p.x/R*180/Math.PI,lat:(2*Math.atan(Math.exp(p.y/R))-Math.PI/2)*180/Math.PI}; }
function coordDistanceM(a,b){
  if(!a || !b) return Infinity;
  const A=mercator(Number(a[1]),Number(a[0])),B=mercator(Number(b[1]),Number(b[0]));
  return Math.hypot(A.x-B.x,A.y-B.y);
}
function pruneRing(ring,minM){
  if(!Array.isArray(ring) || ring.length<5) return ring;
  const src=ring.slice(0,-1),out=[];
  for(const c of src){ if(!out.length || coordDistanceM(out[out.length-1],c)>=minM) out.push(c); }
  if(out.length>3 && coordDistanceM(out[out.length-1],out[0])<minM) out.pop();
  if(out.length<3) return ring;
  return [...out,[...out[0]]];
}
function pruneFeature(feature,minM=3){
  if(!feature?.geometry) return feature;
  let geometry;
  try { geometry=JSON.parse(JSON.stringify(feature.geometry)); } catch(_){ return feature; }
  if(geometry.type==='Polygon'){
    geometry.coordinates=(geometry.coordinates||[]).map(r=>pruneRing(r,minM)).filter(r=>r?.length>=4);
  } else if(geometry.type==='MultiPolygon'){
    geometry.coordinates=(geometry.coordinates||[])
      .map(poly=>(poly||[]).map(r=>pruneRing(r,minM)).filter(r=>r?.length>=4))
      .filter(poly=>poly.length);
  } else return feature;
  return {type:'Feature',properties:{...(feature.properties||{})},geometry};
}
function optimize(feature,tolerance=0.00003,minM=3){
  if(!feature) return null;
  let out=feature;
  try { out=turf.cleanCoords(out,{mutate:false}) || out; } catch(_){}
  try { out=pruneFeature(out,minM) || out; } catch(_){}
  try { out=turf.simplify(out,{tolerance,highQuality:false,mutate:false}) || out; } catch(_){}
  try { out=turf.cleanCoords(out,{mutate:false}) || out; } catch(_){}
  try { out=pruneFeature(out,minM) || out; } catch(_){}
  return out;
}

function matchingRouteFeatures(features,refs){
  const wanted=new Set((refs||[]).map(r=>String(r).toUpperCase()));
  return (features||[]).filter(f=>(f.properties?.routeRefs||[]).some(r=>wanted.has(String(r).toUpperCase())));
}
function sameLineFinal(payload){
  const domain=payload.domain,refs=(payload.line_refs||[]).map(r=>String(r).toUpperCase()),radiusM=Number(payload.radius_m||250);
  if(!domain || !refs.length) return {yes:domain||null,no:domain||null};
  const selectedSet=new Set(refs),selectedFeatures=matchingRouteFeatures(payload.rail_lines||[],refs);
  const corridor=unionList(selectedFeatures.map(f=>{ try{return turf.buffer(f,radiusM/1000,{units:'kilometers',steps:8});}catch(_){return null;} }));
  if(!corridor) return {yes:domain,no:domain};

  const stationParts=[];
  for(const f of payload.stations||[]){
    const lineRefs=[...new Set((f.properties?.lineRefs||[]).map(r=>String(r).toUpperCase()).filter(r=>/^[US]\d+/i.test(r)))];
    if(lineRefs.length<2 || !lineRefs.some(r=>selectedSet.has(r))) continue;
    try { stationParts.push(turf.buffer(f,radiusM/1000,{units:'kilometers',steps:10})); } catch(_){}
  }
  let preserve=unionList(stationParts),search=corridor;
  try { search=turf.buffer(corridor,radiusM/1000,{units:'kilometers',steps:8}); } catch(_){}
  const overlaps=[];
  for(const f of payload.rail_lines||[]){
    const routeRefs=(f.properties?.routeRefs||[]).map(r=>String(r).toUpperCase());
    if(!routeRefs.some(r=>!selectedSet.has(r))) continue;
    try {
      if(!turf.booleanIntersects(f,search)) continue;
      const b=turf.buffer(f,radiusM/1000,{units:'kilometers',steps:8});
      const overlap=intersect2(b,corridor);
      if(overlap) overlaps.push(overlap);
    } catch(_){}
  }
  preserve=unionList([preserve,...overlaps]);
  const exclusive=preserve ? difference2(corridor,preserve) : corridor;
  const yes=intersect2(domain,corridor) || domain;
  const no=exclusive ? (difference2(domain,exclusive) || domain) : domain;
  return {yes:optimize(yes),no:optimize(no)};
}

function closerHalfPlane(a,b){
  const A=mercator(a.lat,a.lng),B=mercator(b.lat,b.lng);let nx=A.x-B.x,ny=A.y-B.y;const len=Math.hypot(nx,ny);if(len<1)return null;
  nx/=len;ny/=len;const tx=-ny,ty=nx,M={x:(A.x+B.x)/2,y:(A.y+B.y)/2},L=120000,D=120000;
  const pts=[{x:M.x+tx*L,y:M.y+ty*L},{x:M.x-tx*L,y:M.y-ty*L},{x:M.x-tx*L+nx*D,y:M.y-ty*L+ny*D},{x:M.x+tx*L+nx*D,y:M.y+ty*L+ny*D}].map(unmercator);
  return turf.polygon([[...pts.map(p=>[p.lng,p.lat]),[pts[0].lng,pts[0].lat]]]);
}
function tentacleFinal(payload){
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
}

function lineParts(feature){
  if(!feature?.geometry) return [];
  if(feature.geometry.type==='LineString') return [feature];
  if(feature.geometry.type==='MultiLineString') return (feature.geometry.coordinates||[]).map(c=>turf.lineString(c,feature.properties||{}));
  return [];
}
function busGroups(refs,features){
  const wanted=[...new Set((refs||[]).map(r=>String(r).toUpperCase()))],groups=new Map(wanted.map(r=>[r,[]]));
  for(const f of features||[]) for(const r of f.properties?.routeRefs||[]){ const k=String(r).toUpperCase(); if(groups.has(k)) groups.get(k).push(...lineParts(f)); }
  return groups;
}
function distanceToLines(point,features){
  let best=Infinity;
  for(const f of features||[]){ try{best=Math.min(best,turf.pointToLineDistance(point,f,{units:'meters'}));}catch(_){} }
  return best;
}
function busFinal(payload){
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
  if(payload.invert && region) region=difference2(domain,region) || domain;
  return optimize(region);
}

function differenceOptimized(payload){ return optimize(difference2(payload.a,payload.b),Number(payload.tolerance||0.000035),Number(payload.min_vertex_m||3)); }

self.onmessage = event => {
  const {id,op,payload}=event.data||{};
  try {
    let result=null;
    if(op==='same_line_final') result=sameLineFinal(payload||{});
    else if(op==='tentacle_final') result=tentacleFinal(payload||{});
    else if(op==='bus_final') result=busFinal(payload||{});
    else if(op==='difference_optimize') result=differenceOptimized(payload||{});
    else throw new Error(`Unknown geometry operation: ${op}`);
    self.postMessage({id,ok:true,result});
  } catch(error){
    self.postMessage({id,ok:false,error:error?.message||String(error)});
  }
};
