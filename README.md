# Vienna Hide & Seek v3.3.0

This release removes normal gameplay's dependency on live Overpass requests once reference data has been seeded.

## Architecture

- GitHub Pages: frontend
- Supabase: games, secrets, actions, cards, admin functions **and shared Vienna reference datasets**
- Stadt Wien OGD: authoritative Vienna district geometry when the developer refreshes it
- OpenStreetMap / Overpass: station, transit-network and Tentacle POI source **only during developer refresh/fallback**

## Upgrade from v3.2.x

1. In Supabase SQL Editor run `supabase-v3.3.0-migration.sql` once.
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
