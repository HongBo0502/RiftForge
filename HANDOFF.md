# Riftforge — handoff

Written for whoever picks this up next. Read this before touching code; it
records decisions and traps that are not obvious from the source.

**Riftforge** is a Riftbound (League of Legends TCG) card database and
rules-enforced simulator — one responsive web app for desktop and mobile,
installable and offline-capable. Unofficial fan project.

Repo: `D:\Claude\Testing 1 - Notion\riftforge` (its own git repo; the parent
folder is an unrelated scratch drawer — don't touch it).

```bash
npm install
npm run fetch-cards   # only needed if public/data is missing or a set dropped
npm run dev           # http://localhost:5273
npm test              # 77 tests
```

### Starting a session on this

Open Claude Code with the **parent** folder as the project root (that is where
`.claude/skills` and `.claude/launch.json` live), then paste:

```
/caveman

Read riftforge/HANDOFF.md. Work in riftforge/.

Task: item A — start the card effects registry.

Stop when `npm test` passes with the registry in place and the cards from one
real deck registered. Do not start item B.
```

`/caveman` is a compression mode, not a scope change — it makes replies terse
without dropping technical substance. Levels: `/caveman lite`, `/caveman`
(full, default), `/caveman ultra`. Say "stop caveman" to leave it.

---

## Where it stands

All five originally planned phases are done and committed.

| | | |
|---|---|---|
| 1 | Card database | done |
| 2 | Deck builder | done |
| 3 | Rules engine | done |
| 4 | Hotseat board | done |
| 5 | PWA / offline | done |
| 6 | Playmat board, hover detail, auto-pay | done |
| 7 | Hidden cards, Gear as permanents | done |
| 8 | Online play over Supabase Realtime | done |
| 9 | Rules fidelity A: exhausted units, cleanups, Temporary, mulligan | done |
| 10 | Rules fidelity B: the chain, priority, timing gate | done |

```
c9c39fd  Import: standalone section headers and sideboards
05a712c  README: state rules coverage accurately
59746a0  PWA: installable, and the card database works offline
a070caa  Hotseat game board on the engine
ee0cb84  Rules engine: pure reducer over the official Core Rules
8ea9f2e  Deck builder with legality checked against the official Core Rules
457bf25  Card database: Vite/React scaffold, Riftcodex pipeline, browser UI
```

**126 tests pass.** Production build is clean (~95 KB gzipped JS).

Two decisions the user made. Don't re-litigate them:

- The simulator **enforces** rules; it is not a manual sandbox.
- V1 was local only; online play now exists alongside it, not instead of it.

---

## Map

```
scripts/
  fetch-cards.mjs        Riftcodex -> public/data/*.json   (npm run fetch-cards)
  extract-rules.py       Riot rules PDFs -> docs/*.txt
  make-icons.py          PWA icon set
public/data/             vendored dataset, committed (1451 cards, 8 sets)
docs/
  core-rules.txt         official Core Rules, reflowed and greppable  <- source of truth
  tournament-rules.txt   official Tournament Rules (sideboards, formats)
  pdf/                   gitignored: the source PDFs + raw extraction cache
src/
  types.ts               Card, Domain, CardType, nameKey()
  data/
    cards.ts             dataset loading, indexes, cardImage()
    search.ts            filtering, relevance scoring, sorting
    symbols.tsx          :rb_*: and [Keyword] rendering
  features/
    cards/               browser: grid, filters, detail
    decks/               builder, legality, decklist import/export, storage
    game/engine/         PURE rules engine — no React, no I/O
      types.ts             GameState, GameAction, Location
      setup.ts             build the opening state from two decks
      reducer.ts           (state, action) => state
      payment.ts           works out which runes pay a cost (auto-pay)
      combat.ts            damage assignment, showdown resolution
      scoring.ts           Conquer/Hold, burn out, win check
      keywords.ts          keyword parsing + "what isn't automated"
      redact.ts            hidden-information enforcement
      rng.ts               seeded RNG
    game/online/         transport, Supabase adapter, match hook
    game/ui/             playmat board, card preview, deck select, handoff
DESIGN.md                board design contract — read before UI work
```

---

## Ground rules

**1. Build against `docs/core-rules.txt`, not community guides.** The guides are
wrong in several places and cost real rework. Rule numbers are citable — grep
them. Every legality message in the app carries its rule reference, and new ones
should too.

Things the official rules corrected during the build:

| community guides say | official rules say |
|---|---|
| main deck exactly 40 | *at least* 40 (103.2) |
| 3 signature cards per name | 3 signature cards **in total** (103.2.d.1) |
| a card matching any of your domains is legal | a multi-domain card needs **all** its domains in your identity (103.1.b.4) |
| Shield prevents damage | Shield is **+N Might while defending** — the mirror of Assault (worked example on p.1088) |
| points score at end of turn | Conquer scores immediately; Hold scores at your Beginning Phase (469) |

**2. Card identity goes through `nameKey()` in `src/types.ts`.** The dataset
punctuates subtitles inconsistently between sets — Origins prints
`Ahri - Inquisitive`, Vendetta prints `Ahri, Inquisitive`, same card, 16 cases.
Copy limits, variant grouping and decklist import all have to span both. A test
caught this; don't undo it by comparing `baseName` directly.

**3. Always build image URLs through `cardImage()` in `src/data/cards.ts`.** Riot's
CDN is Sanity-backed: the raw PNGs are ~1.4 MB, the same art at `?w=250&fm=webp`
is ~20 KB. On a 1451-card grid that is the difference between usable and not.

**4. The engine stays pure.** No React, no I/O, no unseeded randomness in
`features/game/engine/`. That purity is what buys testability, replay, and the
V2 online path (relay *actions*, not state).

**5. Hidden information is enforced in exactly one place** — `redact.ts`. The
board component is only ever handed `redact(state, turnPlayer)`, so the UI
cannot leak what it was never given. Keep it that way; don't pass raw state to
a component "just for convenience".

**6. Riftcodex endpoints are at the root** — `/cards`, `/sets`, `/index/*`.
**Not** under `/api`; that 404s.

---

## Known gaps — read before promising anything

The **framework** is complete and trustworthy: six turn phases, Energy/Power
economy, play costs, Standard Moves, showdowns, the full combat sequence
(465–466), Conquer/Hold with the Final Point restriction (471.1.b), burn out,
win check.

**Individual card text is mostly not automated.** These are the real gaps, worst
first:

### 1. Equipment Might Bonus is missing from the dataset

Equipment print a Might Bonus in the card's lower-right corner (137), and that
is the whole point of attaching one. The Riftcodex dataset has **no field for
it** — every Gear card comes back with `might: null`. Attaching Equipment
therefore works mechanically (it attaches, follows its unit, detaches on death)
but changes no stats.

`hidden.test.ts` has a test that documents this and will fail loudly if the data
ever gains the field. Fixing it means either finding the value upstream or
scraping it off the card images.

### 2. Most keywords still do nothing

Automated: `Action` and `Reaction` (the timing gate), `Assault`, `Shield`,
`Tank`, `Backline`, `Ganking` (Might and movement), `Accelerate` and
`Temporary`, plus `Hidden` and `Equip`, which have their own actions.

Not automated: `Add, Ambush, Buff, Deathknell, Deflect, Empower, Empowered,
Flow, Hunt, Legion, Mighty, Quick-Draw, Repeat, Stun, Unique, Vision,
Weaponmaster`.

Cards whose text isn't handled still play with correct stats and costs, and
their text is surfaced in the board's "apply by hand" panel
(`keywords.ts: unautomatedText`). That panel is the honesty mechanism — never
remove it while coverage is partial.

### 3. Other unimplemented rules

- **Triggered abilities never reach the chain.** The chain itself works
  (327–340): spells go on it, both players get a priority window, the newest
  resolves first, and `counterItem` clears an item without refunding its cost.
  What is missing is anything that would *put* a trigger there, because no card
  effect fires yet. Same blocker as the effects registry below.
- **Targets are chosen by the caller, not the board.** `PLAY_CARD` accepts
  `targets`, and the resolver drops an instruction whose targets have all gone
  (359.3.e.7) — but nothing in the UI asks a player to pick one yet.
- **Damage assignment is automatic.** Every hard constraint is enforced (lethal
  in full before another unit, no over-assignment while targets remain,
  Tank first / Backline last), but the rules let the *player* choose the order
  (465.2.c) and the engine chooses for them — it maximises kills.
- **No undo/replay.** The pure reducer makes it possible and `GameState.log`
  holds human-readable lines, but no *action* history is kept. Adding one is
  small.
- **No AI opponent.** Hotseat and online only.

---

## What to do next

Pick up here. Ordered by what unblocks the most.

### A. Card effects registry — the main long-term axis

Create `src/features/game/engine/effects/` keyed by `riftboundId` (stable, e.g.
`ogn-194-298`). Each entry hooks named lifecycle points the reducer already has
(on play, on conquer, on death, start of turn). Register incrementally; anything
unregistered keeps falling through to the "apply by hand" panel, so partial
coverage is always safe.

Start with the ~40 cards in the two decks the user actually plays, not
alphabetically.

### B. A greedy bot

The user asked for this. `reduce()` is pure and returns a reason instead of
throwing, so a bot can enumerate candidate actions and dry-run each to find the
legal ones — the board already does exactly this to grey out illegal moves.

Score resulting states on points, board Might, and battlefields held. It will
play the resource/tempo game well and the card-text game badly (see gap 3), so
frame it as a sparring partner.

Worth doing partly as a **test harness**: hundreds of bot-vs-bot games will
shake out engine bugs the 56 unit tests can't reach.

### C. Online play — done, but thin

Working: room codes, host/join, action relay over Supabase Realtime broadcast
channels, per-client `redact()`, read-only board while the opponent acts.

**Credentials live in `.env`, which is gitignored.** Copy `.env.example` and
fill in the Supabase project URL and publishable key, or online play shows a
configuration message instead of a lobby. Restart the dev server after — Vite
reads env at startup.

No database tables, no auth, no rows. A match is an ephemeral channel and the
game lives in the two browsers.

What it still needs:
- **Reconnect.** A dropped connection ends the match. There is no resync.
- **Sequence gaps end the match** rather than requesting a replay. Deliberate:
  playing on after a gap would silently diverge.
- **No spectators, no rematch, no lobby list.**

---

## Traps that already bit us

- **Don't trust community rules guides.** See the table above.
- **`Legend:` / `Champion:` / `Sideboard:` appear as standalone headers** in real
  shared decklists, with the card on the next line. Before this was handled, the
  parser stayed in whatever section it was in and silently folded sideboard
  cards into the rune deck — 20 runes, no error. Section routing now takes
  precedence over type-based routing for exactly this reason.
- **Copy limits span main deck + sideboard** (Tournament Rules 403.3).
- **The Chosen Champion is a main-deck card** that merely starts in its own zone
  (103.2). Lists break it out under its own header and omit it from the main
  section, so the importer adds it back — that is why a "39-card" list yields 40.
- **Battlefield cards are printed dual-oriented** (rules text upside-down at the
  top so both players can read across the table). That is the real art, not a
  rendering bug.
- **PDF extraction gives one word per line.** `extract-rules.py` reflows it and
  caches the raw text in `docs/pdf/*.rawtxt`, so re-running is fast. Don't
  re-parse the 43 MB PDF unnecessarily.
- **Never put a side effect inside a `setState` updater.** React double-invokes
  updaters in StrictMode. Broadcasting the relay message from inside one sent
  every online action twice, with two sequence numbers, and desynced the two
  clients by a whole turn. Handlers read state from a ref, act, then set state
  once.
- **Windows console mangles UTF-8 on print.** An em-dash showing as `?` in
  terminal output does not mean the file is corrupt — check the codepoint before
  "fixing" it.

---

## Housekeeping

- `docs/pdf/` is gitignored (60 MB of PDFs). `extract-rules.py` re-downloads
  them on demand.
- Re-run `npm run fetch-cards` when a new set releases. It verifies counts,
  image/type completeness and known card stats, and exits non-zero rather than
  writing a truncated dataset.
- Dev server config lives in the **parent** folder's `.claude/launch.json`
  (entries `riftforge` and `riftforge-preview`), not in this repo.
- **Unrelated but unresolved:** the parent folder's `.claude/settings.local.json`
  contains a plaintext Anthropic API key in a Bash allow-rule. Flagged to the
  user 2026-09-05; rotate it.

---

## Legal

Unofficial fan project, non-commercial, not affiliated with or endorsed by Riot
Games. Riftbound and League of Legends are trademarks of Riot Games, Inc. Card
text and art are Riot's property; art is hotlinked from their CDN rather than
rehosted. Keep it that way.
