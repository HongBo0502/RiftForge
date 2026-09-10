import { describe, expect, it } from 'vitest';
import type { Card } from '@/types';
import { BY_ID, CARDS, card } from '@/test/dataset';
import type { Deck } from '@/features/decks/types';
import { emptyDeck } from '@/features/decks/types';
import { reduce, startGame } from './reducer';
import { OPENING_HAND, resetUids, setupGame } from './setup';
import type { GameState } from './types';

const lookup = (cardId: string): Card | undefined => BY_ID.get(cardId);

const legend = card('Teemo - Swift Scout');
const champion = card('Teemo - Strategist');
const runeFor = (domain: string) =>
  CARDS.find((c) => c.type === 'Rune' && c.domains[0] === domain)!;

const units = CARDS.filter(
  (c) =>
    c.type === 'Unit' &&
    !c.signature &&
    c.domains.every((d) => d === 'Mind' || d === 'Chaos' || d === 'Colorless'),
);

function deck(): Deck {
  const d = emptyDeck('mulligan deck');
  d.legendId = legend.id;
  d.championId = champion.id;
  d.main = [{ cardId: champion.id, qty: 1 }];
  for (const u of units.slice(0, 20)) d.main.push({ cardId: u.id, qty: 2 });
  d.runes = [
    { cardId: runeFor('Mind').id, qty: 6 },
    { cardId: runeFor('Chaos').id, qty: 6 },
  ];
  d.battlefields = CARDS.filter((c) => c.type === 'Battlefield')
    .slice(0, 3)
    .map((b) => b.id);
  return d;
}

/** A game paused in the mulligan phase. */
function pending(seed = 5): GameState {
  resetUids();
  return startGame(
    setupGame({ decks: { p1: deck(), p2: deck() }, byId: BY_ID, seed, firstPlayer: 'p1' }),
    lookup,
    { mulligan: true },
  );
}

describe('mulligan (117)', () => {
  it('opens in the mulligan phase with both players owing one, in turn order', () => {
    const game = pending();
    expect(game.phase).toBe('mulligan');
    expect(game.pendingMulligan).toEqual(['p1', 'p2']);
    // 116 — four cards each, and nobody has drawn for turn one yet.
    expect(game.players.p1.hand).toHaveLength(OPENING_HAND);
    expect(game.players.p2.hand).toHaveLength(OPENING_HAND);
  });

  it('keeps the hand at four when two cards are swapped (117.1, 117.2)', () => {
    const game = pending();
    const swap = game.players.p1.hand.slice(0, 2);

    const result = reduce(game, { type: 'MULLIGAN', swap }, lookup);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const hand = result.state.players.p1.hand;
    expect(hand).toHaveLength(OPENING_HAND);
    for (const uid of swap) expect(hand).not.toContain(uid);
  });

  it('recycles the set-aside cards to the bottom of the deck (117.3)', () => {
    const game = pending();
    const swap = game.players.p1.hand.slice(0, 2);
    const deckBefore = game.players.p1.mainDeck.length;

    const result = reduce(game, { type: 'MULLIGAN', swap }, lookup);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const main = result.state.players.p1.mainDeck;
    // Two drawn off the top, two returned to the bottom.
    expect(main).toHaveLength(deckBefore);
    expect(main.slice(-2).sort()).toEqual([...swap].sort());
  });

  it('cannot draw back a card it just set aside', () => {
    // 117.2 happens before 117.3, so the replacements come off the top while
    // the set-aside cards are still out of the deck.
    const game = pending();
    const swap = game.players.p1.hand.slice(0, 2);
    const result = reduce(game, { type: 'MULLIGAN', swap }, lookup);
    if (!result.ok) return;
    for (const uid of swap) expect(result.state.players.p1.hand).not.toContain(uid);
  });

  it('refuses more than two cards (117.1)', () => {
    const game = pending();
    const result = reduce(
      game,
      { type: 'MULLIGAN', swap: game.players.p1.hand.slice(0, 3) },
      lookup,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rule).toBe('117.1');
  });

  it('refuses a card that is not in hand', () => {
    const game = pending();
    const result = reduce(game, { type: 'MULLIGAN', swap: ['not-a-real-uid'] }, lookup);
    expect(result.ok).toBe(false);
  });

  it('allows keeping, and starts turn one once both have resolved', () => {
    let game = pending();

    const first = reduce(game, { type: 'MULLIGAN', swap: [] }, lookup);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    game = first.state;

    // Still the opponent's turn to mulligan; play has not begun.
    expect(game.phase).toBe('mulligan');
    expect(game.pendingMulligan).toEqual(['p2']);

    const second = reduce(game, { type: 'MULLIGAN', swap: [] }, lookup);
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    expect(second.state.pendingMulligan).toEqual([]);
    expect(second.state.phase).toBe('main');
    expect(second.state.turnPlayer).toBe('p1');
    // The first player has now drawn for turn one (315.4).
    expect(second.state.players.p1.hand).toHaveLength(OPENING_HAND + 1);
  });

  it('blocks every other action until the mulligan is done', () => {
    const game = pending();
    const result = reduce(game, { type: 'END_TURN' }, lookup);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rule).toBe('117');
  });

  /*
   * The one that protects online play. Both clients rebuild the game from a
   * single seed and relay actions; if the recycle order (416.5) used
   * Math.random, the two players would end up with different decks and nothing
   * would signal it until someone drew a card the other did not have.
   */
  it('is deterministic for a given seed', () => {
    const run = () => {
      const game = pending(99);
      const swap = game.players.p1.hand.slice(0, 2);
      const a = reduce(game, { type: 'MULLIGAN', swap }, lookup);
      if (!a.ok) throw new Error(a.reason);
      const b = reduce(a.state, { type: 'MULLIGAN', swap: [] }, lookup);
      if (!b.ok) throw new Error(b.reason);
      return b.state;
    };
    expect(JSON.stringify(run())).toBe(JSON.stringify(run()));
  });

  it('advances the seed when it shuffles, so the deck order is not reused', () => {
    const game = pending(7);
    const swap = game.players.p1.hand.slice(0, 2);
    const result = reduce(game, { type: 'MULLIGAN', swap }, lookup);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.state.rng).not.toBe(game.rng);
  });

  it('is off by default, so a game not asking for it is ready to play', () => {
    resetUids();
    const game = startGame(
      setupGame({ decks: { p1: deck(), p2: deck() }, byId: BY_ID, seed: 3, firstPlayer: 'p1' }),
      lookup,
    );
    expect(game.phase).toBe('main');
    expect(game.pendingMulligan).toEqual([]);
  });
});
