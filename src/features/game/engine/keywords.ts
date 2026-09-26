import type { Card, Domain } from '@/types';
import type { GameState, PlayerId } from './types';

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
  'Action', // playable in showdowns too. 806.1.b
  'Reaction', // playable in a Closed State as well. 159.2.b.2
  'Assault', // +N Might while I'm an attacker
  'Shield', // +N Might while I'm a defender (a Might modifier, not prevention)
  'Tank', // I must be assigned combat damage first. 465.2.c.6
  'Backline', // I must be assigned combat damage last. 465.2.c.6
  'Ganking', // I can move from battlefield to battlefield. 144.4.c
  'Ambush', // playable to a battlefield where you have units, at Reaction speed. 822
  'Deflect', // enemy spells choosing me cost N more Power. 809
  'Hunt', // my controller gains N XP when I Conquer or Hold. 823
  'Quick-Draw', // this gear has Reaction inherently. 819.1.b
  'Unique', // only one of this name per deck. 825.3.a
  /*
   * The three Dependent Keywords. The engine evaluates the *condition* — XP
   * held, a card played earlier this turn, the Empowered status — and drops the
   * whole clause from the "apply by hand" panel while it is inactive (824.1.d).
   * The dependent text itself is still a card effect, so when the condition is
   * met the text is flagged as normal.
   */
  'Level', // active while you have N XP. 824
  'Legion', // active once you have played another card this turn. 812
  'Empowered', // active while this has the Empowered status. 828
] as const;

/** The Dependent Keywords, whose ability only applies while a condition holds. */
const DEPENDENT = ['Level', 'Legion', 'Empowered'] as const;
export type DependentKeyword = (typeof DEPENDENT)[number];

export interface DependentClause {
  keyword: DependentKeyword;
  /** The N in `[Level N]`. Null for keywords that carry no value. */
  value: number | null;
  /** The whole line, so it can be removed from the text when inactive. */
  line: string;
}

/**
 * Reads the Dependent Keyword clauses off a card. 727
 *
 * The rules say a clause runs "from the Keyword to the end of the clause"
 * (812.1.b). The dataset prints one ability per line, so a line is taken as the
 * clause — the practical reading, and the only one the data supports.
 */
export function dependentClauses(card: Card): DependentClause[] {
  const out: DependentClause[] = [];
  for (const line of (card.text ?? '').split('\n')) {
    for (const keyword of DEPENDENT) {
      // 135.2.d.3 — a keyword quoted in reminder text is not the card having it.
      const match = new RegExp(`\\[${keyword}(?:\\s+(\\d+))?\\]`, 'i').exec(
        line.replace(/\([^)]*\)/g, ''),
      );
      if (match) out.push({ keyword, value: match[1] ? Number(match[1]) : null, line });
    }
  }
  return out;
}

/** What the Dependent Keywords are asked about. */
export interface DependencyContext {
  /** The controller's XP, for `[Level N]`. 824.1.c */
  xp: number;
  /** Whether the controller has finalized another card this turn. 812.1.c */
  playedAnotherCard: boolean;
  /** Whether this object carries the Empowered status. 828.1.c */
  empowered: boolean;
}

/**
 * Reads the current answer to every Dependent Keyword's question.
 *
 * `uid` is the object the card is or will be — a unit already on the board for
 * Empowered, and simply absent for a spell, which cannot hold the status.
 */
export function dependencyContext(
  state: GameState,
  controller: PlayerId,
  uid?: string,
): DependencyContext {
  return {
    xp: state.players[controller].xp,
    // 812.1.c — "another card", so the card asking does not count itself.
    playedAnotherCard: state.players[controller].finalizedThisTurn.some((u) => u !== uid),
    empowered: uid ? Boolean(state.units[uid]?.empowered) : false,
  };
}

/**
 * Whether a Dependent Keyword's condition currently holds. 727
 *
 * Shared by `clauseIsActive` (keyword-marker text) and the effects parser's
 * `Condition` (`effects/parse.ts`'s `leadingCondition`) — one predicate, so
 * the two readings of "[Empowered][>]" can never disagree.
 */
export function conditionActive(
  keyword: DependentKeyword,
  value: number | null,
  context: DependencyContext,
): boolean {
  switch (keyword) {
    // 824.1.b.1 — "While you have N or more XP".
    case 'Level':
      return context.xp >= (value ?? 1);
    // 812.1.b.1 — "If you have played another card this turn".
    case 'Legion':
      return context.playedAnotherCard;
    // 828.1.b.1 — "While I have the Empowered status".
    case 'Empowered':
      return context.empowered;
  }
}

/** Whether a dependent clause's ability currently applies. */
export function clauseIsActive(clause: DependentClause, context: DependencyContext): boolean {
  return conditionActive(clause.keyword, clause.value, context);
}

