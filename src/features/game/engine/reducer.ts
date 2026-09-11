import type { Card, Domain } from '@/types';
import {
  activePlayer,
  checkTiming,
  passPriority,
  pushChainItem,
  spellItem,
} from './chain';
import { cleanup, expireTemporary } from './cleanup';
import { shuffle } from './rng';
import { closeShowdown, openShowdown, type CardLookup } from './combat';
import { dependencyContext, hasKeyword, unautomatedText } from './keywords';
import { type PaymentPlan, planPayment } from './payment';
import { checkVictory, drawCard, score } from './scoring';
import { expireStatuses } from './statuses';
import type {
  ActionResult,
  Phase,
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
function applyPhase(state: GameState, lookup: CardLookup): void {
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
      /*
       * Temporary permanents die here, *before* the scoring step, so one
       * cannot bank a Hold point on the turn it expires.
       */
      expireTemporary(state, player, lookup);
      cleanup(state);

      // 315.2.b — the Turn Player Holds every battlefield they control.
      state.battlefields.forEach((bf, index) => {
        if (bf.controller === player) score(state, player, index, 'hold', lookup);
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
      // 317.2.b step 3c — heal all units.
      for (const unit of Object.values(state.units)) {
        unit.damage = 0;
        unit.mightBonus = 0;
        unit.designation = null;
      }
      /*
       * 317.2.c step 3d — all "this turn" effects expire, which 423.1.a.2 says
       * includes Stun. Buffs are counters and survive (705); Empowered is only
       * removed by Disempower (442).
       */
      expireStatuses(state);
      // 317.2.d step 3e.
      emptyRunePools(state);
      break;
    }
  }
}

/** Moves to the next phase, or to the next player's turn after Ending. */
function advance(state: GameState, lookup: CardLookup): void {
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
    // 812.1.c — Legion asks about *this* turn, so the record starts empty.
    for (const id of ['p1', 'p2'] as PlayerId[]) state.players[id].finalizedThisTurn = [];
  } else {
    state.phase = next;
  }
  applyPhase(state, lookup);
  cleanup(state);
  checkVictory(state);
}

/** Runs the automatic start-of-turn phases and stops at the Main Phase. */
export function advanceToMain(state: GameState, lookup: CardLookup): GameState {
  const draft = clone(state);
  let guard = 0;
  while (draft.phase !== 'main' && !draft.winner && guard++ < 20) {
    advance(draft, lookup);
  }
  return draft;
}

/** Applies the current phase's effects without advancing — used at game start. */
export interface StartOptions {
  /**
   * Open in the mulligan phase (117) instead of going straight to turn one.
   * Off by default so a caller that does not care — most tests — gets a game
   * that is ready to play.
   */
  mulligan?: boolean;
}

export function startGame(
  state: GameState,
  lookup: CardLookup,
  options: StartOptions = {},
): GameState {
  const draft = clone(state);

  if (options.mulligan) {
    // 117 — resolved in turn order, starting with the first player.
    draft.phase = 'mulligan';
    draft.pendingMulligan = [draft.firstPlayer, OPPONENT[draft.firstPlayer]];
    return draft;
  }

  applyPhase(draft, lookup);
  let guard = 0;
  while (draft.phase !== 'main' && !draft.winner && guard++ < 20) {
    advance(draft, lookup);
  }
  return draft;
}

/**
 * Sets the phase without narrowing it.
 *
 * Assigning a literal directly makes TypeScript narrow `state.phase` to that
 * literal for the rest of the block, which then reports the loop below as
 * comparing two types that cannot overlap.
 */
function setPhase(state: GameState, phase: Phase): void {
  state.phase = phase;
}

