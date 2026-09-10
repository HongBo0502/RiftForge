import { beforeEach, describe, expect, it } from 'vitest';
import type { Card } from '@/types';
import { BY_ID, CARDS, card, findCard } from '@/test/dataset';
import type { Deck } from '@/features/decks/types';
import { emptyDeck } from '@/features/decks/types';
import { assignDamage, resolveCombat, unitMight } from './combat';
import { hasKeyword, keywordValue, unautomatedText } from './keywords';
import { redact, isConcealed, CONCEALED } from './redact';
import { reduce, startGame } from './reducer';
import { OPENING_HAND, resetUids, setupGame } from './setup';
import type { GameAction, GameState, PlayerId } from './types';

const lookup = (cardId: string): Card | undefined => BY_ID.get(cardId);

const legend = card('Teemo - Swift Scout');
const champion = card('Teemo - Strategist');
const mindRune = CARDS.find((c) => c.type === 'Rune' && c.domains[0] === 'Mind')!;
const chaosRune = CARDS.find((c) => c.type === 'Rune' && c.domains[0] === 'Chaos')!;
const battlefieldCards = CARDS.filter((c) => c.type === 'Battlefield').slice(0, 6);

/** Mind/Chaos units, cheapest first, for filling decks with playable bodies. */
const units = CARDS.filter(
  (c) =>
    c.type === 'Unit' &&
    !c.signature &&
    c.domains.every((d) => d === 'Mind' || d === 'Chaos' || d === 'Colorless'),
).sort((a, b) => (a.energy ?? 99) - (b.energy ?? 99));

function makeDeck(player: PlayerId, battlefieldOffset: number): Deck {
  const deck = emptyDeck(`${player} deck`);
  deck.legendId = legend.id;
  deck.championId = champion.id;
  deck.main = [{ cardId: champion.id, qty: 1 }];
  for (const u of units.slice(0, 20)) deck.main.push({ cardId: u.id, qty: 2 });
  deck.runes = [
    { cardId: mindRune.id, qty: 6 },
    { cardId: chaosRune.id, qty: 6 },
  ];
  // Distinct battlefields per player so the two in play are distinguishable.
  deck.battlefields = battlefieldCards.slice(battlefieldOffset, battlefieldOffset + 3).map((b) => b.id);
  return deck;
}

function newGame(seed = 7, firstPlayer: PlayerId = 'p1'): GameState {
  resetUids();
  return startGame(
    setupGame({ decks: { p1: makeDeck('p1', 0), p2: makeDeck('p2', 3) }, byId: BY_ID, seed, firstPlayer }),
    lookup,
  );
}

/** Applies an action, failing the test with the engine's own reason if rejected. */
function apply(state: GameState, action: GameAction): GameState {
  const result = reduce(state, action, lookup);
  if (!result.ok) throw new Error(`${action.type} rejected: ${result.reason}`);
  return result.state;
}

/** Gives a player enough resources to pay for anything, for focused tests. */
function grantResources(state: GameState, player: PlayerId): GameState {
  const next = structuredClone(state);
  next.players[player].energy = 99;
  next.players[player].power = { Mind: 99, Chaos: 99 };
  return next;
}

/** Puts a unit straight onto the board, bypassing costs. */
function placeUnit(
  state: GameState,
  cardObj: Card,
  controller: PlayerId,
  location: GameState['units'][string]['location'],
): { state: GameState; uid: string } {
  const next = structuredClone(state);
  const uid = `t${Object.keys(next.instances).length + 1}`;
  next.instances[uid] = { uid, cardId: cardObj.id, owner: controller };
  next.units[uid] = {
    uid,
    controller,
    location,
    ready: true,
    damage: 0,
    mightBonus: 0,
    designation: null,
    enteredOnTurn: next.turn,
    movesThisTurn: 0,
  };
  return { state: next, uid };
}

