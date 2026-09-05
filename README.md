# Riftforge

A Riftbound card database and rules-enforced simulator, built as one responsive
web app for desktop and mobile.

Unofficial fan project. Not affiliated with or endorsed by Riot Games.

---

## Status

| Phase | | |
|---|---|---|
| 1 | Card database | **done** |
| 2 | Deck builder | **done** |
| 3 | Rules engine | **done** |
| 4 | Game board (hotseat) | **done** |
| 5 | PWA / offline | **done** |

Online 2-player is deliberately out of scope for V1 — see *Multiplayer* below.

53 tests pass (`npm test`), covering deck legality, decklist parsing, and the
engine — including a full game played to 8 points.

---

## Running it

```bash
npm install
npm run fetch-cards   # pulls the card dataset into public/data (needs network)
npm run dev           # http://localhost:5273
```

Other scripts:

| | |
|---|---|
| `npm run build` | typecheck + production build (PWA, ~95 KB gzipped JS) |
| `npm run preview` | serve the build — needed to exercise the service worker |
| `npm test` | Vitest suite |
| `python scripts/extract-rules.py` | refresh `docs/*.txt` from Riot's rules PDFs |
| `python scripts/make-icons.py` | regenerate the PWA icon set |

### Offline

The build is an installable PWA. The service worker precaches the app shell
*and the whole card dataset*, so the database works with no network at all;
card art is cached as you browse (cache-first — the CDN URLs carry a content
hash, so they never go stale).

---

## Card data

Cards come from [Riftcodex](https://riftcodex.com), a free, no-auth community
REST API. Note the endpoints are at the root (`/cards`, `/sets`, `/index/*`) —
**not** under `/api`.

`npm run fetch-cards` vendors a normalized copy into `public/data/`:

| file | |
|---|---|
| `cards.json` | 1451 cards across 8 sets (~965 KB, ~147 KB gzipped) |
| `sets.json` | set list with counts and release dates |
| `keywords.json` | keyword vocabulary for the filter UI |
| `meta.json` | source, fetch timestamp, counts |

We vendor rather than call the API at runtime for two reasons: Riftcodex can
only filter server-side on set and text, so every other filter has to run
client-side anyway; and a local copy means the app works offline. **Re-run
`npm run fetch-cards` when a new set releases.**

The script verifies what it fetched — card and set counts, no missing images or
types, plus stat spot-checks on known cards — and exits non-zero rather than
writing a silently truncated dataset.

### Card art

Art is hotlinked from Riot's CDN, which is Sanity-backed and transforms on the
fly. Always build URLs through `cardImage()` in `src/data/cards.ts`: the raw
PNGs are ~1.4 MB each, while the same art at `?w=250&fm=webp` is ~20 KB. On a
1451-card grid that is the difference between usable and unusable on mobile.

---

## Layout

```
scripts/fetch-cards.mjs   dataset pipeline
public/data/              vendored dataset (committed)
src/
  types.ts                Card, Domain, CardType… shared vocabulary
  data/
    cards.ts              dataset loading, indexes, image URLs
    search.ts             filtering, relevance scoring, sorting
    symbols.tsx           :rb_*: and [Keyword] text rendering
  features/
    cards/                card browser — grid, filters, detail
    decks/                builder, legality, decklist import/export
    game/engine/          pure rules engine (no React, no I/O)
    game/ui/              hotseat board
docs/                     rules text extracted from Riot's PDFs
```

### Symbols

Card text ships with inline markers that render as glyphs, drawn to match the
printed cards:

| marker | renders as |
|---|---|
| `:rb_energy_N:` | silver disc in a gold rim, dark numeral |
| `:rb_rune_<domain>:` | domain-coloured pip with the rune swirl |
| `:rb_rune_rainbow:` | the same swirl in a spectrum — power of any domain |
| `:rb_might:` | gold plate with a black shield and sword |
| `:rb_exhaust:` | rotation mark |
| `[Keyword]` | filled gold chip |

Parenthesised runs are reminder text and are dimmed, as printed.

---

## Design decisions

**The rules engine is a pure `(state, action) => state` reducer** — no React,
no I/O, no unseeded randomness. That makes it unit-testable, gives undo and
replay for free from the action log, and means online multiplayer can later
relay *actions* between two clients running the same reducer, rather than
syncing state.

**Hidden information** is kept out of shared state entirely. A
`redact(state, forPlayer)` function strips private data; in hotseat it drives
the pass-the-device screen, and it is exactly what would go over the wire
online. A hidden card's identity only ever lives in its owner's private state.

**Multiplayer** is local-only in V1: pass-and-play on one device, no backend, no
accounts, works offline. The engine design above is what keeps that from being
a dead end.

### Rules coverage — read this before trusting a game

The **framework** is enforced completely: the six turn phases, the Energy and
Power economy, play costs, Standard Moves, showdowns, the full combat sequence
(465–466), Conquer/Hold scoring with the Final Point restriction, burn out, and
the win check.

**Individual card text is mostly not automated.** Five keywords are handled
generically, because they are the ones that change the core loop:

| keyword | |
|---|---|
| `Assault N` | +N Might while attacking |
| `Shield N` | +N Might while defending |
| `Tank` | must be assigned combat damage first |
| `Backline` | must be assigned combat damage last |
| `Ganking` | may move battlefield to battlefield |

Everything else a card says — the other ~23 keywords and all card-specific
abilities — is **not** applied by the engine. Such cards still play with correct
stats and costs, and their unhandled text is listed in the board's "to apply by
hand" panel, so nobody is left assuming an ability resolved when it didn't.
Growing this is the main axis of future work: an effects registry keyed by
`riftboundId`, filled in card by card.

Damage assignment is automated. The rules let the assigning player choose the
order (465.2.c); the engine enforces every hard constraint — lethal in full
before another unit is started, no over-assignment while targets remain,
Tank first and Backline last — and within those picks the assignment that kills
the most units.

Also not implemented: the mulligan (117), the chain and priority windows beyond
pass/pass, and playing cards during a showdown other than by Action/Reaction
timing.

---

## Rules sources

Riot's official documents, from the [Rules Hub](https://playriftbound.com/en-us/rules-hub/):
Core Rules and Tournament Rules (both updated 2026-07-16). The engine is built
against those, not community summaries.

---

## Legal

Riftforge is an unofficial fan project, non-commercial, and not affiliated with,
endorsed, sponsored, or specifically approved by Riot Games, Inc. Riftbound and
League of Legends are trademarks of Riot Games, Inc. Card text and art are the
property of Riot Games.
