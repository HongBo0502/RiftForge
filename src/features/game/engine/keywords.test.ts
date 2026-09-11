import { describe, expect, it } from 'vitest';
import type { Card } from '@/types';
import { BY_ID, findCard } from '@/test/dataset';
import { cardIsMighty, isMighty } from './combat';
import {
  clauseIsActive,
  dependencyContext,
  dependentClauses,
  hasKeyword,
  keywordValue,
  unautomatedText,
} from './keywords';
import { deflectSurcharge } from './payment';
import { reduce } from './reducer';
import { buff, empower } from './statuses';
import type { GameState, PlayerId } from './types';

const lookup = (cardId: string): Card | undefined => BY_ID.get(cardId);

/**
 * Keywords the engine enforces on its own. 805-829
 *
 * Everything here is a passive, a cost, a timing permission or an engine event —
 * none of it needs card-specific effect text, which is exactly why it can be
 * automated before the effects registry exists.
 */

const cheap = (c: Card) => (c.energy ?? 0) <= 3 && (c.power ?? 0) <= 3;

const ambusher = findCard(
  (c) => c.type === 'Unit' && cheap(c) && hasKeyword(c, 'Ambush'),
  'a cheap unit with Ambush',
);
const plainUnit = findCard(
  (c) => c.type === 'Unit' && cheap(c) && !hasKeyword(c, 'Ambush') && !hasKeyword(c, 'Action'),
  'a cheap unit with no timing keyword',
);
const deflector = findCard(
  (c) => c.type === 'Unit' && hasKeyword(c, 'Deflect'),
  'a unit with Deflect',
);
const hunter = findCard((c) => c.type === 'Unit' && hasKeyword(c, 'Hunt'), 'a unit with Hunt');
const quickDraw = findCard(
  (c) => c.type === 'Gear' && cheap(c) && hasKeyword(c, 'Quick-Draw'),
  'a gear with Quick-Draw',
);
const levelled = findCard((c) => hasKeyword(c, 'Level'), 'a card with Level');
const legionary = findCard((c) => hasKeyword(c, 'Legion'), 'a card with Legion');
const empoweredCard = findCard((c) => hasKeyword(c, 'Empowered'), 'a card with an Empowered ability');
const uniqueCard = findCard((c) => hasKeyword(c, 'Unique'), 'a card with Unique');
const spell = findCard(
  (c) => c.type === 'Spell' && cheap(c) && !hasKeyword(c, 'Action') && !hasKeyword(c, 'Reaction'),
  'a cheap plain spell',
);

/** Two battlefields, resources to spare, and stocked decks. */
function table(controllers: (PlayerId | null)[] = [null, null]): GameState {
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
    battlefields: controllers.map((controller, i) => ({
      uid: `bf${i}`,
      contributedBy: 'p1' as PlayerId,
      controller,
      contested: false,
      scoredBy: [] as PlayerId[],
    })),
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
    for (let i = 0; i < 12; i++) {
      const uid = `${id}-deck-${i}`;
      state.instances[uid] = { uid, cardId: plainUnit.id, owner: id };
      state.players[id].mainDeck.push(uid);
    }
  }
  return state;
}

function inHand(state: GameState, card: Card, owner: PlayerId, uid: string): string {
  state.instances[uid] = { uid, cardId: card.id, owner };
  state.players[owner].hand.push(uid);
  return uid;
}

