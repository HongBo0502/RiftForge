import { describe, expect, it } from 'vitest';
import type { Card } from '@/types';
import { nameKey } from '@/types';
import { BY_ID, CARDS, card } from '@/test/dataset';
import { hasKeyword } from '@/features/game/engine/keywords';
import { emptyDeck, type Deck } from './types';
import { MAIN_DECK_MIN, RUNE_DECK_SIZE, inIdentity, validateDeck } from './validate';

const legend = card('Teemo - Swift Scout'); // Mind/Chaos, tag "Teemo"
const champion = card('Teemo - Strategist'); // Mind champion unit, tag "Teemo"

/**
 * Mind/Chaos non-signature main-deck cards, for filling out a legal 40 — one
 * printing per card, since every reprint shares the 3-copy limit.
 */
const identityCards = [
  ...new Map(
    CARDS.filter(
      (c) =>
        ['Unit', 'Spell', 'Gear'].includes(c.type ?? '') &&
        !c.signature &&
        c.supertype !== 'Signature' &&
        c.domains.every((d) => d === 'Mind' || d === 'Chaos' || d === 'Colorless'),
    ).map((c) => [nameKey(c.baseName), c]),
  ).values(),
];

const runeFor = (domain: string) =>
  CARDS.find((c) => c.type === 'Rune' && c.domains[0] === domain)!;

const battlefields = CARDS.filter((c) => c.type === 'Battlefield').slice(0, 3);

/** A deck that satisfies every construction rule, as a baseline to perturb. */
function legalDeck(): Deck {
  const deck = emptyDeck('Teemo Hidden');
  deck.legendId = legend.id;
  deck.championId = champion.id;

  // 3 copies each of distinct cards until we reach 40, champion included.
  deck.main = [{ cardId: champion.id, qty: 3 }];
  let total = 3;
  for (const c of identityCards) {
    if (total >= MAIN_DECK_MIN) break;
    if (c.id === champion.id) continue;
    const qty = Math.min(3, MAIN_DECK_MIN - total);
    deck.main.push({ cardId: c.id, qty });
    total += qty;
  }

  deck.runes = [
    { cardId: runeFor('Mind').id, qty: 6 },
    { cardId: runeFor('Chaos').id, qty: 6 },
  ];
  deck.battlefields = battlefields.map((b) => b.id);
  return deck;
}

/** Error messages only — warnings are advisory and shouldn't fail legality. */
const errorsIn = (deck: Deck) =>
  validateDeck(deck, BY_ID).issues.filter((i) => i.level === 'error').map((i) => i.message);

describe('inIdentity', () => {
  const mindChaos = new Set<Card['domains'][number]>(['Mind', 'Chaos']);

  it('admits a single-domain card inside the identity', () => {
    expect(inIdentity(card('Nocturne - Horrifying'), mindChaos)).toBe(true); // Chaos
  });

  it('rejects a card whose domain is outside the identity', () => {
    expect(inIdentity(card('Akali, Deadly Weapon'), mindChaos)).toBe(false); // Fury
  });

  it('admits colourless cards, which have no domain at all', () => {
    expect(inIdentity(card('Abandoned Hall'), mindChaos)).toBe(true);
  });

  it('requires ALL domains of a multi-domain card to be covered (103.1.b.4)', () => {
    const multi = CARDS.find(
      (c) => c.domains.length === 2 && c.domains.includes('Mind') && !c.domains.includes('Chaos'),
    );
    expect(multi, 'dataset should contain a Mind + other-domain card').toBeDefined();
    expect(inIdentity(multi!, mindChaos)).toBe(false);
  });
});

