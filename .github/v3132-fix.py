from pathlib import Path
p=Path('app.js')
s=p.read_text()

# The first pass targets only multiline applyConstraint blocks. The private suggestedAnswer
# Same-Line branch is a one-line expression, and the Tentacle/Bus suggested branches end in
# `return null`, so they are not touched. This second pass is therefore validation-only.
checks={
  "private Same Line answer preserved":"serves the hiding station.",
  "private Tentacle answer preserved":"Suggested answer: closest to ${best.name}.",
  "Same Line final geometry worker":"if(p.question_kind==='same_line')return resolveHeavyFinalGeometry(possible,q,answer,invert);",
  "Bus final geometry worker":"if(p.question_kind==='bus_line_tentacle')return resolveHeavyFinalGeometry(possible,q,answer,invert);",
  "Tentacle final geometry worker":"if(p.question_kind==='tentacle')return resolveHeavyFinalGeometry(possible,q,answer,invert);",
}
for label,needle in checks.items():
    n=s.count(needle)
    if n!=1:raise SystemExit(f'{label}: expected 1, found {n}')

p.write_text(s)