function placeUnit(state: GameState, card: Card, controller: PlayerId, uid: string, index = 0) {
  state.instances[uid] = { uid, cardId: card.id, owner: controller };
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

/** Total resources a player has spent from the table's starting pool. */
const spent = (state: GameState, player: PlayerId) =>
  30 -
  state.players[player].energy +
  (54 - Object.values(state.players[player].power).reduce<number>((t, n) => t + (n ?? 0), 0));

describe('Ambush (822)', () => {
  it('plays to a battlefield you do not control but have units at (822.1.b)', () => {
    const state = table([null]);
    placeUnit(state, plainUnit, 'p1', 'u1');
    const uid = inHand(state, ambusher, 'p1', 'a1');

    const played = reduce(
      state,
      { type: 'PLAY_CARD', uid, to: { kind: 'battlefield', index: 0 } },
      lookup,
    );
    expect(played.ok).toBe(true);
    if (played.ok) {
      expect(played.state.units[uid].location).toEqual({ kind: 'battlefield', index: 0 });
    }
  });

  it('is refused where you have no units and no control (822.3)', () => {
    const state = table([null]);
    const uid = inHand(state, ambusher, 'p1', 'a1');

    const played = reduce(
      state,
      { type: 'PLAY_CARD', uid, to: { kind: 'battlefield', index: 0 } },
      lookup,
    );
    expect(played.ok).toBe(false);
    if (!played.ok) expect(played.rule).toBe('822.1.b');
  });

  it('gives a plain unit no such permission', () => {
    const state = table([null]);
    placeUnit(state, plainUnit, 'p1', 'u1');
    const uid = inHand(state, plainUnit, 'p1', 'h1');

    const played = reduce(
      state,
      { type: 'PLAY_CARD', uid, to: { kind: 'battlefield', index: 0 } },
      lookup,
    );
    expect(played.ok).toBe(false);
  });

  it('carries Reaction only while it is actually ambushing (822.1.b)', () => {
    // The keyword grants Reaction "as long as I'm being played to a battlefield
    // where you control Units" — so the same card played to base is too slow.
    const state = table([null]);
    placeUnit(state, plainUnit, 'p1', 'u1');
    inHand(state, ambusher, 'p1', 'a1');
    inHand(state, ambusher, 'p1', 'a2');
    state.chain.push({
      uid: 'x',
      controller: 'p2',
      kind: 'spell',
      instructions: [{ text: 'something', targets: [] }],
    });
    state.priority = 'p1';

    const toBase = reduce(state, { type: 'PLAY_CARD', uid: 'a1' }, lookup);
    expect(toBase.ok).toBe(false);
    if (!toBase.ok) expect(toBase.rule).toBe('331.1.a');

    const ambushing = reduce(
      state,
      { type: 'PLAY_CARD', uid: 'a2', to: { kind: 'battlefield', index: 0 } },
      lookup,
    );
    expect(ambushing.ok).toBe(true);
  });
});

describe('Deflect (809)', () => {
  it('charges the extra Power only for an opponent’s object', () => {
    const state = table();
    placeUnit(state, deflector, 'p2', 'enemy');
    placeUnit(state, deflector, 'p1', 'friend');
    const value = keywordValue(deflector, 'Deflect') ?? 0;
    expect(value).toBeGreaterThan(0);

    expect(deflectSurcharge(state, 'p1', ['enemy'], lookup)).toBe(value);
    // 809.1.c — only spells an *opponent* controls pay it.
    expect(deflectSurcharge(state, 'p1', ['friend'], lookup)).toBe(0);
  });

  it('charges once for each time it is chosen (809.1.c)', () => {
    const state = table();
    placeUnit(state, deflector, 'p2', 'enemy');
    const value = keywordValue(deflector, 'Deflect') ?? 0;
    expect(deflectSurcharge(state, 'p1', ['enemy', 'enemy'], lookup)).toBe(value * 2);
  });

  it('makes a spell that chooses it cost that much more to play', () => {
    const state = table();
    placeUnit(state, deflector, 'p2', 'enemy');
    inHand(state, spell, 'p1', 's1');
    inHand(state, spell, 'p1', 's2');
    const value = keywordValue(deflector, 'Deflect') ?? 0;

    const plain = reduce(state, { type: 'PLAY_CARD', uid: 's1' }, lookup);
    const aimed = reduce(state, { type: 'PLAY_CARD', uid: 's2', targets: ['enemy'] }, lookup);
    expect(plain.ok && aimed.ok).toBe(true);
    if (!plain.ok || !aimed.ok) return;

    expect(spent(aimed.state, 'p1')).toBe(spent(plain.state, 'p1') + value);
  });
});

describe('Hunt (823)', () => {
  it('gives its controller XP when it Holds (823.1.c.1)', () => {
    const state = table(['p1']);
    placeUnit(state, hunter, 'p1', 'h1');
    const value = keywordValue(hunter, 'Hunt') ?? 0;

    // Ending p2's turn rolls round to p1's Beginning Phase, which Holds.
    state.turnPlayer = 'p2';
    const ended = reduce(state, { type: 'END_TURN' }, lookup);
    expect(ended.ok).toBe(true);
    if (!ended.ok) return;

    expect(ended.state.players.p1.points).toBe(1);
    expect(ended.state.players.p1.xp).toBe(value);
  });

  it('ignores a unit sitting at a different battlefield', () => {
    const state = table(['p1', null]);
    placeUnit(state, hunter, 'p1', 'h1', 1); // elsewhere
    placeUnit(state, plainUnit, 'p1', 'u1', 0);

    state.turnPlayer = 'p2';
    const ended = reduce(state, { type: 'END_TURN' }, lookup);
    expect(ended.ok).toBe(true);
    if (ended.ok) expect(ended.state.players.p1.xp).toBe(0);
  });
});

describe('the Dependent Keywords (812, 824, 828)', () => {
  it('reads Level N off the card', () => {
    const clauses = dependentClauses(levelled).filter((c) => c.keyword === 'Level');
    expect(clauses.length).toBeGreaterThan(0);
    expect(clauses[0].value).toBeGreaterThan(0);
  });

  it('turns a Level ability on at the XP threshold (824.1.b.1)', () => {
    const clause = dependentClauses(levelled).find((c) => c.keyword === 'Level')!;
    const need = clause.value ?? 1;

    expect(clauseIsActive(clause, { xp: need - 1, playedAnotherCard: false, empowered: false })).toBe(
      false,
    );
    expect(clauseIsActive(clause, { xp: need, playedAnotherCard: false, empowered: false })).toBe(
      true,
    );
  });

  it('hides an inactive Level ability from the apply-by-hand panel (824.1.d)', () => {
    const clause = dependentClauses(levelled).find((c) => c.keyword === 'Level')!;
    const need = clause.value ?? 1;
    // The clause's own prose, with its markers and reminder text taken off.
    const prose = clause.line
      .replace(/\([^)]*\)/g, '')
      .replace(/\[[^\]]*\]/g, '')
      .trim();
    expect(prose.length).toBeGreaterThan(0);

    const below = unautomatedText(levelled, { xp: need - 1, playedAnotherCard: true, empowered: true });
    const above = unautomatedText(levelled, { xp: need, playedAnotherCard: true, empowered: true });
    expect(above ?? '').toContain(prose);
    expect(below ?? '').not.toContain(prose);
  });

  it('drops nothing when no context is supplied', () => {
    // A caller that does not know whose card it is must not have text hidden
    // from it — silence there would be worse than over-reporting.
    expect(unautomatedText(levelled)).not.toBeNull();
  });

  it('turns Legion on once you have played another card this turn (812.1.c)', () => {
    const state = table();
    const uid = inHand(state, legionary, 'p1', 'l1');
    const clause = dependentClauses(legionary).find((c) => c.keyword === 'Legion')!;

    expect(clauseIsActive(clause, dependencyContext(state, 'p1', uid))).toBe(false);

    // Playing the Legion card itself does not satisfy it — 812.1.c says another.
    state.players.p1.finalizedThisTurn.push(uid);
    expect(clauseIsActive(clause, dependencyContext(state, 'p1', uid))).toBe(false);

    state.players.p1.finalizedThisTurn.push('something-else');
    expect(clauseIsActive(clause, dependencyContext(state, 'p1', uid))).toBe(true);
  });

  it('records what was played, and forgets it at the turn rollover', () => {
    const state = table();
    const uid = inHand(state, plainUnit, 'p1', 'h1');

    const played = reduce(state, { type: 'PLAY_CARD', uid }, lookup);
    expect(played.ok).toBe(true);
    if (!played.ok) return;
    expect(played.state.players.p1.finalizedThisTurn).toContain(uid);

    const ended = reduce(played.state, { type: 'END_TURN' }, lookup);
    expect(ended.ok).toBe(true);
    if (ended.ok) expect(ended.state.players.p1.finalizedThisTurn).toEqual([]);
  });

  it('follows the Empowered status (828.1.c)', () => {
    const state = table();
    placeUnit(state, empoweredCard.type === 'Unit' ? empoweredCard : plainUnit, 'p1', 'u1');
    const clause = dependentClauses(empoweredCard).find((c) => c.keyword === 'Empowered')!;

    expect(clauseIsActive(clause, dependencyContext(state, 'p1', 'u1'))).toBe(false);
    empower(state, 'u1');
    expect(clauseIsActive(clause, dependencyContext(state, 'p1', 'u1'))).toBe(true);
  });
});

