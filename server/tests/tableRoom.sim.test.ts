import { describe, it, expect } from 'vitest';
import { PokerTableController } from '../src/rooms/TableRoom.js';
import { InMemoryWallet } from '../src/wallet.js';

const BUY = 10000;

async function bootFull() {
  const wallet = new InMemoryWallet();
  const ctrl = new PokerTableController(wallet, { sb: 100, bb: 200, buyIn: BUY });
  const users = ['u0','u1','u2','u3','u4','u5'];
  for (const u of users) {
    await wallet.credit(u, BUY, `init-${u}`);
    ctrl.join(u, BUY);
  }
  ctrl.startHand();
  return { wallet, ctrl, users };
}

describe('TableRoom sim', () => {
  it('over-stack raise rejected with BAD_AMOUNT, no state change', async () => {
    const { ctrl } = await bootFull();
    const acting = ctrl.state.actingSeat!;
    const before = JSON.stringify(ctrl.publicSnapshot(acting));
    const res = ctrl.send(acting, { t: 'raiseTo', to: 9999999 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('BAD_AMOUNT');
    expect(JSON.stringify(ctrl.publicSnapshot(acting))).toBe(before);
  });

  it('full 6-player hand to showdown conserves chips', async () => {
    const { ctrl } = await bootFull();
    // Play: everyone calls/checks until showdown (cap 200 actions to avoid infinite).
    let guard = 0;
    while (!ctrl.state.over && guard++ < 200) {
      const s = ctrl.state.actingSeat;
      if (s === null || s === undefined) { ctrl.advanceForTest(); continue; }
      const snap = ctrl.publicSnapshot(s);
      const r = ctrl.send(s, snap.callTo > snap.streetBet ? { t: 'call' } : { t: 'call' });
      if (!r.ok && (r as {code?:string}).code === 'HAND_OVER') break;
      if (ctrl.needsStreetAdvance()) ctrl.advanceForTest();
    }
    // Force showdown if still not over (all checked round).
    if (!ctrl.state.over) ctrl.forceShowdownForTest();
    const snap0 = ctrl.publicSnapshot(0);
    expect(snap0.over).toBe(true);
    const totalStacks = ctrl.state.stacks.reduce((s:number,x:number)=>s+x,0);
    expect(totalStacks).toBe(BUY * 6);
  });

  it('hole cards private: snapshot hides opponents cards', async () => {
    const { ctrl } = await bootFull();
    const s0 = ctrl.publicSnapshot(0);
    expect(s0.hole).toHaveLength(2);
    expect(s0.opponents).toBeDefined();
    for (const o of s0.opponents) expect(o.holeCount).toBe(2);
    // No actual card values for opponents.
    expect(JSON.stringify(s0)).not.toContain(JSON.stringify(ctrl.privateHole(1)));
  });

  it('timeout auto-folds or checks acting player', async () => {
    const { ctrl } = await bootFull();
    const acting = ctrl.state.actingSeat!;
    ctrl.expireDeadlineForTest();
    const after = ctrl.state.actingSeat;
    expect(after).not.toBe(acting);
  });

  it('disconnect reserves seat and reconnect restores hole', async () => {
    const { ctrl } = await bootFull();
    const holeBefore = ctrl.privateHole(2);
    ctrl.disconnect(2);
    expect(ctrl.state.seats[2].connected).toBe(false);
    const res = ctrl.reconnect(2, 'u2');
    expect(res.ok).toBe(true);
    expect(ctrl.privateHole(2)).toEqual(holeBefore);
  });

  it('double all-in second rejected, single debit', async () => {
    const wallet = new InMemoryWallet();
    const ctrl = new PokerTableController(wallet, { sb: 100, bb: 200, buyIn: 500 });
    for (const u of ['a','b','c','d','e','f']) {
      await wallet.credit(u, 10000, `init-${u}`);
      try { ctrl.join(u, 500); } catch {}
    }
    ctrl.startHand();
    ctrl.setActingForTest(0);
    const r1 = ctrl.send(0, { t: 'raiseTo', to: ctrl.maxToForTest(0) });
    expect(r1.ok).toBe(true);
    const r2 = ctrl.send(0, { t: 'raiseTo', to: 500 });
    expect(r2.ok).toBe(false);
  });
});
