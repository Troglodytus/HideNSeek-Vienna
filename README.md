# Hide & Seek: Vienna — v3.11.2

Small QoL/gameplay patch on top of v3.11.1.

## Changes

- Hider `Hand & draws` now lives in the main game column above ongoing questions and the Question Deck.
- Automatic Tentacle vetoes now receive the normal Tentacle reward: draw 4, keep 2. Turntables' first-three-questions no-reward rule still overrides this when applicable.
- Developer → Games now has **View as Hider** and **View as Seeker**. These are read-only previews. Hider preview is authorized by the Developer password and can inspect the private station, hand, traps and other Hider-only state without revealing or requiring the game's Hider password.
- Added **Curse of the Passierschein A38**:
  - 10 minute duration.
  - Custom casting cost: Hider must roll an odd number on a die.
  - At cast time, each already-answered, currently relevant map-deduction question independently has a 50% chance of being flipped.
  - The underlying answers are not modified.
  - The possible-area map is recomputed from the flipped temporary view.
  - Affected Activity rows are marked `A38 distorted` while the curse is active.
  - At expiry, the original deductions return automatically.

## Upgrade from v3.11.1

1. Run `supabase-v3.11.2-migration.sql` once in Supabase SQL Editor.
2. Replace `app.js`, `index.html`, and `styles.css`.
3. Keep your existing working `config.js`.
4. Hard refresh and verify Developer shows `BUILD 3.11.2`.

No Vienna reference-data refresh is required.
