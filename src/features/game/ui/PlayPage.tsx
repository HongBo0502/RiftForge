import { useEffect, useMemo, useRef, useState } from 'react';
import type { Card } from '@/types';
import { type Dataset, cardImage, loadDataset } from '@/data/cards';
import { DOMAIN_COLOR } from '@/data/symbols';
import { loadDecks } from '@/features/decks/storage';
import type { Deck } from '@/features/decks/types';
import { validateDeck } from '@/features/decks/validate';
import { reduce, startGame } from '../engine/reducer';
import { redact } from '../engine/redact';
import { setupGame } from '../engine/setup';
import type { GameAction, GameState, PlayerId } from '../engine/types';
import { useOnlineMatch } from '../online/useOnlineMatch';
import GameBoard from './GameBoard';
import MulliganScreen from './MulliganScreen';
import OnlinePanel from './OnlinePanel';

/**
 * Hotseat play: both players share one device, so between turns the screen is
 * covered until the next player confirms they're looking. The board is only
 * ever handed a `redact`ed state, so nothing private can leak through the UI
 * even by accident.
 */
type Mode = 'choose' | 'hotseat' | 'online';

export default function PlayPage() {
  const [mode, setMode] = useState<Mode>('choose');
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [decks, setDecks] = useState<Deck[]>([]);
  const [game, setGame] = useState<GameState | null>(null);
  const [rejection, setRejection] = useState<{ reason: string; rule?: string } | null>(null);
  const [handoffPending, setHandoffPending] = useState(false);
  const lastTurnPlayer = useRef<PlayerId | null>(null);

  useEffect(() => {
    loadDataset().then(setDataset);
    setDecks(loadDecks());
  }, []);

  const lookup = useMemo(
    () => (cardId: string): Card | undefined => dataset?.byId.get(cardId),
    [dataset],
  );

  const emptyCards = useMemo(() => new Map<string, Card>(), []);
  const online = useOnlineMatch(dataset?.byId ?? emptyCards);

  function dispatch(action: GameAction) {
    if (!game) return;
    const result = reduce(game, action, lookup);
    if (!result.ok) {
      setRejection({ reason: result.reason, rule: result.rule });
      return;
    }
    setRejection(null);
    // Hand over the device whenever control passes — a turn change, or the
    // other player's turn to mulligan.
    const turnChanged = result.state.turnPlayer !== game.turnPlayer;
    const mulliganPassed =
      game.pendingMulligan[0] !== result.state.pendingMulligan[0] &&
      result.state.pendingMulligan.length > 0;
    if ((turnChanged || mulliganPassed) && !result.state.winner) {
      setHandoffPending(true);
    }
    setGame(result.state);
  }

  useEffect(() => {
    if (game) lastTurnPlayer.current = game.turnPlayer;
  }, [game]);

  if (!dataset) {
    return (
      <div className="flex justify-center py-20">
        <div className="size-8 animate-spin rounded-full border-2 border-line border-t-accent" />
      </div>
    );
  }

  if (mode === 'online') {
    if (online.status === 'playing' && online.state) {
      if (online.state.phase === 'mulligan' && online.state.pendingMulligan.length > 0) {
        const mine = online.state.pendingMulligan[0] === online.seat;
        return mine ? (
          <MulliganScreen
            state={redact(online.state, online.seat!)}
            seat={online.seat!}
            lookup={lookup}
            onConfirm={(swap) => online.act({ type: 'MULLIGAN', swap })}
          />
        ) : (
          <div className="mx-auto max-w-md px-4 py-20 text-center">
            <div className="mx-auto size-8 animate-spin rounded-full border-2 border-line border-t-accent" />
            <p className="mt-3 text-sm text-muted">Waiting for the other player to mulligan…</p>
          </div>
        );
      }
      return (
        <GameBoard
          // Online: the board is fixed to this client's seat, and every action
          // is relayed rather than applied to a shared device.
          state={redact(online.state, online.seat!)}
          viewer={online.seat!}
          canAct={online.myTurn}
          waitingLabel={online.myTurn ? null : 'Waiting for the other player…'}
          lookup={lookup}
          onAction={online.act}
          rejection={online.error ? { reason: online.error } : null}
          onExit={() => {
            void online.leave();
            setMode('choose');
          }}
        />
      );
    }
    return (
      <OnlinePanel
        dataset={dataset}
        decks={decks}
        match={online}
        onBack={() => setMode('choose')}
      />
    );
  }

  if (mode === 'choose') {
    return <ModeChooser onPick={setMode} />;
  }

  if (!game) {
    return (
      <DeckSelect
        dataset={dataset}
        decks={decks}
        onStart={(p1, p2, seed) => {
          setGame(
            startGame(setupGame({ decks: { p1, p2 }, byId: dataset.byId, seed }), lookup, {
              mulligan: true,
            }),
          );
          setRejection(null);
        }}
      />
    );
  }

  if (game.winner) {
    return (
      <div className="mx-auto max-w-md px-4 py-20 text-center">
        <h1 className="text-3xl font-bold text-accent">
          {game.winner === 'p1' ? 'Player 1' : 'Player 2'} wins
        </h1>
        <p className="mt-2 text-muted">
          {game.players.p1.points} – {game.players.p2.points} after {game.turn} turns.
        </p>
        <button
          type="button"
          onClick={() => setGame(null)}
          className="mt-6 rounded-lg bg-accent px-4 py-2 font-semibold text-ink"
        >
          New game
        </button>
      </div>
    );
  }

  if (game.phase === 'mulligan' && game.pendingMulligan.length > 0 && !handoffPending) {
    const who = game.pendingMulligan[0];
    return (
      <MulliganScreen
        // Redacted like everything else: you only ever see your own hand.
        state={redact(game, who)}
        seat={who}
        lookup={lookup}
        onConfirm={(swap) => dispatch({ type: 'MULLIGAN', swap })}
      />
    );
  }

  if (handoffPending) {
    return (
      <div className="mx-auto max-w-md px-4 py-20 text-center">
        <h1 className="text-2xl font-semibold">
          Pass to{' '}
          {(game.pendingMulligan[0] ?? game.turnPlayer) === 'p1' ? 'Player 1' : 'Player 2'}
        </h1>
        <p className="mt-2 text-sm text-muted">
          Their hand is hidden until they tap below.
        </p>
        <button
          type="button"
          onClick={() => setHandoffPending(false)}
          className="mt-6 rounded-lg bg-accent px-6 py-3 font-semibold text-ink"
        >
          I'm {(game.pendingMulligan[0] ?? game.turnPlayer) === 'p1' ? 'Player 1' : 'Player 2'}
        </button>
      </div>
    );
  }

  return (
    <GameBoard
      // The board never sees the other player's private information.
      state={redact(game, game.turnPlayer)}
      lookup={lookup}
      onAction={dispatch}
      rejection={rejection}
      onExit={() => setGame(null)}
    />
  );
}

