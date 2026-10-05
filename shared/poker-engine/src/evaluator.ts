import type { Card } from './cards.js';

export interface HandRank {
  category: number; // 0=high,1=pair,2=two-pair,3=trips,4=straight,5=flush,6=full-house,7=quads,8=straight-flush
  kickers: number[];
}

export function compareRanks(a: HandRank, b: HandRank): number {
  if (a.category !== b.category) return a.category - b.category;
  const n = Math.max(a.kickers.length, b.kickers.length);
  for (let i = 0; i < n; i++) {
    const d = (a.kickers[i] ?? 0) - (b.kickers[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

function straightHigh(ranksDesc: number[]): number {
  const u = [...new Set(ranksDesc)];
  if (u.length !== 5) return 0;
  if (u[0] - u[4] === 4) return u[0];
  if (u[0] === 14 && u[1] === 5 && u[2] === 4 && u[3] === 3 && u[4] === 2) return 5;
  return 0;
}

function rank5(cards: Card[]): HandRank {
  const ranks = cards.map(c => c.rank).sort((a, b) => b - a);
  const flush = cards.every(c => c.suit === cards[0].suit);
  const sHigh = straightHigh(ranks);
  if (flush && sHigh) return { category: 8, kickers: [sHigh] };

  const counts = new Map<number, number>();
  for (const r of ranks) counts.set(r, (counts.get(r) ?? 0) + 1);
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const byCount = (n: number) => groups.filter(g => g[1] === n).map(g => g[0]).sort((a, b) => b - a);

  const quads = byCount(4);
  if (quads.length) {
    const kicker = groups.find(g => g[1] !== 4)![0];
    return { category: 7, kickers: [quads[0], kicker] };
  }
  const trips = byCount(3);
  const pairs = byCount(2);
  if (trips.length && pairs.length) return { category: 6, kickers: [trips[0], pairs[0]] };
  if (flush) return { category: 5, kickers: ranks };
  if (sHigh) return { category: 4, kickers: [sHigh] };
  if (trips.length) {
    const kick = groups.filter(g => g[1] === 1).map(g => g[0]).sort((a, b) => b - a);
    return { category: 3, kickers: [trips[0], ...kick] };
  }
  if (pairs.length >= 2) {
    const kick = groups.find(g => g[1] === 1)?.[0] ?? 0;
    return { category: 2, kickers: [pairs[0], pairs[1], kick] };
  }
  if (pairs.length === 1) {
    const kick = groups.filter(g => g[1] === 1).map(g => g[0]).sort((a, b) => b - a);
    return { category: 1, kickers: [pairs[0], ...kick] };
  }
  return { category: 0, kickers: ranks };
}

export function evaluateBest5(seven: Card[]): HandRank {
  if (seven.length < 5 || seven.length > 7) throw new Error('BAD_HAND_SIZE');
  let best: HandRank | null = null;
  const n = seven.length;
  for (let a = 0; a < n - 4; a++)
    for (let b = a + 1; b < n - 3; b++)
      for (let c = b + 1; c < n - 2; c++)
        for (let d = c + 1; d < n - 1; d++)
          for (let e = d + 1; e < n; e++) {
            const r = rank5([seven[a], seven[b], seven[c], seven[d], seven[e]]);
            if (!best || compareRanks(r, best) > 0) best = r;
          }
  return best!;
}
