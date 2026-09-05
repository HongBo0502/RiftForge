import type { Deck } from './types';

/**
 * Decks live in localStorage. They are small (a few hundred bytes each), only
 * ever read by this device, and needed synchronously on first paint — none of
 * which justifies IndexedDB. Swapping this module for a remote store later is
 * the natural upgrade path when accounts arrive.
 */
const KEY = 'riftforge.decks.v1';

function isDeck(value: unknown): value is Deck {
  if (typeof value !== 'object' || value === null) return false;
  const d = value as Partial<Deck>;
  return (
    typeof d.id === 'string' &&
    typeof d.name === 'string' &&
    Array.isArray(d.main) &&
    Array.isArray(d.runes) &&
    Array.isArray(d.battlefields)
  );
}

/** Reads every saved deck, newest first. Never throws. */
export function loadDecks(): Deck[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(isDeck)
      .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
  } catch {
    // Corrupt or unavailable storage (private mode, quota) — start empty
    // rather than breaking the page.
    return [];
  }
}

function writeAll(decks: Deck[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(decks));
  } catch (err) {
    console.warn('Could not save decks', err);
  }
}

/** Inserts or updates one deck, stamping updatedAt. */
export function saveDeck(deck: Deck): Deck {
  const stamped = { ...deck, updatedAt: new Date().toISOString() };
  const decks = loadDecks().filter((d) => d.id !== deck.id);
  writeAll([stamped, ...decks]);
  return stamped;
}

export function deleteDeck(id: string): void {
  writeAll(loadDecks().filter((d) => d.id !== id));
}

export function getDeck(id: string): Deck | undefined {
  return loadDecks().find((d) => d.id === id);
}
