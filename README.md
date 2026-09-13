# Vienna Hide & Seek — MVP v3.1

Mobile-first Hider/Seeker web app for Vienna. This revision adds a private two-stage target model, a 250 m station hiding zone, per-question GPS/manual origins, Jet Lag-style Radar/Thermometer/Tentacle rewards, Overpass-powered Tentacle previews, suggested hider answers, Veto/Duplicate/Time Trap mechanics, and a revised card deck.

## Core game model

### Two private hider targets
When a game is created, the hider must select:

1. **Hiding station** — a mapped rail/U-Bahn station. During the long game, question answers are calculated against this station coordinate.
2. **Actual hiding spot** — GPS or map-selected point no more than **250 m** from that station.

The hider has a private **Switch to endgame** button. Before it is pressed, the app's suggested answers use the station. After it is pressed, they use the actual hiding spot. The phase flag, station coordinate, and actual coordinate are all stored in `game_secrets`, which has no public SELECT policy. The seeker UI receives no phase value or endgame notification.

The hider can also undo the private phase switch and return to station-mode answering.

### Prosperous Home
The requested Vienna house rule is implemented as **double hiding area**, not double radius. Since area is proportional to r²:

- base radius = 250 m
- double area radius = 250 × √2 ≈ **353.6 m**

If multiple active Prosperous Home effects exist (e.g. through Duplicate), the area multiplier compounds.

## Seeker question origin

Every question uses its own seeker origin. Seekers choose one of two modes above the question deck:

- **Automatic current location** — obtains a fresh browser geolocation immediately before the question preview.
- **Choose manually on map** — after selecting a question, the seeker taps the map to choose that question's coordinate.

The confirmation dialog always shows the coordinate, source, and GPS accuracy when available. This is intentionally useful underground, where a manual station/platform coordinate may be more defensible than a degraded phone location.

Thermometers use a separately confirmed Point A. Seekers can set that point with GPS or a map tap.

## Question deck

### Radar — Draw 2, keep 1
- 20 km
- 10 km
- 5 km
- 1 km
- 500 m
- 100 m

### Thermometer — Draw 2, keep 1
- 250 m minimum movement
- 500 m minimum movement
- 2 km minimum movement

The app verifies that Point B is at least the card's minimum travel distance from the saved Point A.

### Matching — Draw 3, keep 1
- Same Vienna district

### Tentacles — Draw 4, keep 2
- Museums
- Parks (Vienna custom addition)
- Libraries
- Movie theaters
- Hospitals
- Zoos
- Aquariums
- Amusement parks

When a seeker selects a Tentacle:

1. The app calls Overpass for that POI type.
2. Results are cached in the browser for 24 hours.
3. The candidate list is all mapped POIs of that type whose representative point lies inside the **current remaining playable area**.
4. Those candidates are previewed on the map before confirmation and the exact list is stored with the question, so both sides use the same options.
5. Privately, the hider client finds which candidate POI is nearest to the current secret target (station during the normal phase, actual spot during endgame).
6. If the nearest candidate is **more than 250 m from the secret target**, the Tentacle is automatically vetoed after hider confirmation. This consumes no Veto card and awards no card draw.
7. Otherwise the public answer is only **“Hider is closest to [POI]”**. The private target-to-POI distance is never sent to seekers.
8. The deduction map is partitioned by nearest candidate POI (a Voronoi-style partition). The app keeps only the part of the already-active play area where the answered POI is at least as close as every other candidate, and greys out the rest.
9. The 250 m validity test is **not** additionally used as a 250 m clipping circle; it only decides whether the Tentacle can be answered or must be vetoed.

## Hider answer preview

Pending questions appear in the hider panel and also preview on the main map:

- Radar: radius circle + suggested HIT/MISS and calculated distance.
- Thermometer: A→B line + suggested WARMER/COLDER and both private-target distances.
- Same District: suggested YES/NO.
- Tentacle: all candidate POIs in the remaining zone + preselected nearest POI, or a private automatic-veto warning when every option is more than 250 m from the target.

The hider must confirm every result before it becomes public. Radar/Thermometer/District answers can still be manually chosen; for Tentacles the nearest qualifying POI is computed automatically and the hider confirms that answer or uses an available Veto card. Automatic Tentacle vetoes also require hider confirmation.

## Confirmations + undo/redo

Consequential actions require confirmation. Public actions remain in `game_actions` and are toggled with `is_active` rather than deleted.

Implemented public undo/redo includes:
- questions;
- hider answers;
- Thermometer reference points;
- played curses/cards;
- veto actions.

