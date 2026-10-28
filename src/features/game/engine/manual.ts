import type { Card } from '@/types';
import { cleanup } from './cleanup';
import { unautomatedText } from './keywords';
import { shuffle } from './rng';
import { channelRunes, checkVictory, drawCard } from './scoring';
import type { GameState, Location, PlayerId, Rejection } from './types';

/**
 * The free board: changes a player makes by hand. DESIGN-HANDOFF.md
 *
 * Riftbound has hundreds of card effects and the engine automates a fraction
 * of them. Rather than leave every other card unplayable, the board works like
 * a table: any card can be moved anywhere, counters changed, points adjusted.
 * The rules engine still runs every action that has a rules form (PLAY_CARD,
 * MOVE_UNIT, …); these ops are what a player reaches for when it says no, or
 * when a card's text has to be applied by hand.
 *
 * Two things are still enforced, because they are not rules but fairness:
 * nobody takes cards out of the other player's hand or deck, and everything
 * done by hand is written to the log, so the other player can see it.
 */

type CardLookup = (cardId: string) => Card | undefined;

/** Where a card can be put by hand. Board locations reuse `Location`. */
export type ManualZone =
  | Location
  | { kind: 'hand' }
  | { kind: 'trash' }
  | { kind: 'deckTop' }
  | { kind: 'deckBottom' };

export type ManualOp =
  /** Put a card anywhere: board, hand, trash, top or bottom of the deck. */
  | { op: 'move'; uid: string; to: ManualZone }
  /** Play a card from hand ignoring cost and timing; no effects are applied. */
  | { op: 'play'; uid: string; to?: Location }
  /** Toggle a unit, gear or rune between ready and exhausted. */
  | { op: 'ready'; uid: string }
  | { op: 'damage'; uid: string; delta: number }
  | { op: 'buff'; uid: string; delta: number }
  | { op: 'stun'; uid: string }
  | { op: 'empower'; uid: string }
  /** Attach gear to a unit, or detach it with `unitUid: null`. */
  | { op: 'attach'; uid: string; unitUid: string | null }
  | { op: 'points'; player: PlayerId; delta: number }
  | { op: 'xp'; player: PlayerId; delta: number }
  | { op: 'energy'; player: PlayerId; delta: number }
  | { op: 'draw'; player: PlayerId }
  | { op: 'shuffle'; player: PlayerId }
  | { op: 'channel'; player: PlayerId }
  | { op: 'control'; battlefield: number; controller: PlayerId | null }
  /** Empty the chain and close any showdown — the way out of a stuck state. */
  | { op: 'clearStack' };

const reject = (reason: string): Rejection => ({ ok: false, reason });

const PLAYERS: PlayerId[] = ['p1', 'p2'];

type Source = 'board' | 'rune' | 'hidden' | 'hand' | 'champion' | 'trash' | 'mainDeck' | 'chain';

function log(state: GameState, player: PlayerId, text: string): void {
  state.log.push({ turn: state.turn, phase: state.phase, player, text: `By hand: ${text}` });
}

/** Which zone a card instance is in right now. */
function whereIs(state: GameState, uid: string): Source | null {
  if (state.units[uid] || state.gear[uid]) return 'board';
  if (state.runes[uid]) return 'rune';
  if (state.hidden[uid]) return 'hidden';
  if (state.chain.some((item) => item.uid === uid)) return 'chain';
  for (const id of PLAYERS) {
    const p = state.players[id];
    if (p.hand.includes(uid)) return 'hand';
    if (p.championZone === uid) return 'champion';
    if (p.trash.includes(uid)) return 'trash';
    if (p.mainDeck.includes(uid)) return 'mainDeck';
  }
  return null;
}

/**
 * Takes a card out of every zone. Leaving the board wipes its board state
 * (102), and gear attached to it goes home, as `toZone` does.
 */
function removeEverywhere(state: GameState, uid: string): void {
  delete state.units[uid];
  delete state.gear[uid];
  delete state.hidden[uid];
  for (const gear of Object.values(state.gear)) {
    if (gear.attachedTo === uid) {
      gear.attachedTo = null;
      gear.location = { kind: 'base', player: gear.controller };
    }
  }
  for (const id of PLAYERS) {
    const p = state.players[id];
    p.hand = p.hand.filter((u) => u !== uid);
    p.trash = p.trash.filter((u) => u !== uid);
    p.mainDeck = p.mainDeck.filter((u) => u !== uid);
    if (p.championZone === uid) p.championZone = null;
  }
}

/** Who controls a card put on a board location: the base's player, else whoever put it there. */
const controllerAt = (to: Location, actor: PlayerId): PlayerId =>
  to.kind === 'base' ? to.player : actor;

function placeName(actor: PlayerId, to: ManualZone): string {
  switch (to.kind) {
    case 'base':
      return to.player === actor ? 'their base' : "the opponent's base";
    case 'battlefield':
      return `battlefield ${to.index + 1}`;
    case 'hand':
      return 'hand';
    case 'trash':
      return 'the trash';
    case 'deckTop':
      return 'the top of the deck';
    case 'deckBottom':
      return 'the bottom of the deck';
  }
}

