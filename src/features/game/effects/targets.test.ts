import { describe, expect, it } from 'vitest';
import type { Card } from '@/types';
import { BY_ID, findCard } from '@/test/dataset';
import { reduce } from '../engine/reducer';
import type { GameAction, GameState, PlayerId } from '../engine/types';
import { manualText, onPlayAbilities } from './scripts';
import { describeRequest, legalTargets, targetRequests } from './targets';

/**
 * Targeting (355.6-355.8) and "When you play me" (383), end to end through the
 * reducer: choose as the card is played, resolve off the chain.
 */

const lookup = (cardId: string): Card | undefined => BY_ID.get(cardId);

const bystander = findCard(
  (c) => c.type === 'Unit' && (c.might ?? 0) === 3 && onPlayAbilities(c).length === 0,
  'a 3 Might unit with no on-play ability',
);

/** A spell that kills one unit and does nothing else — fully scripted. */
const killSpell = findCard(
  (c) =>
    c.type === 'Spell' &&
    manualText(c) === null &&
    targetRequests(c).length === 1 &&
    targetRequests(c)[0].verb === 'kill' &&
    targetRequests(c)[0].selector.kind === 'unit' &&
    targetRequests(c)[0].selector.side === 'any',
  'a scripted "kill a unit" spell',
);

/** A unit whose only text is a scripted "When you play me" that chooses one unit. */
const triggerUnit = findCard(
  (c) =>
    c.type === 'Unit' &&
    manualText(c) === null &&
    onPlayAbilities(c).length === 1 &&
    targetRequests(c).length === 1,
  'a unit with a scripted targeted "when you play me"',
);

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
    power: { Mind: 9, Chaos: 9, Order: 9, Calm: 9, Body: 9, Fury: 9 },
    xp: 0,
    finalizedThisTurn: [] as string[],
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
      { uid: 'bf0', contributedBy: 'p1', controller: null, contested: false, scoredBy: [] },
      { uid: 'bf1', contributedBy: 'p2', controller: null, contested: false, scoredBy: [] },
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
  for (const id of ['p1', 'p2'] as PlayerId[]) {
    for (let i = 0; i < 6; i++) {
      const uid = `${id}-deck-${i}`;
      state.instances[uid] = { uid, cardId: bystander.id, owner: id };
      state.players[id].mainDeck.push(uid);
    }
  }
  return state;
}

function placeUnit(state: GameState, controller: PlayerId, uid: string, index = 0): void {
  state.instances[uid] = { uid, cardId: bystander.id, owner: controller };
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

function inHand(state: GameState, card: Card, uid: string): void {
  state.instances[uid] = { uid, cardId: card.id, owner: 'p1' };
  state.players.p1.hand.push(uid);
}

function apply(state: GameState, action: GameAction): GameState {
  const result = reduce(state, action, lookup);
  if (!result.ok) throw new Error(`${action.type} rejected: ${result.reason}`);
  return result.state;
}

function refusal(state: GameState, action: GameAction): { reason: string; rule?: string } {
  const result = reduce(state, action, lookup);
  if (result.ok) throw new Error(`${action.type} was accepted`);
  return result;
}

/** Both players pass, resolving the newest chain item. */
const resolveTop = (state: GameState) =>
  apply(apply(state, { type: 'PASS_PRIORITY' }), { type: 'PASS_PRIORITY' });

describe('targeting a spell', () => {
  it('asks for each choice in plain words', () => {
    expect(describeRequest(targetRequests(killSpell)[0])).toMatch(/^Choose an? .*unit.* to kill$/);
  });

  it('cannot be played with no legal target (355.8)', () => {
    const state = table();
    inHand(state, killSpell, 'spell');
    expect(refusal(state, { type: 'PLAY_CARD', uid: 'spell' })).toMatchObject({ rule: '355.8' });
  });

  it('must be told its target, and only a legal one', () => {
    const state = table();
    placeUnit(state, 'p2', 'enemy');
    inHand(state, killSpell, 'spell');
    expect(refusal(state, { type: 'PLAY_CARD', uid: 'spell' }).reason).toMatch(/^Choose/);
    expect(refusal(state, { type: 'PLAY_CARD', uid: 'spell', targets: ['nobody'] }).reason).toMatch(
      /not a legal target/,
    );
  });

  it('resolves on the unit it chose', () => {
    const state = table();
    placeUnit(state, 'p2', 'enemy');
    placeUnit(state, 'p2', 'other');
    inHand(state, killSpell, 'spell');
    expect(legalTargets(state, 'p1', targetRequests(killSpell)[0].selector)).toEqual(
      expect.arrayContaining(['enemy', 'other']),
    );

    const cast = apply(state, { type: 'PLAY_CARD', uid: 'spell', targets: ['enemy'] });
    expect(cast.chain.at(-1)?.chosen).toEqual(['enemy']);

    const done = resolveTop(cast);
    expect(done.units.enemy).toBeUndefined();
    expect(done.units.other).toBeDefined();
    expect(done.players.p2.trash).toContain('enemy');
    expect(done.players.p1.trash).toContain('spell');
    expect(done.unautomated).toHaveLength(0);
  });

  it('does nothing to a target that left before it resolved (359.3.e.7)', () => {
    const state = table();
    placeUnit(state, 'p2', 'enemy');
    inHand(state, killSpell, 'spell');
    const cast = apply(state, { type: 'PLAY_CARD', uid: 'spell', targets: ['enemy'] });
    delete cast.units.enemy;
    const done = resolveTop(cast);
    expect(done.players.p1.trash).toContain('spell');
    expect(done.players.p2.trash).not.toContain('enemy');
  });
});

describe('"When you play me"', () => {
  it('goes on the chain with its target and resolves on it', () => {
    const state = table();
    placeUnit(state, 'p2', 'enemy');
    placeUnit(state, 'p1', 'friend');
    inHand(state, triggerUnit, 'trigger');
    const options = legalTargets(state, 'p1', targetRequests(triggerUnit)[0].selector);
    const target = options[0];

    const played = apply(state, { type: 'PLAY_CARD', uid: 'trigger', targets: [target] });
    expect(played.units.trigger).toBeDefined();
    expect(played.chain.at(-1)).toMatchObject({ uid: 'trigger', trigger: 'play', chosen: [target] });

    const done = resolveTop(played);
    expect(done.chain).toHaveLength(0);
    expect(done.log.some((l) => /resolved/.test(l.text))).toBe(true);
  });

  it('is still playable with nothing to choose — the trigger just does nothing', () => {
    const state = table();
    inHand(state, triggerUnit, 'trigger');
    const played = apply(state, { type: 'PLAY_CARD', uid: 'trigger' });
    expect(played.units.trigger).toBeDefined();
    expect(played.chain.at(-1)?.chosen).toEqual(['']);
    expect(resolveTop(played).chain).toHaveLength(0);
  });
});

describe('scripted abilities the engine does not run', () => {
  it('never look automated', () => {
    // "When I attack" has no trigger system yet, so the card stays by hand.
    const attacker = findCard(
      (c) => c.type === 'Unit' && /^When I attack, deal 1 to an enemy unit here\.$/.test(c.text ?? ''),
      'an attack-trigger unit',
    );
    expect(manualText(attacker)).not.toBeNull();
  });
});
