import type { Card } from '@/types';
import { dependencyContext, hasKeyword, unautomatedText } from './keywords';
import type { ChainItem, ChainInstruction, GameState, PlayerId, Rejection } from './types';
import { OPPONENT } from './types';

/**
 * The Chain. 327-340
 *
 * Everything about response timing hangs off one idea: playing a spell does not
 * resolve it. The spell goes on the Chain, both players get a window to answer
 * it, and only then does the newest item resolve. That is what makes Action,
 * Reaction, Ambush, Deflect and Quick-Draw mean anything at all.
 *
 * The rules call the loop FEPR — Finalize, Execute, Pass, Resolve (334). This
 * module implements the Pass and Resolve halves plus the timing gate; the
 * Finalize half (paying costs, checking legality) lives in the reducer's
 * PLAY_CARD, where costs are already handled.
 *
 * Units and Gear never linger here. 337.2 resolves them the moment they are
 * finalized, so the reducer puts them straight on the board.
 */

type CardLookup = (cardId: string) => Card | undefined;

const reject = (reason: string, rule?: string): Rejection => ({ ok: false, reason, rule });

function log(state: GameState, player: PlayerId | null, text: string, rule?: string): void {
  state.log.push({ turn: state.turn, phase: state.phase, player, text, rule });
}

/** 331.1 — a Chain exists, so the turn is in a Closed State. */
export function isClosedState(state: GameState): boolean {
  return state.chain.length > 0;
}

/**
 * Who may act right now. 335
 *
 * With a Chain up it is the priority holder (340.4); in a showdown it is the
 * player with Focus (335.1); otherwise the Turn Player. Before this existed the
 * reducer assumed the Turn Player throughout, which meant a defender could
 * never play a Reaction to the attack aimed at them.
 */
export function activePlayer(state: GameState): PlayerId {
  if (state.chain.length > 0 && state.priority) return state.priority;
  if (state.showdown) return state.showdown.focus;
  return state.turnPlayer;
}

/**
 * The timing gate. 358.4
 *
 * - Closed State (a Chain exists): Reaction only. 331.1.a / 159.2.b.2
 * - Showdown, Chain empty: Action or Reaction. 806.1.b
 * - Open State, Main Phase: anything.
 * - Anywhere else nobody holds priority, so nothing can be played. 335
 *
 * A facedown card has Reaction while it is facedown (811.1.b), which is the
 * whole point of hiding one.
 */
export function checkTiming(
  state: GameState,
  card: Card,
  fromHidden: boolean,
  /** Being played to a battlefield where its controller has units. 822.1.b */
  ambushing = false,
): Rejection | null {
  const reaction =
    fromHidden ||
    hasKeyword(card, 'Reaction') ||
    // 819.1.b — a gear with Quick-Draw has Reaction inherently.
    hasKeyword(card, 'Quick-Draw') ||
    // 822.1.b — Ambush grants Reaction, but only while landing where you
    // already have units. Played anywhere else it is an ordinary unit.
    (ambushing && hasKeyword(card, 'Ambush'));
  const action = reaction || hasKeyword(card, 'Action');

  if (isClosedState(state)) {
    if (!reaction) {
      return reject('Only Reaction cards can be played while the chain is closed.', '331.1.a');
    }
    return null;
  }

  if (state.showdown) {
    if (!action) {
      return reject('Only Action or Reaction cards can be played in a showdown.', '806.1.b');
    }
    return null;
  }

  if (state.phase !== 'main') return reject('Cards are played in the Main Phase.', '316.5');
  return null;
}

/**
 * Puts a finalized item on the Chain.
 *
 * 340.4 — the controller of the newest item takes priority, so the player who
 * just cast gets the first window. They will normally pass straight away; the
 * rules give it to them because a card can answer its own chain.
 */
export function pushChainItem(state: GameState, item: ChainItem): void {
  state.chain.push(item);
  state.priority = item.controller;
  state.chainPasses = 0;
  // 347.2.a — a showdown only closes on passes in sequence, and this is not one.
  if (state.showdown) state.showdown.passes = 0;
}

/**
 * Whether a chosen target is still legal. 359.3.e.2
 *
 * A target is illegal once it has left the board, and 359.3.e.4 makes that
 * permanent: a unit that leaves and comes back is a new object, not the one
 * that was chosen. Players and battlefields cannot leave, so they always hold.
 */
export function targetIsLegal(state: GameState, target: string): boolean {
  if (target === 'p1' || target === 'p2') return true;
  if (target.startsWith('bf:')) return Boolean(state.battlefields[Number(target.slice(3))]);
  if (state.units[target] || state.gear[target] || state.runes[target]) return true;
  if (state.hidden[target]) return true;
  // 355.9.a.2 — a spell or ability on the chain is itself a legal target.
  return state.chain.some((item) => item.uid === target);
}

export interface Resolution {
  item: ChainItem;
  executed: ChainInstruction[];
  /** Instructions whose every target had gone. 359.3.e.7 */
  fizzled: ChainInstruction[];
}

/**
 * Executes one item's instructions. 359.3.e
 *
 * The rule that catches people out is that a spell resolves *even if all of its
 * targets are gone* (359.3.e.1). Losing a target skips that one instruction and
 * nothing else — "Deal 4 to a unit. Draw 1." still draws when the unit is saved.
 */
