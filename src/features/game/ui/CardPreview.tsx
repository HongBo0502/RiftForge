import { useEffect, useState } from 'react';
import type { Card } from '@/types';
import { cardImage } from '@/data/cards';
import { CardText, CostLine, DOMAIN_COLOR, MightGlyph, renderCardText } from '@/data/symbols';
import { allMarkers, unautomatedText } from '../engine/keywords';
import { AUTOMATED_KEYWORDS } from '../engine/keywords';

/** Reminder text for the keywords the engine acts on, so hover explains them. */
const KEYWORD_REMINDER: Record<string, string> = {
  Assault: "+N :rb_might: while I'm an attacker.",
  Shield: "+N :rb_might: while I'm a defender.",
  Tank: 'I must be assigned combat damage first.',
  Backline: 'I must be assigned combat damage last.',
  Ganking: 'I can move from battlefield to battlefield.',
};

/**
 * Detail panel shown while hovering a card on the mat.
 *
 * Deliberately anchored beside the card rather than over it — you are comparing
 * the panel against the board, so covering the thing you pointed at defeats the
 * purpose. Opens after a delay so sweeping across the mat doesn't strobe.
 */
export default function CardPreview({
  card,
  anchor,
}: {
  card: Card;
  /** Viewport rect of the hovered element. */
  anchor: DOMRect;
}) {
  const src = cardImage(card, 'full');
  const accent = DOMAIN_COLOR[card.domains[0] ?? 'Colorless'];
  const manual = unautomatedText(card);

  const keywords = allMarkers(card)
    .map((m) => m.replace(/\s+\d+$/, ''))
    .filter((m, i, all) => all.indexOf(m) === i)
    .filter((m) => AUTOMATED_KEYWORDS.some((k) => k.toLowerCase() === m.toLowerCase()));

  // Prefer the side with more room, and keep the panel on screen vertically.
  const width = 300;
  const gap = 12;
  const fitsRight = anchor.right + gap + width < window.innerWidth;
  const left = fitsRight ? anchor.right + gap : Math.max(gap, anchor.left - gap - width);
  const top = Math.min(Math.max(gap, anchor.top - 40), Math.max(gap, window.innerHeight - 520));

  return (
    <div
      className="pointer-events-none fixed z-50 rounded-xl border border-line-bright bg-surface/97 p-3 shadow-2xl backdrop-blur"
      style={{ left, top, width }}
      role="tooltip"
    >
      <div className="flex gap-3">
        {src && (
          <img
            src={src}
            alt=""
            className="w-[104px] shrink-0 rounded-md border border-line"
            style={{ aspectRatio: card.orientation === 'landscape' ? '1039/744' : '744/1039' }}
          />
        )}
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold" style={{ color: accent }}>
            {card.name}
          </p>
          <p className="truncate text-[11px] text-muted">
            {[card.supertype, card.type].filter(Boolean).join(' ')}
          </p>

          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <CostLine energy={card.energy} power={card.power} domains={card.domains} size={15} />
            {card.might !== null && (
              <span className="flex items-center gap-0.5">
                <MightGlyph size={13} />
                <span className="text-sm font-bold tabular-nums">{card.might}</span>
              </span>
            )}
          </div>

          <div className="mt-1.5 flex flex-wrap gap-1">
            {card.domains.map((d) => (
              <span
                key={d}
                className="rounded-full px-1.5 text-[10px] font-semibold text-ink"
                style={{ background: DOMAIN_COLOR[d] }}
              >
                {d}
              </span>
            ))}
          </div>
        </div>
      </div>

      {card.text && (
        <div className="mt-2.5 rounded-lg border border-line bg-ink/50 p-2 text-[12px] leading-relaxed">
          <CardText text={card.text} />
        </div>
      )}

      {keywords.length > 0 && (
        <ul className="mt-2 space-y-1">
          {keywords.map((k) => (
            <li key={k} className="text-[11px] text-muted">
              <span className="font-semibold text-calm">{k}</span>
              {KEYWORD_REMINDER[k] && <> — {renderCardText(KEYWORD_REMINDER[k], `kw-${k}`)}</>}
            </li>
          ))}
        </ul>
      )}

      {/*
       * The honesty marker. If the engine does not apply this card's text, say
       * so here rather than letting the board imply it resolved.
       */}
      {manual && (
        <p className="mt-2 rounded-md border border-order/40 bg-order/10 px-2 py-1 text-[11px] text-order">
          Not automated — apply by hand.
        </p>
      )}
    </div>
  );
}

/**
 * Hover/long-press plumbing for the preview. Returns props to spread onto a
 * card element, plus the element to render.
 */
export function useCardPreview(delay = 250) {
  const [state, setState] = useState<{ card: Card; anchor: DOMRect } | null>(null);
  const [timer, setTimer] = useState<number | null>(null);

  useEffect(() => () => { if (timer) window.clearTimeout(timer); }, [timer]);

  const clear = () => {
    if (timer) window.clearTimeout(timer);
    setTimer(null);
    setState(null);
  };

  const bind = (card: Card | undefined) => ({
    onPointerEnter: (e: React.PointerEvent<HTMLElement>) => {
      if (!card || e.pointerType === 'touch') return;
      const anchor = e.currentTarget.getBoundingClientRect();
      if (timer) window.clearTimeout(timer);
      setTimer(window.setTimeout(() => setState({ card, anchor }), delay));
    },
    onPointerLeave: clear,
    // Long-press is the touch equivalent; a plain tap still plays the card.
    onContextMenu: (e: React.MouseEvent<HTMLElement>) => {
      if (!card) return;
      e.preventDefault();
      setState({ card, anchor: e.currentTarget.getBoundingClientRect() });
    },
  });

  return {
    bind,
    clear,
    preview: state ? <CardPreview card={state.card} anchor={state.anchor} /> : null,
  };
}