/** Puts a card that is not yet on the board onto it. */
function enterBoard(
  state: GameState,
  uid: string,
  card: Card,
  to: Location,
  actor: PlayerId,
): Rejection | null {
  if (to.kind === 'battlefield' && !state.battlefields[to.index]) return reject('No such battlefield.');
  const controller = controllerAt(to, actor);
  if (card.type === 'Unit') {
    removeEverywhere(state, uid);
    state.units[uid] = {
      uid,
      controller,
      location: to,
      // 178.1.a.1 — the default. One tap readies it if a card says otherwise.
      ready: false,
      damage: 0,
      mightBonus: 0,
      buffs: 0,
      stunned: false,
      empowered: false,
      designation: null,
      enteredOnTurn: state.turn,
      movesThisTurn: 0,
    };
    return null;
  }
  if (card.type === 'Gear') {
    if (to.kind === 'battlefield') {
      return reject('Gear goes to a base — attach it to a unit to take it to a battlefield.');
    }
    removeEverywhere(state, uid);
    state.gear[uid] = { uid, controller, location: to, ready: true, attachedTo: null };
    return null;
  }
  return reject("Spells don't stay on the board — play it, or move it to the trash.");
}

function move(
  state: GameState,
  actor: PlayerId,
  uid: string,
  to: ManualZone,
  lookup: CardLookup,
): Rejection | null {
  const instance = state.instances[uid];
  if (!instance) return reject('No such card.');
  const card = lookup(instance.cardId);
  const from = whereIs(state, uid);
  if (!from) return reject('That card cannot be moved.');
  if (from === 'rune') return reject('Runes stay in the rune row — exhaust or recycle them instead.');
  if (from === 'chain') return reject('That card is on the chain — clear the chain first.');
  if ((from === 'hand' || from === 'mainDeck' || from === 'champion') && instance.owner !== actor) {
    return reject("You can't take cards from the other player's hand or deck.");
  }

  // Only name the card when it is public on one side of the move; a card
  // going from hand to the deck stays secret.
  const isPublic =
    ['board', 'trash', 'hidden', 'champion'].includes(from) ||
    ['base', 'battlefield', 'trash'].includes(to.kind);
  const name = isPublic ? (card?.baseName ?? 'a card') : 'a card';

  if (to.kind === 'base' || to.kind === 'battlefield') {
    if (to.kind === 'battlefield' && !state.battlefields[to.index]) return reject('No such battlefield.');
    const unit = state.units[uid];
    const gear = state.gear[uid];
    if (unit) {
      // A move within the board is not a zone change: damage and statuses stay.
      unit.location = to;
      if (to.kind === 'base') unit.controller = to.player;
      for (const g of Object.values(state.gear)) {
        if (g.attachedTo === uid) g.location = to;
      }
    } else if (gear) {
      if (to.kind === 'battlefield') {
        return reject('Gear goes to a base — attach it to a unit to take it to a battlefield.');
      }
      gear.controller = to.player;
      gear.location = to;
      gear.attachedTo = null;
    } else {
      if (!card) return reject('Unknown card.');
      const refused = enterBoard(state, uid, card, to, actor);
      if (refused) return refused;
    }
    log(state, actor, `moved ${name} to ${placeName(actor, to)}.`);
    cleanup(state);
    return null;
  }

  removeEverywhere(state, uid);
  const owner = state.players[instance.owner];
  if (to.kind === 'hand') owner.hand.push(uid);
  else if (to.kind === 'trash') owner.trash.push(uid);
  else if (to.kind === 'deckTop') owner.mainDeck.unshift(uid);
  else owner.mainDeck.push(uid);
  log(state, actor, `moved ${name} to ${placeName(actor, to)}.`);
  cleanup(state);
  return null;
}

function play(
  state: GameState,
  actor: PlayerId,
  uid: string,
  to: Location | undefined,
  lookup: CardLookup,
): Rejection | null {
  const p = state.players[actor];
  const hidden = state.hidden[uid];
  const available =
    p.hand.includes(uid) || p.championZone === uid || Boolean(hidden && hidden.controller === actor);
  if (!available) return reject('That card is not in your hand.');
  const card = lookup(state.instances[uid]?.cardId ?? '');
  if (!card) return reject('Unknown card.');

  if (card.type === 'Unit' || card.type === 'Gear') {
    const refused = enterBoard(state, uid, card, to ?? { kind: 'base', player: actor }, actor);
    if (refused) return refused;
  } else {
    removeEverywhere(state, uid);
    p.trash.push(uid);
  }
  p.finalizedThisTurn.push(uid);

  // Nothing was automated, so all of the card's text is the player's to apply.
  const text = unautomatedText(card);
  if (text) state.unautomated.push(`${card.baseName}: ${text.replace(/\n/g, ' ')}`);
  log(state, actor, `played ${card.baseName} without paying its cost — apply its text by hand.`);
  cleanup(state);
  return null;
}