describe('setup', () => {
  beforeEach(resetUids);

  it('deals a 4-card opening hand and holds the champion in its own zone', () => {
    resetUids();
    const fresh = setupGame({
      decks: { p1: makeDeck('p1', 0), p2: makeDeck('p2', 3) },
      byId: BY_ID,
      seed: 7,
      firstPlayer: 'p1',
    });
    expect(fresh.players.p1.hand).toHaveLength(OPENING_HAND);
    expect(fresh.players.p2.hand).toHaveLength(OPENING_HAND);

    // The first player then draws in their own Draw Phase (315.4).
    const game = newGame();
    expect(game.players.p1.hand).toHaveLength(OPENING_HAND + 1);
    expect(game.players.p2.hand).toHaveLength(OPENING_HAND);

    expect(game.players.p1.championZone).not.toBeNull();
    expect(lookup(game.instances[game.players.p1.championZone!].cardId)?.name).toBe(champion.name);
  });

  it('puts exactly two battlefields in play, one from each player (485.4)', () => {
    const game = newGame();
    expect(game.battlefields).toHaveLength(2);
    expect(game.battlefields.map((b) => b.contributedBy).sort()).toEqual(['p1', 'p2']);
    expect(game.battlefields.every((b) => b.controller === null)).toBe(true);
  });

  it('is deterministic for a given seed', () => {
    expect(JSON.stringify(newGame(42))).toBe(JSON.stringify(newGame(42)));
    expect(JSON.stringify(newGame(42))).not.toBe(JSON.stringify(newGame(43)));
  });

  it('opens on the first player in their Main Phase', () => {
    const game = newGame(7, 'p2');
    expect(game.turnPlayer).toBe('p2');
    expect(game.phase).toBe('main');
  });
});

describe('turn structure and resources', () => {
  it('channels 2 runes, and 3 for the player going second on their first turn (485.7)', () => {
    const game = newGame(7, 'p1');
    // p1 has taken their first turn's channel.
    expect(Object.values(game.runes).filter((r) => r.controller === 'p1')).toHaveLength(2);

    const afterP1 = apply(game, { type: 'END_TURN' });
    expect(afterP1.turnPlayer).toBe('p2');
    expect(Object.values(afterP1.runes).filter((r) => r.controller === 'p2')).toHaveLength(3);

    const afterP2 = apply(afterP1, { type: 'END_TURN' });
    expect(Object.values(afterP2.runes).filter((r) => r.controller === 'p1')).toHaveLength(4);
  });

  it('exhausts a rune for Energy and recycles one for domain Power', () => {
    const game = newGame();
    const runeUid = Object.values(game.runes).find((r) => r.controller === 'p1')!.uid;

    const exhausted = apply(game, { type: 'EXHAUST_RUNE', uid: runeUid });
    expect(exhausted.players.p1.energy).toBe(1);
    expect(exhausted.runes[runeUid].ready).toBe(false);

    const again = reduce(exhausted, { type: 'EXHAUST_RUNE', uid: runeUid }, lookup);
    expect(again.ok).toBe(false);

    const other = Object.values(game.runes).find((r) => r.controller === 'p1' && r.uid !== runeUid)!;
    const recycled = apply(exhausted, { type: 'RECYCLE_RUNE', uid: other.uid });
    const domain = lookup(game.instances[other.uid].cardId)!.domains[0];
    expect(recycled.players.p1.power[domain]).toBe(1);
    // 161.2.b — a recycled rune goes back to the Rune Deck, not the trash.
    expect(recycled.players.p1.runeDeck).toContain(other.uid);
    expect(recycled.runes[other.uid]).toBeUndefined();
  });

  it('empties both rune pools at the start of a Main Phase (167)', () => {
    let game = newGame();
    const runeUid = Object.values(game.runes).find((r) => r.controller === 'p1')!.uid;
    game = apply(game, { type: 'EXHAUST_RUNE', uid: runeUid });
    expect(game.players.p1.energy).toBe(1);

    game = apply(game, { type: 'END_TURN' });
    expect(game.players.p1.energy).toBe(0);
    expect(game.players.p2.energy).toBe(0);
  });

  it('readies the turn player’s units and runes in the Awaken Phase (315.1)', () => {
    let game = newGame();
    const placed = placeUnit(game, units[0], 'p1', { kind: 'base', player: 'p1' });
    game = placed.state;
    game.units[placed.uid].ready = false;

    game = apply(game, { type: 'END_TURN' }); // p2's turn
    expect(game.units[placed.uid].ready).toBe(false);
    game = apply(game, { type: 'END_TURN' }); // back to p1
    expect(game.units[placed.uid].ready).toBe(true);
  });
});

