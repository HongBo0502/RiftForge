import { describe, expect, it } from 'vitest';
import type { Card } from '@/types';
import { BY_ID, CARDS, findCard } from '@/test/dataset';
import { hasKeyword } from './keywords';
import { redact, isConcealed } from './redact';
import { reduce } from './reducer';
import type { GameState, PlayerId } from './types';

const lookup = (cardId: string): Card | undefined => BY_ID.get(cardId);

const hiddenCard = findCard((c) => hasKeyword(c, 'Hidden') && c.type !== 'Legend', 'a card with Hidden');
const plainCard = findCard(
  (c) => c.type === 'Unit' && !hasKeyword(c, 'Hidden'),
  'a unit without Hidden',
);
const gearCard = findCard((c) => c.type === 'Gear' && hasKeyword(c, 'Equip'), 'gear with Equip');

/** Minimal main-phase state with one battlefield and a full rune pool. */
function table(controller: PlayerId | null = 'p1'): GameState {
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
    energy: 20,
    power: { Mind: 5, Chaos: 5, Order: 5, Calm: 5, Body: 5, Fury: 5 },
    burnedOut: false,
  });

  return {
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
    battlefields: [
      { uid: 'bf', contributedBy: 'p1', controller, contested: false, scoredBy: [] },
    ],
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
}

/** Puts a card in p1's hand and returns its uid. */
function inHand(state: GameState, card: Card, uid = 'h1'): string {
  state.instances[uid] = { uid, cardId: card.id, owner: 'p1' };
  state.players.p1.hand.push(uid);
  return uid;
}

describe('HIDE_CARD (811)', () => {
  it('hides a card with Hidden at a battlefield you control', () => {
    const state = table('p1');
    const uid = inHand(state, hiddenCard);

    const result = reduce(state, { type: 'HIDE_CARD', uid, battlefield: 0 }, lookup);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.state.hidden[uid]).toBeDefined();
    expect(result.state.hidden[uid].battlefield).toBe(0);
    expect(result.state.hidden[uid].hiddenOnTurn).toBe(3);
    expect(result.state.players.p1.hand).not.toContain(uid);
  });

  it('costs 1 Power of any domain', () => {
    const state = table('p1');
    const uid = inHand(state, hiddenCard);
    const before = Object.values(state.players.p1.power).reduce<number>((s, n) => s + (n ?? 0), 0);

    const result = reduce(state, { type: 'HIDE_CARD', uid, battlefield: 0 }, lookup);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const after = Object.values(result.state.players.p1.power).reduce<number>((s, n) => s + (n ?? 0), 0);
    expect(after).toBe(before - 1);
  });

  it('refuses a card without the Hidden keyword', () => {
    const state = table('p1');
    const uid = inHand(state, plainCard);
    const result = reduce(state, { type: 'HIDE_CARD', uid, battlefield: 0 }, lookup);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rule).toBe('811.1');
  });

  it('refuses a battlefield you do not control (811.1.b)', () => {
    const state = table('p2');
    const uid = inHand(state, hiddenCard);
    const result = reduce(state, { type: 'HIDE_CARD', uid, battlefield: 0 }, lookup);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/battlefield you control/);
  });

  it('allows only one facedown card per battlefield (811.1.b)', () => {
    const state = table('p1');
    const first = inHand(state, hiddenCard, 'h1');
    const second = inHand(state, hiddenCard, 'h2');

    const one = reduce(state, { type: 'HIDE_CARD', uid: first, battlefield: 0 }, lookup);
    expect(one.ok).toBe(true);
    if (!one.ok) return;

    const two = reduce(one.state, { type: 'HIDE_CARD', uid: second, battlefield: 0 }, lookup);
    expect(two.ok).toBe(false);
    if (!two.ok) expect(two.reason).toMatch(/already hidden/);
  });

  it('cannot be played on the turn it was hidden, but can the next turn', () => {
    const state = table('p1');
    const uid = inHand(state, hiddenCard);
    const hid = reduce(state, { type: 'HIDE_CARD', uid, battlefield: 0 }, lookup);
    expect(hid.ok).toBe(true);
    if (!hid.ok) return;

    const sameTurn = reduce(hid.state, { type: 'PLAY_CARD', uid }, lookup);
    expect(sameTurn.ok).toBe(false);
    if (!sameTurn.ok) expect(sameTurn.rule).toBe('811.1.b');

    const later = structuredClone(hid.state);
    later.turn = 4;
    const nextTurn = reduce(later, { type: 'PLAY_CARD', uid }, lookup);
    expect(nextTurn.ok).toBe(true);
  });

  it('ignores the card cost when played from hidden (811.1.b)', () => {
    const state = table('p1');
    const uid = inHand(state, hiddenCard);
    const hid = reduce(state, { type: 'HIDE_CARD', uid, battlefield: 0 }, lookup);
    if (!hid.ok) return;

    const later = structuredClone(hid.state);
    later.turn = 4;
    // Strip every resource: a hidden card must still be playable.
    later.players.p1.energy = 0;
    later.players.p1.power = {};
    later.runes = {};

    const played = reduce(later, { type: 'PLAY_CARD', uid }, lookup);
    expect(played.ok).toBe(true);
    if (played.ok) expect(played.state.hidden[uid]).toBeUndefined();
  });

  it('plays a hidden permanent to the battlefield it was hidden at (811.1.d.1)', () => {
    const unit = findCard(
      (c) => c.type === 'Unit' && hasKeyword(c, 'Hidden'),
      'a unit with Hidden',
    );
    const state = table('p1');
    const uid = inHand(state, unit);
    const hid = reduce(state, { type: 'HIDE_CARD', uid, battlefield: 0 }, lookup);
    if (!hid.ok) return;

    const later = structuredClone(hid.state);
    later.turn = 4;
    const played = reduce(later, { type: 'PLAY_CARD', uid }, lookup);
    expect(played.ok).toBe(true);
    if (played.ok) {
      expect(played.state.units[uid].location).toEqual({ kind: 'battlefield', index: 0 });
    }
  });

  it('never reveals a hidden card to the opponent', () => {
    const state = table('p1');
    const uid = inHand(state, hiddenCard);
    const hid = reduce(state, { type: 'HIDE_CARD', uid, battlefield: 0 }, lookup);
    if (!hid.ok) return;

    expect(isConcealed(redact(hid.state, 'p1'), uid)).toBe(false);
    expect(isConcealed(redact(hid.state, 'p2'), uid)).toBe(true);
    expect(JSON.stringify(redact(hid.state, 'p2'))).not.toContain(hiddenCard.id);
  });
});

