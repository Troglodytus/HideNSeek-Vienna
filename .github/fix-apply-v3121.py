from pathlib import Path
p=Path('.github/apply-v3121.py')
s=p.read_text(encoding='utf-8')
start=s.find("one(\"\"\"    if(p.question_kind==='tentacle'){showPoiPreview")
end_marker="\"\"\",'pending bus preview')\n"
if start<0:
    raise RuntimeError('pending bus preview patch block not found')
end=s.find(end_marker,start)
if end<0:
    raise RuntimeError('pending bus preview patch end not found')
end+=len(end_marker)
s=s[:start]+"# Pending Hider bus preview is left unchanged here; core geometry uses the embedded tile subset.\n"+s[end:]
p.write_text(s,encoding='utf-8')
