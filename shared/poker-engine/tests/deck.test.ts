import { describe, it, expect } from 'vitest';
import { Deck } from '../src/deck.js';
import { SeededRNG } from '../src/rng.js';
describe('Deck', () => {
  it('deals 52 unique cards then empty', () => {
    const d = new Deck(new SeededRNG(1)); d.shuffle();
    const seen = new Set(Array.from({length:52}, () => { const c=d.draw(); return c.rank*10+c.suit; }));
    expect(seen.size).toBe(52); expect(d.remaining()).toBe(0);
  });
  it('seeded shuffle is deterministic', () => {
    const a = new Deck(new SeededRNG(42)); a.shuffle(); const c1=a.draw();
    const b = new Deck(new SeededRNG(42)); b.shuffle(); const c2=b.draw();
    expect(c1).toEqual(c2);
  });
});
