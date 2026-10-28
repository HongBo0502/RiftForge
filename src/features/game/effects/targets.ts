import type { Card } from '@/types';
import { type DependencyContext, conditionActive } from '../engine/keywords';
import type { GameState, PlayerId, Rejection } from '../engine/types';
import { resolve } from './execute';
import { onPlayAbilities } from './scripts';
import type { Instruction, Selector } from './types';

/**
 * Targeting. 355.6-355.8
 *
 * A card's script says what it chooses; this module turns that into the
 * questions a player has to answer before the card goes on the chain, and the
 * engine's answer to which choices are legal. The board asks here rather than
 * filtering the board itself, so "legal" has one definition.
 */

/** A selector that names something the player picks: a unit or a gear. */
export type ChosenSelector = Extract<Selector, { kind: 'unit' | 'gear' }>;

export const selectorOf = (instruction: Instruction): Selector | null =>
  'target' in instruction ? instruction.target : 'who' in instruction ? instruction.who : null;

const isChosen = (selector: Selector | null): selector is ChosenSelector =>
  selector !== null && (selector.kind === 'unit' || selector.kind === 'gear') && selector.chosen;

/** One question the player answers as the card is played. */
export interface TargetRequest {
  selector: ChosenSelector;
  /** The verb asking, for the prompt: "deal", "kill", "buff"… */
  verb: Instruction['verb'];
}

/**
 * What a card asks the player to choose as it is played, in the order its
 * instructions use them. Empty for a card that chooses nothing — or whose
 * choices the engine does not run, which stay "apply by hand".
 */
export function targetRequests(card: Card, context?: DependencyContext): TargetRequest[] {
  const out: TargetRequest[] = [];
  for (const ability of onPlayAbilities(card)) {
    if (ability.condition && context) {
      const { keyword, value } = ability.condition;
      if (!conditionActive(keyword, value, context)) continue;
    }
    for (const instruction of ability.instructions) {
      const selector = selectorOf(instruction);
      if (isChosen(selector)) out.push({ selector, verb: instruction.verb });
    }
  }
  return out;
}

/** Every object a request could legally pick right now. */
export function legalTargets(
  state: GameState,
  controller: PlayerId,
  selector: ChosenSelector,
  source?: string,
): string[] {
  // The same filter an "all units…" instruction uses, so the two cannot drift.
  return resolve(state, { ...selector, chosen: false }, { controller, source });
}

const VERB_PROMPT: Partial<Record<Instruction['verb'], string>> = {
  deal: 'deal damage to',
  might: 'change the Might of',
  kill: 'kill',
  buff: 'buff',
  stun: 'stun',
  empower: 'empower',
  disempower: 'disempower',
  ready: 'ready',
  exhaust: 'exhaust',
  recall: 'recall',
};

/** Plain-English prompt for a request: "Choose an enemy unit at a battlefield to kill". */
export function describeRequest(request: TargetRequest): string {
  const { selector } = request;
  const side = selector.side === 'friendly' ? 'friendly ' : selector.side === 'enemy' ? 'enemy ' : '';
  const noun = selector.kind === 'gear' ? 'gear' : 'unit';
  const where =
    selector.where === 'battlefield' ? ' at a battlefield' : selector.where === 'base' ? ' at a base' : '';
  // "an enemy unit", but "a unit" — the vowel sound, not the letter.
  const article = side === 'enemy ' ? 'an' : 'a';
  return `Choose ${article} ${side}${noun}${where} to ${VERB_PROMPT[request.verb] ?? request.verb}`;
}

/**
 * Checks and normalises the targets a play supplies. 355.8
 *
 * A spell must make a legal choice for every target or it cannot be played.
 * A permanent's "when you play me" ability is a triggered ability: with no
 * legal choice it simply does nothing, so its slot is left empty ('').
 * Returns the chosen list aligned to the requests, or a rejection.
 */
export function checkTargets(
  state: GameState,
  controller: PlayerId,
  card: Card,
  requests: TargetRequest[],
  targets: string[],
  source?: string,
): { ok: true; chosen: string[] } | Rejection {
  const chosen: string[] = [];
  for (const [i, request] of requests.entries()) {
    const options = legalTargets(state, controller, request.selector, source);
    if (options.length === 0) {
      if (card.type === 'Spell') {
        return { ok: false, reason: `${card.baseName} has no legal target.`, rule: '355.8' };
      }
      chosen.push('');
      continue;
    }
    const target = targets[i];
    if (!target) return { ok: false, reason: `${describeRequest(request)}.`, rule: '355.8' };
    if (!options.includes(target)) {
      return { ok: false, reason: `That is not a legal target for ${card.baseName}.`, rule: '355.8' };
    }
    chosen.push(target);
  }
  return { ok: true, chosen };
}

/**
 * A legal set of targets, picking the first option for each — only for the
 * hand's "could I play this?" hint, never to make a choice for the player.
 */
export function anyTargets(
  state: GameState,
  controller: PlayerId,
  card: Card,
  context?: DependencyContext,
): string[] {
  return targetRequests(card, context).map(
    (request) => legalTargets(state, controller, request.selector)[0] ?? '',
  );
}
