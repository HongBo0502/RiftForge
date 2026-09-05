import { useEffect, useRef, useState } from 'react';
import type { CardType, Domain, Rarity, SetInfo } from '@/types';
import { CARD_TYPES, PLAYABLE_DOMAINS, RARITIES } from '@/types';
import type { CardQuery, SortKey } from '@/data/search';
import { EMPTY_QUERY, activeFilterCount } from '@/data/search';
import { DOMAIN_COLOR } from '@/data/symbols';

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'relevance', label: 'Relevance' },
  { key: 'name', label: 'Name' },
  { key: 'energy', label: 'Cost' },
  { key: 'might', label: 'Might' },
  { key: 'rarity', label: 'Rarity' },
  { key: 'set', label: 'Set order' },
];

interface Props {
  query: CardQuery;
  onChange: (next: CardQuery) => void;
  sets: SetInfo[];
  keywords: string[];
  resultCount: number;
  totalCount: number;
}

export default function FilterBar({
  query,
  onChange,
  sets,
  keywords,
  resultCount,
  totalCount,
}: Props) {
  const [open, setOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const active = activeFilterCount(query);

  // "/" and Cmd/Ctrl-K jump to search, the shortcut people expect from a
  // card database.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = document.activeElement?.tagName === 'INPUT';
      if ((e.key === '/' && !typing) || (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey))) {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
      if (e.key === 'Escape' && document.activeElement === searchRef.current) {
        searchRef.current?.blur();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /** Adds or removes one value from an array-valued filter. */
  function toggle<K extends 'sets' | 'types' | 'domains' | 'rarities' | 'keywords'>(
    key: K,
    value: CardQuery[K][number],
  ) {
    const list = query[key] as string[];
    const next = list.includes(value as string)
      ? list.filter((v) => v !== value)
      : [...list, value as string];
    onChange({ ...query, [key]: next } as CardQuery);
  }

  return (
    <div className="sticky top-14 z-20 border-b border-line bg-ink/95 backdrop-blur">
      <div className="mx-auto max-w-7xl px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <SearchIcon />
            <input
              ref={searchRef}
              type="search"
              value={query.text}
              onChange={(e) => onChange({ ...query, text: e.target.value })}
              placeholder="Search cards by name, text, or artist…"
              className="w-full rounded-lg border border-line bg-surface py-2.5 pl-10 pr-3 text-sm placeholder:text-muted focus:border-accent focus:outline-none"
              aria-label="Search cards"
            />
          </div>

          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors ${
              open || active
                ? 'border-accent bg-accent/10 text-accent'
                : 'border-line bg-surface text-muted hover:text-bright'
            }`}
          >
            <FilterIcon />
            <span className="hidden sm:inline">Filters</span>
            {active > 0 && (
              <span className="rounded-full bg-accent px-1.5 text-xs font-bold text-ink">{active}</span>
            )}
          </button>
        </div>

        <div className="mt-2 flex items-center justify-between gap-3 text-xs text-muted">
          <span>
            <span className="font-semibold text-bright tabular-nums">{resultCount}</span>
            {resultCount !== totalCount && <> of {totalCount}</>} cards
          </span>

          <div className="flex items-center gap-2">
            {active > 0 && (
              <button
                type="button"
                onClick={() => onChange({ ...EMPTY_QUERY, text: query.text, sort: query.sort })}
                className="text-accent hover:underline"
              >
                Clear filters
              </button>
            )}
            <label className="flex items-center gap-1.5">
              <span className="hidden sm:inline">Sort</span>
              <select
                value={query.sort}
                onChange={(e) => onChange({ ...query, sort: e.target.value as SortKey })}
                className="rounded-md border border-line bg-surface px-2 py-1 text-xs text-bright focus:border-accent focus:outline-none"
                aria-label="Sort cards"
              >
                {SORTS.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      </div>

      {open && (
        <div className="max-h-[65vh] overflow-y-auto border-t border-line bg-surface/60">
          <div className="mx-auto max-w-7xl space-y-4 px-4 py-4">
            <Group label="Domain">
              {PLAYABLE_DOMAINS.map((d) => (
                <Chip
                  key={d}
                  active={query.domains.includes(d)}
                  onClick={() => toggle('domains', d as Domain)}
                  color={DOMAIN_COLOR[d]}
                >
                  {d}
                </Chip>
              ))}
              <Chip
                active={query.domains.includes('Colorless')}
                onClick={() => toggle('domains', 'Colorless' as Domain)}
                color={DOMAIN_COLOR.Colorless}
              >
                Colorless
              </Chip>
            </Group>

            <Group label="Type">
              {CARD_TYPES.map((t) => (
                <Chip
                  key={t}
                  active={query.types.includes(t)}
                  onClick={() => toggle('types', t as CardType)}
                >
                  {t}
                </Chip>
              ))}
            </Group>

            <Group label="Energy cost">
              <div className="flex flex-wrap items-center gap-1.5">
                {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((n) => {
                  const exact = query.energyMin === n && query.energyMax === n;
                  const isMax = n === 8;
                  return (
                    <Chip
                      key={n}
                      active={exact}
                      onClick={() =>
                        onChange({
                          ...query,
                          energyMin: exact ? null : n,
                          energyMax: exact ? null : isMax ? null : n,
                        })
                      }
                    >
                      {isMax ? '8+' : n}
                    </Chip>
                  );
                })}
              </div>
            </Group>

            <Group label="Rarity">
              {RARITIES.map((r) => (
                <Chip
                  key={r}
                  active={query.rarities.includes(r)}
                  onClick={() => toggle('rarities', r as Rarity)}
                >
                  {r}
                </Chip>
              ))}
            </Group>

            <Group label="Set">
              {sets.map((s) => (
                <Chip
                  key={s.setId}
                  active={query.sets.includes(s.setId)}
                  onClick={() => toggle('sets', s.setId)}
                  title={s.name}
                >
                  {s.setId}
                  <span className="ml-1 text-[10px] text-muted">{s.cardCount}</span>
                </Chip>
              ))}
            </Group>

            <Group label="Keyword">
              {keywords.map((k) => (
                <Chip
                  key={k}
                  active={query.keywords.includes(k)}
                  onClick={() => toggle('keywords', k)}
                >
                  {k}
                </Chip>
              ))}
            </Group>

            <label className="flex cursor-pointer items-center gap-2 pt-1 text-sm text-muted">
              <input
                type="checkbox"
                checked={query.collapseVariants}
                onChange={(e) => onChange({ ...query, collapseVariants: e.target.checked })}
                className="size-4 accent-[var(--color-accent)]"
              />
              Group alternate art &amp; signature reprints
            </label>
          </div>
        </div>
      )}
    </div>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted">{label}</div>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

function Chip({
  active,
  onClick,
  color,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  color?: string;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
        active
          ? 'border-transparent text-ink'
          : 'border-line bg-surface text-muted hover:border-line-bright hover:text-bright'
      }`}
      style={active ? { background: color ?? 'var(--color-accent)' } : undefined}
    >
      {color && !active && (
        <span
          className="mr-1.5 inline-block size-2 rounded-full align-middle"
          style={{ background: color }}
        />
      )}
      {children}
    </button>
  );
}

function SearchIcon() {
  return (
    <svg
      className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
      <path d="m20 20-3.5-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function FilterIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M3 5h18l-7 8v6l-4 2v-8Z"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinejoin="round"
      />
    </svg>
  );
}
