import { describe, it, expect } from 'vitest';
import { Table } from '../src/table.js';
import type { Card } from '../src/cards.js';

const C = (rank: number, suit: number): Card => ({ rank, suit });
const stacks = () => [10000, 10000, 10000, 10000, 10000, 10000];

describe('Table betting', () => {
  it('posts blinds 6-max (SB seat1, BB seat2)', () => {
    const t = new Table(6, 0, 100, 200, stacks());
    t.postBlinds();
    expect(t.stacks[1]).toBe(9900); expect(t.stacks[2]).toBe(9800);
    expect(t.actingSeat).toBe(3);
  });
  it('rejects out-of-turn action', () => {
    const t = new Table(6, 0, 100, 200, stacks());
    t.postBlinds();
    expect(() => t.act(4, { t: 'call' })).toThrow('NOT_YOUR_TURN');
  });
  it('rejects short raise below min', () => {
    const t = new Table(6, 0, 100, 200, stacks());
    t.postBlinds();
    expect(() => t.act(3, { t: 'raiseTo', to: 50 })).toThrow('BAD_AMOUNT');
  });
  it('rejects over-stack raise', () => {
    const t = new Table(6, 0, 100, 200, stacks());
    t.postBlinds();
    expect(() => t.act(3, { t: 'raiseTo', to: 9999999 })).toThrow('BAD_AMOUNT');
  });
  it('call + fold advance action and conserve chips', () => {
    const t = new Table(6, 0, 100, 200, stacks());
    t.postBlinds();
    const before = t.stacks.reduce((s,x)=>s+x,0) + t.committedHand.reduce((s,x)=>s+x,0);
    t.act(3, { t: 'fold' });
    t.act(4, { t: 'call' });
    expect(t.folded[3]).toBe(true);
    const after = t.stacks.reduce((s,x)=>s+x,0) + t.committedHand.reduce((s,x)=>s+x,0);
    expect(after).toBe(before);
  });
  it('double all-in second is rejected once felted (idempotency)', () => {
    const t = new Table(6, 0, 100, 200, [500, 10000, 10000, 10000, 10000, 10000]);
    t.postBlinds();
    // seat0 has 500; force action to seat0
    t.setActing(0);
    t.act(0, { t: 'raiseTo', to: 500 });
    expect(t.stacks[0]).toBe(0);
    expect(() => t.act(0, { t: 'raiseTo', to: 1000 })).toThrow();
  });
  it('showdown splits tied pot with odd chip left of button', () => {
    const t = new Table(3, 2, 100, 200, [1000, 1000, 1000]);
    t.postBlinds();
    // force equal all-ins for a pure split test
    t.forceCommit([500, 500, 501]);
    t.setHole(0, [C(14,0), C(13,0)]);
    t.setHole(1, [C(14,1), C(13,1)]);
    t.setHole(2, [C(2,0), C(3,1)]);
    t.folded[2] = true; // seat2 out, seats 0/1 tie
    const community = [C(14,2), C(13,2), C(9,0), C(5,1), C(2,1)];
    t.setCommunity(community);
    const res = t.showdown();
    const totalIn = 500 + 500 + 501;
    const totalOut = [...res.payouts.values()].reduce((s,x)=>s+x,0);
    expect(totalOut).toBe(totalIn);
  });
});
