import type { Card } from '@/types';
import { unitMight } from '../engine/combat';
import { dependencyContext, unautomatedText } from '../engine/keywords';
import type { GameState, PlayerId } from '../engine/types';
import { execute, needsNoChoices } from './execute';
import { parseCard } from './parse';

/**
 * The bridge between a resolving card and its printed text.
 *
 * Parsing is pure and cheap, but it is the same answer every time for a given
 * card, so results are memoised by card id.
 */
const cache = new Map<string, ReturnType<typeof parseCard>>();

function parsedFor(card: Card) {
  const hit = cache.get(card.id);
  if (hit) return hit;
  const parsed = parseCard(card);
  cache.set(card.id, parsed);
  return parsed;
}

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

/** Test seam: clears the memoised parses. */
export function clearEffectCache(): void {
  cache.clear();
}
