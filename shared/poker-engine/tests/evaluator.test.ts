import { describe, it, expect } from 'vitest';
import { evaluateBest5, compareRanks } from '../src/evaluator.js';
import type { Card } from '../src/cards.js';

const C = (rank: number, suit: number): Card => ({ rank, suit });
// suits: 0=spades,1=hearts,2=diamonds,3=clubs

describe('evaluateBest5', () => {
  it('royal flush is straight-flush', () => {
    const seven = [C(14,0),C(13,0),C(12,0),C(11,0),C(10,0),C(2,1),C(3,2)];
    expect(evaluateBest5(seven).category).toBe(8);
  });
  it('straight flush 9-high', () => {
    const seven = [C(9,1),C(8,1),C(7,1),C(6,1),C(5,1),C(14,0),C(2,3)];
    const r = evaluateBest5(seven);
    expect(r.category).toBe(8); expect(r.kickers[0]).toBe(9);
  });
  it('quads aces', () => {
    const seven = [C(14,0),C(14,1),C(14,2),C(14,3),C(13,0),C(2,1),C(3,2)];
    const r = evaluateBest5(seven);
    expect(r.category).toBe(7); expect(r.kickers).toEqual([14,13]);
  });
  it('full house kings over queens', () => {
    const seven = [C(13,0),C(13,1),C(13,2),C(12,0),C(12,1),C(2,3),C(3,0)];
    const r = evaluateBest5(seven);
    expect(r.category).toBe(6); expect(r.kickers).toEqual([13,12]);
  });
  it('flush ace-high', () => {
    const seven = [C(14,1),C(11,1),C(9,1),C(6,1),C(4,1),C(13,0),C(2,3)];
    const r = evaluateBest5(seven);
    expect(r.category).toBe(5); expect(r.kickers[0]).toBe(14);
  });
  it('wheel straight A-2-3-4-5 is 5-high', () => {
    const seven = [C(14,0),C(2,1),C(3,2),C(4,3),C(5,0),C(13,1),C(9,2)];
    const r = evaluateBest5(seven);
    expect(r.category).toBe(4); expect(r.kickers[0]).toBe(5);
  });
  it('broadway straight', () => {
    const seven = [C(14,0),C(13,1),C(12,2),C(11,3),C(10,0),C(2,1),C(3,2)];
    expect(evaluateBest5(seven).category).toBe(4);
  });
  it('three of a kind', () => {
    const seven = [C(7,0),C(7,1),C(7,2),C(14,0),C(9,1),C(2,3),C(3,0)];
    const r = evaluateBest5(seven);
    expect(r.category).toBe(3); expect(r.kickers[0]).toBe(7);
  });
  it('two pair aces and kings', () => {
    const seven = [C(14,0),C(14,1),C(13,0),C(13,1),C(9,2),C(2,3),C(3,0)];
    const r = evaluateBest5(seven);
    expect(r.category).toBe(2); expect(r.kickers.slice(0,2)).toEqual([14,13]);
  });
  it('pair kings beats pair queens', () => {
    const kings = evaluateBest5([C(13,0),C(13,1),C(14,0),C(9,1),C(5,2),C(2,3),C(3,0)]);
    const queens = evaluateBest5([C(12,0),C(12,1),C(14,0),C(9,1),C(5,2),C(2,3),C(3,0)]);
    expect(kings.category).toBe(1);
    expect(compareRanks(kings, queens)).toBeGreaterThan(0);
  });
  it('kicker decides tied pair', () => {
    const aceKick = evaluateBest5([C(13,0),C(13,1),C(14,0),C(9,1),C(5,2),C(2,3),C(3,1)]);
    const queenKick = evaluateBest5([C(13,2),C(13,3),C(12,0),C(9,1),C(5,2),C(2,3),C(3,1)]);
    expect(compareRanks(aceKick, queenKick)).toBeGreaterThan(0);
  });
  it('identical boards tie', () => {
    const a = evaluateBest5([C(14,1),C(11,1),C(9,1),C(6,1),C(4,1),C(2,0),C(3,3)]);
    const b = evaluateBest5([C(4,1),C(6,1),C(9,1),C(11,1),C(14,1),C(7,0),C(8,3)]);
    expect(compareRanks(a, b)).toBe(0);
  });
});
