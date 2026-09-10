import { useMemo, useState } from 'react';
import type { Card } from '@/types';
import { cardImage } from '@/data/cards';
import { CardText, DOMAIN_COLOR, EnergyGlyph, MightGlyph, RuneGlyph } from '@/data/symbols';
import { unitMight } from '../engine/combat';
import { planPayment } from '../engine/payment';
import { reduce } from '../engine/reducer';
import type { GameAction, GameState, Location, PlayerId, UnitState } from '../engine/types';
import { OPPONENT } from '../engine/types';
import { useCardPreview } from './CardPreview';

interface Props {
  state: GameState;
  lookup: (cardId: string) => Card | undefined;
  onAction: (action: GameAction) => void;
  rejection: { reason: string; rule?: string } | null;
  onExit: () => void;
}

/**
 * The playmat. Built to DESIGN.md: a felt surface with printed zones, mirrored
 * across a centre line, with cards as the only pieces that lift off it.
 *
 * Every affordance is decided by dry-running the action through `reduce()`
 * rather than re-implementing rules here — the engine is the single authority
 * on what is legal, and a refusal carries its own reason and rule number.
 */
export default function GameBoard({ state, lookup, onAction, rejection, onExit }: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  /** Hand card being considered — drives the rune payment highlight. */
  const [considering, setConsidering] = useState<string | null>(null);
  const { bind, clear, preview } = useCardPreview();

  const me = state.turnPlayer;
  const them = OPPONENT[me];
  const cardFor = (uid: string) => lookup(state.instances[uid]?.cardId ?? '');

  const canDo = useMemo(() => (a: GameAction) => reduce(state, a, lookup).ok, [state, lookup]);

  const unitsAt = (test: (l: Location) => boolean, who: PlayerId) =>
    Object.values(state.units).filter((u) => u.controller === who && test(u.location));

  /*
   * Which runes would pay for the card under consideration. Highlighting these
   * is what replaces making the player tap runes by hand — they still see the
   * cost being paid, they just don't have to click it.
   */
  const payment = useMemo(() => {
    if (!considering) return null;
    const card = cardFor(considering);
    if (!card) return null;
    const result = planPayment(state, me, card, lookup);
    return result.ok ? result.plan : null;
  }, [considering, state, me, lookup]);

  const play = (uid: string) => {
    onAction({ type: 'PLAY_CARD', uid });
    setConsidering(null);
    clear();
  };

  const moveTo = (to: Location) => {
    if (!selected) return;
    onAction({ type: 'MOVE_UNIT', uid: selected, to });
    setSelected(null);
  };

  return (
    <div className="min-h-dvh bg-table px-2 pb-2 pt-2 sm:px-4">
      {preview}

      <StatusBar state={state} me={me} them={them} onExit={onExit} />

      {rejection && (
        <p className="mx-auto mt-2 max-w-6xl rounded-lg border border-fury/50 bg-fury/10 px-3 py-2 text-sm text-fury">
          {rejection.reason}
          {rejection.rule && <span className="ml-1 opacity-70">({rejection.rule})</span>}
        </p>
      )}

      {state.showdown && (
        <ShowdownBar state={state} me={me} onPass={() => onAction({ type: 'SHOWDOWN_PASS' })} />
      )}

      {/* ---- the mat ---- */}
      <div className="mx-auto mt-2 max-w-6xl overflow-hidden rounded-2xl border border-line mat-felt">
        {/* Opponent edge */}
        <div
          className="flex items-center gap-2 border-b px-3 py-1.5"
          style={{ borderColor: 'var(--color-mat-line)', boxShadow: 'inset 0 3px 0 -1px var(--color-seat-them)' }}
        >
          <span className="mat-zone-label" style={{ color: 'var(--color-seat-them)' }}>
            Opponent
          </span>
          <span className="ml-auto flex items-center gap-3 text-[11px] text-muted tabular-nums">
            <span>{state.players[them].hand.length} hand</span>
            <span>{state.players[them].mainDeck.length} deck</span>
            <span>{Object.values(state.runes).filter((r) => r.controller === them).length} runes</span>
            <span>{state.players[them].trash.length} trash</span>
          </span>
        </div>

        <Zone label="Their base">
          <UnitRow
            units={unitsAt((l) => l.kind === 'base', them)}
            state={state}
            lookup={lookup}
            cardFor={cardFor}
            bind={bind}
          />
        </Zone>

        {/* ---- centre line: battlefields, contested from both sides ---- */}
        <div className="grid gap-2 px-2 py-2 sm:grid-cols-2">
          {state.battlefields.map((bf, index) => (
            <BattlefieldZone
              key={bf.uid}
              index={index}
              state={state}
              me={me}
              them={them}
              lookup={lookup}
              cardFor={cardFor}
              bind={bind}
              selected={selected}
              onSelectUnit={(uid) => setSelected(selected === uid ? null : uid)}
              canMoveHere={selected !== null && canDo({ type: 'MOVE_UNIT', uid: selected, to: { kind: 'battlefield', index } })}
              onMoveHere={() => moveTo({ kind: 'battlefield', index })}
            />
          ))}
        </div>

        <Zone label="Your base">
          <UnitRow
            units={unitsAt((l) => l.kind === 'base', me)}
            state={state}
            lookup={lookup}
            cardFor={cardFor}
            bind={bind}
            selected={selected}
            onSelect={(uid) => setSelected(selected === uid ? null : uid)}
          />
          {selected && state.units[selected]?.location.kind === 'battlefield' && (
            <button
              type="button"
              onClick={() => moveTo({ kind: 'base', player: me })}
              className="mt-1.5 rounded-md border border-accent px-2 py-1 text-[11px] text-accent"
            >
              Recall here
            </button>
          )}
        </Zone>

        {/* Your edge: runes + pool */}
        <div
          className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t px-3 py-2"
          style={{ borderColor: 'var(--color-mat-line)', boxShadow: 'inset 0 -3px 0 -1px var(--color-seat-you)' }}
        >
          <span className="mat-zone-label" style={{ color: 'var(--color-seat-you)' }}>
            You
          </span>

          <Pool state={state} me={me} />

          <RunePips
            state={state}
            me={me}
            lookup={lookup}
            payment={payment}
            disabled={Boolean(state.showdown)}
            onExhaust={(uid) => onAction({ type: 'EXHAUST_RUNE', uid })}
            onRecycle={(uid) => onAction({ type: 'RECYCLE_RUNE', uid })}
          />

          <span className="ml-auto text-[11px] text-muted tabular-nums">
            {state.players[me].mainDeck.length} deck · {state.players[me].trash.length} trash
          </span>
        </div>
      </div>

      {/* ---- hand, overlapping the mat edge ---- */}
      <Hand
        state={state}
        me={me}
        lookup={lookup}
        cardFor={cardFor}
        bind={bind}
        onConsider={setConsidering}
        onPlay={play}
      />

      <div className="mx-auto mt-2 flex max-w-6xl gap-2">
        <button
          type="button"
          disabled={Boolean(state.showdown)}
          onClick={() => onAction({ type: 'END_TURN' })}
          className="flex-1 rounded-lg bg-accent py-2.5 text-sm font-semibold text-ink disabled:opacity-40"
        >
          End turn
        </button>
      </div>

      {state.unautomated.length > 0 && (
        <details className="mx-auto mt-2 max-w-6xl rounded-lg border border-order/40 bg-order/5 px-3 py-2">
          <summary className="cursor-pointer text-xs font-medium text-order">
            {state.unautomated.length} card effect{state.unautomated.length === 1 ? '' : 's'} to apply by hand
          </summary>
          <ul className="mt-2 space-y-1.5">
            {state.unautomated.slice(-8).map((entry, i) => (
              <li key={i} className="text-[11px] text-muted">
                <CardText text={entry} />
              </li>
            ))}
          </ul>
        </details>
      )}

      <LogPanel state={state} />
    </div>
  );
}

