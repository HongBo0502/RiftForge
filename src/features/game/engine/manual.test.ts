import { beforeEach, describe, expect, it } from 'vitest';
import type { Card } from '@/types';
import { BY_ID, CARDS, card } from '@/test/dataset';
import type { Deck } from '@/features/decks/types';
import { emptyDeck } from '@/features/decks/types';
import type { ManualOp } from './manual';
import { reduce, startGame } from './reducer';
import { resetUids, setupGame } from './setup';
import type { GameState, PlayerId } from './types';

/**
 * The free board (manual.ts): changes made by hand. These must work where the
 * rules engine would refuse — that is their whole point — while still keeping
 * the other player's hand and deck out of reach and logging everything.
 */

const lookup = (cardId: string): Card | undefined => BY_ID.get(cardId);

const legend = card('Teemo - Swift Scout');
const champion = card('Teemo - Strategist');
const mindRune = CARDS.find((c) => c.type === 'Rune' && c.domains[0] === 'Mind')!;
const battlefieldCards = CARDS.filter((c) => c.type === 'Battlefield').slice(0, 6);
const units = CARDS.filter((c) => c.type === 'Unit' && !c.signature).slice(0, 20);
const gearCard = CARDS.find((c) => c.type === 'Gear')!;
const spellCard = CARDS.find((c) => c.type === 'Spell' && c.text)!;

function makeDeck(offset: number): Deck {
  const deck = emptyDeck('deck');
  deck.legendId = legend.id;
  deck.championId = champion.id;
  deck.main = units.map((u) => ({ cardId: u.id, qty: 2 }));
  deck.runes = [{ cardId: mindRune.id, qty: 12 }];
  deck.battlefields = battlefieldCards.slice(offset, offset + 3).map((b) => b.id);
  return deck;
}

function newGame(): GameState {
  resetUids();
  return startGame(
    setupGame({ decks: { p1: makeDeck(0), p2: makeDeck(3) }, byId: BY_ID, seed: 11, firstPlayer: 'p1' }),
    lookup,
  );
}

function manual(state: GameState, op: ManualOp): GameState {
  const result = reduce(state, { type: 'MANUAL', op }, lookup);
  if (!result.ok) throw new Error(`${op.op} rejected: ${result.reason}`);
  return result.state;
}

function refusal(state: GameState, op: ManualOp): string {
  const result = reduce(state, { type: 'MANUAL', op }, lookup);
  if (result.ok) throw new Error(`${op.op} was accepted`);
  return result.reason;
}

/** Puts a card of the given kind into a player's hand. */
function give(state: GameState, player: PlayerId, c: Card, uid: string): GameState {
  const next = structuredClone(state);
  next.instances[uid] = { uid, cardId: c.id, owner: player };
  next.players[player].hand.push(uid);
  return next;
}

const lastLog = (state: GameState) => state.log[state.log.length - 1].text;

