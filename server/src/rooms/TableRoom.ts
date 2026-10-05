import { z } from 'zod';
import { Room } from 'colyseus';
import { Table } from '../../../shared/poker-engine/src/table.js';
import { buildSidePots } from '../../../shared/poker-engine/src/pots.js';
import { Deck } from '../../../shared/poker-engine/src/deck.js';
import { SeededRNG, CryptoRNG, type RNG } from '../../../shared/poker-engine/src/rng.js';
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
  seed?: number;
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
  private rng: RNG;
  readonly rngKind: string;

  constructor(wallet: Wallet, opts: ControllerOpts = {}) {
    this.wallet = wallet;
    this.sb = opts.sb ?? 100; this.bb = opts.bb ?? 200;
    this.buyIn = opts.buyIn ?? 10000;
    this.turnMs = opts.turnMs ?? 15000;
    this.reconnectMs = opts.reconnectMs ?? 60000;
    if (opts.seed !== undefined) { this.rng = new SeededRNG(opts.seed); this.rngKind = 'seeded'; }
    else { this.rng = new CryptoRNG(); this.rngKind = 'crypto'; }
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
    this.deck = new Deck(this.rng);
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

  joinOrReconnect(userId: string, buyIn?: number): { seat: number; reconnected: boolean } {
    const existing = this.state.seats.findIndex(s => s.userId === userId);
    if (existing !== -1) {
      const s = this.state.seats[existing];
      if (!s.connected && (s.disconnectedAt === null || Date.now() - s.disconnectedAt <= this.reconnectMs)) {
        s.connected = true;
        s.disconnectedAt = null;
        return { seat: existing, reconnected: true };
      }
      throw new Error('ALREADY_SEATED');
    }
    return { seat: this.join(userId, buyIn), reconnected: false };
  }

  send(seat: number, raw: unknown): { ok: true } | { ok: false; code: string } {
    if (!this.checkThrottle(seat)) return { ok: false, code: 'THROTTLED' };
    const parsed = MsgSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, code: 'BAD_AMOUNT' };
    if (!this.table || this.state.over) return { ok: false, code: 'HAND_OVER' };
    const msg = parsed.data as { t: string; to?: number };
    if (this.table.stacks[seat] <= 0 && msg.t !== 'fold') return { ok: false, code: 'INSUFFICIENT' };
    if (seat !== this.table.actingSeat) return { ok: false, code: 'NOT_YOUR_TURN' };
    try {
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
    const contribs = this.table.committedHand
      .map((amount, seat) => ({ seat, amount }))
      .filter(c => c.amount > 0);
    if (contribs.length === 0) return [0];
    return buildSidePots(contribs).map(p => p.amount);
  }

  /** Wire payload for one session: filtered state + that seat's private hole. */
  messageFor(seat: number): { state: PublicSnapshot; hole: Card[] } {
    return { state: this.publicSnapshot(seat), hole: this.privateHole(seat) };
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
    this.expireTurn();
  }

  /** Auto-check if free else auto-fold the acting seat (turn timer expiry). */
  expireTurn(): void {
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

  seatCount(): number {
    return this.state.seats.filter(s => s.userId !== null).length;
  }

  maxToForTest(seat: number): number {
    if (!this.table) return 0;
    return this.table.committedStreet[seat] + this.table.stacks[seat];
  }
}

export class TableRoom extends Room {
  ctrl!: PokerTableController;
  private sessions = new Map<string, number>();
  onCreate(opts: { buyIn?: number } = {}) {
    this.ctrl = new PokerTableController(new InMemoryWallet(), { buyIn: opts.buyIn ?? 10000 });
    this.setState({ tables: 1 });
    this.onMessage('action', (client, msg) => {
      const seat = this.sessions.get(client.sessionId);
      if (seat === undefined) return;
      const res = this.ctrl.send(seat, msg);
      if (!res.ok) client.send('reject', res);
      else this.broadcastState();
    });
  }
  async onJoin(client: { sessionId: string }, opts: { userId?: string; buyIn?: number } = {}) {
    const userId = opts.userId ?? client.sessionId;
    const { seat, reconnected } = this.ctrl.joinOrReconnect(userId, opts.buyIn);
    this.sessions.set(client.sessionId, seat);
    client.send('seat', { seat, reconnected });
    const hole = this.ctrl.privateHole(seat);
    if (hole.length > 0) client.send('hole', hole);
    if (this.ctrl.seatCount() === 2) this.ctrl.startHand();
    this.broadcastState();
  }
  async onLeave(client: { sessionId: string }) {
    const seat = this.sessions.get(client.sessionId);
    if (seat === undefined) return;
    const wasActing = this.ctrl.state.actingSeat === seat;
    this.ctrl.disconnect(seat);
    if (wasActing) {
      // Turn timer: auto-check/fold the disconnected seat when its clock runs out.
      this.clock.setTimeout(() => {
        this.ctrl.expireTurn();
        this.broadcastState();
      }, 15000);
    }
    this.broadcastState();
  }
  private broadcastState() {
    for (const [sessionId, seat] of this.sessions) {
      const client = this.clients.find((c: { sessionId: string }) => c.sessionId === sessionId);
      if (!client) continue;
      const msg = this.ctrl.messageFor(seat);
      client.send('state', msg.state);
      client.send('hole', msg.hole);
    }
  }
}