describe('validateDeck', () => {
  it('accepts a correctly built deck', () => {
    const result = validateDeck(legalDeck(), BY_ID);
    expect(result.issues.filter((i) => i.level === 'error')).toEqual([]);
    expect(result.legal).toBe(true);
    expect(result.identity.sort()).toEqual(['Chaos', 'Mind']);
    expect(result.mainCount).toBe(MAIN_DECK_MIN);
    expect(result.runeCount).toBe(RUNE_DECK_SIZE);
  });

  it('treats the main deck size as a minimum, not an exact count (103.2)', () => {
    const deck = legalDeck();
    deck.main.push({ cardId: identityCards.at(-1)!.id, qty: 1 });
    expect(errorsIn(deck)).toEqual([]);

    deck.main = deck.main.slice(0, 2);
    expect(errorsIn(deck).join()).toMatch(/needs at least 40/);
  });

  it('rejects a fourth copy of a card, counting variants as the same name', () => {
    const deck = legalDeck();
    const base = identityCards.find((c) => !c.alternateArt && c.id !== champion.id)!;
    const variant = CARDS.find((c) => c.baseName === base.baseName && c.id !== base.id);
    if (!variant) return; // no reprint of this card; nothing to assert

    deck.main = deck.main.filter((e) => e.cardId !== base.id);
    deck.main.push({ cardId: base.id, qty: 2 }, { cardId: variant.id, qty: 2 });
    expect(errorsIn(deck).join()).toMatch(/4 copies of .*limit is 3/);
  });

  it('allows only one copy of a card with Unique (825.3.a)', () => {
    const unique = identityCards.find((c) => hasKeyword(c, 'Unique'));
    if (!unique) return; // no Unique card in this identity; nothing to assert

    const deck = legalDeck();
    deck.main = deck.main.filter((e) => e.cardId !== unique.id);
    deck.main.push({ cardId: unique.id, qty: 1 });
    expect(errorsIn(deck).join()).not.toMatch(/Unique/);

    deck.main = deck.main.filter((e) => e.cardId !== unique.id);
    deck.main.push({ cardId: unique.id, qty: 2 });
    expect(errorsIn(deck).join()).toMatch(/which is Unique; the limit is 1/);
  });

  it('rejects cards outside the domain identity', () => {
    const deck = legalDeck();
    deck.main.push({ cardId: card('Akali, Deadly Weapon').id, qty: 1 });
    expect(errorsIn(deck).join()).toMatch(/outside your .* identity/);
  });

  it('caps signature cards at 3 in total, not 3 of each (103.2.d.1)', () => {
    const signatures = CARDS.filter(
      (c) =>
        (c.signature || c.supertype === 'Signature') &&
        c.tags.includes('Teemo') &&
        c.domains.every((d) => d === 'Mind' || d === 'Chaos' || d === 'Colorless'),
    );
    if (signatures.length === 0) return;

    const deck = legalDeck();
    deck.main.push({ cardId: signatures[0].id, qty: 4 });
    expect(errorsIn(deck).join()).toMatch(/signature cards; the limit is 3 in total/);
  });

  it('rejects a signature card that does not share the legend champion tag', () => {
    const foreign = CARDS.find(
      (c) =>
        (c.signature || c.supertype === 'Signature') &&
        !c.tags.includes('Teemo') &&
        c.domains.every((d) => d === 'Mind' || d === 'Chaos' || d === 'Colorless'),
    );
    if (!foreign) return;

    const deck = legalDeck();
    deck.main.push({ cardId: foreign.id, qty: 1 });
    expect(errorsIn(deck).join()).toMatch(/without Teemo - Swift Scout's champion tag/);
  });

  it('requires the chosen champion to share a tag with the legend', () => {
    const deck = legalDeck();
    const otherChampion = CARDS.find(
      (c) => c.type === 'Unit' && c.supertype === 'Champion' && !c.tags.includes('Teemo'),
    )!;
    deck.championId = otherChampion.id;
    expect(errorsIn(deck).join()).toMatch(/shares no champion tag/);
  });

  it('requires exactly 12 runes, all inside the identity', () => {
    const deck = legalDeck();
    deck.runes = [{ cardId: runeFor('Mind').id, qty: 11 }];
    expect(errorsIn(deck).join()).toMatch(/needs exactly 12/);

    const off = legalDeck();
    off.runes = [
      { cardId: runeFor('Mind').id, qty: 6 },
      { cardId: runeFor('Fury').id, qty: 6 },
    ];
    expect(errorsIn(off).join()).toMatch(/outside your domain identity/);
  });

  it('requires 3 distinct battlefields for 1v1 (485.4.a, 103.4.c)', () => {
    const deck = legalDeck();
    deck.battlefields = [battlefields[0].id, battlefields[1].id];
    expect(errorsIn(deck).join()).toMatch(/2 battlefields; 1v1 needs exactly 3/);

    const dupes = legalDeck();
    dupes.battlefields = [battlefields[0].id, battlefields[0].id, battlefields[1].id];
    expect(errorsIn(dupes).join()).toMatch(/Duplicate battlefield/);
  });

  it('rejects runes and battlefields placed in the main deck', () => {
    const deck = legalDeck();
    deck.main.push({ cardId: runeFor('Mind').id, qty: 1 });
    expect(errorsIn(deck).join()).toMatch(/is a Rune and cannot be in the main deck/);
  });

  it('flags a missing legend and champion on an empty deck', () => {
    const errors = errorsIn(emptyDeck());
    expect(errors.join()).toMatch(/No Champion Legend/);
    expect(errors.join()).toMatch(/No Chosen Champion/);
  });
});
