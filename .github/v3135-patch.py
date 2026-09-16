from pathlib import Path
import re

APP=Path('app.js'); IDX=Path('index.html'); CSS=Path('styles.css')
s=APP.read_text()

def once(old,new,label):
    global s
    n=s.count(old)
    if n!=1: raise SystemExit(f'{label}: expected 1 exact match, got {n}')
    s=s.replace(old,new,1)

def sub_once(pattern,repl,label,flags=0):
    global s
    s2,n=re.subn(pattern,lambda m:repl,s,count=1,flags=flags)
    if n!=1: raise SystemExit(f'{label}: expected 1 regex match, got {n}')
    s=s2

once("const APP_VERSION = '3.13.4';","const APP_VERSION = '3.13.5';",'version')

# Player state + continuous GPS bookkeeping.
once("    role:null, game:null, hiderPassword:null, secret:null,\n    actions:[], hiderDraws:[], timeTraps:[], privateCardUses:[],",
     "    role:null, game:null, hiderPassword:null, secret:null,currentPlayer:null,players:[],seekerPositions:[],\n    actions:[], hiderDraws:[], timeTraps:[], privateCardUses:[],",'player state')
once("    gpsAutoTimer:null,gpsAutoEnabled:false,lastGpsUpdateMs:0,seekerLivePosition:null,deckStatus:null,castResolver:null,castCard:null,",
     "    gpsAutoTimer:null,gpsWatchId:null,gpsAutoEnabled:false,lastGpsUpdateMs:0,lastGpsPublishMs:0,seekerPositionFetchBusy:false,lastSeekerPositionFetch:0,seekerLivePosition:null,deckStatus:null,castResolver:null,castCard:null,",'gps state')
once("    developerPassword:null,referenceMeta:{},sameLineSelection:null,developerCards:[],developerQuestions:[],questionCards:DEFAULT_QUESTION_CARDS.map(x=>({...x})),curseMapSignature:null,turntablesPickMode:false,turntablesCandidate:null,developerPreview:false,developerPreviewRole:null,passierscheinWasActive:false,",
     "    developerPassword:null,referenceMeta:{},sameLineSelection:null,developerCards:[],developerQuestions:[],developerPlayers:[],developerPlayerRuns:[],questionCards:DEFAULT_QUESTION_CARDS.map(x=>({...x})),curseMapSignature:null,turntablesPickMode:false,turntablesCandidate:null,developerPreview:false,developerPreviewRole:null,passierscheinWasActive:false,lastTurntablesFrozen:false,",'developer player state')

# Player dropdowns and game entry/create.
player_block=r'''  async function loadPlayers(){
    initSupabaseIfNeeded();const {data,error}=await state.supabase.rpc('list_players_v1');if(error)throw error;state.players=data||[];
    const options=state.players.length?state.players.map(p=>`<option value="${p.player_id}">${escapeHtml(p.name)} (${escapeHtml(p.initials)})</option>`).join(''):'<option value="">No players yet — create one in Developer</option>';
    for(const id of ['hiderCreatePlayerSelect','hiderOpenPlayerSelect','seekerPlayerSelect']){const el=$(id);if(!el)continue;const previous=el.value;el.innerHTML=options;if(previous&&state.players.some(p=>p.player_id===previous))el.value=previous;}
    return state.players;
  }
  function playerById(id){return state.players.find(p=>String(p.player_id)===String(id))||null;}
  function selectedPlayerFrom(id){const p=playerById($(id)?.value);if(!p)toast('Choose a player first.');return p;}
'''
once("  async function loadGames(){ initSupabaseIfNeeded();",player_block+"\n  async function loadGames(){ initSupabaseIfNeeded();",'insert player loader')

old_games=r'''  function renderGameChoices(games){
    const active=games.filter(g=>g.status==='active');
    $('hiderGameSelect').innerHTML=active.length?active.map(g=>`<option value="${escapeHtml(g.id)}">${escapeHtml(g.name)}</option>`).join(''):'<option value="">No active games</option>';
    $('gameList').innerHTML=games.length?games.map(g=>{const finished=g.status==='finished';return `<div class="game-entry ${finished?'finished':''}"><div><strong>${escapeHtml(g.name)}</strong><span>${finished?`Finished · ${formatCountdown(Number(g.final_score_seconds||0))}`:new Date(g.created_at).toLocaleString()}</span></div>${finished?'<span class="answer-pill">Ended</span>':`<button class="primary" data-enter-seeker="${g.id}">Enter</button>`}</div>`;}).join(''):'<div class="status-box">No games yet.</div>';
    $('gameList').querySelectorAll('[data-enter-seeker]').forEach(b=>b.addEventListener('click',()=>enterSeeker(b.dataset.enterSeeker).catch(handleError)));
  }

  async function createGame(){
    initSupabaseIfNeeded(); const name=$('createGameName').value.trim(),password=$('createPassword').value;
    if(!name)return toast('Enter a game name.'); if(password.length<4)return toast('Use a password of at least 4 characters.'); if(!state.createStation)return toast('Choose the hiding station.');
    const [slng,slat]=state.createStation.geometry.coordinates;
    const ok=await confirmAction('Create game?',`${name}
Hiding station: ${state.createStation.properties.stationName}`,'Create'); if(!ok)return;
    const {data,error}=await state.supabase.rpc('create_game_v4',{p_name:name,p_password:password,p_station_name:state.createStation.properties.stationName,p_station_lat:slat,p_station_lng:slng}); if(error)throw error; await enterHider(data,password);
  }
'''
new_games=r'''  function renderGameChoices(games){
    const active=games.filter(g=>g.status==='active');
    $('hiderGameSelect').innerHTML=active.length?active.map(g=>`<option value="${escapeHtml(g.id)}">${escapeHtml(g.name)}</option>`).join(''):'<option value="">No active games</option>';
    $('gameList').innerHTML=games.length?games.map(g=>{const finished=g.status==='finished';return `<div class="game-entry ${finished?'finished':''}"><div><strong>${escapeHtml(g.name)}</strong><span>${finished?`Finished · ${formatCountdown(Number(g.final_score_seconds||0))}`:new Date(g.created_at).toLocaleString()}</span></div>${finished?'<span class="answer-pill">Ended</span>':`<button class="primary" data-enter-seeker="${g.id}">Enter</button>`}</div>`;}).join(''):'<div class="status-box">No games yet.</div>';
    $('gameList').querySelectorAll('[data-enter-seeker]').forEach(b=>b.addEventListener('click',()=>{const p=selectedPlayerFrom('seekerPlayerSelect');if(p)enterSeeker(b.dataset.enterSeeker,p.player_id).catch(handleError);}));
  }

  async function createGame(){
    initSupabaseIfNeeded(); const name=$('createGameName').value.trim(),password=$('createPassword').value,player=selectedPlayerFrom('hiderCreatePlayerSelect');
    if(!player)return;if(!name)return toast('Enter a game name.'); if(password.length<4)return toast('Use a password of at least 4 characters.'); if(!state.createStation)return toast('Choose the hiding station.');
    const [slng,slat]=state.createStation.geometry.coordinates;
    const ok=await confirmAction('Create game?',`${name}\nHider: ${player.name} (${player.initials})\nHiding station: ${state.createStation.properties.stationName}`,'Create'); if(!ok)return;
    const {data,error}=await state.supabase.rpc('create_game_v5',{p_name:name,p_password:password,p_station_name:state.createStation.properties.stationName,p_station_lat:slat,p_station_lng:slng,p_hider_player_id:player.player_id}); if(error)throw error; await enterHider(data,password,player.player_id);
  }
'''
once(old_games,new_games,'game choices/create player')

