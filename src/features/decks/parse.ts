import type { Card } from '@/types';
import { nameKey } from '@/types';
import type { Deck, DeckEntry } from './types';
import { emptyDeck } from './types';

/**
 * Decklist import/export in the plain `qty CardName` format people already
 * paste around. Both header styles are accepted — the name on the same line:
 *
 *   Legend: Teemo - Swift Scout
 *   Champion: Teemo - Strategist
 *
 * or the header alone with the card underneath, which is how lists are usually
 * shared:
 *
 *   Legend:
 *   1 Master Yi, Wuju Bladesman
 *
 *   MainDeck:
 *   3 Pit Rookie
 *
 *   Runes:
 *   7 Body Rune
 *
 *   Battlefields:
 *   1 Seat of Power
 *
 *   Sideboard:
 *   2 Alpha Strike
 *
 * Lists shared with set codes are also accepted, and the code wins over the
 * name because it is exact:
 *
 *   1 Nasus - Curator of the Sands (VEN-145)
 *   3 Astral Heron (VEN-044)
 *
 *   Side Board:
 *   1 Vilemaw (UNL-060)
 *
 * Parsing is deliberately forgiving: headers are optional, "x" separators, set
 * codes in brackets and either subtitle punctuation ("Rengar, Trophy Hunter"
 * or "Rengar - Trophy Hunter") are tolerated, and anything unmatched is
 * reported rather than silently dropped.
 */

export interface ParseResult {
  deck: Deck;
  /** Lines that matched no card, so the user can fix them. */
  problems: string[];
}

type Section = 'main' | 'runes' | 'battlefields' | 'sideboard' | 'legend' | 'champion';

/**
 * Section headers, matched after punctuation and spaces are stripped. Lists in
 * the wild put the legend and champion on the line *after* their header
 * ("Legend:\n1 Master Yi, Wuju Bladesman"), so those are sections too, not just
 * the inline "Legend: X" form.
 */
const SECTION_HEADERS: Record<string, Section> = {
  legend: 'legend',
  champion: 'champion',
  chosenchampion: 'champion',
  main: 'main',
  maindeck: 'main',
  deck: 'main',
  spells: 'main',
  units: 'main',
  rune: 'runes',
  runes: 'runes',
  runedeck: 'runes',
  battlefield: 'battlefields',
  battlefields: 'battlefields',
  sideboard: 'sideboard',
  side: 'sideboard',
};

