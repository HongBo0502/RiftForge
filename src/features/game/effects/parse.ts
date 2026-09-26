import type { Card } from '@/types';
import type {
  Condition,
  DependentKeyword,
  Duration,
  Instruction,
  ParsedAbility,
  ParsedCard,
  Selector,
  Side,
  Trigger,
  Where,
} from './types';

/**
 * Card text to instructions.
 *
 * A strict reader, on purpose. Anything it is not certain of is left unparsed
 * and reaches the player as text to apply by hand — a parser that guesses would
 * be worse than no parser, because the player would never know it guessed.
 */

/** Strips reminder text (135.2.d.3) and the symbol soup, leaving words. */
function normalise(line: string): string {
  return line
    .replace(/\([^)]*\)/g, '')
    .replace(/’/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/** Splits a card into one sentence per instruction. */
function sentences(text: string): string[] {
  return text
    .split('\n')
    .flatMap((line) => normalise(line).split(/(?<=[.!])\s+/))
    .map((s) => s.trim())
    .filter((s) => s.length > 1);
}

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

const SIDE: Array<[RegExp, Side]> = [
  [/\b(friendly|your|you control)\b/, 'friendly'],
  [/\b(enemy|an opponent's|opposing)\b/, 'enemy'],
];

const WHERE: Array<[RegExp, Where]> = [
  [/\bhere\b/, 'here'],
  [/\bat a battlefield\b/, 'battlefield'],
  [/\bin a base\b|\bat their base\b|\bin your base\b/, 'base'],
];

/** Written numbers that appear in card text. */
const WORD_NUMBER: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
};

function amountIn(phrase: string, fallback = 1): number | null {
  const digits = /\b(\d+)\b/.exec(phrase);
  if (digits) return Number(digits[1]);
  for (const [word, value] of Object.entries(WORD_NUMBER)) {
    if (new RegExp(`\\b${word}\\b`).test(phrase)) return value;
  }
  return fallback;
}

/**
 * Reads the noun phrase an instruction acts on.
 *
 * Returns null rather than guessing: "a unit with the most Might" and
 * "a unit you don't control that was played this turn" are real phrases, and
 * treating either as plain "a unit" would quietly target the wrong thing.
 */
export function parseSelector(phrase: string): Selector | null {
  const p = phrase.toLowerCase().trim().replace(/[.,]$/, '');

  if (/^(me|i|this|myself)$/.test(p)) return { kind: 'self' };

  // Anything qualified beyond side/location is beyond this reader.
  if (/\bwith\b|\bthat\b|\bwhose\b|\bmost\b|\bleast\b|\bother than\b|\bexcept\b|\bamong\b/.test(p)) {
    return null;
  }

  if (/^(you|your)$/.test(p)) return { kind: 'player', side: 'you' };
  if (/^(each player|all players)$/.test(p)) return { kind: 'player', side: 'each' };
  if (/^(an opponent|each opponent|your opponent)$/.test(p)) {
    return { kind: 'player', side: 'opponent' };
  }

  const isUnit = /\bunits?\b/.test(p);
  const isGear = /\bgear\b/.test(p);
  if (!isUnit && !isGear) return null;

  const side = SIDE.find(([re]) => re.test(p))?.[1] ?? 'any';
  const where = WHERE.find(([re]) => re.test(p))?.[1] ?? 'anywhere';

  // "all"/"each" is not a choice (355.5.a); "a"/"up to N" is.
  const everything = /\b(all|each|every|other)\b/.test(p);
  const count = everything ? Infinity : (amountIn(p, 1) ?? 1);

  return {
    kind: isUnit ? 'unit' : 'gear',
    side,
    where,
    chosen: !everything,
    count: count === Infinity ? Number.POSITIVE_INFINITY : count,
  };
}

// ---------------------------------------------------------------------------
// Dependent Keyword conditions — 727
// ---------------------------------------------------------------------------

/**
 * Reads a leading `[Legion][>]`, `[Level N][>]` or `[Empowered][>]` off a
 * sentence. 727.1 — "Starting from the Keyword to the end of the clause,
 * the entire statement is the Dependent Ability", so what follows is gated by
 * the condition, not a separate unconditional fact.
 */
function leadingCondition(sentence: string): { condition: Condition | null; rest: string } {
  const m = /^\[(Legion|Level|Empowered)(?:\s+(\d+))?\]\[>\]\s*/i.exec(sentence);
  if (!m) return { condition: null, rest: sentence };
  const keyword = (m[1][0].toUpperCase() + m[1].slice(1).toLowerCase()) as DependentKeyword;
  return {
    condition: { keyword, value: m[2] ? Number(m[2]) : null },
    rest: sentence.slice(m[0].length),
  };
}

// ---------------------------------------------------------------------------
// Triggers
// ---------------------------------------------------------------------------

const TRIGGERS: Array<[RegExp, Trigger]> = [
  [/^when (you play me|i'?m played|this is played)\b/, { on: 'play' }],
  [/^when i die\b/, { on: 'death' }],
  [/^when i attack or defend\b/, { on: 'attackOrDefend' }],
  [/^when i attack\b/, { on: 'attack' }],
  [/^when i defend\b/, { on: 'defend' }],
  [/^when you conquer\b/, { on: 'conquer' }],
  [/^when i become empowered\b/, { on: 'empowered' }],
];

/** Splits "When X, do Y." into its trigger and its effect. */
function splitTrigger(sentence: string): { trigger: Trigger | null; body: string } {
  const lower = sentence.toLowerCase();
  for (const [re, trigger] of TRIGGERS) {
    if (!re.test(lower)) continue;
    const comma = sentence.indexOf(',');
    if (comma < 0) return { trigger, body: '' };
    return { trigger, body: sentence.slice(comma + 1).trim() };
  }
  return { trigger: null, body: sentence };
}

// ---------------------------------------------------------------------------
// Instructions
// ---------------------------------------------------------------------------

const durationOf = (s: string): Duration => (/\bthis turn\b/.test(s) ? 'thisTurn' : 'permanent');

type Matcher = (sentence: string) => Instruction | null;

const YOU: Selector = { kind: 'player', side: 'you' };

const MATCHERS: Matcher[] = [
  // "Draw 1." / "Draw 2."
  (s) => {
    const m = /^draw (\d+|a|an|one|two|three)\.?$/i.exec(s);
    return m ? { verb: 'draw', amount: amountIn(m[1]) ?? 1, who: YOU } : null;
  },

  // "Discard 1."
  (s) => {
    const m = /^discard (\d+|a|an|one|two|three)\.?$/i.exec(s);
    return m ? { verb: 'discard', amount: amountIn(m[1]) ?? 1, who: YOU } : null;
  },

  // "Deal 4 to a unit at a battlefield." 712
  (s) => {
    const m = /^deal (\d+) (?:damage )?to (.+?)\.?$/i.exec(s);
    if (!m) return null;
    const target = parseSelector(m[2]);
    return target ? { verb: 'deal', amount: Number(m[1]), target } : null;
  },

  // "Give a unit +2 Might this turn." / "Give an enemy unit here -1 Might this turn."
  (s) => {
    // No \b after the alternation: ":rb_might:" ends in a non-word character,
    // so a word boundary there can never match.
    const m = /^give (.+?) ([+-]\d+) (?::rb_might:|might)(.*)$/i.exec(s);
    if (!m) return null;
    // "to a minimum of 1" is a floor this reader does not model.
    if (/minimum|maximum/i.test(m[3])) return null;
    const target = parseSelector(m[1]);
    return target
      ? { verb: 'might', amount: Number(m[2]), target, duration: durationOf(s) }
      : null;
  },

  // "Kill a unit." / "Kill all gear."
  (s) => {
    const m = /^kill (.+?)\.?$/i.exec(s);
    if (!m) return null;
    const target = parseSelector(m[1]);
    return target ? { verb: 'kill', target } : null;
  },

  // "Buff a unit." 426
  (s) => {
    const m = /^buff (.+?)\.?$/i.exec(s);
    if (!m) return null;
    const target = parseSelector(m[1]);
    return target ? { verb: 'buff', target } : null;
  },

  // "Stun a unit at a battlefield." 423
  (s) => {
    const m = /^stun (.+?)\.?$/i.exec(s);
    if (!m) return null;
    const target = parseSelector(m[1]);
    return target ? { verb: 'stun', target } : null;
  },

  // "Empower a friendly unit." / "Disempower an enemy unit." 441, 442
  (s) => {
    const m = /^(empower|disempower) (.+?)\.?$/i.exec(s);
    if (!m) return null;
    const target = parseSelector(m[2]);
    if (!target) return null;
    return m[1].toLowerCase() === 'empower'
      ? { verb: 'empower', target }
      : { verb: 'disempower', target };
  },

  // "Ready a friendly unit." / "Exhaust an enemy unit."
  (s) => {
    const m = /^(ready|exhaust) (.+?)\.?$/i.exec(s);
    if (!m) return null;
    const target = parseSelector(m[2]);
    if (!target) return null;
    return m[1].toLowerCase() === 'ready' ? { verb: 'ready', target } : { verb: 'exhaust', target };
  },

  // "Gain 1 XP." 730.1
  (s) => {
    const m = /^gain (\d+) xp\.?$/i.exec(s);
    return m ? { verb: 'gainXp', amount: Number(m[1]), who: YOU } : null;
  },

  // "Gain 1 point." 194
  (s) => {
    const m = /^gain (\d+) points?\.?$/i.exec(s);
    return m ? { verb: 'gainPoints', amount: Number(m[1]), who: YOU } : null;
  },

  // "Recall a friendly unit." 144
  (s) => {
    const m = /^recall (.+?)\.?$/i.exec(s);
    if (!m) return null;
    const target = parseSelector(m[1]);
    return target ? { verb: 'recall', target } : null;
  },

  // "I have +2 Might." — a continuous stat line, often gated by a Dependent
  // Keyword (see `leadingCondition`). Not "give" (a one-shot change to
  // someone chosen) — this is always self, and lasts as long as the card is
  // on the board. 143
  (s) => STATIC_MIGHT_RE.test(s) ? { verb: 'staticMight', amount: Number(STATIC_MIGHT_RE.exec(s)![1]) } : null,

  // "I enter ready." — overrides 178.1.a.1's exhausted-on-entry default.
  (s) => (ENTERS_READY_RE.test(s) ? { verb: 'entersReady' } : null),

  // "This enters exhausted." — overrides 147's ready-on-entry default for Gear.
  (s) => (ENTERS_EXHAUSTED_RE.test(s) ? { verb: 'entersExhausted' } : null),
];

/**
 * These three shapes are read here, and also matched again — verbatim — by
 * `stripAutomatedEffectLines` below, which keeps the "apply by hand" panel
 * from telling a player to do by hand what `combat.ts`/`reducer.ts` already
 * did for them. Keep the two in step.
 */
export const STATIC_MIGHT_RE = /^i have ([+-]\d+) (?::rb_might:|might)\.?$/i;
export const ENTERS_READY_RE = /^i enter ready\.?$/i;
export const ENTERS_EXHAUSTED_RE = /^this enters exhausted\.?$/i;

/** Verbs read directly by the engine rather than run through `execute()`. */
export const BOARD_STATE_VERBS = ['staticMight', 'entersReady', 'entersExhausted'] as const;

/** Reads one sentence, or returns null if the vocabulary does not cover it. */
export function parseInstruction(sentence: string): Instruction | null {
  const s = sentence.trim();
  for (const matcher of MATCHERS) {
    const found = matcher(s);
    if (found) return found;
  }
  return null;
}

/**
 * Reads a whole card.
 *
 * Every sentence either becomes an instruction or lands in `unparsed`. A card
 * is only played automatically when `unparsed` is empty; a partially understood
 * card still shows its whole remaining text, because applying half an ability
 * silently is worse than applying none of it.
 */
export function parseCard(card: Card): ParsedCard {
  const abilities: ParsedAbility[] = [];
  const unparsed: string[] = [];

  for (const sentence of sentences(card.text ?? '')) {
    // Lines that are only keyword markers are handled elsewhere entirely.
    if (/^(\[[^\]]*\]\s*)+$/.test(sentence)) continue;
    if (sentence === '[NO TEXT]') continue;

    const { condition, rest } = leadingCondition(sentence);
    const withoutMarkers = rest.replace(/\[[^\]]*\]/g, '').trim();
    /*
     * What is left may be nothing but cost symbols — "[Empower] :rb_energy_3:"
     * is a keyword and its cost, not an instruction. This has to run *after* the
     * markers come off, or the leading keyword hides the fact. Counting these as
     * missed effects overstates what the parser cannot read.
     */
    if (/^[\s.:,—-]*(?::rb_[a-z_0-9]+:[\s.:,—-]*)+$/i.test(withoutMarkers)) continue;
    if (withoutMarkers === '' || /^[\s.,:—-]+$/.test(withoutMarkers)) continue;

    const { trigger, body } = splitTrigger(withoutMarkers);
    const text = body.trim();
    if (!text) {
      unparsed.push(sentence);
      continue;
    }

    /*
     * A sentence can chain instructions: "Discard 1, then draw 2." Each part
     * has to parse, or the whole sentence is unparsed — half an effect is not
     * something to apply quietly.
     */
    const parts = text.split(/,\s*then\s+|\.\s+/).map((p) => p.trim()).filter(Boolean);
    const instructions: Instruction[] = [];
    let ok = true;
    for (const part of parts) {
      const instruction = parseInstruction(part);
      if (!instruction) {
        ok = false;
        break;
      }
      instructions.push(instruction);
    }

    if (ok && instructions.length > 0) abilities.push({ trigger, instructions, condition });
    else unparsed.push(sentence);
  }

  return { abilities, unparsed };
}

/**
 * Parses once per card, then reuses the answer.
 *
 * Card text never changes at runtime, and this is called from combat math
 * (`unitMight`, on every Might read) as well as from resolution, so the cache
 * matters, not just the parse itself.
 */
const parseCache = new Map<string, ParsedCard>();

export function parseCardCached(card: Card): ParsedCard {
  const hit = parseCache.get(card.id);
  if (hit) return hit;
  const parsed = parseCard(card);
  parseCache.set(card.id, parsed);
  return parsed;
}

/** Test seam: clears the memoised parses. */
export function clearParseCache(): void {
  parseCache.clear();
}

/**
 * Drops lines from an already-computed "apply by hand" text that the engine
 * now handles itself — `combat.ts` for `staticMight`, `reducer.ts` for
 * `entersReady`/`entersExhausted` — so the panel does not ask a player to do
 * by hand what already happened. `unautomatedText` (engine/keywords.ts) has
 * already dropped an *inactive* Dependent Keyword's line and stripped the
 * keyword markers off an active one, which is what lets the plain-text
 * regexes below still match here.
 */
export function stripAutomatedEffectLines(text: string): string {
  return text
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim();
      return (
        !STATIC_MIGHT_RE.test(trimmed) &&
        !ENTERS_READY_RE.test(trimmed) &&
        !ENTERS_EXHAUSTED_RE.test(trimmed)
      );
    })
    .join('\n')
    .trim();
}
