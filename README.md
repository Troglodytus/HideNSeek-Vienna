# Hide & Seek: Vienna — v3.11.1

Patch release on top of v3.11.0. Existing questions, reference data, and unrelated cards remain unchanged.

## Upgrade from v3.11.0

1. Run `supabase-v3.11.1-migration.sql` once in Supabase SQL Editor.
2. Replace `app.js`, `index.html`, and `styles.css` in the GitHub Pages repo.
3. Keep the existing working `config.js`.
4. Commit/push and hard refresh. Developer mode should report build `3.11.1`.

No Vienna reference-data refresh is required.

## Turntables adjustment

`Curse of the Turntables` still pauses the main game clock for a server-timed 20-minute relocation window, freezes Seeker movement/actions, lets the Hider select another hiding station, resets Prosperous Home and the old target deductions, and preserves the old activity history.

After a successful relocation, the next **3 new Seeker questions give no card reward**. They are answered and logged normally, but no Hider draw is created. Old unanswered questions from the previous target phase remain in Activity as reset history and are not shown as current questions.

## New power-ups

### Double or Nothing
Works only on a held Curse that has both a time-bonus casting cost and a timer. The Hider pays twice the normal minute cost and the selected Curse lasts twice as long. Both Double or Nothing and the selected Curse are consumed.

### MA48
Select one previously played/discarded card and return a new instance of it to the Hider hand. The price is information: the Hider's current hand is published to the Seekers in Activity **before** the recycled card is added. The revived card itself is therefore not included in the reveal.

### Kleingedrucktes
Every Curse can now have a private secondary effect configured in Developer → Card deck. Secondary effects are stored in a Hider/admin-only table, not in the public card catalogue. Kleingedrucktes can be played on an active Curse to reveal its fine print to the Seekers.

Secondary effect modes:
- `none`
- `custom` — hidden rule text
- `engine` — hidden engine key + JSON configuration

The storage/reveal infrastructure is implemented. Engine-key effects are deliberately **not executed yet**; they can be added once their individual rules are defined.

### Same Day Delivery
Costs 15 minutes of held Time Bonus cards. Draw 3 cards immediately and keep 2 using the normal finite deck.

## Curse of the Deceptive Tiny House

This is a deliberately private engine Curse.

When played:
- no public curse action/log entry is created;
- the next eligible Seeker question asked after the card was played may be answered manually/untruthfully by the Hider;
- the lie permission is consumed by exactly that next question;
- the final hiding **radius** is multiplied by `1/3`;
- multiple copies stack multiplicatively;
- Seekers are not informed that Tiny House was played while the game is still outside public Endgame.

When the Seekers start Endgame, previously armed Tiny House cards are revealed publicly and their radius reduction becomes visible. The reveal does not identify which earlier answer may have been false.

## Developer card editor

The existing card editor now also exposes private Fine Print fields for Curse cards:
- mode
- secondary text
- engine key
- engine JSON configuration

These fields are only returned through the developer-password RPC.

## Notes

Power-up hand mutations such as MA48 and Same Day Delivery are not exposed as ordinary Undo-able actions; undoing only a public log row without reversing private hand state would corrupt the game state.
