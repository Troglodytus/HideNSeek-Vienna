# Hide & Seek: Vienna — v3.11.3

UI/notification quality-of-life patch on top of v3.11.2. No database migration is required.

## Changes

- Game map now restores the last center/zoom separately for each game + role. On first entry it fits the whole Vienna boundary instead of opening over-zoomed.
- Hider layout order is now: map → ongoing questions → compact clock / Hider Found controls → Hider position + Endgame controls → hand & pending draws → Time Traps → active curses → Activity → Question Deck.
- Hider clock/location/endgame controls are more compact.
- Seeker Current Position + Question Origin are merged into one compact **GPS mode** panel. Choose Automatic GPS or Manual marker first, then refresh GPS / set on map / clear.
- Full active-curse panel is moved higher on the Seeker page, directly below GPS mode.
- Notification sounds now play on both Hider and Seeker clients for:
  - a question being asked,
  - a question being answered/resolved,
  - a curse being played.
  Curse notifications use a different sound from question notifications.

## Upgrade from v3.11.2

1. Replace `app.js`, `index.html`, and `styles.css`.
2. Keep your existing working `config.js`.
3. No Supabase migration is needed.
4. Hard refresh and verify Developer shows `BUILD 3.11.3`.

No Vienna reference-data refresh is required.
