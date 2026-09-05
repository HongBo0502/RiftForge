/** Core vocabulary shared by the card database, deck builder and game engine. */

export const DOMAINS = ['Fury', 'Calm', 'Mind', 'Body', 'Chaos', 'Order', 'Colorless'] as const;
export type Domain = (typeof DOMAINS)[number];

/** The six real domains, in opposed pairs: Fury–Calm, Mind–Body, Chaos–Order. */
export const PLAYABLE_DOMAINS = ['Fury', 'Calm', 'Mind', 'Body', 'Chaos', 'Order'] as const;
export type PlayableDomain = (typeof PLAYABLE_DOMAINS)[number];

export const CARD_TYPES = ['Unit', 'Spell', 'Gear', 'Rune', 'Battlefield', 'Legend'] as const;
export type CardType = (typeof CARD_TYPES)[number];

export const SUPERTYPES = ['Champion', 'Signature', 'Basic', 'Token'] as const;
export type Supertype = (typeof SUPERTYPES)[number];

/** Ordered by ascending scarcity so rarity sorts sensibly. */
export const RARITIES = ['Common', 'Uncommon', 'Rare', 'Epic', 'Showcase', 'Promo'] as const;
export type Rarity = (typeof RARITIES)[number];

/**
 * A card as vendored by scripts/fetch-cards.mjs.
 *
 * `img` is only the CDN asset segment, not a full URL — build one with
 * `cardImage()` so the width/format transform is always applied.
 */
export interface Card {
  id: string;
  /** Display name, including any "(Signature)" / "(Alternate Art)" suffix. */
  name: string;
  /** Name with the variant suffix stripped — the identity for deck legality. */
  baseName: string;
  /** Printing identifier, e.g. "ogn-194-298". Stable; used to key card effects. */
  riftboundId: string | null;
  collectorNumber: number | null;
  type: CardType | null;
  supertype: Supertype | null;
  rarity: Rarity | null;
  domains: Domain[];
  /** Energy cost. Null on cards that are never paid for (Legends, Battlefields, Runes). */
  energy: number | null;
  might: number | null;
  /** Domain-coloured Power cost, paid on top of Energy. */
  power: number | null;
  /** Rules text, with :rb_*: symbol tokens and [Keyword] markers intact. */
  text: string | null;
  flavour: string | null;
  setId: string | null;
  setLabel: string | null;
  img: string | null;
  /** Battlefields are printed landscape; everything else is portrait. */
  orientation: 'portrait' | 'landscape';
  artist: string | null;
  /** Champion tags, e.g. ["Teemo"]. Signature cards must share one with your Legend. */
  tags: string[];
  signature: boolean;
  alternateArt: boolean;
  overnumbered: boolean;
  tcgplayerId: string | null;
}

/**
 * Canonical identity for a card name, used wherever "the same card" matters —
 * deck copy limits, grouping reprints, decklist import.
 *
 * Two things make raw names unreliable. Printings carry variant suffixes
 * ("(Signature)", "(Alternate Art)"), and the source data punctuates the
 * subtitle inconsistently: Origins prints "Ahri - Inquisitive" while Vendetta
 * prints "Ahri, Inquisitive" for the identical card. Core Rules 132.4 defines
 * a card's name as "[Short Name], [Subtitle]", so both are one name and share
 * the 3-copy limit.
 */
export function nameKey(name: string): string {
  return name
    .replace(/\s*\([^)]*\)\s*$/, '') // variant suffix
    .replace(/\s*[-,]\s+/, ' ') // first subtitle separator, either spelling
    .toLowerCase()
    .replace(/[‘’`]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export interface SetInfo {
  setId: string;
  name: string;
  cardCount: number | null;
  publishedOn: string | null;
}

export interface DatasetMeta {
  source: string;
  fetchedAt: string;
  imagePrefix: string;
  cardCount: number;
  setCount: number;
}
