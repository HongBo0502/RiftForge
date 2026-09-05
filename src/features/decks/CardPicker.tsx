import { useMemo, useState } from 'react';
import type { Card } from '@/types';
import { nameKey } from '@/types';
import { cardImage, preferredPrinting } from '@/data/cards';
import { CostLine, DOMAIN_COLOR, MightGlyph } from '@/data/symbols';

interface Props {
  /** Candidates, already narrowed to what this slot accepts. */
  cards: Card[];
  onPick: (card: Card) => void;
  /** Copies of this card already in the deck, shown on the row. */
  countFor?: (card: Card) => number;
  /** Why a card can't be added right now — disables the row and explains. */
  disabledReason?: (card: Card) => string | null;
  placeholder?: string;
  emptyHint?: string;
}

const MAX_ROWS = 40;

/**
 * Searchable list for adding cards to a deck slot. Deliberately a compact row
 * list rather than the art grid used for browsing: while building you are
 * scanning names, costs and counts, not looking at illustrations.
 */
export default function CardPicker({
  cards,
  onPick,
  countFor,
  disabledReason,
  placeholder = 'Search cards…',
  emptyHint = 'No cards match.',
}: Props) {
  const [text, setText] = useState('');

  // One row per card, not per printing — reprints are the same card here.
  const unique = useMemo(() => {
    const groups = new Map<string, Card[]>();
    for (const c of cards) {
      const key = nameKey(c.baseName);
      const group = groups.get(key);
      if (group) group.push(c);
      else groups.set(key, [c]);
    }
    return [...groups.values()].map(preferredPrinting);
  }, [cards]);

  const results = useMemo(() => {
    const needle = text.trim().toLowerCase();
    const matched = needle
      ? unique.filter(
          (c) =>
            c.name.toLowerCase().includes(needle) ||
            (c.text ?? '').toLowerCase().includes(needle) ||
            c.tags.some((t) => t.toLowerCase().includes(needle)),
        )
      : unique;
    return matched
      .slice()
      .sort((a, b) => (a.energy ?? 99) - (b.energy ?? 99) || a.name.localeCompare(b.name))
      .slice(0, MAX_ROWS);
  }, [unique, text]);

  return (
    <div className="flex min-h-0 flex-col">
      <input
        type="search"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        className="mb-2 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm placeholder:text-muted focus:border-accent focus:outline-none"
        aria-label={placeholder}
      />

      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
        {results.length === 0 && <p className="py-6 text-center text-sm text-muted">{emptyHint}</p>}

        {results.map((card) => {
          const count = countFor?.(card) ?? 0;
          const reason = disabledReason?.(card) ?? null;
          const accent = DOMAIN_COLOR[card.domains[0] ?? 'Colorless'];
          const src = cardImage(card, 'thumb');

          return (
            <button
              key={card.id}
              type="button"
              disabled={Boolean(reason)}
              title={reason ?? `Add ${card.name}`}
              onClick={() => onPick(card)}
              className="flex w-full items-center gap-2 rounded-lg border border-line bg-surface p-1.5 text-left transition-colors enabled:hover:border-line-bright disabled:cursor-not-allowed disabled:opacity-40"
            >
              {src && (
                <img
                  src={src}
                  alt=""
                  loading="lazy"
                  className="h-11 w-8 shrink-0 rounded object-cover"
                  style={{ borderLeft: `2px solid ${accent}` }}
                />
              )}

              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{card.name}</span>
                <span className="block truncate text-xs text-muted">
                  {[card.supertype, card.type].filter(Boolean).join(' ')} · {card.setId}
                </span>
              </span>

              <span className="flex shrink-0 items-center gap-1.5">
                <CostLine
                  energy={card.energy}
                  power={card.power}
                  domains={card.domains}
                  size={14}
                />
                {card.might !== null && (
                  <span className="flex items-center gap-0.5">
                    <MightGlyph size={12} />
                    <span className="text-xs font-bold tabular-nums">{card.might}</span>
                  </span>
                )}
                {count > 0 && (
                  <span className="rounded bg-accent px-1.5 text-xs font-bold text-ink tabular-nums">
                    {count}
                  </span>
                )}
              </span>
            </button>
          );
        })}

        {results.length === MAX_ROWS && (
          <p className="py-2 text-center text-xs text-muted">
            Showing the first {MAX_ROWS} — keep typing to narrow.
          </p>
        )}
      </div>
    </div>
  );
}
