import { nameKey, type Card } from '@/types';
import {
  AUTOMATED_KEYWORDS,
  conditionActive,
  type DependencyContext,
  type DependentKeyword,
  unautomatedText,
} from '../engine/keywords';
import { scriptText } from './scriptText';
import type { CardScript, ParsedCard } from './types';

export { scriptText };

/**
 * Per-card effect scripts — the only source of card effects at runtime.
 *
 * Each card name has its own file in `./cards/`. Scripts are drafted once by
 * `npm run gen-scripts` (which uses the text parser as an authoring aid) and
 * then edited by hand like any other source file. Nothing here reads card
 * text to decide what a card does; text is only compared, to make sure the
 * printing in play is one the script was written for.
 */

const files = import.meta.glob<CardScript>('./cards/*.json', { eager: true, import: 'default' });

const BY_NAME = new Map<string, CardScript>();
for (const script of Object.values(files)) BY_NAME.set(nameKey(script.name), script);

/** Every loaded script, for validation and reporting. */
export const ALL_SCRIPTS: readonly CardScript[] = [...BY_NAME.values()];

/**
 * The script for this printing, or null. A script whose `texts` do not
 * include this printing's wording does not apply — the card is fully manual
 * until someone checks the new wording and adds it.
 */
export function cardScript(card: Card): CardScript | null {
  const script = BY_NAME.get(nameKey(card.name));
  if (!script) return null;
  return script.texts.includes(scriptText(card.text)) ? script : null;
}

const NO_SCRIPT: ParsedCard = { abilities: [], activatedAbilities: [], unparsed: [] };

/** A card's effects in the shape the executor and engine consume. */
export function scriptFor(card: Card): ParsedCard {
  const script = cardScript(card);
  if (!script) return NO_SCRIPT;
  return { abilities: script.abilities, activatedAbilities: script.activated, unparsed: script.manual };
}

const AUTOMATED = new Set<string>(AUTOMATED_KEYWORDS.map((k) => k.toLowerCase()));
const DEPENDENT = /^\[(Legion|Level|Empowered)(?:\s+(\d+))?\]\[>\]/i;

/** Drops the markers the engine enforces itself, so the player reads only what is left. */
function forDisplay(sentence: string): string {
  return sentence
    .replace(/\[([^\]]{1,40})\]/g, (full, label: string) => {
      if (label === '>' || label === '>>') return '';
      return AUTOMATED.has(label.replace(/\s+\d+$/, '').toLowerCase()) ? '' : full;
    })
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * What the player still has to apply by hand for this card, or null.
 *
 * A scripted card shows exactly its `manual` sentences — minus any whose
 * Dependent Keyword is currently inactive (824.1.d / 828.1.c), when the
 * caller knows the context. An unscripted card shows its whole remaining
 * text, as before scripts existed.
 */
export function manualText(card: Card, context?: DependencyContext): string | null {
  const script = cardScript(card);
  if (!script) return unautomatedText(card, context);

  const lines = script.manual
    .filter((sentence) => {
      if (!context) return true;
      const m = DEPENDENT.exec(sentence);
      if (!m) return true;
      const keyword = (m[1][0].toUpperCase() + m[1].slice(1).toLowerCase()) as DependentKeyword;
      return conditionActive(keyword, m[2] ? Number(m[2]) : null, context);
    })
    .map(forDisplay)
    .filter((line) => line.length > 0 && line !== '.');
  return lines.length > 0 ? lines.join('\n') : null;
}
