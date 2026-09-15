from pathlib import Path
p=Path('app.js')
s=p.read_text(encoding='utf-8')
old="""else if(p.question_kind==='bus_line_tentacle'){const s=suggestedAnswer(q);showBusLinePreview(p.candidate_line_refs||[],s?.line_ref||null);if(s?.status==='line')showBusLineRegionPreview(state.possibleArea,s.line_ref,p.candidate_line_refs||[]);}else previewQuestionGeometry(p);"""
new="""else if(p.question_kind==='bus_line_tentacle'){const s=suggestedAnswer(q);showBusLinePreview(p.candidate_line_refs||[],s?.line_ref||null,p.bus_features||[]);}else previewQuestionGeometry(p);"""
if s.count(old)!=1:
    raise RuntimeError(f'pending bus preview anchor: expected 1 match, got {s.count(old)}')
s=s.replace(old,new,1)
p.write_text(s,encoding='utf-8')
