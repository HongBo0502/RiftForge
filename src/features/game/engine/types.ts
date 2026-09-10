import type { Domain } from '@/types';
import type { PaymentPlan } from './payment';

/**
 * Game state and actions for the Riftbound engine.
 *
 * The engine is a pure `(state, action) => state` reducer: no React, no I/O,
 * and no randomness outside the seeded RNG carried in the state. That makes it
 * unit-testable, gives undo and replay for free from the action log, and means
 * online play can later relay actions between two clients running the same
 * reducer instead of syncing state.
 *
 * Rule numbers in comments refer to docs/core-rules.txt (Core Rules 2026-07-16).
 */

export type PlayerId = 'p1' | 'p2';

export const OPPONENT: Record<PlayerId, PlayerId> = { p1: 'p2', p2: 'p1' };

/** Turn phases, in order. 314-317 */
export type Phase = 'awaken' | 'beginning' | 'channel' | 'draw' | 'main' | 'ending';

export const PHASE_ORDER: Phase[] = ['awaken', 'beginning', 'channel', 'draw', 'main', 'ending'];

/** Where a permanent sits. Battlefields are indexed 0..n-1. 197-200 */
export type Location =
  | { kind: 'base'; player: PlayerId }
  | { kind: 'battlefield'; index: number };

export function sameLocation(a: Location, b: Location): boolean {
  if (a.kind === 'base' && b.kind === 'base') return a.player === b.player;
  if (a.kind === 'battlefield' && b.kind === 'battlefield') return a.index === b.index;
  return false;
}

/** A physical card in the game, tracked by instance so copies stay distinct. */
export interface CardInstance {
  uid: string;
  cardId: string;
  owner: PlayerId;
}

/** A unit on the board. 140-146 */
export interface UnitState {
  uid: string;
  controller: PlayerId;
  location: Location;
  /** Exhausted units can't move or be exhausted again until they ready. 415 */
  ready: boolean;
  /** Marked damage. Cleared by "Heal all Units" in combat and end-of-turn cleanups. */
  damage: number;
  /** Might granted by "this turn" effects; expires in the Ending Phase. 317.2.c */
  mightBonus: number;
  /** Set during combat. 464.2.c */
  designation: 'attacker' | 'defender' | null;
  /** Turn this unit arrived, so summoning-turn restrictions can be checked. */
  enteredOnTurn: number;
  movesThisTurn: number;
}

/** A rune in play. Runes are not permanents. 161.1 */
export interface RuneState {
  uid: string;
  controller: PlayerId;
  ready: boolean;
}

/**
 * A face-down hidden card at a battlefield. Its identity lives only here, in
 * the owner's private view — `redact` strips `cardId` for anyone else.
 */
export interface HiddenState {
  uid: string;
  controller: PlayerId;
  battlefield: number;
  /** Hidden cards only gain Reaction from their owner's next turn. */
  hiddenOnTurn: number;
}

export interface BattlefieldState {
  /** The battlefield card itself. */
  uid: string;
  contributedBy: PlayerId;
  /** Null while uncontrolled. 188-190 */
  controller: PlayerId | null;
  /** Set when units of two players are present. 461 */
  contested: boolean;
  /** Players who have already Scored here this turn — once each per turn. 470 */
  scoredBy: PlayerId[];
}

export interface PlayerState {
  id: PlayerId;
  legendCardId: string;
  championCardId: string;
  /**
   * The Chosen Champion, playable from here as normal and public information.
   * Null once it has been played. 108.3
   */
  championZone: string | null;
  hand: string[];
  mainDeck: string[];
  runeDeck: string[];
  trash: string[];
  points: number;
  /** Rune Pool. Empties at the start of each Main Phase and each turn's end. 167 */
  energy: number;
  power: Partial<Record<Domain, number>>;
  /** Set once the player has drawn from an empty deck. 431 */
  burnedOut: boolean;
}

/** An open showdown window. 341-348 */
export interface ShowdownState {
  battlefield: number;
  /** Combat showdowns run the damage step on close; non-combat ones don't. 316.8.b.1 */
  combat: boolean;
  attacker: PlayerId;
  defender: PlayerId;
  /** Player who may act. 345-347 */
  focus: PlayerId;
  /** Consecutive passes; the showdown closes when everyone passes in turn. 347.2.a */
  passes: number;
}

export interface LogEntry {
  turn: number;
  phase: Phase;
  player: PlayerId | null;
  text: string;
  /** Core Rules reference, when the line reflects a specific rule. */
  rule?: string;
}

export interface GameState {
  /** Seeded so shuffles and setup are reproducible from the action log. */
  rng: number;
  turn: number;
  turnPlayer: PlayerId;
  firstPlayer: PlayerId;
  phase: Phase;
  players: Record<PlayerId, PlayerState>;
  instances: Record<string, CardInstance>;
  units: Record<string, UnitState>;
  runes: Record<string, RuneState>;
  hidden: Record<string, HiddenState>;
  battlefields: BattlefieldState[];
  showdown: ShowdownState | null;
  /** 8 by default in 1v1. 194.3 / 485.3 */
  victoryScore: number;
  winner: PlayerId | null;
  log: LogEntry[];
  /** Card texts the engine did not automate, surfaced so nothing looks resolved. */
  unautomated: string[];
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export type GameAction =
  /** Advance through the automatic start-of-turn phases. */
  | { type: 'ADVANCE_PHASE' }
  /** Exhaust a ready rune for 1 Energy. 164.2.a */
  | { type: 'EXHAUST_RUNE'; uid: string }
  /** Recycle a rune for 1 Power of its domain. 164.2.b */
  | { type: 'RECYCLE_RUNE'; uid: string }
  /** Play a card from hand, optionally to a battlefield. 349-359 */
  | {
      type: 'PLAY_CARD';
      uid: string;
      to?: Location;
      /**
       * Which runes to spend. Omit to let the engine choose (auto-pay); supply
       * one to override, e.g. to keep a particular domain rune on the board.
       */
      payment?: PaymentPlan;
    }
  /** Standard move of a ready unit. 447 */
  | { type: 'MOVE_UNIT'; uid: string; to: Location }
  /** Pass focus during a showdown. 347.2 */
  | { type: 'SHOWDOWN_PASS' }
  | { type: 'END_TURN' }
  | { type: 'CONCEDE'; player: PlayerId };

/** Why an action was rejected, for the UI to explain rather than ignore. */
export interface Rejection {
  ok: false;
  reason: string;
  rule?: string;
}

export type ActionResult = { ok: true; state: GameState } | Rejection;
