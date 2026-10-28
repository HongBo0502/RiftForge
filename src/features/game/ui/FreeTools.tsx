import { useState } from 'react';
import type { Card } from '@/types';
import { cardImage } from '@/data/cards';
import { CardText } from '@/data/symbols';
import type { ManualOp, ManualZone } from '../engine/manual';
import type { GameAction, GameState, PlayerId } from '../engine/types';

/**
 * The free board's controls. DESIGN.md "Free board"
 *
 * The rules engine still runs whenever an action has a rules form, but it no
 * longer gets the last word: anything it refuses can be done anyway, and
 * everything a card says can be applied by hand from here.
 */

/** The by-hand version of a rules action, offered when the engine refuses it. */
export function fallbackFor(action: GameAction): GameAction | null {
  switch (action.type) {
    case 'PLAY_CARD':
      return { type: 'MANUAL', op: { op: 'play', uid: action.uid, to: action.to } };
    case 'MOVE_UNIT':
      return { type: 'MANUAL', op: { op: 'move', uid: action.uid, to: action.to } };
    case 'EQUIP_GEAR':
      return { type: 'MANUAL', op: { op: 'attach', uid: action.uid, unitUid: action.unitUid } };
    default:
      return null;
  }
}

export interface Warning {
  reason: string;
  rule?: string;
  fallback: GameAction | null;
}

/** "The rules say no — do it anyway?" Replaces the old hard refusal. */
export function WarningBar({
  warning,
  onForce,
  onDismiss,
}: {
  warning: Warning;
  onForce: (action: GameAction) => void;
  onDismiss: () => void;
}) {
  return (
    <div className="mx-auto mt-2 flex max-w-6xl flex-wrap items-center gap-2 rounded-lg border border-order/50 bg-order/10 px-3 py-2 text-sm">
      <span className="min-w-0 flex-1 text-order">
        {warning.reason}
        {warning.rule && <span className="ml-1 opacity-70">({warning.rule})</span>}
      </span>
      {warning.fallback && (
        <button
          type="button"
          onClick={() => onForce(warning.fallback!)}
          className="rounded-md bg-order px-3 py-1 text-xs font-semibold text-ink"
        >
          Do it anyway
        </button>
      )}
      <button
        type="button"
        onClick={onDismiss}
        className="rounded-md border border-line px-2 py-1 text-xs text-muted"
      >
        {warning.fallback ? 'Cancel' : 'OK'}
      </button>
    </div>
  );
}

/** What is selected on the board: a card, or a battlefield by index. */
export type Pick = { kind: 'card'; uid: string } | { kind: 'battlefield'; index: number };

type Where = 'unit' | 'gear' | 'hand' | 'trash' | 'hidden' | 'other';

function whereIs(state: GameState, me: PlayerId, uid: string): Where {
  if (state.units[uid]) return 'unit';
  if (state.gear[uid]) return 'gear';
  if (state.hidden[uid]) return 'hidden';
  const p = state.players[me];
  if (p.hand.includes(uid) || p.championZone === uid) return 'hand';
  if (state.players.p1.trash.includes(uid) || state.players.p2.trash.includes(uid)) return 'trash';
  return 'other';
}

const btn =
  'rounded-md border border-line bg-surface-2 px-2 py-1 text-[11px] font-medium hover:border-accent disabled:opacity-40';
const primary = 'rounded-md bg-calm px-3 py-1 text-[11px] font-semibold text-ink';

/**
 * Everything that can be done with the selected card. Fixed to the bottom of
 * the screen so it is reachable with a thumb, and shows the card's text, since
 * a touch screen has no hover preview.
 */
