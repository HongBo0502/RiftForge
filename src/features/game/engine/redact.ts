import type { CardInstance, GameState, PlayerId } from './types';
import { OPPONENT } from './types';

/**
 * Strips everything a given player is not entitled to see. 128 (Privacy)
 *
 * This is the single place hidden information is enforced. In hotseat play it
 * backs the pass-the-device screen; if online play is added, this is exactly
 * what would go over the wire, so a client never receives data it could cheat
 * with. A hidden card's identity only ever exists in its owner's view.
 */

/** Placeholder card id substituted for anything the viewer may not see. */
export const CONCEALED = '__concealed__';

function conceal(instance: CardInstance): CardInstance {
  return { ...instance, cardId: CONCEALED };
}

export function redact(state: GameState, viewer: PlayerId): GameState {
  const opponent = OPPONENT[viewer];
  const next = structuredClone(state);
  const secret = new Set<string>();

  const other = next.players[opponent];

  // The opponent's hand, main deck and rune deck are all private, and so is
  // the viewer's own deck order — knowing your next draw is still cheating.
  for (const uid of other.hand) secret.add(uid);
  for (const uid of other.mainDeck) secret.add(uid);
  for (const uid of other.runeDeck) secret.add(uid);
  for (const uid of next.players[viewer].mainDeck) secret.add(uid);
  for (const uid of next.players[viewer].runeDeck) secret.add(uid);

  // 128 — a hidden card is face-down; only its controller knows what it is.
  for (const hidden of Object.values(next.hidden)) {
    if (hidden.controller !== viewer) secret.add(hidden.uid);
  }

  for (const uid of secret) {
    const instance = next.instances[uid];
    if (instance) next.instances[uid] = conceal(instance);
  }

  return next;
}

/** True if the viewer cannot see this instance's identity. */
export function isConcealed(state: GameState, uid: string): boolean {
  return state.instances[uid]?.cardId === CONCEALED;
}
