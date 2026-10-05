import type { Card } from './cards.js';
import { buildSidePots } from './pots.js';
import { evaluateBest5, compareRanks } from './evaluator.js';

export type Intent = { t: 'fold' } | { t: 'call' } | { t: 'raiseTo'; to: number };
export type Street = 'preflop' | 'flop' | 'turn' | 'river' | 'showdown';

export class Table {
  numSeats: number;
  button: number;
  sb: number;
  bb: number;
  stacks: number[];
  committedHand: number[];
  committedStreet: number[];
  folded: boolean[];
  actingSeat: number | null = null;
  callTo = 0;
  minRaiseTo = 0;
  street: Street = 'preflop';
  over = false;
  private holes = new Map<number, Card[]>();
  private community: Card[] = [];
  private initialStacks: number[];
  private lastRaiseSize: number;

  constructor(numSeats = 6, button = 0, sb = 100, bb = 200, startingStacks?: number[]) {
    this.numSeats = numSeats;
    this.button = button;
    this.sb = sb;
    this.bb = bb;
    this.initialStacks = startingStacks ? [...startingStacks] : Array(numSeats).fill(10000);
    this.stacks = [...this.initialStacks];
    this.committedHand = Array(numSeats).fill(0);
    this.committedStreet = Array(numSeats).fill(0);
    this.folded = Array(numSeats).fill(false);
    this.lastRaiseSize = bb;
  }