// ---------------------------------------------------------------------------

function StatusBar({
  state,
  me,
  them,
  onExit,
}: {
  state: GameState;
  me: PlayerId;
  them: PlayerId;
  onExit: () => void;
}) {
  return (
    <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2 rounded-lg border border-line bg-surface/70 px-3 py-2">
      <button
        type="button"
        onClick={onExit}
        className="rounded border border-line px-2 py-1 text-[11px] text-muted hover:text-bright"
      >
        Exit
      </button>
      <span className="text-sm font-semibold">Turn {state.turn}</span>
      <span className="rounded bg-surface-2 px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted">
        {state.phase}
      </span>
      <span className="ml-auto flex items-center gap-3">
        <Score label="You" value={state.players[me].points} colour="var(--color-seat-you)" />
        <Score label="Them" value={state.players[them].points} colour="var(--color-seat-them)" />
        <span className="text-[11px] text-muted">to {state.victoryScore}</span>
      </span>
    </div>
  );
}

function Score({ label, value, colour }: { label: string; value: number; colour: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="text-[10px] uppercase tracking-wider text-muted">{label}</span>
      <span className="text-lg font-bold tabular-nums" style={{ color: colour }}>
        {value}
      </span>
    </span>
  );
}

function ShowdownBar({ state, me, onPass }: { state: GameState; me: PlayerId; onPass: () => void }) {
  const s = state.showdown!;
  return (
    <div className="mx-auto mt-2 flex max-w-6xl flex-wrap items-center gap-3 rounded-lg border border-order/50 bg-order/10 px-3 py-2">
      <span className="text-sm font-semibold text-order">
        {s.combat ? 'Combat showdown' : 'Showdown'} · battlefield {s.battlefield + 1}
      </span>
      <span className="text-[11px] text-muted">
        {s.focus === me ? 'You have focus' : 'Opponent has focus'} · both must pass to resolve
      </span>
      <button
        type="button"
        onClick={onPass}
        className="ml-auto rounded-lg bg-order px-4 py-1.5 text-sm font-semibold text-ink"
      >
        Pass
      </button>
    </div>
  );
}

