import type { Card, Domain } from '@/types';

/** One line of a deck: a card and how many copies. */
export interface DeckEntry {
  cardId: string;
  qty: number;
}

/**
 * A constructed Riftbound deck.
 *
 * The Legend and Champion sit outside the main deck in their own zones, and
 * the three battlefields are brought to the table rather than shuffled in —
 * only one of them ends up in play.
 */
export interface Deck {
  id: string;
  name: string;
  /** Card id of the Legend. Its domains define the deck's identity. */
  legendId: string | null;
  /** Card id of the Champion unit placed in the champion zone at game start. */
  championId: string | null;
  /** Main deck — 40 cards. */
  main: DeckEntry[];
  /** Rune deck — 12 runes. */
  runes: DeckEntry[];
  /** Card ids of the 3 battlefields brought to the game. */
  battlefields: string[];
  createdAt: string;
  updatedAt: string;
}

export function emptyDeck(name = 'New deck'): Deck {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    name,
    legendId: null,
    championId: null,
    main: [],
    runes: [],
    battlefields: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function countCards(entries: DeckEntry[]): number {
  return entries.reduce((sum, e) => sum + e.qty, 0);
}

/**
 * The domains a deck may play, taken from its Legend. An empty set means no
 * Legend is chosen yet, so nothing is restricted.
 */
export function domainIdentity(legend: Card | undefined): Set<Domain> {
  return new Set(legend?.domains ?? []);
}
