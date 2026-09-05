import type { Card } from '@/types';
import type { Deck } from '@/features/decks/types';
import { nextInt, shuffle } from './rng';
import type { BattlefieldState, CardInstance, GameState, PlayerId, PlayerState } from './types';

/** Opening hand. 116 */
export const OPENING_HAND = 4;
/** 1v1 (Duel). 485.3 / 485.4 */
export const VICTORY_SCORE = 8;
export const BATTLEFIELDS_IN_PLAY = 2;

export interface SetupInput {
  decks: Record<PlayerId, Deck>;
  byId: Map<string, Card>;
  seed?: number;
  /** Force who goes first; otherwise chosen at random. 115 */
  firstPlayer?: PlayerId;
}

let uidCounter = 0;

/**
 * Instance ids are sequential rather than random so a game set up from the same
 * seed produces byte-identical state — the property replay and undo rely on.
 */
function makeUid(prefix: string): string {
  uidCounter += 1;
  return `${prefix}${uidCounter}`;
}

/** Resets the instance counter. Tests call this to keep uids stable. */
export function resetUids(): void {
  uidCounter = 0;
}

/**
 * Builds the opening game state for 1v1 (Duel), following the Setup Process
 * (110-118) and the mode's own setup (485.5).
 *
 * Not implemented: the mulligan (117). Both players simply keep their four.
 */
export function setupGame({ decks, byId, seed = 1, firstPlayer }: SetupInput): GameState {
  resetUids();
  const instances: Record<string, CardInstance> = {};
  let rng = seed;

  const instantiate = (cardId: string, owner: PlayerId, prefix: string): string => {
    const uid = makeUid(prefix);
    instances[uid] = { uid, cardId, owner };
    return uid;
  };

  const players = {} as Record<PlayerId, PlayerState>;
  const battlefields: BattlefieldState[] = [];

  for (const id of ['p1', 'p2'] as PlayerId[]) {
    const deck = decks[id];

    // 114 — shuffle the main and rune decks separately.
    const mainCards: string[] = [];
    for (const entry of deck.main) {
      for (let i = 0; i < entry.qty; i++) mainCards.push(entry.cardId);
    }
    const runeCards: string[] = [];
    for (const entry of deck.runes) {
      for (let i = 0; i < entry.qty; i++) runeCards.push(entry.cardId);
    }

    // 112 — the Chosen Champion starts in the Champion Zone, so it is not
    // shuffled into the deck even though it is a main-deck card.
    const championIndex = deck.championId ? mainCards.indexOf(deck.championId) : -1;
    if (championIndex >= 0) mainCards.splice(championIndex, 1);

    const shuffledMain = shuffle(mainCards, rng);
    rng = shuffledMain.seed;
    const shuffledRunes = shuffle(runeCards, rng);
    rng = shuffledRunes.seed;

    const mainDeck = shuffledMain.items.map((c) => instantiate(c, id, 'c'));
    const runeDeck = shuffledRunes.items.map((c) => instantiate(c, id, 'r'));

    // 485.5 — each player randomly selects one of their three battlefields.
    const pick = nextInt(rng, Math.max(1, deck.battlefields.length));
    rng = pick.seed;
    const chosen = deck.battlefields[pick.value];
    if (chosen) {
      battlefields.push({
        uid: instantiate(chosen, id, 'b'),
        contributedBy: id,
        controller: null,
        contested: false,
        scoredBy: [],
      });
    }

    players[id] = {
      id,
      legendCardId: deck.legendId ?? '',
      championCardId: deck.championId ?? '',
      championZone: deck.championId ? instantiate(deck.championId, id, 'ch') : null,
      // 116 — each player draws 4.
      hand: mainDeck.splice(0, OPENING_HAND),
      mainDeck,
      runeDeck,
      trash: [],
      points: 0,
      energy: 0,
      power: {},
      burnedOut: false,
    };
  }

  // 115 — determine turn order at random unless the caller fixed it.
  let first = firstPlayer;
  if (!first) {
    const roll = nextInt(rng, 2);
    rng = roll.seed;
    first = roll.value === 0 ? 'p1' : 'p2';
  }

  const legendName = (id: PlayerId) => byId.get(players[id].legendCardId)?.baseName ?? 'Unknown';

  return {
    rng,
    turn: 1,
    turnPlayer: first,
    firstPlayer: first,
    phase: 'awaken',
    players,
    instances,
    units: {},
    runes: {},
    hidden: {},
    battlefields,
    showdown: null,
    victoryScore: VICTORY_SCORE,
    winner: null,
    unautomated: [],
    log: [
      {
        turn: 1,
        phase: 'awaken',
        player: null,
        text: `${legendName('p1')} vs ${legendName('p2')} — ${first} goes first.`,
        rule: '115',
      },
    ],
  };
}
