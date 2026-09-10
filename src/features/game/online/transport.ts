import type { GameAction } from '../engine/types';

/**
 * The wire protocol for online play.
 *
 * Clients relay *actions*, never state. Both sides run the same pure reducer
 * from the same seed, so applying the same action sequence produces the same
 * game — which is why `redact()` can stay the only place hidden information is
 * enforced, and why no client ever has to be trusted with the other's hand.
 *
 * Deliberately transport-agnostic: Supabase Realtime is one implementation of
 * `Transport`, and swapping it for WebSockets or WebRTC later means writing one
 * more adapter, not touching the game.
 */

/** Bumped when the message shape changes, so mismatched clients fail loudly. */
export const PROTOCOL_VERSION = 1;

export type Seat = 'host' | 'guest';

export type Message =
  /**
   * Sent by the host once both seats are filled. Carries everything needed to
   * build an identical opening state on the guest.
   */
  | {
      kind: 'start';
      v: number;
      seed: number;
      /** Deck ids are meaningless across devices, so decks travel in full. */
      hostDeck: unknown;
      guestDeck: unknown;
      /** Which engine player id the host occupies. */
      hostPlays: 'p1' | 'p2';
    }
  /** One game action, in sequence. `n` is the sender's action count so far. */
  | { kind: 'action'; v: number; n: number; action: GameAction }
  /** Guest announcing itself so the host knows to start. */
  | { kind: 'join'; v: number; deck: unknown }
  /** Either side leaving. */
  | { kind: 'leave'; v: number };

export interface TransportHandlers {
  onMessage: (message: Message) => void;
  /** Called when the peer's presence changes. */
  onPeer: (present: boolean) => void;
  onError: (error: Error) => void;
}

export interface Transport {
  /** Joins the room and begins delivering messages. */
  connect: () => Promise<void>;
  send: (message: Message) => Promise<void>;
  disconnect: () => Promise<void>;
}

/**
 * Room codes are typed by humans over voice, so the alphabet drops characters
 * that are easily confused: no O/0, I/1, or S/5.
 */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRTUVWXYZ23456789';

export function makeRoomCode(length = 5): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

export function normaliseRoomCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
}
