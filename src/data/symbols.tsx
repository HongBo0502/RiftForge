import { useId } from 'react';
import type { JSX, ReactNode } from 'react';
import type { Domain } from '@/types';

/**
 * Card text arrives with inline markers that need to render as glyphs:
 *
 *   :rb_energy_3:   energy cost          :rb_might:      might
 *   :rb_rune_fury:  domain power         :rb_exhaust:    exhaust
 *   :rb_rune_rainbow:  power of any domain
 *   [Reaction] [Assault 2]  keywords     [>]  "then"     [NO TEXT]  no rules text
 *
 * Parenthesised runs are reminder text and are dimmed, the way they're printed.
 */

export const DOMAIN_COLOR: Record<Domain, string> = {
  Fury: 'var(--color-fury)',
  Calm: 'var(--color-calm)',
  Mind: 'var(--color-mind)',
  Body: 'var(--color-body)',
  Chaos: 'var(--color-chaos)',
  Order: 'var(--color-order)',
  Colorless: 'var(--color-colorless)',
};

const RUNE_KEY_TO_DOMAIN: Record<string, Domain> = {
  fury: 'Fury',
  calm: 'Calm',
  mind: 'Mind',
  body: 'Body',
  chaos: 'Chaos',
  order: 'Order',
};

const glyph = 'inline-block align-[-0.18em] shrink-0';

/** Energy: the printed silver disc in a gold rim, carrying a dark numeral. */
export function EnergyGlyph({ value, size = 16 }: { value: number; size?: number }): JSX.Element {
  return (
    <svg
      className={glyph}
      width={size}
      height={size}
      viewBox="0 0 20 20"
      role="img"
      aria-label={`${value} energy`}
    >
      <circle cx="10" cy="10" r="9.2" fill="#c8a13c" />
      <circle cx="10" cy="10" r="7.5" fill="#f1efe8" />
      <text
        x="10"
        y="14.2"
        textAnchor="middle"
        fontSize={value >= 10 ? 9 : 11.5}
        fontWeight="800"
        fill="#14120d"
        fontFamily="ui-sans-serif, system-ui, sans-serif"
      >
        {value}
      </text>
    </svg>
  );
}

/**
 * Power: the rune swirl on a domain-coloured pip, as printed under the energy
 * cost. Rainbow is the same swirl in a spectrum, meaning power of any domain.
 */
