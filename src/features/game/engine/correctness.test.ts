import { describe, expect, it } from 'vitest';
import type { Card } from '@/types';
import { BY_ID, CARDS, findCard } from '@/test/dataset';
import { cleanup, expireTemporary, toZone } from './cleanup';
import { hasKeyword } from './keywords';
import { reduce } from './reducer';
import type { GameState, PlayerId } from './types';

const lookup = (cardId: string): Card | undefined => BY_ID.get(cardId);

/**
 * Rules that the engine got wrong before this milestone. Each test names the
 * rule it enforces so a future change cannot quietly undo it.
 */

const plainUnit = findCard(
  (c) => c.type === 'Unit' && !hasKeyword(c, 'Accelerate') && !hasKeyword(c, 'Temporary'),
  'a plain unit',
);
const acceleratable = findCard(
  (c) => c.type === 'Unit' && hasKeyword(c, 'Accelerate'),
  'a unit with Accelerate',
);
const temporary = findCard(
  (c) => c.type === 'Unit' && hasKeyword(c, 'Temporary'),
  'a unit with Temporary',
);

/** Main-phase state with one battlefield and resources to spare. */
function table(controller: PlayerId | null = null): GameState {
  const blank = (id: PlayerId) => ({
    id,
    legendCardId: '',
    championCardId: '',
    championZone: null,
    hand: [] as string[],
    mainDeck: [] as string[],
    runeDeck: [] as string[],
    trash: [] as string[],
    points: 0,
    energy: 30,
    power: { Mind: 9, Chaos: 9, Order: 9, Calm: 9, Body: 9, Fury: 9 },
    burnedOut: false,
  });
  const state: GameState = {
    rng: 1,
    turn: 3,
    turnPlayer: 'p1',
    firstPlayer: 'p1',
    phase: 'main',
    players: { p1: blank('p1'), p2: blank('p2') },
    instances: {},
    units: {},
    runes: {},
    gear: {},
    hidden: {},
    battlefields: [{ uid: 'bf', contributedBy: 'p1', controller, contested: false, scoredBy: [] }],
    showdown: null,
    chain: [],
    priority: null,
    chainPasses: 0,
    pendingMulligan: [],
    victoryScore: 8,
    winner: null,
    log: [],
    unautomated: [],
  };

  /*
   * Stock both decks. With empty decks the Draw Phase triggers Burn Out (431)
   * and hands the opponent a point, which has nothing to do with what these
   * tests are checking.
   */
  for (const id of ['p1', 'p2'] as PlayerId[]) {
    for (let i = 0; i < 12; i++) {
      const uid = `${id}-deck-${i}`;
      state.instances[uid] = { uid, cardId: plainUnit.id, owner: id };
      state.players[id].mainDeck.push(uid);
    }
  }
  return state;
}

function inHand(state: GameState, card: Card, uid = 'h1'): string {
  state.instances[uid] = { uid, cardId: card.id, owner: 'p1' };
  state.players.p1.hand.push(uid);
  return uid;
}

function placeUnit(state: GameState, card: Card, controller: PlayerId, index: number, uid: string) {
  state.instances[uid] = { uid, cardId: card.id, owner: controller };
  state.units[uid] = {
    uid,
    controller,
    location: { kind: 'battlefield', index },
    ready: true,
    damage: 0,
    mightBonus: 0,
    designation: null,
    enteredOnTurn: 1,
    movesThisTurn: 0,
  };
}

describe('units enter exhausted (178.1.a.1)', () => {
  it('a played unit is exhausted, so it cannot move the turn it lands', () => {
    const state = table();
    const uid = inHand(state, plainUnit);

    const played = reduce(state, { type: 'PLAY_CARD', uid }, lookup);
    expect(played.ok).toBe(true);
    if (!played.ok) return;
    expect(played.state.units[uid].ready).toBe(false);

    // 144.2 — exhausting is the cost of a Standard Move, so it cannot pay it.
    const moved = reduce(
      played.state,
      { type: 'MOVE_UNIT', uid, to: { kind: 'battlefield', index: 0 } },
      lookup,
    );
    expect(moved.ok).toBe(false);
    if (!moved.ok) expect(moved.reason).toMatch(/exhausted/);
  });

  it('gear still enters ready (149.1)', () => {
    const gear = findCard((c) => c.type === 'Gear', 'a gear card');
    const state = table();
    const uid = inHand(state, gear);
    const played = reduce(state, { type: 'PLAY_CARD', uid }, lookup);
    expect(played.ok).toBe(true);
    if (played.ok) expect(played.state.gear[uid].ready).toBe(true);
  });
});

