import { describe, expect, it } from 'vitest';
import type { Card } from '@/types';
import { BY_ID, findCard } from '@/test/dataset';
import { toZone } from './cleanup';
import { damageContribution, resolveCombat, unitMight } from './combat';
import { hasKeyword } from './keywords';
import { redact } from './redact';
import { reduce } from './reducer';
import {
  buff,
  disempower,
  empower,
  expireStatuses,
  gainXp,
  spendBuff,
  spendXp,
  stun,
} from './statuses';
import type { GameState, PlayerId } from './types';

const lookup = (cardId: string): Card | undefined => BY_ID.get(cardId);

/**
 * Statuses. 423, 426, 441-442, 701-705, 728-733
 *
 * Stunning, buffing and empowering are all Limited Actions, so none of them has
 * a player-facing action — these are the primitives card effects will call. The
 * parts that are not optional are tested through the engine: buffs count toward
 * Might, a stunned unit deals no combat damage, and stun expires with the turn.
 */

/** A unit with a known Might and nothing that changes it by combat role. */
function unitWithMight(might: number): Card {
  return findCard(
    (c) =>
      c.type === 'Unit' &&
      c.might === might &&
      !hasKeyword(c, 'Assault') &&
      !hasKeyword(c, 'Shield') &&
      !hasKeyword(c, 'Tank') &&
      !hasKeyword(c, 'Backline'),
    `a plain unit with ${might} Might`,
  );
}

const might3 = unitWithMight(3);
const might4 = unitWithMight(4);

