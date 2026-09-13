# Vienna Hide & Seek v3.5.0

This release builds directly on v3.4.0 and adds richer question previews, a less noisy activity log, Seeker curse alerts, photo questions, per-question answer deadlines/penalties, and a redesigned Thermometer/Tentacle workflow.

## Upgrade from v3.4.0

1. Run `supabase-v3.5.0-migration.sql` **once** in Supabase SQL Editor.
2. Keep your existing working `config.js` with the `sb_publishable_...` key.
3. Replace `app.js`, `index.html`, and `styles.css` in GitHub.
4. Commit/push, hard-refresh, and verify **BUILD 3.5.0** in Developer mode.
5. Existing Vienna reference datasets/chunks remain valid; do not redownload them for this update.

The migration creates a private `game-photos` Supabase Storage bucket, protected one-time upload tickets, photo-read policies, new question/answer RPCs, and per-card Thermometer-start RPCs.

## Question previews

- **Radar:** the proposed Radar circle is filled/highlighted yellow before confirmation.
- **Same District:** the complete current Bezirk polygon is highlighted yellow before confirmation.
- **Thermometer:** the travel segment plus the **perpendicular bisector** used for the actual WARMER/COLDER cut are shown in yellow before sending.
- These preview geometries depend only on Seeker-selected positions and public map/reference data; they never use the secret Hider target.

## Thermometers

There is no separate "Thermometer start" panel anymore. Each Thermometer card is its own two-stage control:

1. First tap selects the Seeker location and asks for confirmation to start that Thermometer.
2. The card stays **red** while the required 250 m / 500 m / 2 km has not been reached.
3. Once the current Seeker marker is far enough away, the card turns **green**.
4. Tapping the green card gets the current location, shows the perpendicular cut preview, and asks for confirmation before sending the question.

Each Thermometer distance has its own stored starting point.

## Tentacles

Tentacles now use an explicit preview-first interaction:

1. First tap loads the cached POI category and shows every candidate POI in the current possible area.
2. The card is highlighted while previewing.
3. Tap the same card again to open the Ask/Cancel confirmation.
4. Selecting any other question cancels the Tentacle preview and removes its POI markers.

Normal gameplay still reads these POIs from the shared Supabase reference cache; it does not run large live Overpass queries.

## Photo questions

The question deck includes:

- Biggest body of water
- Highest visible structure
- Selfie
- At least 4 houses in one image

The Hider receives a normal pending question with a 15-minute response timer and can choose an image from the phone camera roll. The original selected file (up to 25 MB) is uploaded to a **private Supabase Storage bucket**.

Uploads use a short-lived, one-time server-issued path ticket. The Hider password is checked before the ticket is issued, and the upload ticket itself is never published in the activity log. Seekers receive read access only after the uploaded path has been committed as a photo answer.

The grouped Activity entry shows a thumbnail. Tapping the thumbnail opens the original uploaded image via a temporary signed URL.

## Hider response deadline and penalties

Every question starts its own server-timestamped response timer when the Seeker sends it:

- first **15 minutes:** no penalty;
- every **full additional 10 minutes:** `-20 min` from the eventual run time;
- each question is calculated independently;
- answering, manual Veto, and automatic Tentacle Veto all resolve the response timer, so a late Veto cannot bypass the penalty.

The Hider pending-question panel shows a live countdown/overdue counter. The main game clock remains the raw synchronized elapsed time; a smaller line below it shows accumulated answer penalties and the currently penalty-adjusted time.

## Incoming Seeker curses

Active Seeker-targeting curses are shown as compact chips **directly above the map**, with one countdown per curse. Multiple simultaneous curses are all displayed.

When a new curse arrives while the Seeker is in the game, the app also plays a short warning tone and shows a toast. The browser audio context is primed on user interaction; as with all browser audio, OS/browser autoplay restrictions can still suppress sound in some background/suspended states.

## Activity log

Question and resolution are now one grouped entry rather than two separate rows. Examples:

- `Question – District = Ottakring` → `False`
- `Question – Hospital Tentacle` → `Vetoed`
- `Question – Photo – Biggest body of water` → photo thumbnail

Thermometer-start helper actions are hidden from the public activity list. Curse/time-trap actions remain visible chronologically. Undo/Redo controls are smaller, but still use the existing confirmation popup before anything changes.

## Question-menu organization

Both Hider and Seeker see the same grouped structure:

- Mixed
- Radars
- Thermometers
- Tentacles
- Photo questions

Asked cards remain greyed out on both screens.

## Retained v3.4 behavior

- synchronized Start/Pause game clock;
- ~30-minute Seeker GPS refresh while the tab is active, visible only to the Hider;
- Hider location/station/final hiding point never exposed to Seeker mode;
- line-coloured, zoom-aware station markers;
- finite per-game shuffled card deck;
- exactly 5×5 min, 4×10 min, 3×15 min, 2×20 min time-bonus cards;
- hand/discard model and casting costs such as Express Route = 15 minutes.

# Vienna Hide & Seek v3.3.4

This hotfix changes reference-data refreshes to a resumable, chunked workflow. Vienna is split into a 4×4 grid (16 tiles). Each successful tile is immediately saved as its own row in the existing Supabase `reference_datasets` table. No new SQL migration is required if v3.3.0 was already installed.

