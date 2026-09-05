import { memo } from 'react';
import type { Card } from '@/types';
import { cardImage, cardSrcSet } from '@/data/cards';
import { CostLine, DOMAIN_COLOR, MightGlyph } from '@/data/symbols';

/**
 * One card in the grid. The printed art already carries the name and stats, so
 * the overlays exist only to stay readable at thumbnail size, where the
 * printed text is a few pixels tall.
 */
function CardTileImpl({ card, onOpen }: { card: Card; onOpen: (card: Card) => void }) {
  const src = cardImage(card, 'thumb');
  const landscape = card.orientation === 'landscape';
  const accent = DOMAIN_COLOR[card.domains[0] ?? 'Colorless'];

  return (
    <button
      type="button"
      onClick={() => onOpen(card)}
      className="group relative block w-full overflow-hidden rounded-lg border border-line bg-surface text-left transition-transform duration-150 hover:-translate-y-0.5 hover:border-line-bright focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      style={{ aspectRatio: '744 / 1039' }}
      aria-label={card.name}
    >
      {src ? (
        <img
          src={src}
          srcSet={cardSrcSet(card, 'thumb')}
          sizes="(max-width: 640px) 45vw, (max-width: 1024px) 22vw, 180px"
          alt={card.name}
          loading="lazy"
          decoding="async"
          className={`h-full w-full ${landscape ? 'object-contain' : 'object-cover'}`}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center p-2 text-center text-xs text-muted">
          {card.name}
        </div>
      )}

      {/* Cost, top-left — the number you scan for when browsing. */}
      {(card.energy !== null || card.power) && (
        <div className="absolute left-1.5 top-1.5 rounded-md bg-ink/80 px-1 py-0.5 backdrop-blur-sm">
          <CostLine energy={card.energy} power={card.power} domains={card.domains} size={15} />
        </div>
      )}

      {/* Might, top-right. */}
      {card.might !== null && (
        <div className="absolute right-1.5 top-1.5 flex items-center gap-0.5 rounded-md bg-ink/80 px-1 py-0.5 backdrop-blur-sm">
          <MightGlyph size={13} />
          <span className="text-xs font-bold tabular-nums">{card.might}</span>
        </div>
      )}

      {/* Name bar, revealed on hover/focus so it never hides the art by default. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 translate-y-full bg-gradient-to-t from-ink via-ink/95 to-transparent px-2 pb-1.5 pt-4 transition-transform duration-150 group-hover:translate-y-0 group-focus-visible:translate-y-0">
        <div className="truncate text-xs font-semibold" style={{ color: accent }}>
          {card.name}
        </div>
        <div className="truncate text-[10px] text-muted">
          {card.setId} · {card.type}
        </div>
      </div>
    </button>
  );
}

export const CardTile = memo(CardTileImpl);
