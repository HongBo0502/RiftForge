import { useCallback, useEffect, useRef, useState } from 'react';
import type { Card } from '@/types';
import type { Deck } from '@/features/decks/types';
import { activePlayer } from '../engine/chain';
import { reduce, startGame } from '../engine/reducer';
import { setupGame } from '../engine/setup';
import type { GameAction, GameState, PlayerId } from '../engine/types';
import { createSupabaseTransport } from './supabase';
import { PROTOCOL_VERSION, type Message, type Seat, type Transport } from './transport';

/**
 * Runs one online match.
 *
 * Both clients run the same pure reducer from the same seed and relay only
 * actions, so neither has to trust the other with state — and neither is ever
 * *sent* the other's hand, because the board renders `redact(state, seat)`
 * locally. The host is authoritative for setup alone: it picks the seed and
 * broadcasts both decks so the guest can build an identical opening state.
 *
 * Deliberately no reconnect or resync. A dropped connection ends the match
 * rather than silently diverging, which is the honest failure for V1.
 */

export type Status =
  | 'idle'
  | 'connecting'
  | 'waiting' // in the room, peer not here yet
  | 'playing'
  | 'ended'
  | 'error';

export interface OnlineMatch {
  status: Status;
  error: string | null;
  roomCode: string | null;
  /** Which engine player this client controls. */
  seat: PlayerId | null;
  state: GameState | null;
  /** True when it is this client's turn to act. */
  myTurn: boolean;
  host: (roomCode: string, deck: Deck) => Promise<void>;
  join: (roomCode: string, deck: Deck) => Promise<void>;
  act: (action: GameAction) => void;
  leave: () => Promise<void>;
}

export function useOnlineMatch(byId: Map<string, Card>): OnlineMatch {
  const lookup = useCallback((cardId: string) => byId.get(cardId), [byId]);

  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [seat, setSeat] = useState<PlayerId | null>(null);
  const [state, setState] = useState<GameState | null>(null);
  /*
   * A mirror of `state` for the message handlers.
   *
   * Nothing with a side effect may live inside a setState updater: React
   * double-invokes updaters in StrictMode, which sent every action twice and
   * desynced the two clients. Handlers read this ref, do their work, then set
   * state once.
   */
  const stateRef = useRef<GameState | null>(null);
  const commit = useCallback((next: GameState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const transport = useRef<Transport | null>(null);
  const role = useRef<Seat | null>(null);
  const myDeck = useRef<Deck | null>(null);
  const selfId = useRef(crypto.randomUUID());
  /** Actions sent, for ordering and duplicate detection. */
  const sent = useRef(0);
  const received = useRef(0);

  const fail = useCallback((message: string) => {
    setError(message);
    setStatus('error');
  }, []);

  /** Builds the opening state both clients must agree on. */
  const begin = useCallback(
    (seed: number, hostDeck: Deck, guestDeck: Deck, hostPlays: PlayerId) => {
      const guestPlays: PlayerId = hostPlays === 'p1' ? 'p2' : 'p1';
      const decks = {
        [hostPlays]: hostDeck,
        [guestPlays]: guestDeck,
      } as Record<PlayerId, Deck>;

      setSeat(role.current === 'host' ? hostPlays : guestPlays);
      commit(startGame(setupGame({ decks, byId, seed }), lookup, { mulligan: true }));
      setStatus('playing');
    },
    [byId, commit],
  );

  const handleMessage = useCallback(
    (message: Message) => {
      if (message.v !== PROTOCOL_VERSION) {
        fail('The other player is running a different version of the app.');
        return;
      }

      switch (message.kind) {
        case 'join': {
          // Only the host reacts: it now has both decks, so it can start.
          if (role.current !== 'host' || !myDeck.current) return;
          const seed = Math.floor(Math.random() * 1e9);
          const hostPlays: PlayerId = 'p1';
          const guestDeck = message.deck as Deck;
          void transport.current?.send({
            kind: 'start',
            v: PROTOCOL_VERSION,
            seed,
            hostDeck: myDeck.current,
            guestDeck,
            hostPlays,
          });
          begin(seed, myDeck.current, guestDeck, hostPlays);
          break;
        }

        case 'start': {
          if (role.current !== 'guest') return;
          begin(
            message.seed,
            message.hostDeck as Deck,
            message.guestDeck as Deck,
            message.hostPlays,
          );
          break;
        }

        case 'action': {
          // Actions must arrive in order; a gap means we have diverged and the
          // safe move is to stop rather than play on a state the peer doesn't share.
          if (message.n !== received.current) {
            fail('Lost sync with the other player. The match cannot continue.');
            return;
          }
          received.current += 1;
          const current = stateRef.current;
          if (!current) return;
          const applied = reduce(current, message.action, lookup);
          if (!applied.ok) {
            fail(`The other player sent an illegal action: ${applied.reason}`);
            return;
          }
          commit(applied.state);
          break;
        }

        case 'leave':
          setStatus('ended');
          break;
      }
    },
    [begin, commit, fail, lookup],
  );

  const open = useCallback(
    async (code: string, deck: Deck, as: Seat) => {
      setError(null);
      setStatus('connecting');
      setRoomCode(code);
      role.current = as;
      myDeck.current = deck;
      sent.current = 0;
      received.current = 0;

      try {
        const t = createSupabaseTransport(code, selfId.current, {
          onMessage: handleMessage,
          onPeer: (present) => {
            if (!present) setStatus((s) => (s === 'playing' ? 'ended' : s));
          },
          onError: (e) => fail(e.message),
        });
        transport.current = t;
        await t.connect();
        setStatus('waiting');

        // The guest announces itself; the host replies with the seed and decks.
        if (as === 'guest') {
          await t.send({ kind: 'join', v: PROTOCOL_VERSION, deck });
        }
      } catch (e) {
        fail(e instanceof Error ? e.message : String(e));
      }
    },
    [fail, handleMessage],
  );

  const act = useCallback(
    (action: GameAction) => {
      const current = stateRef.current;
      if (!current) return;

      const result = reduce(current, action, lookup);
      if (!result.ok) return; // the board surfaces the rejection itself

      // Apply locally first, then relay. Both clients run the same reducer, so
      // the peer reaches the same state from the same action.
      commit(result.state);
      void transport.current?.send({
        kind: 'action',
        v: PROTOCOL_VERSION,
        n: sent.current,
        action,
      });
      sent.current += 1;
    },
    [commit, lookup],
  );

  const leave = useCallback(async () => {
    await transport.current?.send({ kind: 'leave', v: PROTOCOL_VERSION }).catch(() => {});
    await transport.current?.disconnect().catch(() => {});
    transport.current = null;
    setStatus('idle');
    stateRef.current = null;
    setState(null);
    setSeat(null);
    setRoomCode(null);
  }, []);

  // Leave cleanly if the tab closes mid-match.
  useEffect(() => {
    return () => {
      void transport.current?.disconnect().catch(() => {});
    };
  }, []);

  return {
    status,
    error,
    roomCode,
    seat,
    state,
    /*
     * Not simply "is it my turn" — with a chain up it is whoever holds
     * priority, and in a showdown whoever holds focus, both of which can be the
     * player whose turn it is not. That is the whole point of a response
     * window. 335
     */
    myTurn: Boolean(
      state &&
        seat &&
        !state.winner &&
        (state.phase === 'mulligan'
          ? state.pendingMulligan[0] === seat
          : activePlayer(state) === seat),
    ),
    host: (code, deck) => open(code, deck, 'host'),
    join: (code, deck) => open(code, deck, 'guest'),
    act,
    leave,
  };
}
