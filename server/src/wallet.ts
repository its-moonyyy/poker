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
