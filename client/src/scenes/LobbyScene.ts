import Phaser from 'phaser';
import { joinTable } from '../net.js';

export class LobbyScene extends Phaser.Scene {
  constructor() { super('lobby'); }
  create() {
    const balance = Number(localStorage.getItem('chips') ?? 10000);
    this.add.text(40, 30, `Poker lobby — balance ${balance}`, { fontSize: '24px' });
    this.add.text(40, 70, 'Tables: #1 (6-max, 100/200)', { fontSize: '18px' });
    const btn = this.add.text(40, 120, '[ Join table ]', { fontSize: '22px', backgroundColor: '#2d6a4f' })
      .setInteractive({ useHandCursor: true });
    btn.on('pointerdown', async () => {
      const room = await joinTable('poker-table', 10000);
      this.scene.start('table', { roomId: room.id });
    });
  }
}
