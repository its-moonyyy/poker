import type { Card } from '../../shared/poker-engine/src/cards.js';

export interface SeatInfo {
  userId: string | null;
  connected: boolean;
  stack: number;
}

export interface PublicSnapshot {
  seats: SeatInfo[];
  community: Card[];
  pots: number[];
  actingSeat: number | null;
  deadline: number;
  button: number;
  callTo: number;
  streetBet: number;
  over: boolean;
  hole: Card[];
  opponents: { seat: number; holeCount: number }[];
}