function Zone({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="px-2 py-2">
      <div className="mat-zone px-2 py-1.5">
        <div className="mat-zone-label mb-1">{label}</div>
        {children}
      </div>
    </div>
  );
}

type Bind = ReturnType<typeof useCardPreview>['bind'];

function UnitRow({
  units,
  state,
  lookup,
  cardFor,
  bind,
  selected,
  onSelect,
}: {
  units: UnitState[];
  state: GameState;
  lookup: (id: string) => Card | undefined;
  cardFor: (uid: string) => Card | undefined;
  bind: Bind;
  selected?: string | null;
  onSelect?: (uid: string) => void;
}) {
  if (units.length === 0) {
    return <p className="py-2 text-[11px] text-muted opacity-60">Empty</p>;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {units.map((unit) => (
        <MatCard
          key={unit.uid}
          card={cardFor(unit.uid)}
          unit={unit}
          might={unitMight(state, unit.uid, lookup)}
          selected={selected === unit.uid}
          onClick={onSelect ? () => onSelect(unit.uid) : undefined}
          bind={bind}
        />
      ))}
    </div>
  );
}

/** A card resting on the mat. Rotation is the exhausted signal, not greying. */
function MatCard({
  card,
  unit,
  might,
  selected,
  onClick,
  bind,
}: {
  card: Card | undefined;
  unit: UnitState;
  might: number;
  selected?: boolean;
  onClick?: () => void;
  bind: Bind;
}) {
  const src = card ? cardImage(card, 'thumb') : null;
  const accent = DOMAIN_COLOR[card?.domains[0] ?? 'Colorless'];
  const boosted = might !== (card?.might ?? 0);

  return (
    <button
      type="button"
      onClick={onClick}
      {...bind(card)}
      title={card?.name}
      aria-label={`${card?.name ?? 'Unit'}, ${might} might${unit.ready ? '' : ', exhausted'}`}
      className={`relative shrink-0 overflow-hidden rounded-md piece ${
        unit.ready ? '' : 'piece-exhausted'
      } ${selected ? 'ring-2 ring-calm' : ''}`}
      style={{ width: 48, height: 67, margin: unit.ready ? undefined : '9px 0' }}
    >
      {src ? (
        <img src={src} alt="" className="h-full w-full object-cover" loading="lazy" />
      ) : (
        <span className="block p-1 text-[8px]">{card?.baseName}</span>
      )}

      {unit.designation && (
        <span
          className="absolute inset-x-0 top-0 h-1"
          style={{ background: unit.designation === 'attacker' ? 'var(--color-fury)' : 'var(--color-mind)' }}
        />
      )}

      <span
        className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-0.5 bg-ink/85"
        style={{ borderTop: `2px solid ${accent}` }}
      >
        <MightGlyph size={9} />
        <span className={`text-[10px] font-bold tabular-nums ${boosted ? 'text-order' : ''}`}>
          {might}
        </span>
      </span>

      {unit.damage > 0 && (
        <span className="absolute right-0 top-0 bg-fury px-1 text-[9px] font-bold text-ink">
          {unit.damage}
        </span>
      )}
    </button>
  );
}

