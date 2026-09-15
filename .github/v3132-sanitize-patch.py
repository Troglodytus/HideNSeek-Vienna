from pathlib import Path
p=Path('.github/v3132-patch.py')
s=p.read_text()
start=s.index("# Heavy answered constraints now return a completed final possible-area polygon directly.")
end=s.index("# Keep heavy polygons on a single Canvas renderer rather than huge SVG paths.",start)
block=r'''# Heavy answered constraints now return completed final possible-area polygons directly.
# Use exact v3.13.1 source blocks: never regex across function boundaries.
old_same_apply="""    if(p.question_kind==='same_line'){
      let yes=answer?.constraint_geometry_yes,no=answer?.constraint_geometry_no;
      if(!yes||!no){const bundle=geometryCacheGet(sameLineBundleKey(q))||await ensureSameLineConstraintBundle(q);yes=yes||bundle?.yes;no=no||bundle?.no;}
      if(boolValue)return yes?safeIntersect(possible,yes):possible;return no?safeDifference(possible,no):possible;
    }"""
once(old_same_apply,"    if(p.question_kind==='same_line')return resolveHeavyFinalGeometry(possible,q,answer,invert);",'same-line apply worker')

old_heavy_apply="""    if(p.question_kind==='bus_line_tentacle'){
      if(answer?.status==='line'&&answer.line_ref){const region=answer.constraint_geometry||geometryCacheGet(busConstraintKey(q,answer.line_ref))||await ensureBusConstraintGeometry(q,answer.line_ref);if(!region)return possible;return invert?safeDifference(possible,region):safeIntersect(possible,region);}return possible;
    }
    if(p.question_kind==='tentacle'){
      if(answer?.status==='poi'&&answer.poi){const cell=answer.constraint_geometry||geometryCacheGet(tentacleConstraintKey(q,answer.poi))||await ensureTentacleConstraintGeometry(q,answer.poi);if(!cell)return possible;return invert?safeDifference(possible,cell):safeIntersect(possible,cell);}return possible;
    }"""
once(old_heavy_apply,"    if(p.question_kind==='bus_line_tentacle')return resolveHeavyFinalGeometry(possible,q,answer,invert);\n    if(p.question_kind==='tentacle')return resolveHeavyFinalGeometry(possible,q,answer,invert);",'tentacle bus apply worker')

'''
p.write_text(s[:start]+block+s[end:])