export function ActionTray({
  pick,
  state,
  me,
  cardFor,
  onPlay,
  onSend,
  onManual,
  onClose,
}: {
  pick: Pick;
  state: GameState;
  me: PlayerId;
  cardFor: (uid: string) => Card | undefined;
  /** Play through the rules engine (pays the cost, runs the script). */
  onPlay: (uid: string) => void;
  /** Send a card to a zone — through the rules where they apply, else by hand. */
  onSend: (uid: string, to: ManualZone) => void;
  onManual: (op: ManualOp) => void;
  onClose: () => void;
}) {
  const them: PlayerId = me === 'p1' ? 'p2' : 'p1';

  if (pick.kind === 'battlefield') {
    const bf = state.battlefields[pick.index];
    const card = cardFor(bf.uid);
    const set = (controller: PlayerId | null) =>
      onManual({ op: 'control', battlefield: pick.index, controller });
    return (
      <Tray title={card?.baseName ?? `Battlefield ${pick.index + 1}`} card={card} onClose={onClose}>
        <span className="mat-zone-label">Held by</span>
        <button type="button" className={btn} disabled={bf.controller === me} onClick={() => set(me)}>
          You
        </button>
        <button type="button" className={btn} disabled={bf.controller === them} onClick={() => set(them)}>
          Them
        </button>
        <button type="button" className={btn} disabled={bf.controller === null} onClick={() => set(null)}>
          Nobody
        </button>
      </Tray>
    );
  }

  const { uid } = pick;
  const card = cardFor(uid);
  const where = whereIs(state, me, uid);
  const unit = state.units[uid];
  const gear = state.gear[uid];
  const piece = unit ?? gear;
  const boardTargets = (
    <>
      <span className="mat-zone-label">To</span>
      <button type="button" className={btn} onClick={() => onSend(uid, { kind: 'base', player: me })}>
        Your base
      </button>
      {card?.type === 'Unit' &&
        state.battlefields.map((_, index) => (
          <button
            key={index}
            type="button"
            className={btn}
            onClick={() => onSend(uid, { kind: 'battlefield', index })}
          >
            Battlefield {index + 1}
          </button>
        ))}
    </>
  );
  const offBoard = (
    <>
      <button type="button" className={btn} onClick={() => onSend(uid, { kind: 'hand' })}>
        Hand
      </button>
      <button type="button" className={btn} onClick={() => onSend(uid, { kind: 'trash' })}>
        Trash
      </button>
      <button type="button" className={btn} onClick={() => onSend(uid, { kind: 'deckTop' })}>
        Deck top
      </button>
      <button type="button" className={btn} onClick={() => onSend(uid, { kind: 'deckBottom' })}>
        Deck bottom
      </button>
    </>
  );

  return (
    <Tray title={card?.name ?? 'Card'} card={card} onClose={onClose}>
      {where === 'hand' && (
        <>
          <button type="button" className={primary} onClick={() => onPlay(uid)}>
            Play
          </button>
          {card?.type !== 'Spell' && boardTargets}
          <span className="mat-zone-label">Or</span>
          <button type="button" className={btn} onClick={() => onSend(uid, { kind: 'trash' })}>
            Discard
          </button>
          <button type="button" className={btn} onClick={() => onSend(uid, { kind: 'deckTop' })}>
            Deck top
          </button>
          <button type="button" className={btn} onClick={() => onSend(uid, { kind: 'deckBottom' })}>
            Deck bottom
          </button>
        </>
      )}

      {piece && (
        <button type="button" className={btn} onClick={() => onManual({ op: 'ready', uid })}>
          {piece.ready ? 'Exhaust' : 'Ready'}
        </button>
      )}

      {unit && (
        <>
          <Stepper
            label={`Damage ${unit.damage}`}
            onMinus={() => onManual({ op: 'damage', uid, delta: -1 })}
            onPlus={() => onManual({ op: 'damage', uid, delta: 1 })}
          />
          <Stepper
            label={`Buffs ${unit.buffs}`}
            onMinus={() => onManual({ op: 'buff', uid, delta: -1 })}
            onPlus={() => onManual({ op: 'buff', uid, delta: 1 })}
          />
          <button type="button" className={btn} onClick={() => onManual({ op: 'stun', uid })}>
            {unit.stunned ? 'Unstun' : 'Stun'}
          </button>
          <button type="button" className={btn} onClick={() => onManual({ op: 'empower', uid })}>
            {unit.empowered ? 'Disempower' : 'Empower'}
          </button>
          {boardTargets}
          {offBoard}
        </>
      )}

      {gear && (
        <>
          {gear.attachedTo && (
            <button
              type="button"
              className={btn}
              onClick={() => onManual({ op: 'attach', uid, unitUid: null })}
            >
              Detach
            </button>
          )}
          {offBoard}
        </>
      )}

      {(where === 'trash' || where === 'hidden') && (
        <>
          {card?.type !== 'Spell' && boardTargets}
          {offBoard}
        </>
      )}
    </Tray>
  );
}

