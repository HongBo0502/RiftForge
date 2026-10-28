import { describe, expect, it } from 'vitest';
import { nameKey } from '@/types';
import { CARDS, findCard } from '@/test/dataset';
import { ALL_SCRIPTS, cardScript, isBoardState, manualText, scriptText } from './scripts';
import type { Instruction } from './types';

/**
 * The per-card effect scripts in `./cards/` are source code written as data.
 * These tests are their compiler: a malformed script, a verb the executor
 * does not know, or a script whose wording matches no printed card fails
 * here instead of misbehaving in a game.
 */

/** Every verb `execute.ts`/the engine implements. Keep in step with `Instruction`. */
const KNOWN_VERBS = new Set<Instruction['verb']>([
  'draw', 'discard', 'deal', 'might', 'kill', 'buff', 'stun', 'empower', 'disempower',
  'ready', 'exhaust', 'gainXp', 'gainPoints', 'recall', 'channel',
  'staticMight', 'entersReady', 'entersExhausted',
]);

const PLAYABLE = CARDS.filter((c) => ['Unit', 'Spell', 'Gear'].includes(c.type ?? '') && c.text);

/**
 * Printings the engine plays with nothing left to apply by hand — from a
 * script, or from keywords alone ("[Tank]" needs no script). Only ever raise it.
 *
 * Lowered once, 174 → 141, in the 2026-10-28 audit, and both causes were
 * miscounts, not lost coverage:
 * - `isRunnable` arrived: scripted "When I attack…" triggers were never run
 *   but still looked automated (Crackshot Corsair, Leona - Determined…), and
 *   "discard 1" was picking the card for the player.
 * - 27 scripts misread their card (see REVIEWED below) and went back to manual.
 */
const PLAYED_FLOOR = 141;

/**
 * Wording the effect vocabulary cannot express: a qualifier ("an enemy Chaos
 * unit", "an attacking unit"), a "choose one", an "instead", a "for each".
 * The parser used to drop these silently — "Give two friendly units each +2"
 * became every friendly unit. A script that runs on such a card must have been
 * checked by a person against the printed text and listed in REVIEWED; a new
 * one fails here until someone has.
 */
const RISKY =
  /for each|instead|\beach\b|choose|\bif\b|\bthen\b|up to|\btwo\b|\bthree\b|attacking|defending|damaged|in combat|\b(Fury|Calm|Mind|Body|Chaos|Order)\b|\bor\b|\band (an|a|another)\b|equal to|opponent|its controller/i;

/** Checked by hand in the 2026-10-28 audit: the part each runs is exactly what it prints. */
const REVIEWED = new Set([
  'Angle Shot', 'Aphelios - Exalted', 'Arcane Shift', 'Bellows Breath', 'Call to Glory',
  'Catalyst of Aeons', 'Combat Experience', 'Concentrate', 'Consuming Curse', 'Counter Strike',
  'Dancing Grenade', 'Death from Below', 'Detonate', 'Disintegrate', 'Evershade Stalker',
  'Ezreal - Prodigy', 'Fae Dragon', 'Find Your Center', "Gentlemen's Duel", 'Guttural Roar',
  'Hidden Blade', 'Last Breath', 'Lunar Boon', 'Malzahar - Fanatic', 'Mel, Newly Awakened',
  'Mobilize', 'Monster Harpoon', 'Peak Guardian', 'Production Surge', 'Renekton, Brute',
  'Ruthless Strike', "Scryer's Bloom", 'Scuttle Crab', 'Sett - Brawler', "Shadow's Call",
  'Shock Blast', 'Siphoning Strike', 'Smite', 'Smoke and Mirrors', 'Spoils of War', 'Stare Down',
  'Sudden Storm', 'Udyr - Wildman', 'Unchecked Power', 'Wallop',
]);

describe('card scripts', () => {
  it('loads one script per card name', () => {
    expect(ALL_SCRIPTS.length).toBeGreaterThan(0);
    const names = ALL_SCRIPTS.map((s) => nameKey(s.name));
    expect(new Set(names).size).toBe(names.length);
  });

  it('uses only verbs the engine can execute', () => {
    for (const script of ALL_SCRIPTS) {
      const instructions = [
        ...script.abilities.flatMap((a) => a.instructions),
        ...script.activated.flatMap((a) => a.instructions),
      ];
      for (const instruction of instructions) {
        expect(KNOWN_VERBS.has(instruction.verb), `${script.name}: ${instruction.verb}`).toBe(true);
      }
    }
  });

  it('names a real card, and every listed wording is a real printing', () => {
    // A wording no card prints is dead weight — usually a typo in a hand edit.
    for (const script of ALL_SCRIPTS) {
      const printings = PLAYABLE.filter((c) => nameKey(c.name) === nameKey(script.name));
      expect(printings.length, `${script.name} matches no card`).toBeGreaterThan(0);
      const printed = new Set(printings.map((c) => scriptText(c.text)));
      for (const text of script.texts) {
        expect(printed.has(text), `${script.name}: unknown wording "${text}"`).toBe(true);
      }
    }
  });

  it('does not apply to a printing whose wording it was not written for', () => {
    const script = ALL_SCRIPTS[0];
    const card = findCard((c) => nameKey(c.name) === nameKey(script.name), script.name);
    expect(cardScript(card)).not.toBeNull();
    expect(cardScript({ ...card, text: `${card.text} Draw 9.` })).toBeNull();
  });

  it('keeps unscripted text visible as manual', () => {
    const unscripted = findCard((c) => PLAYABLE.includes(c) && !cardScript(c), 'an unscripted card');
    expect(manualText(unscripted)).not.toBeNull();
  });

  it('runs no unreviewed script on wording the vocabulary cannot express', () => {
    for (const script of ALL_SCRIPTS) {
      const runs = script.abilities.some((a) => !isBoardState(a)) || script.activated.length > 0;
      if (!runs || !script.texts.some((text) => RISKY.test(text))) continue;
      expect(
        REVIEWED.has(script.name),
        `${script.name}: check its script against the printed text, then add it to REVIEWED`,
      ).toBe(true);
    }
  });

  it(`plays at least ${PLAYED_FLOOR} printings with nothing left to apply by hand`, () => {
    const full = PLAYABLE.filter((c) => manualText(c) === null);
    expect(full.length).toBeGreaterThanOrEqual(PLAYED_FLOOR);
  });
});
