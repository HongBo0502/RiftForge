import { useMemo, useState } from 'react';
import type { Card } from '@/types';
import { cardImage } from '@/data/cards';
import { CardText, DOMAIN_COLOR, EnergyGlyph, RuneGlyph } from '@/data/symbols';
import { unitMight } from '../engine/combat';
import { reduce } from '../engine/reducer';
import type { GameAction, GameState, Location, PlayerId } from '../engine/types';
import { OPPONENT } from '../engine/types';
import { FaceDownCard, HandCard, RuneRow, UnitChip } from './pieces';

interface Props {
  state: GameState;
  lookup: (cardId: string) => Card | undefined;
  onAction: (action: GameAction) => void;
  /** Set when the last action was rejected, so the reason can be shown. */
  rejection: { reason: string; rule?: string } | null;
  onExit: () => void;
}

/**
 * Hotseat board. Both players share one device, so the view always belongs to
 * the turn player — `PlayPage` puts a pass-the-device screen between turns and
 * only ever hands this component a redacted state.
 */
export default function GameBoard({ state, lookup, onAction, rejection, onExit }: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const me = state.turnPlayer;
  const them = OPPONENT[me];

  const cardFor = (uid: string): Card | undefined => lookup(state.instances[uid]?.cardId ?? '');

  const unitsAt = (predicate: (loc: Location) => boolean, player: PlayerId) =>
    Object.values(state.units).filter((u) => u.controller === player && predicate(u.location));

  const myRunes = Object.values(state.runes)
    .filter((r) => r.controller === me)
    .map((r) => ({
      uid: r.uid,
      ready: r.ready,
      domain: cardFor(r.uid)?.domains[0] ?? 'Colorless',
    }));

  const theirRuneCount = Object.values(state.runes).filter((r) => r.controller === them).length;

  /** Dry-runs an action so the UI can grey out what the engine would reject. */
  const canDo = useMemo(
    () => (action: GameAction) => reduce(state, action, lookup).ok,
    [state, lookup],
  );

  function selectOrMove(uid: string) {
    if (selected === uid) return setSelected(null);
    setSelected(uid);
  }

  function moveTo(to: Location) {
    if (!selected) return;
    onAction({ type: 'MOVE_UNIT', uid: selected, to });
    setSelected(null);
  }

  const power = Object.entries(state.players[me].power).filter(([, n]) => (n ?? 0) > 0);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-3 px-3 py-3">
      {/* Status bar */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2">
        <button
          type="button"
          onClick={onExit}
          className="rounded border border-line px-2 py-1 text-xs text-muted hover:text-bright"
        >
          Exit
        </button>
        <span className="text-sm font-semibold">Turn {state.turn}</span>
        <span className="rounded bg-surface-2 px-2 py-0.5 text-xs uppercase tracking-wide text-muted">
          {state.phase}
        </span>

        <span className="ml-auto flex items-center gap-3 text-sm">
          <Score label="You" value={state.players[me].points} highlight />
          <Score label="Them" value={state.players[them].points} />
          <span className="text-xs text-muted">to {state.victoryScore}</span>
        </span>
      </div>

      {rejection && (
        <div className="rounded-lg border border-fury/50 bg-fury/10 px-3 py-2 text-sm text-fury">
          {rejection.reason}
          {rejection.rule && <span className="ml-1 opacity-70">({rejection.rule})</span>}
        </div>
      )}

      {state.showdown && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-order/50 bg-order/10 px-3 py-2">
          <span className="text-sm font-semibold text-order">
            {state.showdown.combat ? 'Combat showdown' : 'Showdown'} at battlefield{' '}
            {state.showdown.battlefield + 1}
          </span>
          <span className="text-xs text-muted">
            {state.showdown.focus === me ? 'You have focus' : 'Opponent has focus'}
          </span>
          <button
            type="button"
            onClick={() => onAction({ type: 'SHOWDOWN_PASS' })}
            className="ml-auto rounded-lg bg-order px-3 py-1.5 text-sm font-semibold text-ink"
          >
            Pass
          </button>
        </div>
      )}

      {/* Opponent */}
      <section className="rounded-lg border border-line bg-surface/40 p-2">
        <Header
          title="Opponent"
          detail={`${state.players[them].hand.length} in hand · ${state.players[them].mainDeck.length} in deck · ${theirRuneCount} runes`}
        />
        <div className="flex flex-wrap items-center gap-1">
          {state.players[them].hand.map((uid) => (
            <FaceDownCard key={uid} />
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-1">
          {unitsAt((l) => l.kind === 'base', them).map((unit) => (
            <UnitChip
              key={unit.uid}
              card={cardFor(unit.uid)}
              unit={unit}
              might={unitMight(state, unit.uid, lookup)}
            />
          ))}
          {unitsAt((l) => l.kind === 'base', them).length === 0 && (
            <span className="text-xs text-muted">Base empty.</span>
          )}
        </div>
      </section>

      {/* Battlefields */}
      <div className="grid gap-2 sm:grid-cols-2">
        {state.battlefields.map((bf, index) => {
          const card = cardFor(bf.uid);
          const mine = unitsAt((l) => l.kind === 'battlefield' && l.index === index, me);
          const theirs = unitsAt((l) => l.kind === 'battlefield' && l.index === index, them);
          const canMoveHere =
            selected !== null && canDo({ type: 'MOVE_UNIT', uid: selected, to: { kind: 'battlefield', index } });
          const hiddenHere = Object.values(state.hidden).filter((h) => h.battlefield === index);

          return (
            <section
              key={bf.uid}
              className={`overflow-hidden rounded-lg border bg-surface/40 transition-colors ${
                canMoveHere ? 'border-accent' : bf.contested ? 'border-order' : 'border-line'
              }`}
            >
              <div className="relative">
                {card && cardImage(card, 'card') && (
                  <img
                    src={cardImage(card, 'card')!}
                    alt=""
                    className="h-20 w-full object-cover opacity-35"
                    loading="lazy"
                  />
                )}
                <div className="absolute inset-0 flex items-center justify-between px-2">
                  <span className="text-sm font-semibold">{card?.baseName ?? `Battlefield ${index + 1}`}</span>
                  <ControlBadge controller={bf.controller} me={me} />
                </div>
              </div>

              <div className="space-y-2 p-2">
                <Side label="Them" units={theirs} state={state} lookup={lookup} cardFor={cardFor} />
                {hiddenHere.length > 0 && (
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] uppercase tracking-wide text-muted">Hidden</span>
                    {hiddenHere.map((h) => (
                      <FaceDownCard key={h.uid} label={h.controller === me ? 'yours' : undefined} />
                    ))}
                  </div>
                )}
                <Side
                  label="You"
                  units={mine}
                  state={state}
                  lookup={lookup}
                  cardFor={cardFor}
                  selected={selected}
                  onSelect={selectOrMove}
                />

                {canMoveHere && (
                  <button
                    type="button"
                    onClick={() => moveTo({ kind: 'battlefield', index })}
                    className="w-full rounded-lg bg-accent py-1.5 text-sm font-semibold text-ink"
                  >
                    Move here
                  </button>
                )}
              </div>
            </section>
          );
        })}
      </div>

      {/* Your side */}
      <section className="rounded-lg border border-line bg-surface/40 p-2">
        <Header title="Your base" detail={`${state.players[me].mainDeck.length} in deck`} />
        <div className="flex flex-wrap gap-1">
          {unitsAt((l) => l.kind === 'base', me).map((unit) => (
            <UnitChip
              key={unit.uid}
              card={cardFor(unit.uid)}
              unit={unit}
              might={unitMight(state, unit.uid, lookup)}
              selected={selected === unit.uid}
              onClick={() => selectOrMove(unit.uid)}
            />
          ))}
          {unitsAt((l) => l.kind === 'base', me).length === 0 && (
            <span className="text-xs text-muted">Base empty.</span>
          )}
        </div>

        {selected && state.units[selected]?.location.kind === 'battlefield' && (
          <button
            type="button"
            onClick={() => moveTo({ kind: 'base', player: me })}
            className="mt-2 rounded-lg border border-accent px-3 py-1 text-xs text-accent"
          >
            Recall to base
          </button>
        )}
      </section>

      {/* Resources */}
      <section className="rounded-lg border border-line bg-surface/40 p-2">
        <div className="mb-1.5 flex flex-wrap items-center gap-3">
          <span className="flex items-center gap-1 text-sm">
            <EnergyGlyph value={state.players[me].energy} size={18} />
            <span className="text-muted">Energy</span>
          </span>
          {power.length > 0 ? (
            power.map(([domain, n]) => (
              <span key={domain} className="flex items-center gap-1 text-sm">
                {Array.from({ length: n ?? 0 }, (_, i) => (
                  <RuneGlyph key={i} domain={domain as never} size={15} />
                ))}
                <span className="text-muted">{domain}</span>
              </span>
            ))
          ) : (
            <span className="text-xs text-muted">No Power in pool</span>
          )}
        </div>
        <RuneRow
          runes={myRunes}
          interactive={!state.showdown}
          onExhaust={(uid) => onAction({ type: 'EXHAUST_RUNE', uid })}
          onRecycle={(uid) => onAction({ type: 'RECYCLE_RUNE', uid })}
        />
      </section>

      {/* Hand */}
      <section className="rounded-lg border border-line bg-surface/40 p-2">
        <Header title="Your hand" detail={`${state.players[me].hand.length} cards`} />
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {state.players[me].championZone && (
            <div className="shrink-0">
              <HandCard
                card={cardFor(state.players[me].championZone)}
                playable={canDo({ type: 'PLAY_CARD', uid: state.players[me].championZone })}
                reason="Chosen Champion"
                onClick={() => onAction({ type: 'PLAY_CARD', uid: state.players[me].championZone! })}
              />
              <p className="mt-0.5 text-center text-[9px] uppercase text-order">Champion</p>
            </div>
          )}
          {state.players[me].hand.map((uid) => {
            const result = reduce(state, { type: 'PLAY_CARD', uid }, lookup);
            return (
              <HandCard
                key={uid}
                card={cardFor(uid)}
                playable={result.ok}
                reason={result.ok ? null : result.reason}
                onClick={() => onAction({ type: 'PLAY_CARD', uid })}
              />
            );
          })}
          {state.players[me].hand.length === 0 && (
            <span className="py-6 text-xs text-muted">Hand empty.</span>
          )}
        </div>
      </section>

      {/* Turn control */}
      <button
        type="button"
        disabled={Boolean(state.showdown)}
        onClick={() => onAction({ type: 'END_TURN' })}
        className="rounded-lg bg-accent py-3 text-sm font-semibold text-ink disabled:opacity-40"
      >
        End turn
      </button>

      {state.unautomated.length > 0 && <UnautomatedPanel entries={state.unautomated} />}

      <LogPanel state={state} />
    </div>
  );
}

function Score({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <span className="flex items-center gap-1">
      <span className="text-xs text-muted">{label}</span>
      <span className={`text-lg font-bold tabular-nums ${highlight ? 'text-accent' : ''}`}>
        {value}
      </span>
    </span>
  );
}

function Header({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="mb-1.5 flex items-baseline justify-between">
      <span className="text-xs font-semibold uppercase tracking-wider text-muted">{title}</span>
      <span className="text-[11px] text-muted">{detail}</span>
    </div>
  );
}

function ControlBadge({ controller, me }: { controller: PlayerId | null; me: PlayerId }) {
  if (!controller) {
    return <span className="rounded bg-ink/80 px-1.5 py-0.5 text-[10px] text-muted">Uncontrolled</span>;
  }
  const yours = controller === me;
  return (
    <span
      className="rounded px-1.5 py-0.5 text-[10px] font-bold text-ink"
      style={{ background: yours ? DOMAIN_COLOR.Calm : DOMAIN_COLOR.Fury }}
    >
      {yours ? 'You hold' : 'They hold'}
    </span>
  );
}

function Side({
  label,
  units,
  state,
  lookup,
  cardFor,
  selected,
  onSelect,
}: {
  label: string;
  units: GameState['units'][string][];
  state: GameState;
  lookup: (cardId: string) => Card | undefined;
  cardFor: (uid: string) => Card | undefined;
  selected?: string | null;
  onSelect?: (uid: string) => void;
}) {
  const might = units.reduce((sum, u) => sum + unitMight(state, u.uid, lookup), 0);
  return (
    <div>
      <div className="mb-1 flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-wide text-muted">{label}</span>
        {units.length > 0 && (
          <span className="text-[10px] text-muted">
            {units.length} unit{units.length === 1 ? '' : 's'} · {might} Might
          </span>
        )}
      </div>
      <div className="flex min-h-[2rem] flex-wrap gap-1">
        {units.map((unit) => (
          <UnitChip
            key={unit.uid}
            card={cardFor(unit.uid)}
            unit={unit}
            might={unitMight(state, unit.uid, lookup)}
            selected={selected === unit.uid}
            onClick={onSelect ? () => onSelect(unit.uid) : undefined}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Card text the engine did not implement. Showing it is the honest alternative
 * to silently doing nothing — players apply these by hand.
 */
function UnautomatedPanel({ entries }: { entries: string[] }) {
  return (
    <details className="rounded-lg border border-order/40 bg-order/5 px-3 py-2 text-sm">
      <summary className="cursor-pointer font-medium text-order">
        {entries.length} card effect{entries.length === 1 ? '' : 's'} to apply by hand
      </summary>
      <ul className="mt-2 space-y-1.5">
        {entries.slice(-8).map((entry, i) => (
          <li key={i} className="text-xs text-muted">
            <CardText text={entry} />
          </li>
        ))}
      </ul>
    </details>
  );
}

function LogPanel({ state }: { state: GameState }) {
  return (
    <details className="rounded-lg border border-line bg-surface/40 px-3 py-2 text-sm" open>
      <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wider text-muted">
        Game log
      </summary>
      <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto text-xs">
        {state.log
          .slice()
          .reverse()
          .slice(0, 40)
          .map((entry, i) => (
            <li key={i} className="flex gap-2">
              <span className="shrink-0 text-muted opacity-60">T{entry.turn}</span>
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
