import type { Card, Domain } from '@/types';
import { nameKey } from '@/types';
import type { Deck } from './types';
import { countCards } from './types';

/**
 * Deck legality for 1v1 (Duel), per Riot's Core Rules (2026-07-16).
 *
 * Rule numbers below refer to docs/core-rules.txt, which is generated from the
 * official PDF by scripts/extract-rules.py. Several of these differ from what
 * community guides state — notably the main deck is a *minimum* of 40, and the
 * signature limit is 3 in total rather than 3 of each.
 */

/** 1v1 (Duel): 2 battlefields in play, 3 provided by each player. 485.4 */
export const BATTLEFIELDS_PER_DECK = 3;
/** 103.2 — "A Main Deck of at least 40 cards". */
export const MAIN_DECK_MIN = 40;
/** 103.3.a — exactly 12 runes. */
export const RUNE_DECK_SIZE = 12;
/** 103.2.b — up to 3 copies of the same named card. */
export const MAX_COPIES = 3;
/** 103.2.d.1 — 3 signature cards in total, regardless of name. */
export const MAX_SIGNATURE = 3;

export type IssueLevel = 'error' | 'warning';

export interface Issue {
  level: IssueLevel;
  /** Which part of the deck the issue belongs to, for grouping in the UI. */
  section: 'legend' | 'champion' | 'main' | 'runes' | 'battlefields' | 'sideboard';
  message: string;
  /** Core Rules reference, so a disputed call can be looked up. */
  rule?: string;
}

export interface Validation {
  issues: Issue[];
  legal: boolean;
  identity: Domain[];
  mainCount: number;
  runeCount: number;
  sideboardCount: number;
  signatureCount: number;
}

/**
 * A card is inside the identity if every domain it carries is in the identity.
 * 103.1.b.4 — a multi-domain card needs *all* of its domains covered.
 *
 * "Colorless" is how the dataset marks a card with no domain at all (134.1 —
 * "most cards belong to one or more of six Domains"), so those are always legal.
 */
export function inIdentity(card: Card, identity: Set<Domain>): boolean {
  const domains = card.domains.filter((d) => d !== 'Colorless');
  return domains.every((d) => identity.has(d));
}

/** Champion tags shared between a card and the legend. 103.2.a.2 */
function sharesTag(card: Card, legend: Card): boolean {
  return card.tags.some((t) => legend.tags.includes(t));
}

