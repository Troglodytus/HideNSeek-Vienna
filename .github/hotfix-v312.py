from pathlib import Path

p=Path('app.js')
s=p.read_text(encoding='utf-8')

def one(old,new,label):
    global s
    n=s.count(old)
    if n!=1:
        raise RuntimeError(f'{label}: expected 1 match, found {n}')
    s=s.replace(old,new,1)

one("""  async function ensureBusLines(){
    if(Array.isArray(state.mapData?.busLines)&&state.mapData.busLines.length)return state.mapData.busLines;
    try{
      const ref=await referenceDataset(REF_TRANSIT_KEY);
      if(Array.isArray(ref?.busLines)&&ref.busLines.length){state.mapData.busLines=ref.busLines;return ref.busLines;}
    }catch(e){console.warn('Bus reference lookup failed',e);}
    const lineGeo=await fetchViennaWfs(VIENNA_TRANSIT_LINES_LAYER,'Vienna bus network');
    const buses=normalizeOfficialBusLines(lineGeo);if(!buses.length)throw new Error('Vienna bus-line data are not seeded yet. Open Developer → Refresh districts + transit.');
    state.mapData.busLines=buses;return buses;
  }
""","""  async function ensureBusLines(){
    if(Array.isArray(state.mapData?.busLines)&&state.mapData.busLines.length)return state.mapData.busLines;
    const ref=await referenceDataset(REF_TRANSIT_KEY);
    if(Array.isArray(ref?.busLines)&&ref.busLines.length){state.mapData.busLines=ref.busLines;return ref.busLines;}
    throw new Error('Vienna bus-line reference data are not seeded yet. Open Developer → Refresh districts + transit once so every player uses the same bus geometry.');
  }
""",'shared bus reference')

one("""    const railLines=normalizeOfficialTransitLines(linesGeo);
    const busLines=normalizeOfficialBusLines(linesGeo);
    statusEl.textContent='Building station list from Vienna line attributes…';
""","""    const railLines=normalizeOfficialTransitLines(linesGeo);
    const busLines=normalizeOfficialBusLines(linesGeo);
    if(!busLines.length)throw new Error('Vienna public-transport WFS returned no usable bus line geometry.');
    statusEl.textContent='Building station list from Vienna line attributes…';
""",'bus refresh validation')

one("""      const rails=JSON.parse(localStorage.getItem(RAIL_CACHE_KEY)||'null');if(Array.isArray(rails)&&rails.length){await saveReferenceDataset(REF_TRANSIT_KEY,{railLines:rails},'Imported browser cache');count++;}
""","""      const rails=JSON.parse(localStorage.getItem(RAIL_CACHE_KEY)||'null');if(Array.isArray(rails)&&rails.length){const existingTransit=await referenceDataset(REF_TRANSIT_KEY);await saveReferenceDataset(REF_TRANSIT_KEY,{railLines:rails,busLines:Array.isArray(existingTransit?.busLines)?existingTransit.busLines:[]},'Imported browser cache');count++;}
""",'preserve bus cache on import')

p.write_text(s,encoding='utf-8')
print('v3.12 semantic hotfix applied')
