import Phaser from 'phaser';
import type { Room } from 'colyseus.js';
import { clampRaise, type Intent } from '../net.js';

interface SeatView { stack: number; bet: number; folded: boolean }
interface TableState {
  seats: { userId: string | null }[];
  community: { rank: number; suit: number }[];
  pots: number[];
  actingSeat: number | null;
  deadline: number;
  button: number;
  callTo: number;
  streetBet?: number;
  minRaiseTo?: number;
  maxTo?: number;
}

const RANKS = ['', '', '2','3','4','5','6','7','8','9','T','J','Q','K','A'];

export class TableScene extends Phaser.Scene {
  private room: Room | null = null;
  private state: TableState | null = null;
  private mySeat = 0;
  private myHole: { rank: number; suit: number }[] = [];
  private statusText!: Phaser.GameObjects.Text;
  private connDot!: Phaser.GameObjects.Arc;
  private raiseValue = 400;

  constructor() { super('table'); }

  init(data: { room?: Room }) {
    if (data?.room) {
      this.room = data.room;
      this.room.onMessage('seat', (m: { seat: number }) => { this.mySeat = m.seat; });
      this.room.onMessage('state', (s: TableState) => this.render(s));
      this.room.onMessage('hole', (h: { rank: number; suit: number }[]) => { this.myHole = h; });
      this.room.onMessage('reject', (r: { code: string }) => {
        this.statusText?.setText(`Rejected: ${r.code}`);
      });
      this.room.onLeave(() => this.connDot?.setFillStyle(0xff0000));
    }
  }

  create() {
    this.statusText = this.add.text(20, 16, 'Connecting…', { fontSize: '18px' });
    this.connDot = this.add.circle(1250, 24, 10, 0x00ff00);
    this.drawFelt();
    this.createActionBar();
  }

  private drawFelt() {
    this.add.rectangle(640, 360, 1100, 560, 0x1b4332).setStrokeStyle(4, 0x95d5b2);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
      const x = 640 + Math.cos(a) * 460;
      const y = 360 + Math.sin(a) * 230;
      this.add.circle(x, y, 44, 0x2d6a4f).setStrokeStyle(2, 0xffffff);
      this.add.text(x - 30, y - 10, `P${i + 1}`, { fontSize: '16px' });
    }
  }

  private createActionBar() {
    const y = 660;
    const mk = (x: number, label: string, fn: () => void) => {
      const t = this.add.text(x, y, label, { fontSize: '20px', backgroundColor: '#333' }).setInteractive({ useHandCursor: true });
      t.on('pointerdown', fn);
      return t;
    };
    mk(60, 'Fold', () => this.send({ t: 'fold' }));
    mk(180, 'Check/Call', () => this.send({ t: 'call' }));
    mk(360, 'Raise', () => {
      const s = this.state; if (!s) return;
      const min = s.minRaiseTo ?? (s.callTo + 200);
      const max = s.maxTo ?? min;
      this.send({ t: 'raiseTo', to: clampRaise(this.raiseValue, min, max) });
    });
    mk(500, '1/2-pot', () => { this.raiseValue = this.potSize() / 2; });
    mk(640, 'Pot', () => { this.raiseValue = this.potSize(); });
    mk(740, 'All-in', () => { const s = this.state; if (s?.maxTo) this.send({ t: 'raiseTo', to: s.maxTo }); });
  }

  private potSize(): number {
    return this.state?.pots?.reduce((s: number, x: number) => s + x, 0) ?? 0;
  }

  private send(intent: Intent) {
    if (!this.room || !this.state) return;
    if (this.state.actingSeat !== this.mySeat) return; // buttons disabled unless our turn
    this.room.send('action', intent);
  }

  render(state: TableState) {
    this.state = state;
    const secs = state.actingSeat === null ? 0 : Math.max(0, Math.ceil((state.deadline - Date.now()) / 1000));
    this.statusText.setText(`Pot ${this.potSize()} — acting ${state.actingSeat ?? '-'} (${secs}s) — you are P${this.mySeat + 1}`);
    // Opponent cards: backs only — never render face values except own hole + community.
    const cards = state.community.map(c => `${RANKS[c.rank]}${'shdc'[c.suit]}`).join(' ');
    this.add.text(440, 300, cards || '(preflop)', { fontSize: '28px' }).setDepth(10);
  }
}
