/**
 * Seeded RNG. The engine must be deterministic: replaying an action log from
 * the same seed has to produce an identical game, which is what makes undo,
 * replay, and (later) two clients agreeing on a shuffle possible.
 *
 * mulberry32 — small, fast, and good enough for shuffling a 40-card deck.
 */

/** Advances the seed and returns the next float in [0, 1) with the new seed. */
export function nextRandom(seed: number): { value: number; seed: number } {
  let t = (seed + 0x6d2b79f5) | 0;
  let x = t;
  x = Math.imul(x ^ (x >>> 15), 1 | x);
  x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
  const value = ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  return { value, seed: t };
}

/** Integer in [0, max). */
export function nextInt(seed: number, max: number): { value: number; seed: number } {
  const r = nextRandom(seed);
  return { value: Math.floor(r.value * max), seed: r.seed };
}

/** Fisher-Yates, returning a new array and the advanced seed. */
export function shuffle<T>(items: readonly T[], seed: number): { items: T[]; seed: number } {
  const out = items.slice();
  let s = seed;
  for (let i = out.length - 1; i > 0; i--) {
    const r = nextInt(s, i + 1);
    s = r.seed;
    [out[i], out[r.value]] = [out[r.value], out[i]];
  }
  return { items: out, seed: s };
}