/**
 * A battlefield is a two-sided zone: their units above the card, yours below.
 * A contested battlefield therefore reads as a collision at the centre line.
 * The rules text prints onto the zone so it is readable without hovering.
 */
function BattlefieldZone({
  index,
  state,
  me,
  them,
  lookup,
  cardFor,
  bind,
  selected,
  onSelectUnit,
  canMoveHere,
  onMoveHere,
}: {
  index: number;
  state: GameState;
  me: PlayerId;
  them: PlayerId;
  lookup: (id: string) => Card | undefined;
  cardFor: (uid: string) => Card | undefined;
  bind: Bind;
  selected: string | null;
  onSelectUnit: (uid: string) => void;
  canMoveHere: boolean;
  onMoveHere: () => void;
}) {
  const bf = state.battlefields[index];
  const card = cardFor(bf.uid);
  const at = (who: PlayerId) =>
    Object.values(state.units).filter(
      (u) => u.controller === who && u.location.kind === 'battlefield' && u.location.index === index,
    );
  const mine = at(me);
  const theirs = at(them);
  const mightOf = (us: UnitState[]) => us.reduce((s, u) => s + unitMight(state, u.uid, lookup), 0);
  const hidden = Object.values(state.hidden).filter((h) => h.battlefield === index);

  const control = bf.contested
    ? { text: 'Contested', colour: 'var(--color-order)' }
    : bf.controller === me
      ? { text: 'You hold', colour: 'var(--color-calm)' }
      : bf.controller === them
        ? { text: 'They hold', colour: 'var(--color-fury)' }
        : { text: 'Uncontrolled', colour: 'var(--color-muted)' };

  return (
    <section
      className={`mat-zone overflow-hidden ${bf.contested ? 'mat-contested' : ''}`}
      style={canMoveHere ? { borderColor: 'var(--color-calm)' } : undefined}
    >
      {/* Printed battlefield header — name, control state, rules text */}
      <div className="relative" {...bind(card)}>
        {card && cardImage(card, 'card') && (
          <img
            src={cardImage(card, 'card')!}
            alt=""
            className="h-14 w-full object-cover opacity-25"
            loading="lazy"
          />
        )}
        <div className="absolute inset-0 flex flex-col justify-center px-2">
          <div className="flex items-center gap-2">
            <span className="truncate text-[13px] font-semibold">
              {card?.baseName ?? `Battlefield ${index + 1}`}
            </span>
            <span
              className="ml-auto shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold text-ink"
              style={{ background: control.colour }}
            >
              {control.text}
            </span>
          </div>
          {/* CardText renders block elements, so this wrapper must not be a <p>. */}
          {card?.text && (
            <div className="mt-0.5 line-clamp-2 text-[10px] leading-tight opacity-70">
              <CardText text={card.text} />
            </div>
          )}
        </div>
      </div>

      <div className="space-y-1.5 p-2">
        <Side label="Them" units={theirs} might={mightOf(theirs)} colour="var(--color-seat-them)">
          <UnitRow units={theirs} state={state} lookup={lookup} cardFor={cardFor} bind={bind} />
        </Side>

        {hidden.length > 0 && (
          <div className="flex items-center gap-1">
            <span className="mat-zone-label">Hidden</span>
            {hidden.map((h) => (
              <span
                key={h.uid}
                className="grid size-8 place-items-center rounded border border-line-bright bg-surface-2 text-[9px] text-muted"
                title={h.controller === me ? 'Your hidden card' : 'Their hidden card'}
              >
                {h.controller === me ? 'you' : '?'}
              </span>
            ))}
          </div>
        )}

        <Side label="You" units={mine} might={mightOf(mine)} colour="var(--color-seat-you)">
          <UnitRow
            units={mine}
            state={state}
            lookup={lookup}
            cardFor={cardFor}
            bind={bind}
            selected={selected}
            onSelect={onSelectUnit}
          />
        </Side>

        {canMoveHere && (
          <button
            type="button"
            onClick={onMoveHere}
            className="w-full rounded-md bg-calm py-1.5 text-[12px] font-semibold text-ink"
          >
            Move here
          </button>
        )}
      </div>
    </section>
  );
}

