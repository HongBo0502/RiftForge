import { describe, expect, it } from 'vitest';
import type { Card, Domain } from '@/types';
import { BY_ID, CARDS } from '@/test/dataset';
import { planPayment } from './payment';
import { reduce } from './reducer';
import type { GameState, PlayerId } from './types';

const lookup = (cardId: string): Card | undefined => BY_ID.get(cardId);

const runeOf = (domain: Domain) => CARDS.find((c) => c.type === 'Rune' && c.domains[0] === domain)!;

/**
 * A bare state with a known set of runes on the board — enough for the planner,
 * without the noise of a full game setup.
 */
function board(runeDomains: Domain[], pool: { energy?: number; power?: Partial<Record<Domain, number>> } = {}): GameState {
  const state = {
    rng: 1,
    turn: 3,
    turnPlayer: 'p1' as PlayerId,
    firstPlayer: 'p1' as PlayerId,
    phase: 'main' as const,
    players: {
      p1: {
        id: 'p1' as PlayerId,
        legendCardId: '',
        championCardId: '',
        championZone: null,
        hand: [],
        mainDeck: [],
        runeDeck: [],
        trash: [],
        points: 0,
        energy: pool.energy ?? 0,
        power: pool.power ?? {},
        xp: 0,
        finalizedThisTurn: [],
        burnedOut: false,
      },
      p2: {
        id: 'p2' as PlayerId,
        legendCardId: '',
        championCardId: '',
        championZone: null,
        hand: [],
        mainDeck: [],
        runeDeck: [],
        trash: [],
        points: 0,
        energy: 0,
        power: {},
        xp: 0,
        finalizedThisTurn: [],
        burnedOut: false,
      },
    },
    instances: {} as GameState['instances'],
    units: {},
    gear: {},
    runes: {} as GameState['runes'],
    hidden: {},
    battlefields: [],
    showdown: null,
    chain: [],
    priority: null,
    chainPasses: 0,
    pendingMulligan: [],
    victoryScore: 8,
    winner: null,
    log: [],
    unautomated: [],
  } satisfies GameState;

  runeDomains.forEach((domain, i) => {
    const uid = `r${i}`;
    state.instances[uid] = { uid, cardId: runeOf(domain).id, owner: 'p1' };
    state.runes[uid] = { uid, controller: 'p1', ready: true };
  });
  return state;
}

/** A stand-in card with an exact cost, so tests don't depend on the dataset. */
function costing(energy: number, power: number, domains: Domain[]): Card {
  const base = CARDS.find((c) => c.type === 'Unit')!;
  return { ...base, energy, power, domains };
}

describe('planPayment', () => {
  it('exhausts for Energy and recycles for Power', () => {
    const state = board(['Mind', 'Mind', 'Chaos']);
    const result = planPayment(state, 'p1', costing(2, 1, ['Chaos']), lookup);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.recycle).toHaveLength(1);
    expect(result.plan.exhaust).toHaveLength(2);
    // The recycled rune must be the Chaos one — it is the only acceptable domain.
    expect(lookup(state.instances[result.plan.recycle[0]].cardId)?.domains[0]).toBe('Chaos');
  });

  it('never spends the same rune twice', () => {
    const state = board(['Chaos', 'Mind']);
    const result = planPayment(state, 'p1', costing(1, 1, ['Chaos']), lookup);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const overlap = result.plan.exhaust.filter((u) => result.plan.recycle.includes(u));
    expect(overlap).toEqual([]);
  });

  it('spends the pool before touching the board', () => {
    const state = board(['Mind', 'Mind'], { energy: 2, power: { Mind: 1 } });
    const result = planPayment(state, 'p1', costing(2, 1, ['Mind']), lookup);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.energyFromPool).toBe(2);
    expect(result.plan.powerFromPool.Mind).toBe(1);
    expect(result.plan.exhaust).toEqual([]);
    expect(result.plan.recycle).toEqual([]);
  });

  it('settles Power first, so a payable cost is never stranded', () => {
    // One Chaos rune and one Mind rune; cost is 1 Energy + 1 Chaos Power.
    // Exhausting the Chaos rune for Energy first would make the Power unpayable.
    const state = board(['Chaos', 'Mind']);
    const result = planPayment(state, 'p1', costing(1, 1, ['Chaos']), lookup);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(lookup(state.instances[result.plan.recycle[0]].cardId)?.domains[0]).toBe('Chaos');
    expect(lookup(state.instances[result.plan.exhaust[0]].cardId)?.domains[0]).toBe('Mind');
  });

  it('reports how far short the player is', () => {
    const state = board(['Mind']);
    const energy = planPayment(state, 'p1', costing(3, 0, ['Mind']), lookup);
    expect(energy.ok).toBe(false);
    if (!energy.ok) expect(energy.reason).toMatch(/Energy — short by 2/);

    const power = planPayment(state, 'p1', costing(0, 1, ['Fury']), lookup);
    expect(power.ok).toBe(false);
    if (!power.ok) expect(power.reason).toMatch(/Fury Power — short by 1/);
  });

  it('accepts any domain for a colourless cost', () => {
    const state = board(['Mind', 'Fury']);
    const result = planPayment(state, 'p1', costing(0, 2, ['Colorless']), lookup);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.plan.recycle).toHaveLength(2);
  });
});

describe('PLAY_CARD auto-pay', () => {
  it('pays without the player pre-tapping anything', () => {
    const state = board(['Chaos', 'Mind', 'Mind']);
    const card = costing(2, 1, ['Chaos']);
    const uid = 'h1';
    state.instances[uid] = { uid, cardId: card.id, owner: 'p1' };
    state.players.p1.hand.push(uid);

    // Look up the stand-in card by id, everything else from the dataset.
    const withCard = (id: string) => (id === card.id ? card : lookup(id));

    const result = reduce(state, { type: 'PLAY_CARD', uid }, withCard);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Two runes exhausted, one recycled back to the rune deck.
    const left = Object.values(result.state.runes);
    expect(left).toHaveLength(2);
    expect(left.every((r) => !r.ready)).toBe(true);
    expect(result.state.players.p1.runeDeck).toHaveLength(1);
    expect(result.state.units[uid]).toBeDefined();
  });

  it('honours an explicit payment override', () => {
    const state = board(['Chaos', 'Chaos', 'Mind']);
    const card = costing(1, 1, ['Chaos']);
    const uid = 'h1';
    state.instances[uid] = { uid, cardId: card.id, owner: 'p1' };
    state.players.p1.hand.push(uid);
    const withCard = (id: string) => (id === card.id ? card : lookup(id));

    // Force recycling the *second* Chaos rune and exhausting the Mind one.
    const result = reduce(
      state,
      {
        type: 'PLAY_CARD',
        uid,
        payment: { exhaust: ['r2'], recycle: ['r1'], energyFromPool: 0, powerFromPool: {} },
      },
      withCard,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.runes.r1).toBeUndefined(); // recycled
    expect(result.state.runes.r0.ready).toBe(true); // untouched
    expect(result.state.runes.r2.ready).toBe(false); // exhausted
  });
});
