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
    // 5 listed under Main, plus the champion — it's a main-deck card that
    // merely starts in the Champion Zone (103.2), and lists leave it out.
    expect(countCards(deck.main)).toBe(6);
    expect(deck.main.some((e) => e.cardId === deck.championId)).toBe(true);
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

  /*
   * A real shared list: headers stand alone with the card underneath, subtitles
   * use commas, and there's a sideboard. Before this was handled, "Legend:",
   * "Champion:" and "Sideboard:" all failed as headers — which left the parser
   * in the Runes section, so the five sideboard entries were silently added to
   * the rune deck, giving 20 runes instead of 12.
   */
  const SHARED_LIST = `Legend:
1 Master Yi, Wuju Bladesman

Champion:
1 Master Yi, Tempered

MainDeck:
3 Charm
3 Defy
3 Discipline
3 Pit Rookie
3 Sabotage
3 Lonely Poro
3 Punch First
3 Scuttle Crab
2 En Garde
2 Zhonya's Hourglass
2 First Mate
2 Ruin Runner
1 Challenge
1 Primal Strength
3 Rengar, Trophy Hunter
2 Fiora, Peerless

Battlefields:
1 The Arena's Greatest
1 Emperor's Dais
1 Seat of Power

Runes:
7 Body Rune
5 Calm Rune

Sideboard:
3 Disarming Rake
2 Alpha Strike
1 Challenge
1 Ruin Runner
1 Fiora, Peerless`;

  it('parses a real shared list with standalone headers and a sideboard', () => {
    const { deck, problems } = parse(SHARED_LIST);
    const nameOf = (id: string) => BY_ID.get(id)!.baseName;

    expect(problems).toEqual([]);
    expect(nameOf(deck.legendId!)).toMatch(/^Master Yi[-, ]/);
    expect(nameOf(deck.championId!)).toMatch(/^Master Yi[-, ]/);

    // 39 listed in MainDeck, plus the champion added back (103.2).
    expect(countCards(deck.main)).toBe(40);
    expect(countCards(deck.runes)).toBe(12);
    expect(deck.battlefields).toHaveLength(3);
    expect(countCards(deck.sideboard)).toBe(8);
  });

  it('keeps sideboard cards out of the main and rune decks', () => {
    const { deck } = parse(SHARED_LIST);
    const runeNames = deck.runes.map((e) => BY_ID.get(e.cardId)!.type);
    expect(new Set(runeNames)).toEqual(new Set(['Rune']));

    // Disarming Rake is sideboard-only and must not appear in the main deck.
    const inMain = deck.main.some((e) => BY_ID.get(e.cardId)!.baseName === 'Disarming Rake');
    expect(inMain).toBe(false);
    expect(deck.sideboard.some((e) => BY_ID.get(e.cardId)!.baseName === 'Disarming Rake')).toBe(true);
  });

  it('round-trips a list with a sideboard', () => {
    const original = parse(SHARED_LIST).deck;
    const round = parse(formatDecklist(original, BY_ID)).deck;

    expect(countCards(round.main)).toBe(countCards(original.main));
    expect(countCards(round.runes)).toBe(countCards(original.runes));
    expect(countCards(round.sideboard)).toBe(countCards(original.sideboard));
    expect(round.battlefields).toHaveLength(original.battlefields.length);
    expect(round.championId).toBe(original.championId);
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
