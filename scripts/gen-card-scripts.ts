/**
 * Drafts one effect script per card name into src/features/game/effects/cards/.
 *
 *   npm run gen-scripts            # write drafts for cards that have none yet
 *   npm run gen-scripts -- --force # also overwrite existing scripts
 *
 * The text parser is an authoring aid here and nothing more: it proposes a
 * script, a person reviews the JSON, and the engine only ever reads the JSON.
 * Existing files are never overwritten without --force, because they may have
 * been edited by hand. Every card gets a file; one the parser reads nothing of
 * is all `manual`, which is its to-do list.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { nameKey, type Card } from '../src/types';
import { parseCard } from '../src/features/game/effects/parse';
import { scriptText } from '../src/features/game/effects/scriptText';
import type { CardScript } from '../src/features/game/effects/types';

const OUT = join(import.meta.dirname, '..', 'src', 'features', 'game', 'effects', 'cards');
const force = process.argv.includes('--force');

const cards: Card[] = JSON.parse(
  readFileSync(join(import.meta.dirname, '..', 'public', 'data', 'cards.json'), 'utf8'),
);
const playable = cards.filter((c) => ['Unit', 'Spell', 'Gear'].includes(c.type ?? '') && c.text);

const byName = new Map<string, Card[]>();
for (const card of playable) {
  const key = nameKey(card.name);
  byName.set(key, [...(byName.get(key) ?? []), card]);
}

const slug = (name: string): string =>
  nameKey(name).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

mkdirSync(OUT, { recursive: true });
let written = 0;
let kept = 0;
let none = 0;

for (const printings of byName.values()) {
  /*
   * Printings of one name can differ (errata, typos). Draft from the reading
   * most printings share, and list only the wordings that read the same way —
   * any other wording is left out of `texts`, so it falls back to manual.
   */
  const readings = new Map<string, { script: CardScript; texts: Set<string> }>();
  for (const card of printings) {
    const parsed = parseCard(card);
    const key = JSON.stringify([parsed.abilities, parsed.activatedAbilities, parsed.unparsed]);
    const entry = readings.get(key) ?? {
      script: {
        name: card.name.replace(/\s*\([^)]*\)\s*$/, ''),
        texts: [],
        abilities: parsed.abilities,
        activated: parsed.activatedAbilities,
        manual: parsed.unparsed,
      },
      texts: new Set<string>(),
    };
    entry.texts.add(scriptText(card.text));
    readings.set(key, entry);
  }
  const best = [...readings.values()].sort((a, b) => b.texts.size - a.texts.size)[0];
  const script = { ...best.script, texts: [...best.texts].sort() };

  // Every card gets a file, even one with nothing scripted yet: its `manual`
  // list is then the to-do list for whoever writes that card's effects.
  if (script.abilities.length === 0 && script.activated.length === 0 && script.manual.length > 0) {
    none++;
  }

  const file = join(OUT, `${slug(script.name)}.json`);
  if (existsSync(file) && !force) {
    kept++;
    continue;
  }
  writeFileSync(file, `${JSON.stringify(script, null, 2)}\n`);
  written++;
}

console.log(
  `${byName.size} card names · ${written} written · ${kept} kept (already exist) · ${none} still entirely manual`,
);
