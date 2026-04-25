import type { Card, PlayerId, Rank, Suit } from "./types.ts";

export const SUITS: Suit[] = ["oros", "copes", "espases", "bastos"];
export const RANKS: Rank[] = [1, 3, 4, 5, 6, 7];

export function buildDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      if (rank === 1 && suit !== "espases" && suit !== "bastos") continue;
      deck.push({ suit, rank, id: `${rank}-${suit}` });
    }
  }
  return deck;
}

export function cardStrength(c: Card): number {
  if (c.rank === 1 && c.suit === "espases") return 100;
  if (c.rank === 1 && c.suit === "bastos") return 95;
  if (c.rank === 7 && c.suit === "espases") return 90;
  if (c.rank === 7 && c.suit === "oros") return 85;
  if (c.rank === 3) return 70;
  if (c.rank === 7) return 60;
  if (c.rank === 6) return 50;
  if (c.rank === 5) return 40;
  if (c.rank === 4) return 30;
  return 0;
}

export function envitValue(c: Card): number {
  if (c.rank === 1) return 1;
  return c.rank;
}

/**
 * Calcula l'envit total d'un jugador en una ronda, considerant tant les
 * cartes que encara té a la mà com les que ja ha jugat. És l'origen de
 * veritat compartit entre client i edge function per a respondre
 * "¿Tens envit?" o decidir si envidar.
 */
export function playerTotalEnvit(
  round: { hands: Record<PlayerId, Card[]>; tricks: { cards: { player: PlayerId; card: Card }[] }[] },
  player: PlayerId,
): number {
  const hand = round.hands[player] ?? [];
  const played: Card[] = round.tricks
    .flatMap((t) => t.cards)
    .filter((tc) => tc.player === player)
    .map((tc) => tc.card);
  return bestEnvit([...hand, ...played]);
}

export function bestEnvit(hand: Card[]): number {
  const bySuit = new Map<Suit, Card[]>();
  for (const c of hand) {
    if (!bySuit.has(c.suit)) bySuit.set(c.suit, []);
    bySuit.get(c.suit)!.push(c);
  }
  let best = 0;
  let hasPair = false;
  for (const cards of bySuit.values()) {
    if (cards.length >= 2) {
      hasPair = true;
      const top2 = [...cards].sort((a, b) => envitValue(b) - envitValue(a)).slice(0, 2);
      best = Math.max(best, 20 + envitValue(top2[0]!) + envitValue(top2[1]!));
    }
  }
  if (!hasPair && hand.length > 0) {
    const highest = Math.max(...hand.map(envitValue));
    best = 10 + highest;
  }
  return best;
}

export const SUIT_SYMBOL: Record<Suit, string> = {
  oros: "🪙",
  copes: "🍷",
  espases: "⚔️",
  bastos: "🌳",
};

export const SUIT_NAME: Record<Suit, string> = {
  oros: "Oros",
  copes: "Copes",
  espases: "Espases",
  bastos: "Bastos",
};

export const RANK_NAME: Record<Rank, string> = {
  1: "As",
  3: "Tres",
  4: "Quatre",
  5: "Cinc",
  6: "Sis",
  7: "Set",
};
