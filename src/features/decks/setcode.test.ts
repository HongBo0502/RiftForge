import { describe, expect, it } from 'vitest';
import { BY_ID, CARDS } from '@/test/dataset';
import { parseDecklist } from './parse';
import { countCards } from './types';
import { validateDeck } from './validate';

const parse = (text: string) => parseDecklist(text, CARDS);
const nameOf = (id: string) => BY_ID.get(id)!.baseName;

/*
 * Real shared lists, in the format that prints a set code after every card.
 *
 * These are the reason set codes resolve before names: the first list's
 * champion is written "Azir - Ascendant" while the dataset calls it
 * "Azir - Ascendant", but the second list's legend is written
 * "Nasus - Curator of the Sands" and the dataset calls it plain
 * "Curator of the Sands". A name-only lookup misses that one entirely.
 */
const AZIR = `1 Azir - Emperor of the Sands (SFD-197)
1 Azir - Ascendant (SFD-050)
1 Ornn's Forge (SFD-213)
1 Emperor's Dais (SFD-207)
2 Arise! (SFD-198)
2 Azir - Sovereign (SFD-177)
2 Xin Zhao - Vigilant (SFD-176)
1 Undertitan (SFD-175)
2 Deathgrip (SFD-163)
1 B.F. Sword (SFD-161)
3 Guards! (SFD-154)
3 Eye of the Herald (SFD-153)
2 Guardian Angel (SFD-051)
5 Calm Rune (OGN-042)
2 Not So Fast (SFD-045)
2 Brutalizer (SFD-042)
2 Thwonk! (SFD-040)
3 Doran's Shield (SFD-033)
3 Desert's Call (SFD-031)
1 Trifarian War Camp (OGN-294)
2 Salvage (OGN-224)
7 Order Rune (OGN-214)
2 Hidden Blade (OGN-213)
2 Cull the Weak (OGN-209)
2 Discipline (OGN-058)`;

const NASUS = `1 Nasus - Curator of the Sands (VEN-145)
1 Premonition (SFD-087)
1 Nasus - Ascended (VEN-046)
3 Astral Heron (VEN-044)
2 Steel Paws (VEN-043)
2 Frostcoat Mother (VEN-032)
3 Scuttle Crab (UNL-053)
1 Back Off (UNL-042)
1 Rockfall Path (SFD-216)
1 Forgotten Monument (SFD-209)
5 Calm Rune (OGN-042)
3 Bellows Breath (SFD-080)
1 Emperor's Divide (SFD-043)
1 Vilemaw's Lair (OGN-295)
3 Defy (OGN-045)
3 Find Your Center (OGN-047)
3 Discipline (OGN-058)
2 Zhonya's Hourglass (OGN-077)
1 Lecturing Yordle (OGN-087)
7 Mind Rune (OGN-089)
3 Stupefy (OGN-095)
3 Ravenbloom Student (OGN-103)
3 Thousand-Tailed Watcher (OGN-116)
2 Time Warp (OGN-122)

Side Board:
1 Vilemaw (UNL-060)
1 Tomb-Raider Barbara (VEN-037)
1 Crumbling Sands (VEN-039)
2 Helm of Suppression (VEN-045)
2 Decree of Insight (VEN-061)
2 Temporal Breach (VEN-066)
1 Disarming Rake (SFD-032)`;

describe('set-code decklists', () => {
  it('resolves every line of the Azir list', () => {
    const { deck, problems } = parse(AZIR);
    // The only acceptable note is the ambiguous champion, handled below.
    expect(problems.filter((p) => p.startsWith('Unknown card'))).toEqual([]);
    expect(nameOf(deck.legendId!)).toBe('Azir - Emperor of the Sands');
    expect(countCards(deck.runes)).toBe(12);
    expect(deck.battlefields).toHaveLength(3);
  });

  it('resolves every line of the Nasus list, including its Side Board', () => {
    const { deck, problems } = parse(NASUS);
    expect(problems.filter((p) => p.startsWith('Unknown card'))).toEqual([]);
    expect(countCards(deck.runes)).toBe(12);
    expect(deck.battlefields).toHaveLength(3);
    expect(countCards(deck.sideboard)).toBe(10);
    // Sideboard cards must not leak into the deck proper.
    expect(deck.main.some((e) => nameOf(e.cardId) === 'Vilemaw')).toBe(false);
  });

  it('finds a legend whose printed name differs from the list (VEN-145)', () => {
    // Written "Nasus - Curator of the Sands"; the dataset calls it
    // "Curator of the Sands". Only the set code resolves this.
    const { deck } = parse(NASUS);
    expect(deck.legendId).toBeTruthy();
    expect(nameOf(deck.legendId!)).toBe('Curator of the Sands');
  });

  it('infers the Chosen Champion when exactly one matches the legend', () => {
    const { deck } = parse(NASUS);
    expect(deck.championId).toBeTruthy();
    expect(nameOf(deck.championId!)).toMatch(/Nasus/);
    // 103.2 — the champion is a main-deck card.
    expect(deck.main.some((e) => e.cardId === deck.championId)).toBe(true);
  });

  it('refuses to guess when several champions match, and says which', () => {
    // The Azir list has both Azir - Ascendant and Azir - Sovereign.
    const { deck, problems } = parse(AZIR);
    expect(deck.championId).toBeNull();
    expect(problems.join(' ')).toMatch(/Several champion units match/);
    expect(problems.join(' ')).toMatch(/Azir - Ascendant/);
    expect(problems.join(' ')).toMatch(/Azir - Sovereign/);
  });

  it('prefers the set code over the name when they disagree', () => {
    // OGN-042 is Calm Rune. Mislabel it and the code must still win.
    const { deck } = parse('5 Totally Wrong Name (OGN-042)');
    expect(countCards(deck.runes)).toBe(5);
    expect(nameOf(deck.runes[0].cardId)).toBe('Calm Rune');
  });

  it('tolerates zero padding and a missing separator in codes', () => {
    for (const written of ['(SFD-050)', '(SFD-50)', '(SFD 050)']) {
      const { deck, problems } = parse(`1 Azir - Ascendant ${written}`);
      expect(problems).toEqual([]);
      expect(countCards(deck.main)).toBeGreaterThan(0);
    }
  });

  it('still round-trips after import', () => {
    const original = parse(NASUS).deck;
    const validation = validateDeck(original, BY_ID);
    // Not necessarily legal (list may be under 40), but it must not be empty.
    expect(validation.runeCount).toBe(12);
    expect(validation.identity.length).toBeGreaterThan(0);
  });
});
