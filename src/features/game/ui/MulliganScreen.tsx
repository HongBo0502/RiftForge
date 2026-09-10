import { useState } from 'react';
import type { Card } from '@/types';
import { cardImage } from '@/data/cards';
import { CostLine, MightGlyph } from '@/data/symbols';
import { useCardPreview } from './CardPreview';
import type { GameState, PlayerId } from '../engine/types';

/**
 * The pre-game mulligan. 117
 *
 * Not a London or Vancouver mulligan — a partial redraw. Set aside up to two
 * cards, draw that many replacements, and the set-aside cards go to the bottom
 * of your deck. Resolved in turn order, so only one player chooses at a time.
 */
export default function MulliganScreen({
  state,
  seat,
  lookup,
  onConfirm,
}: {
  state: GameState;
  /** Whose choice this is. */
  seat: PlayerId;
  lookup: (cardId: string) => Card | undefined;
  onConfirm: (swap: string[]) => void;
}) {
  const [swap, setSwap] = useState<string[]>([]);
  const { bind, preview } = useCardPreview();
  const hand = state.players[seat].hand;

  const toggle = (uid: string) =>
    setSwap((current) =>
      current.includes(uid)
        ? current.filter((u) => u !== uid)
        : current.length >= 2
          ? current // 117.1 — at most two
          : [...current, uid],
    );

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 text-center">
      {preview}

      <h1 className="text-xl font-semibold">Mulligan</h1>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted">
        Set aside up to two cards. You draw that many replacements, and the cards you set aside go
        to the bottom of your deck.
      </p>

      {/* Four cards at full size overflow a phone, so they shrink rather than scroll. */}
      <div className="mt-6 flex flex-wrap justify-center gap-2 sm:gap-3">
        {hand.map((uid) => {
          const card = lookup(state.instances[uid]?.cardId ?? '');
          const chosen = swap.includes(uid);
          const src = card ? cardImage(card, 'card') : null;

          return (
            <button
              key={uid}
              type="button"
              onClick={() => toggle(uid)}
              {...bind(card)}
              aria-pressed={chosen}
              aria-label={card?.name}
              className={`relative aspect-[744/1039] w-[calc(50%-0.5rem)] max-w-[124px] shrink-0 overflow-hidden rounded-lg border-2 piece transition-transform sm:w-[108px] ${
                chosen
                  ? 'translate-y-2 border-fury opacity-60'
                  : 'border-line hover:-translate-y-1 hover:border-accent'
              }`}
            >
              {src ? (
                <img src={src} alt="" className="h-full w-full object-cover" />
              ) : (
                <span className="block p-2 text-xs">{card?.baseName}</span>
              )}

              {card && (
                <span className="absolute left-1 top-1 rounded bg-ink/85 px-1">
                  <CostLine
                    energy={card.energy}
                    power={card.power}
                    domains={card.domains}
                    size={14}
                  />
                </span>
              )}
              {card?.might !== null && card?.might !== undefined && (
                <span className="absolute right-1 top-1 flex items-center gap-0.5 rounded bg-ink/85 px-1">
                  <MightGlyph size={11} />
                  <span className="text-[11px] font-bold tabular-nums">{card.might}</span>
                </span>
              )}

              {chosen && (
                <span className="absolute inset-x-0 bottom-0 bg-fury py-0.5 text-[10px] font-bold uppercase tracking-wider text-ink">
                  Set aside
                </span>
              )}
            </button>
          );
        })}
      </div>

      <p className="mt-4 text-xs text-muted">
        {swap.length === 0
          ? 'Keeping all four.'
          : `Swapping ${swap.length} card${swap.length === 1 ? '' : 's'}.`}
      </p>

      <button
        type="button"
        onClick={() => onConfirm(swap)}
        className="mt-4 rounded-lg bg-accent px-6 py-3 text-sm font-semibold text-ink"
      >
        {swap.length === 0 ? 'Keep this hand' : `Swap ${swap.length}`}
      </button>
    </div>
  );
}
