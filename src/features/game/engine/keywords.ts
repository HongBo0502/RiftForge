import type { Card } from '@/types';

/**
 * Keyword handling.
 *
 * Riftbound expresses a lot of unit behaviour through a small set of keywords,
 * so automating these generically covers far more cards than writing per-card
 * effects would. Anything a card says beyond its keywords is *not* automated —
 * `unautomatedText` is what the UI flags, so a player is never left assuming an
 * ability resolved when it didn't.
 */

/** Keywords the engine actually acts on. */
export const AUTOMATED_KEYWORDS = [
  'Assault', // +N Might while I'm an attacker
  'Shield', // +N Might while I'm a defender (a Might modifier, not prevention)
  'Tank', // I must be assigned combat damage first. 465.2.c.6
  'Backline', // I must be assigned combat damage last. 465.2.c.6
  'Ganking', // I can move from battlefield to battlefield. 144.4.c
] as const;

export type AutomatedKeyword = (typeof AUTOMATED_KEYWORDS)[number];

/**
 * Reads `[Keyword]` and `[Keyword N]` markers out of card text.
 * Returns the numeric value where one is printed, else 1.
 */
export function keywordValue(card: Card, keyword: string): number | null {
  const text = card.text ?? '';
  const match = new RegExp(`\\[${keyword}(?:\\s+(\\d+))?\\]`, 'i').exec(text);
  if (!match) return null;
  return match[1] ? Number(match[1]) : 1;
}

export function hasKeyword(card: Card, keyword: string): boolean {
  return keywordValue(card, keyword) !== null;
}

/** Every bracketed marker on a card, keywords and otherwise. */
export function allMarkers(card: Card): string[] {
  const out: string[] = [];
  for (const m of (card.text ?? '').matchAll(/\[([^\]]{1,40})\]/g)) {
    const label = m[1];
    if (label !== '>' && label !== 'NO TEXT') out.push(label);
  }
  return out;
}

/**
 * The part of a card's text the engine does not implement.
 *
 * Reminder text in parentheses is dropped (it only restates a keyword), as are
 * lines that are nothing but automated keyword markers. Whatever is left is
 * real rules text that a player has to apply by hand.
 */
export function unautomatedText(card: Card): string | null {
  const text = card.text ?? '';
  if (!text || text === '[NO TEXT]') return null;

  const remaining = text
    .split('\n')
    .map((line) =>
      line
        .replace(/\([^)]*\)/g, '') // reminder text
        .replace(/\[([^\]]{1,40})\]/g, (full, label: string) => {
          const base = String(label).replace(/\s+\d+$/, '');
          return AUTOMATED_KEYWORDS.some((k) => k.toLowerCase() === base.toLowerCase()) ? '' : full;
        })
        .replace(/\s{2,}/g, ' ')
        .trim(),
    )
    .filter((line) => line.length > 0 && line !== '.' && line !== ',')
    .join('\n');

  return remaining.length > 0 ? remaining : null;
}