old_enter=r'''  async function enterHider(gameId,password){
    initSupabaseIfNeeded(); if(!gameId)return toast('Choose a game.');
    const {data,error}=await state.supabase.rpc('get_hider_game_v4',{p_game_id:gameId,p_password:password}); if(error)throw error; const r=data?.[0]; if(!r)return toast('Wrong hider password.');
    state.developerPreview=false;state.developerPreviewRole=null;state.role='hider'; state.hiderPassword=password; state.game={id:r.game_id,name:r.game_name,status:r.game_status}; state.secret=secretFromRow(r); await enterGameCommon();
  }
  async function enterSeeker(gameId){ initSupabaseIfNeeded(); const {data,error}=await state.supabase.from('games').select('id,name,status').eq('id',gameId).single(); if(error)throw error; state.developerPreview=false;state.developerPreviewRole=null;state.role='seeker';state.hiderPassword=null;state.secret=null;state.game=data;await enterGameCommon(); }
'''
new_enter=r'''  async function enterHider(gameId,password,playerId){
    initSupabaseIfNeeded();if(!gameId)return toast('Choose a game.');const player=playerById(playerId);if(!player)return toast('Choose the Hider player.');
    const {data,error}=await state.supabase.rpc('get_hider_game_v4',{p_game_id:gameId,p_password:password});if(error)throw error;const r=data?.[0];if(!r)return toast('Wrong hider password.');
    const {error:bindError}=await state.supabase.rpc('bind_hider_player_v1',{p_game_id:gameId,p_password:password,p_player_id:player.player_id});if(bindError)throw bindError;
    state.developerPreview=false;state.developerPreviewRole=null;state.currentPlayer=player;state.role='hider';state.hiderPassword=password;state.game={id:r.game_id,name:r.game_name,status:r.game_status};state.secret=secretFromRow(r);await enterGameCommon();
  }
  async function enterSeeker(gameId,playerId){
    initSupabaseIfNeeded();const player=playerById(playerId);if(!player)return toast('Choose the Seeker player.');
    const {data,error}=await state.supabase.from('games').select('id,name,status').eq('id',gameId).single();if(error)throw error;
    state.developerPreview=false;state.developerPreviewRole=null;state.currentPlayer=player;state.role='seeker';state.hiderPassword=null;state.secret=null;state.game=data;await enterGameCommon();
  }
'''
once(old_enter,new_enter,'player entry')
once("    state.developerPreview=true;state.developerPreviewRole=role;state.role=role;state.hiderPassword=null;state.secret=null;state.game=data;await enterGameCommon();",
     "    state.developerPreview=true;state.developerPreviewRole=role;state.currentPlayer=null;state.role=role;state.hiderPassword=null;state.secret=null;state.game=data;await enterGameCommon();",'developer player null')

