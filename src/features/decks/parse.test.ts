import { describe, expect, it } from 'vitest';
import { BY_ID, CARDS } from '@/test/dataset';
import { formatDecklist, parseDecklist } from './parse';
import { countCards } from './types';

const parse = (text: string) => parseDecklist(text, CARDS);

describe('parseDecklist', () => {
  it('reads quantities, sections, and the legend/champion lines', () => {
    const { deck, problems } = parse(`
      Legend: Teemo - Swift Scout
      Champion: Teemo - Strategist

      Main
      3 Nocturne - Horrifying
      2 Abandon

      Runes
      6 Mind Rune
      6 Chaos Rune

      Battlefields
      Abandoned Hall
    `);

    expect(problems).toEqual([]);
    expect(BY_ID.get(deck.legendId!)?.name).toBe('Teemo - Swift Scout');
    expect(BY_ID.get(deck.championId!)?.name).toBe('Teemo - Strategist');
    expect(countCards(deck.main)).toBe(5);
    expect(countCards(deck.runes)).toBe(12);
    expect(deck.battlefields).toHaveLength(1);
  });

  it('routes runes and battlefields by card type even without section headers', () => {
    const { deck } = parse(['2 Mind Rune', '1 Abandoned Hall', '3 Nocturne - Horrifying'].join('\n'));
    expect(countCards(deck.runes)).toBe(2);
    expect(deck.battlefields).toHaveLength(1);
    expect(countCards(deck.main)).toBe(3);
  });

  it('accepts both subtitle spellings for the same card', () => {
    const dash = parse('3 Ahri - Inquisitive');
    const comma = parse('3 Ahri, Inquisitive');
    expect(dash.problems).toEqual([]);
    expect(comma.problems).toEqual([]);

    const nameOf = (id: string) => BY_ID.get(id)!.baseName;
    expect(nameOf(dash.deck.main[0].cardId)).toMatch(/^Ahri[-, ]/);
    expect(nameOf(comma.deck.main[0].cardId)).toMatch(/^Ahri[-, ]/);
  });

  it('tolerates "3x", trailing set codes, bullets and comments', () => {
    const { deck, problems } = parse(`
      // my list
      * 3x Nocturne - Horrifying (OGN)
      - 2 Abandon
      # comment
    `);
    expect(problems).toEqual([]);
    expect(countCards(deck.main)).toBe(5);
  });

  it('merges repeated lines for the same card', () => {
    const { deck } = parse('1 Abandon\n2 Abandon');
    expect(deck.main).toHaveLength(1);
    expect(deck.main[0].qty).toBe(3);
  });

  it('reports unknown card names instead of dropping them silently', () => {
    const { problems } = parse('3 Definitely Not A Real Card');
    expect(problems).toEqual(['Unknown card: Definitely Not A Real Card']);
  });

  it('round-trips through formatDecklist', () => {
    const original = parse(`
      Legend: Teemo - Swift Scout
      Champion: Teemo - Strategist
      Main
      3 Nocturne - Horrifying
      2 Abandon
      Runes
      12 Mind Rune
      Battlefields
      Abandoned Hall
    `).deck;

    const round = parse(formatDecklist(original, BY_ID)).deck;

    expect(round.legendId).toBe(original.legendId);
    expect(round.championId).toBe(original.championId);
    expect(countCards(round.main)).toBe(countCards(original.main));
    expect(countCards(round.runes)).toBe(countCards(original.runes));
    expect(round.battlefields).toEqual(original.battlefields);
  });
});
