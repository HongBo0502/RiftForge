import { describe, expect, it } from 'vitest';
import type { Card } from '@/types';
import { BY_ID, findCard } from '@/test/dataset';
import { counterItem, resolveTop, targetIsLegal } from './chain';
import { hasKeyword } from './keywords';
import { reduce } from './reducer';
import type { ChainItem, GameState, PlayerId } from './types';

const lookup = (cardId: string): Card | undefined => BY_ID.get(cardId);

/**
 * The Chain. 327-340
 *
 * A spell is not resolved by playing it: it sits on the chain, both players get
 * a window, and the newest one resolves first. Every test here names the rule
 * it holds to.
 */

const cheap = (c: Card) => (c.energy ?? 0) <= 3;

/** No [Action], no [Reaction] — playable only in your own open Main Phase. */
const plainSpell = findCard(
  (c) => c.type === 'Spell' && cheap(c) && !hasKeyword(c, 'Action') && !hasKeyword(c, 'Reaction'),
  'a spell with no timing keyword',
);
/** [Action] — adds showdowns, but not a live chain. 806.1.b */
const actionSpell = findCard(
  (c) => c.type === 'Spell' && cheap(c) && hasKeyword(c, 'Action') && !hasKeyword(c, 'Reaction'),
  'a spell with Action',
);
/** [Reaction] — playable even in a Closed State. 159.2.b.2 */
const reactionSpell = findCard(
  (c) => c.type === 'Spell' && cheap(c) && hasKeyword(c, 'Reaction'),
  'a spell with Reaction',
);
const plainUnit = findCard((c) => c.type === 'Unit' && cheap(c), 'a cheap unit');
const anyRune = findCard((c) => c.type === 'Rune', 'a rune');

/** Main-phase board with one battlefield and resources for both players. */
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
    energy: 30,
    power: { Mind: 9, Chaos: 9, Order: 9, Calm: 9, Body: 9, Fury: 9 },
    xp: 0,
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
    battlefields: [
      { uid: 'bf', contributedBy: 'p1', controller: null, contested: false, scoredBy: [] },
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

  // One ready rune each, so a player can fund an answer mid-chain. 164.2.a
  for (const id of ['p1', 'p2'] as PlayerId[]) {
    const uid = `${id}-rune`;
    state.instances[uid] = { uid, cardId: anyRune.id, owner: id };
    state.runes[uid] = { uid, controller: id, ready: true };
  }
  return state;
}

/** Puts a card in a player's hand and returns its uid. */
function inHand(state: GameState, card: Card, owner: PlayerId, uid: string): string {
  state.instances[uid] = { uid, cardId: card.id, owner };
  state.players[owner].hand.push(uid);
  return uid;
}

function placeUnit(state: GameState, controller: PlayerId, uid: string, index = 0) {
  state.instances[uid] = { uid, cardId: plainUnit.id, owner: controller };
  state.units[uid] = {
    uid,
    controller,
    location: { kind: 'battlefield', index },
    ready: true,
    damage: 0,
    mightBonus: 0,
    buffs: 0,
    stunned: false,
    empowered: false,
    designation: null,
    enteredOnTurn: 1,
    movesThisTurn: 0,
  };
}

/** Applies an action, failing the test with the engine's own reason. */
function apply(state: GameState, action: Parameters<typeof reduce>[1]): GameState {
  const result = reduce(state, action, lookup);
  if (!result.ok) throw new Error(`${action.type} rejected: ${result.reason}`);
  return result.state;
}