function Side({
  label,
  units,
  might,
  colour,
  children,
}: {
  label: string;
  units: UnitState[];
  might: number;
  colour: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-md px-1.5 py-1" style={{ boxShadow: `inset 2px 0 0 ${colour}` }}>
      <div className="mb-1 flex items-center gap-2">
        <span className="mat-zone-label">{label}</span>
        {units.length > 0 && (
          <span className="text-[10px] text-muted tabular-nums">
            {units.length} unit{units.length === 1 ? '' : 's'} · {might} Might
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

function Pool({ state, me }: { state: GameState; me: PlayerId }) {
  const p = state.players[me];
  const power = Object.entries(p.power).filter(([, n]) => (n ?? 0) > 0);
  return (
    <span className="flex items-center gap-2">
      <span className="flex items-center gap-1" title={`${p.energy} Energy in pool`}>
        <EnergyGlyph value={p.energy} size={17} />
      </span>
      {power.map(([domain, n]) => (
        <span key={domain} className="flex items-center gap-0.5" title={`${n} ${domain} Power`}>
          {Array.from({ length: n ?? 0 }, (_, i) => (
            <RuneGlyph key={i} domain={domain as never} size={14} />
          ))}
        </span>
      ))}
    </span>
  );
}

/**
 * Runes as pips at the mat edge. When a hand card is under consideration, the
 * runes that would pay for it light up — blue to exhaust, purple to recycle —
 * so the cost is visible even though the engine pays it automatically.
 */
function RunePips({
  state,
  me,
  lookup,
  payment,
  disabled,
  onExhaust,
  onRecycle,
}: {
  state: GameState;
  me: PlayerId;
  lookup: (id: string) => Card | undefined;
  payment: { exhaust: string[]; recycle: string[] } | null;
  disabled: boolean;
  onExhaust: (uid: string) => void;
  onRecycle: (uid: string) => void;
}) {
  const runes = Object.values(state.runes).filter((r) => r.controller === me);
  if (runes.length === 0) return <span className="text-[11px] text-muted">No runes</span>;

  return (
    <span className="flex flex-wrap items-center gap-1">
      {runes.map((rune) => {
        const domain = lookup(state.instances[rune.uid]?.cardId ?? '')?.domains[0] ?? 'Colorless';
        const willExhaust = payment?.exhaust.includes(rune.uid);
        const willRecycle = payment?.recycle.includes(rune.uid);
        const ring = willRecycle
          ? 'var(--color-chaos)'
          : willExhaust
            ? 'var(--color-accent)'
            : 'transparent';

        return (
          <span key={rune.uid} className="flex items-center">
            <button
              type="button"
              disabled={disabled || !rune.ready}
              onClick={() => onExhaust(rune.uid)}
              title={rune.ready ? `Exhaust for 1 Energy` : 'Exhausted'}
              aria-label={`Exhaust ${domain} rune`}
              className={`rounded-l border border-line px-1 py-0.5 transition-all ${
                rune.ready ? 'bg-surface' : 'bg-surface-2 opacity-40'
              }`}
              style={{ boxShadow: ring === 'transparent' ? undefined : `0 0 0 2px ${ring}` }}
            >
              <RuneGlyph domain={domain as never} size={14} />
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onRecycle(rune.uid)}
              title={`Recycle for 1 ${domain} Power`}
              aria-label={`Recycle ${domain} rune`}
              className="rounded-r border border-l-0 border-line bg-surface px-1 py-0.5 text-[10px] text-muted hover:text-accent disabled:opacity-40"
            >
              ♻
            </button>
          </span>
        );
      })}
      {payment && (
        <span className="ml-1 text-[10px] text-muted">
          {payment.exhaust.length > 0 && (
            <span className="text-accent">{payment.exhaust.length} exhaust</span>
          )}
          {payment.exhaust.length > 0 && payment.recycle.length > 0 && ' · '}
          {payment.recycle.length > 0 && (
            <span className="text-chaos">{payment.recycle.length} recycle</span>
          )}
        </span>
      )}
    </span>
  );
}

function Hand({
  state,
  me,
  lookup,
  cardFor,
  bind,
  onConsider,
  onPlay,
}: {
  state: GameState;
  me: PlayerId;
  lookup: (id: string) => Card | undefined;
  cardFor: (uid: string) => Card | undefined;
  bind: Bind;
  onConsider: (uid: string | null) => void;
  onPlay: (uid: string) => void;
}) {
  const p = state.players[me];
  const slots = [
    ...(p.championZone ? [{ uid: p.championZone, champion: true }] : []),
    ...p.hand.map((uid) => ({ uid, champion: false })),
  ];

  return (
    <div className="mx-auto -mt-3 max-w-6xl">
      <div className="flex items-end gap-1.5 overflow-x-auto px-2 pb-1 pt-4">
        {slots.length === 0 && <span className="py-8 text-xs text-muted">Hand empty</span>}
        {slots.map(({ uid, champion }) => {
          const card = cardFor(uid);
          const result = reduce(state, { type: 'PLAY_CARD', uid }, lookup);
          const playable = result.ok;
          const src = card ? cardImage(card, 'thumb') : null;

          return (
            <div key={uid} className="shrink-0">
              <button
                type="button"
                disabled={!playable}
                onClick={() => onPlay(uid)}
                onPointerEnter={(e) => {
                  onConsider(uid);
                  bind(card).onPointerEnter(e);
                }}
                onPointerLeave={() => {
                  onConsider(null);
                  bind(card).onPointerLeave();
                }}
                onContextMenu={bind(card).onContextMenu}
                title={playable ? `Play ${card?.name}` : (result as { reason: string }).reason}
                aria-label={card?.name}
                className={`relative block overflow-hidden rounded-lg piece transition-transform ${
                  playable
                    ? 'hover:-translate-y-2 hover:ring-2 hover:ring-calm'
                    : 'opacity-45 saturate-50'
                }`}
                style={{ width: 74, height: 103 }}
              >
                {src ? (
                  <img src={src} alt="" className="h-full w-full object-cover" loading="lazy" />
                ) : (
                  <span className="block p-1 text-[9px]">{card?.baseName}</span>
                )}
              </button>
              {champion && (
                <p className="mt-0.5 text-center text-[9px] uppercase tracking-wider text-order">
                  Champion
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function LogPanel({ state }: { state: GameState }) {
  return (
    <details className="mx-auto mt-2 max-w-6xl rounded-lg border border-line bg-surface/50 px-3 py-2">
      <summary className="cursor-pointer mat-zone-label">Game log</summary>
      <ul className="mt-2 max-h-44 space-y-1 overflow-y-auto text-[11px]">
        {state.log
          .slice()
          .reverse()
          .slice(0, 40)
          .map((entry, i) => (
            <li key={i} className="flex gap-2">
              <span className="shrink-0 text-muted opacity-50">T{entry.turn}</span>
              <span className="text-muted">
                {entry.text}
                {entry.rule && <span className="ml-1 opacity-50">({entry.rule})</span>}
              </span>
            </li>
          ))}
      </ul>
    </details>
  );
}
