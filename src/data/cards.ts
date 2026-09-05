import type { Card, DatasetMeta, SetInfo } from '@/types';
import { nameKey } from '@/types';

/**
 * Riot serves card art from a Sanity-backed CDN, which resizes and re-encodes
 * on the fly. Always go through `cardImage()`: the raw PNGs are ~1.4MB each,
 * while the same art at w=250 as webp is ~20KB. On a 1451-card grid that is
 * the difference between usable and unusable, especially on mobile.
 */
const IMAGE_PREFIX = 'https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/';

export type ImageSize = 'thumb' | 'card' | 'full';

const WIDTHS: Record<ImageSize, number> = {
  thumb: 250, // grid tile
  card: 480, // deck builder row, board
  full: 744, // detail view — the art's native width
};

export function cardImage(card: Pick<Card, 'img'>, size: ImageSize = 'thumb'): string | null {
  if (!card.img) return null;
  if (card.img.startsWith('http')) return card.img;
  const w = WIDTHS[size];
  return `${IMAGE_PREFIX}${card.img}?w=${w}&fm=webp&q=${size === 'full' ? 90 : 78}&accountingTag=RB`;
}

/** srcset so retina phones get sharp tiles without desktop paying for them. */
export function cardSrcSet(card: Pick<Card, 'img'>, size: ImageSize = 'thumb'): string | undefined {
  if (!card.img || card.img.startsWith('http')) return undefined;
  const w = WIDTHS[size];
  const build = (width: number) =>
    `${IMAGE_PREFIX}${card.img}?w=${width}&fm=webp&q=78&accountingTag=RB ${width}w`;
  return [build(w), build(w * 2)].join(', ');
}

export interface Dataset {
  cards: Card[];
  sets: SetInfo[];
  keywords: string[];
  meta: DatasetMeta;
  /** Every card, keyed by id. */
  byId: Map<string, Card>;
  /**
   * Printings grouped by canonical name, so every variant of a card — including
   * ones whose subtitle is punctuated differently between sets — collapses into
   * a single entry. Key with `nameKey(card.baseName)`.
   */
  byBaseName: Map<string, Card[]>;
}

let cache: Promise<Dataset> | null = null;

async function getJSON<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

/**
 * Loads the vendored dataset from public/data. Memoised, so every caller
 * shares one fetch and one set of indexes.
 */
export function loadDataset(): Promise<Dataset> {
  if (cache) return cache;
  cache = (async () => {
    const [cards, sets, keywords, meta] = await Promise.all([
      getJSON<Card[]>('data/cards.json'),
      getJSON<SetInfo[]>('data/sets.json'),
      getJSON<string[]>('data/keywords.json'),
      getJSON<DatasetMeta>('data/meta.json'),
    ]);

    const byId = new Map<string, Card>();
    const byBaseName = new Map<string, Card[]>();
    for (const card of cards) {
      byId.set(card.id, card);
      const key = nameKey(card.baseName);
      const group = byBaseName.get(key);
      if (group) group.push(card);
      else byBaseName.set(key, [card]);
    }

    return { cards, sets, keywords, meta, byId, byBaseName };
  })();
  return cache;
}

/**
 * Picks one printing to represent a card in listings: prefer the plain version
 * over Signature/Alternate Art/Overnumbered reprints, then the earliest set.
 */
export function preferredPrinting(printings: Card[]): Card {
  const score = (c: Card) =>
    (c.alternateArt ? 4 : 0) + (c.signature ? 2 : 0) + (c.overnumbered ? 1 : 0);
  return printings.slice().sort((a, b) => score(a) - score(b))[0];
}
