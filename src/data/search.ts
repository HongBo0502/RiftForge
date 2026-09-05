import type { Card, CardType, Domain, Rarity } from '@/types';
import { RARITIES, nameKey } from '@/types';
import { preferredPrinting } from './cards';

export type SortKey = 'relevance' | 'name' | 'energy' | 'might' | 'rarity' | 'set';

export interface CardQuery {
  text: string;
  sets: string[];
  types: CardType[];
  domains: Domain[];
  rarities: Rarity[];
  keywords: string[];
  energyMin: number | null;
  energyMax: number | null;
  /** Collapse Signature/Alternate Art reprints into a single entry. */
  collapseVariants: boolean;
  sort: SortKey;
}

export const EMPTY_QUERY: CardQuery = {
  text: '',
  sets: [],
  types: [],
  domains: [],
  rarities: [],
  keywords: [],
  energyMin: null,
  energyMax: null,
  collapseVariants: true,
  sort: 'relevance',
};

export function isQueryEmpty(q: CardQuery): boolean {
  return (
    q.text.trim() === '' &&
    q.sets.length === 0 &&
    q.types.length === 0 &&
    q.domains.length === 0 &&
    q.rarities.length === 0 &&
    q.keywords.length === 0 &&
    q.energyMin === null &&
    q.energyMax === null
  );
}

/** How many filters are active — drives the "clear filters" affordance. */
export function activeFilterCount(q: CardQuery): number {
  return (
    q.sets.length +
    q.types.length +
    q.domains.length +
    q.rarities.length +
    q.keywords.length +
    (q.energyMin !== null || q.energyMax !== null ? 1 : 0)
  );
}

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');

/**
 * Relevance for a free-text match. Higher is better; 0 means no match.
 * Name hits beat rules-text hits so searching "teemo" leads with the Teemos.
 */
function scoreText(card: Card, needle: string): number {
  const name = norm(card.name);
  if (name === needle) return 100;
  if (name.startsWith(needle)) return 80;

  // Match against each word so "swift scout" finds "Teemo - Swift Scout".
  const words = name.split(/[\s\-,]+/);
  if (words.some((w) => w.startsWith(needle))) return 60;
  if (name.includes(needle)) return 40;
  if (card.tags.some((t) => norm(t).includes(needle))) return 30;
  if (card.text && norm(card.text).includes(needle)) return 10;
  if (card.artist && norm(card.artist).includes(needle)) return 5;
  return 0;
}

/** Every search term must match somewhere; the score is their sum. */
function scoreQuery(card: Card, terms: string[]): number {
  let total = 0;
  for (const term of terms) {
    const s = scoreText(card, term);
    if (s === 0) return 0;
    total += s;
  }
  return total;
}

function matchesFilters(card: Card, q: CardQuery): boolean {
  if (q.sets.length && (!card.setId || !q.sets.includes(card.setId))) return false;
  if (q.types.length && (!card.type || !q.types.includes(card.type))) return false;
  if (q.rarities.length && (!card.rarity || !q.rarities.includes(card.rarity))) return false;

  // A card matches if it carries ANY selected domain — a Mind/Chaos card
  // should surface under both Mind and Chaos.
  if (q.domains.length && !card.domains.some((d) => q.domains.includes(d))) return false;

  if (q.keywords.length) {
    const text = card.text ?? '';
    if (!q.keywords.every((k) => new RegExp(`\\[${k}(\\s+\\d+)?\\]`, 'i').test(text))) return false;
  }

  if (q.energyMin !== null && (card.energy === null || card.energy < q.energyMin)) return false;
  if (q.energyMax !== null && (card.energy === null || card.energy > q.energyMax)) return false;

  return true;
}

const rarityRank = (r: Rarity | null) => (r ? RARITIES.indexOf(r) : 99);

function compare(a: Card, b: Card, sort: SortKey, scores: Map<string, number>): number {
  switch (sort) {
    case 'relevance': {
      const diff = (scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0);
      return diff !== 0 ? diff : a.name.localeCompare(b.name);
    }
    case 'energy': {
      const diff = (a.energy ?? 99) - (b.energy ?? 99);
      return diff !== 0 ? diff : a.name.localeCompare(b.name);
    }
    case 'might': {
      const diff = (b.might ?? -1) - (a.might ?? -1);
      return diff !== 0 ? diff : a.name.localeCompare(b.name);
    }
    case 'rarity': {
      const diff = rarityRank(b.rarity) - rarityRank(a.rarity);
      return diff !== 0 ? diff : a.name.localeCompare(b.name);
    }
    case 'set': {
      const diff = (a.setId ?? '').localeCompare(b.setId ?? '');
      return diff !== 0 ? diff : (a.collectorNumber ?? 0) - (b.collectorNumber ?? 0);
    }
    case 'name':
    default:
      return a.name.localeCompare(b.name);
  }
}

/**
 * Filters, optionally de-duplicates variants, and sorts. Runs over all 1451
 * cards on every keystroke — it's a linear scan plus a sort, which measures
 * well under a frame, so there's no index to keep in sync.
 */
export function searchCards(cards: Card[], q: CardQuery): Card[] {
  const terms = norm(q.text).split(/\s+/).filter(Boolean);
  const scores = new Map<string, number>();

  let results: Card[] = [];
  for (const card of cards) {
    if (!matchesFilters(card, q)) continue;
    if (terms.length) {
      const score = scoreQuery(card, terms);
      if (score === 0) continue;
      scores.set(card.id, score);
    }
    results.push(card);
  }

  if (q.collapseVariants) {
    const groups = new Map<string, Card[]>();
    for (const card of results) {
      const key = nameKey(card.baseName);
      const group = groups.get(key);
      if (group) group.push(card);
      else groups.set(key, [card]);
    }
    results = [...groups.values()].map((group) => {
      const pick = preferredPrinting(group);
      // Keep the best score in the group so collapsing can't demote a hit.
      const best = Math.max(...group.map((c) => scores.get(c.id) ?? 0));
      if (best) scores.set(pick.id, best);
      return pick;
    });
  }

  // Relevance is meaningless with no search text — fall back to name order.
  const sort = q.sort === 'relevance' && terms.length === 0 ? 'name' : q.sort;
  return results.sort((a, b) => compare(a, b, sort, scores));
}
