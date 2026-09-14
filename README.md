# Vienna Hide & Seek v3.7.0

Upgrade from v3.6.0.

## Install
1. Run `supabase-v3.7.0-migration.sql` once in Supabase SQL Editor.
2. Replace `app.js`, `index.html`, and `styles.css` in GitHub Pages.
3. Keep your existing working `config.js` with the Supabase publishable key.
4. Commit/push and hard-refresh. Developer mode should show **BUILD 3.7.0**.

## New / fixed
- Thermometer deduction now clips the current playable polygon against the same perpendicular half-plane shown in preview.
- Same Line uses an explicit U-/S-Bahn line dropdown instead of GPS proximity.
- Tentacles are Endgame-only, use POIs within 5 km of the Seeker, and use the Hider-to-Seeker 250 m rule. An automatic range veto removes the Seeker's 250 m circle.
- Added Cemetery/Graveyard and Church Tentacles. Seed those two datasets once in Developer mode.
- Added Endgame-only **Current Street Shape**. The Hider generates a label-free, rotated, hand-drawn PNG of the nearest street and sends it like a photo answer.
- Added Mixed questions: Across the Danube?, Inner Districts?, Closer to Stephansdom?
- Added additional official-inspired and Vienna-specific curses.

Existing Vienna districts, stations, transit, and previously seeded POI datasets do not need to be refreshed. Only Cemetery/Graveyard and Church are new reference datasets.