const normalise = (s: string) =>
  s
    .toLowerCase()
    .replace(/[‐-―−]/g, '-') // unicode dashes -> hyphen
    .replace(/[’']/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

/** Builds name -> card lookups, preferring the plainest printing of each name. */
function buildIndex(cards: Card[]): Map<string, Card> {
  const index = new Map<string, Card>();
  const rank = (c: Card) => (c.alternateArt ? 4 : 0) + (c.signature ? 2 : 0) + (c.overnumbered ? 1 : 0);

  const consider = (key: string, card: Card) => {
    const existing = index.get(key);
    if (!existing || rank(card) < rank(existing)) index.set(key, card);
  };

  for (const card of cards) {
    consider(normalise(card.name), card);
    consider(normalise(card.baseName), card);
    // "Teemo - Swift Scout" is often typed as "Teemo, Swift Scout".
    consider(normalise(card.baseName.replace(' - ', ', ')), card);
    if (card.riftboundId) consider(normalise(card.riftboundId), card);

    /*
     * Set code, e.g. "SFD-197". Shared lists print these alongside the name and
     * they are far more reliable than the name itself: the same card is listed
     * as "Nasus - Curator of the Sands" while the dataset calls it "Curator of
     * the Sands", so a name lookup misses and a code lookup does not.
     */
    if (card.setId && card.collectorNumber != null) {
      consider(setCodeKey(card.setId, card.collectorNumber), card);
    }
  }
  return index;
}

/** Canonical key for a set code; tolerates the zero padding lists use. */
function setCodeKey(setId: string, collectorNumber: number | string): string {
  return `${setId}-${Number(collectorNumber)}`.toLowerCase();
}

/** Strips quantity, trailing set codes and separators from a decklist line. */
function parseLine(line: string): { qty: number; name: string; code: string | null } | null {
  // Pull out a trailing set code like "(SFD-197)" before anything else — it is
  // the most reliable way to identify the card on the line.
  const codeMatch = /[([]\s*([A-Z]{2,4})[-\s]?(\d{1,4})[a-z*]?\s*[)\]]\s*$/i.exec(line);
  const code = codeMatch ? setCodeKey(codeMatch[1], codeMatch[2]) : null;

  const cleaned = line
    .replace(/^\s*[-*•]\s*/, '') // bullet
    .replace(/\s*[([][^)\]]*[)\]]\s*$/, '') // trailing (SFD-197) or (OGN)
    .replace(/\s*#\s*\d+\s*$/, '') // trailing collector number
    .trim();
  if (!cleaned) return null;

  const m = /^(\d+)\s*[xX]?\s+(.+)$/.exec(cleaned) ?? /^(.+?)\s+[xX]\s*(\d+)$/.exec(cleaned);
  if (!m) return { qty: 1, name: cleaned, code };

  // The two patterns capture qty/name in opposite orders.
  return /^\d/.test(cleaned)
    ? { qty: Number(m[1]), name: m[2].trim(), code }
    : { qty: Number(m[2]), name: m[1].trim(), code };
}

function addEntry(list: DeckEntry[], cardId: string, qty: number): void {
  const existing = list.find((e) => e.cardId === cardId);
  if (existing) existing.qty += qty;
  else list.push({ cardId, qty });
}

export function parseDecklist(text: string, cards: Card[], name = 'Imported deck'): ParseResult {
  const index = buildIndex(cards);
  const deck = emptyDeck(name);
  const problems: string[] = [];
  let section: Section = 'main';

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('//') || line.startsWith('#')) continue;

    // Inline "Legend: X" / "Champion: X" on one line.
    const labelled = /^(legend|champion)\s*[:\-]\s*(.+)$/i.exec(line);
    if (labelled) {
      const card = index.get(normalise(labelled[2]));
      if (!card) problems.push(`Unknown card: ${labelled[2]}`);
      else if (labelled[1].toLowerCase() === 'legend') deck.legendId = card.id;
      else deck.championId = card.id;
      continue;
    }

    // Bare section header, with or without a trailing count like "Main (40)".
    const header = SECTION_HEADERS[normalise(line).replace(/\s*\(\d+\)\s*$/, '').replace(/[\s:]/g, '')];
    if (header) {
      section = header;
      continue;
    }

    const parsed = parseLine(line);
    if (!parsed) continue;

    // Set code wins over the name: lists often abbreviate or re-punctuate the
    // name, but the code is exact.
    const card = (parsed.code ? index.get(parsed.code) : undefined)
      ?? index.get(normalise(parsed.name));
    if (!card) {
      problems.push(`Unknown card: ${parsed.name}${parsed.code ? ` (${parsed.code.toUpperCase()})` : ''}`);
      continue;
    }

    // A section naming a single slot wins over type-based routing, and the
    // sideboard has to stay out of the deck proper — routing its cards by type
    // would quietly fold them into the main or rune deck.
    if (section === 'legend' || card.type === 'Legend') {
      deck.legendId = card.id;
      continue;
    }
    if (section === 'champion') {
      deck.championId = card.id;
      continue;
    }
    if (section === 'sideboard') {
      addEntry(deck.sideboard, card.id, parsed.qty);
      continue;
    }

    // Otherwise route by the card's own type where it's unambiguous, so an
    // unlabelled list still lands runes and battlefields in the right place.
    if (card.type === 'Rune') addEntry(deck.runes, card.id, parsed.qty);
    else if (card.type === 'Battlefield') {
      for (let i = 0; i < parsed.qty; i++) deck.battlefields.push(card.id);
    } else if (section === 'runes') addEntry(deck.runes, card.id, parsed.qty);
    else if (section === 'battlefields') deck.battlefields.push(card.id);
    else addEntry(deck.main, card.id, parsed.qty);
  }

  /*
   * The Chosen Champion is a main-deck card that merely starts in its own zone
   * (103.2), but lists conventionally break it out under its own header and
   * leave it out of the main-deck section. Add it back unless it's already
   * listed, so the 40 comes out right either way.
   */
  /*
   * Lists shared with set codes rarely label the Chosen Champion — the legend
   * is identified by its type, and the champion is just another main-deck card.
   * Infer it when there is exactly one candidate: a champion unit sharing a
   * champion tag with the legend (103.2.a.2). With several, say so and let the
   * builder ask, rather than guessing wrong.
   */
  if (!deck.championId && deck.legendId) {
    const legend = cards.find((c) => c.id === deck.legendId);
    if (legend) {
      const candidates = deck.main
        .map((e) => cards.find((c) => c.id === e.cardId))
        .filter(
          (c): c is Card =>
            Boolean(c) &&
            c!.type === 'Unit' &&
            c!.supertype === 'Champion' &&
            c!.tags.some((t) => legend.tags.includes(t)),
        );
      const distinct = [...new Map(candidates.map((c) => [nameKey(c.baseName), c])).values()];

      if (distinct.length === 1) {
        deck.championId = distinct[0].id;
      } else if (distinct.length > 1) {
        problems.push(
          `Several champion units match ${legend.baseName}: ` +
            `${distinct.map((c) => c.baseName).join(', ')}. Pick your Chosen Champion in the builder.`,
        );
      }
    }
  }

  if (deck.championId) {
    const champion = cards.find((c) => c.id === deck.championId);
    const key = champion ? nameKey(champion.baseName) : null;
    const present = key
      ? deck.main.some((e) => {
          const c = cards.find((x) => x.id === e.cardId);
          return c && nameKey(c.baseName) === key;
        })
      : false;
    if (!present) addEntry(deck.main, deck.championId, 1);
  }

  return { deck, problems };
}

/** Serialises a deck back to the same format `parseDecklist` accepts. */
export function formatDecklist(deck: Deck, byId: Map<string, Card>): string {
  const nameOf = (id: string) => byId.get(id)?.name ?? id;
  const lines: string[] = [];

  if (deck.legendId) lines.push(`Legend: ${nameOf(deck.legendId)}`);
  if (deck.championId) lines.push(`Champion: ${nameOf(deck.championId)}`);

  const section = (title: string, entries: DeckEntry[]) => {
    if (entries.length === 0) return;
    lines.push('', title);
    for (const e of [...entries].sort((a, b) => nameOf(a.cardId).localeCompare(nameOf(b.cardId)))) {
      lines.push(`${e.qty} ${nameOf(e.cardId)}`);
    }
  };

  section('Main', deck.main);
  section('Runes', deck.runes);

  if (deck.battlefields.length) {
    lines.push('', 'Battlefields');
    for (const id of deck.battlefields) lines.push(nameOf(id));
  }

  section('Sideboard', deck.sideboard);

  return lines.join('\n');
}