describe('Accelerate (805.1)', () => {
  it('enters ready when the additional cost is paid', () => {
    const state = table();
    const uid = inHand(state, acceleratable);
    const played = reduce(state, { type: 'PLAY_CARD', uid, accelerate: true }, lookup);
    expect(played.ok).toBe(true);
    if (played.ok) expect(played.state.units[uid].ready).toBe(true);
  });

  it('charges one extra Energy and one extra Power for it', () => {
    const base = table();
    const uid = inHand(base, acceleratable);

    const normal = reduce(base, { type: 'PLAY_CARD', uid }, lookup);
    const fast = reduce(base, { type: 'PLAY_CARD', uid, accelerate: true }, lookup);
    expect(normal.ok && fast.ok).toBe(true);
    if (!normal.ok || !fast.ok) return;

    const spent = (s: GameState) =>
      30 - s.players.p1.energy +
      (54 - Object.values(s.players.p1.power).reduce<number>((t, n) => t + (n ?? 0), 0));
    expect(spent(fast.state)).toBe(spent(normal.state) + 2);
  });

  it('is refused on a unit without the keyword', () => {
    const state = table();
    const uid = inHand(state, plainUnit);
    const result = reduce(state, { type: 'PLAY_CARD', uid, accelerate: true }, lookup);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rule).toBe('805.1');
  });
});

describe('control drops at cleanup (323.6)', () => {
  it('a battlefield with none of your units left becomes uncontrolled', () => {
    const state = table('p1');
    placeUnit(state, plainUnit, 'p1', 0, 'u1');
    cleanup(state);
    expect(state.battlefields[0].controller).toBe('p1'); // still occupied

    delete state.units.u1; // the last unit dies
    cleanup(state);
    expect(state.battlefields[0].controller).toBeNull();
  });

  it('control survives while a showdown is running there', () => {
    // Control has to hold through a showdown, or a card hidden there is lost
    // mid-combat.
    const state = table('p1');
    state.showdown = {
      battlefield: 0,
      combat: true,
      attacker: 'p2',
      defender: 'p1',
      focus: 'p2',
      passes: 0,
    };
    cleanup(state);
    expect(state.battlefields[0].controller).toBe('p1');
  });

  it('stops the holder scoring after their last unit dies', () => {
    // The bug this fixes: Hold points kept accruing on an empty battlefield.
    let state = table('p1');
    placeUnit(state, plainUnit, 'p1', 0, 'u1');
    delete state.units.u1;

    state.phase = 'main';
    const ended = reduce(state, { type: 'END_TURN' }, lookup);
    expect(ended.ok).toBe(true);
    if (!ended.ok) return;
    state = ended.state;

    const back = reduce(state, { type: 'END_TURN' }, lookup); // round-trip to p1
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.state.players.p1.points).toBe(0);
  });
});

describe('Temporary', () => {
  it('expires before the scoring step, so it cannot bank a Hold', () => {
    const state = table('p1');
    placeUnit(state, temporary, 'p1', 0, 't1');

    expireTemporary(state, 'p1', lookup);
    expect(state.units.t1).toBeUndefined();
    expect(state.players.p1.trash).toContain('t1');

    // With its last unit gone, control drops and no Hold is scored.
    cleanup(state);
    expect(state.battlefields[0].controller).toBeNull();
  });

  it('leaves units controlled by the other player alone', () => {
    const state = table();
    placeUnit(state, temporary, 'p2', 0, 't1');
    expireTemporary(state, 'p1', lookup);
    expect(state.units.t1).toBeDefined();
  });
});

describe('zone change makes a new object (102)', () => {
  it('wipes damage, buffs and designation on the way out', () => {
    const state = table();
    placeUnit(state, plainUnit, 'p1', 0, 'u1');
    state.units.u1.damage = 2;
    state.units.u1.mightBonus = 1;
    state.units.u1.designation = 'attacker';

    toZone(state, 'u1', 'hand');

    expect(state.units.u1).toBeUndefined();
    expect(state.players.p1.hand).toContain('u1');

    // Coming back must come back clean.
    placeUnit(state, plainUnit, 'p1', 0, 'u1');
    expect(state.units.u1.damage).toBe(0);
    expect(state.units.u1.mightBonus).toBe(0);
    expect(state.units.u1.designation).toBeNull();
  });

  it('detaches gear whose host leaves the board', () => {
    const gear = findCard((c) => c.type === 'Gear', 'a gear card');
    const state = table();
    placeUnit(state, plainUnit, 'p1', 0, 'u1');
    state.instances.g1 = { uid: 'g1', cardId: gear.id, owner: 'p1' };
    state.gear.g1 = {
      uid: 'g1',
      controller: 'p1',
      location: { kind: 'battlefield', index: 0 },
      ready: true,
      attachedTo: 'u1',
    };

    toZone(state, 'u1', 'trash');
    expect(state.gear.g1.attachedTo).toBeNull();
    expect(state.gear.g1.location).toEqual({ kind: 'base', player: 'p1' });
  });
});

describe('dataset sanity', () => {
  it('has enough Temporary and Accelerate cards to matter', () => {
    const count = (kw: string) => CARDS.filter((c) => hasKeyword(c, kw)).length;
    expect(count('Temporary')).toBeGreaterThan(20);
    expect(count('Accelerate')).toBeGreaterThan(20);
  });
});
