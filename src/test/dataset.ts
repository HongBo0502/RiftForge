import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import type { Card } from '@/types';

/**
 * Loads the vendored dataset straight off disk for tests, so they exercise the
 * real 1451 cards rather than fixtures that can drift from them.
 */
const path = fileURLToPath(new URL('../../public/data/cards.json', import.meta.url));

export const CARDS: Card[] = JSON.parse(readFileSync(path, 'utf8'));

export const BY_ID = new Map(CARDS.map((c) => [c.id, c]));

/** Finds one card by exact name, failing loudly if the dataset changed under us. */
export function card(name: string): Card {
  const found = CARDS.find((c) => c.name === name);
  if (!found) throw new Error(`Test fixture missing: no card named "${name}"`);
  return found;
}

/** First card matching a predicate, for "any card that…" cases. */
export function findCard(predicate: (c: Card) => boolean, describe: string): Card {
  const found = CARDS.find(predicate);
  if (!found) throw new Error(`Test fixture missing: no card matching ${describe}`);
  return found;
}