describe('Quick-Draw (819)', () => {
  it('gives its gear Reaction without the keyword being printed (819.1.b)', () => {
    expect(hasKeyword(quickDraw, 'Reaction')).toBe(false);

    const state = table();
    inHand(state, quickDraw, 'p1', 'g1');
    state.chain.push({
      uid: 'x',
      controller: 'p2',
      kind: 'spell',
      instructions: [{ text: 'something', targets: [] }],
    });
    state.priority = 'p1';

    const played = reduce(state, { type: 'PLAY_CARD', uid: 'g1' }, lookup);
    expect(played.ok).toBe(true);
  });
});

describe('Mighty (706-711)', () => {
  it('is Might 5 or more, counting what is on the unit now (708, 710)', () => {
    const four = findCard((c) => c.type === 'Unit' && c.might === 4, 'a 4 Might unit');
    const state = table();
    placeUnit(state, four, 'p1', 'u1');

    expect(isMighty(state, 'u1', lookup)).toBe(false);
    buff(state, 'u1');
    expect(isMighty(state, 'u1', lookup)).toBe(true);
  });

  it('uses printed Might off the board (711)', () => {
    const five = findCard((c) => c.type === 'Unit' && (c.might ?? 0) >= 5, 'a 5+ Might unit');
    const two = findCard((c) => c.type === 'Unit' && c.might === 2, 'a 2 Might unit');
    expect(cardIsMighty(five)).toBe(true);
    expect(cardIsMighty(two)).toBe(false);
  });
});

