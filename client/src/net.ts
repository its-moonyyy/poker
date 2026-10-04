import { Client, type Room } from 'colyseus.js';

export type Intent = { t: 'fold' } | { t: 'call' } | { t: 'raiseTo'; to: number };

export async function joinTable(roomName = 'poker-table', buyIn = 10000): Promise<Room> {
  const url = (import.meta as unknown as { env: Record<string, string> }).env?.COLYSEUS_URL ?? 'ws://localhost:2567';
  const client = new Client(url);
  return client.joinOrCreate(roomName, { buyIn });
}

export function clampRaise(to: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.floor(to)));
}