/** Runs the opening phases once the pre-game is finished. */
function beginFirstTurn(draft: GameState, lookup: CardLookup): void {
  setPhase(draft, 'awaken');
  applyPhase(draft, lookup);
  let guard = 0;
  while (draft.phase !== 'main' && !draft.winner && guard++ < 20) {
    advance(draft, lookup);
  }
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

/**
 * What is still legal while a chain is up. 331.1
 *
 * Reactions can be played, and rune abilities are themselves Reactions
 * (164.2.a), which is what lets a player fund the answer they are about to
 * play. Everything else waits for the chain to resolve.
 */
const CHAIN_SAFE = new Set<GameAction['type']>([
  'PLAY_CARD',
  'PASS_PRIORITY',
  'EXHAUST_RUNE',
  'RECYCLE_RUNE',
  'CONCEDE',
]);

export function reduce(state: GameState, action: GameAction, lookup: CardLookup): ActionResult {
  if (state.winner && action.type !== 'CONCEDE') {
    return reject('The game is over.');
  }

  const player = state.turnPlayer;
  /** Whoever holds priority or focus. Only the same as `player` in an Open State. */
  const actor = activePlayer(state);
  const draft = clone(state);

  if (state.phase === 'mulligan' && action.type !== 'MULLIGAN' && action.type !== 'CONCEDE') {
    return reject('Finish the mulligan first.', '117');
  }

  // 331.1.a — a chain closes the turn. Nothing touches the board until it goes.
  if (state.chain.length > 0 && !CHAIN_SAFE.has(action.type)) {
    return reject('Resolve the chain first.', '331.1');
  }

  switch (action.type) {
    // -----------------------------------------------------------------
    case 'ADVANCE_PHASE': {
      if (draft.showdown) return reject('Resolve the showdown first.', '343.1');
      advance(draft, lookup);
      return { ok: true, state: draft };
    }

    // -----------------------------------------------------------------
    case 'MULLIGAN': {
      if (draft.phase !== 'mulligan') return reject('The mulligan is over.', '117');

      // 117 — resolved in turn order, so only the player at the front acts.
      const who = draft.pendingMulligan[0];
      if (!who) return reject('Nobody owes a mulligan.', '117');

      const p = draft.players[who];
      const swap = action.swap ?? [];

      // 117.1 — up to two cards.
      if (swap.length > 2) return reject('You may set aside at most two cards.', '117.1');
      if (new Set(swap).size !== swap.length) return reject('Each card can be set aside once.');
      for (const uid of swap) {
        if (!p.hand.includes(uid)) return reject('That card is not in your hand.');
      }

      p.hand = p.hand.filter((uid) => !swap.includes(uid));

      // 117.2 — draw as many as were set aside, before recycling them, so a
      // set-aside card cannot be drawn straight back.
      for (let i = 0; i < swap.length; i++) {
        const drawn = p.mainDeck.shift();
        if (drawn) p.hand.push(drawn);
      }

      /*
       * 117.3 / 416.5 — recycled to the bottom of the Main Deck, and two or
       * more simultaneously go in random order.
       *
       * This must use the seeded RNG. Online play rebuilds both clients from
       * one seed and relays actions, so an unseeded shuffle here would give the
       * two players different decks with nothing to signal it.
       */
      if (swap.length > 1) {
        const shuffled = shuffle(swap, draft.rng);
        draft.rng = shuffled.seed;
        p.mainDeck.push(...shuffled.items);
      } else {
        p.mainDeck.push(...swap);
      }

      log(
        draft,
        who,
        swap.length === 0
          ? 'Kept their opening hand.'
          : `Mulliganed ${swap.length} card${swap.length === 1 ? '' : 's'}.`,
        '117',
      );

      draft.pendingMulligan = draft.pendingMulligan.slice(1);
      if (draft.pendingMulligan.length === 0) beginFirstTurn(draft, lookup);
      return { ok: true, state: draft };
    }

    // -----------------------------------------------------------------
    case 'EXHAUST_RUNE': {
      const rune = draft.runes[action.uid];
      if (!rune) return reject('No such rune.');
      // 164.2.a — a rune's ability has Reaction, so its controller can use it
      // whenever they hold priority, not only on their own turn.
      if (rune.controller !== actor) return reject('That rune is not yours.');
      if (!rune.ready) return reject('That rune is already exhausted.');

      rune.ready = false;
      draft.players[actor].energy += 1;
      log(draft, actor, 'Exhausted a rune for 1 Energy.', '164.2.a');
      return { ok: true, state: draft };
    }

    // -----------------------------------------------------------------
    case 'PASS_PRIORITY': {
      // 339.1 — two passes in sequence and the newest item resolves.
      if (draft.chain.length === 0) return reject('Nothing is on the chain.', '331.2');
      passPriority(draft, lookup);
      cleanup(draft);
      checkVictory(draft);
      return { ok: true, state: draft };
    }

    // -----------------------------------------------------------------
    case 'RECYCLE_RUNE': {
      const rune = draft.runes[action.uid];
      if (!rune) return reject('No such rune.');
      if (rune.controller !== actor) return reject('That rune is not yours.');

      const card = cardOf(draft, action.uid, lookup);
      const domain = (card?.domains.find((d) => d !== 'Colorless') ?? 'Colorless') as Domain;

      // 161.2.b — a recycled rune returns to the Rune Deck, not the trash.
      delete draft.runes[action.uid];
      draft.players[actor].runeDeck.push(action.uid);
      draft.players[actor].power[domain] = (draft.players[actor].power[domain] ?? 0) + 1;
      log(draft, actor, `Recycled a rune for 1 ${domain} Power.`, '164.2.b');
      return { ok: true, state: draft };
    }

    // -----------------------------------------------------------------
    case 'PLAY_CARD': {
      const p = draft.players[actor];
      const fromChampionZone = p.championZone === action.uid;
      const inHand = p.hand.includes(action.uid);
      const facedown = draft.hidden[action.uid];
      const fromHidden = Boolean(facedown && facedown.controller === actor);
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

      /*
       * Ambush (822.1.b) — a unit with it may be played to a battlefield where
       * its controller already has units, whoever controls the battlefield, and
       * it has Reaction while doing exactly that. Both halves hang off the same
       * check, so work it out before the timing gate.
       */
      const ambushTarget = action.to?.kind === 'battlefield' ? action.to.index : null;
      const ambushing =
        !fromHidden &&
        card.type === 'Unit' &&
        hasKeyword(card, 'Ambush') &&
        ambushTarget !== null &&
        unitsAt(draft, ambushTarget, actor).length > 0;

      // 358.4 — Main Phase in an Open State allows anything; a showdown allows
      // Action and Reaction; a live chain allows Reaction alone.
      const mistimed = checkTiming(draft, card, fromHidden, ambushing);
      if (mistimed) return mistimed;

      // 805.1 — Accelerate is an additional cost, and only means anything on a
      // unit that actually has the keyword.
      const accelerated =
        Boolean(action.accelerate) && card.type === 'Unit' && hasKeyword(card, 'Accelerate');
      if (action.accelerate && !accelerated) {
        return reject(`${card.baseName} does not have Accelerate.`, '805.1');
      }

      // 811.1.b — playing from Hidden ignores the card's base cost.
      if (!fromHidden) {
        // Auto-pay: work out which runes cover the cost, then spend them.
        // action.payment lets the UI override the choice of runes.
        const planned = action.payment
          ? ({ ok: true, plan: action.payment } as const)
          : planPayment(draft, actor, card, lookup, {
              accelerate: accelerated,
              // 809 — an opponent's Deflect makes choosing it cost more.
              targets: action.targets,
            });
        if (!planned.ok) return reject(planned.reason, planned.rule);
        spendPlan(draft, actor, planned.plan, lookup);
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
        let destination: Location = forced ?? { kind: 'base', player: actor };
        if (!forced && action.to?.kind === 'battlefield') {
          const bf = draft.battlefields[action.to.index];
          if (!bf) return reject('No such battlefield.');
          // 822.1.b — Ambush adds "where you control units" to the usual
          // "a battlefield you control".
          if (bf.controller !== actor && !ambushing) {
            return reject(
              'Units are played to a battlefield you control, or with Ambush to one where you have units.',
              '822.1.b',
            );
          }
          destination = action.to;
        }

        draft.units[action.uid] = {
          uid: action.uid,
          controller: actor,
          location: destination,
          /*
           * 178.1.a.1 — a unit enters exhausted. It therefore cannot take a
           * Standard Move on the turn it lands, which is what stops a freshly
           * played unit conquering immediately. Accelerate (805.1) is the
           * intended way around it, and pays for the privilege.
           */
          ready: accelerated,
          damage: 0,
          mightBonus: 0,
          buffs: 0,
          stunned: false,
          empowered: false,
          designation: null,
          enteredOnTurn: draft.turn,
          movesThisTurn: 0,
        };
        log(draft, actor, `Played ${card.baseName}${fromHidden ? ' from hidden' : ''}.`);
      } else if (card.type === 'Gear') {
        // 147-149 — Gear are permanents. They enter ready, at their
        // controller's Base unless an effect says otherwise (149.2).
        draft.gear[action.uid] = {
          uid: action.uid,
          controller: actor,
          location: forced ?? { kind: 'base', player: actor },
          ready: true,
          attachedTo: null,
        };
        log(draft, actor, `Played ${card.baseName}${fromHidden ? ' from hidden' : ''}.`);
      } else {
        /*
         * 359.3.a — a spell does not resolve on being played. It lingers on the
         * chain as a Finalized Item, both players get a window to answer it,
         * and only then does it resolve and go to the trash.
         */
        pushChainItem(draft, spellItem(action.uid, actor, card, action.targets ?? []));
        log(
          draft,
          actor,
          `Played ${card.baseName}${fromHidden ? ' from hidden' : ''} onto the chain.`,
          '359.3.a',
        );
      }

      /*
       * A permanent executes its rules text as it is finalized (359.2.b), so
       * anything the engine cannot do is surfaced now. A spell's text does not
       * apply until it resolves, so that is flagged in resolveChain instead.
       */
      // 329.3 — the card is finalized now, which is what Legion counts. 812.1.c
      p.finalizedThisTurn.push(action.uid);

      if (card.type === 'Unit' || card.type === 'Gear') {
        const manual = unautomatedText(card, dependencyContext(draft, actor, action.uid));
        if (manual) {
          draft.unautomated.push(`${card.baseName}: ${manual.replace(/\n/g, ' ')}`);
          log(draft, actor, `${card.baseName}'s text is not automated — apply it by hand.`);
        }
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

      cleanup(draft);
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
        cleanup(draft);
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
        advance(draft, lookup);
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
