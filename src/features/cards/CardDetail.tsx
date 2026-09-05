import { useEffect } from 'react';
import type { Card } from '@/types';
import { cardImage } from '@/data/cards';
import { CardText, CostLine, DOMAIN_COLOR, MightGlyph } from '@/data/symbols';

interface Props {
  card: Card;
  /** Every printing sharing this base name, so variants are reachable. */
  printings: Card[];
  onSelect: (card: Card) => void;
  onClose: () => void;
}

/**
 * Card detail. A centred dialog on desktop, a bottom sheet on mobile —
 * one component, since the only real difference is where it's anchored.
 */
export default function CardDetail({ card, printings, onSelect, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    // Stop the grid scrolling underneath the open sheet.
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const src = cardImage(card, 'full');
  const accent = DOMAIN_COLOR[card.domains[0] ?? 'Colorless'];

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/80 backdrop-blur-sm sm:items-center sm:p-6"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={card.name}
    >
      <div
        className="max-h-[92dvh] w-full max-w-4xl overflow-y-auto rounded-t-2xl border border-line bg-surface shadow-2xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Grab handle, mobile only. */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-surface/95 px-4 py-3 backdrop-blur">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold" style={{ color: accent }}>
              {card.name}
            </h2>
            <p className="truncate text-xs text-muted">
              {[card.supertype, card.type].filter(Boolean).join(' ')} · {card.setLabel} ·{' '}
              {card.rarity}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ml-3 shrink-0 rounded-lg border border-line bg-surface-2 p-2 text-muted transition-colors hover:text-bright"
            aria-label="Close"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="grid gap-5 p-4 sm:grid-cols-[minmax(0,320px)_1fr] sm:p-5">
          <div>
            {src ? (
              <img
                src={src}
                alt={card.name}
                className="w-full rounded-xl border border-line"
                style={{ aspectRatio: card.orientation === 'landscape' ? '1039 / 744' : '744 / 1039' }}
              />
            ) : (
              <div className="grid aspect-[744/1039] w-full place-items-center rounded-xl border border-line bg-surface-2 text-muted">
                No image
              </div>
            )}
            {card.artist && (
              <p className="mt-2 text-center text-xs text-muted">Art by {card.artist}</p>
            )}
          </div>

          <div className="min-w-0 space-y-4">
            <div className="flex flex-wrap items-center gap-4">
              {(card.energy !== null || card.power) && (
                <Stat label="Cost">
                  <CostLine
                    energy={card.energy}
                    power={card.power}
                    domains={card.domains}
                    size={20}
                  />
                </Stat>
              )}
              {card.might !== null && (
                <Stat label="Might">
                  <span className="flex items-center gap-1">
                    <MightGlyph size={18} />
                    <span className="text-lg font-bold tabular-nums">{card.might}</span>
                  </span>
                </Stat>
              )}
              <Stat label={card.domains.length > 1 ? 'Domains' : 'Domain'}>
                <span className="flex flex-wrap gap-1">
                  {card.domains.map((d) => (
                    <span
                      key={d}
                      className="rounded-full px-2 py-0.5 text-xs font-semibold text-ink"
                      style={{ background: DOMAIN_COLOR[d] }}
                    >
                      {d}
                    </span>
                  ))}
                </span>
              </Stat>
            </div>

            {card.text && (
              <div className="rounded-lg border border-line bg-ink/40 p-3 text-sm leading-relaxed">
                <CardText text={card.text} />
              </div>
            )}

            {card.flavour && (
              <p className="border-l-2 border-line-bright pl-3 text-sm italic text-muted">
                {card.flavour}
              </p>
            )}

            {card.tags.length > 0 && (
              <Stat label="Champion tags">
                <span className="flex flex-wrap gap-1">
                  {card.tags.map((t) => (
                    <span
                      key={t}
                      className="rounded border border-line-bright bg-surface-2 px-2 py-0.5 text-xs"
                    >
                      {t}
                    </span>
                  ))}
                </span>
              </Stat>
            )}

            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 border-t border-line pt-3 text-xs">
              <Meta label="Set" value={`${card.setLabel} (${card.setId})`} />
              <Meta label="Number" value={card.collectorNumber?.toString() ?? '—'} />
              <Meta label="Card ID" value={card.riftboundId ?? '—'} />
              <Meta label="Rarity" value={card.rarity ?? '—'} />
            </dl>

            {printings.length > 1 && (
              <div>
                <div className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted">
                  Other printings
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {printings.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => onSelect(p)}
                      className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                        p.id === card.id
                          ? 'border-accent bg-accent/15 text-accent'
                          : 'border-line bg-surface-2 text-muted hover:text-bright'
                      }`}
                    >
                      {p.setId}
                      {p.signature && ' ★'}
                      {p.alternateArt && ' alt'}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted">{label}</div>
      {children}
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-muted">{label}</dt>
      <dd className="truncate text-right font-medium">{value}</dd>
    </div>
  );
}