# Own marker + per-player GPS publication and continuous watch.
old_gps=r'''  function setCurrentPosition(origin,{pan=true}={}){
    if(!origin)return;
    state.currentPosition={lat:Number(origin.lat),lng:Number(origin.lng),accuracy_m:origin.accuracy_m==null?null:Number(origin.accuracy_m),source:origin.source||'map'};
    state.currentPositionMarker?.remove();state.currentPositionAccuracyCircle?.remove();
    state.currentPositionMarker=L.marker([state.currentPosition.lat,state.currentPosition.lng],{draggable:true}).addTo(state.gameMap).bindTooltip('Current position');
    state.currentPositionMarker.on('dragend',e=>{const p=e.target.getLatLng();setCurrentPosition({lat:p.lat,lng:p.lng,accuracy_m:null,source:'map'},{pan:false});});
    if(state.currentPosition.accuracy_m)state.currentPositionAccuracyCircle=L.circle([state.currentPosition.lat,state.currentPosition.lng],{radius:state.currentPosition.accuracy_m,className:'accuracy-circle',weight:1,fillOpacity:.04}).addTo(state.gameMap);
    const acc=state.currentPosition.source==='gps'&&state.currentPosition.accuracy_m?`GPS ±${Math.round(state.currentPosition.accuracy_m)} m`:'manual map location';
    $('currentPositionStatus').className=`status-box ${state.currentPosition.accuracy_m>100?'warn':'good'}`;
    $('currentPositionStatus').textContent=`${state.currentPosition.lat.toFixed(5)}, ${state.currentPosition.lng.toFixed(5)} · ${acc}`;
    if(pan)state.gameMap.panTo([state.currentPosition.lat,state.currentPosition.lng]);
    if(state.role==='seeker')renderQuestionDeck();
  }
  async function publishSeekerLivePosition(p){if(state.role!=='seeker'||!state.game)return;if(activeTurntablesAction())throw new Error('Seekers are frozen by Curse of the Turntables.');const {error}=await state.supabase.rpc('set_seeker_live_position_v1',{p_game_id:state.game.id,p_lat:p.lat,p_lng:p.lng,p_accuracy_m:p.accuracy_m??null});if(error)throw error;}
  function stopGpsAutoTracking(){if(state.gpsAutoTimer)clearInterval(state.gpsAutoTimer);state.gpsAutoTimer=null;state.gpsAutoEnabled=false;}
  async function refreshGpsAutoPosition(){if(!state.game||!state.gpsAutoEnabled)return;if(state.role==='seeker'&&activeTurntablesAction())return;try{const p=await getGps();state.lastGpsUpdateMs=Date.now();setCurrentPosition({...p,source:'gps'},{pan:false});if(state.role==='seeker')await publishSeekerLivePosition(p);}catch(e){console.warn('Automatic GPS refresh failed',e);}}
  function startGpsAutoTracking(){stopGpsAutoTracking();state.gpsAutoEnabled=true;state.gpsAutoTimer=setInterval(()=>refreshGpsAutoPosition(),30*60*1000);}
  async function useCurrentGps(){if(state.role==='seeker'&&activeTurntablesAction())return toast('Turntables: Seekers must stay put until the red timer ends.',5000);const p=await getGps();state.lastGpsUpdateMs=Date.now();setCurrentPosition({...p,source:'gps'});if(state.role==='seeker')await publishSeekerLivePosition(p);startGpsAutoTracking();$('currentPositionStatus').textContent+=' · auto 30 min';toast('GPS set.');}
  function beginManualCurrentPosition(){if(state.role==='seeker'&&activeTurntablesAction())return toast('Turntables: Seekers must stay put until the red timer ends.',5000);stopGpsAutoTracking();state.pickMode='current_position';toast('Tap the map to set your position.');}
'''
new_gps=r'''  function ownLocationIcon(){return L.divIcon({className:'own-location-marker',html:'<span></span>',iconSize:[24,24],iconAnchor:[12,12]});}
  function playerLocationIcon(initials,tone){return L.divIcon({className:`player-location-marker ${tone}`,html:`<span>${escapeHtml(initials||'?')}</span>`,iconSize:[28,28],iconAnchor:[14,14]});}
  function setCurrentPosition(origin,{pan=true,refreshDeck=true}={}){
    if(!origin)return;
    state.currentPosition={lat:Number(origin.lat),lng:Number(origin.lng),accuracy_m:origin.accuracy_m==null?null:Number(origin.accuracy_m),source:origin.source||'map'};
    state.currentPositionMarker?.remove();state.currentPositionAccuracyCircle?.remove();
    state.currentPositionMarker=L.marker([state.currentPosition.lat,state.currentPosition.lng],{draggable:true,icon:ownLocationIcon(),zIndexOffset:900}).addTo(state.gameMap).bindTooltip(`${state.currentPlayer?.name||'Your'} current position`);
    state.currentPositionMarker.on('dragend',e=>{const p=e.target.getLatLng();setCurrentPosition({lat:p.lat,lng:p.lng,accuracy_m:null,source:'map'},{pan:false});});
    if(state.currentPosition.accuracy_m)state.currentPositionAccuracyCircle=L.circle([state.currentPosition.lat,state.currentPosition.lng],{radius:state.currentPosition.accuracy_m,className:'accuracy-circle',weight:1,fillOpacity:.04}).addTo(state.gameMap);
    const acc=state.currentPosition.source==='gps'&&state.currentPosition.accuracy_m?`GPS ±${Math.round(state.currentPosition.accuracy_m)} m`:'manual map location';
    $('currentPositionStatus').className=`status-box ${state.currentPosition.accuracy_m>100?'warn':'good'}`;
    $('currentPositionStatus').textContent=`${state.currentPlayer?`${state.currentPlayer.name} · `:''}${state.currentPosition.lat.toFixed(5)}, ${state.currentPosition.lng.toFixed(5)} · ${acc}`;
    if(pan)state.gameMap.panTo([state.currentPosition.lat,state.currentPosition.lng]);
    if(refreshDeck&&state.role==='seeker')renderQuestionDeck();
  }
  async function publishSeekerLivePosition(p){
    if(state.role!=='seeker'||!state.game||!state.currentPlayer)return 0;if(activeTurntablesAction())throw new Error('Seekers are frozen by Curse of the Turntables.');
    const {data,error}=await state.supabase.rpc('set_seeker_player_position_v1',{p_game_id:state.game.id,p_player_id:state.currentPlayer.player_id,p_lat:p.lat,p_lng:p.lng,p_accuracy_m:p.accuracy_m??null});if(error)throw error;
    if(Number(data)>0)toast(`Time Trap triggered · ${Number(data)} trap${Number(data)===1?'':'s'}!`,5000);return Number(data||0);
  }
  function stopGpsAutoTracking(){if(state.gpsAutoTimer)clearInterval(state.gpsAutoTimer);state.gpsAutoTimer=null;if(state.gpsWatchId!==null&&navigator.geolocation){try{navigator.geolocation.clearWatch(state.gpsWatchId);}catch(_){}}state.gpsWatchId=null;state.gpsAutoEnabled=false;}
  async function refreshGpsAutoPosition(){if(!state.game||!state.gpsAutoEnabled)return;if(state.role==='seeker'&&activeTurntablesAction())return;try{const p=await getGps();state.lastGpsUpdateMs=Date.now();setCurrentPosition({...p,source:'gps'},{pan:false,refreshDeck:false});if(state.role==='seeker')await publishSeekerLivePosition(p);}catch(e){console.warn('Automatic GPS refresh failed',e);}}
  function startGpsAutoTracking(){
    stopGpsAutoTracking();if(state.developerPreview||!state.game||!navigator.geolocation)return;state.gpsAutoEnabled=true;
    state.gpsWatchId=navigator.geolocation.watchPosition(pos=>{
      if(state.role==='seeker'&&activeTurntablesAction())return;const p={lat:pos.coords.latitude,lng:pos.coords.longitude,accuracy_m:pos.coords.accuracy,source:'gps'};state.lastGpsUpdateMs=Date.now();setCurrentPosition(p,{pan:false,refreshDeck:false});
      if(state.role==='seeker'&&Date.now()-state.lastGpsPublishMs>=4000){state.lastGpsPublishMs=Date.now();publishSeekerLivePosition(p).then(()=>refreshSeekerPositions({force:true})).catch(e=>console.warn('Live Seeker GPS publish failed',e));}
    },e=>console.warn('Continuous GPS unavailable',e),{enableHighAccuracy:true,maximumAge:2000,timeout:15000});
  }
  async function useCurrentGps(){if(state.role==='seeker'&&activeTurntablesAction())return toast('Turntables: Seekers must stay put until the red timer ends.',5000);const p=await getGps();state.lastGpsUpdateMs=Date.now();setCurrentPosition({...p,source:'gps'});if(state.role==='seeker')await publishSeekerLivePosition(p);startGpsAutoTracking();toast('GPS set · live tracking active.');}
  function beginManualCurrentPosition(){if(state.role==='seeker'&&activeTurntablesAction())return toast('Turntables: Seekers must stay put until the red timer ends.',5000);stopGpsAutoTracking();state.pickMode='current_position';toast('Tap the map to set your position.');}
'''
once(old_gps,new_gps,'gps/player tracking block')
once("setCurrentPosition(p,{pan:false});\n      if(state.role==='seeker')publishSeekerLivePosition(p)","setCurrentPosition(p,{pan:false,refreshDeck:false});\n      if(state.role==='seeker')publishSeekerLivePosition(p)",'VOR no deck churn')

