import type { Card } from '@/types';
import { toZone } from '../engine/cleanup';
import { drawCard } from '../engine/scoring';
import { buff, disempower, empower, gainXp, stun } from '../engine/statuses';
import type { GameState, PlayerId, UnitState } from '../engine/types';
import { OPPONENT } from '../engine/types';
import type { Instruction, Selector } from './types';

/**
 * Running parsed instructions against the game state.
 *
 * Every verb here routes through the engine primitives that already enforce the
 * rules — `statuses.ts` for Buff and Stun, `cleanup.ts` for zone changes,
 * `scoring.ts` for draws — so an effect cannot bypass a rule the engine spent
 * three milestones getting right.
 */

export interface EffectContext {
  /** Who controls the ability. */
  controller: PlayerId;
  /** The object the ability belongs to, for "me". */
  source?: string;
  /** Battlefield index for "here", when the source is at one. */
  here?: number;
  /** Targets the player chose, in the order the instructions ask for them. */
  chosen?: string[];
}

/** Resolves a selector to the uids it acts on right now. */
export function resolve(
  state: GameState,
  selector: Selector,
  context: EffectContext,
  chosen?: string,
): string[] {
  switch (selector.kind) {
    case 'self':
      return context.source ? [context.source] : [];

    case 'player':
      return [];

    case 'unit':
    case 'gear': {
      const pool: Array<UnitState | { uid: string; controller: PlayerId; location: unknown }> =
        selector.kind === 'unit'
          ? Object.values(state.units)
          : Object.values(state.gear);

      /*
       * A chosen selector is a Target (355). The player already picked it, so
       * the question is only whether it is *still* there — 359.3.e.2 makes a
       * target that has left the board illegal, and this is where that bites.
       */
      if (selector.chosen) {
        if (!chosen) return [];
        return pool.some((o) => o.uid === chosen) ? [chosen] : [];
      }

      return pool
        .filter((o) => {
          if (selector.side === 'friendly' && o.controller !== context.controller) return false;
          if (selector.side === 'enemy' && o.controller === context.controller) return false;

          const location = o.location as UnitState['location'];
          if (selector.where === 'battlefield' && location.kind !== 'battlefield') return false;
          if (selector.where === 'base' && location.kind !== 'base') return false;
          if (selector.where === 'here') {
            if (context.here === undefined) return false;
            if (location.kind !== 'battlefield' || location.index !== context.here) return false;
          }
          // 426.1.c-style "other" exclusions: never the source itself.
          return o.uid !== context.source || selector.side === 'any';
        })
        .map((o) => o.uid);
    }
  }
}

/** Which player a player-selector names. */
function playersFor(selector: Selector, context: EffectContext): PlayerId[] {
  if (selector.kind !== 'player') return [];
  if (selector.side === 'you') return [context.controller];
  if (selector.side === 'opponent') return [OPPONENT[context.controller]];
  return ['p1', 'p2'];
}

/** Marks damage and kills anything that has taken lethal. 142.4, 143.2.a */
function dealDamage(
  state: GameState,
  uid: string,
  amount: number,
  might: (uid: string) => number,
): void {
  const unit = state.units[uid];
  if (!unit || amount <= 0) return;

  unit.damage += amount;
  if (unit.damage > 0 && unit.damage >= might(uid)) {
    toZone(state, uid, 'trash');
    state.log.push({
      turn: state.turn,
      phase: state.phase,
      player: unit.controller,
      text: 'A unit was killed by damage.',
      rule: '143.2.a',
    });
  }
}

export interface ExecutionReport {
  /** Instructions that ran. */
  done: Instruction[];
  /** Instructions skipped because their target had gone. 359.3.e.7 */
  fizzled: Instruction[];
}

/**
 * Runs a list of instructions.
 *
 * `might` is injected rather than imported to keep this module free of a cycle
 * with combat.ts, which needs the effect layer for its own reasons later.
 */
export function execute(
  state: GameState,
  instructions: Instruction[],
  context: EffectContext,
  might: (uid: string) => number,
): ExecutionReport {
  const done: Instruction[] = [];
  const fizzled: Instruction[] = [];
  let chosenIndex = 0;

  for (const instruction of instructions) {
    // Pull the next chosen target for any instruction that needs one.
    const selector =
      'target' in instruction ? instruction.target : 'who' in instruction ? instruction.who : null;
    const needsChoice = selector !== null && selector.kind !== 'player' && selector.kind !== 'self'
      ? selector.chosen
      : false;
    const chosen = needsChoice ? context.chosen?.[chosenIndex++] : undefined;

    const targets = selector ? resolve(state, selector, context, chosen) : [];
    const players = selector ? playersFor(selector, context) : [];

    // 359.3.e.7 — a chosen target that has gone takes its instruction with it.
    if (needsChoice && targets.length === 0) {
      fizzled.push(instruction);
      continue;
    }

    switch (instruction.verb) {
      case 'draw':
        for (const p of players) for (let i = 0; i < instruction.amount; i++) drawCard(state, p);
        break;

      case 'discard':
        for (const p of players) {
          for (let i = 0; i < instruction.amount; i++) {
            const uid = state.players[p].hand.pop();
            if (uid) toZone(state, uid, 'trash');
          }
        }
        break;

      case 'deal':
        for (const uid of targets) dealDamage(state, uid, instruction.amount, might);
        break;

      case 'might':
        for (const uid of targets) {
          const unit = state.units[uid];
          // 317.2.c — a "this turn" bonus lives in mightBonus and expires; a
          // permanent one has nowhere else to go yet, so it goes there too and
          // is flagged rather than silently lost.
          if (unit) unit.mightBonus += instruction.amount;
        }
        break;

      case 'kill':
        for (const uid of targets) toZone(state, uid, 'trash');
        break;

      case 'buff':
        for (const uid of targets) buff(state, uid);
        break;

      case 'stun':
        for (const uid of targets) stun(state, uid);
        break;

      case 'empower':
        for (const uid of targets) empower(state, uid);
        break;

      case 'disempower':
        for (const uid of targets) disempower(state, uid);
        break;

      case 'ready':
        for (const uid of targets) {
          const o = state.units[uid] ?? state.gear[uid] ?? state.runes[uid];
          if (o) o.ready = true;
        }
        break;

      case 'exhaust':
        for (const uid of targets) {
          const o = state.units[uid] ?? state.gear[uid] ?? state.runes[uid];
          if (o) o.ready = false;
        }
        break;

      case 'gainXp':
        for (const p of players) gainXp(state, p, instruction.amount);
        break;

      case 'gainPoints':
        for (const p of players) state.players[p].points += instruction.amount;
        break;

      case 'recall':
        // 144.4.b — a unit only ever returns to its own controller's base.
        for (const uid of targets) {
          const unit = state.units[uid];
          if (unit) unit.location = { kind: 'base', player: unit.controller };
        }
        break;
    }

    done.push(instruction);
  }

  return { done, fizzled };
}

/** Whether every instruction can run without the player choosing anything. */
export function needsNoChoices(instructions: Instruction[]): boolean {
  return instructions.every((instruction) => {
    const selector =
      'target' in instruction ? instruction.target : 'who' in instruction ? instruction.who : null;
    if (!selector) return true;
    if (selector.kind === 'player' || selector.kind === 'self') return true;
    return !selector.chosen;
  });
}

export type { Card };
