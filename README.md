# Vienna Hide & Seek v3.6.0

Upgrade from v3.5.0.

## Update
1. Run `supabase-v3.6.0-migration.sql` once in Supabase SQL Editor.
2. Replace `app.js`, `index.html`, and `styles.css` in the GitHub Pages repository.
3. Keep the existing working `config.js` with the Supabase **publishable** key.
4. Commit/push, hard-refresh, and verify **BUILD 3.6.0** in Developer mode.

No Vienna reference-data refresh is required.

## v3.6 changes
- Thermometer answers now retain the correct Warmer/Colder half-plane.
- Time Traps are public station markers from placement onward.
- Ongoing questions sit above the grouped question deck.
- Activity is chronological and question/answer pairs remain grouped.
- Hider always sees the current hiding-zone disk.
- Prosperous Home previews and dynamically expands the zone; Duplicate stacks it.
- Seekers can manually start/change their Endgame station zone without learning the Hider secret.
- Added Same U-/S-Bahn Line, directional questions, and additional photo prompts.
- Added Fresh Shuffle and several Vienna-friendly/dice curses.
- Both roles can confirm `Hider Found`; the final score includes held time bonuses + triggered traps - late-answer penalties.
- Finished games stay visible in the game overview with their final time.
- UI copy was shortened throughout.
