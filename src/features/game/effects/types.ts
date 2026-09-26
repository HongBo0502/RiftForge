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

/** The three Dependent Keywords that can gate an ability. 727 */
export type DependentKeyword = 'Legion' | 'Level' | 'Empowered';

/**
 * A Dependent Keyword clause gating an ability, e.g. `[Empowered][>]`. 727
 *
 * `value` is the N in `[Level N]`; null for keywords that carry no value.
 * The engine already tracks XP, "played another card this turn" and the
 * Empowered status (`engine/keywords.ts`), so this is read, not guessed.
 */
export interface Condition {
  keyword: DependentKeyword;
  value: number | null;
}

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
  | { verb: 'recall'; target: Selector }
  /** "Channel N rune(s) exhausted." 430 — deterministic, so not a choice. */
  | { verb: 'channel'; amount: number; ready: boolean }
  /*
   * The next three are never dispatched through `execute()` — they describe
   * board state, not a one-shot or triggered event, so they are read directly
   * by `combat.ts` (continuously, for `staticMight`) and `reducer.ts` (once,
   * at the moment a permanent enters). See effects/parse.ts's `BOARD_STATE_VERBS`.
   */
  /** "I have +N Might." — a continuous stat line, not a one-shot change. 143 */
  | { verb: 'staticMight'; amount: number }
  /** "I enter ready." — overrides 178.1.a.1's default for a Unit. */
  | { verb: 'entersReady' }
  /** "This enters exhausted." — overrides 147's default for Gear. */
  | { verb: 'entersExhausted' };

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
  /** The Dependent Keyword gating this ability, if any. Null means always active. */
  condition: Condition | null;
}

/**
 * What an Activated Ability's cost actually is. 145.1/151.1/818.1.c
 *
 * Same resource grammar as Equip's cost (energy/power/anyPower), plus
 * `exhaustSelf` for the `:rb_exhaust:` token that means "exhaust the
 * permanent this ability is printed on" — the source, not a rune.
 */
export interface ActivatedCost {
  energy: number;
  power: Partial<Record<import('@/types').Domain, number>>;
  anyPower: number;
  exhaustSelf: boolean;
}

/**
 * A parsed "<cost>: <effect>" line. 145.1, 151.1
 *
 * Only ever built from a cost this reader fully understands and an effect
 * every instruction of which already parses — anything else is refused, not
 * guessed, and the line stays in `unparsed`.
 */
export interface ActivatedAbility {
  cost: ActivatedCost;
  instructions: Instruction[];
  condition: Condition | null;
}

export interface ParsedCard {
  abilities: ParsedAbility[];
  /** "<cost>: <effect>" lines this card carries. 145.1, 151.1 */
  activatedAbilities: ActivatedAbility[];
  /**
   * Sentences the parser could not read. These are what still reaches the
   * "apply by hand" panel — the honesty mechanism survives the parser.
   */
  unparsed: string[];
}

/** True when every sentence on the card was understood. */
export const fullyParsed = (parsed: ParsedCard): boolean => parsed.unparsed.length === 0;
