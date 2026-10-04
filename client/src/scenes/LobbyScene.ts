import Phaser from 'phaser';
import { joinTable } from '../net.js';

export class LobbyScene extends Phaser.Scene {
  constructor() { super('lobby'); }
  create() {
    const balance = Number(localStorage.getItem('chips') ?? 10000);
    const balanceText = this.add.text(40, 30, `Poker lobby — balance ${balance}`, { fontSize: '24px' });
    this.add.text(40, 70, 'Tables: #1 (6-max, 100/200)', { fontSize: '18px' });
    const refill = this.add.text(40, 160, '[ Refill to 10k ]', { fontSize: '20px', backgroundColor: '#555' })
      .setInteractive({ useHandCursor: true });
    refill.on('pointerdown', () => {
      const bal = Number(localStorage.getItem('chips') ?? 10000);
      if (bal < 2000) {
        localStorage.setItem('chips', '10000');
        balanceText.setText('Poker lobby — balance 10000');
      }
    });
    const btn = this.add.text(40, 120, '[ Join table ]', { fontSize: '22px', backgroundColor: '#2d6a4f' })
      .setInteractive({ useHandCursor: true });
    btn.on('pointerdown', async () => {
      const room = await joinTable('poker-table', 10000);
      this.scene.start('table', { roomId: room.id });
    });
  }
}