describe('Unique (825)', () => {
  it('exists in the dataset and is read as a keyword', () => {
    expect(hasKeyword(uniqueCard, 'Unique')).toBe(true);
  });
});

describe('reminder text is not rules text (135.2.d.3)', () => {
  /*
   * The bug this guards. Reminder text quotes other keywords constantly —
   * Ambush's reads "(You may play me as a [Reaction] to a battlefield where you
   * have units.)" — and reading keywords out of the raw text made every one of
   * those cards Reaction outright. With the chain in place that let an Ambush
   * unit be played into any closed state, ignoring the condition the keyword
   * actually has.
   */
  it('does not grant a keyword that only appears inside parentheses', () => {
    expect(ambusher.text ?? '').toMatch(/\([^)]*\[Reaction\][^)]*\)/);
    expect(hasKeyword(ambusher, 'Reaction')).toBe(false);
  });

  it('still reads a keyword printed outside its own reminder text', () => {
    // The marker and its reminder sit side by side, so the stripper has to take
    // the parentheses and leave the marker.
    expect(hasKeyword(ambusher, 'Ambush')).toBe(true);
  });

  it('applies to the dependent keywords too', () => {
    const quoted = { text: 'Draw 1. (This is not a [Level 3] ability.)' } as Card;
    expect(dependentClauses(quoted)).toHaveLength(0);
  });
});

describe('what is still not automated', () => {
  it('keeps the keywords that need card effect text off the automated list', () => {
    /*
     * The honesty check. These five cannot be automated by the engine alone:
     * Deathknell and Vision are triggered abilities whose effect is card text,
     * Weaponmaster and Flow need an inline cost parser, and Repeat needs both.
     * If one of them is ever added here, it should be because it works.
     */
    for (const keyword of ['Deathknell', 'Vision', 'Repeat', 'Weaponmaster', 'Flow']) {
      const card = findCard((c) => hasKeyword(c, keyword), `a card with ${keyword}`);
      const text = unautomatedText(card, { xp: 99, playedAnotherCard: true, empowered: true });
      expect(text, `${keyword} should still be surfaced`).not.toBeNull();
      expect(text).toContain(`[${keyword}`);
    }
  });
});