describe('free board', () => {
  let game: GameState;
  beforeEach(() => {
    game = newGame();
  });

  it('plays a unit by hand with no cost paid, anywhere, and flags all its text', () => {
    const uid = game.players.p1.hand[0];
    const energyBefore = game.players.p1.energy;
    const next = manual(game, { op: 'play', uid, to: { kind: 'battlefield', index: 1 } });

    expect(next.units[uid].location).toEqual({ kind: 'battlefield', index: 1 });
    expect(next.units[uid].controller).toBe('p1');
    expect(next.players.p1.hand).not.toContain(uid);
    expect(next.players.p1.energy).toBe(energyBefore);
    expect(lastLog(next)).toMatch(/^By hand: played .* without paying its cost/);
  });

  it('plays a spell by hand straight to the trash', () => {
    const withSpell = give(game, 'p1', spellCard, 'spell-1');
    const next = manual(withSpell, { op: 'play', uid: 'spell-1' });
    expect(next.players.p1.trash).toContain('spell-1');
    expect(next.chain).toHaveLength(0);
    expect(next.unautomated.at(-1)).toContain(spellCard.baseName);
  });

  it('puts gear at a base, and attaches and detaches it', () => {
    const withGear = give(game, 'p1', gearCard, 'gear-1');
    const unitUid = withGear.players.p1.hand[0];
    let next = manual(withGear, { op: 'play', uid: 'gear-1' });
    next = manual(next, { op: 'play', uid: unitUid, to: { kind: 'battlefield', index: 0 } });
    expect(next.gear['gear-1'].location).toEqual({ kind: 'base', player: 'p1' });

    next = manual(next, { op: 'attach', uid: 'gear-1', unitUid });
    expect(next.gear['gear-1'].attachedTo).toBe(unitUid);
    expect(next.gear['gear-1'].location).toEqual({ kind: 'battlefield', index: 0 });

    next = manual(next, { op: 'attach', uid: 'gear-1', unitUid: null });
    expect(next.gear['gear-1'].location).toEqual({ kind: 'base', player: 'p1' });
  });

  it('moves a unit between board locations keeping its damage, and off the board wiping it', () => {
    const uid = game.players.p1.hand[0];
    let next = manual(game, { op: 'play', uid });
    next = manual(next, { op: 'damage', uid, delta: 2 });
    next = manual(next, { op: 'move', uid, to: { kind: 'battlefield', index: 0 } });
    expect(next.units[uid].damage).toBe(2);

    next = manual(next, { op: 'move', uid, to: { kind: 'trash' } });
    expect(next.units[uid]).toBeUndefined();
    expect(next.players.p1.trash).toContain(uid);

    next = manual(next, { op: 'move', uid, to: { kind: 'hand' } });
    expect(next.players.p1.hand).toContain(uid);
    expect(next.players.p1.trash).not.toContain(uid);
  });

  it('puts a card on the top or bottom of the deck without naming it in the log', () => {
    const uid = game.players.p1.hand[0];
    let next = manual(game, { op: 'move', uid, to: { kind: 'deckTop' } });
    expect(next.players.p1.mainDeck[0]).toBe(uid);
    expect(lastLog(next)).toBe('By hand: moved a card to the top of the deck.');

    next = manual(next, { op: 'move', uid, to: { kind: 'deckBottom' } });
    expect(next.players.p1.mainDeck.at(-1)).toBe(uid);
  });

  it("never takes cards from the other player's hand or deck", () => {
    const theirs = game.players.p2.hand[0];
    expect(refusal(game, { op: 'move', uid: theirs, to: { kind: 'trash' } })).toMatch(/other player/);
    const theirDeck = game.players.p2.mainDeck[0];
    expect(refusal(game, { op: 'move', uid: theirDeck, to: { kind: 'hand' } })).toMatch(/other player/);
  });

  it("can change the other player's units — card effects hit both sides", () => {
    const uid = game.players.p1.hand[0];
    let next = manual(game, { op: 'play', uid, to: { kind: 'base', player: 'p2' } });
    expect(next.units[uid].controller).toBe('p2');
    next = manual(next, { op: 'stun', uid });
    expect(next.units[uid].stunned).toBe(true);
    next = manual(next, { op: 'empower', uid });
    expect(next.units[uid].empowered).toBe(true);
    next = manual(next, { op: 'buff', uid, delta: 1 });
    expect(next.units[uid].buffs).toBe(1);
  });

  it('toggles ready on units and runes', () => {
    const rune = Object.values(game.runes).find((r) => r.controller === 'p1')!;
    const next = manual(game, { op: 'ready', uid: rune.uid });
    expect(next.runes[rune.uid].ready).toBe(!rune.ready);
  });

  it('adjusts points and wins at the victory score', () => {
    let next = game;
    for (let i = 0; i < game.victoryScore; i++) next = manual(next, { op: 'points', player: 'p1', delta: 1 });
    expect(next.winner).toBe('p1');
  });

  it('never takes a counter below zero', () => {
    const next = manual(game, { op: 'xp', player: 'p1', delta: -5 });
    expect(next.players.p1.xp).toBe(0);
  });

  it('draws, channels and shuffles deterministically', () => {
    let next = manual(game, { op: 'draw', player: 'p1' });
    expect(next.players.p1.hand).toHaveLength(game.players.p1.hand.length + 1);

    const runes = Object.keys(next.runes).length;
    next = manual(next, { op: 'channel', player: 'p1' });
    expect(Object.keys(next.runes)).toHaveLength(runes + 1);

    const a = manual(next, { op: 'shuffle', player: 'p1' });
    const b = manual(next, { op: 'shuffle', player: 'p1' });
    expect(a.players.p1.mainDeck).toEqual(b.players.p1.mainDeck);
    expect([...a.players.p1.mainDeck].sort()).toEqual([...next.players.p1.mainDeck].sort());
  });

  it('sets battlefield control by hand', () => {
    const next = manual(game, { op: 'control', battlefield: 0, controller: 'p2' });
    expect(next.battlefields[0].controller).toBe('p2');
  });

  it('works while a chain is up, and clears a stuck chain', () => {
    const withSpell = give(game, 'p1', spellCard, 'spell-2');
    const stuck = structuredClone(withSpell);
    stuck.players.p1.hand = stuck.players.p1.hand.filter((u) => u !== 'spell-2');
    stuck.chain = [{ uid: 'spell-2', controller: 'p1', kind: 'spell', instructions: [] }];
    stuck.priority = 'p2';

    // A rules action is refused while the chain is up; a manual one is not.
    expect(reduce(stuck, { type: 'END_TURN' }, lookup).ok).toBe(false);
    const next = manual(stuck, { op: 'clearStack' });
    expect(next.chain).toHaveLength(0);
    expect(next.priority).toBeNull();
    expect(next.players.p1.trash).toContain('spell-2');
    expect(reduce(next, { type: 'END_TURN' }, lookup).ok).toBe(true);
  });

  it('refuses a spell put on the board', () => {
    const withSpell = give(game, 'p1', spellCard, 'spell-3');
    expect(
      refusal(withSpell, { op: 'move', uid: 'spell-3', to: { kind: 'base', player: 'p1' } }),
    ).toMatch(/Spells/);
  });
});