describe('playing a spell (359.3.a)', () => {
  it('puts it on the chain rather than resolving it', () => {
    const state = table();
    const uid = inHand(state, plainSpell, 'p1', 's1');

    const played = apply(state, { type: 'PLAY_CARD', uid });
    expect(played.chain).toHaveLength(1);
    expect(played.chain[0].uid).toBe(uid);
    // Not resolved, so not yet in the trash. 359.3.d
    expect(played.players.p1.trash).not.toContain(uid);
    expect(played.players.p1.hand).not.toContain(uid);
  });

  it('gives priority to the caster first (340.4)', () => {
    const state = table();
    const uid = inHand(state, plainSpell, 'p1', 's1');
    const played = apply(state, { type: 'PLAY_CARD', uid });
    expect(played.priority).toBe('p1');
  });

  it('needs both players to pass before it resolves (339.1)', () => {
    const state = table();
    const uid = inHand(state, plainSpell, 'p1', 's1');
    let game = apply(state, { type: 'PLAY_CARD', uid });

    game = apply(game, { type: 'PASS_PRIORITY' });
    // One pass only hands the window over.
    expect(game.chain).toHaveLength(1);
    expect(game.priority).toBe('p2');

    game = apply(game, { type: 'PASS_PRIORITY' });
    expect(game.chain).toHaveLength(0);
    expect(game.priority).toBeNull();
    expect(game.players.p1.trash).toContain(uid);
  });

  it('resolves the newest item first (340.1)', () => {
    const state = table();
    const first = inHand(state, plainSpell, 'p1', 's1');
    const second = inHand(state, reactionSpell, 'p2', 's2');

    let game = apply(state, { type: 'PLAY_CARD', uid: first });
    game = apply(game, { type: 'PASS_PRIORITY' }); // priority to p2
    game = apply(game, { type: 'PLAY_CARD', uid: second });
    expect(game.chain.map((i) => i.uid)).toEqual([first, second]);

    // Both pass: only the newest resolves, and the older one is still waiting.
    game = apply(game, { type: 'PASS_PRIORITY' });
    game = apply(game, { type: 'PASS_PRIORITY' });
    expect(game.players.p2.trash).toContain(second);
    expect(game.chain.map((i) => i.uid)).toEqual([first]);

    game = apply(game, { type: 'PASS_PRIORITY' });
    game = apply(game, { type: 'PASS_PRIORITY' });
    expect(game.players.p1.trash).toContain(first);
    expect(game.chain).toHaveLength(0);
  });

  it("flags a spell's text when it resolves, not when it is played", () => {
    // The text of a spell applies on resolution (359.3.d), so flagging it any
    // earlier would tell a player to apply an effect that can still be answered.
    const state = table();
    const uid = inHand(state, plainSpell, 'p1', 's1');

    let game = apply(state, { type: 'PLAY_CARD', uid });
    expect(game.unautomated).toHaveLength(0);

    game = apply(game, { type: 'PASS_PRIORITY' });
    game = apply(game, { type: 'PASS_PRIORITY' });
    expect(game.unautomated.length).toBeGreaterThan(0);
  });
});

describe('the timing gate (358.4)', () => {
  it('allows only Reaction while the chain is up (331.1.a)', () => {
    const state = table();
    const opener = inHand(state, plainSpell, 'p1', 's1');
    inHand(state, actionSpell, 'p2', 's2');
    inHand(state, reactionSpell, 'p2', 's3');

    let game = apply(state, { type: 'PLAY_CARD', uid: opener });
    game = apply(game, { type: 'PASS_PRIORITY' });

    const tooSlow = reduce(game, { type: 'PLAY_CARD', uid: 's2' }, lookup);
    expect(tooSlow.ok).toBe(false);
    if (!tooSlow.ok) expect(tooSlow.rule).toBe('331.1.a');

    const answer = reduce(game, { type: 'PLAY_CARD', uid: 's3' }, lookup);
    expect(answer.ok).toBe(true);
  });

  it('allows Action in a showdown but not a plain spell (806.1.b)', () => {
    const state = table();
    inHand(state, plainSpell, 'p1', 's1');
    inHand(state, actionSpell, 'p1', 's2');
    state.showdown = {
      battlefield: 0,
      combat: true,
      attacker: 'p1',
      defender: 'p2',
      focus: 'p1',
      passes: 0,
    };

    const refused = reduce(state, { type: 'PLAY_CARD', uid: 's1' }, lookup);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.rule).toBe('806.1.b');

    expect(reduce(state, { type: 'PLAY_CARD', uid: 's2' }, lookup).ok).toBe(true);
  });

  it('lets the defender answer while they have Focus (335.1)', () => {
    /*
     * The reducer used to treat the Turn Player as the only actor, so a
     * defender could never play the Reaction that the whole showdown window
     * exists for.
     */
    const state = table();
    inHand(state, reactionSpell, 'p2', 's1');
    state.showdown = {
      battlefield: 0,
      combat: true,
      attacker: 'p1',
      defender: 'p2',
      focus: 'p2',
      passes: 0,
    };

    const played = apply(state, { type: 'PLAY_CARD', uid: 's1' });
    expect(played.chain[0].controller).toBe('p2');
  });

  it('passes Focus once the chain empties in a showdown (340.2.a)', () => {
    const state = table();
    inHand(state, actionSpell, 'p1', 's1');
    state.showdown = {
      battlefield: 0,
      combat: true,
      attacker: 'p1',
      defender: 'p2',
      focus: 'p1',
      passes: 0,
    };

    let game = apply(state, { type: 'PLAY_CARD', uid: 's1' });
    game = apply(game, { type: 'PASS_PRIORITY' });
    game = apply(game, { type: 'PASS_PRIORITY' });
    expect(game.chain).toHaveLength(0);
    expect(game.showdown?.focus).toBe('p2');
  });
});

