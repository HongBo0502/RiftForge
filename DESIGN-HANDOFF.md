# Riftforge — design session brief

Self-contained. You should not need to ask the previous session anything.

**Scope of this brief: the look and feel of the game board and its screens.**
The rules engine is a separate track and is in good shape — do not change engine
behaviour to make a visual idea work. If you were actually sent here to change
game *mechanics* rather than visuals, stop and say so; this is the wrong brief,
and the engine track has its own document, `HANDOFF.md`.

---

## What Riftforge is

An unofficial fan-made Riftbound (League of Legends TCG) card database and
rules-enforced simulator. One responsive web app, desktop and mobile,
installable and offline-capable.

It is **live** at https://riftforge.pages.dev and redeploys from `main` on every
push, so anything you merge is public within a couple of minutes.

---

## Getting running

```bash
npm install
npm run dev        # http://localhost:5273
npm test           # 189 tests, all passing
npm run build      # must stay clean
```

The card dataset is committed under `public/data/` — do not add a fetch step to
the build. Riftcodex blocks datacenter IPs, so a build runner cannot download it
and the deploy fails. `DEPLOY.md` explains this.

To reach the board you need two saved decks. Build them in the Decks tab, or
import a decklist; the Play tab will not start without them.

---

## The contract

`DESIGN.md` is the design system, and it is binding, not advisory. Read it
before touching anything. It covers:

| Section | What it fixes |
|---|---|
| 1. Visual theme | the mat-and-pieces metaphor |
| 2. Colour | table and mat palette, domains as the only accent system, ownership colours, semantic colours |
| 3. Typography | scale and usage |
| 4. Spacing & grid | rhythm |
| 5. Layout & composition | the mirrored centre line |
| 6. Components | card on the mat, hover detail, battlefield, rune row, chain strip, unit statuses, Ambush |
| 7. Motion | what is allowed to move, and `prefers-reduced-motion` |
| 8. Rules the board must obey | non-negotiable; see below |

If you change a rule in `DESIGN.md`, change the document in the same commit. A
design system the code has drifted from is worse than none.

---

## Five things that will bite you

**1. The board only ever renders `redact(state, viewer)`.**
Hidden information is enforced in exactly one place, `engine/redact.ts`. No
component takes raw state. If a component needs data it was not given, that is
the answer — it is not supposed to see it. Do not pass the real state in "just
for convenience"; you would leak the opponent's hand into the DOM, where anyone
can read it.

**2. The engine decides what is legal, never the component.**
Every affordance on the board is decided by dry-running the action through
`reduce()` — see `canDo` in `GameBoard.tsx`. Do not re-implement a rule in a
component to decide whether to show a button. If the engine says no, the control
is disabled, and the refusal carries its own reason and rule number.

**3. The mat flips to whoever may act, which is not always the turn player.**
With a chain up it is the priority holder; during a showdown it is the player
with focus. `activePlayer(state)` is the answer. Hotseat hands the device over
whenever that changes.

**4. "Apply by hand" is the honesty mechanism.**
Most card text is not automated yet. The panel listing what did not resolve is
how the player knows. Do not hide it, or shrink it to invisibility, or move it
somewhere it will be missed. Making it *better* is welcome — it must stay
prominent.

**5. Mobile is a first-class target and is under-tested.**
The board has not been checked on a real phone since the mulligan screen was
built. Assume something there is wrong.

---

## The open work, most valuable first

### 1. Targeting — the biggest gap, and it is a design problem

The engine accepts targets (`PLAY_CARD` takes a `targets` array) and the card
effect parser already reads what a card chooses. **Nothing in the board ever
asks the player to choose.** So every card reading "Deal 4 to a unit at a
battlefield" is stuck, even though the engine could resolve it.

Designing this well is the highest-value thing available:

- how a card in hand signals "this needs a target before it can be played"
- how legal targets are shown, and illegal ones ruled out, without a tooltip hunt
- how a multi-target card ("choose a unit and an Equipment") is stepped through
- how it works on a phone, where hover does not exist
- how to cancel cleanly half-way through

Constraint: legality comes from the engine. Ask `reduce()` whether a given
target is acceptable; do not filter the list yourself.

### 2. `GameBoard.tsx` is 1098 lines

Over the project's 800-line soft ceiling, and hard to work in. It holds the mat,
status bar, chain strip, showdown bar, battlefields, unit rows, gear rows, the
hand and the card pieces. Splitting it by component is overdue and makes every
other task here easier. Behaviour must not change — **the test suite does not
cover the UI**, so this is a careful, mechanical refactor. Do it first if you
plan to touch several of the components below.

### 3. The visual pass that was planned and never done

The last phase of the original plan. Two directions worth exploring:

- a richer felt surface, deeper card contact shadows, more theatrical zone
  framing for the mat
- a HUD register — "zero ambiguity at speed" — for the chain strip, which is
  already built to that idea and could go further

### 4. Smaller, and real

- **Mobile sweep.** Every screen at 375px. The mulligan screen was fixed to wrap
  2×2; nothing since has been checked.
- **Unit statuses at 48px.** Stunned dims under a scrim, buffs are gold dots
  beside the Might, Empowered is a standing outline. All implemented, and **none
  has ever been seen on screen**, because no card effect can currently apply a
  status. Force the state in and look at them; they may well be wrong.
- **The game log** is a collapsed `<details>` at the bottom. It carries rule
  numbers for every action and is the most educational thing in the app. It
  deserves better than a disclosure triangle.
- **Deck builder and card browser** have had far less design attention than the
  board.

---

## Committing

Conventional Commits: type, colon, short description, then a body explaining
*why* where it is not obvious.

```
feat: step through targets before a spell is played

fix: hand overlaps the mat edge below 380px
```

**Do not add `Co-Authored-By` or "Generated with" trailers.** This repository
does not use them.

Push straight to `main`. It deploys automatically — so run `npm test` and
`npm run build` before pushing, and open the live URL afterwards to confirm you
have not broken the public site.

---

## Where things live

```
src/features/game/ui/
  GameBoard.tsx      the playmat — 1098 lines, split me
  PlayPage.tsx       mode choice, deck select, hotseat handoff, mulligan routing
  MulliganScreen.tsx pre-game redraw
  CardPreview.tsx    hover detail
  OnlinePanel.tsx    room code lobby
  pieces.tsx         small shared bits
src/data/symbols.tsx renders :rb_*: symbols and [Keyword] markers — use CardText
                     for any card text, never a raw string
src/index.css        the design tokens, --color-*
DESIGN.md            the contract
HANDOFF.md           the engine track, if you need to understand a rule
```

Card images always go through `cardImage()` in `src/data/cards.ts`. The raw art
is ~1.4 MB per card; the same image at `?w=250&fm=webp` is ~20 KB, and across a
1451-card grid that is the difference between usable and not.

---

## Honest state

- 189 tests pass, build clean, live site current.
- The engine is ahead of the interface. The rules are enforced well; the board
  has not caught up with what the engine can now do, and targeting is the
  clearest example.
- No UI tests exist. Nothing will catch a visual regression except you looking
  at it.
