from pathlib import Path
p=Path('app.js')
s=p.read_text()

def once(old,new,label):
    global s
    n=s.count(old)
    if n!=1: raise SystemExit(f'{label}: expected 1, found {n}')
    s=s.replace(old,new,1)

# v3132-patch.py intentionally validates broad structural anchors. Restore the private
# suggested-answer branches, then patch only the exact applyConstraint blocks below.
once(
"    if(p.question_kind==='same_line')return resolveHeavyFinalGeometry(possible,q,answer,invert);",
"    if(p.question_kind==='same_line'){const [lng,lat]=state.secret.station.geometry.coordinates;const hs=nearestRailStation({lat,lng});const targetRefs=new Set(hs?.lineRefs||[]),common=(p.line_refs||[]).filter(r=>targetRefs.has(r));const yes=common.length>0;return {type:'boolean',value:yes,text:yes?`YES — ${common.join(', ')} serves the hiding station.`:`NO — ${(p.line_refs||[]).join(', ')} does not serve the hiding station.`};}",
'restore suggested same-line')

once(
"    if(p.question_kind==='bus_line_tentacle')return resolveHeavyFinalGeometry(possible,q,answer,invert);\n    if(p.question_kind==='tentacle')return resolveHeavyFinalGeometry(possible,q,answer,invert);\n    return possible;",
"""    if(p.question_kind==='bus_line_tentacle'){
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
    return null;""",
'restore suggested tentacle/bus')

old_same="""    if(p.question_kind==='same_line'){
      let yes=answer?.constraint_geometry_yes,no=answer?.constraint_geometry_no;
      if(!yes||!no){const bundle=geometryCacheGet(sameLineBundleKey(q))||await ensureSameLineConstraintBundle(q);yes=yes||bundle?.yes;no=no||bundle?.no;}
      if(boolValue)return yes?safeIntersect(possible,yes):possible;return no?safeDifference(possible,no):possible;
    }"""
once(old_same,"    if(p.question_kind==='same_line')return resolveHeavyFinalGeometry(possible,q,answer,invert);",'patch apply same-line')

old_heavy="""    if(p.question_kind==='bus_line_tentacle'){
      if(answer?.status==='line'&&answer.line_ref){const region=answer.constraint_geometry||geometryCacheGet(busConstraintKey(q,answer.line_ref))||await ensureBusConstraintGeometry(q,answer.line_ref);if(!region)return possible;return invert?safeDifference(possible,region):safeIntersect(possible,region);}return possible;
    }
    if(p.question_kind==='tentacle'){
      if(answer?.status==='poi'&&answer.poi){const cell=answer.constraint_geometry||geometryCacheGet(tentacleConstraintKey(q,answer.poi))||await ensureTentacleConstraintGeometry(q,answer.poi);if(!cell)return possible;return invert?safeDifference(possible,cell):safeIntersect(possible,cell);}return possible;
    }"""
once(old_heavy,"    if(p.question_kind==='bus_line_tentacle')return resolveHeavyFinalGeometry(possible,q,answer,invert);\n    if(p.question_kind==='tentacle')return resolveHeavyFinalGeometry(possible,q,answer,invert);",'patch apply tentacle/bus')

p.write_text(s)