# Per-player map positions. Hider sees Seekers red; Seekers see teammates green. Hider coordinates never enter this public table/RPC.
old_live=re.search(r"  function clearPrivateMapLayers\(\)\{.*?\n\n  function renderHiderSecret",s,re.S)
if not old_live: raise SystemExit('private map block not found')
new_live=r'''  function clearPrivateMapLayers(){['hiderStation','hiderSpot','hiderZone','prosperousPreview','seekerLive','seekerLiveAccuracy','turntablesCandidate','playerPositions'].forEach(k=>{state.mapLayers[k]?.remove();state.mapLayers[k]=null;});}
  async function refreshSeekerPositions({force=false}={}){
    if(!state.game||state.seekerPositionFetchBusy)return;const now=Date.now();if(!force&&now-state.lastSeekerPositionFetch<3000)return;state.lastSeekerPositionFetch=now;state.seekerPositionFetchBusy=true;
    try{const {data,error}=await state.supabase.rpc('get_seeker_player_positions_v1',{p_game_id:state.game.id});if(error)throw error;state.seekerPositions=data||[];renderPlayerPositions();}catch(e){console.warn('Player positions unavailable',e);}finally{state.seekerPositionFetchBusy=false;}
  }
  function renderPlayerPositions(){
    state.mapLayers.playerPositions?.remove();state.mapLayers.playerPositions=null;const group=L.layerGroup();const now=serverNowMs();
    for(const p of state.seekerPositions||[]){
      if(state.role==='seeker'&&state.currentPlayer&&String(p.player_id)===String(state.currentPlayer.player_id))continue;
      if(!['hider','seeker'].includes(state.role))continue;const age=Math.max(0,now-new Date(p.updated_at).getTime()),tone=state.role==='hider'?'red':'green';
      const marker=L.marker([Number(p.lat),Number(p.lng)],{icon:playerLocationIcon(p.initials,tone),zIndexOffset:850,opacity:age>120000?.48:1}).bindTooltip(`${p.player_name} (${p.initials}) · ${Math.round(age/1000)} s ago`);group.addLayer(marker);
    }
    if(group.getLayers().length){group.addTo(state.gameMap);state.mapLayers.playerPositions=group;}
    const el=$('hiderSeekerLiveStatus');if(el&&state.role==='hider'){
      const rows=(state.seekerPositions||[]).map(p=>{const age=Math.max(0,Math.round((now-new Date(p.updated_at).getTime())/1000));return `${escapeHtml(p.initials)} · ${escapeHtml(p.player_name)} · ${age<60?`${age}s`:`${Math.round(age/60)}m`} ago`;});
      el.innerHTML=rows.length?rows.join('<br>'):'No Seeker GPS positions have been published yet.';
    }
  }
  function renderSeekerLiveForHider(){renderPlayerPositions();}

  function renderHiderSecret'''
s=s[:old_live.start()]+new_live+s[old_live.end():]

# Secret spot uses the same private blue own-location visual on Hider only.
once("if(state.secret.hidden){const [hlng,hlat]=state.secret.hidden.geometry.coordinates;state.mapLayers.hiderSpot=L.marker([hlat,hlng]).addTo(state.gameMap).bindTooltip('Actual hiding spot');}",
     "if(state.secret.hidden){const [hlng,hlat]=state.secret.hidden.geometry.coordinates;state.mapLayers.hiderSpot=L.marker([hlat,hlng],{icon:ownLocationIcon(),zIndexOffset:950}).addTo(state.gameMap).bindTooltip('Private actual hiding spot');}",'hider blue secret dot')

# Question RPC helper/attribution.
needle="  async function askQuestionPayload(card,payload,description){\n"
insert=r'''  async function askQuestionForCurrentPlayer(card,kind,payload){
    if(!state.currentPlayer?.player_id)throw new Error('Choose a player before asking a question.');
    const {data,error}=await state.supabase.rpc('ask_question_v5',{p_game_id:state.game.id,p_slot_key:card.slot,p_kind:kind,p_payload:payload,p_player_id:state.currentPlayer.player_id});if(error)throw error;return data;
  }

  async function askQuestionPayload(card,payload,description){
'''
once(needle,insert,'question player helper')
once("    const {error}=await state.supabase.rpc('ask_question_v4',{p_game_id:state.game.id,p_slot_key:card.slot,p_kind:card.kind,p_payload:payload});\n    if(error)throw error;",
     "    await askQuestionForCurrentPlayer(card,card.kind,payload);",'generic ask v5')
once("      const {error}=await state.supabase.rpc('ask_question_v4',{p_game_id:state.game.id,p_slot_key:card.slot,p_kind:'bus_line_tentacle',p_payload:payload});if(error)throw error;clearPendingOverlay();await reloadGameState();return;",
     "      await askQuestionForCurrentPlayer(card,'bus_line_tentacle',payload);clearPendingOverlay();await reloadGameState();return;",'bus ask v5')
once("      const {data:qId,error}=await state.supabase.rpc('ask_question_v4',{p_game_id:state.game.id,p_slot_key:card.slot,p_kind:'vor_navigation',p_payload:payload});if(error)throw error;",
     "      const qId=await askQuestionForCurrentPlayer(card,'vor_navigation',payload);",'vor ask v5')
once("        const {error}=await state.supabase.rpc('ask_question_v4',{p_game_id:state.game.id,p_slot_key:card.slot,p_kind:'tentacle',p_payload:payload});if(error)throw error;",
     "        await askQuestionForCurrentPlayer(card,'tentacle',payload);",'tentacle ask v5')

