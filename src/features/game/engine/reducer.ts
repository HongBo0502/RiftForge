import type { Card, Domain } from '@/types';
import { closeShowdown, openShowdown, type CardLookup } from './combat';
import { hasKeyword, unautomatedText } from './keywords';
import { type PaymentPlan, planPayment } from './payment';
import { checkVictory, drawCard, score } from './scoring';
import type {
  ActionResult,
  GameAction,
  GameState,
  Location,
  PlayerId,
  Rejection,
} from './types';
import { OPPONENT, sameLocation } from './types';

/**
 * The rules engine: a pure `(state, action) => state` reducer.
 *
 * Every rejection carries a reason and, where one applies, the Core Rules
 * reference — an illegal action should teach, not just fail.
 */

const reject = (reason: string, rule?: string): Rejection => ({ ok: false, reason, rule });

/** Runes channelled each Channel Phase. 315.3.b */
const RUNES_PER_CHANNEL = 2;

function clone(state: GameState): GameState {
  return structuredClone(state);
}

function log(state: GameState, player: PlayerId | null, text: string, rule?: string): void {
  state.log.push({ turn: state.turn, phase: state.phase, player, text, rule });
}

const cardOf = (state: GameState, uid: string, lookup: CardLookup): Card | undefined =>
  lookup(state.instances[uid]?.cardId ?? '');

function unitsAt(state: GameState, index: number, player?: PlayerId) {
  return Object.values(state.units).filter(
    (u) =>
      u.location.kind === 'battlefield' &&
      u.location.index === index &&
      (player === undefined || u.controller === player),
  );
}

// ---------------------------------------------------------------------------
// Costs
// ---------------------------------------------------------------------------

/**
 * Spends a payment plan: takes what it can from the Rune Pool, exhausts runes
 * for Energy, and recycles runes for Power. 163, 201
 *
 * A recycled rune leaves the board and returns to the Rune Deck (161.2.b), so
 * this is not reversible by simply readying it again.
 */
function spendPlan(state: GameState, player: PlayerId, plan: PaymentPlan, lookup: CardLookup): void {
  const p = state.players[player];

  p.energy -= plan.energyFromPool;
  for (const [domain, amount] of Object.entries(plan.powerFromPool) as [Domain, number][]) {
    p.power[domain] = (p.power[domain] ?? 0) - amount;
  }

  for (const uid of plan.exhaust) {
    const rune = state.runes[uid];
    if (rune) rune.ready = false;
  }

  for (const uid of plan.recycle) {
    const domain = (cardOf(state, uid, lookup)?.domains.find((d) => d !== 'Colorless') ??
      'Colorless') as Domain;
    delete state.runes[uid];
    p.runeDeck.push(uid);
    void domain;
  }
}

// ---------------------------------------------------------------------------
// Phases
// ---------------------------------------------------------------------------

/** Empties every player's Rune Pool. 167 */
function emptyRunePools(state: GameState): void {
  for (const id of ['p1', 'p2'] as PlayerId[]) {
    state.players[id].energy = 0;
    state.players[id].power = {};
  }
}

