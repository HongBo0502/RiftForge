import type { GameState, PlayerId } from './types';

/**
 * Statuses and XP. 423, 426, 441-442, 701-705, 728-733
 *
 * Every one of these is a **Limited Action** (423.2.a, 426.2.a, 441.3.a): a
 * player may only stun, buff or empower when a game effect tells them to. So
 * none of them gets a player-facing action in the reducer — these are the
 * primitives the card-effect registry will call, in the same way `counterItem`
 * is for Counter.
 *
 * What is wired up now is the part that is not optional: buffs count toward
 * Might, a stunned unit deals no combat damage, and stun expires with the rest
 * of the turn's effects.
 */

/**
 * Buffs a unit. 426 / 701-705
 *
 * Returns whether a counter was actually placed, which the caller needs:
 * 426.1.c lets a player choose an already-buffed unit, and then the *rest* of
 * the effect — "Buff a unit. Then, if it was buffed this way, draw a card." —
 * does not happen.
 *
 * 702.3 allows only one at a time; `allowMultiple` is the exception 426.1.b.2
 * grants to effects that say so.
 */
export function buff(state: GameState, uid: string, allowMultiple = false): boolean {
  const unit = state.units[uid];
  if (!unit) return false;
  if (unit.buffs > 0 && !allowMultiple) return false;

  unit.buffs += 1;
  return true;
}

/**
 * Spends a buff as a cost. 702.2.b
 *
 * Only from a unit you control (702.2.b.2), and only if there is one to spend
 * (702.2.b.1) — a buff is a resource, not just a stat line.
 */
export function spendBuff(state: GameState, player: PlayerId, uid: string): boolean {
  const unit = state.units[uid];
  if (!unit || unit.controller !== player || unit.buffs <= 0) return false;

  unit.buffs -= 1;
  return true;
}

/**
 * Stuns a unit. 423
 *
 * Binary, and a stunned unit cannot be stunned again (423.1.a.1) — which is why
 * this reports whether anything happened, since "when you stun an enemy unit"
 * triggers do not fire on a unit that was already stunned.
 */
export function stun(state: GameState, uid: string): boolean {
  const unit = state.units[uid];
  if (!unit || unit.stunned) return false;

  unit.stunned = true;
  return true;
}

/** Empowers a game object. 441 — binary, and empowering again does nothing. */
export function empower(state: GameState, uid: string, allowMultiple = false): boolean {
  const unit = state.units[uid];
  if (!unit) return false;
  if (unit.empowered && !allowMultiple) return false;

  unit.empowered = true;
  return true;
}

/**
 * Removes the Empowered status. 442
 *
 * 442.1.a.1 — disempowering something that is not empowered does nothing, so
 * this reports false rather than pretending.
 */
export function disempower(state: GameState, uid: string): boolean {
  const unit = state.units[uid];
  if (!unit || !unit.empowered) return false;

  unit.empowered = false;
  return true;
}

/**
 * Gains XP. 730.1
 *
 * 733 — there is no cap, and nothing expires it. XP is not a game object (731),
 * so it cannot be targeted, and it is Public Information (729.2), which is why
 * `redact` leaves it alone.
 */
export function gainXp(state: GameState, player: PlayerId, amount: number): void {
  if (amount <= 0) return;
  state.players[player].xp += amount;
}

/** Spends XP. 730.2 — fails rather than going negative, since it is a cost. */
export function spendXp(state: GameState, player: PlayerId, amount: number): boolean {
  const p = state.players[player];
  if (amount <= 0 || p.xp < amount) return false;

  p.xp -= amount;
  return true;
}

/**
 * The Ending Phase's step 3d: all "this turn" effects expire. 317.2.c
 *
 * Stun goes here because 423.1.a.2 puts it here explicitly. Buffs and Empowered
 * do not: a buff is a counter that stays until spent or the unit leaves play
 * (705), and Empowered is only ever removed by Disempower (442).
 */
export function expireStatuses(state: GameState): void {
  for (const unit of Object.values(state.units)) unit.stunned = false;
}
