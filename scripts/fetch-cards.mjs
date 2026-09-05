/**
 * fetch-cards — pull the full Riftbound card list from the Riftcodex API and
 * write a vendored, normalized dataset into public/data/. It lives under
 * public/ so it is served as a static file rather than bundled into the JS,
 * which keeps it out of the app bundle and lets the service worker cache it.
 *
 *   npm run fetch-cards
 *
 * Riftcodex (https://riftcodex.com) is a free, no-auth community REST API.
 * Endpoints live at the root: /cards, /sets, /index/* — NOT under /api.
 *
 * We vendor rather than call the API at runtime because Riftcodex can only
 * filter server-side on set_id and a text query; every other filter the app
 * needs (domain, type, cost, keyword) has to happen client-side anyway, and a
 * local copy means the app works offline. Re-run this when a new set drops.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const API = 'https://api.riftcodex.com';
const PAGE_SIZE = 100;
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data');

/**
 * Riot serves card art from a Sanity-backed CDN that does on-the-fly
 * transforms, so we store only the asset segment and let the app append
 * ?w=&fm=webp at render time. That turns a 1.4MB PNG into ~20KB for a grid
 * thumbnail, which is the difference between usable and unusable on mobile.
 */
const IMAGE_PREFIX = 'https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/';

async function getJSON(url) {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status} ${res.statusText}`);
  return res.json();
}

/** Strip the CDN prefix; keep a full URL as-is if it ever moves hosts. */
function toAssetRef(url) {
  if (!url) return null;
  const clean = url.split('?')[0];
  return clean.startsWith(IMAGE_PREFIX) ? clean.slice(IMAGE_PREFIX.length) : clean;
}

/** Riftcodex's text.plain runs abilities together; its rich HTML has the breaks. */
function htmlToText(html, plain) {
  if (!html) return plain || null;
  const out = html
    .replace(/<\/(p|div|li)>\s*<(p|div|li)[^>]*>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return out || plain || null;
}

/** "Vi - Piltover Enforcer (Signature)" -> "Vi - Piltover Enforcer" */
function stripVariantSuffix(name) {
  return name.replace(/\s*\([^)]*\)\s*$/, '').trim();
}

function normalize(raw) {
  const a = raw.attributes ?? {};
  const c = raw.classification ?? {};
  const t = raw.text ?? {};
  const s = raw.set ?? {};
  const m = raw.media ?? {};
  const meta = raw.metadata ?? {};
  return {
    id: raw.id,
    name: raw.name,
    baseName: stripVariantSuffix(raw.name),
    riftboundId: raw.riftbound_id ?? null,
    collectorNumber: raw.collector_number ?? null,
    type: c.type ?? null,
    supertype: c.supertype ?? null,
    rarity: c.rarity ?? null,
    domains: c.domain ?? [],
    energy: a.energy ?? null,
    might: a.might ?? null,
    power: a.power ?? null,
    text: htmlToText(t.rich, t.plain),
    flavour: t.flavour ?? null,
    setId: s.set_id ?? null,
    setLabel: s.label ?? null,
    img: toAssetRef(m.image_url),
    orientation: raw.orientation ?? 'portrait',
    artist: m.artist ?? null,
    tags: raw.tags ?? [],
    signature: Boolean(meta.signature),
    alternateArt: Boolean(meta.alternate_art),
    overnumbered: Boolean(meta.overnumbered),
    tcgplayerId: raw.tcgplayer_id ?? null,
  };
}

async function fetchAllCards() {
  const first = await getJSON(`${API}/cards?page=1&size=${PAGE_SIZE}`);
  const pages = first.pages ?? 1;
  const items = [...first.items];
  process.stdout.write(`  page 1/${pages}`);
  for (let p = 2; p <= pages; p++) {
    const page = await getJSON(`${API}/cards?page=${p}&size=${PAGE_SIZE}`);
    items.push(...page.items);
    process.stdout.write(`\r  page ${p}/${pages}`);
  }
  process.stdout.write('\n');
  return { items, total: first.total };
}

/**
 * Guard rails. A silently-truncated or reshaped dataset would surface much
 * later as "why is this card missing" — cheaper to fail loudly here.
 */
function verify(cards, sets) {
  const problems = [];

  if (cards.length < 1400) problems.push(`only ${cards.length} cards fetched (expected 1400+)`);
  if (sets.length < 8) problems.push(`only ${sets.length} sets fetched (expected 8+)`);

  const missingImg = cards.filter((c) => !c.img).length;
  if (missingImg > 0) problems.push(`${missingImg} cards missing an image`);

  const missingType = cards.filter((c) => !c.type).length;
  if (missingType > 0) problems.push(`${missingType} cards missing a type`);

  // Spot-checks against cards whose stats we know independently.
  const check = (name, want) => {
    const got = cards.find((c) => c.name === name);
    if (!got) return problems.push(`spot-check: "${name}" not found`);
    for (const [k, v] of Object.entries(want)) {
      const actual = Array.isArray(got[k]) ? got[k].join('/') : got[k];
      const expect = Array.isArray(v) ? v.join('/') : v;
      if (actual !== expect) {
        problems.push(`spot-check: ${name}.${k} = ${JSON.stringify(actual)}, expected ${JSON.stringify(expect)}`);
      }
    }
  };
  check('Teemo - Swift Scout', { type: 'Legend', domains: ['Mind', 'Chaos'] });
  check('Nocturne - Horrifying', { type: 'Unit', domains: ['Chaos'], energy: 4, power: 1, might: 4 });

  return problems;
}

/**
 * The keyword index is derived from bracket markers in card text, so it picks
 * up things that aren't keywords: "11" and "6" come from [Level 11], and
 * "TEXT" from the [NO TEXT] placeholder. Drop those so the filter list only
 * offers real keywords.
 */
const NON_KEYWORDS = new Set(['TEXT']);

function cleanKeywords(values) {
  return values
    .filter((k) => !/^\d+$/.test(k) && !NON_KEYWORDS.has(k))
    .map((k) => (k === k.toUpperCase() && k.length > 1 ? k[0] + k.slice(1).toLowerCase() : k))
    .sort((a, b) => a.localeCompare(b));
}

async function main() {
  console.log(`Fetching from ${API} ...`);

  const [{ items, total }, setsRes, keywords] = await Promise.all([
    fetchAllCards(),
    getJSON(`${API}/sets?size=100`),
    getJSON(`${API}/index/keywords`),
  ]);

  if (items.length !== total) {
    throw new Error(`pagination mismatch: collected ${items.length} of ${total}`);
  }

  const cards = items.map(normalize).sort((a, b) => a.name.localeCompare(b.name));
  const sets = (setsRes.items ?? [])
    .map((s) => ({
      setId: s.set_id,
      name: s.name,
      cardCount: s.card_count ?? null,
      publishedOn: s.published_on ? s.published_on.slice(0, 10) : null,
    }))
    .sort((a, b) => (b.publishedOn ?? '').localeCompare(a.publishedOn ?? ''));

  const problems = verify(cards, sets);
  if (problems.length) {
    console.error('\nDataset failed verification:');
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }

  mkdirSync(OUT_DIR, { recursive: true });
  const meta = {
    source: 'https://riftcodex.com',
    fetchedAt: new Date().toISOString(),
    imagePrefix: IMAGE_PREFIX,
    cardCount: cards.length,
    setCount: sets.length,
  };
  writeFileSync(join(OUT_DIR, 'cards.json'), JSON.stringify(cards), 'utf8');
  writeFileSync(join(OUT_DIR, 'sets.json'), JSON.stringify(sets, null, 2), 'utf8');
  const keywordList = cleanKeywords(keywords.values ?? []);
  writeFileSync(join(OUT_DIR, 'keywords.json'), JSON.stringify(keywordList, null, 2), 'utf8');
  writeFileSync(join(OUT_DIR, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8');

  const bySet = sets.map((s) => `${s.setId} ${cards.filter((c) => c.setId === s.setId).length}`).join('  ');
  console.log(`\nOK  ${cards.length} cards · ${sets.length} sets · ${keywordList.length} keywords`);
  console.log(`    ${bySet}`);
  console.log(`    written to public/data/`);
}

main().catch((err) => {
  console.error('\nfetch-cards failed:', err.message);
  process.exit(1);
});