- Core transit refresh: U-/S-Bahn line geometry, U-Bahn stops and public-transport stops are fetched tile-by-tile from Stadt Wien WFS and stored immediately. Once all tile chunks exist, they are assembled into `vienna_stations_v1` and `vienna_transit_v1`.
- Tentacle POIs: each category is refreshed tile-by-tile. Official Vienna WFS is preferred where available; a small-bbox Overpass query is used as fallback. The aggregate POI dataset is assembled only when all 16 chunks exist, preventing an incomplete Tentacle dataset from silently becoming authoritative.
- Refreshes are resumable: fresh chunks are skipped for seven days. A timeout therefore does not discard completed work.
- Gameplay no longer falls back to large live WFS/Overpass requests when reference data are missing; it asks you to seed/resume the Developer cache instead.

Update `app.js` + `index.html`; keep the existing `config.js`. No SQL migration is needed for this version.

# Vienna Hide & Seek MVP v3.3.2

Hotfix over v3.3.1:
- Visible build number in Developer mode so deployed JS can be verified.
- District refresh now prefers the official City of Vienna ArcGIS Bezirksgrenzen feature layer (WGS84 GeoJSON), with WFS fallback.
- Correct Park layer: `PARKANLAGEOGD` (not `PARKINFOOGD`).
- Core Vienna reference data continue to be stored in Supabase and reused by all clients.
- U-/S-Bahn line references are retained on line/station records for the planned Same Line question.

# Vienna Hide & Seek v3.3.1

This release removes normal gameplay's dependency on live Overpass requests once reference data has been seeded.

## Architecture

- GitHub Pages: frontend
- Supabase: games, secrets, actions, cards, admin functions **and shared Vienna reference datasets**
- Stadt Wien OGD: authoritative Vienna district geometry when the developer refreshes it
- OpenStreetMap / Overpass: station, transit-network and Tentacle POI source **only during developer refresh/fallback**

## Upgrade from v3.2.x

1. In Supabase SQL Editor run `supabase-v3.3.1-migration.sql` once.
2. Set a strong developer password directly in Supabase SQL Editor (do NOT save the real password in GitHub):

```sql
update public.app_admin
set password_hash=extensions.crypt('YOUR-STRONG-DEVELOPER-PASSWORD',extensions.gen_salt('bf',10))
where id=1;
```

3. Keep your existing `config.js` with the correct project URL and `sb_publishable_...` key.
4. Replace frontend files (`app.js`, `index.html`, `styles.css`) and optionally README/migration files.
5. Commit and push in GitHub Desktop.
6. Open the game and use the small **Developer** button on the home page.

## Seed the shared Vienna cache

After logging into Developer:

- **Import this browser's existing cache**: quickest option if this browser already successfully loaded stations/transit in v3.2.x.
- **Refresh districts + stations + network**: downloads the official Vienna districts plus OSM station/network data and saves them to Supabase.
- **Refresh Tentacle POIs**: saves museums, parks, libraries, cinemas, hospitals, zoos, aquariums and amusement parks.
- **Refresh everything**: does both.

Normal Hider/Seeker sessions then read these datasets from Supabase and do not need Overpass for startup.

Refresh uses a SHA-256 content hash. If the newly downloaded dataset has the same hash, only its `checked_at` timestamp changes; otherwise the saved payload and `updated_at` are replaced.

## Developer game management

Developer mode lists all games and permits:

- renaming a game;
- changing active/finished status;
- permanently deleting a game and all cascading game data.

The developer password is validated server-side and stored only as a bcrypt hash.

## Current-position controls

Both Hider and Seeker now have a Current Position panel:

- Use phone GPS
- Set on map
- Clear
- drag the map marker after placing it

For Seekers, manual question mode uses this current-position marker. GPS question mode gets a fresh GPS reading when the question is chosen and updates the marker.

For Hiders, the current-position marker stays local/private. During Endgame preparation it can be copied into the proposed final hiding spot.

## Vienna districts

Developer refresh prefers the City of Vienna official district GeoJSON service. The app accepts a district dataset only when it contains exactly district numbers 1 through 23.

OSM `admin_level=9` remains a fallback because this is the documented OSM level for Vienna Gemeindebezirke.


## v3.3.1 data-source hotfix

- Districts now use the current City of Vienna WFS `BEZIRKSGRENZEOGD` endpoint directly.
- U-Bahn/S-Bahn line geometry now uses City of Vienna WFS `OEFFLINIENOGD`.
- Station candidates use `UBAHNHALTOGD` + `OEFFHALTESTOGD` and are matched to U/S line geometry; saved stations include a `lineRefs` array for future same-line questions.
- Museums, parks, libraries and hospitals use City of Vienna WFS layers instead of Overpass.
- Remaining OSM-only Tentacle categories use a fixed Vienna bounding-box Overpass query instead of an Overpass area lookup.
- Reference refresh continues through individual POI failures instead of aborting the entire job.
- No new Supabase migration is needed beyond the v3.3.0 migration.


## v3.3.4 transport finalization fix
The chunk downloads were completing, but the browser could freeze while assembling the transport cache because older code tested every public-transport stop against every U-/S-Bahn geometry. This build uses Vienna's own `LINFO` (U-Bahn) and `HLINIEN` (S-Bahn) attributes instead. Existing 16/16 raw chunks are reused; no redownload is needed while they are fresh.
