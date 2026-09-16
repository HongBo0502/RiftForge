/**
 * The card-effect vocabulary.
 *
 * Riftbound's card text is formulaic, not prose: 1170 playable cards produce
 * 1833 sentences, and while those take ~950 distinct shapes, they are built from
 * about twenty verbs. So effects are *parsed* from the printed text rather than
 * hand-registered per card. A new set then works the day it is added, for every
 * sentence pattern already known — and anything the parser cannot read falls
 * through to the "apply by hand" panel rather than being guessed at.
 *
 * Rule numbers refer to docs/core-rules.txt.
 */

/** Whose objects a selector may pick. */
export type Side = 'friendly' | 'enemy' | 'any';

/** Where an object has to be. "here" means the ability's own location. */
export type Where = 'anywhere' | 'battlefield' | 'base' | 'here';

/**
 * What an instruction acts on.
 *
 * `chosen` selectors are Targets in the rules sense (355) — the player picks
 * them as the card is played, and they can stop being legal before it resolves
 * (359.3.e). `all` selectors are not choices (355.5.a) and are evaluated on
 * resolution.
 */
export type Selector =
  | { kind: 'self' }
  | { kind: 'unit'; side: Side; where: Where; chosen: boolean; count: number }
  | { kind: 'gear'; side: Side; where: Where; chosen: boolean; count: number }
  | { kind: 'player'; side: 'you' | 'opponent' | 'each' };

/** How long a modification lasts. 317.2.c */
export type Duration = 'thisTurn' | 'permanent';

/**
 * One executable instruction.
 *
 * Kept deliberately small and closed: a verb the engine cannot execute must not
 * parse at all, or the game would silently skip it.
 */
export type Instruction =
  | { verb: 'draw'; amount: number; who: Selector }
  | { verb: 'discard'; amount: number; who: Selector }
  /** 712 — "Deal N to X". Damage, not a Might change. */
  | { verb: 'deal'; amount: number; target: Selector }
  | { verb: 'might'; amount: number; target: Selector; duration: Duration }
  | { verb: 'kill'; target: Selector }
  | { verb: 'buff'; target: Selector }
  | { verb: 'stun'; target: Selector }
  | { verb: 'empower'; target: Selector }
  | { verb: 'disempower'; target: Selector }
  | { verb: 'ready'; target: Selector }
  | { verb: 'exhaust'; target: Selector }
  | { verb: 'gainXp'; amount: number; who: Selector }
  | { verb: 'gainPoints'; amount: number; who: Selector }
  | { verb: 'recall'; target: Selector };

export type Verb = Instruction['verb'];

/** When an ability fires. Null means it resolves as the card itself resolves. */
export type Trigger =
  | { on: 'play' }
  | { on: 'death' }
  | { on: 'attack' }
  | { on: 'defend' }
  | { on: 'attackOrDefend' }
  | { on: 'conquer' }
  | { on: 'empowered' };

export interface ParsedAbility {
  trigger: Trigger | null;
  instructions: Instruction[];
}

export interface ParsedCard {
  abilities: ParsedAbility[];
  /**
   * Sentences the parser could not read. These are what still reaches the
   * "apply by hand" panel — the honesty mechanism survives the parser.
   */
  unparsed: string[];
}

/** True when every sentence on the card was understood. */
export const fullyParsed = (parsed: ParsedCard): boolean => parsed.unparsed.length === 0;
