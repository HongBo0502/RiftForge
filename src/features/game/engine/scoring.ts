import type { Card } from '@/types';
import { keywordValue } from './keywords';
import type { GameState, PlayerId } from './types';

/**
 * Scoring. 467-472
 *
 * A player Scores by Conquering (gaining control of a battlefield they have
 * not scored this turn) or Holding (still controlling one at their Beginning
 * Phase). Either way it is once per battlefield per turn (470).
 */

/**
 * Awards a point for scoring `index`, applying the Final Point restriction.
 *
 * 471.1.b — a Conquer that would reach the Victory Score only scores if the
 * player has Scored *every* battlefield this turn; otherwise they draw instead.
 * Points from sources other than Conquer are exempt (471.1.a.1).
 *
 * Mutates `state`; callers already work on a draft.
 */
export function score(
  state: GameState,
  player: PlayerId,
  index: number,
  method: 'conquer' | 'hold',
  lookup?: (cardId: string) => Card | undefined,
): void {
  const battlefield = state.battlefields[index];
  if (!battlefield) return;

  // 470 — only once per battlefield per turn, by either method.
  if (battlefield.scoredBy.includes(player)) return;

  battlefield.scoredBy.push(player);

  /*
   * Hunt X — "When I Conquer or Hold, my controller gains X XP." 823.1.c.1
   *
   * This runs before the Final Point check below, because 471.1.b withholds the
   * *point*, not the scoring event: the battlefield was still Conquered or Held.
   */
  if (lookup) huntXp(state, player, index, method, lookup);

  const atFinalPoint = state.players[player].points >= state.victoryScore - 1;
  if (method === 'conquer' && atFinalPoint) {
    const scoredEverything = state.battlefields.every((b) => b.scoredBy.includes(player));
    if (!scoredEverything) {
      // 471.1.b.1 — draws a card instead of taking the final point.
      drawCard(state, player);
      state.log.push({
        turn: state.turn,
        phase: state.phase,
        player,
        text: `Final Point withheld — not every battlefield scored this turn. Drew a card instead.`,
        rule: '471.1.b.1',
      });
      return;
    }
  }

  state.players[player].points += 1;
  state.log.push({
    turn: state.turn,
    phase: state.phase,
    player,
    text: `${method === 'conquer' ? 'Conquered' : 'Held'} battlefield ${index + 1} — ${state.players[player].points} point${state.players[player].points === 1 ? '' : 's'}.`,
    rule: method === 'conquer' ? '469.1' : '469.2',
  });
}

/**
 * Hunt X. 823
 *
 * Hunt is both a Conquer and a Hold effect (823.1.b), and the unit has to be at
 * the battlefield being scored for it to be the one doing the conquering or
 * holding. 823.2 sums multiple grants, which the printed value already covers.
 */
function huntXp(
  state: GameState,
  player: PlayerId,
  index: number,
  method: 'conquer' | 'hold',
  lookup: (cardId: string) => Card | undefined,
): void {
  let gained = 0;
  for (const unit of Object.values(state.units)) {
    if (unit.controller !== player) continue;
    if (unit.location.kind !== 'battlefield' || unit.location.index !== index) continue;
    const card = lookup(state.instances[unit.uid]?.cardId ?? '');
    // 823.1.c.2 — X defaults to 1 when it is not printed.
    if (card) gained += keywordValue(card, 'Hunt') ?? 0;
  }
  if (gained === 0) return;

  state.players[player].xp += gained;
  state.log.push({
    turn: state.turn,
    phase: state.phase,
    player,
    text: `Hunt: gained ${gained} XP on ${method === 'conquer' ? 'conquering' : 'holding'} battlefield ${index + 1} (${state.players[player].xp} total).`,
    rule: '823.1.c.1',
  });
}

/**
 * Draws one card. Drawing from an empty Main Deck is a Burn Out: an opponent
 * gains a point, and the draw still happens. 315.4.b.1, 431
 */
export function drawCard(state: GameState, player: PlayerId): void {
  const p = state.players[player];

  if (p.mainDeck.length === 0) {
    if (!p.burnedOut) {
      p.burnedOut = true;
      // 194.1.d — the burned-out player picks an opponent to gain 1 point.
      // With one opponent there is no choice to make.
      const opponent: PlayerId = player === 'p1' ? 'p2' : 'p1';
      state.players[opponent].points += 1;
      state.log.push({
        turn: state.turn,
        phase: state.phase,
        player,
        text: `Burned out — deck empty. Opponent gains 1 point (${state.players[opponent].points}).`,
        rule: '431',
      });
    }
    return;
  }

  const uid = p.mainDeck.shift();
  if (uid) p.hand.push(uid);
}

/**
 * Win check, run during cleanups: at or above the Victory Score, and ahead of
 * every opponent. 472
 */
export function checkVictory(state: GameState): void {
  if (state.winner) return;
  for (const id of ['p1', 'p2'] as PlayerId[]) {
    const other: PlayerId = id === 'p1' ? 'p2' : 'p1';
    if (state.players[id].points >= state.victoryScore && state.players[id].points > state.players[other].points) {
      state.winner = id;
      state.log.push({
        turn: state.turn,
        phase: state.phase,
        player: id,
        text: `Wins with ${state.players[id].points} points.`,
        rule: '472',
      });
      return;
    }
  }
}
