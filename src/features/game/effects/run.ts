import type { Card } from '@/types';
import { unitMight } from '../engine/combat';
import { conditionActive, dependencyContext, unautomatedText } from '../engine/keywords';
import type { GameState, PlayerId } from '../engine/types';
import { execute, needsNoChoices } from './execute';
import { BOARD_STATE_VERBS, clearParseCache, parseCardCached } from './parse';
import type { ActivatedAbility } from './types';

/** The bridge between a resolving card and its printed text. Cached by card id. */
const parsedFor = parseCardCached;

/** Whether every instruction in an ability is one `execute()` never runs. */
const isBoardState = (instructions: { verb: string }[]): boolean =>
  instructions.every((i) => (BOARD_STATE_VERBS as readonly string[]).includes(i.verb));

export interface RunResult {
  /** How many instructions the engine actually carried out. */
  ran: number;
  /** Text the player still has to apply themselves, or null if none. */
  leftover: string | null;
}

/**
 * Runs whatever of a card's text the engine understands, and reports the rest.
 *
 * Two things are deliberately conservative here:
 *
 * 1. An ability with a **trigger** is not run. "When I die, draw 1" must fire on
 *    death, not when the card resolves, and triggered abilities do not reach the
 *    chain yet (383).
 * 2. An ability needing the player to **choose** a target is not run, because
 *    nothing in the board asks them to choose yet. Picking one for them would be
 *    the engine making a play decision.
 *
 * Everything not run is reported as leftover, so the "apply by hand" panel still
 * accounts for all of it.
 */
export function runCardEffects(
  state: GameState,
  card: Card,
  controller: PlayerId,
  source: string,
  lookup: (cardId: string) => Card | undefined,
): RunResult {
  const parsed = parsedFor(card);
  const might = (uid: string) => unitMight(state, uid, lookup);

  const here =
    state.units[source]?.location.kind === 'battlefield'
      ? (state.units[source].location as { kind: 'battlefield'; index: number }).index
      : undefined;

  let ran = 0;
  const deferred: string[] = [];

  for (const ability of parsed.abilities) {
    // Board-state abilities (staticMight, entersReady, entersExhausted) are
    // read directly by combat.ts/reducer.ts, not run here — see BOARD_STATE_VERBS.
    if (isBoardState(ability.instructions)) continue;
    if (ability.trigger !== null) {
      deferred.push('a triggered ability');
      continue;
    }
    if (!needsNoChoices(ability.instructions)) {
      deferred.push('an ability that needs a target');
      continue;
    }

    const report = execute(state, ability.instructions, { controller, source, here }, might);
    ran += report.done.length;
  }

  /*
   * What the player is told. Sentences the parser could not read are quoted
   * verbatim; abilities it read but chose not to run are summarised, because
   * quoting them would suggest the engine did not understand them when it did.
   */
  const unread = parsed.unparsed.join(' ');
  const held = deferred.length > 0 ? `Not applied automatically: ${deferred.join(', ')}.` : '';
  const leftover = [unread, held].filter(Boolean).join(' ').trim();

  if (leftover) return { ran, leftover };

  /*
   * Nothing left over from the parser. Fall back to the keyword reader, which
   * still catches text made of keywords the parser has no verb for.
   */
  const manual = unautomatedText(card, dependencyContext(state, controller, source));
  return { ran, leftover: parsed.abilities.length > 0 ? null : manual };
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

/** Test seam: clears the memoised parses. */
export const clearEffectCache = clearParseCache;
