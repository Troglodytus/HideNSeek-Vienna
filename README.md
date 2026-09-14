# Hide & Seek: Vienna — v3.10.1

Incremental update on top of v3.9.0.

## Changes

### Casting costs

Curse casting costs now support five modes:

- None
- Time bonus
- Custom / physical requirement
- Discard any other held card
- Discard one held card from a chosen category

Discard categories supported by the Developer card editor are Curse, Veto, Time Bonus, Power-up, and Time Trap. The selected payment card is validated and consumed server-side.

`Curse of the Side Quest` uses the new category cost: discard one other Curse.

### New Vienna / movement curses

Added without altering existing card definitions:

- Curse of the Side Quest — random side quest, 45 min; costs one other Curse.
- Curse of the Deutsche Bahn — choose a cached U-/S-Bahn line; it is marked red and blocked for 30 min.
- Curse of the 'I lass mir mei Wean ned schlecht redn' — 40 min casting cost. Monday through Tuesday 11:59 Vienna time means a 1 h halt; otherwise Wiener Weinwanderweg access points are shown and the curse can be checked off after reaching one.
- Curse of the Haute Vollee — districts 1, 18 and 19 are marked red and forbidden for 15 min.
- Curse of the One Ring — Ringstraße crossing rule.
- Curse of the Schwarzkappler — get off and buy a ticket; Seeker manually checks it off.
- Curse of the Wiener Grantler.
- Curse of the Fiaker — no new questions until a Fiaker is spotted/checkmarked; auto-expires after 1 h.
- Curse of Mordor — depending on the Seekers' current side, districts 21/22 become the allowed or forbidden side for 20 min.
- Curse of the Broken Lift.
- Curse of the Gemeindebau.
- Curse of Quick Escalation — custom physical casting cost.
- Curse of the False Prophet — 20 min.

Side Quest and Fiaker actively block the Seeker question deck while their blocking condition is active.

### Map-driven curse effects

The Hider gets a preview before playing map-aware curses. Active public effects are then shown on both game maps:

- Deutsche Bahn: blocked line in red.
- Haute Vollee: forbidden districts in red.
- Mordor: currently forbidden districts in red.
- Weinwanderweg mode: marked route access points.

## Wiener Weinwanderweg data

The current official Wiener Weinwandertag information describes four main routes, not 18 separate routes. v3.10 therefore uses a set of current public access/start/end points from the four official route areas (Neustift–Nußdorf, Strebersdorf–Stammersdorf, Ottakring, and Mauer) rather than inventing 18 route markers.

## Upgrade from v3.9.0

1. Run `supabase-v3.10.1-migration.sql` once in the Supabase SQL Editor.
2. Replace `app.js`, `index.html`, and `styles.css` in GitHub Pages.
3. Keep your existing working `config.js`.
4. Commit/push and hard-refresh.
5. Verify Developer shows **BUILD 3.10.1**.

No Vienna reference-data refresh is required.

## Existing Developer editors

The v3.9 card-count and question editors remain intact. Only the five core engine cards remain grouped as **Special engine cards**: Prosperous Home, Duplicate, Fresh Shuffle, Time Trap, and Veto. The new interactive curses stay in the normal editable curse catalogue so their title, text, copy count, and casting cost can be adjusted without changing their protected engine behavior.


## v3.10.1 Duplicate hotfix

Duplicate now consumes itself and creates a genuine independent copy of the selected held time-bonus or curse card. The source card stays in hand. The new copy can be played, discarded, spent as a casting cost, or counted at final scoring like a normal held card.
