# Riftforge — Design System

> Category: Game client
> A physical playmat rendered in a browser. Material depth, framed zones, and
> card art doing the emotional work.

Structure follows the OpenDesign design-system contract
(`design-systems/_schema`), so this file can be read by an agent as a brand
contract rather than prose. Reference systems consulted: `skeumorphism` for
material metaphor, `playstation` for gaming interaction language.

---

## 1. Visual theme & atmosphere

Riftforge should feel like sitting down at a **printed playmat**, not like using
a web app that happens to contain cards. The reference is a physical TCG table:
a felt surface with screen-printed zone outlines, cards laid onto it, and the
table itself receding so the art leads.

Three surface depths, and never more:

| Depth | What it is | Treatment |
|---|---|---|
| **Table** | Behind everything | Darkest. Vignetted, subtly textured. Never interactive. |
| **Mat** | The playmat itself | Felt. Carries the printed zone outlines and labels. |
| **Pieces** | Cards, runes, tokens | Lift off the mat with shadow. The only things that move. |

The chrome stays quiet so 1451 pieces of Riot key art can lead. Nothing in the
UI competes with card art for saturation.

**Key characteristics**

- Felt mat with printed zone outlines — zones are *drawn on the surface*, not
  floating panels with borders
- Two opposed halves, mirrored across a centre line: opponent above, you below
- Battlefields sit on the centre line, contested from both sides
- Cards are the only elements that cast real shadow; the mat casts none
- Domain colour is the single accent system — no invented UI palette competes
- Every state change is legible without reading text: exhausted cards rotate,
  contested battlefields glow, unaffordable cards desaturate

---

## 2. Colour

### Table & mat

| Token | Value | Role |
|---|---|---|
| `--table` | `#070a0f` | Behind the mat. Vignette anchor. |
| `--mat` | `#12161f` | Felt base. |
| `--mat-raised` | `#1a2130` | Zone fills printed onto the felt. |
| `--mat-line` | `#2b3347` | Printed zone outline, at rest. |
| `--mat-line-hot` | `#3f4d68` | Zone outline when a drop is legal. |

The felt is *not* flat: a fine noise texture plus a radial lift toward centre.
Both are subtle enough to survive an OLED phone and a cheap laptop panel.

### Domains — the only accent system

Taken from the printed cards; do not invent alternates.

| Domain | Value |
|---|---|
| Fury | `#e0483f` |
| Calm | `#2aa96b` |
| Mind | `#3b86e0` |
| Body | `#e08a2e` |
| Chaos | `#9d5bd2` |
| Order | `#d9b02c` |
| Colorless | `#8a93a6` |

### Ownership

Players must be distinguishable at a glance, independent of their deck's
domains. Use position first, colour second.

- **You** — bottom half, edge-lit `#4ea3ff`
- **Opponent** — top half, edge-lit `#e0483f`

Ownership light appears on the *mat edge*, never on the card, so it can't be
confused with a card's own domain.

### Semantic

| Token | Value | Role |
|---|---|---|
| `--legal` | `#2aa96b` | Legal drop target, affordable card |
| `--contested` | `#d9b02c` | Battlefield in showdown |
| `--refused` | `#e0483f` | Rejected action, lethal damage |

---

## 3. Typography

- **Scale:** 10 / 11 / 13 / 15 / 18 / 24
- **Families:** system UI stack for everything. No webfont — the card art
  already carries the game's voice, and a font download costs a slow first paint
  on mobile.
- **Numerals:** always `tabular-nums`. Might, cost, and points sit in fixed
  columns and must not jitter as they change.
- Zone labels are the one decorative moment: **uppercase, letterspaced 0.12em,
  40% opacity** — printed onto the felt, not floating above it.

---

## 4. Spacing & grid

- **Scale:** 2 / 4 / 8 / 12 / 16 / 24
- The mat is one grid: `opponent / battlefields / you / hand`, rows sized to
  content with the battlefield row taking the slack.
- Card aspect is fixed at **744 / 1039** portrait, **1039 / 744** for
  battlefields. Never distort; letterbox instead.
- Minimum touch target 44px. On mobile, cards may overlap in a fan rather than
  shrink below that.

---

## 5. Layout & composition

Mirror the physical table:

