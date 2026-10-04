import type { Card } from './cards.js';
import type { RNG } from './rng.js';

export class Deck {
  private cards: Card[] = [];
  constructor(private rng: RNG) {
    for (let suit = 0; suit < 4; suit++) {
      for (let rank = 2; rank <= 14; rank++) {
        this.cards.push({ rank, suit });
      }
    }
  }
  shuffle(): void {
    this.rng.shuffle(this.cards);
  }
  draw(): Card {
    const c = this.cards.shift();
    if (!c) throw new Error('DECK_EMPTY');
    return c;
  }
  remaining(): number {
    return this.cards.length;
  }
}
