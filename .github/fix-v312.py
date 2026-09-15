from pathlib import Path
p=Path('.github/apply-v312.py')
s=p.read_text(encoding='utf-8')
old="""def insert_before(text, marker, addition, label):
    return replace_once(text, marker, addition + marker, label)
"""
new="""def insert_before(text, marker, addition, label):
    if label == 'bus suggested answer':
        idx = text.find(marker)
        if idx < 0:
            raise RuntimeError(f'{label}: marker not found')
        return text[:idx] + addition + text[idx:]
    return replace_once(text, marker, addition + marker, label)
"""
if old not in s:
    raise RuntimeError('insert_before helper anchor not found')
p.write_text(s.replace(old,new,1),encoding='utf-8')