# Normal answers go through v6; Bus has its own server wrapper and is untouched.
s=s.replace("rpc('answer_question_v5'","rpc('answer_question_v6'")

# Question reward transparency, strategic lock, stable Same-Line select.
new_deck=r'''  function questionRewardInfo(card){
    const kind=card?.kind||card?.question_kind||'';
    if(['radar','thermometer'].includes(kind))return{draw:2,keep:1};
    if(['tentacle','bus_line_tentacle','vor_navigation'].includes(kind))return{draw:4,keep:2};
    if(['same_line','station_interchange'].includes(kind))return{draw:3,keep:2};
    return{draw:3,keep:1};
  }
  function questionRewardMarkup(card,rewardless){const r=questionRewardInfo(card);return `<div class="q-reward ${rewardless?'suppressed':''}">${rewardless?'Turntables: reward currently suppressed':`Hider reward · Draw ${r.draw} · Keep ${r.keep}`}</div>`;}
  function renderQuestionDeck(){
    const cardsAll=state.questionCards?.length?state.questionCards:DEFAULT_QUESTION_CARDS,phase=targetPhaseStartMs();const phaseQuestions=effectiveActions('question').filter(a=>!phase||new Date(a.created_at).getTime()>phase),used=new Set(phaseQuestions.map(a=>a.payload?.slot_key)),askedCount=phaseQuestions.length,rewardless=turntablesRewardlessRemaining();$('questionDeckStatus').textContent=`${askedCount} asked${rewardless?` · ${rewardless} no-reward left`:''}`;
    const groups=[['MIXED','Mixed'],['RADAR','Radars'],['THERMOMETER','Thermometers'],['TENTACLES','Tentacles'],['PHOTO','Photo questions']],endgame=!!latestAction('endgame_zone'),lines=availableRailLineRefs();
    if(!state.sameLineSelection&&lines.length)state.sameLineSelection=lines[0];
    $('questionDeck').innerHTML=(rewardless?`<div class="status-box warn question-rewardless"><strong>Turntables</strong> · next ${rewardless} answered question${rewardless===1?'':'s'} award no cards.</div>`:'')+groups.map(([key,label])=>{
      const cards=cardsAll.filter(c=>c.category===key);if(!cards.length)return'';
      const html=cards.map(c=>{
        const frozen=state.role==='seeker'&&!!activeTurntablesAction(),isUsed=used.has(c.slot),locked=!!c.endgame_only&&!endgame,strategicLocked=['same_line','station_interchange'].includes(c.kind)&&askedCount<4,disabled=state.role!=='seeker'||isUsed||locked||strategicLocked||frozen||state.game?.status==='finished',preview=state.previewQuestionSlot===c.slot;let extra='',qstate=isUsed?'Asked':locked?'Endgame only':strategicLocked?`Unlocks after 4 questions · ${askedCount}/4`:frozen?'Frozen by Turntables':(state.role==='seeker'?'Available':'Not asked');
        if(c.kind==='thermometer'&&!isUsed&&!locked){const prog=thermometerProgress(c);if(prog){if(state.role==='seeker'&&prog.ready){extra='thermo-ready';qstate=`Ready · moved ${Math.round(prog.travelled)} m`; }else{extra='thermo-armed';qstate=state.role==='seeker'&&Number.isFinite(prog.travelled)?`Armed · ${Math.round(prog.travelled)}/${c.min_travel_m} m`:'Armed';}}}
        if(preview)extra+=` preview-active`;const reward=questionRewardMarkup(c,rewardless>0);
        if(c.kind==='same_line'&&!isUsed){
          const options=lines.map(r=>`<option value="${escapeHtml(r)}" ${state.sameLineSelection===r?'selected':''}>${escapeHtml(r)}</option>`).join('');
          return `<div class="question-card-shell ${disabled?'disabled':''} ${preview?'preview-active':''}"><div class="question-card-copy"><div><div class="q-category">${escapeHtml(c.category)}</div><div class="q-title">${escapeHtml(c.title)}</div><div class="q-detail">${escapeHtml(c.detail)}</div>${reward}</div><div class="q-state">${escapeHtml(qstate)}</div></div><div class="same-line-row"><select data-same-line-select="${c.slot}" ${disabled?'disabled':''}>${options}</select><button class="primary small" data-question-slot="${c.slot}" ${disabled?'disabled':''}>Ask</button></div></div>`;
        }
        return `<button class="question-card-button ${isUsed?'used':''} ${state.role==='hider'?'hider-view':''} ${extra}" data-question-slot="${c.slot}" ${disabled?'disabled':''}><div><div class="q-category">${escapeHtml(c.category)}</div><div class="q-title">${escapeHtml(c.title)}</div><div class="q-detail">${escapeHtml(c.detail)}</div>${reward}</div><div class="q-state">${escapeHtml(qstate)}</div></button>`;
      }).join('');
      return `<section class="question-group"><div class="question-group-title">${label}</div><div class="question-group-grid">${html}</div></section>`;
    }).join('');
    $('questionDeck').querySelectorAll('[data-same-line-select]').forEach(sel=>sel.addEventListener('change',()=>{state.sameLineSelection=sel.value;const p={question_kind:'same_line',line_refs:[sel.value]};previewQuestionGeometry(p);state.previewQuestionSlot='same-line';}));
    $('questionDeck').querySelectorAll('[data-question-slot]').forEach(b=>b.addEventListener('click',()=>{const c=cardsAll.find(x=>x.slot===b.dataset.questionSlot);if(c)handleQuestionCard(c).catch(handleError);}));
  }
'''
sub_once(r"  function renderQuestionDeck\(\)\{.*?\n  \}\n\n  function showTentacleCellPreview",new_deck+"\n  function showTentacleCellPreview",'question deck',re.S)

# Pending/activity attribution.
once("<strong>Question ${i+1} · ${escapeHtml(activityQuestionName(q))}</strong><span class=\"answer-pill pending\">Waiting</span></div><div class=\"meta\">${new Date(q.created_at).toLocaleTimeString()}</div>",
     "<strong>Question ${i+1} · ${escapeHtml(activityQuestionName(q))}</strong><span class=\"answer-pill pending\">Waiting</span></div><div class=\"meta\">${q.payload?.asked_by_initials?`Asked by ${escapeHtml(q.payload.asked_by_initials)} · `:''}${new Date(q.created_at).toLocaleTimeString()}</div>",'pending asker')