describe('playing cards', () => {
  it('rejects a card the player cannot pay for, and says why', () => {
    const game = newGame();
    const playable = game.players.p1.hand.find((uid) => {
      const c = lookup(game.instances[uid].cardId);
      return c && (c.energy ?? 0) > 0;
    })!;

    const result = reduce(game, { type: 'PLAY_CARD', uid: playable }, lookup);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/Not enough (Energy|.*Power)/);
      expect(result.rule).toBeDefined();
    }
  });

  it('pays Energy and Power, and puts a unit at its controller’s base', () => {
    const game = grantResources(newGame(), 'p1');
    const unitUid = game.players.p1.hand.find(
      (uid) => lookup(game.instances[uid].cardId)?.type === 'Unit',
    );
    if (!unitUid) return;

    const played = apply(game, { type: 'PLAY_CARD', uid: unitUid });
    const c = lookup(game.instances[unitUid].cardId)!;
    expect(played.players.p1.energy).toBe(99 - (c.energy ?? 0));
    expect(played.units[unitUid].location).toEqual({ kind: 'base', player: 'p1' });
    expect(played.players.p1.hand).not.toContain(unitUid);
  });

  it('flags card text it does not automate rather than pretending it resolved', () => {
    const game = grantResources(newGame(), 'p1');
    const spellUid = game.players.p1.hand.find((uid) => {
      const c = lookup(game.instances[uid].cardId);
      return c && c.type !== 'Unit' && unautomatedText(c);
    });
    if (!spellUid) return;

    const played = apply(game, { type: 'PLAY_CARD', uid: spellUid });
    expect(played.unautomated.length).toBeGreaterThan(0);
  });
});

describe('movement', () => {
  it('exhausts the unit as the cost of a Standard Move (144.2)', () => {
    const game = newGame();
    const { state, uid } = placeUnit(game, units[0], 'p1', { kind: 'base', player: 'p1' });
    const moved = apply(state, { type: 'MOVE_UNIT', uid, to: { kind: 'battlefield', index: 0 } });

    expect(moved.units[uid].ready).toBe(false);
    expect(moved.units[uid].location).toEqual({ kind: 'battlefield', index: 0 });

    // Close the showdown the move opened, so the next rejection is about the
    // exhaust cost rather than the showdown.
    let settled = apply(moved, { type: 'SHOWDOWN_PASS' });
    settled = apply(settled, { type: 'SHOWDOWN_PASS' });

    const again = reduce(settled, { type: 'MOVE_UNIT', uid, to: { kind: 'base', player: 'p1' } }, lookup);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.reason).toMatch(/exhausted/);
  });

  it('allows battlefield-to-battlefield movement only with Ganking (144.4.c)', () => {
    const plain = units.find((u) => !hasKeyword(u, 'Ganking'))!;
    const ganker = findCard((c) => c.type === 'Unit' && hasKeyword(c, 'Ganking'), 'a Ganking unit');
    const game = newGame();

    const a = placeUnit(game, plain, 'p1', { kind: 'battlefield', index: 0 });
    const blocked = reduce(a.state, { type: 'MOVE_UNIT', uid: a.uid, to: { kind: 'battlefield', index: 1 } }, lookup);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.rule).toBe('144.4.c');

    const b = placeUnit(game, ganker, 'p1', { kind: 'battlefield', index: 0 });
    const allowed = reduce(b.state, { type: 'MOVE_UNIT', uid: b.uid, to: { kind: 'battlefield', index: 1 } }, lookup);
    expect(allowed.ok).toBe(true);
  });
});