export function validateDeck(deck: Deck, byId: Map<string, Card>): Validation {
  const issues: Issue[] = [];
  const add = (level: IssueLevel, section: Issue['section'], message: string, rule?: string) =>
    issues.push({ level, section, message, rule });

  const legend = deck.legendId ? byId.get(deck.legendId) : undefined;
  const identity = new Set<Domain>(legend?.domains.filter((d) => d !== 'Colorless') ?? []);

  // --- Legend -------------------------------------------------------------
  if (!legend) {
    add('error', 'legend', 'No Champion Legend chosen.', '103.1');
  } else if (legend.type !== 'Legend') {
    add('error', 'legend', `${legend.name} is not a Legend.`, '103.1');
  }

  // --- Main deck ----------------------------------------------------------
  const mainCards = deck.main
    .map((e) => ({ card: byId.get(e.cardId), qty: e.qty }))
    .filter((e): e is { card: Card; qty: number } => Boolean(e.card));

  const mainCount = countCards(deck.main);
  if (mainCount < MAIN_DECK_MIN) {
    add('error', 'main', `Main deck has ${mainCount} cards; needs at least ${MAIN_DECK_MIN}.`, '103.2');
  }

  // --- Sideboard ----------------------------------------------------------
  // Held outside the starting configuration and swapped 1-for-1 between games
  // (Tournament Rules 403). Its size is set by the competition format, not the
  // rules, so it isn't checked — but it counts for copy limits.
  const sideboardCards = (deck.sideboard ?? [])
    .map((e) => ({ card: byId.get(e.cardId), qty: e.qty }))
    .filter((e): e is { card: Card; qty: number } => Boolean(e.card));
  const sideboardCount = countCards(deck.sideboard ?? []);

  // Copies are counted by name (132.4), so every printing and both subtitle
  // spellings of one card share the limit — and the limit applies to the main
  // deck and sideboard *combined* (Tournament Rules 403.3).
  const copies = new Map<string, { count: number; label: string }>();
  for (const { card, qty } of [...mainCards, ...sideboardCards]) {
    const key = nameKey(card.baseName);
    const seen = copies.get(key);
    if (seen) seen.count += qty;
    else copies.set(key, { count: qty, label: card.baseName });
  }
  for (const { count, label } of copies.values()) {
    if (count > MAX_COPIES) {
      add(
        'error',
        'main',
        `${count} copies of ${label} across deck and sideboard; the limit is ${MAX_COPIES}.`,
        '403.3',
      );
    }
  }

  for (const { card } of sideboardCards) {
    // 403.4.b — runes, legend and battlefields can't be changed after
    // registration, so they have no business in a sideboard.
    if (card.type === 'Rune' || card.type === 'Battlefield' || card.type === 'Legend') {
      add('error', 'sideboard', `${card.name} is a ${card.type} and cannot be sideboarded.`, '403.4.b');
    }
    if (legend && !inIdentity(card, identity)) {
      add(
        'error',
        'sideboard',
        `${card.name} (${card.domains.join('/')}) is outside your ${[...identity].join('/')} identity.`,
        '103.1.b',
      );
    }
  }

  for (const { card } of mainCards) {
    if (card.type === 'Rune' || card.type === 'Battlefield' || card.type === 'Legend') {
      add('error', 'main', `${card.name} is a ${card.type} and cannot be in the main deck.`, '103.2');
    }
    if (legend && !inIdentity(card, identity)) {
      add(
        'error',
        'main',
        `${card.name} (${card.domains.join('/')}) is outside your ${[...identity].join('/')} identity.`,
        '103.1.b',
      );
    }
  }

  // --- Signature cards ----------------------------------------------------
  // 3 in total across the whole deck, all matching the legend's champion tag.
  const signatureCount = [...mainCards, ...sideboardCards]
    .filter(({ card }) => card.signature || card.supertype === 'Signature')
    .reduce((sum, { qty }) => sum + qty, 0);

  if (signatureCount > MAX_SIGNATURE) {
    add('error', 'main', `${signatureCount} signature cards; the limit is ${MAX_SIGNATURE} in total.`, '103.2.d.1');
  }
  if (legend) {
    for (const { card } of mainCards) {
      if ((card.signature || card.supertype === 'Signature') && !sharesTag(card, legend)) {
        add('error', 'main', `${card.name} is a signature card without ${legend.baseName}'s champion tag.`, '103.2.d.2');
      }
    }
  }

  // --- Chosen Champion ----------------------------------------------------
  const champion = deck.championId ? byId.get(deck.championId) : undefined;
  if (!champion) {
    add('error', 'champion', 'No Chosen Champion selected.', '103.2.a');
  } else {
    if (champion.type !== 'Unit' || champion.supertype !== 'Champion') {
      add('error', 'champion', `${champion.name} is not a champion unit.`, '103.2.a.2');
    }
    if (legend && !sharesTag(champion, legend)) {
      add(
        'error',
        'champion',
        `${champion.baseName} shares no champion tag with ${legend.baseName}.`,
        '103.2.a.2',
      );
    }
    // The champion starts in the Champion Zone but is part of the main deck.
    if (!deck.main.some((e) => e.cardId === champion.id)) {
      add('warning', 'champion', `${champion.name} should also be listed in the main deck.`, '103.2');
    }
  }

  // --- Rune deck ----------------------------------------------------------
  const runeCount = countCards(deck.runes);
  if (runeCount !== RUNE_DECK_SIZE) {
    add('error', 'runes', `Rune deck has ${runeCount} runes; needs exactly ${RUNE_DECK_SIZE}.`, '103.3.a');
  }
  for (const entry of deck.runes) {
    const card = byId.get(entry.cardId);
    if (!card) continue;
    if (card.type !== 'Rune') {
      add('error', 'runes', `${card.name} is not a Rune.`, '103.3');
    } else if (legend && !inIdentity(card, identity)) {
      add('error', 'runes', `${card.name} is outside your domain identity.`, '103.3.a.1');
    }
  }

  // --- Battlefields -------------------------------------------------------
  if (deck.battlefields.length !== BATTLEFIELDS_PER_DECK) {
    add(
      'error',
      'battlefields',
      `${deck.battlefields.length} battlefields; 1v1 needs exactly ${BATTLEFIELDS_PER_DECK}.`,
      '485.4.a',
    );
  }
  const seenBattlefields = new Set<string>();
  for (const id of deck.battlefields) {
    const card = byId.get(id);
    if (!card) continue;
    if (card.type !== 'Battlefield') {
      add('error', 'battlefields', `${card.name} is not a Battlefield.`, '103.4');
      continue;
    }
    if (seenBattlefields.has(card.baseName)) {
      add('error', 'battlefields', `Duplicate battlefield: ${card.baseName}.`, '103.4.c');
    }
    seenBattlefields.add(card.baseName);
    if (legend && !inIdentity(card, identity)) {
      add('error', 'battlefields', `${card.name} is outside your domain identity.`, '103.4.b');
    }
  }

  return {
    issues,
    legal: issues.every((i) => i.level !== 'error'),
    identity: [...identity],
    mainCount,
    runeCount,
    sideboardCount,
    signatureCount,
  };
}
