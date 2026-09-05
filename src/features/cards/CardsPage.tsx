import { useEffect, useMemo, useRef, useState } from 'react';
import type { Card } from '@/types';
import { nameKey } from '@/types';
import { type Dataset, loadDataset } from '@/data/cards';
import { EMPTY_QUERY, searchCards } from '@/data/search';
import type { CardQuery } from '@/data/search';
import { CardTile } from './CardTile';
import CardDetail from './CardDetail';
import FilterBar from './FilterBar';

/** Cards rendered up front, and added each time the sentinel scrolls in. */
const PAGE = 60;

export default function CardsPage() {
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState<CardQuery>(EMPTY_QUERY);
  const [limit, setLimit] = useState(PAGE);
  const [selected, setSelected] = useState<Card | null>(null);
  const sentinel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadDataset().then(setDataset, (e: Error) => setError(e.message));
  }, []);

  const results = useMemo(
    () => (dataset ? searchCards(dataset.cards, query) : []),
    [dataset, query],
  );

  // Any change to the query starts the list over from the top.
  useEffect(() => setLimit(PAGE), [query]);

  /*
   * The full result set can be 1451 cards. Rather than virtualising, we grow
   * the rendered slice as a sentinel below the grid comes into view — the DOM
   * stays small on first paint and images are lazy anyway.
   */
  useEffect(() => {
    const el = sentinel.current;
    if (!el || limit >= results.length) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) setLimit((n) => n + PAGE);
      },
      { rootMargin: '600px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [limit, results.length]);

  if (error) {
    return (
      <Centered>
        <p className="font-medium text-fury">Could not load the card database.</p>
        <p className="mt-1 text-sm text-muted">{error}</p>
        <p className="mt-3 text-sm text-muted">
          Run <code className="rounded bg-surface-2 px-1.5 py-0.5">npm run fetch-cards</code> to
          rebuild it.
        </p>
      </Centered>
    );
  }

  if (!dataset) {
    return (
      <Centered>
        <div className="size-8 animate-spin rounded-full border-2 border-line border-t-accent" />
        <p className="mt-3 text-sm text-muted">Loading cards…</p>
      </Centered>
    );
  }

  const visible = results.slice(0, limit);

  return (
    <>
      <FilterBar
        query={query}
        onChange={setQuery}
        sets={dataset.sets}
        keywords={dataset.keywords}
        resultCount={results.length}
        totalCount={dataset.cards.length}
      />

      <div className="mx-auto max-w-7xl px-4 py-4">
        {results.length === 0 ? (
          <Centered>
            <p className="font-medium">No cards match.</p>
            <button
              type="button"
              onClick={() => setQuery(EMPTY_QUERY)}
              className="mt-3 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-accent hover:border-accent"
            >
              Reset search
            </button>
          </Centered>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 sm:gap-3 lg:grid-cols-6 xl:grid-cols-7">
              {visible.map((card) => (
                <CardTile key={card.id} card={card} onOpen={setSelected} />
              ))}
            </div>

            <div ref={sentinel} className="h-10" />

            {limit < results.length && (
              <p className="pb-4 text-center text-sm text-muted">
                Showing {visible.length} of {results.length}…
              </p>
            )}
          </>
        )}
      </div>

      {selected && (
        <CardDetail
          card={selected}
          printings={dataset.byBaseName.get(nameKey(selected.baseName)) ?? [selected]}
          onSelect={setSelected}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-4 py-20 text-center">{children}</div>
  );
}
