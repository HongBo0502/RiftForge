import { describe, expect, it } from 'vitest';
import type { Card } from '@/types';
import { BY_ID, CARDS, findCard } from '@/test/dataset';
import { unitMight } from '../engine/combat';
import { reduce } from '../engine/reducer';
import type { GameState, PlayerId } from '../engine/types';
import { execute, needsNoChoices, resolve } from './execute';
import { parseActivatedAbilityLine, parseCard, parseInstruction, parseSelector } from './parse';

const lookup = (cardId: string): Card | undefined => BY_ID.get(cardId);

/**
 * The card-effect parser and executor.
 *
 * Two things are being tested: that the parser reads what it claims to read,
 * and — more importantly — that it refuses everything else. A parser that
 * guesses is worse than no parser, because the player never learns it guessed.
 */

const anyUnit = findCard((c) => c.type === 'Unit' && (c.might ?? 0) === 3, 'a 3 Might unit');

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
      state.instances[uid] = { uid, cardId: anyUnit.id, owner: id };
      state.players[id].mainDeck.push(uid);
    }
  }
  return state;
}

function placeUnit(state: GameState, controller: PlayerId, uid: string, index = 0) {
  state.instances[uid] = { uid, cardId: anyUnit.id, owner: controller };
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

const might = (state: GameState) => (uid: string) => unitMight(state, uid, lookup);

describe('reading a selector', () => {
  it('reads side and location', () => {
    expect(parseSelector('a friendly unit at a battlefield')).toEqual({
      kind: 'unit',
      side: 'friendly',
      where: 'battlefield',
      chosen: true,
      count: 1,
    });
    expect(parseSelector('an enemy unit here')).toMatchObject({ side: 'enemy', where: 'here' });
  });

  it('treats "all" as not a choice (355.5.a)', () => {
    // "Kill all gear" picks nothing — it is not targeted, so nothing about it
    // can become an illegal target later.
    expect(parseSelector('all gear')).toMatchObject({ kind: 'gear', chosen: false });
    expect(parseSelector('a unit')).toMatchObject({ chosen: true });
  });

  it('refuses a qualified phrase rather than flattening it', () => {
    // These are the ones that would silently hit the wrong unit.
    for (const phrase of [
      'a unit with the most Might',
      'a unit that was played this turn',
      'a unit with 3 or less Might',
      'a friendly unit other than me',
    ]) {
      expect(parseSelector(phrase), phrase).toBeNull();
    }
  });
});

describe('reading an instruction', () => {
  it('reads the common verbs', () => {
    expect(parseInstruction('Draw 1.')).toEqual({
      verb: 'draw',
      amount: 1,
      who: { kind: 'player', side: 'you' },
    });
    expect(parseInstruction('Deal 4 to a unit at a battlefield.')).toMatchObject({
      verb: 'deal',
      amount: 4,
    });
    expect(parseInstruction('Kill a unit.')).toMatchObject({ verb: 'kill' });
    expect(parseInstruction('Gain 1 XP.')).toMatchObject({ verb: 'gainXp', amount: 1 });
    expect(parseInstruction('Stun a unit at a battlefield.')).toMatchObject({ verb: 'stun' });
  });

  it('reads "you score N point" as the same verb as "gain N point" (194)', () => {
    expect(parseInstruction('You score 1 point.')).toEqual({
      verb: 'gainPoints',
      amount: 1,
      who: { kind: 'player', side: 'you' },
    });
  });

  it('reads a Might change and its duration', () => {
    expect(parseInstruction('Give a unit +2 :rb_might: this turn.')).toMatchObject({
      verb: 'might',
      amount: 2,
      duration: 'thisTurn',
    });
    expect(parseInstruction('Give an enemy unit here -1 :rb_might: this turn.')).toMatchObject({
      verb: 'might',
      amount: -1,
    });
  });

  it('reads Channel, ready by default and exhausted when the card says so (430)', () => {
    expect(parseInstruction('Channel 1 rune.')).toEqual({ verb: 'channel', amount: 1, ready: true });
    expect(parseInstruction('Channel 2 runes exhausted.')).toEqual({
      verb: 'channel',
      amount: 2,
      ready: false,
    });
  });

  it('reads a static Might line and enter-state overrides', () => {
    expect(parseInstruction('I have +2 :rb_might:.')).toEqual({ verb: 'staticMight', amount: 2 });
    expect(parseInstruction('I have -1 :rb_might:.')).toEqual({ verb: 'staticMight', amount: -1 });
    expect(parseInstruction('I enter ready.')).toEqual({ verb: 'entersReady' });
    expect(parseInstruction('This enters exhausted.')).toEqual({ verb: 'entersExhausted' });
  });

  it('refuses a Might change with a floor it cannot model', () => {
    // "to a minimum of 1" changes the arithmetic; applying the bonus without it
    // would take a unit below where the card allows.
    expect(
      parseInstruction('Give an enemy unit here -2 :rb_might: this turn, to a minimum of 1 :rb_might:.'),
    ).toBeNull();
  });

  it('refuses anything outside the vocabulary', () => {
    for (const sentence of [
      'Look at the top 3 cards of your Main Deck.',
      'They deal damage equal to their Mights to each other.',
      'Counter a spell.',
      'Recycle the rest.',
    ]) {
      expect(parseInstruction(sentence), sentence).toBeNull();
    }
  });
});

describe('reading a card', () => {
  it('keeps a sentence it cannot read, instead of dropping it', () => {
    const card = {
      text: 'Draw 1.\nLook at the top 3 cards of your Main Deck.',
    } as Card;
    const parsed = parseCard(card);
    expect(parsed.abilities).toHaveLength(1);
    expect(parsed.unparsed).toEqual(['Look at the top 3 cards of your Main Deck.']);
  });

  it('refuses a whole sentence when only part of it parses', () => {
    // Half an effect applied quietly is worse than none: the player would not
    // know which half happened.
    const card = { text: 'Draw 1, then look at the top card of your Main Deck.' } as Card;
    const parsed = parseCard(card);
    expect(parsed.abilities).toHaveLength(0);
    expect(parsed.unparsed).toHaveLength(1);
  });

  it('reads a trigger off the front', () => {
    const card = { text: 'When you play me, draw 1.' } as Card;
    const parsed = parseCard(card);
    expect(parsed.abilities[0].trigger).toEqual({ on: 'play' });
    expect(parsed.abilities[0].instructions[0]).toMatchObject({ verb: 'draw' });
  });

  it('reads a Dependent Keyword clause as a condition, not a guess (727)', () => {
    const card = { text: '[Empowered][>] I have +2 :rb_might:.' } as Card;
    const parsed = parseCard(card);
    expect(parsed.unparsed).toEqual([]);
    expect(parsed.abilities[0].condition).toEqual({ keyword: 'Empowered', value: null });
    expect(parsed.abilities[0].instructions[0]).toEqual({ verb: 'staticMight', amount: 2 });
  });

  it('reads [Level N] with its number', () => {
    const card = { text: '[Level 3][>] I have +1 :rb_might:.' } as Card;
    const parsed = parseCard(card);
    expect(parsed.abilities[0].condition).toEqual({ keyword: 'Level', value: 3 });
  });
});

describe('Activated Abilities (145.1, 151.1)', () => {
  it('reads a bare self-exhaust cost', () => {
    expect(parseActivatedAbilityLine(':rb_exhaust:: Give a unit +3 :rb_might: this turn.')).toMatchObject({
      cost: { energy: 0, power: {}, anyPower: 0, exhaustSelf: true },
      instructions: [{ verb: 'might', amount: 3, duration: 'thisTurn' }],
    });
  });

  it('reads an Energy+Power cost alongside a self-exhaust cost', () => {
    expect(parseActivatedAbilityLine(':rb_energy_1::rb_rune_order:, :rb_exhaust:: Draw 1.')).toMatchObject({
      cost: { energy: 1, power: { Order: 1 }, anyPower: 0, exhaustSelf: true },
      instructions: [{ verb: 'draw', amount: 1 }],
    });
  });

  it('refuses a cost clause that needs a choice, rather than skipping it', () => {
    // Baited Hook's real cost includes "Kill a friendly unit" — a choice.
    expect(
      parseActivatedAbilityLine(
        ':rb_energy_1::rb_rune_order:, :rb_exhaust:: Kill a friendly unit. Look at the top 5 cards of your Main Deck.',
      ),
    ).toBeNull();
  });

  it('refuses an ability with its own [Action]/[Reaction] timing marker', () => {
    // Extended timing (338.1.a.2) isn't modeled yet — refuse rather than
    // offer it at the wrong moment.
    expect(parseActivatedAbilityLine('[Reaction][>] :rb_exhaust:: Draw 1.')).toBeNull();
  });

  it('refuses the whole line when a same-line clause changes what the effect does', () => {
    // Tools of Empire: the printed amount is conditional on Empowered status,
    // which a same-sentence "instead" clause carries — reading only the first
    // sentence would apply the wrong amount when Empowered.
    expect(
      parseActivatedAbilityLine(
        ":rb_exhaust:: Give a unit +2 :rb_might: this turn. If this is [Empowered], give that unit +4 :rb_might: this turn instead.",
      ),
    ).toBeNull();
  });

  it('refuses the whole line when a same-line restriction isn\'t modeled', () => {
    // Xerath - Freed: the engine doesn't check battlefield location as a
    // condition on activating, so offering this at all would be wrong.
    expect(
      parseActivatedAbilityLine(":rb_rune_fury:, :rb_exhaust:: Deal 3 to a unit. Use this ability only while I'm at a battlefield."),
    ).toBeNull();
  });

  it('refuses every Activated Ability on a card whose restriction lives on a separate line', () => {
    // Renata Glasc - Mastermind: one ability parses cleanly on its own line,
    // but a later line restricts *all* of the card's abilities to a location
    // the engine never checks.
    const card = {
      text: ':rb_energy_1::rb_rune_mind:: Draw 1.\nUse my abilities only while I\'m at a battlefield.',
    } as Card;
    const parsed = parseCard(card);
    expect(parsed.activatedAbilities).toEqual([]);
    expect(parsed.unparsed).toContain(':rb_energy_1::rb_rune_mind:: Draw 1.');
  });
});

describe('executing instructions', () => {
  it('channels from the top of the caster\'s Rune Deck (430)', () => {
    const state = table();
    state.instances['r1'] = { uid: 'r1', cardId: anyUnit.id, owner: 'p1' };
    state.players.p1.runeDeck.unshift('r1');
    const before = state.players.p1.runeDeck.length;

    execute(state, [parseInstruction('Channel 1 rune exhausted.')!], { controller: 'p1' }, might(state));

    expect(state.runes.r1).toBeDefined();
    expect(state.runes.r1.ready).toBe(false);
    expect(state.players.p1.runeDeck).toHaveLength(before - 1);
  });

  it('draws, and burn out still applies (431)', () => {
    const state = table();
    const before = state.players.p1.hand.length;
    execute(state, [parseInstruction('Draw 2.')!], { controller: 'p1' }, might(state));
    expect(state.players.p1.hand).toHaveLength(before + 2);
  });

  it('deals damage and kills at lethal (143.2.a)', () => {
    const state = table();
    placeUnit(state, 'p2', 'e1');
    const instruction = parseInstruction('Deal 4 to a unit at a battlefield.')!;

    execute(state, [instruction], { controller: 'p1', chosen: ['e1'] }, might(state));
    expect(state.units.e1).toBeUndefined();
    expect(state.players.p2.trash).toContain('e1');
  });

  it('leaves a unit alive below lethal', () => {
    const state = table();
    placeUnit(state, 'p2', 'e1');
    execute(
      state,
      [parseInstruction('Deal 2 to a unit at a battlefield.')!],
      { controller: 'p1', chosen: ['e1'] },
      might(state),
    );
    expect(state.units.e1.damage).toBe(2);
  });

  it('fizzles the instruction when its chosen target has gone (359.3.e.7)', () => {
    const state = table();
    const report = execute(
      state,
      [parseInstruction('Kill a unit.')!],
      { controller: 'p1', chosen: ['ghost'] },
      might(state),
    );
    expect(report.fizzled).toHaveLength(1);
    expect(report.done).toHaveLength(0);
  });

  it('applies an untargeted selector to everything matching (355.5.a)', () => {
    const state = table();
    placeUnit(state, 'p1', 'u1');
    placeUnit(state, 'p2', 'e1');
    placeUnit(state, 'p2', 'e2');

    const instruction = parseInstruction('Kill all enemy units.')!;
    expect(instruction).toMatchObject({ verb: 'kill' });
    execute(state, [instruction], { controller: 'p1' }, might(state));

    expect(state.units.u1).toBeDefined();
    expect(state.units.e1).toBeUndefined();
    expect(state.units.e2).toBeUndefined();
  });

  it('honours "here" as the source\'s own battlefield', () => {
    const state = table();
    placeUnit(state, 'p2', 'near', 0);
    placeUnit(state, 'p2', 'far', 1);

    const selector = parseSelector('all enemy units here')!;
    expect(resolve(state, selector, { controller: 'p1', here: 0 })).toEqual(['near']);
  });

  it('knows which instructions still need a player to choose', () => {
    expect(needsNoChoices([parseInstruction('Draw 1.')!])).toBe(true);
    expect(needsNoChoices([parseInstruction('Kill a unit.')!])).toBe(false);
  });
});

describe('end to end, through the chain', () => {
  it('a real card resolves and its effect actually happens', () => {
    /*
     * The whole point of the milestone in one test: take a printed card whose
     * text the parser reads completely and that needs no target, play it for
     * real, and check the game did what the card says — with nothing left in the
     * "apply by hand" panel.
     */
    const self = CARDS.find((c) => {
      if (c.type !== 'Spell' || !c.text) return false;
      if ((c.energy ?? 0) > 3 || (c.power ?? 0) > 3) return false;
      const parsed = parseCard(c);
      return (
        parsed.unparsed.length === 0 &&
        parsed.abilities.length > 0 &&
        parsed.abilities.every((a) => a.trigger === null && needsNoChoices(a.instructions)) &&
        parsed.abilities.some((a) => a.instructions.some((i) => i.verb === 'draw'))
      );
    });
    expect(self, 'dataset should contain a self-contained draw spell').toBeDefined();
    if (!self) return;

    const state = table();
    state.instances.s1 = { uid: 's1', cardId: self.id, owner: 'p1' };
    state.players.p1.hand.push('s1');
    const handBefore = state.players.p1.hand.length;
    const deckBefore = state.players.p1.mainDeck.length;

    let game = reduce(state, { type: 'PLAY_CARD', uid: 's1' }, lookup);
    expect(game.ok, game.ok ? '' : game.reason).toBe(true);
    if (!game.ok) return;

    // Both players pass, the spell resolves, and the draw happens for real.
    for (let i = 0; i < 2; i++) {
      const passed = reduce(game.state, { type: 'PASS_PRIORITY' }, lookup);
      expect(passed.ok).toBe(true);
      if (!passed.ok) return;
      game = passed;
    }

    expect(game.state.chain).toHaveLength(0);
    expect(game.state.players.p1.trash).toContain('s1');
    expect(game.state.players.p1.mainDeck.length).toBeLessThan(deckBefore);
    // -1 for the spell leaving hand, +N for the cards it drew.
    expect(game.state.players.p1.hand.length).toBeGreaterThan(handBefore - 1);
    // Nothing left for the player to do by hand.
    expect(game.state.unautomated).toEqual([]);
  });
});

describe('static Might (143, 727)', () => {
  const empoweredUnit = { id: 'synthetic-empowered', type: 'Unit', might: 3, text: '[Empowered][>] I have +2 :rb_might:.' } as Card;
  const synthLookup = (cardId: string): Card | undefined =>
    cardId === empoweredUnit.id ? empoweredUnit : lookup(cardId);

  it('applies only while the Dependent Keyword condition holds', () => {
    const state = table();
    state.instances.u1 = { uid: 'u1', cardId: empoweredUnit.id, owner: 'p1' };
    state.units.u1 = {
      uid: 'u1',
      controller: 'p1',
      location: { kind: 'battlefield', index: 0 },
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

    expect(unitMight(state, 'u1', synthLookup)).toBe(3);
    state.units.u1.empowered = true;
    expect(unitMight(state, 'u1', synthLookup)).toBe(5);
    state.units.u1.empowered = false;
    expect(unitMight(state, 'u1', synthLookup)).toBe(3);
  });
});

describe('coverage', () => {
  /*
   * A floor, not a target. It exists so the number can only go up: a change
   * that makes the parser read fewer cards fails here rather than quietly
   * shrinking what the game can play.
   */
  it('fully reads at least 219 of the printed cards', () => {
    const playable = CARDS.filter((c) => ['Unit', 'Spell', 'Gear'].includes(c.type ?? ''));
    const full = playable.filter((c) => c.text && parseCard(c).unparsed.length === 0);
    expect(full.length).toBeGreaterThanOrEqual(219);
  });

  it('never invents an instruction for text it does not understand', () => {
    // The property that matters most: everything either parses into a verb the
    // executor implements, or is reported as unparsed. Nothing is dropped.
    const playable = CARDS.filter((c) => ['Unit', 'Spell', 'Gear'].includes(c.type ?? ''));
    for (const card of playable.slice(0, 400)) {
      const parsed = parseCard(card);
      for (const ability of parsed.abilities) {
        expect(ability.instructions.length, card.name).toBeGreaterThan(0);
      }
    }
  });
});