/** Applies one manual op to a draft. Returns a rejection, or null on success. */
export function applyManual(
  state: GameState,
  actor: PlayerId,
  op: ManualOp,
  lookup: CardLookup,
): Rejection | null {
  const nameOf = (uid: string): string =>
    lookup(state.instances[uid]?.cardId ?? '')?.baseName ?? 'a card';
  const whose = (player: PlayerId): string => (player === actor ? 'their' : "the opponent's");

  switch (op.op) {
    case 'move':
      return move(state, actor, op.uid, op.to, lookup);

    case 'play':
      return play(state, actor, op.uid, op.to, lookup);

    case 'ready': {
      const piece = state.units[op.uid] ?? state.gear[op.uid] ?? state.runes[op.uid];
      if (!piece) return reject('Only units, gear and runes can be readied or exhausted.');
      piece.ready = !piece.ready;
      log(state, actor, `${piece.ready ? 'readied' : 'exhausted'} ${nameOf(op.uid)}.`);
      return null;
    }

    case 'damage':
    case 'buff': {
      const unit = state.units[op.uid];
      if (!unit) return reject('Only units take damage and buffs.');
      if (op.op === 'damage') unit.damage = Math.max(0, unit.damage + op.delta);
      else unit.buffs = Math.max(0, unit.buffs + op.delta);
      const value = op.op === 'damage' ? unit.damage : unit.buffs;
      const label = op.op === 'damage' ? 'damage' : `buff${value === 1 ? '' : 's'}`;
      log(state, actor, `${nameOf(op.uid)} now has ${value} ${label}.`);
      return null;
    }

    case 'stun':
    case 'empower': {
      const unit = state.units[op.uid];
      if (!unit) return reject('Only units can be stunned or empowered.');
      const key = op.op === 'stun' ? 'stunned' : 'empowered';
      unit[key] = !unit[key];
      log(state, actor, `${nameOf(op.uid)} is ${unit[key] ? '' : 'no longer '}${key}.`);
      return null;
    }

    case 'attach': {
      const gear = state.gear[op.uid];
      if (!gear) return reject('Only gear can be attached.');
      if (op.unitUid === null) {
        gear.attachedTo = null;
        gear.location = { kind: 'base', player: gear.controller };
        log(state, actor, `detached ${nameOf(op.uid)}.`);
        return null;
      }
      const unit = state.units[op.unitUid];
      if (!unit) return reject('Attach gear to a unit.');
      gear.attachedTo = unit.uid;
      gear.location = unit.location;
      log(state, actor, `attached ${nameOf(op.uid)} to ${nameOf(unit.uid)}.`);
      return null;
    }

    case 'points':
    case 'xp':
    case 'energy': {
      const p = state.players[op.player];
      p[op.op] = Math.max(0, p[op.op] + op.delta);
      const label = op.op === 'points' ? 'points' : op.op === 'xp' ? 'XP' : 'Energy';
      log(state, actor, `set ${whose(op.player)} ${label} to ${p[op.op]}.`);
      if (op.op === 'points') checkVictory(state);
      return null;
    }

    case 'draw': {
      drawCard(state, op.player);
      log(state, actor, op.player === actor ? 'drew a card.' : 'made the opponent draw a card.');
      checkVictory(state);
      return null;
    }

    case 'shuffle': {
      // Seeded, so both online clients shuffle the same way.
      const shuffled = shuffle(state.players[op.player].mainDeck, state.rng);
      state.rng = shuffled.seed;
      state.players[op.player].mainDeck = shuffled.items;
      log(state, actor, `shuffled ${whose(op.player)} deck.`);
      return null;
    }

    case 'channel': {
      if (channelRunes(state, op.player, 1) === 0) return reject('The rune deck is empty.');
      log(state, actor, `channelled 1 rune${op.player === actor ? '' : ' for the opponent'}.`);
      return null;
    }

    case 'control': {
      const bf = state.battlefields[op.battlefield];
      if (!bf) return reject('No such battlefield.');
      bf.controller = op.controller;
      bf.contested = false;
      const holder = op.controller ? `held by ${op.controller === actor ? 'them' : 'the opponent'}` : 'uncontrolled';
      log(state, actor, `battlefield ${op.battlefield + 1} is now ${holder}.`);
      return null;
    }

    case 'clearStack': {
      if (state.chain.length === 0 && !state.showdown) return reject('Nothing to clear.');
      // A spell that never resolved still goes to its owner's trash. 359.3.d
      for (const item of state.chain) {
        const owner = state.instances[item.uid]?.owner;
        if (item.kind === 'spell' && owner) state.players[owner].trash.push(item.uid);
      }
      state.chain = [];
      state.priority = null;
      state.chainPasses = 0;
      state.showdown = null;
      for (const unit of Object.values(state.units)) unit.designation = null;
      for (const bf of state.battlefields) bf.contested = false;
      log(state, actor, 'cleared the chain and any showdown.');
      return null;
    }
  }
}