function table(): GameState {
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
    xp: 0,
    finalizedThisTurn: [],
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
      { uid: 'bf', contributedBy: 'p1', controller: null, contested: true, scoredBy: [] },
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

function placeUnit(
  state: GameState,
  card: Card,
  controller: PlayerId,
  uid: string,
  designation: 'attacker' | 'defender' | null = null,
) {
  state.instances[uid] = { uid, cardId: card.id, owner: controller };
  state.units[uid] = {
    uid,
    controller,
    location: { kind: 'battlefield', index: 0 },
    ready: true,
    damage: 0,
    mightBonus: 0,
    buffs: 0,
    stunned: false,
    empowered: false,
    designation,
    enteredOnTurn: 1,
    movesThisTurn: 0,
  };
}

describe('Buff (426, 701-705)', () => {
  it('adds +1 Might per counter (703)', () => {
    const state = table();
    placeUnit(state, might3, 'p1', 'u1');
    expect(unitMight(state, 'u1', lookup)).toBe(3);

    expect(buff(state, 'u1')).toBe(true);
    expect(unitMight(state, 'u1', lookup)).toBe(4);
  });

  it('refuses a second counter, and says so (702.3, 426.1.c)', () => {
    /*
     * The return value is the point. "Buff a unit. Then, if it was buffed this
     * way, draw a card." must not draw when the chosen unit was already buffed,
     * so the caller has to be able to tell.
     */
    const state = table();
    placeUnit(state, might3, 'p1', 'u1');

    expect(buff(state, 'u1')).toBe(true);
    expect(buff(state, 'u1')).toBe(false);
    expect(state.units.u1.buffs).toBe(1);
  });

  it('stacks when an effect grants permission (426.1.b.2)', () => {
    const state = table();
    placeUnit(state, might3, 'p1', 'u1');
    buff(state, 'u1');
    expect(buff(state, 'u1', true)).toBe(true);
    expect(unitMight(state, 'u1', lookup)).toBe(5);
  });

  it('can be spent, but only from your own unit and only if there is one (702.2.b)', () => {
    const state = table();
    placeUnit(state, might3, 'p1', 'u1');
    placeUnit(state, might3, 'p2', 'e1');
    buff(state, 'u1');
    buff(state, 'e1');

    expect(spendBuff(state, 'p1', 'e1')).toBe(false); // 702.2.b.2 — not yours
    expect(spendBuff(state, 'p1', 'u1')).toBe(true);
    expect(state.units.u1.buffs).toBe(0);
    expect(spendBuff(state, 'p1', 'u1')).toBe(false); // 702.2.b.1 — none left
  });

  it('survives the end of the turn, because it is a counter and not an effect', () => {
    const state = table();
    placeUnit(state, might3, 'p1', 'u1');
    buff(state, 'u1');
    state.units.u1.mightBonus = 2;

    const ended = reduce(state, { type: 'END_TURN' }, lookup);
    expect(ended.ok).toBe(true);
    if (!ended.ok) return;

    // 317.2.c expires the "this turn" bonus; 705 leaves the buff alone.
    expect(ended.state.units.u1.mightBonus).toBe(0);
    expect(ended.state.units.u1.buffs).toBe(1);
  });

  it('is removed when the unit leaves play (705)', () => {
    const state = table();
    placeUnit(state, might3, 'p1', 'u1');
    buff(state, 'u1');

    toZone(state, 'u1', 'hand');
    placeUnit(state, might3, 'p1', 'u1');
    expect(state.units.u1.buffs).toBe(0);
  });
});

describe('Stun (423)', () => {
  it('contributes no Might to the damage step (423.1.b)', () => {
    const state = table();
    placeUnit(state, might4, 'p1', 'a1', 'attacker');
    placeUnit(state, might3, 'p2', 'd1', 'defender');
    stun(state, 'a1');

    expect(damageContribution(state, 'a1', lookup)).toBe(0);
    resolveCombat(state, 0, lookup);

    // The defender took nothing and lives; the attacker took 3 and does not,
    // since 3 damage on 4 Might is not lethal.
    expect(state.units.d1).toBeDefined();
    expect(state.units.a1).toBeDefined();
  });

  it('still needs its full Might in damage to die (423.1.c)', () => {
    // The trap: reading "no Might" as "0 Might" would make a stunned unit die
    // to a single point of damage.
    const state = table();
    placeUnit(state, might3, 'p1', 'a1', 'attacker');
    placeUnit(state, might4, 'p2', 'd1', 'defender');
    stun(state, 'd1');

    expect(unitMight(state, 'd1', lookup)).toBe(4);
    resolveCombat(state, 0, lookup);
    expect(state.units.d1).toBeDefined(); // 3 damage on 4 Might
  });

  it('dies as normal once the damage reaches its full Might', () => {
    const state = table();
    placeUnit(state, might4, 'p1', 'a1', 'attacker');
    placeUnit(state, might4, 'p2', 'd1', 'defender');
    stun(state, 'd1');

    resolveCombat(state, 0, lookup);
    expect(state.units.d1).toBeUndefined();
    expect(state.players.p2.trash).toContain('d1');
    // The stunned defender dealt nothing back.
    expect(state.units.a1).toBeDefined();
  });

  it('cannot be stunned twice (423.1.a.1)', () => {
    const state = table();
    placeUnit(state, might3, 'p1', 'u1');
    expect(stun(state, 'u1')).toBe(true);
    expect(stun(state, 'u1')).toBe(false);
  });

  it('clears at the Ending Phase, for every unit (423.1.a.2)', () => {
    const state = table();
    placeUnit(state, might3, 'p1', 'u1');
    placeUnit(state, might3, 'p2', 'e1');
    stun(state, 'u1');
    stun(state, 'e1');

    const ended = reduce(state, { type: 'END_TURN' }, lookup);
    expect(ended.ok).toBe(true);
    if (!ended.ok) return;
    expect(ended.state.units.u1.stunned).toBe(false);
    expect(ended.state.units.e1.stunned).toBe(false);
  });
});

describe('Empower (441, 442)', () => {
  it('is binary and cannot be applied twice (441.1.b)', () => {
    const state = table();
    placeUnit(state, might3, 'p1', 'u1');
    expect(empower(state, 'u1')).toBe(true);
    expect(empower(state, 'u1')).toBe(false);
    expect(state.units.u1.empowered).toBe(true);
  });

  it('is removed only by Disempower, and does nothing to a plain unit (442.1.a.1)', () => {
    const state = table();
    placeUnit(state, might3, 'p1', 'u1');
    expect(disempower(state, 'u1')).toBe(false);

    empower(state, 'u1');
    expect(disempower(state, 'u1')).toBe(true);
    expect(state.units.u1.empowered).toBe(false);
  });

  it('survives the end of the turn', () => {
    const state = table();
    placeUnit(state, might3, 'p1', 'u1');
    empower(state, 'u1');
    stun(state, 'u1');

    expireStatuses(state);
    expect(state.units.u1.stunned).toBe(false);
    expect(state.units.u1.empowered).toBe(true);
  });
});

describe('XP (728-733)', () => {
  it('is gained and spent', () => {
    const state = table();
    gainXp(state, 'p1', 3);
    expect(state.players.p1.xp).toBe(3);
    expect(spendXp(state, 'p1', 2)).toBe(true);
    expect(state.players.p1.xp).toBe(1);
  });

  it('cannot be spent below zero, since it is a cost (730.2)', () => {
    const state = table();
    gainXp(state, 'p1', 1);
    expect(spendXp(state, 'p1', 2)).toBe(false);
    expect(state.players.p1.xp).toBe(1);
  });

  it('has no cap and never expires (733)', () => {
    const state = table();
    gainXp(state, 'p1', 40);

    const ended = reduce(state, { type: 'END_TURN' }, lookup);
    expect(ended.ok).toBe(true);
    if (ended.ok) expect(ended.state.players.p1.xp).toBe(40);
  });

  it('is public information, so redact leaves it alone (729.2)', () => {
    const state = table();
    gainXp(state, 'p1', 5);
    expect(redact(state, 'p2').players.p1.xp).toBe(5);
  });
});
