# Vienna Hide & Seek v3.2.1

Frontend-only hotfix/update from v3.2.0. **No new Supabase SQL migration is required.**

## Important Supabase configuration
Use the Project API URL (`https://PROJECTREF.supabase.co`) and an `sb_publishable_...` key. Never commit an `sb_secret_...` or `service_role` key.

## v3.2.1 changes
- validates the Supabase URL/key and rejects Dashboard URLs or secret keys with a clear error;
- uses OpenFreeMap Positron vector tiles through MapLibre/Leaflet and hides all symbol/label layers for a clean no-label basemap;
- loads actual U-Bahn route relations (U-lines) and S-Bahn route relations, plus subdued physical ÖBB/passenger rail track geometry;
- stronger transit line styling;
- Endgame location controls are hidden during the station phase. The hider only reveals them by pressing “Seekers reached my station — prepare Endgame”;
- game creation still asks only for the secret station.

This version is a frontend + small database migration update over v3.1.x.

## Main changes

### Transit map cleanup
- Selectable hiding stations are now limited to **Vienna U-Bahn/subway and passenger railway stations**.
- Tram/light-rail tracks are no longer requested for the overlay.
- Same-named OSM station elements are collapsed into **one station marker** instead of one marker per platform/OSM object.
- The Hider can choose the station either from a dropdown or by tapping the map.
- U-Bahn lines are drawn thicker in blue; ordinary railway/S-Bahn/ÖBB infrastructure is drawn thicker in dark grey/black.
- Station markers are larger and easier to tap.
- The creation map omits district boundaries and uses a pale no-label basemap first, with standard OSM fallbacks.
- Leaflet uses Canvas rendering for better responsiveness with the rail geometry.

### Corrected station-first / Endgame flow
Game creation now stores only:
1. game name/password;
2. secret hiding station.

The Hider **does not choose the final hiding coordinate at game creation**.

During Station Phase, all automatic Hider answer previews use the secret station coordinate.

Only when the Hider decides that the Seekers have actually reached the correct station does the Hider:
1. choose the real hiding location using phone GPS or by tapping the game map;
2. confirm **Start Endgame**.

The backend verifies that this location is inside the current station hiding radius (normally 250 m; Prosperous Home expansion is respected). It then stores that coordinate privately and changes the private phase to Endgame. Seekers receive no Endgame flag or notification.

Undoing Endgame returns question targeting to the station; the stored hiding coordinate remains private and can be reused/changed before entering Endgame again.

## IMPORTANT: existing v3.1.x Supabase project
Run **`supabase-v3.2-migration.sql`** once in Supabase -> SQL Editor before uploading the v3.2 frontend.

Do not create a new Supabase project.

The migration:
- makes `game_secrets.hidden_lat` / `hidden_lng` nullable;
- adds `create_game_v4`;
- adds `get_hider_game_v4`;
- adds `set_endgame_v4` with server-side hiding-radius validation.

`supabase.sql` is also updated as a complete rerunnable schema for a fresh install.

## GitHub update
Keep your existing configured `config.js` if you are updating manually.

Replace at least:
- `app.js`
- `index.html`
- `styles.css`
- `overpass-query.txt`

Commit and push with GitHub Desktop. `index.html` loads `app.js?v=3.2.0`, so the browser should not reuse the old JS cache.

## Basemap
The app first requests CARTO's light/no-label raster basemap to get the minimal white map requested for gameplay. If that tile source cannot be loaded, it automatically falls back to standard OpenStreetMap tiles with a muted/grayscale CSS treatment.

The app supports an optional `CARTO_BASEMAP_KEY` in `config.js`, but it is not required by the game logic. Your existing Supabase values remain unchanged.

## Transit data / OSM
Vienna uses fixed OSM identifiers:
- relation `109166`
- Overpass area `3600109166`

Station query categories:
- `railway=station|halt` + `station=subway`
- `railway=station|halt` + `subway=yes`
- passenger train stations (`train=yes`), excluding tram-tagged stations

Line overlay:
- `railway=subway`
- `railway=rail` excluding yard/siding/spur service tracks

No `railway=tram` or `railway=light_rail` ways are requested.