Private controls separately support:
- keeping/unkeeping cards;
- endgame phase switch/reversal;
- Time Trap trigger/untrigger.

## Card deck

The database seeds repeated physical card instances so drawing remains **without replacement**. Every card that appears in a draw leaves the deck for that game, whether kept or discarded.

Implemented card families:

### Time bonuses
- 5 min
- 10 min
- 15 min
- 20 min
- 30 min

Unused held time bonuses are summed in the Hider hand display.

### Veto Question
If the hider has an unused Veto in hand, every pending question displays **Use Veto Question**. Veto consumes the card, publishes that the question was vetoed, sends no answer, and leaves that question card used/greyed-out.

### Duplicate
Current MVP behavior:
- can copy another held **time bonus**; the copied bonus is added privately while the original remains;
- can copy another held **curse**; the copied curse is played while the original remains.

Veto and Time Trap duplication are intentionally not enabled yet because they require additional private-choice state.

### Time Trap
The hider plays the card by tapping a station marker. Placement is private. Its current value is:

`base bonus + 10 minutes × full hours armed`

The hider manually presses **Trigger now** when the seekers actually pass through that station. Triggering publishes the station and awarded bonus to the seekers. It can be undone/redone from the private Time Trap panel.

### Curse of the Gambler's Feet
Seeded as a 60-minute curse. The physical die/casting result is currently a social/manual part of play; the synchronized timer is handled by the app.

### Curse of the Impenetrable Fog
60-minute synchronized timer.

### Curse of the Express Route
30-minute synchronized timer; the UI text reminds players that reaching the line terminus ends the restriction first.

### Curse of the Prosperous Home
Persistent until undone. Expands the legal station-buffer map using the double-area Vienna rule above.

## Timers

Timed card actions use server-created `starts_at` and `ends_at` timestamps. Clients synchronize against the Supabase server clock, so hider and seeker screens count toward the same end time even after reloads.

## Database upgrade

Run **the entire `supabase.sql`** in Supabase SQL Editor.

v3/v3.1 adds/migrates:
- protected station coordinate/name and `endgame` flag in `game_secrets`;
- extended `game_actions` kinds;
- richer card metadata;
- multi-keep card draws (`kept_card_keys` / `used_card_keys`);
- `private_card_uses` for private Duplicate bonus state;
- `time_traps` for secret trap placement;
- `auto_veto_tentacle_v3` for no-card Tentacle vetoes when no candidate lies within 250 m of the secret target.

The file is designed to be rerunnable after v2. It replaces the old generic starter card catalogue; existing draw JSON remains self-contained.

After running SQL, configure `config.js`:

```js
window.HNS_CONFIG = {
  SUPABASE_URL: "https://your-project.supabase.co",
  SUPABASE_ANON_KEY: "your-anon-or-publishable-key",
  OVERPASS_ENDPOINT: "https://overpass-api.de/api/interpreter",
  OSM_CACHE_HOURS: 168
};
```

Never put a Supabase `service_role` key in browser code.

## Local test

```bash
cd jetlag-vienna-mvp
python -m http.server 8080
```

Open `http://localhost:8080` on the computer. Phone geolocation needs an HTTPS deployment in normal browser use.

## GitHub Pages / Weebly

The recommended hosting arrangement is still:

**Weebly landing page → GitHub Pages app → Supabase**

The app itself should be served from HTTPS. It can then be linked from Weebly or embedded in an iframe with `allow="geolocation"`; a direct top-level link is preferable for reliable iPhone geolocation.

## Important current limitations

- The station set is based on OSM `railway=station` / `railway=halt`. A later Vienna-specific whitelist should define exactly which Wiener Linien / ÖBB / WLB stations count.
- The public deduction polygon does not reveal the private phase. That is deliberate. Suggested answers are calculated correctly against the private station/actual target, but the visible geometric elimination remains a neutral answer-based approximation rather than exposing which target basis was used.
- Park Tentacles are a Vienna-specific addition; the other Tentacle categories/distances follow the published Hide + Seek-style categories used by the show/home-game community.
- Several real card **casting costs** still require social/manual enforcement. The app currently concentrates on secret/public state, card consumption, shared timers, Veto, Duplicate, Time Trap, and Prosperous Home geometry.
- Time Trap triggering is manual because a browser cannot reliably infer every station the seekers pass through without continuous background tracking.
- Public Overpass is suitable for a private game. A larger deployment should pre-generate Vienna rail and POI data or use dedicated Overpass infrastructure.

This is an unofficial fan implementation and is not affiliated with Jet Lag: The Game.