/** Runs the effects of the phase the state is currently in. */
function applyPhase(state: GameState): void {
  const player = state.turnPlayer;

  switch (state.phase) {
    case 'awaken': {
      // 315.1 — the Turn Player readies everything they control.
      for (const unit of Object.values(state.units)) {
        if (unit.controller === player) {
          unit.ready = true;
          unit.movesThisTurn = 0;
        }
      }
      for (const rune of Object.values(state.runes)) {
        if (rune.controller === player) rune.ready = true;
      }
      break;
    }

    case 'beginning': {
      // 315.2.b — the Turn Player Holds every battlefield they control.
      state.battlefields.forEach((bf, index) => {
        if (bf.controller === player) score(state, player, index, 'hold');
      });
      checkVictory(state);
      break;
    }

    case 'channel': {
      // 315.3.b — channel 2, or as many as remain.
      // 485.7 — the player going second channels an extra rune on their first turn.
      const extra = player !== state.firstPlayer && state.turn <= 2 ? 1 : 0;
      const want = RUNES_PER_CHANNEL + extra;
      const p = state.players[player];
      const channelled = Math.min(want, p.runeDeck.length);

      for (let i = 0; i < channelled; i++) {
        const uid = p.runeDeck.shift();
        if (!uid) break;
        state.runes[uid] = { uid, controller: player, ready: true };
      }
      log(
        state,
        player,
        `Channelled ${channelled} rune${channelled === 1 ? '' : 's'}${extra ? ' (extra for going second)' : ''}.`,
        extra ? '485.7' : '315.3.b',
      );
      break;
    }

    case 'draw': {
      drawCard(state, player);
      checkVictory(state);
      break;
    }

    case 'main': {
      // 316.3 — every rune pool empties as the Main Phase opens.
      emptyRunePools(state);
      break;
    }

    case 'ending': {
      // 317.2 — heal all units, expire "this turn" effects, empty pools.
      for (const unit of Object.values(state.units)) {
        unit.damage = 0;
        unit.mightBonus = 0;
        unit.designation = null;
      }
      emptyRunePools(state);
      break;
    }
  }
}

/** Moves to the next phase, or to the next player's turn after Ending. */
function advance(state: GameState): void {
  const order: GameState['phase'][] = [
    'awaken',
    'beginning',
    'channel',
    'draw',
    'main',
    'ending',
  ];
  const next = order[order.indexOf(state.phase) + 1];

  if (!next) {
    // 317.3 — the next player becomes the Turn Player.
    state.turnPlayer = OPPONENT[state.turnPlayer];
    state.turn += 1;
    state.phase = 'awaken';
    for (const bf of state.battlefields) bf.scoredBy = [];
  } else {
    state.phase = next;
  }
  applyPhase(state);
  checkVictory(state);
}

/** Runs the automatic start-of-turn phases and stops at the Main Phase. */
export function advanceToMain(state: GameState): GameState {
  const draft = clone(state);
  let guard = 0;
  while (draft.phase !== 'main' && !draft.winner && guard++ < 20) {
    advance(draft);
  }
  return draft;
}

/** Applies the current phase's effects without advancing — used at game start. */
export function startGame(state: GameState): GameState {
  const draft = clone(state);
  applyPhase(draft);
  let guard = 0;
  while (draft.phase !== 'main' && !draft.winner && guard++ < 20) {
    advance(draft);
  }
  return draft;
}

// ---------------------------------------------------------------------------
// Movement
// ---------------------------------------------------------------------------