describe('showdowns and scoring', () => {
  it('conquers an empty battlefield and scores a point (348.2, 469.1)', () => {
    const game = newGame();
    const { state, uid } = placeUnit(game, units[0], 'p1', { kind: 'base', player: 'p1' });

    let next = apply(state, { type: 'MOVE_UNIT', uid, to: { kind: 'battlefield', index: 0 } });
    expect(next.showdown).not.toBeNull();

    // Both players pass, so the non-combat showdown closes.
    next = apply(next, { type: 'SHOWDOWN_PASS' });
    next = apply(next, { type: 'SHOWDOWN_PASS' });

    expect(next.showdown).toBeNull();
    expect(next.battlefields[0].controller).toBe('p1');
    expect(next.players.p1.points).toBe(1);
  });

  it('scores a Hold at the Beginning Phase of the next turn (469.2)', () => {
    let game = newGame();
    const placed = placeUnit(game, units[0], 'p1', { kind: 'base', player: 'p1' });
    game = apply(placed.state, { type: 'MOVE_UNIT', uid: placed.uid, to: { kind: 'battlefield', index: 0 } });
    game = apply(game, { type: 'SHOWDOWN_PASS' });
    game = apply(game, { type: 'SHOWDOWN_PASS' });
    expect(game.players.p1.points).toBe(1); // conquer

    game = apply(game, { type: 'END_TURN' }); // p2
    expect(game.players.p1.points).toBe(1);
    game = apply(game, { type: 'END_TURN' }); // back to p1 — Hold scores
    expect(game.players.p1.points).toBe(2);
  });

  it('scores each battlefield at most once per turn (470)', () => {
    let game = newGame();
    const a = placeUnit(game, units[0], 'p1', { kind: 'base', player: 'p1' });
    game = apply(a.state, { type: 'MOVE_UNIT', uid: a.uid, to: { kind: 'battlefield', index: 0 } });
    game = apply(game, { type: 'SHOWDOWN_PASS' });
    game = apply(game, { type: 'SHOWDOWN_PASS' });
    const afterConquer = game.players.p1.points;

    // Leaving and retaking the same battlefield in one turn scores nothing more.
    game.battlefields[0].controller = null;
    const b = placeUnit(game, units[1], 'p1', { kind: 'base', player: 'p1' });
    game = apply(b.state, { type: 'MOVE_UNIT', uid: b.uid, to: { kind: 'battlefield', index: 0 } });
    game = apply(game, { type: 'SHOWDOWN_PASS' });
    game = apply(game, { type: 'SHOWDOWN_PASS' });
    expect(game.players.p1.points).toBe(afterConquer);
  });

  it('withholds the Final Point unless every battlefield scored this turn (471.1.b)', () => {
    let game = newGame();
    game.players.p1.points = game.victoryScore - 1; // 7
    const handBefore = game.players.p1.hand.length;

    const placed = placeUnit(game, units[0], 'p1', { kind: 'base', player: 'p1' });
    game = apply(placed.state, { type: 'MOVE_UNIT', uid: placed.uid, to: { kind: 'battlefield', index: 0 } });
    game = apply(game, { type: 'SHOWDOWN_PASS' });
    game = apply(game, { type: 'SHOWDOWN_PASS' });

    // Only one of the two battlefields was scored, so no 8th point — a draw instead.
    expect(game.players.p1.points).toBe(game.victoryScore - 1);
    expect(game.players.p1.hand.length).toBe(handBefore + 1);
    expect(game.winner).toBeNull();
  });
});

describe('combat', () => {
  const strong = units.find((u) => (u.might ?? 0) >= 4) ?? units[0];
  const weak = units.find((u) => (u.might ?? 0) === 1) ?? units[0];

  /** Stages an attacker set and defender set at battlefield 0 and resolves. */
  function fight(attackers: Card[], defenders: Card[]): GameState {
    let game = newGame();
    game.battlefields[0].controller = 'p2';
    const attackerUids: string[] = [];
    const defenderUids: string[] = [];

    for (const c of attackers) {
      const r = placeUnit(game, c, 'p1', { kind: 'battlefield', index: 0 });
      game = r.state;
      game.units[r.uid].designation = 'attacker';
      attackerUids.push(r.uid);
    }
    for (const c of defenders) {
      const r = placeUnit(game, c, 'p2', { kind: 'battlefield', index: 0 });
      game = r.state;
      game.units[r.uid].designation = 'defender';
      defenderUids.push(r.uid);
    }
    game.battlefields[0].contested = true;
    resolveCombat(game, 0, lookup);
    return game;
  }

  it('gives the stronger side the battlefield and a Conquer', () => {
    const result = fight([strong, strong], [weak]);
    expect(result.battlefields[0].controller).toBe('p1');
    expect(result.players.p1.points).toBe(1);
  });

  it('wipes both sides and leaves the battlefield uncontrolled on an even trade', () => {
    // Two 1-Might units each: each side has exactly lethal for the other.
    const result = fight([weak], [weak]);
    expect(Object.keys(result.units)).toHaveLength(0);
    expect(result.battlefields[0].controller).toBeNull();
  });

  it('recalls surviving attackers when defenders hold (466.1.a.2)', () => {
    // One weak attacker cannot clear a strong defender.
    const result = fight([weak], [strong]);
    const survivors = Object.values(result.units);
    const attacker = survivors.find((u) => u.controller === 'p1');
    expect(result.battlefields[0].controller).toBe('p2');
    if (attacker) expect(attacker.location).toEqual({ kind: 'base', player: 'p1' });
  });

  it('heals surviving units after combat (466.1.a.1)', () => {
    const result = fight([weak], [strong]);
    for (const unit of Object.values(result.units)) expect(unit.damage).toBe(0);
  });

  it('applies Assault while attacking and Shield while defending', () => {
    const assaulter = findCard(
      (c) => c.type === 'Unit' && keywordValue(c, 'Assault') !== null,
      'a unit with Assault',
    );
    const shielded = findCard(
      (c) => c.type === 'Unit' && keywordValue(c, 'Shield') !== null,
      'a unit with Shield',
    );

    let game = newGame();
    const a = placeUnit(game, assaulter, 'p1', { kind: 'battlefield', index: 0 });
    game = a.state;
    const d = placeUnit(game, shielded, 'p2', { kind: 'battlefield', index: 0 });
    game = d.state;

    // No designation yet: printed Might only.
    expect(unitMight(game, a.uid, lookup)).toBe(assaulter.might ?? 0);
    expect(unitMight(game, d.uid, lookup)).toBe(shielded.might ?? 0);

    game.units[a.uid].designation = 'attacker';
    game.units[d.uid].designation = 'defender';
    expect(unitMight(game, a.uid, lookup)).toBe(
      (assaulter.might ?? 0) + keywordValue(assaulter, 'Assault')!,
    );
    expect(unitMight(game, d.uid, lookup)).toBe(
      (shielded.might ?? 0) + keywordValue(shielded, 'Shield')!,
    );
  });
});