once("<strong>Question ${questionNumber.get(q.id)||'?'} – ${escapeHtml(activityQuestionName(q))}</strong>",
     "<strong>Question ${questionNumber.get(q.id)||'?'}${q.payload?.asked_by_initials?` · ${escapeHtml(q.payload.asked_by_initials)}`:''} – ${escapeHtml(activityQuestionName(q))}</strong>",'activity initials')
once("<div class=\"meta\">${new Date(q.created_at).toLocaleString()}${r?` · resolved",
     "<div class=\"meta\">${q.payload?.asked_by_name?`Asked by ${escapeHtml(q.payload.asked_by_name)} · `:''}${new Date(q.created_at).toLocaleString()}${r?` · resolved",'activity asker name')
once("if(a.kind==='time_trap_trigger')return `Time Trap triggered · ${p.station_name} · +${p.bonus_minutes} min`;",
     "if(a.kind==='time_trap_trigger')return `Time Trap ${p.auto_trigger?'auto-triggered':'triggered'} · ${p.station_name} · +${p.bonus_minutes} min${p.triggered_by_initials?` · ${p.triggered_by_initials}`:''}`;",'trap action label')

# Time Trap UI wording.
sub_once(r"  function renderTimeTraps\(\)\{.*?\n  \}\n\n  const SEEKER_CURSE_EFFECTS",r'''  function renderTimeTraps(){
    if(state.role!=='hider')return;$('timeTraps').innerHTML=state.timeTraps.length?state.timeTraps.map(t=>{const value=Number(t.current_bonus_minutes||t.bonus_minutes||t.base_bonus_minutes||5),base=Number(t.base_bonus_minutes||5),accrued=Math.max(0,value-base);return `<div class="question-item ${t.trigger_active?'time-trap-triggered':'time-trap-armed'}"><strong>${escapeHtml(t.station_name)}</strong><div class="meta">${t.trigger_active?`Triggered · locked at ${value} min`:`Current value ${value} min · ${base} base${accrued?` + ${accrued} accrued`:''} · +5 every 10 min · auto at 50 m`}</div><button class="${t.trigger_active?'secondary':'primary'} small full" data-trigger-trap="${t.id}" data-trap-active="${t.trigger_active?'false':'true'}">${t.trigger_active?'Undo trigger':'Trigger now'}</button></div>`;}).join(''):'<div class="mini-status">No Time Traps placed.</div>';
    $('timeTraps').querySelectorAll('[data-trigger-trap]').forEach(b=>b.addEventListener('click',()=>{const t=state.timeTraps.find(x=>x.id===b.dataset.triggerTrap);if(t)triggerTimeTrap(t,b.dataset.trapActive==='true').catch(handleError);}));
  }

  const SEEKER_CURSE_EFFECTS''','trap UI',re.S)
once("${active?'Its current bonus is added to the final score.':'The bonus is removed; the clock marker stays on the map.'}","${active?'Its current value (5 min base + 5 min per complete 10 minutes armed) is added to the final score.':'The bonus is removed; the clock marker stays on the map.'}",'trap confirm text')

# Reload multi-player positions and render layers.
once("    deriveLocalState();await recomputePossibleArea();renderAll();scheduleHeavyGeometryWarmups();",
     "    await refreshSeekerPositions({force:true});deriveLocalState();await recomputePossibleArea();renderAll();scheduleHeavyGeometryWarmups();",'reload positions')
once("function renderAll(){renderQuestionDeck();renderPendingQuestions();renderCurseDraws();renderTimeTraps();renderActiveCurses();renderActivity();renderPossibleArea();renderHiderSecret();renderSeekerLiveForHider();renderSeekerEndgame();",
     "function renderAll(){renderQuestionDeck();renderPendingQuestions();renderCurseDraws();renderTimeTraps();renderActiveCurses();renderActivity();renderPossibleArea();renderHiderSecret();renderPlayerPositions();renderSeekerEndgame();",'render players')

# Timer: no 1-second question-deck destruction; only re-render on Turntables freeze transition.
old_timer="  function startTimers(){clearInterval(state.timerId);state.timerId=setInterval(()=>{if(state.game){const a38=!!activePassierscheinAction();if(state.passierscheinWasActive&&!a38){state.passierscheinWasActive=false;recomputePossibleArea().then(()=>{renderPossibleArea();renderActivity();}).catch(console.warn);}else if(a38)state.passierscheinWasActive=true;renderActiveCurses();renderTimeTraps();renderGameClock();renderAnswerDeadlines();renderTurntablesPanel();renderTurntablesFreezeControls();if(state.role==='hider')renderSeekerLiveForHider();if(state.role==='seeker')renderQuestionDeck();applyDeveloperPreviewReadOnly();}},1000);}" 
new_timer="  function startTimers(){clearInterval(state.timerId);state.lastTurntablesFrozen=!!activeTurntablesAction();state.timerId=setInterval(()=>{if(state.game){const a38=!!activePassierscheinAction();if(state.passierscheinWasActive&&!a38){state.passierscheinWasActive=false;recomputePossibleArea().then(()=>{renderPossibleArea();renderActivity();}).catch(console.warn);}else if(a38)state.passierscheinWasActive=true;renderActiveCurses();renderTimeTraps();renderGameClock();renderAnswerDeadlines();renderTurntablesPanel();renderTurntablesFreezeControls();refreshSeekerPositions().catch(()=>{});const frozen=!!activeTurntablesAction();if(frozen!==state.lastTurntablesFrozen){state.lastTurntablesFrozen=frozen;renderQuestionDeck();}applyDeveloperPreviewReadOnly();}},1000);}" 
once(old_timer,new_timer,'stable timer deck')

# Developer Players tab + player runs.
once("    $('developerQuestionsTab').classList.toggle('hidden',name!=='questions');\n    $('developerGamesTab').classList.toggle('hidden',name!=='games');",
     "    $('developerQuestionsTab').classList.toggle('hidden',name!=='questions');\n    $('developerPlayersTab').classList.toggle('hidden',name!=='players');\n    $('developerGamesTab').classList.toggle('hidden',name!=='games');",'developer tab players')

