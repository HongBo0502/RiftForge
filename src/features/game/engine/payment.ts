import type { Card, Domain } from '@/types';
import { keywordValue } from './keywords';
import type { GameState, PlayerId } from './types';

/**
 * Working out which runes to spend on a card. 163, 201
 *
 * A cost is Energy (any rune, exhausted) plus Power of the card's own domain
 * (a rune of that domain, recycled). Recycling removes the rune from the board
 * for the rest of the game, so it is strictly more expensive than exhausting —
 * the planner therefore never recycles a rune it could have exhausted, and
 * prefers to recycle a domain the card actually needs.
 *
 * Kept out of the reducer so the UI can show the plan before committing to it,
 * which is what drives the rune highlight.
 */

export interface PaymentPlan {
  /** Rune uids to exhaust, one Energy each. */
  exhaust: string[];
  /** Rune uids to recycle, one Power of their own domain each. */
  recycle: string[];
  /** Energy already sitting in the pool that this plan spends. */
  energyFromPool: number;
  /** Power already in the pool that this plan spends, by domain. */
  powerFromPool: Partial<Record<Domain, number>>;
}

export type PlanResult =
  | { ok: true; plan: PaymentPlan }
  | { ok: false; reason: string; rule?: string };

const domainOf = (state: GameState, uid: string, lookup: (id: string) => Card | undefined): Domain => {
  const card = lookup(state.instances[uid]?.cardId ?? '');
  return (card?.domains.find((d) => d !== 'Colorless') ?? 'Colorless') as Domain;
};

export interface PlanOptions {
  /**
   * Accelerate: pay [1][C] as an *additional* cost so the unit enters ready
   * (805.1.a). The Power portion must match one of the card's own domains,
   * which the existing domain filter below already enforces.
   */
  accelerate?: boolean;
  /** What this card chooses, so Deflect can charge for it. 809 */
  targets?: string[];
}

/**
 * The extra Power owed for choosing things with Deflect. 809.1.c
 *
 * Only an *opponent's* objects charge it, and it is charged once per time they
 * are chosen — so a spell naming the same unit twice pays twice. 809.2 sums
 * multiple sources of the keyword, which `keywordValue` already collapses into
 * one printed number per card.
 */
export function deflectSurcharge(
  state: GameState,
  player: PlayerId,
  targets: string[],
  lookup: (id: string) => Card | undefined,
): number {
  let owed = 0;
  for (const target of targets) {
    const unit = state.units[target] ?? state.gear[target];
    if (!unit || unit.controller === player) continue;
    const card = lookup(state.instances[target]?.cardId ?? '');
    if (card) owed += keywordValue(card, 'Deflect') ?? 0;
  }
  return owed;
}

/**
 * Builds a payment plan for `card`, or explains why the player cannot pay.
 *
 * Power is settled first because it is domain-constrained and therefore the
 * scarcer resource; spending a usable rune on generic Energy before checking
 * Power can strand a cost that was actually payable.
 */
export function planPayment(
  state: GameState,
  player: PlayerId,
  card: Card,
  lookup: (id: string) => Card | undefined,
  options: PlanOptions = {},
): PlanResult {
  const p = state.players[player];
  const surcharge = options.accelerate ? 1 : 0;
  // 809.1.c.1 — Deflect's Power may always be of any Domain, so it is settled
  // separately from the card's own domain-locked Power cost.
  const deflect = deflectSurcharge(state, player, options.targets ?? [], lookup);
  const energyCost = (card.energy ?? 0) + surcharge;
  const powerCost = (card.power ?? 0) + surcharge;

  const plan: PaymentPlan = {
    exhaust: [],
    recycle: [],
    energyFromPool: 0,
    powerFromPool: {},
  };

  // Runes this player controls that are still on the board.
  const owned = Object.values(state.runes).filter((r) => r.controller === player);

  // --- Power ---------------------------------------------------------------
  const wanted: Domain[] = card.domains.filter((d) => d !== 'Colorless');
  const acceptable = (d: Domain) => wanted.length === 0 || wanted.includes(d);

  let powerOwed = powerCost;

  // Spend matching Power already in the pool before touching the board.
  for (const [domain, held] of Object.entries(p.power) as [Domain, number][]) {
    if (powerOwed <= 0) break;
    if (!acceptable(domain) || held <= 0) continue;
    const take = Math.min(held, powerOwed);
    plan.powerFromPool[domain] = take;
    powerOwed -= take;
  }

  // Then recycle runes of an acceptable domain.
  const recyclable = owned.filter((r) => acceptable(domainOf(state, r.uid, lookup)));
  for (const rune of recyclable) {
    if (powerOwed <= 0) break;
    plan.recycle.push(rune.uid);
    powerOwed -= 1;
  }

  if (powerOwed > 0) {
    const label = wanted.length > 0 ? wanted.join('/') : 'any';
    return {
      ok: false,
      reason: `Not enough ${label} Power — short by ${powerOwed}.`,
      rule: '163.2',
    };
  }

  // --- Deflect (809) -------------------------------------------------------
  // Any Domain will do here, so this takes whatever is left rather than
  // competing with the card's own Power cost for a particular domain.
  let deflectOwed = deflect;
  for (const [domain, held] of Object.entries(p.power) as [Domain, number][]) {
    if (deflectOwed <= 0) break;
    const spent = plan.powerFromPool[domain] ?? 0;
    const free = (held ?? 0) - spent;
    if (free <= 0) continue;
    const take = Math.min(free, deflectOwed);
    plan.powerFromPool[domain] = spent + take;
    deflectOwed -= take;
  }
  for (const rune of owned) {
    if (deflectOwed <= 0) break;
    if (plan.recycle.includes(rune.uid)) continue;
    plan.recycle.push(rune.uid);
    deflectOwed -= 1;
  }
  if (deflectOwed > 0) {
    return {
      ok: false,
      reason: `Deflect needs ${deflect} more Power — short by ${deflectOwed}.`,
      rule: '809.1.c',
    };
  }

  // --- Energy --------------------------------------------------------------
  let energyOwed = energyCost;

  const fromPool = Math.min(p.energy, energyOwed);
  plan.energyFromPool = fromPool;
  energyOwed -= fromPool;

  // Any ready rune can be exhausted for Energy, except ones this plan already
  // recycles — a rune cannot be spent twice.
  const spent = new Set(plan.recycle);
  for (const rune of owned) {
    if (energyOwed <= 0) break;
    if (!rune.ready || spent.has(rune.uid)) continue;
    plan.exhaust.push(rune.uid);
    energyOwed -= 1;
  }

  if (energyOwed > 0) {
    return {
      ok: false,
      reason: `Not enough Energy — short by ${energyOwed}.`,
      rule: '201',
    };
  }

  return { ok: true, plan };
}

/** True if the player could pay for this card right now. */
export function canAfford(
  state: GameState,
  player: PlayerId,
  card: Card,
  lookup: (id: string) => Card | undefined,
  options: PlanOptions = {},
): boolean {
  return planPayment(state, player, card, lookup, options).ok;
}