export function RuneGlyph({
  domain,
  size = 15,
}: {
  domain: Domain | 'rainbow';
  size?: number;
}): JSX.Element {
  // Gradients need a document-unique id, or every instance resolves to the first.
  const uid = useId().replace(/:/g, '');
  const isRainbow = domain === 'rainbow';
  const fill = isRainbow ? `url(#rb-rainbow-${uid})` : DOMAIN_COLOR[domain];
  return (
    <svg
      className={glyph}
      width={size}
      height={size}
      viewBox="0 0 20 20"
      role="img"
      aria-label={isRainbow ? 'power of any domain' : `${domain} power`}
    >
      {isRainbow && (
        <defs>
          <linearGradient id={`rb-rainbow-${uid}`} x1="0" y1="1" x2="1" y2="0">
            <stop offset="0%" stopColor="#3b86e0" />
            <stop offset="28%" stopColor="#2aa96b" />
            <stop offset="55%" stopColor="#d9b02c" />
            <stop offset="78%" stopColor="#e08a2e" />
            <stop offset="100%" stopColor="#e0483f" />
          </linearGradient>
        </defs>
      )}
      <rect x="1.4" y="0.4" width="17.2" height="19.2" rx="8" fill={fill} />
      <path
        d="M10 4.2a5.8 5.8 0 1 1-5.8 5.8 3.2 3.2 0 1 1 3.2-3.2"
        fill="none"
        stroke="#fff"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Might: the printed gold plate carrying a black shield and sword. */
export function MightGlyph({ size = 15 }: { size?: number }): JSX.Element {
  return (
    <svg
      className={glyph}
      width={size}
      height={size}
      viewBox="0 0 20 20"
      role="img"
      aria-label="might"
    >
      <rect x="0.4" y="0.4" width="19.2" height="19.2" rx="2.6" fill="#d9b45a" />
      <path
        d="M10 2.6 16.4 5.1v5.3c0 3.3-2.6 5.7-6.4 7-3.8-1.3-6.4-3.7-6.4-7V5.1Z"
        fill="#14120d"
      />
      <path d="M10 5.4v9.1" stroke="#d9b45a" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M7.5 8.1h5" stroke="#d9b45a" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="10" cy="5.2" r="1.15" fill="#d9b45a" />
    </svg>
  );
}

/** Exhaust: the rotation mark meaning "turn this sideways". */
export function ExhaustGlyph({ size = 15 }: { size?: number }): JSX.Element {
  return (
    <svg
      className={glyph}
      width={size}
      height={size}
      viewBox="0 0 20 20"
      role="img"
      aria-label="exhaust"
    >
      <circle cx="10" cy="10" r="9" fill="#1d2740" stroke="#8b97ad" strokeWidth="1.3" />
      <path
        d="M13.8 7.2A5 5 0 1 0 14.6 11"
        fill="none"
        stroke="#e8edf7"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <path d="M15.4 4.6v3.4h-3.4Z" fill="#e8edf7" />
    </svg>
  );
}

/** Keywords print as a filled chip with dark italic type; mirror that here. */
export function KeywordChip({ label }: { label: string }): JSX.Element {
  return (
    <span className="mr-1 inline-block rounded-sm bg-[#d9b45a] px-1.5 py-px text-[0.8em] font-bold uppercase not-italic tracking-wide text-[#14120d]">
      {label}
    </span>
  );
}

/** Renders a single :rb_*: token, or null if it's one we don't recognise. */
function renderSymbol(token: string, key: string): ReactNode {
  const energy = /^rb_energy_(\d+)$/.exec(token);
  if (energy) return <EnergyGlyph key={key} value={Number(energy[1])} />;

  if (token === 'rb_might') return <MightGlyph key={key} />;
  if (token === 'rb_exhaust') return <ExhaustGlyph key={key} />;
  if (token === 'rb_rune_rainbow') return <RuneGlyph key={key} domain="rainbow" />;

  const rune = /^rb_rune_([a-z]+)$/.exec(token);
  if (rune && RUNE_KEY_TO_DOMAIN[rune[1]]) {
    return <RuneGlyph key={key} domain={RUNE_KEY_TO_DOMAIN[rune[1]]} />;
  }
  return null;
}

const TOKEN_RE = /(:rb_[a-z0-9_]+:|\[[^\]]{1,40}\])/g;

/** Tokenises one run of text (no reminder-paren handling at this level). */
function renderRun(run: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  let i = 0;
  for (const part of run.split(TOKEN_RE)) {
    if (!part) continue;
    const key = `${keyPrefix}-${i++}`;

    if (part.startsWith(':') && part.endsWith(':')) {
      const node = renderSymbol(part.slice(1, -1), key);
      out.push(node ?? <span key={key}>{part}</span>);
      continue;
    }

    if (part.startsWith('[') && part.endsWith(']')) {
      const label = part.slice(1, -1);
      if (label === '>') {
        out.push(
          <span key={key} className="mx-0.5 text-muted">
            →
          </span>,
        );
      } else if (label === 'NO TEXT') {
        out.push(
          <span key={key} className="text-muted italic">
            no rules text
          </span>,
        );
      } else {
        out.push(<KeywordChip key={key} label={label} />);
      }
      continue;
    }

    out.push(<span key={key}>{part}</span>);
  }
  return out;
}

/*
 * Reminder text is split off the raw string *before* tokenising, so a
 * parenthesised run containing its own symbols (e.g. "(You may pay
 * :rb_energy_1::rb_rune_chaos: ...)") still dims as one unit.
 */
const REMINDER_RE = /(\([^)]*\))/g;

/** Renders one line of card text: symbols, keywords and dimmed reminders. */
export function renderCardText(text: string, keyPrefix = 't'): ReactNode[] {
  const out: ReactNode[] = [];
  let i = 0;
  for (const segment of text.split(REMINDER_RE)) {
    if (!segment) continue;
    const key = `${keyPrefix}-${i++}`;
    if (segment.startsWith('(') && segment.endsWith(')')) {
      out.push(
        <span key={key} className="text-muted italic">
          {renderRun(segment, key)}
        </span>,
      );
    } else {
      out.push(...renderRun(segment, key));
    }
  }
  return out;
}

/** Full rules text, one paragraph per line break. */
export function CardText({ text, className = '' }: { text: string; className?: string }) {
  const lines = text.split('\n').filter((l) => l.trim().length > 0);
  return (
    <div className={className}>
      {lines.map((line, i) => (
        <p key={i} className={i > 0 ? 'mt-2' : undefined}>
          {renderCardText(line, `l${i}`)}
        </p>
      ))}
    </div>
  );
}

/** The Energy + Power cost of a card, as printed. */
export function CostLine({
  energy,
  power,
  domains,
  size = 16,
}: {
  energy: number | null;
  power: number | null;
  domains: Domain[];
  size?: number;
}): JSX.Element | null {
  if (energy === null && !power) return null;
  // Power is paid in the card's own domain; multi-domain cards print rainbow.
  const powerDomain: Domain | 'rainbow' =
    domains.length === 1 && domains[0] !== 'Colorless' ? domains[0] : 'rainbow';
  return (
    <span className="inline-flex items-center gap-0.5">
      {energy !== null && <EnergyGlyph value={energy} size={size} />}
      {Array.from({ length: power ?? 0 }, (_, i) => (
        <RuneGlyph key={i} domain={powerDomain} size={size - 1} />
      ))}
    </span>
  );
}