describe('damage assignment (465.2.c)', () => {
  const might = (n: number) => CARDS.find((c) => c.type === 'Unit' && c.might === n);

  function board(mights: number[]): { state: GameState; uids: string[] } {
    let game = newGame();
    const uids: string[] = [];
    for (const m of mights) {
      const c = might(m);
      if (!c) continue;
      const r = placeUnit(game, c, 'p2', { kind: 'battlefield', index: 0 });
      game = r.state;
      uids.push(r.uid);
    }
    return { state: game, uids };
  }

  it('assigns lethal in full before moving to another unit (465.2.c.3)', () => {
    const { state, uids } = board([3, 3, 3]);
    if (uids.length < 3) return;
    // 5 damage across three 3-Might units: one lethal, remainder to the next.
    const { damage } = assignDamage(state, 5, uids, lookup);
    const values = uids.map((u) => damage[u] ?? 0).sort((a, b) => b - a);
    expect(values[0]).toBe(3);
    expect(values[1]).toBe(2);
    expect(values[2]).toBe(0);
  });

  it('never over-assigns while other units remain (465.2.c.4)', () => {
    const { state, uids } = board([2, 2]);
    if (uids.length < 2) return;
    const { damage } = assignDamage(state, 4, uids, lookup);
    for (const uid of uids) expect(damage[uid]).toBe(2);
  });

  it('reports excess damage once every unit is lethally assigned', () => {
    const { state, uids } = board([1]);
    if (uids.length < 1) return;
    const { excess } = assignDamage(state, 5, uids, lookup);
    expect(excess).toBe(4);
  });

  it('assigns to Tank first and Backline last (465.2.c.6)', () => {
    const tank = CARDS.find((c) => c.type === 'Unit' && keywordValue(c, 'Tank') !== null);
    const backline = CARDS.find((c) => c.type === 'Unit' && keywordValue(c, 'Backline') !== null);
    const plain = units.find((c) => !hasKeyword(c, 'Tank') && !hasKeyword(c, 'Backline'));
    if (!tank || !backline || !plain) return;

    let game = newGame();
    const b = placeUnit(game, backline, 'p2', { kind: 'battlefield', index: 0 });
    game = b.state;
    const p = placeUnit(game, plain, 'p2', { kind: 'battlefield', index: 0 });
    game = p.state;
    const t = placeUnit(game, tank, 'p2', { kind: 'battlefield', index: 0 });
    game = t.state;

    // Only enough damage for the first target: it must be the Tank.
    const { damage } = assignDamage(game, 1, [b.uid, p.uid, t.uid], lookup);
    expect(damage[t.uid]).toBeGreaterThan(0);
    expect(damage[b.uid] ?? 0).toBe(0);
  });
});

