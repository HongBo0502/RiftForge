import type { Card } from '@/types';
import { cardImage } from '@/data/cards';
import { CostLine, DOMAIN_COLOR, MightGlyph, RuneGlyph } from '@/data/symbols';
import type { UnitState } from '../engine/types';

/** Small shared pieces for the board. */

export function UnitChip({
  card,
  unit,
  might,
  selected,
  onClick,
}: {
  card: Card | undefined;
  unit: UnitState;
  might: number;
  selected?: boolean;
  onClick?: () => void;
}) {
  const src = card ? cardImage(card, 'thumb') : null;
  const accent = DOMAIN_COLOR[card?.domains[0] ?? 'Colorless'];
  const boosted = might !== (card?.might ?? 0);

  return (
    <button
      type="button"
      onClick={onClick}
      title={card?.name}
      className={`relative shrink-0 overflow-hidden rounded-md border-2 transition-all ${
        selected ? 'border-accent ring-2 ring-accent/40' : 'border-line'
      } ${unit.ready ? '' : 'rotate-6 opacity-70'}`}
      style={{ width: 46, height: 64 }}
      aria-label={`${card?.name ?? 'Unit'}, ${might} might${unit.ready ? '' : ', exhausted'}`}
    >
      {src ? (
        <img src={src} alt="" className="h-full w-full object-cover" loading="lazy" />
      ) : (
        <span className="block p-1 text-[9px]">{card?.baseName}</span>
      )}

      <span
        className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-0.5 bg-ink/85 py-px"
        style={{ borderTop: `2px solid ${accent}` }}
      >
        <MightGlyph size={10} />
        <span className={`text-[10px] font-bold tabular-nums ${boosted ? 'text-order' : ''}`}>
          {might}
        </span>
      </span>

      {unit.damage > 0 && (
        <span className="absolute right-0 top-0 bg-fury px-1 text-[9px] font-bold text-ink">
          {unit.damage}
        </span>
      )}
      {unit.designation && (
        <span
          className={`absolute left-0 top-0 px-1 text-[8px] font-bold uppercase ${
            unit.designation === 'attacker' ? 'bg-fury text-ink' : 'bg-mind text-ink'
          }`}
        >
          {unit.designation === 'attacker' ? 'ATK' : 'DEF'}
        </span>
      )}
    </button>
  );
}

export function HandCard({
  card,
  playable,
  reason,
  onClick,
}: {
  card: Card | undefined;
  playable: boolean;
  reason?: string | null;
  onClick: () => void;
}) {
  const src = card ? cardImage(card, 'thumb') : null;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!playable}
      title={reason ?? card?.name}
      className={`relative shrink-0 overflow-hidden rounded-lg border transition-transform ${
        playable ? 'border-line hover:-translate-y-1.5 hover:border-accent' : 'border-line opacity-45'
      }`}
      style={{ width: 68, height: 95 }}
      aria-label={card?.name}
    >
      {src ? (
        <img src={src} alt="" className="h-full w-full object-cover" loading="lazy" />
      ) : (
        <span className="block p-1 text-[10px]">{card?.baseName}</span>
      )}
      {card && (
        <span className="absolute left-0.5 top-0.5 rounded bg-ink/85 px-0.5">
          <CostLine energy={card.energy} power={card.power} domains={card.domains} size={12} />
        </span>
      )}
    </button>
  );
}

/** A face-down card — the opponent's hand, or a hidden card at a battlefield. */
export function FaceDownCard({ label, small }: { label?: string; small?: boolean }) {
  return (
    <div
      className="relative shrink-0 rounded-md border border-line-bright bg-surface-2"
      style={{ width: small ? 46 : 40, height: small ? 64 : 56 }}
      title={label}
    >
      <div className="grid h-full place-items-center opacity-40">
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 2 22 12 12 22 2 12Z" fill="none" stroke="currentColor" strokeWidth="2" />
        </svg>
      </div>
      {label && (
        <span className="absolute inset-x-0 bottom-0 bg-ink/80 text-center text-[8px] text-muted">
          {label}
        </span>
      )}
    </div>
  );
}

export function RuneRow({
  runes,
  onExhaust,
  onRecycle,
  interactive,
}: {
  runes: { uid: string; ready: boolean; domain: string }[];
  onExhaust: (uid: string) => void;
  onRecycle: (uid: string) => void;
  interactive: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      {runes.length === 0 && <span className="text-xs text-muted">No runes channelled.</span>}
      {runes.map((rune) => (
        <span key={rune.uid} className="flex items-center">
          <button
            type="button"
            disabled={!interactive || !rune.ready}
            onClick={() => onExhaust(rune.uid)}
            title={rune.ready ? 'Exhaust for 1 Energy' : 'Exhausted'}
            className={`rounded-l border border-line px-1 py-0.5 ${
              rune.ready ? 'bg-surface hover:border-accent' : 'bg-surface-2 opacity-40'
            }`}
            aria-label={`Exhaust ${rune.domain} rune`}
          >
            <RuneGlyph domain={rune.domain as never} size={15} />
          </button>
          <button
            type="button"
            disabled={!interactive}
            onClick={() => onRecycle(rune.uid)}
            title={`Recycle for 1 ${rune.domain} Power`}
            className="rounded-r border border-l-0 border-line bg-surface px-1 py-0.5 text-[10px] text-muted hover:border-accent hover:text-accent disabled:opacity-40"
            aria-label={`Recycle ${rune.domain} rune`}
          >
            ♻
          </button>
        </span>
      ))}
    </div>
  );
}
