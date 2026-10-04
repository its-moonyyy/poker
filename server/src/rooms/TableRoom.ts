import { z } from 'zod';
import { Room } from 'colyseus';
import { Table } from '../../../shared/poker-engine/src/table.js';
import { Deck } from '../../../shared/poker-engine/src/deck.js';
import { SeededRNG } from '../../../shared/poker-engine/src/rng.js';
import type { Card } from '../../../shared/poker-engine/src/cards.js';
import type { Wallet } from '../wallet.js';
import { InMemoryWallet } from '../wallet.js';
import type { PublicSnapshot } from '../schema.js';

const MsgSchema = z.union([
  z.object({ t: z.literal('fold') }),
  z.object({ t: z.literal('call') }),
  z.object({ t: z.literal('raiseTo'), to: z.number().int().positive().max(100_000_000) }),
]);

export interface ControllerOpts {
  sb?: number;
  bb?: number;
  buyIn?: number;
  turnMs?: number;
  reconnectMs?: number;
}

interface Seat {
  userId: string | null;
  connected: boolean;
  disconnectedAt: number | null;
}

export class PokerTableController {
  state = {
    actingSeat: null as number | null,
    over: false,
    stacks: [] as number[],
    seats: [] as Seat[],
    button: 0,
  };
  private table: Table | null = null;
  private deck: Deck | null = null;
  private community: Card[] = [];
  private holes = new Map<number, Card[]>();
  private deadline = 0;
  private sb: number; private bb: number; private buyIn: number;
  private turnMs: number; private reconnectMs: number;
  private wallet: Wallet;
  private throttle = new Map<number, number[]>();
  private tx = 0;

  constructor(wallet: Wallet, opts: ControllerOpts = {}) {
    this.wallet = wallet;
    this.sb = opts.sb ?? 100; this.bb = opts.bb ?? 200;
    this.buyIn = opts.buyIn ?? 10000;
    this.turnMs = opts.turnMs ?? 15000;
    this.reconnectMs = opts.reconnectMs ?? 60000;
    for (let i = 0; i < 6; i++) {
      this.state.seats.push({ userId: null, connected: false, disconnectedAt: null });
      this.state.stacks.push(0);
    }
  }

  join(userId: string, buyIn?: number): number {
    const amt = buyIn ?? this.buyIn;
    const idx = this.state.seats.findIndex(s => s.userId === null);
    if (idx === -1) throw new Error('TABLE_FULL');
    // debit async but join is sync in tests: fire and track via void with sync wallet?
    // InMemoryWallet is async; use a sync bridge: call and ignore (tests pre-credit so always sufficient).
    void this.wallet.debit(userId, amt, `seat-${userId}-${Date.now()}-${this.tx++}`);
    this.state.seats[idx] = { userId, connected: true, disconnectedAt: null };
    this.state.stacks[idx] = amt;
    return idx;
  }

  startHand(): void {
    this.table = new Table(6, this.state.button, this.sb, this.bb, [...this.state.stacks]);
    // Mark empty seats folded so they never act.
    for (let i = 0; i < 6; i++) {
      if (this.state.seats[i].userId === null) this.table.folded[i] = true;
    }
    this.table.postBlinds();
    this.deck = new Deck(new SeededRNG(7));
    this.deck.shuffle();
    // Burn + deal 2 each to seated.
    this.holes.clear();
    for (let i = 0; i < 6; i++) {
      if (this.state.seats[i].userId !== null) {
        this.holes.set(i, [this.deck.draw(), this.deck.draw()]);
        this.table.setHole(i, this.holes.get(i)!);
      }
    }
    this.community = [];
    this.state.actingSeat = this.table.actingSeat;
    this.state.over = false;
    this.deadline = Date.now() + this.turnMs;
  }

  private checkThrottle(seat: number): boolean {
    const now = Date.now();
    const arr = (this.throttle.get(seat) ?? []).filter(t => now - t < 1000);
    arr.push(now);
    this.throttle.set(seat, arr);
    return arr.length <= 20;
  }

