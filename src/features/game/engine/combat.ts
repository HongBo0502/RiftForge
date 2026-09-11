import type { Card } from '@/types';
import { keywordValue } from './keywords';
import { checkVictory, score } from './scoring';
import type { GameState, PlayerId, UnitState } from './types';
import { OPPONENT } from './types';

/**
 * Combat and showdown resolution. 459-466
 *
 * Damage assignment is automated. The rules let the assigning player choose
 * the order (465.2.c), but every hard constraint is enforced: lethal in full
 * before moving on, never more than minimum lethal while other units remain,
 * and Tank/Backline ordering. Within those constraints the engine assigns so
 * as to kill as many units as possible, which is the choice a player almost
 * always wants.
 */

export type CardLookup = (cardId: string) => Card | undefined;

/**
 * A unit's Might right now: printed, plus "this turn" bonuses, plus the
 * combat-role keywords.
 *
 * Assault N and Shield N are both Might modifiers, not separate mechanics —
 * "+N Might while I'm an attacker" and "+N Might while I'm a defender"
 * respectively (see rule 1088's worked example for Shield).
 */
export function unitMight(state: GameState, uid: string, lookup: CardLookup): number {
  const unit = state.units[uid];
  if (!unit) return 0;
  const card = lookup(state.instances[uid]?.cardId ?? '');
  const base = card?.might ?? 0;

  let role = 0;
  if (card && unit.designation === 'attacker') role = keywordValue(card, 'Assault') ?? 0;
  if (card && unit.designation === 'defender') role = keywordValue(card, 'Shield') ?? 0;

  // 143.2.b — Might below 0 is treated as 0.
  // 703 — each buff counter is +1 Might.
  return Math.max(0, base + unit.mightBonus + unit.buffs + role);
}

/**
 * What a unit adds to its side's total in the combat damage step. 465.2
 *
 * Only differs from `unitMight` when the unit is stunned: 423.1.b takes its
 * Might out of the damage being dealt, while 423.1.c keeps its full Might as
 * the amount needed to kill it. Using one number for both would either make a
 * stunned unit deal damage or make it die to a single point.
 */
export function damageContribution(
  state: GameState,
  uid: string,
  lookup: CardLookup,
): number {
  return state.units[uid]?.stunned ? 0 : unitMight(state, uid, lookup);
}

/** Damage needed to kill a unit now, given what is already marked on it. */
function lethalFor(state: GameState, uid: string, lookup: CardLookup): number {
  const unit = state.units[uid];
  // Lethal is non-zero damage equal to or exceeding Might. 142.4.b
  return Math.max(1, unitMight(state, uid, lookup) - unit.damage);
}

/**
 * Orders damage targets. Tank must be assigned first, Backline last;
 * everything else sits between. 465.2.c.6
 */
function assignmentOrder(state: GameState, uids: string[], lookup: CardLookup): string[] {
  const rank = (uid: string): number => {
    const card = lookup(state.instances[uid]?.cardId ?? '');
    if (!card) return 1;
    if (keywordValue(card, 'Tank') !== null) return 0;
    if (keywordValue(card, 'Backline') !== null) return 2;
    return 1;
  };
  return uids
    .slice()
    .sort((a, b) => rank(a) - rank(b) || lethalFor(state, a, lookup) - lethalFor(state, b, lookup));
}

export interface Assignment {
  /** Damage assigned per unit uid. */
  damage: Record<string, number>;
  /** Damage left over once every target had lethal assigned. 465.2.c.4 */
  excess: number;
}

/**
 * Distributes `total` Might of damage across `targets`.
 *
 * Assigns minimum lethal to each target in order; if what remains cannot kill
 * the next target it all goes there, since lethal must be completed on one
 * unit before another is started (465.2.c.3). Anything still left once every
 * target is lethally assigned is excess and lands on the last unit.
 */
