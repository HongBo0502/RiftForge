import { describe, expect, it } from 'vitest';
import { nameKey } from '@/types';
import { CARDS, findCard } from '@/test/dataset';
import { ALL_SCRIPTS, cardScript, manualText, scriptText } from './scripts';
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
 */
const PLAYED_FLOOR = 174;

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

  it(`plays at least ${PLAYED_FLOOR} printings with nothing left to apply by hand`, () => {
    const full = PLAYABLE.filter((c) => manualText(c) === null);
    expect(full.length).toBeGreaterThanOrEqual(PLAYED_FLOOR);
  });
});