  private activeSeats(): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.numSeats; i++) if (!this.folded[i]) out.push(i);
    return out;
  }

  private nextWithChips(from: number): number | null {
    for (let k = 1; k <= this.numSeats; k++) {
      const s = (from + k) % this.numSeats;
      if (!this.folded[s] && this.stacks[s] > 0) return s;
    }
    return null;
  }

  postBlinds(): void {
    const active = this.activeSeats();
    let sbSeat: number; let bbSeat: number;
    if (active.length === 2) {
      sbSeat = this.button % this.numSeats;
      bbSeat = (this.button + 1) % this.numSeats;
    } else {
      sbSeat = (this.button + 1) % this.numSeats;
      bbSeat = (this.button + 2) % this.numSeats;
    }
    this.post(sbSeat, this.sb);
    this.post(bbSeat, this.bb);
    this.callTo = this.bb;
    this.minRaiseTo = this.bb * 2;
    this.lastRaiseSize = this.bb;
    this.actingSeat = this.nextWithChips(bbSeat);
  }

  private post(seat: number, amount: number): void {
    const pay = Math.min(amount, this.stacks[seat]);
    this.stacks[seat] -= pay;
    this.committedStreet[seat] += pay;
    this.committedHand[seat] += pay;
  }

  setActing(seat: number): void {
    this.actingSeat = seat;
  }

  forceCommit(amounts: number[]): void {
    this.committedHand = [...amounts];
    this.committedStreet = Array(this.numSeats).fill(0);
    this.stacks = this.initialStacks.map((s, i) => s - (amounts[i] ?? 0));
  }

  setHole(seat: number, cards: Card[]): void {
    this.holes.set(seat, cards);
  }

  setCommunity(cards: Card[]): void {
    this.community = cards;
  }

  advanceStreet(): void {
    this.committedStreet = Array(this.numSeats).fill(0);
    this.callTo = 0;
    this.minRaiseTo = this.bb;
    this.lastRaiseSize = this.bb;
    const order: Street[] = ['preflop', 'flop', 'turn', 'river', 'showdown'];
    this.street = order[Math.min(order.indexOf(this.street) + 1, 4)];
    for (let k = 1; k <= this.numSeats; k++) {
      const s = (this.button + k) % this.numSeats;
      if (!this.folded[s] && this.stacks[s] > 0) {
        this.actingSeat = s;
        return;
      }
    }
    this.actingSeat = null;
  }

  act(seat: number, intent: Intent): void {
    if (this.over) throw new Error('HAND_OVER');
    if (this.actingSeat === null) throw new Error('HAND_OVER');
    if (seat !== this.actingSeat) throw new Error('NOT_YOUR_TURN');
    if (this.folded[seat]) throw new Error('NOT_YOUR_TURN');
    if (this.stacks[seat] <= 0) throw new Error('INSUFFICIENT');

    if (intent.t === 'fold') {
      this.folded[seat] = true;
      if (this.activeSeats().length <= 1) this.over = true;
      this.actingSeat = this.nextWithChips(seat);
      return;
    }
    if (intent.t === 'call') {
      const need = this.callTo - this.committedStreet[seat];
      if (need <= 0) {
        this.actingSeat = this.nextWithChips(seat);
        return;
      }
      const pay = Math.min(need, this.stacks[seat]);
      this.stacks[seat] -= pay;
      this.committedStreet[seat] += pay;
      this.committedHand[seat] += pay;
      this.actingSeat = this.nextWithChips(seat);
      return;
    }
    // raiseTo: target total street bet
    const to = intent.to;
    const cur = this.committedStreet[seat];
    const maxTo = cur + this.stacks[seat];
    if (!Number.isInteger(to) || to <= this.callTo) throw new Error('BAD_AMOUNT');
    if (to > maxTo) throw new Error('BAD_AMOUNT');
    const isAllIn = to === maxTo;
    if (!isAllIn && to < this.minRaiseTo) throw new Error('BAD_AMOUNT');
    const pay = to - cur;
    this.stacks[seat] -= pay;
    this.committedStreet[seat] = to;
    this.committedHand[seat] += pay;
    const raiseSize = to - this.callTo;
    this.callTo = to;
    if (raiseSize >= this.lastRaiseSize) {
      this.lastRaiseSize = raiseSize;
      this.minRaiseTo = to + raiseSize;
    }
    this.actingSeat = this.nextWithChips(seat);
  }

  showdown(): { pots: { eligible: number[]; amount: number }[]; payouts: Map<number, number> } {
    const contribs = this.committedHand
      .map((amount, seat) => ({ seat, amount }))
      .filter(c => c.amount > 0);
    const rawPots = buildSidePots(contribs);
    // Folded money stays: orphan levels (only folders eligible) cascade to nearest contested pot below.
    const pots: { eligible: number[]; amount: number }[] = [];
    for (const pot of rawPots) {
      const eligible = pot.eligible.filter(s => !this.folded[s]);
      if (eligible.length === 0) {
        if (pots.length > 0) pots[pots.length - 1].amount += pot.amount;
        else if (rawPots.length > 0) {
          // No contested pot yet; attach to next contested pot (handled by pre-scan below).
        }
        continue;
      }
      pots.push({ eligible, amount: pot.amount });
    }
    // If the first pot(s) were orphans with no prior contested pot, fold them into first contested pot.
    if (pots.length === 0 && rawPots.length > 0) {
      const total = rawPots.reduce((s, p) => s + p.amount, 0);
      const anyEligible = rawPots.flatMap(p => p.eligible).filter(s => !this.folded[s]);
      if (anyEligible.length > 0) pots.push({ eligible: [...new Set(anyEligible)], amount: total });
    } else if (rawPots.length > pots.length) {
      // Account for leading orphans merged: recompute total to conserve.
      const totalRaw = rawPots.reduce((s, p) => s + p.amount, 0);
      const totalKept = pots.reduce((s, p) => s + p.amount, 0);
      if (totalKept < totalRaw && pots.length > 0) pots[0].amount += totalRaw - totalKept;
    }
    const payouts = new Map<number, number>();
    const orderFromButton = (seats: number[]) =>
      [...seats].sort((a, b) => ((a - this.button - 1 + this.numSeats) % this.numSeats) - ((b - this.button - 1 + this.numSeats) % this.numSeats));

    for (const pot of pots) {
      const eligible = pot.eligible.filter(s => !this.folded[s]);
      if (eligible.length === 0) continue;
      const ranked = eligible.map(s => {
        const hole = this.holes.get(s) ?? [];
        return { seat: s, rank: evaluateBest5([...hole, ...this.community]) };
      });
      let best = ranked[0];
      for (const r of ranked.slice(1)) if (compareRanks(r.rank, best.rank) > 0) best = r;
      const winners = ranked.filter(r => compareRanks(r.rank, best.rank) === 0).map(r => r.seat);
      const ordered = orderFromButton(winners);
      const share = Math.floor(pot.amount / winners.length);
      let remainder = pot.amount - share * winners.length;
      for (const w of ordered) {
        let amt = share;
        if (remainder > 0) { amt += 1; remainder -= 1; }
        payouts.set(w, (payouts.get(w) ?? 0) + amt);
      }
    }
    // credit stacks
    for (const [seat, amt] of payouts) this.stacks[seat] += amt;
    this.over = true;
    return { pots, payouts };
  }
}