/** Whether a Standard Move from `from` to `to` is legal. 144.4 */
function moveIsLegal(
  state: GameState,
  uid: string,
  to: Location,
  lookup: CardLookup,
): Rejection | null {
  const unit = state.units[uid];
  const from = unit.location;
  const card = cardOf(state, uid, lookup);

  if (sameLocation(from, to)) return reject('That unit is already there.');

  if (to.kind === 'base') {
    if (to.player !== unit.controller) return reject('Units only return to their own base.', '144.4.b');
    return null;
  }

  if (from.kind === 'base') return null; // base -> battlefield. 144.4.a

  // battlefield -> battlefield requires Ganking. 144.4.c
  if (!card || !hasKeyword(card, 'Ganking')) {
    return reject('Only units with Ganking move between battlefields.', '144.4.c');
  }
  return null;
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export function reduce(state: GameState, action: GameAction, lookup: CardLookup): ActionResult {
  if (state.winner && action.type !== 'CONCEDE') {
    return reject('The game is over.');
  }

  const player = state.turnPlayer;
  const draft = clone(state);

  switch (action.type) {
    // -----------------------------------------------------------------
    case 'ADVANCE_PHASE': {
      if (draft.showdown) return reject('Resolve the showdown first.', '343.1');
      advance(draft);
      return { ok: true, state: draft };
    }

    // -----------------------------------------------------------------
    case 'EXHAUST_RUNE': {
      const rune = draft.runes[action.uid];
      if (!rune) return reject('No such rune.');
      if (rune.controller !== player) return reject('That rune is not yours.');
      if (!rune.ready) return reject('That rune is already exhausted.');

      rune.ready = false;
      draft.players[player].energy += 1;
      log(draft, player, 'Exhausted a rune for 1 Energy.', '164.2.a');
      return { ok: true, state: draft };
    }

    // -----------------------------------------------------------------
    case 'RECYCLE_RUNE': {
      const rune = draft.runes[action.uid];
      if (!rune) return reject('No such rune.');
      if (rune.controller !== player) return reject('That rune is not yours.');

      const card = cardOf(draft, action.uid, lookup);
      const domain = (card?.domains.find((d) => d !== 'Colorless') ?? 'Colorless') as Domain;

      // 161.2.b — a recycled rune returns to the Rune Deck, not the trash.
      delete draft.runes[action.uid];
      draft.players[player].runeDeck.push(action.uid);
      draft.players[player].power[domain] = (draft.players[player].power[domain] ?? 0) + 1;
      log(draft, player, `Recycled a rune for 1 ${domain} Power.`, '164.2.b');
      return { ok: true, state: draft };
    }

    // -----------------------------------------------------------------
    case 'PLAY_CARD': {
      const p = draft.players[player];
      const fromChampionZone = p.championZone === action.uid;
      const inHand = p.hand.includes(action.uid);
      const facedown = draft.hidden[action.uid];
      const fromHidden = Boolean(facedown && facedown.controller === player);
      if (!inHand && !fromChampionZone && !fromHidden) {
        return reject('That card is not available to play.');
      }

      const card = cardOf(draft, action.uid, lookup);
      if (!card) return reject('Unknown card.');

      // 811.1.b — a facedown card gains Reaction only from the turn after it
      // was hidden, so it cannot be hidden and used in the same turn.
      if (fromHidden && draft.turn <= facedown.hiddenOnTurn) {
        return reject('A hidden card can only be played from your next turn.', '811.1.b');
      }

      // 813 — Reaction lets a card be played in a showdown; a facedown card has
      // it while facedown.
      const reactive = fromHidden || hasKeyword(card, 'Reaction') || hasKeyword(card, 'Action');
      if (draft.phase !== 'main' && !reactive) {
        return reject('Cards are played in the Main Phase.', '316.5');
      }
      if (draft.showdown && !reactive) {
        return reject('Only Action or Reaction cards can be played in a showdown.', '343.1.a');
      }

      // 811.1.b — playing from Hidden ignores the card's base cost.
      if (!fromHidden) {
        // Auto-pay: work out which runes cover the cost, then spend them.
        // action.payment lets the UI override the choice of runes.
        const planned = action.payment
          ? ({ ok: true, plan: action.payment } as const)
          : planPayment(draft, player, card, lookup);
        if (!planned.ok) return reject(planned.reason, planned.rule);
        spendPlan(draft, player, planned.plan, lookup);
      }

      // Remove from its origin zone.
      if (inHand) p.hand = p.hand.filter((u) => u !== action.uid);
      else if (fromChampionZone) p.championZone = null;
      else delete draft.hidden[action.uid];

      /*
       * 811.1.d.1 — a hidden permanent must be played to the battlefield it was
       * hidden at, and that overrides Gear's normal base-only restriction.
       */
      const forced: Location | undefined = fromHidden
        ? { kind: 'battlefield', index: facedown.battlefield }
        : undefined;

      if (card.type === 'Unit') {
        // Units enter at their controller's base unless played to a
        // battlefield they already hold.
        let destination: Location = forced ?? { kind: 'base', player };
        if (!forced && action.to?.kind === 'battlefield') {
          const bf = draft.battlefields[action.to.index];
          if (!bf) return reject('No such battlefield.');
          if (bf.controller !== player) {
            return reject('Units can only be played to a battlefield you control.');
          }
          destination = action.to;
        }

        draft.units[action.uid] = {
          uid: action.uid,
          controller: player,
          location: destination,
          ready: true,
          damage: 0,
          mightBonus: 0,
          designation: null,
          enteredOnTurn: draft.turn,
          movesThisTurn: 0,
        };
        log(draft, player, `Played ${card.baseName}${fromHidden ? ' from hidden' : ''}.`);
      } else if (card.type === 'Gear') {
        // 147-149 — Gear are permanents. They enter ready, at their
        // controller's Base unless an effect says otherwise (149.2).
        draft.gear[action.uid] = {
          uid: action.uid,
          controller: player,
          location: forced ?? { kind: 'base', player },
          ready: true,
          attachedTo: null,
        };
        log(draft, player, `Played ${card.baseName}${fromHidden ? ' from hidden' : ''}.`);
      } else {
        // Spells resolve and go to the trash. Their text is not automated, so
        // surface it rather than pretending it resolved.
        p.trash.push(action.uid);
        log(draft, player, `Played ${card.baseName}${fromHidden ? ' from hidden' : ''}.`);
      }

      const manual = unautomatedText(card);
      if (manual) {
        draft.unautomated.push(`${card.baseName}: ${manual.replace(/\n/g, ' ')}`);
        log(draft, player, `${card.baseName}'s text is not automated — apply it by hand.`);
      }

      checkVictory(draft);
      return { ok: true, state: draft };
    }

    // -----------------------------------------------------------------
    case 'HIDE_CARD': {
      const p = draft.players[player];
      const inHand = p.hand.includes(action.uid);
      const fromChampionZone = p.championZone === action.uid;
      if (!inHand && !fromChampionZone) return reject('That card is not in your hand.');

      const card = cardOf(draft, action.uid, lookup);
      if (!card) return reject('Unknown card.');

      // 811.1 — Hidden is the prerequisite for the Hide action.
      if (!hasKeyword(card, 'Hidden')) {
        return reject(`${card.baseName} does not have Hidden.`, '811.1');
      }
      if (draft.phase !== 'main') return reject('Hide during your Main Phase.', '811.1.b');
      if (draft.showdown) return reject('Hide only in an Open State.', '811.1.b');

      const bf = draft.battlefields[action.battlefield];
      if (!bf) return reject('No such battlefield.');
      // 811.1.b — a battlefield you control, with no facedown card already there.
      if (bf.controller !== player) {
        return reject('Hide only at a battlefield you control.', '811.1.b');
      }
      if (Object.values(draft.hidden).some((h) => h.battlefield === action.battlefield)) {
        return reject('A card is already hidden there.', '811.1.b');
      }

      // Cost is [A]: 1 Power of any domain. Spend the pool first, else recycle.
      const held = (Object.entries(p.power) as [Domain, number][]).find(([, n]) => (n ?? 0) > 0);
      if (held) {
        p.power[held[0]] = (p.power[held[0]] ?? 0) - 1;
      } else {
        const rune = Object.values(draft.runes).find((r) => r.controller === player);
        if (!rune) return reject('Hiding costs 1 Power of any domain.', '811.1.b');
        delete draft.runes[rune.uid];
        p.runeDeck.push(rune.uid);
      }

      if (inHand) p.hand = p.hand.filter((u) => u !== action.uid);
      else p.championZone = null;

      draft.hidden[action.uid] = {
        uid: action.uid,
        controller: player,
        battlefield: action.battlefield,
        // Reaction is gained from the *next* turn, so record this one. 811.1.b
        hiddenOnTurn: draft.turn,
      };
      log(draft, player, `Hid a card at battlefield ${action.battlefield + 1}.`, '811.1.b');
      return { ok: true, state: draft };
    }

    // -----------------------------------------------------------------
    case 'EQUIP_GEAR': {
      const gear = draft.gear[action.uid];
      if (!gear) return reject('No such gear.');
      if (gear.controller !== player) return reject('That gear is not yours.');
      if (gear.attachedTo) return reject('That gear is already attached.');
      if (draft.phase !== 'main') return reject('Equip during your Main Phase.', '151.2');
      if (draft.showdown) return reject('Equip only in an Open State.', '151.2');

      const unit = draft.units[action.unitUid];
      if (!unit) return reject('No such unit.');
      if (unit.controller !== player) return reject('Attach only to a unit you control.', '818');

      const card = cardOf(draft, action.uid, lookup);
      if (!card) return reject('Unknown card.');
      if (!hasKeyword(card, 'Equip')) {
        return reject(`${card.baseName} has no Equip ability.`, '818');
      }

      // Equip costs 1 Power of the gear's own domain.
      const domain = (card.domains.find((d) => d !== 'Colorless') ?? 'Colorless') as Domain;
      const p = draft.players[player];
      if ((p.power[domain] ?? 0) > 0) {
        p.power[domain] = (p.power[domain] ?? 0) - 1;
      } else {
        const rune = Object.values(draft.runes).find(
          (r) => r.controller === player && cardOf(draft, r.uid, lookup)?.domains[0] === domain,
        );
        if (!rune) return reject(`Equip costs 1 ${domain} Power.`, '818');
        delete draft.runes[rune.uid];
        p.runeDeck.push(rune.uid);
      }

      // 152.2 — attached gear follows its unit's location.
      gear.attachedTo = unit.uid;
      gear.location = unit.location;
      log(draft, player, `Equipped ${card.baseName}.`, '818');
      return { ok: true, state: draft };
    }

    // -----------------------------------------------------------------
    case 'MOVE_UNIT': {
      const unit = draft.units[action.uid];
      if (!unit) return reject('No such unit.');
      if (unit.controller !== player) return reject('That unit is not yours.');
      if (draft.phase !== 'main') return reject('Units move during your Main Phase.', '144.1.a');
      if (draft.showdown) return reject('Units cannot move during a showdown.', '144.1.c');
      if (!unit.ready) return reject('That unit is exhausted.', '144.2');

      const illegal = moveIsLegal(draft, action.uid, action.to, lookup);
      if (illegal) return illegal;

      const card = cardOf(draft, action.uid, lookup);
      // 144.2 — exhausting the unit is the cost of a Standard Move.
      unit.ready = false;
      unit.movesThisTurn += 1;
      unit.location = action.to;
      // 152.2 — attached gear is located wherever its unit is.
      for (const gear of Object.values(draft.gear)) {
        if (gear.attachedTo === unit.uid) gear.location = action.to;
      }
      log(draft, player, `Moved ${card?.baseName ?? 'a unit'}.`, '144');

      if (action.to.kind === 'battlefield') {
        const index = action.to.index;
        const bf = draft.battlefields[index];
        const enemies = unitsAt(draft, index, OPPONENT[player]);

        if (enemies.length > 0) {
          // 344.1 — contested by two players, so combat opens with a showdown.
          openShowdown(draft, index, player);
          log(draft, player, `Contested battlefield ${index + 1}.`, '344');
        } else if (bf.controller !== player) {
          // 348.2 — moving onto an uncontested battlefield opens a
          // non-combat showdown, which establishes control when it closes.
          openShowdown(draft, index, player);
        }
      }

      checkVictory(draft);
      return { ok: true, state: draft };
    }

    // -----------------------------------------------------------------
    case 'SHOWDOWN_PASS': {
      const showdown = draft.showdown;
      if (!showdown) return reject('No showdown is open.');

      showdown.passes += 1;
      // 347.2.a — the showdown ends once every player has passed in sequence.
      if (showdown.passes >= 2) {
        closeShowdown(draft, lookup);
      } else {
        showdown.focus = OPPONENT[showdown.focus];
      }
      return { ok: true, state: draft };
    }

    // -----------------------------------------------------------------
    case 'END_TURN': {
      if (draft.showdown) return reject('Resolve the showdown first.', '343.1');
      if (draft.phase !== 'main') return reject('You can only end your turn from the Main Phase.');

      // advance() runs the Ending Phase, then rolls over to the next
      // player's Awaken and on through their start-of-turn phases.
      let guard = 0;
      do {
        advance(draft);
      } while (draft.phase !== 'main' && !draft.winner && guard++ < 20);
      return { ok: true, state: draft };
    }

    // -----------------------------------------------------------------
    case 'CONCEDE': {
      // 651.1 — with one opponent left, that opponent wins.
      draft.winner = OPPONENT[action.player];
      log(draft, action.player, 'Conceded.', '651');
      return { ok: true, state: draft };
    }
  }
}