describe('a Closed State stops the board (331.1)', () => {
  function withChain(): GameState {
    const state = table();
    const uid = inHand(state, plainSpell, 'p1', 's1');
    placeUnit(state, 'p1', 'u1');
    return apply(state, { type: 'PLAY_CARD', uid });
  }

  it('refuses moves, phase changes and ending the turn', () => {
    const game = withChain();
    for (const action of [
      { type: 'MOVE_UNIT', uid: 'u1', to: { kind: 'base', player: 'p1' } },
      { type: 'END_TURN' },
      { type: 'ADVANCE_PHASE' },
    ] as Parameters<typeof reduce>[1][]) {
      const result = reduce(game, action, lookup);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.rule).toBe('331.1');
    }
  });

  it('still allows rune abilities, which are themselves Reactions (164.2.a)', () => {
    // Without this a player could not fund the answer they are being given the
    // window to play.
    const game = withChain();
    const passed = apply(game, { type: 'PASS_PRIORITY' }); // p2 to act
    const before = passed.players.p2.energy;

    const result = reduce(passed, { type: 'EXHAUST_RUNE', uid: 'p2-rune' }, lookup);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.state.players.p2.energy).toBe(before + 1);
  });
});

describe('countering (425)', () => {
  it('clears the item, trashes the card and refunds nothing', () => {
    const state = table();
    const uid = inHand(state, plainSpell, 'p1', 's1');
    const played = apply(state, { type: 'PLAY_CARD', uid });

    // What the spell actually cost, already spent as it was finalized.
    const spentEnergy = 30 - played.players.p1.energy;
    expect(spentEnergy).toBe(plainSpell.energy ?? 0);

    const game = structuredClone(played);
    expect(counterItem(game, uid, lookup)).toBe(true);

    // 425.1.a — cleared from the chain, doing nothing.
    expect(game.chain).toHaveLength(0);
    expect(game.unautomated).toHaveLength(0);
    // 425.1.a.1 — the card still goes to the trash.
    expect(game.players.p1.trash).toContain(uid);
    // 425.1.c — and the cost stays spent.
    expect(game.players.p1.energy).toBe(30 - spentEnergy);
    expect(game.priority).toBeNull();
  });

  it('leaves the rest of the chain intact and hands priority back', () => {
    const state = table();
    const first = inHand(state, plainSpell, 'p1', 's1');
    const second = inHand(state, reactionSpell, 'p2', 's2');

    let game = apply(state, { type: 'PLAY_CARD', uid: first });
    game = apply(game, { type: 'PASS_PRIORITY' });
    game = apply(game, { type: 'PLAY_CARD', uid: second });

    const draft = structuredClone(game);
    counterItem(draft, second, lookup);
    expect(draft.chain.map((i) => i.uid)).toEqual([first]);
    expect(draft.priority).toBe('p1');
  });
});

describe('targets that disappear (359.3.e)', () => {
  /** A two-instruction spell: one targeted, one not. */
  function twoStep(targets: string[]): ChainItem {
    return {
      uid: 's1',
      controller: 'p1',
      kind: 'spell',
      instructions: [
        { text: 'Deal 4 to a unit at a battlefield.', targets },
        { text: 'Draw 1.', targets: [] },
      ],
    };
  }

  it('skips only the instruction whose target is gone (359.3.e.7)', () => {
    const state = table();
    state.instances.s1 = { uid: 's1', cardId: plainSpell.id, owner: 'p1' };
    placeUnit(state, 'p2', 'u1');
    state.chain.push(twoStep(['u1']));

    // The unit is saved before the spell resolves.
    delete state.units.u1;

    const outcome = resolveTop(state, lookup);
    expect(outcome).not.toBeNull();
    expect(outcome!.fizzled.map((i) => i.text)).toEqual(['Deal 4 to a unit at a battlefield.']);
    // 359.3.e.10 — the rest of the card still resolves.
    expect(outcome!.executed.map((i) => i.text)).toEqual(['Draw 1.']);
  });

  it('executes on the survivors when only some targets are gone (359.3.e.8)', () => {
    const state = table();
    state.instances.s1 = { uid: 's1', cardId: plainSpell.id, owner: 'p1' };
    placeUnit(state, 'p2', 'u1');
    placeUnit(state, 'p2', 'u2');
    state.chain.push(twoStep(['u1', 'u2']));

    delete state.units.u2;

    const outcome = resolveTop(state, lookup)!;
    expect(outcome.fizzled).toHaveLength(0);
    expect(outcome.executed[0].targets).toEqual(['u1']);
  });

  it('still resolves and trashes the spell when every target is gone (359.3.e.1)', () => {
    const state = table();
    state.instances.s1 = { uid: 's1', cardId: plainSpell.id, owner: 'p1' };
    state.chain.push({
      uid: 's1',
      controller: 'p1',
      kind: 'spell',
      instructions: [{ text: 'Kill a unit.', targets: ['ghost'] }],
    });

    const outcome = resolveTop(state, lookup)!;
    expect(outcome.executed).toHaveLength(0);
    expect(state.players.p1.trash).toContain('s1');
    // Nothing was applied, so there is nothing to tell the player to do by hand.
    expect(state.unautomated).toHaveLength(0);
  });

  it('counts players and battlefields as targets that cannot be lost', () => {
    const state = table();
    expect(targetIsLegal(state, 'p2')).toBe(true);
    expect(targetIsLegal(state, 'bf:0')).toBe(true);
    expect(targetIsLegal(state, 'bf:9')).toBe(false);
  });
});
