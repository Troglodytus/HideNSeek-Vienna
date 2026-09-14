# Hide & Seek: Vienna — v3.8.0

Incremental update on top of v3.7.0.

## Changes

- **Current Street Shape keeps true map orientation.** North remains up/east remains right; only the line stroke is jittered/hand-drawn.
- **Zoo + Aquarium are one Tentacle.** The `Zoos / Aquariums` category merges both existing reference datasets and new Zoo refreshes query both OSM tags.
- **Amusement Parks are hidden from gameplay and Developer refresh menus.** Existing Supabase/reference rows remain untouched for compatibility.
- Photo prompts remove street/transit-sign clues and add **Closest street light / lamp**.
- `Across the Danube?` is now **In Mordor?** with the text `Is the target across the Danube in district 21 or 22?`.
- Added Vienna Mixed questions using the existing landmark comparison mechanic:
  - Closer to Schönbrunn?
  - Closer to Donauturm?
  - Closer to the Riesenrad?
- Developer mode now has tabs for **Reference data**, **Card deck**, and **Games**.
- The Card deck tab lists every physical card in `curse_cards` and allows editing title, card text, duration, whether it is in the deck, and casting cost.
- Casting-cost modes: **None**, **Time bonus** (5–120 min dropdown), or **Custom** free-text requirement.
- Add new custom curse cards or remove cards from the finite catalogue. Catalogue changes affect future draws/reshuffles; already drawn card snapshots in running games are unchanged.

## Upgrade from v3.7.0

1. Run `supabase-v3.8.0-migration.sql` once in the Supabase SQL Editor.
2. Replace `app.js`, `index.html`, and `styles.css` in GitHub Pages.
3. Keep your existing working `config.js`.
4. Commit/push and hard-refresh the site.
5. Verify Developer shows **BUILD 3.8.0**.

No Vienna reference-data refresh is required. If you later refresh **Zoos / Aquariums**, the new `vienna_poi_zoo_v1` dataset will contain both categories; until then gameplay merges your existing Zoo and Aquarium datasets automatically.

## Card editor behavior

Each database row is one physical card. Removing a card removes it from future shuffled decks. Disabling `In deck` keeps the row but excludes it from future reshuffles. Existing draws are JSON snapshots, so edits do not retroactively rewrite a card already drawn into a running game.

New cards created in the UI are generic public **curse/rule cards** (`custom_rule`). If they have no duration, their public curse chip lasts until the next Seeker question; if a duration is selected, the normal countdown is used.
