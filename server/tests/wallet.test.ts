import { describe, it, expect } from 'vitest';
import { InMemoryWallet, SupabasePlayWallet } from '../src/wallet.js';
import { verifyToken } from '../src/auth.js';
import { AllowAllCompliance } from '../src/compliance.js';

describe('play wallet', () => {
  it('debit/credit with idempotent txIds', async () => {
    const wallet = new InMemoryWallet();
    const u = 'w1';
    await wallet.credit(u, 10000, 'init-w1');
    expect(await wallet.getBalance(u)).toBe(10000);
    await wallet.debit(u, 200, 'tx1');
    await expect(wallet.debit(u, 999999, 'tx2')).rejects.toThrow('INSUFFICIENT');
    await wallet.debit(u, 100, 'dup');
    await wallet.debit(u, 100, 'dup');
    expect(await wallet.getBalance(u)).toBe(9700);
  });

  it('refills broke players to 10k', async () => {
    const wallet = new SupabasePlayWallet();
    const u = 'broke';
    await wallet.credit(u, 1500, 'init-broke');
    await wallet.refill(u);
    expect(await wallet.getBalance(u)).toBe(10000);
    await wallet.debit(u, 100, 'spend');
    await wallet.refill(u); // still rich, no-op
    expect(await wallet.getBalance(u)).toBe(9900);
  });

  it('verifyToken dev stub returns subject', async () => {
    await expect(verifyToken('user-abc')).resolves.toBe('user-abc');
  });

  it('compliance allows all in v1', async () => {
    const c = new AllowAllCompliance();
    await expect(c.canPlay('u', '127.0.0.1')).resolves.toEqual({ ok: true });
  });
});