dev_players=r'''  function renderDeveloperPlayers(players,runs){
    state.developerPlayers=players||[];state.developerPlayerRuns=runs||[];const by=new Map(state.developerPlayers.map(p=>[String(p.player_id),p]));
    $('developerPlayers').innerHTML=state.developerPlayers.length?state.developerPlayers.map(p=>{const pr=state.developerPlayerRuns.filter(r=>String(r.player_id)===String(p.player_id)).sort((a,b)=>Number(b.duration_seconds||0)-Number(a.duration_seconds||0));return `<div class="developer-player"><div class="row-between"><div><strong>${escapeHtml(p.name)}</strong> <span class="player-initials-pill">${escapeHtml(p.initials)}</span></div><span class="mini-status">${pr.length} Hider run${pr.length===1?'':'s'}</span></div><div class="player-runs">${pr.length?pr.map(r=>`<div class="player-run"><div><strong>${formatCountdown(Number(r.duration_seconds||0))}</strong><span>${new Date(r.created_at).toLocaleDateString()} · ${escapeHtml(r.game_name)} · ${escapeHtml(r.status)}</span></div><button class="secondary small" data-player-run="${r.game_id}">Open</button></div>`).join(''):'<div class="mini-status">No Hider runs yet.</div>'}</div></div>`;}).join(''):'<div class="status-box">No players yet.</div>';
    $('developerPlayers').querySelectorAll('[data-player-run]').forEach(b=>b.addEventListener('click',()=>enterDeveloperGame(b.dataset.playerRun,'hider').catch(handleError)));
  }
  async function adminCreatePlayer(){const name=$('developerPlayerName').value.trim();if(!name)return toast('Enter a player name.');const {error}=await state.supabase.rpc('admin_create_player_v1',{p_password:state.developerPassword,p_name:name});if(error)throw error;$('developerPlayerName').value='';await loadDeveloperDashboard();await loadPlayers();showDeveloperTab('players');}

'''
once("  async function developerLogin(){\n",dev_players+"  async function developerLogin(){\n",'developer player functions')

old_dash=r'''    const [gamesRes,refsRes,cardsRes,questionsRes]=await Promise.all([
      state.supabase.rpc('admin_list_games_v1',{p_password:state.developerPassword}),
      state.supabase.from('reference_datasets').select('dataset_key,source,content_hash,updated_at,checked_at').order('dataset_key'),
      state.supabase.rpc('admin_list_cards_v5',{p_password:state.developerPassword}),
      state.supabase.rpc('admin_list_questions_v1',{p_password:state.developerPassword})
    ]);
    if(gamesRes.error)throw gamesRes.error;if(refsRes.error)throw refsRes.error;if(cardsRes.error)throw cardsRes.error;if(questionsRes.error)throw questionsRes.error;
    renderDeveloperGames(gamesRes.data||[]);renderReferenceStatus(refsRes.data||[]);renderDeveloperCards(cardsRes.data||[]);renderDeveloperQuestions(questionsRes.data||[]);
'''
new_dash=r'''    const [gamesRes,refsRes,cardsRes,questionsRes,playersRes,runsRes]=await Promise.all([
      state.supabase.rpc('admin_list_games_v1',{p_password:state.developerPassword}),
      state.supabase.from('reference_datasets').select('dataset_key,source,content_hash,updated_at,checked_at').order('dataset_key'),
      state.supabase.rpc('admin_list_cards_v5',{p_password:state.developerPassword}),
      state.supabase.rpc('admin_list_questions_v1',{p_password:state.developerPassword}),
      state.supabase.rpc('admin_list_players_v1',{p_password:state.developerPassword}),
      state.supabase.rpc('admin_list_player_runs_v1',{p_password:state.developerPassword})
    ]);
    if(gamesRes.error)throw gamesRes.error;if(refsRes.error)throw refsRes.error;if(cardsRes.error)throw cardsRes.error;if(questionsRes.error)throw questionsRes.error;if(playersRes.error)throw playersRes.error;if(runsRes.error)throw runsRes.error;
    renderDeveloperGames(gamesRes.data||[]);renderReferenceStatus(refsRes.data||[]);renderDeveloperCards(cardsRes.data||[]);renderDeveloperQuestions(questionsRes.data||[]);renderDeveloperPlayers(playersRes.data||[],runsRes.data||[]);
'''
once(old_dash,new_dash,'developer dashboard players')

# Game entry identity display and automatic local/live GPS.
once("    $('roleKicker').textContent=`${state.role.toUpperCase()}${state.developerPreview?' · DEV PREVIEW':''}`; $('gameTitle').textContent=state.game.name;",
     "    $('roleKicker').textContent=`${state.role.toUpperCase()}${state.currentPlayer?` · ${state.currentPlayer.initials}`:''}${state.developerPreview?' · DEV PREVIEW':''}`; $('gameTitle').textContent=state.game.name;",'role identity')
once("    await syncServerClock(); subscribeRealtime(); startTimers(); setTimeout(()=>{try{ensureGeometryWorker();}catch(e){console.warn('Geometry worker warm-up unavailable',e);}},0); await reloadGameState();",
     "    await syncServerClock(); subscribeRealtime(); startTimers();if(!state.developerPreview)startGpsAutoTracking(); setTimeout(()=>{try{ensureGeometryWorker();}catch(e){console.warn('Geometry worker warm-up unavailable',e);}},0); await reloadGameState();",'auto GPS on enter')

# Leave/open/bind identity.
once("Object.assign(state,{role:null,game:null,hiderPassword:null,secret:null,actions:[]", "Object.assign(state,{role:null,game:null,hiderPassword:null,secret:null,currentPlayer:null,seekerPositions:[],actions:[]",'leave player reset')
once("function openLobby(role){$('hiderLobby').classList.toggle('hidden',role!=='hider');$('seekerLobby').classList.toggle('hidden',role!=='seeker');$('lobbyKicker').textContent=role.toUpperCase();$('lobbyTitle').textContent=role==='hider'?'Create or open a game':'Choose a game';showView('lobbyView');(async()=>{try{if(role==='hider')await setupCreateMap();await loadGames();}catch(e){handleError(e);}})();}",
     "function openLobby(role){$('hiderLobby').classList.toggle('hidden',role!=='hider');$('seekerLobby').classList.toggle('hidden',role!=='seeker');$('lobbyKicker').textContent=role.toUpperCase();$('lobbyTitle').textContent=role==='hider'?'Create or open a game':'Choose a game';showView('lobbyView');(async()=>{try{await loadPlayers();if(role==='hider')await setupCreateMap();await loadGames();}catch(e){handleError(e);}})();}",'lobby players')