describe('Gear (147-152)', () => {
  it('stays on the board at base instead of going to the trash', () => {
    const state = table('p1');
    const uid = inHand(state, gearCard);

    const result = reduce(state, { type: 'PLAY_CARD', uid }, lookup);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.state.gear[uid]).toBeDefined();
    expect(result.state.gear[uid].location).toEqual({ kind: 'base', player: 'p1' });
    expect(result.state.gear[uid].ready).toBe(true); // 149.1
    expect(result.state.players.p1.trash).not.toContain(uid);
  });

  it('attaches to a unit you control and follows it when it moves', () => {
    const state = table('p1');
    const gearUid = inHand(state, gearCard, 'g1');
    const played = reduce(state, { type: 'PLAY_CARD', uid: gearUid }, lookup);
    if (!played.ok) return;

    const withUnit = structuredClone(played.state);
    withUnit.instances.u1 = { uid: 'u1', cardId: plainCard.id, owner: 'p1' };
    withUnit.units.u1 = {
      uid: 'u1',
      controller: 'p1',
      location: { kind: 'base', player: 'p1' },
      ready: true,
      damage: 0,
      mightBonus: 0,
      designation: null,
      enteredOnTurn: 1,
      movesThisTurn: 0,
    };

    const equipped = reduce(withUnit, { type: 'EQUIP_GEAR', uid: gearUid, unitUid: 'u1' }, lookup);
    expect(equipped.ok).toBe(true);
    if (!equipped.ok) return;
    expect(equipped.state.gear[gearUid].attachedTo).toBe('u1');

    // 152.2 — attached gear is located wherever its unit is.
    const moved = reduce(
      equipped.state,
      { type: 'MOVE_UNIT', uid: 'u1', to: { kind: 'battlefield', index: 0 } },
      lookup,
    );
    expect(moved.ok).toBe(true);
    if (moved.ok) {
      expect(moved.state.gear[gearUid].location).toEqual({ kind: 'battlefield', index: 0 });
    }
  });

  it('refuses to attach to an opponent unit (818)', () => {
    const state = table('p1');
    const gearUid = inHand(state, gearCard, 'g1');
    const played = reduce(state, { type: 'PLAY_CARD', uid: gearUid }, lookup);
    if (!played.ok) return;

    const withEnemy = structuredClone(played.state);
    withEnemy.instances.e1 = { uid: 'e1', cardId: plainCard.id, owner: 'p2' };
    withEnemy.units.e1 = {
      uid: 'e1',
      controller: 'p2',
      location: { kind: 'base', player: 'p2' },
      ready: true,
      damage: 0,
      mightBonus: 0,
      designation: null,
      enteredOnTurn: 1,
      movesThisTurn: 0,
    };

    const result = reduce(withEnemy, { type: 'EQUIP_GEAR', uid: gearUid, unitUid: 'e1' }, lookup);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rule).toBe('818');
  });
});

describe('dataset gap', () => {
  it('confirms Equipment carries no Might Bonus in the data', () => {
    // 137 — Equipment print a Might Bonus in the lower-right corner, but the
    // Riftcodex dataset has no field for it. Until it does, attaching gear
    // cannot change a unit's Might. This test documents the gap so it fails
    // loudly if the data ever gains the field.
    const equipment = CARDS.filter((c) => c.type === 'Gear' && c.tags.includes('Equipment'));
    expect(equipment.length).toBeGreaterThan(0);
    expect(equipment.every((c) => c.might === null)).toBe(true);
  });
});