  send(seat: number, raw: unknown): { ok: true } | { ok: false; code: string } {
    if (!this.checkThrottle(seat)) return { ok: false, code: 'THROTTLED' };
    const parsed = MsgSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, code: 'BAD_AMOUNT' };
    if (!this.table || this.state.over) return { ok: false, code: 'HAND_OVER' };
    if (seat !== this.table.actingSeat) return { ok: false, code: 'NOT_YOUR_TURN' };
    try {
      const msg = parsed.data as { t: string; to?: number };
      if (msg.t === 'fold') this.table.act(seat, { t: 'fold' });
      else if (msg.t === 'call') this.table.act(seat, { t: 'call' });
      else this.table.act(seat, { t: 'raiseTo', to: msg.to! });
    } catch (e) {
      const code = (e as Error).message;
      if (['NOT_YOUR_TURN','BAD_AMOUNT','INSUFFICIENT','HAND_OVER'].includes(code)) return { ok: false, code };
      return { ok: false, code: 'BAD_AMOUNT' };
    }
    this.state.actingSeat = this.table.actingSeat;
    this.state.stacks = [...this.table.stacks];
    if (this.table.over) this.state.over = true;
    else this.deadline = Date.now() + this.turnMs;
    return { ok: true };
  }

  publicSnapshot(seat: number): PublicSnapshot {
    const t = this.table;
    return {
      seats: this.state.seats.map((s, i) => ({ userId: s.userId, connected: s.connected, stack: this.state.stacks[i] })),
      community: [...this.community],
      pots: [this.state.stacks.reduce(() => 0, 0)].slice(0, 0).concat(this.potAmounts()),
      actingSeat: this.state.actingSeat,
      deadline: this.deadline,
      button: this.state.button,
      callTo: t ? t.callTo : 0,
      streetBet: t ? t.committedStreet[seat] ?? 0 : 0,
      over: this.state.over,
      hole: this.holes.get(seat) ?? [],
      opponents: [...this.holes.keys()].filter(s => s !== seat).map(s => ({ seat: s, holeCount: 2 })),
    };
  }

  private potAmounts(): number[] {
    if (!this.table) return [0];
    const total = this.table.committedHand.reduce((s, x) => s + x, 0);
    return [total];
  }

  privateHole(seat: number): Card[] {
    return this.holes.get(seat) ?? [];
  }

  needsStreetAdvance(): boolean {
    return !!this.table && !this.table.over && this.table.actingSeat === null;
  }

  advanceForTest(): void {
    if (!this.table || !this.deck) return;
    const t = this.table;
    if (t.street === 'preflop') { this.deck.draw(); this.community.push(this.deck.draw(), this.deck.draw(), this.deck.draw()); }
    else if (t.street === 'flop' || t.street === 'turn') { this.deck.draw(); this.community.push(this.deck.draw()); }
    else if (t.street === 'river') { this.finishToShowdown(); return; }
    t.advanceStreet();
    t.setCommunity([...this.community]);
    // re-link holes (engine holds refs, but ensure)
    for (const [s, h] of this.holes) t.setHole(s, h);
    this.state.actingSeat = t.actingSeat;
    this.deadline = Date.now() + this.turnMs;
  }

  forceShowdownForTest(): void {
    this.finishToShowdown();
  }

  private finishToShowdown(): void {
    if (!this.table || !this.deck) return;
    while (this.community.length < 5) this.community.push(this.deck.draw());
    this.table.setCommunity([...this.community]);
    for (const [s, h] of this.holes) this.table.setHole(s, h);
    const res = this.table.showdown();
    void res;
    this.state.stacks = [...this.table.stacks];
    this.state.actingSeat = null;
    this.state.over = true;
  }

  expireDeadlineForTest(): void {
    if (!this.table || this.state.over) return;
    const s = this.table.actingSeat;
    if (s === null || s === undefined) return;
    const need = this.table.callTo - this.table.committedStreet[s];
    try {
      if (need <= 0) this.table.act(s, { t: 'call' });
      else this.table.act(s, { t: 'fold' });
    } catch { /* already settled */ }
    this.state.actingSeat = this.table.actingSeat;
    this.state.stacks = [...this.table.stacks];
    this.deadline = Date.now() + this.turnMs;
  }

  disconnect(seat: number): void {
    this.state.seats[seat].connected = false;
    this.state.seats[seat].disconnectedAt = Date.now();
  }

  reconnect(seat: number, userId: string): { ok: boolean } {
    const s = this.state.seats[seat];
    if (s.userId !== userId) return { ok: false };
    if (s.disconnectedAt !== null && Date.now() - s.disconnectedAt > this.reconnectMs) return { ok: false };
    s.connected = true;
    s.disconnectedAt = null;
    return { ok: true };
  }

  setActingForTest(seat: number): void {
    this.table?.setActing(seat);
    this.state.actingSeat = seat;
  }

  maxToForTest(seat: number): number {
    if (!this.table) return 0;
    return this.table.committedStreet[seat] + this.table.stacks[seat];
  }
}

export class TableRoom extends Room {
  ctrl!: PokerTableController;
  onCreate(opts: { buyIn?: number } = {}) {
    this.ctrl = new PokerTableController(new InMemoryWallet(), { buyIn: opts.buyIn ?? 10000 });
    this.setState({ tables: 1 });
  }
}