export type AutomatedKeyword = (typeof AUTOMATED_KEYWORDS)[number];

/**
 * Strips reminder text. 135.2.d.3
 *
 * "The presence, absence, or exact wording of reminder text has no effect on
 * game function" — and reminder text quotes other keywords constantly. Chakram
 * Dancer's Ambush reminder reads "(You may play me as a [Reaction] to a
 * battlefield where you have units.)", which without this made the engine treat
 * it as having Reaction outright, letting it be played into any closed state.
 */
const functionalText = (card: Card): string => (card.text ?? '').replace(/\([^)]*\)/g, '');

/**
 * Reads `[Keyword]` and `[Keyword N]` markers out of a card's functional text.
 * Returns the numeric value where one is printed, else 1.
 */
export function keywordValue(card: Card, keyword: string): number | null {
  const match = new RegExp(`\\[${keyword}(?:\\s+(\\d+))?\\]`, 'i').exec(functionalText(card));
  if (!match) return null;
  return match[1] ? Number(match[1]) : 1;
}

export function hasKeyword(card: Card, keyword: string): boolean {
  return keywordValue(card, keyword) !== null;
}

/** What an Equip ability actually costs. 818.1.c */
export interface EquipCost {
  energy: number;
  /** Power of a specific domain, e.g. from `:rb_rune_fury:`. */
  power: Partial<Record<Domain, number>>;
  /** Power of any domain, from `:rb_rune_rainbow:` — the [A] shorthand (135.2.e.5). */
  anyPower: number;
}

const RUNE_DOMAIN = new Set<string>(['fury', 'calm', 'mind', 'body', 'chaos', 'order']);

/**
 * Reads the resource cost off an "[Equip] <symbols>" line. 818.1.c
 *
 * Printed as "[Equip] :rb_energy_1::rb_rune_fury:" — symbols right after the
 * bare marker, not a number inside it (`keywordValue`'s `[Equip N]` reading
 * does not apply here; Equip never carries its cost that way in the dataset).
 *
 * Returns null when the line has anything beyond Energy/Power symbols —
 * "Equip [3][A], Kill a friendly unit" has a cost this cannot pay on its own,
 * and guessing which unit to kill would be worse than refusing. A card whose
 * Equip cost cannot be read this way keeps its Equip ability off the board's
 * automatic offer; the rules text still surfaces in the apply-by-hand panel.
 */
export function equipCost(card: Card): EquipCost | null {
  const line = (card.text ?? '').split('\n').find((l) => /\[Equip\]/i.test(l));
  if (!line) return null;

  const afterMarker = line.split(/\[Equip\]/i)[1] ?? '';
  const segment = afterMarker.split('(')[0];
  const tokens = segment.match(/:rb_(?:energy_\d+|rune_[a-z]+):/gi) ?? [];
  // Every non-whitespace character must belong to a matched token, or there is
  // a real cost here (a non-resource cost, or a symbol this reader misses).
  if (segment.replace(/\s+/g, '') !== tokens.join('')) return null;
  if (tokens.length === 0) return null;

  let energy = 0;
  let anyPower = 0;
  const power: Partial<Record<Domain, number>> = {};
  for (const token of tokens) {
    const energyMatch = /^:rb_energy_(\d+):$/i.exec(token);
    if (energyMatch) {
      energy += Number(energyMatch[1]);
      continue;
    }
    const runeMatch = /^:rb_rune_([a-z]+):$/i.exec(token);
    const name = runeMatch?.[1].toLowerCase() ?? '';
    if (name === 'rainbow') {
      anyPower += 1;
    } else if (RUNE_DOMAIN.has(name)) {
      const domain = (name[0].toUpperCase() + name.slice(1)) as Domain;
      power[domain] = (power[domain] ?? 0) + 1;
    } else {
      return null; // an Equip symbol this reader does not recognise
    }
  }
  return { energy, power, anyPower };
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
export function unautomatedText(card: Card, context?: DependencyContext): string | null {
  const text = card.text ?? '';
  if (!text || text === '[NO TEXT]') return null;

  /*
   * 824.1.d / 828.1.c — a Dependent Ability whose condition is not met is
   * Inactive, so telling a player to apply it would be wrong. Without a context
   * nothing is dropped: the caller does not know whose card this is, and
   * silently assuming the condition fails would hide real text.
   */
  const inactive = context
    ? new Set(
        dependentClauses(card)
          .filter((clause) => !clauseIsActive(clause, context))
          .map((clause) => clause.line),
      )
    : new Set<string>();

  const remaining = text
    .split('\n')
    .filter((line) => !inactive.has(line))
    .map((line) =>
      line
        .replace(/\([^)]*\)/g, '') // reminder text
        .replace(/\[([^\]]{1,40})\]/g, (full, label: string) => {
          // [>] and [>>] only separate a keyword from its ability.
          if (label === '>' || label === '>>') return '';
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
