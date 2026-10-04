export interface SidePot {
  eligible: number[];
  amount: number;
}

export function buildSidePots(contribs: { seat: number; amount: number }[]): SidePot[] {
  const active = contribs.filter(c => c.amount > 0).sort((a, b) => a.amount - b.amount);
  const pots: SidePot[] = [];
  let prev = 0;
  for (let i = 0; i < active.length; i++) {
    const level = active[i].amount;
    if (level === prev) continue;
    const contributors = active.filter(c => c.amount >= level).map(c => c.seat);
    const amount = (level - prev) * contributors.length;
    if (amount > 0) pots.push({ eligible: contributors, amount });
    prev = level;
  }
  return pots;
}
