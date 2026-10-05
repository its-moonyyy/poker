import Phaser from 'phaser';
import { LobbyScene } from './scenes/LobbyScene.js';
import { TableScene } from './scenes/TableScene.js';

new Phaser.Game({
  type: Phaser.AUTO,
  width: 1280,
  height: 720,
  parent: 'game',
  backgroundColor: '#081c15',
  scene: [LobbyScene, TableScene],
});