once("$('developerImportCache').addEventListener('click',importBrowserReferenceCache);$('developerAddCard').addEventListener('click',addDeveloperCardForm);$('developerAddQuestion').addEventListener('click',()=>addDeveloperQuestionForm());",
     "$('developerImportCache').addEventListener('click',importBrowserReferenceCache);$('developerAddCard').addEventListener('click',addDeveloperCardForm);$('developerAddQuestion').addEventListener('click',()=>addDeveloperQuestionForm());$('developerAddPlayer').addEventListener('click',()=>adminCreatePlayer().catch(handleError));",'bind add player')
once("$('openHiderGameButton').addEventListener('click',()=>enterHider($('hiderGameSelect').value,$('openPassword').value).catch(handleError));",
     "$('openHiderGameButton').addEventListener('click',()=>{const p=selectedPlayerFrom('hiderOpenPlayerSelect');if(p)enterHider($('hiderGameSelect').value,$('openPassword').value,p.player_id).catch(handleError);});",'bind hider player')
once("  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&state.gpsAutoEnabled&&Date.now()-state.lastGpsUpdateMs>=30*60*1000)refreshGpsAutoPosition();});",
     "  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&state.game&&state.gpsAutoEnabled&&Date.now()-state.lastGpsUpdateMs>=10000)refreshGpsAutoPosition();});",'visibility GPS')

APP.write_text(s)

# HTML: player selectors + Developer Players tab/version/cache bust.
idx=IDX.read_text()
def idx_once(old,new,label):
    global idx
    n=idx.count(old)
    if n!=1: raise SystemExit(f'index {label}: expected 1, got {n}')
    idx=idx.replace(old,new,1)
idx_once('<label>Hider password<input id="createPassword" type="password" minlength="4" maxlength="100" placeholder="At least 4 characters" /></label>', '<label>Hider password<input id="createPassword" type="password" minlength="4" maxlength="100" placeholder="At least 4 characters" /></label>\n            <label>Hider player<select id="hiderCreatePlayerSelect"><option value="">Loading players…</option></select></label>', 'create player')
idx_once('<label>Game<select id="hiderGameSelect"></select></label>\n            <label>Hider password', '<label>Game<select id="hiderGameSelect"></select></label>\n            <label>Hider player<select id="hiderOpenPlayerSelect"><option value="">Loading players…</option></select></label>\n            <label>Hider password', 'open player')
idx_once('<p class="hint strong">Choose an active game. Seekers do not need the hider password.</p>\n          <div id="gameList"', '<p class="hint strong">Choose your player identity, then enter an active game. Seekers do not need the hider password.</p>\n          <label>Seeker player<select id="seekerPlayerSelect"><option value="">Loading players…</option></select></label>\n          <div id="gameList"', 'seeker player')
idx_once('<button class="segment" data-developer-tab="questions">Questions</button>\n            <button class="segment" data-developer-tab="games">Games</button>', '<button class="segment" data-developer-tab="questions">Questions</button>\n            <button class="segment" data-developer-tab="players">Players</button>\n            <button class="segment" data-developer-tab="games">Games</button>', 'players tab')
players_panel='''\n          <div id="developerPlayersTab" class="developer-tab-panel hidden">\n            <section class="panel">\n              <div class="row-between"><div><div class="eyebrow">PLAYERS</div><h3>Player database &amp; Hider runs</h3></div></div>\n              <div class="developer-player-create"><input id="developerPlayerName" maxlength="100" placeholder="Full player name"><button id="developerAddPlayer" class="primary">Create player</button></div>\n              <p class="hint">Initials are generated automatically. Hider runs are sorted longest to shortest and can be reopened read-only.</p>\n              <div id="developerPlayers" class="developer-player-list"></div>\n            </section>\n          </div>\n\n'''
idx_once('          <div id="developerGamesTab" class="developer-tab-panel hidden">',players_panel+'          <div id="developerGamesTab" class="developer-tab-panel hidden">','players panel')
idx=idx.replace('BUILD 3.13.4','BUILD 3.13.5').replace('styles.css?v=3.13.4','styles.css?v=3.13.5').replace('app.js?v=3.13.4','app.js?v=3.13.5')
IDX.write_text(idx)

# CSS additions only; no existing layout behavior removed.
css=CSS.read_text()
css += r'''

/* v3.13.5 player identity, location markers, rewards */
.own-location-marker { background:transparent; border:0; }
.own-location-marker span { display:block; width:22px; height:22px; margin:1px; border-radius:50%; background:#4285f4; border:3px solid #fff; box-shadow:0 1px 5px rgba(0,0,0,.35),0 0 0 1px #1a73e8; }
.player-location-marker { background:transparent; border:0; }
.player-location-marker span { display:grid; place-items:center; width:28px; height:28px; border-radius:50%; color:#fff; border:2px solid #fff; font-size:10px; font-weight:950; letter-spacing:.02em; }
.player-location-marker.red span { background:#ff1744; box-shadow:0 0 0 2px #ff1744,0 0 12px rgba(255,23,68,.65); }
.player-location-marker.green span { background:#00c853; box-shadow:0 0 0 2px #00a844,0 0 9px rgba(0,200,83,.48); }
.q-reward { margin-top:8px; width:max-content; max-width:100%; padding:4px 7px; border-radius:999px; background:#eef2ff; color:#3730a3; font-size:10px; font-weight:850; line-height:1.2; }
.q-reward.suppressed { background:#fef3c7; color:#92400e; }
.question-card-shell .q-reward { margin-bottom:2px; }
.developer-player-create { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:8px; align-items:center; margin:12px 0; }
.developer-player-create input { margin:0; }
.developer-player-list { display:grid; gap:10px; }
.developer-player { border:1px solid var(--line); border-radius:13px; padding:12px; background:#fff; }
.player-initials-pill { display:inline-grid; place-items:center; min-width:28px; height:24px; padding:0 7px; border-radius:999px; background:#e0e7ff; color:#3730a3; font-size:11px; font-weight:900; }
.player-runs { display:grid; gap:6px; margin-top:9px; }
.player-run { display:flex; align-items:center; justify-content:space-between; gap:8px; border-top:1px solid #eef2f7; padding-top:7px; }
.player-run div { display:grid; gap:2px; }
.player-run span { color:var(--muted); font-size:11px; }
@media (max-width:560px){.developer-player-create{grid-template-columns:1fr}.player-run{align-items:flex-start}}
'''
CSS.write_text(css)
print('v3.13.5 UI/app patch applied')
