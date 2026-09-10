import { useState } from 'react';
import type { Dataset } from '@/data/cards';
import { cardImage } from '@/data/cards';
import { DOMAIN_COLOR } from '@/data/symbols';
import type { Deck } from '@/features/decks/types';
import { validateDeck } from '@/features/decks/validate';
import { onlineConfigProblem } from '../online/supabase';
import { makeRoomCode, normaliseRoomCode } from '../online/transport';
import type { OnlineMatch } from '../online/useOnlineMatch';

/**
 * Lobby for online play: pick a deck, then host a room or join one by code.
 *
 * Nothing is stored server-side — a room is an ephemeral Realtime channel, and
 * the game itself lives in the two browsers. Leaving ends the match.
 */
export default function OnlinePanel({
  dataset,
  decks,
  match,
  onBack,
}: {
  dataset: Dataset;
  decks: Deck[];
  match: OnlineMatch;
  onBack: () => void;
}) {
  const [deckId, setDeckId] = useState<string | null>(decks[0]?.id ?? null);
  const [code, setCode] = useState('');
  const configProblem = onlineConfigProblem();
  const deck = decks.find((d) => d.id === deckId);

  if (configProblem) {
    return (
      <Shell onBack={onBack}>
        <p className="rounded-lg border border-order/40 bg-order/10 px-3 py-2 text-sm text-order">
          {configProblem}
        </p>
        <p className="mt-2 text-xs text-muted">
          Copy <code className="text-bright">.env.example</code> to{' '}
          <code className="text-bright">.env</code>, fill in the Supabase project URL and
          publishable key, then restart the dev server.
        </p>
      </Shell>
    );
  }

  if (match.status === 'waiting') {
    return (
      <Shell onBack={() => void match.leave()}>
        <p className="text-sm text-muted">Room code — give this to the other player:</p>
        <p className="my-3 select-all font-mono text-4xl font-bold tracking-[0.25em] text-accent">
          {match.roomCode}
        </p>
        <p className="text-sm text-muted">Waiting for them to join…</p>
        <div className="mt-3 size-6 animate-spin rounded-full border-2 border-line border-t-accent" />
      </Shell>
    );
  }

  if (match.status === 'connecting') {
    return (
      <Shell onBack={onBack}>
        <p className="text-sm text-muted">Connecting…</p>
      </Shell>
    );
  }

  if (match.status === 'error') {
    return (
      <Shell onBack={() => void match.leave()}>
        <p className="rounded-lg border border-fury/50 bg-fury/10 px-3 py-2 text-sm text-fury">
          {match.error}
        </p>
      </Shell>
    );
  }

  if (match.status === 'ended') {
    return (
      <Shell onBack={() => void match.leave()}>
        <p className="text-sm text-muted">The other player left. The match has ended.</p>
      </Shell>
    );
  }

  return (
    <Shell onBack={onBack}>
      <h1 className="text-xl font-semibold">Play online</h1>
      <p className="mt-1 text-sm text-muted">
        Two devices. One hosts and reads out the room code; the other joins with it.
      </p>

      <h2 className="mt-4 mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
        Your deck
      </h2>
      <div className="space-y-2">
        {decks.length === 0 && (
          <p className="rounded-lg border border-dashed border-line px-3 py-6 text-center text-sm text-muted">
            Build or import a deck first.
          </p>
        )}
        {decks.map((d) => {
          const legend = d.legendId ? dataset.byId.get(d.legendId) : undefined;
          const v = validateDeck(d, dataset.byId);
          const src = legend ? cardImage(legend, 'thumb') : null;
          return (
            <button
              key={d.id}
              type="button"
              onClick={() => setDeckId(d.id)}
              className={`flex w-full items-center gap-2 rounded-lg border p-2 text-left transition-colors ${
                deckId === d.id ? 'border-accent bg-accent/10' : 'border-line bg-surface'
              }`}
            >
              {src && <img src={src} alt="" className="h-12 w-9 rounded object-cover" loading="lazy" />}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{d.name}</span>
                <span className="block truncate text-xs text-muted">{legend?.baseName ?? '—'}</span>
              </span>
              <span className="flex items-center gap-1">
                {v.identity.map((dom) => (
                  <span
                    key={dom}
                    className="size-2.5 rounded-full"
                    style={{ background: DOMAIN_COLOR[dom] }}
                  />
                ))}
                {!v.legal && <span className="text-[10px] text-order">!</span>}
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-line bg-surface p-3">
          <h3 className="text-sm font-semibold">Host a game</h3>
          <p className="mt-1 text-xs text-muted">Creates a room and shows you a code.</p>
          <button
            type="button"
            disabled={!deck}
            onClick={() => deck && void match.host(makeRoomCode(), deck)}
            className="mt-3 w-full rounded-lg bg-accent py-2 text-sm font-semibold text-ink disabled:opacity-40"
          >
            Create room
          </button>
        </div>

        <div className="rounded-lg border border-line bg-surface p-3">
          <h3 className="text-sm font-semibold">Join a game</h3>
          <input
            value={code}
            onChange={(e) => setCode(normaliseRoomCode(e.target.value))}
            placeholder="ROOM CODE"
            spellCheck={false}
            className="mt-2 w-full rounded-lg border border-line bg-ink px-3 py-2 text-center font-mono text-lg tracking-[0.2em] uppercase placeholder:tracking-normal placeholder:text-muted focus:border-accent focus:outline-none"
            aria-label="Room code"
          />
          <button
            type="button"
            disabled={!deck || code.length < 4}
            onClick={() => deck && void match.join(code, deck)}
            className="mt-2 w-full rounded-lg border border-accent py-2 text-sm font-semibold text-accent disabled:opacity-40"
          >
            Join room
          </button>
        </div>
      </div>
    </Shell>
  );
}

function Shell({ children, onBack }: { children: React.ReactNode; onBack: () => void }) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <button
        type="button"
        onClick={onBack}
        className="mb-3 rounded-lg border border-line bg-surface px-3 py-1.5 text-xs text-muted hover:text-bright"
      >
        Back
      </button>
      {children}
    </div>
  );
}