```
┌──────────────────────────────────────────┐
│  opponent hand (backs)   deck · trash    │  ← top edge, red-lit
│  opponent base                           │
├──────────────────────────────────────────┤
│        BATTLEFIELD 1    BATTLEFIELD 2    │  ← centre line
├──────────────────────────────────────────┤
│  your base                               │
│  runes · pool            deck · trash    │  ← bottom edge, blue-lit
├──────────────────────────────────────────┤
│  your hand (fanned)                      │
└──────────────────────────────────────────┘
```

- Each battlefield is a **two-sided zone**: opponent's units render above its
  card, yours below. A contested battlefield therefore reads as a collision at
  the centre line.
- The hand overlaps the mat's bottom edge, as a real hand does.
- On mobile the same order holds vertically; nothing reorders, it only compresses.

---

## 6. Components

### Card on the mat

- Rests flat with a soft contact shadow.
- **Exhausted:** rotated 90°, shadow reduced. Rotation is the signal; do not
  also grey it out.
- **Damaged:** damage count in a red chip on the top-right corner.
- **Attacker / defender:** a coloured bar along the leading edge, pointing at
  the opponent.
- **Selected:** lifts 4px, gains a `--legal` ring.

### Card hover detail

Hover, or long-press on touch, opens a detail panel beside the card — never
covering the card being inspected.

Shows: full art, cost, Might, domains, **full rules text with symbols
rendered**, keywords expanded to their reminder text, and an explicit
`Not automated` marker on any text the engine does not apply.

Opens after 250ms so sweeping the cursor across the mat does not strobe.

### Battlefield

The rules text of a battlefield changes how the game is played and must be
readable without hovering.

- Battlefield name and its rules text print **onto the zone**, at 70% opacity.
- Hover expands to the full card with rules text at full contrast.
- Control state is stated in words on the zone: `You hold` / `They hold` /
  `Uncontrolled` / `Contested`.

### Rune row & pool

- Runes render as a row of pips at the bottom edge, ready ones upright,
  exhausted ones rotated.
- When a card is picked up, the runes that would pay for it **highlight**:
  blue outline = will exhaust, purple outline = will recycle.
- The pool shows Energy and Power as discrete pips, not numbers, so cost can be
  compared by counting rather than reading.

### Chain strip

A live chain is the one state where the whole mat is unusable and the only
question is whether you answer. It is treated as a HUD, not as furniture: the
reader needs three facts with no hunting, and nothing else.

- **Whose window it is**, in words — "Your window" or "Opponent is deciding" —
  because a coloured border alone does not survive a glance.
- **What is pending**, newest at the top, since the newest resolves first.
  Each row carries a seat dot in the owner's colour and the card's own text
  with its timing marker stripped: the engine enforces that now, so printing it
  is noise.
- **What resolves next**, labelled outright on the top row.

The strip sits above the mat in Chaos, the one domain colour the mat itself
never uses for board state, so it never reads as part of a battlefield. Pass is
the only control, right-aligned and disabled when the window is not yours.
While it is up, End turn, phase advance and movement are all disabled — the
engine refuses them anyway, and offering a control that always fails teaches
nothing.

---

## 7. Motion & interaction

Motion carries meaning; nothing moves decoratively.

| Event | Motion | Duration |
|---|---|---|
| Card hover | Lift 4px | 120ms ease-out |
| Card played | Travel hand to zone | 240ms ease-out |
| Exhaust | Rotate 90° | 160ms ease-out |
| Showdown opens | Battlefield glow pulses | 400ms, twice |
| Damage dealt | Card shakes 3px | 180ms |
| Point scored | Score chip pops 1.15× | 200ms |

- Card *travel* animates. Card *state* changes instantly, so the board is never
  lying about what is true.
- `prefers-reduced-motion` removes travel and shake; state changes and highlight
  remain, since they carry information.

---

## 8. Rules the board must obey

Non-negotiable, from the engine's constraints:

1. **The board only ever renders `redact(state, viewer)`.** No component takes
   raw state. Hidden information cannot leak through the UI because the UI never
   receives it.
2. **Affordances come from the engine, not from duplicated logic.** A control is
   enabled if dry-running its action through `reduce()` returns ok. Never
   re-implement a rule in a component.
3. **A refusal shows the engine's own reason and rule number.** Illegal actions
   teach.
4. **Un-automated card text is always visible as such.** Never let the board
   imply an ability resolved when the engine did not apply it.