describe('burn out (431)', () => {
  it('gives the opponent a point when a player draws from an empty deck', () => {
    let game = newGame();
    game.players.p1.mainDeck = [];
    const before = game.players.p2.points;

    game = apply(game, { type: 'END_TURN' }); // p2's turn
    game = apply(game, { type: 'END_TURN' }); // p1 draws from an empty deck

    expect(game.players.p2.points).toBe(before + 1);
    expect(game.players.p1.burnedOut).toBe(true);
  });
});

describe('hidden information (128)', () => {
  it('conceals the opponent’s hand and both decks, but not your own hand', () => {
    const game = newGame();
    const view = redact(game, 'p1');

    for (const uid of view.players.p1.hand) expect(isConcealed(view, uid)).toBe(false);
    for (const uid of view.players.p2.hand) expect(isConcealed(view, uid)).toBe(true);
    for (const uid of view.players.p1.mainDeck) expect(isConcealed(view, uid)).toBe(true);
    for (const uid of view.players.p2.mainDeck) expect(isConcealed(view, uid)).toBe(true);
  });

  it('never leaks a hidden card’s identity to the other player', () => {
    const game = newGame();
    const { state, uid } = placeUnit(game, units[0], 'p1', { kind: 'battlefield', index: 0 });
    const withHidden = structuredClone(state);
    withHidden.hidden[uid] = { uid, controller: 'p1', battlefield: 0, hiddenOnTurn: 1 };
    delete withHidden.units[uid];

    expect(isConcealed(redact(withHidden, 'p1'), uid)).toBe(false);
    expect(isConcealed(redact(withHidden, 'p2'), uid)).toBe(true);

    // The real card id must appear nowhere in the opponent's serialised view.
    const opponentView = JSON.stringify(redact(withHidden, 'p2'));
    expect(opponentView).not.toContain(units[0].id);
    expect(opponentView).toContain(CONCEALED);
  });

  it('trashes hidden cards when their owner loses the battlefield (466.5.c)', () => {
    let game = newGame();
    game.battlefields[0].controller = 'p1';

    const hiddenUid = 'h1';
    game.instances[hiddenUid] = { uid: hiddenUid, cardId: units[0].id, owner: 'p1' };
    game.hidden[hiddenUid] = { uid: hiddenUid, controller: 'p1', battlefield: 0, hiddenOnTurn: 1 };

    // p2 attacks with a big unit into nothing and takes the battlefield.
    const attacker = placeUnit(game, units.find((u) => (u.might ?? 0) >= 3) ?? units[0], 'p2', {
      kind: 'battlefield',
      index: 0,
    });
    game = attacker.state;
    game.units[attacker.uid].designation = 'attacker';
    resolveCombat(game, 0, lookup);

    expect(game.battlefields[0].controller).toBe('p2');
    expect(game.hidden[hiddenUid]).toBeUndefined();
    expect(game.players.p1.trash).toContain(hiddenUid);
  });
});

describe('a full game', () => {
  it('runs to a winner without the engine getting stuck', () => {
    let game = newGame(11, 'p1');
    let turns = 0;

    while (!game.winner && turns < 60) {
      // Take every uncontested battlefield we can, then end the turn.
      const player = game.turnPlayer;
      for (let index = 0; index < game.battlefields.length; index++) {
        if (game.battlefields[index].controller === player) continue;
        const free = Object.values(game.units).find(
          (u) => u.controller === player && u.ready && u.location.kind === 'base',
        );
        if (!free) break;
        const moved = reduce(game, { type: 'MOVE_UNIT', uid: free.uid, to: { kind: 'battlefield', index } }, lookup);
        if (!moved.ok) break;
        game = moved.state;
        while (game.showdown) game = apply(game, { type: 'SHOWDOWN_PASS' });
      }

      // Keep a body coming: play the cheapest affordable unit.
      game = grantResources(game, player);
      const playable = game.players[player].hand.find(
        (uid) => lookup(game.instances[uid].cardId)?.type === 'Unit',
      );
      if (playable) {
        const played = reduce(game, { type: 'PLAY_CARD', uid: playable }, lookup);
        if (played.ok) game = played.state;
      }

      if (game.winner) break;
      game = apply(game, { type: 'END_TURN' });
      turns++;
    }

    expect(game.winner).not.toBeNull();
    expect(game.players[game.winner!].points).toBeGreaterThanOrEqual(game.victoryScore);
  });
});