function execute(state: GameState, item: ChainItem, card: Card | undefined): Resolution {
  const executed: ChainInstruction[] = [];
  const fizzled: ChainInstruction[] = [];

  for (const instruction of item.instructions) {
    const alive = instruction.targets.filter((t) => targetIsLegal(state, t));

    // 359.3.e.7 — every target invalid, so this instruction does not execute.
    if (instruction.targets.length > 0 && alive.length === 0) {
      fizzled.push(instruction);
      log(
        state,
        item.controller,
        `${card?.baseName ?? 'A spell'}: "${instruction.text}" did nothing — its target was gone.`,
        '359.3.e.7',
      );
      continue;
    }

    // 359.3.e.8 — partial survival still executes, on whatever is left.
    executed.push({ ...instruction, targets: alive });
  }

  return { item, executed, fizzled };
}

/**
 * Resolves the newest item on the Chain. 340.1
 *
 * Returns what happened so the caller can log or test it. Null when the Chain
 * was already empty.
 */
export function resolveTop(state: GameState, lookup: CardLookup): Resolution | null {
  const item = state.chain.pop();
  state.chainPasses = 0;
  if (!item) {
    state.priority = null;
    return null;
  }

  const card = lookup(state.instances[item.uid]?.cardId ?? '');
  const outcome = execute(state, item, card);

  // 359.3.d — the spell goes to its owner's trash once it has resolved.
  if (item.kind === 'spell') {
    const owner = state.instances[item.uid]?.owner;
    if (owner) state.players[owner].trash.push(item.uid);
  }

  /*
   * A spell's text applies now, not when it was played, so this is where the
   * engine admits what it did not do. Nothing is flagged if every instruction
   * fizzled — there was nothing left to apply by hand.
   */
  const manual = card ? unautomatedText(card, dependencyContext(state, item.controller, item.uid)) : null;
  if (manual && outcome.executed.length > 0) {
    state.unautomated.push(`${card?.baseName}: ${manual.replace(/\n/g, ' ')}`);
    log(state, item.controller, `${card?.baseName}'s text is not automated — apply it by hand.`);
  }
  log(state, item.controller, `${card?.baseName ?? item.label ?? 'A chain item'} resolved.`, '340.1');

  if (state.chain.length > 0) {
    // 340.4 — priority returns to the controller of the new newest item.
    state.priority = state.chain[state.chain.length - 1].controller;
  } else {
    // 340.2 — the Chain is gone, so play returns to an Open State.
    state.priority = null;
    /*
     * 340.2.a — and if that happened inside a showdown, Focus moves on. Without
     * this the caster would keep Focus and could simply cast again.
     */
    if (state.showdown && item.kind === 'spell') {
      state.showdown.focus = OPPONENT[state.showdown.focus];
      state.showdown.passes = 0;
    }
  }

  return outcome;
}

/**
 * The player with priority passes. 338.1.b / 339
 *
 * Once both players have passed in sequence without adding anything, the newest
 * item resolves (339.1). One resolution per pass — the players then get a fresh
 * window on whatever is underneath it.
 */
export function passPriority(state: GameState, lookup: CardLookup): Resolution | null {
  if (state.chain.length === 0) return null;

  state.chainPasses += 1;
  if (state.chainPasses >= 2) return resolveTop(state, lookup);

  state.priority = OPPONENT[state.priority ?? state.turnPlayer];
  return null;
}

/**
 * Counters a chain item. 425
 *
 * 425.1.a — it does nothing and is cleared from the chain; 425.1.a.1 sends the
 * card to the trash; 425.1.c refunds nothing, additional costs included. The
 * cost was spent when the item was finalized, and this deliberately does not
 * give it back.
 *
 * 425.2.a makes Countering a Limited Action — a player can only do it when a
 * card tells them to — so there is no player-facing action for it. Card effects
 * call this once the effect registry lands.
 */
export function counterItem(state: GameState, uid: string, lookup: CardLookup): boolean {
  const index = state.chain.findIndex((item) => item.uid === uid);
  if (index < 0) return false;

  const [item] = state.chain.splice(index, 1);
  const card = lookup(state.instances[item.uid]?.cardId ?? '');

  const owner = state.instances[item.uid]?.owner;
  if (owner && item.kind === 'spell') state.players[owner].trash.push(item.uid);

  log(
    state,
    item.controller,
    `${card?.baseName ?? item.label ?? 'A chain item'} was countered — no costs are refunded.`,
    '425.1.c',
  );

  if (state.chain.length === 0) {
    state.priority = null;
    state.chainPasses = 0;
  } else {
    state.priority = state.chain[state.chain.length - 1].controller;
  }
  return true;
}

/**
 * Builds the chain item for a spell being played.
 *
 * Card effects are not automated yet, so a card becomes one instruction holding
 * its own rules text. That keeps the fizzle rule real — the instruction is
 * skipped when its target is gone — without pretending the effect resolved.
 */
export function spellItem(
  uid: string,
  controller: PlayerId,
  card: Card,
  targets: string[] = [],
): ChainItem {
  return {
    uid,
    controller,
    kind: 'spell',
    /*
     * The timing marker and its reminder text are dropped: the engine enforces
     * those itself now, so what is left is the part a player still has to read.
     */
    instructions: [
      { text: (unautomatedText(card) ?? card.text ?? card.baseName).replace(/\n/g, ' '), targets },
    ],
  };
}