export function assignDamage(
  state: GameState,
  total: number,
  targets: string[],
  lookup: CardLookup,
): Assignment {
  const damage: Record<string, number> = {};
  const ordered = assignmentOrder(state, targets, lookup);
  let remaining = total;

  for (const uid of ordered) {
    if (remaining <= 0) break;
    const lethal = lethalFor(state, uid, lookup);
    if (remaining >= lethal) {
      damage[uid] = lethal;
      remaining -= lethal;
    } else {
      // Cannot reach lethal here, and cannot skip to another unit.
      damage[uid] = remaining;
      remaining = 0;
    }
  }

  // 465.2.c.4 — over-assignment is only legal once no further units remain.
  const excess = remaining;
  if (excess > 0 && ordered.length > 0) {
    const last = ordered[ordered.length - 1];
    damage[last] = (damage[last] ?? 0) + excess;
  }

  return { damage, excess };
}

const unitsAt = (state: GameState, index: number, player?: PlayerId): UnitState[] =>
  Object.values(state.units).filter(
    (u) =>
      u.location.kind === 'battlefield' &&
      u.location.index === index &&
      (player === undefined || u.controller === player),
  );

/** Sends a unit to its owner's trash. */
function killUnit(state: GameState, uid: string, lookup: CardLookup): void {
  const instance = state.instances[uid];
  const card = lookup(instance?.cardId ?? '');

  /*
   * 149.3 — gear left unattached at a battlefield is recalled to its
   * controller's base in the next cleanup. Detaching here and sending it home
   * in one step is the same outcome without modelling the corrective action.
   */
  for (const gear of Object.values(state.gear)) {
    if (gear.attachedTo !== uid) continue;
    gear.attachedTo = null;
    gear.location = { kind: 'base', player: gear.controller };
  }

  delete state.units[uid];
  if (instance) state.players[instance.owner].trash.push(uid);
  state.log.push({
    turn: state.turn,
    phase: state.phase,
    player: instance?.owner ?? null,
    text: `${card?.baseName ?? 'A unit'} was killed.`,
  });
}

/**
 * Runs the Combat Damage Step and Resolution Step for the battlefield.
 * 465, 466
 */
export function resolveCombat(state: GameState, index: number, lookup: CardLookup): void {
  const battlefield = state.battlefields[index];
  if (!battlefield) return;

  const attackers = unitsAt(state, index).filter((u) => u.designation === 'attacker');
  const defenders = unitsAt(state, index).filter((u) => u.designation === 'defender');

  // 465.1 — the damage step only runs while both sides are present.
  if (attackers.length > 0 && defenders.length > 0) {
    // 423.1.b — a stunned unit is present and can still be killed, but adds
    // nothing to the damage its side deals.
    const attackMight = attackers.reduce(
      (sum, u) => sum + damageContribution(state, u.uid, lookup),
      0,
    );
    const defendMight = defenders.reduce(
      (sum, u) => sum + damageContribution(state, u.uid, lookup),
      0,
    );

    // 465.2.c — the attacker assigns first, but damage is dealt simultaneously.
    const onDefenders = assignDamage(state, attackMight, defenders.map((u) => u.uid), lookup);
    const onAttackers = assignDamage(state, defendMight, attackers.map((u) => u.uid), lookup);

    state.log.push({
      turn: state.turn,
      phase: state.phase,
      player: null,
      text: `Showdown at battlefield ${index + 1}: ${attackMight} Might attacking vs ${defendMight} defending.`,
      rule: '465.2',
    });

    // 465.2.d — deal all assigned damage at once, then check deaths together.
    for (const [uid, amount] of [
      ...Object.entries(onDefenders.damage),
      ...Object.entries(onAttackers.damage),
    ]) {
      const unit = state.units[uid];
      if (unit) unit.damage += amount;
    }

    // 143.2.a — non-zero damage equalling or exceeding Might kills.
    for (const uid of Object.keys(state.units)) {
      const unit = state.units[uid];
      if (unit.location.kind !== 'battlefield' || unit.location.index !== index) continue;
      if (unit.damage > 0 && unit.damage >= unitMight(state, uid, lookup)) {
        killUnit(state, uid, lookup);
      }
    }
  }

  // --- Resolution Step (466) ---------------------------------------------
  // 466.1.a.1 "3c. Heal all Units."
  for (const unit of Object.values(state.units)) unit.damage = 0;

  // 466.1.a.2 "3d. Recall Attackers present if Defenders are still present."
  const remainingDefenders = unitsAt(state, index).filter((u) => u.designation === 'defender');
  let recalled = false;
  if (remainingDefenders.length > 0) {
    for (const unit of unitsAt(state, index).filter((u) => u.designation === 'attacker')) {
      unit.location = { kind: 'base', player: unit.controller };
      recalled = true;
    }
    if (recalled) {
      state.log.push({
        turn: state.turn,
        phase: state.phase,
        player: null,
        text: `Attackers recalled — defenders still hold battlefield ${index + 1}.`,
        rule: '466.1.a.2',
      });
    }
  }

  // 466.3 — determine the result from who is left standing.
  const survivors = unitsAt(state, index);
  const controllers = new Set(survivors.map((u) => u.controller));

  battlefield.contested = false;
  for (const unit of Object.values(state.units)) unit.designation = null;

  if (!recalled && controllers.size === 1) {
    const winner = [...controllers][0];
    if (battlefield.controller !== winner) {
      battlefield.controller = winner;
      // 466.5.d — establishing control is a Conquer if not yet scored.
      score(state, winner, index, 'conquer');
    }
    clearForeignHiddenCards(state, index, lookup);
  } else if (controllers.size === 0) {
    // 466.5.b — nobody left, so the battlefield is uncontrolled.
    battlefield.controller = null;
    clearForeignHiddenCards(state, index, lookup);
  }

  checkVictory(state);
}

