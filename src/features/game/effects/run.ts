import type { Card } from '@/types';
import { unitMight } from '../engine/combat';
import { conditionActive, dependencyContext } from '../engine/keywords';
import type { GameState, PlayerId } from '../engine/types';
import { execute, needsNoChoices } from './execute';
import { manualText, onPlayAbilities, scriptFor } from './scripts';
import { selectorOf } from './targets';
import type { ActivatedAbility } from './types';

/** A card's effects come from its script, never from its printed text. */
const parsedFor = scriptFor;

export interface RunResult {
  /** How many instructions the engine actually carried out. */
  ran: number;
  /** Text the player still has to apply themselves, or null if none. */
  leftover: string | null;
}

/**
 * Runs the abilities a card carries out as it is played — a spell's text as it
 * resolves, or a permanent's "When you play me" — and reports the rest.
 *
 * `chosen` holds the targets picked when the card was played, aligned to
 * `targetRequests(card)`; each ability takes its share in order. A target that
 * has gone, or a slot left empty because nothing was legal, skips only its own
 * instruction (359.3.e.7) — "Deal 4 to a unit. Draw 1." still draws.
 *
 * Abilities the engine does not run (`isRunnable`) are not attempted here;
 * `manualText` then hands the player the whole card, so none of it is lost.
 */
export function runCardEffects(
  state: GameState,
  card: Card,
  controller: PlayerId,
  source: string,
  lookup: (cardId: string) => Card | undefined,
  chosen: string[] = [],
): RunResult {
  const might = (uid: string) => unitMight(state, uid, lookup);
  const location = state.units[source]?.location;
  const here = location?.kind === 'battlefield' ? location.index : undefined;
  const context = dependencyContext(state, controller, source);

  let ran = 0;
  let next = 0;
  for (const ability of onPlayAbilities(card)) {
    // Choices were asked for with the same condition check at play time; no
    // ability that chooses carries a condition today, so the two cannot split.
    if (ability.condition) {
      const { keyword, value } = ability.condition;
      if (!conditionActive(keyword, value, context)) continue;
    }
    const needs = ability.instructions.filter((i) => {
      const selector = selectorOf(i);
      return selector !== null && selector.kind !== 'player' && selector.kind !== 'self' && selector.chosen;
    }).length;
    const mine = chosen.slice(next, next + needs);
    next += needs;
    const report = execute(state, ability.instructions, { controller, source, here, chosen: mine }, might);
    ran += report.done.length;
  }

  const manual = manualText(card, context);
  return { ran, leftover: manual ? manual.replace(/\n/g, ' ') : null };
}

/**
 * The single Activated Ability on `card` that is unambiguous to offer right
 * now, or null. 145.1, 151.1
 *
 * "Unambiguous" means exactly one parsed Activated Ability whose Dependent
 * Keyword condition (if any) currently holds — a card with two candidates
 * active at once has no automatic offer, because picking one for the player
 * would be the engine making a play decision (same refusal the Equip and
 * targeting paths already use).
 */
export function activatableAbility(
  state: GameState,
  controller: PlayerId,
  uid: string,
  card: Card,
): ActivatedAbility | null {
  const parsed = parsedFor(card);
  if (parsed.activatedAbilities.length === 0) return null;
  const context = dependencyContext(state, controller, uid);
  const eligible = parsed.activatedAbilities.filter(
    (a) => !a.condition || conditionActive(a.condition.keyword, a.condition.value, context),
  );
  return eligible.length === 1 ? eligible[0] : null;
}

/**
 * Runs an Activated Ability's effect once its cost has already been paid and
 * it has resolved off the chain. 145.1, 151.1
 *
 * Like `runCardEffects`, an effect needing the player to choose a target is
 * not run — nothing in the board asks them to choose yet.
 */
export function runActivatedAbility(
  state: GameState,
  ability: ActivatedAbility,
  controller: PlayerId,
  source: string,
  lookup: (cardId: string) => Card | undefined,
): RunResult {
  const might = (uid: string) => unitMight(state, uid, lookup);
  const here =
    state.units[source]?.location.kind === 'battlefield'
      ? (state.units[source].location as { kind: 'battlefield'; index: number }).index
      : undefined;

  if (!needsNoChoices(ability.instructions)) {
    return { ran: 0, leftover: 'Not applied automatically: an ability that needs a target.' };
  }
  const report = execute(state, ability.instructions, { controller, source, here }, might);
  return { ran: report.done.length, leftover: null };
}

