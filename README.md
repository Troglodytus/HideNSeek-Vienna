# Hide & Seek: Vienna — v3.9.0

Incremental update on top of v3.8.0.

## Changes

- Card catalogue is now **one row per card type** with a `Copies` dropdown instead of one row per physical duplicate.
- Existing v3.8 duplicate card rows are consolidated by the migration; the finite game deck still expands the configured copy counts when shuffled.
- Special engine-driven cards are separated below the normal deck editor: Prosperous Home, Duplicate, Fresh Shuffle, Time Trap, and Veto.
- Developer mode adds a **Questions** tab.
- Question definitions are stored in `question_catalog` and drive the live question deck.
- Question editor supports title/text/category/order/enabled/Endgame-only plus kind-specific parameters:
  - Radar radius
  - Thermometer movement distance
  - District sets
  - Landmark coordinates
  - Direction axis/labels
  - Tentacle POI category
  - Photo prompt
- Every question shows a **Rule / query preview** describing its internal spatial comparison or the Overpass/reference-data query used by the engine.
- Questions can be duplicated to make variants, added, disabled, edited, or removed.
- Developer reference rows now show stored/missing tile counts and tile IDs, with a **Retry missing** button per Tentacle category.
- Overpass retries are now per request with a short cooldown/backoff instead of poisoning all later tiles for five minutes after a 504/503.

## Upgrade from v3.8.0

1. Run `supabase-v3.9.0-migration.sql` once in the Supabase SQL Editor.
2. Replace `app.js`, `index.html`, and `styles.css` in GitHub Pages.
3. Keep your existing working `config.js`.
4. Commit/push and hard-refresh.
5. Verify Developer shows **BUILD 3.9.0**.

No Vienna reference-data refresh is required. Missing Cinema/Cemetery/Church/Zoo chunks can be resumed individually from **Developer → Reference data → Retry missing**.

## Card count behavior

`deck_count` is the number of physical copies used when a game deck is shuffled. Each generated physical copy receives a unique internal instance key, so two copies of the same catalogue card can be held/used independently. Already-drawn cards remain JSON snapshots and are not rewritten by catalogue edits.

## Question editor safety

The Developer editor does not execute arbitrary JavaScript from the database. New questions choose one of the supported rule engines and edit its parameters. This allows safe variants while keeping the Hider secret and database authorization logic outside editable client code.
