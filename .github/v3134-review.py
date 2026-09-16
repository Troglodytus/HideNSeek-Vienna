from pathlib import Path
p=Path('app.js');s=p.read_text()

def once(old,new,label):
    global s
    if s.count(old)!=1: raise SystemExit(f'{label}: expected one match, got {s.count(old)}')
    s=s.replace(old,new,1)

old="""  function stationOverrideKey(name){return String(name||'').normalize('NFKD').replace(/[\\u0300-\\u036f]/g,'').replace(/ß/g,'ss').toLowerCase().replace(/\\s+/g,' ').trim();}
  function applyManualStationLineOverrides(stations){
    return (stations||[]).map(st=>{
      const extra=MANUAL_STATION_LINE_OVERRIDES[stationOverrideKey(st?.properties?.stationName)]||[];if(!extra.length)return st;
"""
new="""  function stationOverrideKey(name){return String(name||'').normalize('NFKD').replace(/[\\u0300-\\u036f]/g,'').replace(/ß/g,'ss').toLowerCase().replace(/\\s+/g,' ').trim();}
  function manualStationOverrideRefs(name){
    const key=stationOverrideKey(name);if(MANUAL_STATION_LINE_OVERRIDES[key])return MANUAL_STATION_LINE_OVERRIDES[key];
    for(const [base,refs] of Object.entries(MANUAL_STATION_LINE_OVERRIDES))if(key.startsWith(base+',')||key.startsWith(base+' '))return refs;
    return [];
  }
  function applyManualStationLineOverrides(stations){
    return (stations||[]).map(st=>{
      const extra=manualStationOverrideRefs(st?.properties?.stationName);if(!extra.length)return st;
"""
once(old,new,'robust station aliases')

once("    if(!q||!['seeker','hider'].includes(state.role))return;", "    if(state.developerPreview||!q||!['seeker','hider'].includes(state.role))return;", 'developer preview VOR guard')
old="""    if(state.role==='seeker'){
      if(typeof DeviceOrientationEvent!=='undefined'&&typeof DeviceOrientationEvent.requestPermission!=='function'&&!state.vorOrientationHandler)attachVorOrientation();
      if(!state.vorRenderTimer)state.vorRenderTimer=setInterval(()=>renderVorNavigation(),1000);
    }
"""
new="""    if(state.role==='seeker'&&typeof DeviceOrientationEvent!=='undefined'&&typeof DeviceOrientationEvent.requestPermission!=='function'&&!state.vorOrientationHandler)attachVorOrientation();
    if(!state.vorRenderTimer)state.vorRenderTimer=setInterval(()=>renderVorNavigation(),1000);
"""
once(old,new,'VOR expiry timer for both roles')
p.write_text(s)
