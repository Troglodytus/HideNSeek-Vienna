/* Hide & Seek Vienna v3.13.3 — optimized heavy geometry worker.
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
function bboxOverlaps(a,b){ return !(a[2]<b[0] || a[0]>b[2] || a[3]<b[1] || a[1]>b[3]); }
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

function closerHalfPlane(a,b){
  const A=mercator(a.lat,a.lng),B=mercator(b.lat,b.lng);let nx=A.x-B.x,ny=A.y-B.y;const len=Math.hypot(nx,ny);if(len<1)return null;
  nx/=len;ny/=len;const tx=-ny,ty=nx,M={x:(A.x+B.x)/2,y:(A.y+B.y)/2},L=120000,D=120000;
  const pts=[{x:M.x+tx*L,y:M.y+ty*L},{x:M.x-tx*L,y:M.y-ty*L},{x:M.x-tx*L+nx*D,y:M.y-ty*L+ny*D},{x:M.x+tx*L+nx*D,y:M.y+ty*L+ny*D}].map(unmercator);
  return turf.polygon([[...pts.map(p=>[p.lng,p.lat]),[pts[0].lng,pts[0].lat]]]);
}
function geometrySideRange(feature,M,nx,ny){
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
}

function differenceOptimized(payload){ return optimize(difference2(payload.a,payload.b),Number(payload.tolerance||0.000035),Number(payload.min_vertex_m||3)); }

self.onmessage = event => {
  const {id,op,payload}=event.data||{};
  try {
    let result=null;
    if(op==='same_line_prepare') result=sameLinePrepare(payload||{});
    else if(op==='same_line_apply') result=sameLineApply(payload||{});
    else if(op==='same_line_final') result=sameLineFinal(payload||{});
    else if(op==='tentacle_final') result=tentacleFinal(payload||{});
    else if(op==='bus_final') result=busFinal(payload||{});
    else if(op==='difference_optimize') result=differenceOptimized(payload||{});
    else throw new Error(`Unknown geometry operation: ${op}`);
    self.postMessage({id,ok:true,result});
  } catch(error){
    self.postMessage({id,ok:false,error:error?.message||String(error)});
  }
};