function Tray({
  title,
  card,
  onClose,
  children,
}: {
  title: string;
  card: Card | undefined;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const src = card ? cardImage(card, 'thumb') : null;
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line-bright bg-surface/95 shadow-2xl backdrop-blur">
      <div className="mx-auto flex max-w-6xl gap-3 px-4 py-2.5">
        {src && (
          <img src={src} alt="" className="hidden h-24 w-[68px] shrink-0 rounded-md object-cover sm:block" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold">{title}</span>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="ml-auto rounded-md border border-line px-2 py-0.5 text-xs text-muted"
            >
              ✕
            </button>
          </div>
          {card?.text && (
            <div className="mt-1 line-clamp-3 text-[11px] leading-snug text-muted">
              <CardText text={card.text} />
            </div>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">{children}</div>
        </div>
      </div>
    </div>
  );
}

function Stepper({
  label,
  onMinus,
  onPlus,
}: {
  label: string;
  onMinus: () => void;
  onPlus: () => void;
}) {
  return (
    <span className="flex items-center overflow-hidden rounded-md border border-line text-[11px]">
      <button
        type="button"
        onClick={onMinus}
        aria-label={`${label}, minus one`}
        className="bg-surface-2 px-2 py-1 hover:text-accent"
      >
        −
      </button>
      <span className="px-2 tabular-nums">{label}</span>
      <button
        type="button"
        onClick={onPlus}
        aria-label={`${label}, plus one`}
        className="bg-surface-2 px-2 py-1 hover:text-accent"
      >
        +
      </button>
    </span>
  );
}

type Panel = 'counters' | 'trash';

/**
 * Table tools: the things a player does with their hands at a real table.
 * Draw, shuffle, channel, keep score — and undo a misclick.
 */
export function ToolBar({
  state,
  me,
  disabled,
  canUndo,
  onUndo,
  onManual,
  cardFor,
  onPickCard,
}: {
  state: GameState;
  me: PlayerId;
  disabled: boolean;
  canUndo: boolean;
  /** Absent online, where an action already sent cannot be taken back. */
  onUndo?: () => void;
  onManual: (op: ManualOp) => void;
  cardFor: (uid: string) => Card | undefined;
  onPickCard: (uid: string) => void;
}) {
  const [open, setOpen] = useState<Panel | null>(null);
  const them: PlayerId = me === 'p1' ? 'p2' : 'p1';
  const stuck = state.chain.length > 0 || Boolean(state.showdown);
  const toggle = (panel: Panel) => setOpen(open === panel ? null : panel);
  const trashCount = state.players[me].trash.length + state.players[them].trash.length;

  return (
    <div className="mx-auto mt-2 max-w-6xl rounded-lg border border-line bg-surface/60 px-2 py-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        {onUndo && (
          <button type="button" className={btn} disabled={!canUndo} onClick={onUndo}>
            ↶ Undo
          </button>
        )}
        <button type="button" className={btn} disabled={disabled} onClick={() => onManual({ op: 'draw', player: me })}>
          Draw
        </button>
        <button
          type="button"
          className={btn}
          disabled={disabled}
          onClick={() => onManual({ op: 'shuffle', player: me })}
        >
          Shuffle
        </button>
        <button
          type="button"
          className={btn}
          disabled={disabled}
          onClick={() => onManual({ op: 'channel', player: me })}
        >
          + Rune
        </button>
        {stuck && (
          <button
            type="button"
            className={btn}
            disabled={disabled}
            onClick={() => onManual({ op: 'clearStack' })}
            title="Empty the chain and close the showdown, if a card got stuck"
          >
            Clear chain
          </button>
        )}
        <button type="button" className={`${btn} ml-auto`} onClick={() => toggle('counters')}>
          Counters {open === 'counters' ? '▴' : '▾'}
        </button>
        <button type="button" className={btn} onClick={() => toggle('trash')}>
          Trash {trashCount} {open === 'trash' ? '▴' : '▾'}
        </button>
      </div>

      {open === 'counters' && (
        <div className="mt-1.5 flex flex-col gap-1.5">
          {([me, them] as PlayerId[]).map((who) => (
            <span key={who} className="flex flex-wrap items-center gap-1.5">
              <span
                className="mat-zone-label w-10"
                style={{ color: who === me ? 'var(--color-seat-you)' : 'var(--color-seat-them)' }}
              >
                {who === me ? 'You' : 'Them'}
              </span>
              {(['points', 'xp', 'energy'] as const).map((op) => (
                <Stepper
                  key={op}
                  label={`${op === 'points' ? 'Points' : op === 'xp' ? 'XP' : 'Energy'} ${state.players[who][op]}`}
                  onMinus={() => !disabled && onManual({ op, player: who, delta: -1 })}
                  onPlus={() => !disabled && onManual({ op, player: who, delta: 1 })}
                />
              ))}
            </span>
          ))}
        </div>
      )}

      {open === 'trash' && (
        <div className="mt-1.5 space-y-1.5">
          {([me, them] as PlayerId[]).map((who) => (
            <div key={who} className="flex items-center gap-1.5">
              <span className="mat-zone-label w-10 shrink-0">{who === me ? 'Yours' : 'Theirs'}</span>
              <div className="flex gap-1 overflow-x-auto pb-1">
                {state.players[who].trash.length === 0 && (
                  <span className="text-[11px] text-muted">Empty</span>
                )}
                {state.players[who].trash.map((uid) => {
                  const card = cardFor(uid);
                  const src = card ? cardImage(card, 'thumb') : null;
                  return (
                    <button
                      key={uid}
                      type="button"
                      onClick={() => onPickCard(uid)}
                      title={card?.name}
                      className="h-14 w-10 shrink-0 overflow-hidden rounded border border-line piece"
                    >
                      {src ? (
                        <img src={src} alt={card?.name ?? ''} className="h-full w-full object-cover" loading="lazy" />
                      ) : (
                        <span className="text-[8px]">{card?.baseName}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