/**
 * Removes hidden cards at a battlefield that don't share a controller with it.
 * 466.5.c — this is what makes losing a battlefield cost you the cards you hid
 * there.
 */
export function clearForeignHiddenCards(state: GameState, index: number, lookup: CardLookup): void {
  const battlefield = state.battlefields[index];
  if (!battlefield) return;

  for (const hidden of Object.values(state.hidden)) {
    if (hidden.battlefield !== index) continue;
    if (hidden.controller === battlefield.controller) continue;

    const instance = state.instances[hidden.uid];
    delete state.hidden[hidden.uid];
    if (instance) state.players[instance.owner].trash.push(hidden.uid);
    state.log.push({
      turn: state.turn,
      phase: state.phase,
      player: hidden.controller,
      text: `A hidden card at battlefield ${index + 1} was trashed on losing control.`,
      rule: '466.5.c',
    });
    void lookup;
  }
}

/**
 * Opens a showdown at a battlefield where two players now have units.
 * The attacker is whoever applied Contested. 344, 464.2.c
 */
export function openShowdown(state: GameState, index: number, attacker: PlayerId): void {
  state.battlefields[index].contested = true;
  for (const unit of unitsAt(state, index)) {
    unit.designation = unit.controller === attacker ? 'attacker' : 'defender';
  }
  state.showdown = {
    battlefield: index,
    combat: unitsAt(state, index, OPPONENT[attacker]).length > 0,
    attacker,
    defender: OPPONENT[attacker],
    // 345 — the player who applied Contested gains Focus.
    focus: attacker,
    passes: 0,
  };
}

/**
 * Closes a showdown once every player has passed in sequence. 348
 * A combat showdown proceeds to the damage step; a non-combat one just
 * establishes control.
 */
export function closeShowdown(state: GameState, lookup: CardLookup): void {
  const showdown = state.showdown;
  if (!showdown) return;
  const index = showdown.battlefield;
  state.showdown = null;

  if (showdown.combat) {
    resolveCombat(state, index, lookup);
    return;
  }

  // 348.2 — non-combat showdown: sole occupant takes control.
  const survivors = unitsAt(state, index);
  const controllers = new Set(survivors.map((u) => u.controller));
  const battlefield = state.battlefields[index];
  battlefield.contested = false;
  for (const unit of Object.values(state.units)) unit.designation = null;

  if (controllers.size === 1) {
    const winner = [...controllers][0];
    if (battlefield.controller !== winner) {
      battlefield.controller = winner;
      score(state, winner, index, 'conquer');
      clearForeignHiddenCards(state, index, lookup);
    }
  }
  checkVictory(state);
}
