import type { Card } from '@/types';
import { hasKeyword } from './keywords';
import type { GameState, PlayerId, UnitState } from './types';

/**
 * Cleanups. 318-324
 *
 * A cleanup runs after anything that could change the board: a move, a death,
 * a phase transition. It is where the game tidies up consequences nobody
 * explicitly asked for — most importantly, control of a battlefield you no
 * longer occupy.
 *
 * Without this the engine let a player keep scoring Hold points after their
 * last unit there died, which inflated every game.
 */

type CardLookup = (cardId: string) => Card | undefined;

/**
 * Sends a card off the board, wiping everything the board was tracking on it.
 *
 * 102 — an object that changes zones becomes a *new object*. Damage, buffs,
 * statuses and combat designations do not survive the trip, so anything coming
 * back later must come back clean.
 */
export function toZone(
  state: GameState,
  uid: string,
  zone: 'trash' | 'hand' | 'mainDeck' | 'runeDeck',
): void {
  const instance = state.instances[uid];
  if (!instance) return;

  delete state.units[uid];
  delete state.gear[uid];
  delete state.runes[uid];
  delete state.hidden[uid];

  // Attached gear loses its host and goes home rather than following a card
  // that is no longer on the board.
  for (const gear of Object.values(state.gear)) {
    if (gear.attachedTo === uid) {
      gear.attachedTo = null;
      gear.location = { kind: 'base', player: gear.controller };
    }
  }

  const owner = state.players[instance.owner];
  if (zone === 'mainDeck' || zone === 'runeDeck') owner[zone].push(uid);
  else owner[zone].push(uid);
}

const unitsAt = (state: GameState, index: number, player?: PlayerId): UnitState[] =>
  Object.values(state.units).filter(
    (u) =>
      u.location.kind === 'battlefield' &&
      u.location.index === index &&
      (player === undefined || u.controller === player),
  );

/**
 * Runs a cleanup over the whole board.
 *
 * Repeats until nothing changes, because a cleanup can create work for another
 * one (322) — losing control removes hidden cards, which is itself a change.
 */
export function cleanup(state: GameState): void {
  let guard = 0;
  while (guard++ < 8) {
    let changed = false;

    /*
     * 323.6 step 4 — a player loses control of a battlefield they have no units
     * at, but only in an Open State with no showdown or combat running there.
     * The exception matters: control has to survive an in-progress showdown, or
     * a card hidden there would be lost mid-combat.
     */
    state.battlefields.forEach((bf, index) => {
      if (!bf.controller) return;
      const contestHere = state.showdown?.battlefield === index;
      if (contestHere || bf.contested) return;
      if (unitsAt(state, index, bf.controller).length > 0) return;

      bf.controller = null;
      changed = true;
      state.log.push({
        turn: state.turn,
        phase: state.phase,
        player: null,
        text: `Battlefield ${index + 1} is uncontrolled — no units remain there.`,
        rule: '323.6',
      });
    });

    // 466.5.c — a hidden card only survives while its controller holds the
    // battlefield it sits at.
    for (const hidden of Object.values(state.hidden)) {
      const bf = state.battlefields[hidden.battlefield];
      if (bf && bf.controller === hidden.controller) continue;
      toZone(state, hidden.uid, 'trash');
      changed = true;
      state.log.push({
        turn: state.turn,
        phase: state.phase,
        player: hidden.controller,
        text: `A hidden card was trashed on losing that battlefield.`,
        rule: '466.5.c',
      });
    }

    // 149.3 — unattached gear cannot sit at a battlefield; it is recalled.
    for (const gear of Object.values(state.gear)) {
      if (gear.attachedTo || gear.location.kind !== 'battlefield') continue;
      gear.location = { kind: 'base', player: gear.controller };
      changed = true;
    }

    if (!changed) break;
  }
}

/**
 * Kills Temporary permanents. Called at the Beginning Phase *before* scoring,
 * so a Temporary unit cannot bank a Hold point on its way out.
 */
export function expireTemporary(state: GameState, player: PlayerId, lookup: CardLookup): void {
  for (const unit of Object.values(state.units)) {
    if (unit.controller !== player) continue;
    const card = lookup(state.instances[unit.uid]?.cardId ?? '');
    if (!card || !hasKeyword(card, 'Temporary')) continue;

    toZone(state, unit.uid, 'trash');
    state.log.push({
      turn: state.turn,
      phase: state.phase,
      player,
      text: `${card.baseName} was Temporary and expired.`,
      rule: '817',
    });
  }
}
