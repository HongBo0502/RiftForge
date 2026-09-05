import { useEffect, useState } from 'react';
import { type Dataset, cardImage, loadDataset } from '@/data/cards';
import { DOMAIN_COLOR } from '@/data/symbols';
import DeckBuilder from './DeckBuilder';
import { parseDecklist } from './parse';
import { deleteDeck, loadDecks, saveDeck } from './storage';
import { emptyDeck, type Deck } from './types';
import { validateDeck } from './validate';

export default function DecksPage() {
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [decks, setDecks] = useState<Deck[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    loadDataset().then(setDataset);
    setDecks(loadDecks());
  }, []);

  if (!dataset) {
    return (
      <div className="flex flex-col items-center py-20">
        <div className="size-8 animate-spin rounded-full border-2 border-line border-t-accent" />
      </div>
    );
  }

  const editing = decks.find((d) => d.id === editingId);

  /** Persist on every edit — a deck builder that loses work is worse than none. */
  function commit(deck: Deck) {
    const saved = saveDeck(deck);
    setDecks((list) => [saved, ...list.filter((d) => d.id !== saved.id)]);
  }

  function create(deck: Deck) {
    commit(deck);
    setEditingId(deck.id);
  }

  if (editing) {
    return (
      <DeckBuilder
        deck={editing}
        dataset={dataset}
        onChange={commit}
        onBack={() => setEditingId(null)}
        onDelete={() => {
          deleteDeck(editing.id);
          setDecks((list) => list.filter((d) => d.id !== editing.id));
          setEditingId(null);
        }}
      />
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h1 className="flex-1 text-xl font-semibold">Decks</h1>
        <button
          type="button"
          onClick={() => setImporting(true)}
          className="rounded-lg border border-line bg-surface px-3 py-2 text-sm font-medium text-muted hover:text-bright"
        >
          Import
        </button>
        <button
          type="button"
          onClick={() => create(emptyDeck())}
          className="rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-ink"
        >
          New deck
        </button>
      </div>

      {importing && (
        <ImportPanel
          dataset={dataset}
          onCancel={() => setImporting(false)}
          onImport={(deck) => {
            setImporting(false);
            create(deck);
          }}
        />
      )}

      {decks.length === 0 && !importing ? (
        <div className="rounded-lg border border-dashed border-line px-4 py-16 text-center">
          <p className="font-medium">No decks yet.</p>
          <p className="mt-1 text-sm text-muted">
            Build one from scratch, or paste a list you already have.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {decks.map((deck) => {
            const legend = deck.legendId ? dataset.byId.get(deck.legendId) : undefined;
            const v = validateDeck(deck, dataset.byId);
            const src = legend ? cardImage(legend, 'thumb') : null;
            return (
              <button
                key={deck.id}
                type="button"
                onClick={() => setEditingId(deck.id)}
                className="flex items-center gap-3 rounded-lg border border-line bg-surface p-3 text-left transition-colors hover:border-line-bright"
              >
                {src ? (
                  <img src={src} alt="" loading="lazy" className="h-16 w-12 rounded object-cover" />
                ) : (
                  <div className="h-16 w-12 rounded border border-dashed border-line" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{deck.name}</span>
                  <span className="block truncate text-xs text-muted">
                    {legend?.baseName ?? 'No legend'}
                  </span>
                  <span className="mt-1 flex flex-wrap items-center gap-1">
                    {v.identity.map((d) => (
                      <span
                        key={d}
                        className="size-2.5 rounded-full"
                        style={{ background: DOMAIN_COLOR[d] }}
                        title={d}
                      />
                    ))}
                    <span
                      className={`ml-1 text-xs font-medium ${v.legal ? 'text-calm' : 'text-muted'}`}
                    >
                      {v.mainCount} cards {v.legal ? '· legal' : ''}
                    </span>
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ImportPanel({
  dataset,
  onImport,
  onCancel,
}: {
  dataset: Dataset;
  onImport: (deck: Deck) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState('');
  const [problems, setProblems] = useState<string[]>([]);

  return (
    <div className="mb-4 rounded-lg border border-line bg-surface p-3">
      <p className="mb-2 text-sm text-muted">
        Paste a decklist — <code className="text-bright">3 Card Name</code> per line, with optional{' '}
        <code className="text-bright">Legend:</code>, <code className="text-bright">Champion:</code>{' '}
        and section headers.
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={9}
        spellCheck={false}
        placeholder={'Legend: Teemo - Swift Scout\nChampion: Teemo - Strategist\n\nMain\n3 Nocturne - Horrifying\n\nRunes\n6 Mind Rune\n6 Chaos Rune'}
        className="w-full rounded-lg border border-line bg-ink p-3 font-mono text-xs placeholder:text-muted focus:border-accent focus:outline-none"
        aria-label="Decklist"
      />

      {problems.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-xs text-fury">
          {problems.slice(0, 8).map((p, i) => (
            <li key={i}>{p}</li>
          ))}
          {problems.length > 8 && <li className="opacity-70">+{problems.length - 8} more…</li>}
        </ul>
      )}

      <div className="mt-2 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-line px-3 py-1.5 text-sm text-muted hover:text-bright"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={text.trim().length === 0}
          onClick={() => {
            const { deck, problems: found } = parseDecklist(text, dataset.cards);
            setProblems(found);
            // Import anything that parsed; unmatched lines stay listed above.
            onImport(deck);
          }}
          className="rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-ink disabled:opacity-40"
        >
          Import
        </button>
      </div>
    </div>
  );
}
