import { useMemo, useState } from 'react';
import type { Card } from '@/types';
import { nameKey } from '@/types';
import type { Dataset } from '@/data/cards';
import { cardImage } from '@/data/cards';
import { CostLine, DOMAIN_COLOR, MightGlyph } from '@/data/symbols';
import CardPicker from './CardPicker';
import { formatDecklist } from './parse';
import type { Deck, DeckEntry } from './types';
import { countCards } from './types';
import {
  BATTLEFIELDS_PER_DECK,
  MAIN_DECK_MIN,
  MAX_COPIES,
  MAX_SIGNATURE,
  RUNE_DECK_SIZE,
  inIdentity,
  validateDeck,
} from './validate';

type Tab = 'legend' | 'main' | 'runes' | 'battlefields';

interface Props {
  deck: Deck;
  dataset: Dataset;
  onChange: (deck: Deck) => void;
  onBack: () => void;
  onDelete: () => void;
}

export default function DeckBuilder({ deck, dataset, onChange, onBack, onDelete }: Props) {
  const [tab, setTab] = useState<Tab>('legend');
  const [copied, setCopied] = useState(false);

  const validation = useMemo(() => validateDeck(deck, dataset.byId), [deck, dataset.byId]);
  const legend = deck.legendId ? dataset.byId.get(deck.legendId) : undefined;
  const identity = new Set(validation.identity);

  // ---- mutations ---------------------------------------------------------
  const update = (patch: Partial<Deck>) => onChange({ ...deck, ...patch });

  const bump = (list: DeckEntry[], card: Card, delta: number): DeckEntry[] => {
    const next = list.map((e) => ({ ...e }));
    const found = next.find((e) => e.cardId === card.id);
    if (found) {
      found.qty += delta;
      return next.filter((e) => e.qty > 0);
    }
    return delta > 0 ? [...next, { cardId: card.id, qty: delta }] : next;
  };

  /** Copies of a card already in a list, counted across every printing. */
  const copiesOf = (list: DeckEntry[], card: Card): number => {
    const key = nameKey(card.baseName);
    return list.reduce((sum, e) => {
      const c = dataset.byId.get(e.cardId);
      return c && nameKey(c.baseName) === key ? sum + e.qty : sum;
    }, 0);
  };

  // ---- candidate pools ---------------------------------------------------
  const pools = useMemo(() => {
    const all = dataset.cards;
    const legal = (c: Card) => !legend || inIdentity(c, identity);
    return {
      legend: all.filter((c) => c.type === 'Legend'),
      champion: all.filter(
        (c) =>
          c.type === 'Unit' &&
          c.supertype === 'Champion' &&
          (!legend || c.tags.some((t) => legend.tags.includes(t))),
      ),
      main: all.filter((c) => ['Unit', 'Spell', 'Gear'].includes(c.type ?? '') && legal(c)),
      runes: all.filter((c) => c.type === 'Rune' && legal(c)),
      battlefields: all.filter((c) => c.type === 'Battlefield' && legal(c)),
    };
  }, [dataset.cards, legend, identity]);

  const signatureCount = validation.signatureCount;

  /** Explains why a main-deck card can't be added, or null if it can. */
  const mainDisabled = (card: Card): string | null => {
    if (copiesOf(deck.main, card) >= MAX_COPIES) return `Already ${MAX_COPIES} copies (103.2.b)`;
    const isSignature = card.signature || card.supertype === 'Signature';
    if (isSignature && signatureCount >= MAX_SIGNATURE) {
      return `Already ${MAX_SIGNATURE} signature cards (103.2.d.1)`;
    }
    if (isSignature && legend && !card.tags.some((t) => legend.tags.includes(t))) {
      return `Signature cards must share ${legend.baseName}'s tag (103.2.d.2)`;
    }
    return null;
  };

  async function copyList() {
    try {
      await navigator.clipboard.writeText(formatDecklist(deck, dataset.byId));
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  const TABS: { key: Tab; label: string; count: string; ok: boolean }[] = [
    {
      key: 'legend',
      label: 'Legend',
      count: legend ? '1' : '0',
      ok: Boolean(legend && deck.championId),
    },
    {
      key: 'main',
      label: 'Main',
      count: `${validation.mainCount}`,
      ok: validation.mainCount >= MAIN_DECK_MIN,
    },
    {
      key: 'runes',
      label: 'Runes',
      count: `${validation.runeCount}/${RUNE_DECK_SIZE}`,
      ok: validation.runeCount === RUNE_DECK_SIZE,
    },
    {
      key: 'battlefields',
      label: 'Fields',
      count: `${deck.battlefields.length}/${BATTLEFIELDS_PER_DECK}`,
      ok: deck.battlefields.length === BATTLEFIELDS_PER_DECK,
    },
  ];

  return (
    <div className="mx-auto max-w-7xl px-4 py-4">
      {/* Header */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onBack}
          className="rounded-lg border border-line bg-surface px-2.5 py-2 text-muted hover:text-bright"
          aria-label="Back to decks"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path d="M15 5 8 12l7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>

        <input
          value={deck.name}
          onChange={(e) => update({ name: e.target.value })}
          className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-base font-semibold focus:border-accent focus:outline-none"
          aria-label="Deck name"
        />

        <span
          className={`rounded-lg px-2.5 py-2 text-xs font-semibold ${
            validation.legal ? 'bg-calm/20 text-calm' : 'bg-fury/15 text-fury'
          }`}
        >
          {validation.legal ? 'Legal' : `${validation.issues.filter((i) => i.level === 'error').length} issues`}
        </span>

        <button
          type="button"
          onClick={copyList}
          className="rounded-lg border border-line bg-surface px-3 py-2 text-xs font-medium text-muted hover:text-bright"
        >
          {copied ? 'Copied' : 'Export'}
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="rounded-lg border border-line bg-surface px-3 py-2 text-xs font-medium text-muted hover:border-fury hover:text-fury"
        >
          Delete
        </button>
      </div>

      {/* Identity + tabs */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {validation.identity.length > 0 ? (
          validation.identity.map((d) => (
            <span
              key={d}
              className="rounded-full px-2.5 py-0.5 text-xs font-semibold text-ink"
              style={{ background: DOMAIN_COLOR[d] }}
            >
              {d}
            </span>
          ))
        ) : (
          <span className="text-xs text-muted">Pick a Legend to set your domain identity.</span>
        )}
      </div>

      <div className="mb-3 flex gap-1 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              tab === t.key ? 'bg-surface-2 text-bright' : 'text-muted hover:bg-surface'
            }`}
          >
            {t.label}
            <span className={`text-xs tabular-nums ${t.ok ? 'text-calm' : 'text-muted'}`}>
              {t.count}
            </span>
          </button>
        ))}
      </div>

      {/* Issues */}
      {validation.issues.length > 0 && (
        <ul className="mb-3 space-y-1 rounded-lg border border-line bg-surface p-3 text-xs">
          {validation.issues.slice(0, 6).map((issue, i) => (
            <li key={i} className="flex gap-2">
              <span className={issue.level === 'error' ? 'text-fury' : 'text-order'}>
                {issue.level === 'error' ? '✕' : '!'}
              </span>
              <span className="text-muted">
                {issue.message}
                {issue.rule && <span className="ml-1 opacity-60">({issue.rule})</span>}
              </span>
            </li>
          ))}
          {validation.issues.length > 6 && (
            <li className="text-muted opacity-70">+{validation.issues.length - 6} more…</li>
          )}
        </ul>
      )}

      {/* Contents + picker */}
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-lg border border-line bg-surface/50 p-3">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
            In this deck
          </h2>

          {tab === 'legend' && (
            <div className="space-y-3">
              <SlotRow
                label="Champion Legend"
                card={legend}
                byId={dataset.byId}
                onClear={() => update({ legendId: null })}
              />
              <SlotRow
                label="Chosen Champion"
                card={deck.championId ? dataset.byId.get(deck.championId) : undefined}
                byId={dataset.byId}
                onClear={() => update({ championId: null })}
              />
            </div>
          )}

          {tab === 'main' && (
            <EntryList
              entries={deck.main}
              byId={dataset.byId}
              emptyText={`Add at least ${MAIN_DECK_MIN} cards.`}
              onAdd={(c) => update({ main: bump(deck.main, c, 1) })}
              onRemove={(c) => update({ main: bump(deck.main, c, -1) })}
              canAdd={(c) => mainDisabled(c) === null}
            />
          )}

          {tab === 'runes' && (
            <EntryList
              entries={deck.runes}
              byId={dataset.byId}
              emptyText={`Add exactly ${RUNE_DECK_SIZE} runes.`}
              onAdd={(c) => update({ runes: bump(deck.runes, c, 1) })}
              onRemove={(c) => update({ runes: bump(deck.runes, c, -1) })}
              canAdd={() => validation.runeCount < RUNE_DECK_SIZE}
            />
          )}

          {tab === 'battlefields' && (
            <div className="space-y-1">
              {deck.battlefields.length === 0 && (
                <p className="py-4 text-center text-sm text-muted">
                  Choose {BATTLEFIELDS_PER_DECK} battlefields. One is picked at random at setup.
                </p>
              )}
              {deck.battlefields.map((id, i) => {
                const card = dataset.byId.get(id);
                if (!card) return null;
                return (
                  <CardRow
                    key={`${id}-${i}`}
                    card={card}
                    onRemove={() =>
                      update({ battlefields: deck.battlefields.filter((_, n) => n !== i) })
                    }
                  />
                );
              })}
            </div>
          )}
        </section>

        <section className="flex max-h-[70dvh] min-h-[22rem] flex-col rounded-lg border border-line bg-surface/50 p-3">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
            {tab === 'legend' ? 'Choose legend & champion' : `Add ${tab}`}
          </h2>

          {tab === 'legend' && !legend && (
            <CardPicker
              cards={pools.legend}
              onPick={(c) => update({ legendId: c.id })}
              placeholder="Search legends…"
            />
          )}

          {tab === 'legend' && legend && (
            <CardPicker
              cards={pools.champion}
              onPick={(c) =>
                update({
                  championId: c.id,
                  // The champion is part of the main deck (103.2), so add a copy.
                  main: deck.main.some((e) => e.cardId === c.id)
                    ? deck.main
                    : [...deck.main, { cardId: c.id, qty: 1 }],
                })
              }
              placeholder={`Champion units tagged ${legend.tags.join(', ') || '—'}…`}
              emptyHint="No champion unit shares a tag with this legend."
            />
          )}

          {tab === 'main' && (
            <CardPicker
              cards={pools.main}
              onPick={(c) => update({ main: bump(deck.main, c, 1) })}
              countFor={(c) => copiesOf(deck.main, c)}
              disabledReason={mainDisabled}
              placeholder="Search units, spells, gear…"
              emptyHint={legend ? 'Nothing matches inside your identity.' : 'Pick a Legend first.'}
            />
          )}

          {tab === 'runes' && (
            <CardPicker
              cards={pools.runes}
              onPick={(c) => update({ runes: bump(deck.runes, c, 1) })}
              countFor={(c) => copiesOf(deck.runes, c)}
              disabledReason={() =>
                validation.runeCount >= RUNE_DECK_SIZE ? `Rune deck is full (${RUNE_DECK_SIZE})` : null
              }
              placeholder="Search runes…"
            />
          )}

          {tab === 'battlefields' && (
            <CardPicker
              cards={pools.battlefields}
              onPick={(c) => update({ battlefields: [...deck.battlefields, c.id] })}
              countFor={(c) =>
                deck.battlefields.filter((id) => dataset.byId.get(id)?.baseName === c.baseName).length
              }
              disabledReason={(c) => {
                if (deck.battlefields.length >= BATTLEFIELDS_PER_DECK) return 'Already have 3';
                return deck.battlefields.some((id) => dataset.byId.get(id)?.baseName === c.baseName)
                  ? 'No duplicate battlefields (103.4.c)'
                  : null;
              }}
              placeholder="Search battlefields…"
            />
          )}
        </section>
      </div>
    </div>
  );
}

function SlotRow({
  label,
  card,
  onClear,
}: {
  label: string;
  card: Card | undefined;
  byId: Map<string, Card>;
  onClear: () => void;
}) {
  return (
    <div>
      <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted">{label}</div>
      {card ? (
        <CardRow card={card} onRemove={onClear} />
      ) : (
        <p className="rounded-lg border border-dashed border-line px-3 py-3 text-sm text-muted">
          Not chosen yet.
        </p>
      )}
    </div>
  );
}

function CardRow({
  card,
  qty,
  onAdd,
  onRemove,
  canAdd = true,
}: {
  card: Card;
  qty?: number;
  onAdd?: () => void;
  onRemove: () => void;
  canAdd?: boolean;
}) {
  const src = cardImage(card, 'thumb');
  const accent = DOMAIN_COLOR[card.domains[0] ?? 'Colorless'];
  return (
    <div className="flex items-center gap-2 rounded-lg border border-line bg-surface p-1.5">
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
          {[card.supertype, card.type].filter(Boolean).join(' ')}
        </span>
      </span>

      <CostLine energy={card.energy} power={card.power} domains={card.domains} size={14} />
      {card.might !== null && (
        <span className="flex items-center gap-0.5">
          <MightGlyph size={12} />
          <span className="text-xs font-bold tabular-nums">{card.might}</span>
        </span>
      )}

      <span className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={onRemove}
          className="size-7 rounded border border-line text-muted hover:border-fury hover:text-fury"
          aria-label={`Remove ${card.name}`}
        >
          −
        </button>
        {qty !== undefined && (
          <span className="w-5 text-center text-sm font-bold tabular-nums">{qty}</span>
        )}
        {onAdd && (
          <button
            type="button"
            onClick={onAdd}
            disabled={!canAdd}
            className="size-7 rounded border border-line text-muted enabled:hover:border-accent enabled:hover:text-accent disabled:opacity-30"
            aria-label={`Add ${card.name}`}
          >
            +
          </button>
        )}
      </span>
    </div>
  );
}

function EntryList({
  entries,
  byId,
  emptyText,
  onAdd,
  onRemove,
  canAdd,
}: {
  entries: DeckEntry[];
  byId: Map<string, Card>;
  emptyText: string;
  onAdd: (card: Card) => void;
  onRemove: (card: Card) => void;
  canAdd: (card: Card) => boolean;
}) {
  if (entries.length === 0) {
    return <p className="py-6 text-center text-sm text-muted">{emptyText}</p>;
  }

  const rows = entries
    .map((e) => ({ card: byId.get(e.cardId), qty: e.qty }))
    .filter((r): r is { card: Card; qty: number } => Boolean(r.card))
    .sort(
      (a, b) => (a.card.energy ?? 99) - (b.card.energy ?? 99) || a.card.name.localeCompare(b.card.name),
    );

  return (
    <div className="max-h-[60dvh] space-y-1 overflow-y-auto pr-1">
      <p className="pb-1 text-xs text-muted">{countCards(entries)} cards</p>
      {rows.map(({ card, qty }) => (
        <CardRow
          key={card.id}
          card={card}
          qty={qty}
          onAdd={() => onAdd(card)}
          onRemove={() => onRemove(card)}
          canAdd={canAdd(card)}
        />
      ))}
    </div>
  );
}
