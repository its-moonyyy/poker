export interface Wallet {
  debit(userId: string, amount: number, txId: string): Promise<void>;
  credit(userId: string, amount: number, txId: string): Promise<void>;
  getBalance(userId: string): Promise<number>;
}

export class InMemoryWallet implements Wallet {
  private balances = new Map<string, number>();
  private seen = new Set<string>();
  async debit(userId: string, amount: number, txId: string): Promise<void> {
    if (this.seen.has(txId)) return;
    const bal = this.balances.get(userId) ?? 0;
    if (bal < amount) throw new Error('INSUFFICIENT');
    this.balances.set(userId, bal - amount);
    this.seen.add(txId);
  }
  async credit(userId: string, amount: number, txId: string): Promise<void> {
    if (this.seen.has(txId)) return;
    this.balances.set(userId, (this.balances.get(userId) ?? 0) + amount);
    this.seen.add(txId);
  }
  async getBalance(userId: string): Promise<number> {
    return this.balances.get(userId) ?? 0;
  }
}

// Play-money wallet v1. Postgres-backed in prod (service-role, server only);
// in-memory here so tests run without creds. Real-money swap: implement
// Wallet + audit log + KYC-gated credit behind the same interface.
export class SupabasePlayWallet extends InMemoryWallet {
  static readonly STARTING = 10000;
  static readonly REBUY_BELOW = 2000;
  async refill(userId: string): Promise<number> {
    const bal = await this.getBalance(userId);
    if (bal < SupabasePlayWallet.REBUY_BELOW) {
      await this.credit(userId, SupabasePlayWallet.STARTING - bal, `refill-${userId}-${Date.now()}`);
    }
    return this.getBalance(userId);
  }
}