function ModeChooser({ onPick }: { onPick: (mode: Mode) => void }) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-xl font-semibold">Play</h1>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => onPick('hotseat')}
          className="rounded-lg border border-line bg-surface p-4 text-left transition-colors hover:border-accent"
        >
          <h2 className="font-semibold">Same device</h2>
          <p className="mt-1 text-sm text-muted">
            Two players, one screen. The board covers itself between turns so neither sees the
            other's hand.
          </p>
        </button>
        <button
          type="button"
          onClick={() => onPick('online')}
          className="rounded-lg border border-line bg-surface p-4 text-left transition-colors hover:border-accent"
        >
          <h2 className="font-semibold">Online</h2>
          <p className="mt-1 text-sm text-muted">
            Two devices. One hosts and shares a room code. Your hand never leaves your browser.
          </p>
        </button>
      </div>
    </div>
  );
}

function DeckSelect({
  dataset,
  decks,
  onStart,
}: {
  dataset: Dataset;
  decks: Deck[];
  onStart: (p1: Deck, p2: Deck, seed: number) => void;
}) {
  const [p1, setP1] = useState<string | null>(null);
  const [p2, setP2] = useState<string | null>(null);

  const legal = decks.filter((d) => validateDeck(d, dataset.byId).legal);
  const deckOf = (id: string | null) => decks.find((d) => d.id === id);

  if (decks.length === 0) {
    return (
      <div className="mx-auto max-w-md px-4 py-20 text-center">
        <h1 className="text-xl font-semibold">No decks yet</h1>
        <p className="mt-2 text-sm text-muted">
          Build or import a deck first — the simulator needs two legal decks.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <h1 className="text-xl font-semibold">Start a match</h1>
      <p className="mt-1 text-sm text-muted">
        Two players, one device. 8 points wins; the deck that goes second channels an extra rune.
      </p>

      {legal.length === 0 && (
        <p className="mt-3 rounded-lg border border-order/40 bg-order/10 px-3 py-2 text-sm text-order">
          None of your decks are legal yet. You can still start — the engine won't stop you — but
          expect odd behaviour.
        </p>
      )}

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <DeckColumn label="Player 1" decks={decks} dataset={dataset} value={p1} onChange={setP1} />
        <DeckColumn label="Player 2" decks={decks} dataset={dataset} value={p2} onChange={setP2} />
      </div>

      <button
        type="button"
        disabled={!p1 || !p2}
        onClick={() => {
          const a = deckOf(p1);
          const b = deckOf(p2);
          if (a && b) onStart(a, b, Math.floor(Math.random() * 1e9));
        }}
        className="mt-5 w-full rounded-lg bg-accent py-3 font-semibold text-ink disabled:opacity-40"
      >
        Start match
      </button>
    </div>
  );
}

function DeckColumn({
  label,
  decks,
  dataset,
  value,
  onChange,
}: {
  label: string;
  decks: Deck[];
  dataset: Dataset;
  value: string | null;
  onChange: (id: string) => void;
}) {
  return (
    <div>
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">{label}</h2>
      <div className="space-y-2">
        {decks.map((deck) => {
          const legend = deck.legendId ? dataset.byId.get(deck.legendId) : undefined;
          const v = validateDeck(deck, dataset.byId);
          const src = legend ? cardImage(legend, 'thumb') : null;
          return (
            <button
              key={deck.id}
              type="button"
              onClick={() => onChange(deck.id)}
              className={`flex w-full items-center gap-2 rounded-lg border p-2 text-left transition-colors ${
                value === deck.id ? 'border-accent bg-accent/10' : 'border-line bg-surface'
              }`}
            >
              {src && <img src={src} alt="" className="h-12 w-9 rounded object-cover" loading="lazy" />}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{deck.name}</span>
                <span className="block truncate text-xs text-muted">{legend?.baseName ?? '—'}</span>
              </span>
              <span className="flex items-center gap-1">
                {v.identity.map((d) => (
                  <span
                    key={d}
                    className="size-2.5 rounded-full"
                    style={{ background: DOMAIN_COLOR[d] }}
                  />
                ))}
                {!v.legal && <span className="text-[10px] text-order">!</span>}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
