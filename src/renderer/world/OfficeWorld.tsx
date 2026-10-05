import { useEffect, useRef } from 'react';
import Phaser from 'phaser';
import type { Agent, AgentId, AgentStatus, WorkspaceSnapshot } from '../../shared/types';
import './office-world.css';

interface OfficeWorldProps {
  snapshot: WorkspaceSnapshot;
  selectedAgentId: AgentId | null;
  onSelectAgent: (id: AgentId) => void;
}

type Point = { x: number; y: number };
type Facing = 'down' | 'up' | 'left' | 'right';
type Avatar = {
  agent: Agent;
  sprite: Phaser.GameObjects.Sprite;
  shadow: Phaser.GameObjects.Ellipse;
  ring: Phaser.GameObjects.Ellipse;
  dot: Phaser.GameObjects.Arc;
  caption: Phaser.GameObjects.Text;
  route: Point[];
  destination: 'lounge' | 'station';
  facing: Facing;
};

const WORLD_WIDTH = 960;
const WORLD_HEIGHT = 640;
const STATIONS: Record<AgentId, Point> = {
  manager: { x: 288, y: 268 },
  frontend: { x: 266, y: 480 },
  backend: { x: 482, y: 480 },
  qa: { x: 698, y: 480 },
};
const LOUNGE: Record<AgentId, Point> = {
  manager: { x: 625, y: 244 },
  frontend: { x: 685, y: 244 },
  backend: { x: 745, y: 244 },
  qa: { x: 805, y: 244 },
};
const STATUS_COLORS: Record<AgentStatus, number> = {
  idle: 0x96a78b,
  planning: 0xe4b264,
  working: 0x84be9e,
  waiting: 0xb6b2a8,
  review: 0xb0a3ce,
};
const PALETTES: Record<AgentId, { shirt: string; dark: string; hair: string; skin: string }> = {
  manager: { shirt: '#a8cf8f', dark: '#768e67', hair: '#524838', skin: '#e7bba0' },
  frontend: { shirt: '#8ebce8', dark: '#6689ad', hair: '#5c403b', skin: '#ecc2a5' },
  backend: { shirt: '#e0b878', dark: '#a48250', hair: '#342f35', skin: '#bd896f' },
  qa: { shirt: '#ceafe8', dark: '#9580aa', hair: '#94705d', skin: '#e5b694' },
};

/** Every visible asset is drawn here, on an integer pixel grid. No borrowed art. */
class OfficeScene extends Phaser.Scene {
  private avatars = new Map<AgentId, Avatar>();
  private previousSnapshot: WorkspaceSnapshot | null = null;
  private drag: { x: number; y: number; scrollX: number; scrollY: number } | null = null;
  private hovered: AgentId | null = null;
  private roomGraphics!: Phaser.GameObjects.Graphics;

  constructor(
    private readonly getSnapshot: () => WorkspaceSnapshot,
    private readonly getSelection: () => AgentId | null,
    private readonly selectAgent: (id: AgentId) => void,
  ) {
    super('office');
  }

  create() {
    this.cameras.main.setBackgroundColor('#ede8dc');
    this.drawOffice();
    for (const agent of this.getSnapshot().agents) this.addAvatar(agent);
    this.applySnapshot(this.getSnapshot());

    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer, objects: Phaser.GameObjects.GameObject[]) => {
      if (objects.length || !pointer.leftButtonDown()) return;
      this.drag = { x: pointer.x, y: pointer.y, scrollX: this.cameras.main.scrollX, scrollY: this.cameras.main.scrollY };
      this.game.canvas.style.cursor = 'grabbing';
    });
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (!this.drag || !pointer.isDown) return;
      const camera = this.cameras.main;
      camera.scrollX = this.drag.scrollX + (this.drag.x - pointer.x) / camera.zoom;
      camera.scrollY = this.drag.scrollY + (this.drag.y - pointer.y) / camera.zoom;
      camera.scrollX = Phaser.Math.Clamp(camera.scrollX, -140, 140);
      camera.scrollY = Phaser.Math.Clamp(camera.scrollY, -100, 100);
    });
    this.input.on('pointerup', () => {
      this.drag = null;
      this.game.canvas.style.cursor = this.hovered ? 'pointer' : 'grab';
    });
    this.input.on('gameout', () => {
      this.drag = null;
      this.game.canvas.style.cursor = 'grab';
    });
    this.game.canvas.style.cursor = 'grab';
  }

  zoomBy(amount: number) {
    if (!this.sys.isActive()) return;
    this.cameras.main.setZoom(Phaser.Math.Clamp(this.cameras.main.zoom + amount, 0.85, 1.65));
  }

  resetView() {
    if (!this.sys.isActive()) return;
    this.cameras.main.setZoom(1).setScroll(0, 0);
  }

  private rect(x: number, y: number, w: number, h: number, color: number, alpha = 1) {
    this.roomGraphics.fillStyle(color, alpha).fillRect(x, y, w, h);
  }

  private label(x: number, y: number, text: string, color = '#7f7766', size = 11, spacing = 2) {
    return this.add.text(x, y, text, {
      fontFamily: '"Courier New", monospace', fontSize: `${size}px`, fontStyle: 'bold', color,
    }).setLetterSpacing(spacing).setDepth(10);
  }

  private rug(x: number, y: number, width: number, height: number, color: number, border: number) {
    this.rect(x, y, width, height, border);
    this.rect(x + 4, y + 4, width - 8, height - 8, color);
    for (let px = x + 9; px < x + width - 9; px += 12) {
      this.rect(px, y + 8, 2, height - 16, border, 0.22);
    }
    for (let px = x + 4; px < x + width - 3; px += 8) {
      this.rect(px, y - 3, 2, 3, border);
      this.rect(px, y + height, 2, 3, border);
    }
  }

  private plant(x: number, y: number, tall = false) {
    const g = this.add.graphics().setDepth(y + 12);
    g.fillStyle(0x867554, 0.13).fillEllipse(x + 1, y + 10, 40, 12);
    g.fillStyle(0x89684f).fillRect(x - 10, y - 5, 20, 14);
    g.fillStyle(0xc68d65).fillRect(x - 12, y - 8, 24, 5).fillRect(x - 8, y + 1, 16, 9);
    g.fillStyle(0xdbad81).fillRect(x - 9, y - 5, 4, 11);
    g.fillStyle(0x71846a).fillRect(x - 2, y - (tall ? 45 : 30), 4, tall ? 38 : 23);
    const leaves = tall
      ? [[-18, -40, 18, 10], [2, -49, 16, 12], [-10, -59, 13, 14], [0, -29, 20, 10], [-21, -22, 19, 9]]
      : [[-20, -27, 17, 11], [1, -35, 16, 12], [-7, -44, 13, 14], [-3, -23, 22, 10]];
    for (let index = 0; index < leaves.length; index++) {
      const [lx, ly, lw, lh] = leaves[index];
      g.fillStyle(index % 2 ? 0x7e9a73 : 0x5c7d62).fillRect(x + lx, y + ly, lw, lh);
      g.fillStyle(0xa1b78c).fillRect(x + lx + 2, y + ly + 2, lw - 5, 3);
    }
  }

  private shelf(x: number, y: number, width: number, height: number) {
    this.rect(x + 4, y + height - 4, width, 10, 0x8d795f, 0.18);
    this.rect(x, y, width, height, 0x8c7053);
    this.rect(x + 5, y + 5, width - 10, height - 10, 0x5f5949);
    for (let row = 0; row < 3; row++) {
      const sy = y + 9 + row * (height / 3);
      const books = [0xc98b76, 0x9caf95, 0xbcb58d, 0x859dab, 0xd3bd97, 0xa090ac];
      for (let book = 0; book < Math.floor((width - 16) / 9); book++) {
        const bx = x + 8 + book * 9;
        const bh = 20 + ((book + row) % 3) * 3;
        this.rect(bx, sy + 28 - bh, 7, bh, books[(book + row * 2) % books.length]);
        this.rect(bx + 1, sy + 25, 5, 1, 0xe3d8bb);
      }
      this.rect(x + 4, sy + 30, width - 8, 5, 0xb49772);
    }
    this.rect(x, y, 4, height, 0xbca07c);
  }

  private desk(x: number, y: number, color: number, role: string, kind: 'code' | 'test' | 'plan') {
    const g = this.add.graphics().setDepth(y + 31);
    // A low footprint shadow, rear legs, wooden worktop, and front edge.
    g.fillStyle(0x8f7b5b, 0.16).fillRect(x - 57, y + 40, 125, 14);
    g.fillStyle(0x88775c).fillRect(x - 48, y + 30, 7, 28).fillRect(x + 45, y + 30, 7, 28);
    g.fillStyle(0xb8976e).fillRect(x - 58, y - 1, 118, 44);
    g.fillStyle(0xddc39a).fillRect(x - 60, y - 5, 120, 41);
    g.fillStyle(0xe9d3ad).fillRect(x - 58, y - 5, 116, 4);
    g.fillStyle(0xc1a078).fillRect(x - 60, y + 35, 120, 7);
    g.fillStyle(0xae8e68).fillRect(x - 54, y + 37, 23, 2);
    // Monitor and its pixel display.
    g.fillStyle(0x887d65).fillRect(x - 3, y + 7, 7, 12).fillRect(x - 13, y + 17, 28, 4);
    g.fillStyle(0x485c57).fillRect(x - 25, y - 31, 50, 36);
    g.fillStyle(0x71877d).fillRect(x - 25, y - 31, 50, 3);
    g.fillStyle(0xd0e1cd).fillRect(x - 21, y - 26, 42, 26);
    g.fillStyle(0x9abbab).fillRect(x - 21, y - 26, 42, 5);
    if (kind === 'code') {
      const widths = [21, 13, 28, 18];
      for (let row = 0; row < 4; row++) {
        g.fillStyle(row % 2 ? 0x789895 : 0x709675).fillRect(x - 15 + (row % 2) * 4, y - 17 + row * 4, widths[row], 2);
      }
    } else if (kind === 'test') {
      g.fillStyle(0x7e9c73).fillRect(x - 13, y - 18, 5, 4).fillRect(x - 13, y - 11, 5, 4);
      g.fillStyle(0x9bb193).fillRect(x - 4, y - 18, 18, 2).fillRect(x - 4, y - 11, 15, 2);
    } else {
      g.fillStyle(0x8da29b).fillRect(x - 14, y - 18, 8, 12).fillRect(x - 3, y - 12, 8, 6);
      g.fillStyle(0xc4ae81).fillRect(x + 8, y - 22, 7, 16);
    }
    // Keyboard, mug, notebook, lamp.
    g.fillStyle(0x9a9b84).fillRect(x - 18, y + 25, 38, 8);
    g.fillStyle(0xd6d3bb).fillRect(x - 17, y + 25, 36, 6);
    for (let col = 0; col < 7; col++) g.fillStyle(0xafb09c).fillRect(x - 14 + col * 5, y + 27, 2, 2);
    g.fillStyle(color).fillRect(x + 37, y + 12, 10, 11).fillRect(x + 47, y + 14, 4, 6);
    g.fillStyle(0xf2e8cf).fillRect(x + 38, y + 10, 8, 3);
    g.fillStyle(0x908973).fillRect(x - 46, y + 17, 16, 15);
    g.fillStyle(0xeddfb7).fillRect(x - 46, y + 15, 15, 14);
    g.fillStyle(color).fillRect(x - 45, y + 15, 3, 14);
    g.fillStyle(0x7d8570).fillRect(x - 49, y - 17, 3, 24).fillRect(x - 54, y + 6, 14, 3);
    g.fillStyle(0xc4bc94).fillRect(x - 56, y - 20, 19, 8);
    g.fillStyle(0xf1db9d).fillRect(x - 54, y - 12, 15, 2);
    // Matching chair sits in the foreground.
    const chair = this.add.graphics().setDepth(y + 51);
    chair.fillStyle(0x92856b).fillRect(x - 2, y + 69, 4, 8).fillRect(x - 14, y + 75, 29, 3);
    chair.fillStyle(0x6d766a).fillRect(x - 16, y + 48, 32, 22);
    chair.fillStyle(color).fillRect(x - 14, y + 48, 28, 18);
    chair.fillStyle(0xffffff, 0.17).fillRect(x - 12, y + 49, 24, 3);
    chair.fillStyle(0x626d61).fillRect(x - 18, y + 56, 4, 11).fillRect(x + 14, y + 56, 4, 11);
    this.label(x, y + 100, role, '#8b826f', 10, 1).setOrigin(0.5, 0);
  }

  private drawOffice() {
    this.roomGraphics = this.add.graphics().setDepth(0);
    // Discrete extruded shadow gives the room a tabletop, diorama-like edge.
    this.rect(73, 128, 828, 475, 0xd8d0be);
    this.rect(80, 129, 810, 467, 0xbaa991);
    this.rect(84, 129, 796, 458, 0xd6bea0);
    // Wood floorboards: deterministic texture, no random changes between sessions.
    for (let row = 0; row < 15; row++) {
      for (let col = 0; col < 13; col++) {
        const x = 86 + col * 62;
        const y = 130 + row * 30;
        const palette = [0xdfc9a8, 0xdcc5a4, 0xe2cdad, 0xd9c2a1];
        this.rect(x, y, Math.min(61, 794 - col * 62), 29, palette[(row * 3 + col) % palette.length]);
        const grainX = x + 6 + (row * 7 + col * 11) % 20;
        this.rect(grainX, y + 9, 19, 1, 0xbba582, 0.26);
        this.rect(grainX + 8, y + 19, 22, 1, 0xeedbbb, 0.38);
      }
    }
    // Back and side walls.
    this.rect(76, 73, 814, 65, 0xb8ad91);
    this.rect(84, 77, 796, 51, 0xf2eedb);
    this.rect(84, 121, 796, 9, 0xd3cbb2);
    this.rect(84, 129, 796, 4, 0xbaa98b);
    this.rect(76, 76, 8, 507, 0xc3b598);
    this.rect(84, 133, 5, 450, 0xefe4c9);
    this.rect(880, 76, 10, 510, 0xb9ac90);
    this.rect(876, 133, 4, 451, 0xefdfbd);
    this.rect(84, 584, 796, 5, 0xad9779);
    this.rect(84, 581, 796, 3, 0xf1dcb7);
    // Framed original mini-landscape over the manager studio.
    this.rect(251, 87, 72, 31, 0xb49772);
    this.rect(255, 90, 64, 24, 0xa9bec0);
    this.rect(255, 103, 64, 11, 0x9cac86);
    this.rect(264, 99, 22, 8, 0x6e8a73);
    this.rect(282, 104, 31, 10, 0x84916b);
    this.rect(300, 93, 7, 7, 0xf0dba1);
    // A sunny, four-pane window and softly stepped light falling onto the floor.
    this.rect(613, 80, 171, 47, 0xb9aa8d);
    this.rect(617, 83, 163, 39, 0xbad7d4);
    this.rect(620, 86, 156, 15, 0xcbe1dd);
    this.rect(629, 92, 37, 5, 0xe9eee0);
    this.rect(647, 88, 17, 8, 0xe9eee0);
    this.rect(724, 97, 28, 5, 0xe9eee0);
    this.rect(620, 112, 156, 10, 0xa4b9a0);
    this.rect(646, 108, 22, 14, 0x879f88);
    this.rect(748, 107, 28, 15, 0x879f88);
    this.rect(696, 83, 5, 39, 0xf4edd8);
    this.rect(617, 102, 163, 4, 0xf4edd8);
    this.rect(609, 124, 179, 5, 0xe4d6b8);
    this.roomGraphics.fillStyle(0xfff0b8, 0.18).fillPoints([
      { x: 618, y: 133 }, { x: 781, y: 133 }, { x: 646, y: 310 }, { x: 477, y: 310 },
    ], true);
    this.rug(217, 185, 144, 109, 0xd3b994, 0xb69e7e);
    this.rug(579, 168, 251, 93, 0xb6c0a1, 0x96a887);
    this.rug(354, 540, 346, 24, 0xc3b096, 0xb0a185);
    // Half-height division leaves a wide, visibly open doorway.
    for (const [x, width] of [[89, 341], [520, 355]]) {
      this.rect(x, 315, width, 22, 0xc5b395);
      this.rect(x, 311, width, 13, 0xefead7);
      this.rect(x, 311, width, 3, 0xf9f4e5);
      this.rect(x, 334, width, 3, 0xa8967a);
      this.rect(x, 338, width, 6, 0xa99575, 0.11);
    }
    this.rect(430, 315, 5, 22, 0xb09c7c);
    this.rect(515, 315, 5, 22, 0xb09c7c);
    this.rect(441, 333, 66, 3, 0xcfbb96);
    this.label(116, 151, 'THE STUDIO', '#8d816c', 11, 3);
    this.label(583, 151, 'COMMON ROOM', '#7c866b', 11, 3);
    this.label(115, 359, 'ENGINEERING', '#8d816c', 11, 3);
    this.label(746, 359, '3 STATIONS', '#a0927b', 9, 1);
    this.shelf(113, 181, 68, 110);
    this.plant(395, 265, true);
    this.plant(835, 159, true);
    this.plant(123, 560, true);
    this.plant(830, 557, true);
    this.desk(288, 192, 0xa8cf8f, 'M · COORDINATION', 'plan');
    // Deep moss sofa, cushion seams, and a ochre throw pillow.
    this.rect(596, 207, 231, 23, 0x627460);
    this.rect(591, 181, 241, 37, 0x75906f);
    this.rect(596, 185, 231, 18, 0x879c7b);
    this.rect(597, 203, 228, 20, 0x91a684);
    this.rect(591, 197, 9, 29, 0x6e8868);
    this.rect(823, 197, 9, 29, 0x6e8868);
    for (let x = 652; x < 820; x += 58) this.rect(x, 204, 2, 17, 0x6d8866);
    this.rect(602, 187, 18, 15, 0xd5b176);
    this.rect(607, 189, 3, 11, 0xe4c58c);
    this.rect(803, 188, 16, 14, 0xc3cba8);
    this.rect(600, 227, 7, 7, 0x716652);
    this.rect(815, 227, 7, 7, 0x716652);
    // Low meeting/coffee table stays clear of the route along the sofa front.
    this.rect(699, 297, 125, 6, 0x8b7558, 0.15);
    this.rect(705, 280, 7, 20, 0x9d825f);
    this.rect(808, 280, 7, 20, 0x9d825f);
    this.rect(697, 266, 129, 24, 0xb79a73);
    this.rect(696, 264, 129, 20, 0xe0c6a0);
    this.rect(696, 264, 129, 3, 0xead7b5);
    this.rect(747, 269, 28, 13, 0xf0e8cf);
    this.rect(747, 269, 13, 2, 0xaab796);
    this.rect(780, 269, 10, 10, 0xb89170);
    this.rect(780, 267, 10, 3, 0xf2e7cb);
    // Coffee counter, brewing machine, and cups.
    this.rect(545, 184, 33, 62, 0xb59873);
    this.rect(542, 178, 39, 17, 0xe4cfaa);
    this.rect(549, 158, 24, 26, 0x697467);
    this.rect(552, 161, 18, 8, 0x9ba58c);
    this.rect(556, 173, 10, 11, 0xcabda2);
    this.rect(550, 210, 23, 2, 0xa48a68);
    this.rect(555, 206, 5, 3, 0x776d5a);
    this.rect(556, 232, 5, 3, 0x776d5a);
    this.desk(266, 404, 0x8ebce8, '01 · FRONTEND', 'code');
    this.desk(482, 404, 0xe0b878, '02 · BACKEND', 'code');
    this.desk(698, 404, 0xceafe8, '03 · QUALITY', 'test');
    // Rack, tiny lights, and a pin board for a lived-in workshop feel.
    this.rect(112, 435, 47, 78, 0x687366);
    this.rect(116, 440, 39, 68, 0x46584e);
    for (let row = 0; row < 4; row++) {
      this.rect(119, 444 + row * 15, 33, 11, 0x87917b);
      this.rect(124, 447 + row * 15, 18, 2, 0x626e60);
      this.rect(145, 447 + row * 15, 3, 3, row === 2 ? 0xdab77c : 0xb6cea0);
    }
    this.rect(794, 397, 45, 70, 0xbaa481);
    this.rect(798, 401, 37, 62, 0xd8c4a0);
    this.rect(801, 407, 13, 13, 0xe6dcad);
    this.rect(820, 408, 12, 18, 0xb4c0a2);
    this.rect(805, 432, 17, 15, 0xc8a5a0);
    this.rect(806, 410, 3, 2, 0x987b61);
    this.rect(824, 410, 3, 2, 0x987b61);
    this.rect(811, 434, 3, 2, 0x987b61);
    this.label(480, 603, 'A LITTLE SPACE FOR BIG IDEAS', '#a4967e', 9, 2).setOrigin(0.5, 0);
  }

  private makeTextures(id: AgentId) {
    const palette = PALETTES[id];
    for (const facing of ['down', 'up', 'left', 'right'] as Facing[]) {
      for (let frame = 0; frame < 4; frame++) {
        const texture = this.textures.createCanvas(`${id}-${facing}-${frame}`, 24, 32);
        if (!texture) continue;
        const ctx = texture.context;
        const pixel = (x: number, y: number, w: number, h: number, color: string) => {
          ctx.fillStyle = color;
          ctx.fillRect(x, y, w, h);
        };
        const stride = frame === 1 ? 1 : frame === 3 ? -1 : 0;
        const bob = frame % 2;
        const faceOffset = facing === 'left' ? -2 : facing === 'right' ? 2 : 0;
        pixel(7, 25, 4, 5 + Math.max(0, stride), '#657067');
        pixel(13, 25, 4, 5 + Math.max(0, -stride), '#657067');
        pixel(6, 29 + Math.max(0, stride), 6, 2, '#4e534b');
        pixel(13, 29 + Math.max(0, -stride), 6, 2, '#4e534b');
        pixel(6, 15 - bob, 12, 13, palette.dark);
        pixel(7, 15 - bob, 10, 11, palette.shirt);
        pixel(4, 17 - bob + stride, 3, 8, palette.shirt);
        pixel(17, 17 - bob - stride, 3, 8, palette.dark);
        pixel(4, 24 - bob + stride, 3, 3, palette.skin);
        pixel(17, 24 - bob - stride, 3, 3, palette.skin);
        pixel(10, 12 - bob, 4, 5, palette.skin);
        pixel(6 + faceOffset, 4 - bob, 12, 11, palette.skin);
        pixel(5 + faceOffset, 2 - bob, 14, 7, palette.hair);
        pixel(6 + faceOffset, 0 + (bob ? 0 : 1), 12, 5, palette.hair);
        if (facing === 'up') {
          pixel(6, 6 - bob, 12, 8, palette.hair);
          pixel(8, 14 - bob, 8, 3, palette.dark);
          pixel(10, 18 - bob, 4, 5, palette.shirt);
        } else if (facing === 'left' || facing === 'right') {
          pixel(facing === 'left' ? 3 : 17, 10 - bob, 3, 3, palette.skin);
          pixel(facing === 'left' ? 5 : 17, 8 - bob, 2, 2, '#3c443d');
          pixel(facing === 'left' ? 12 : 5, 6 - bob, 6, 8, palette.hair);
        } else {
          pixel(8, 9 - bob, 2, 2, '#3c443d');
          pixel(14, 9 - bob, 2, 2, '#3c443d');
          pixel(11, 13 - bob, 3, 1, '#b47f69');
          if (id === 'manager') {
            pixel(10, 17 - bob, 4, 2, '#e9ddbb');
            pixel(11, 19 - bob, 2, 5, '#80694a');
          }
          if (id === 'qa') {
            pixel(7, 8 - bob, 4, 4, '#686453');
            pixel(13, 8 - bob, 4, 4, '#686453');
            pixel(8, 9 - bob, 2, 2, '#d1d6bf');
            pixel(14, 9 - bob, 2, 2, '#d1d6bf');
            pixel(11, 9 - bob, 2, 1, '#686453');
          }
        }
        if (id === 'frontend') {
          pixel(4 + faceOffset, 5 - bob, 2, 8, '#535d55');
          pixel(18 + faceOffset, 5 - bob, 2, 8, '#535d55');
          pixel(6 + faceOffset, 1 - bob, 12, 2, '#535d55');
        }
        texture.refresh();
        texture.setFilter(Phaser.Textures.FilterMode.NEAREST);
      }
    }
  }

  private addAvatar(agent: Agent) {
    this.makeTextures(agent.id);
    const start = LOUNGE[agent.id];
    const ring = this.add.ellipse(start.x, start.y - 3, 47, 15, 0xefe5bf, 0.65)
      .setStrokeStyle(2, 0x7d9b7c).setVisible(false);
    const shadow = this.add.ellipse(start.x, start.y - 3, 32, 10, 0x5d6650, 0.16);
    const sprite = this.add.sprite(start.x, start.y, `${agent.id}-down-0`)
      .setOrigin(0.5, 1).setScale(1.5)
      .setInteractive({ useHandCursor: true });
    const dot = this.add.circle(start.x + 19, start.y - 42, 4, STATUS_COLORS[agent.status])
      .setStrokeStyle(2, 0xf5f0df);
    const caption = this.add.text(start.x, start.y - 65, '', {
      fontFamily: '"Courier New", monospace', fontSize: '10px', fontStyle: 'bold',
      color: '#f7f1df', backgroundColor: '#606c59', padding: { x: 6, y: 4 },
    }).setOrigin(0.5, 1).setVisible(false);
    const avatar: Avatar = { agent, sprite, shadow, ring, dot, caption, route: [], destination: 'lounge', facing: 'down' };
    this.avatars.set(agent.id, avatar);
    sprite.on('pointerdown', () => this.selectAgent(agent.id));
    sprite.on('pointerover', () => {
      this.hovered = agent.id;
      this.game.canvas.style.cursor = 'pointer';
    });
    sprite.on('pointerout', () => {
      this.hovered = null;
      if (!this.drag) this.game.canvas.style.cursor = 'grab';
    });
  }

  private routeBetween(id: AgentId, from: 'lounge' | 'station', to: 'lounge' | 'station'): Point[] {
    // Both rooms meet at the doorway; the lower aisle runs between desks.
    // Routes are reversible and deliberately avoid every furniture footprint.
    const stationToDoor = id === 'manager'
      ? [{ x: 288, y: 289 }, { x: 477, y: 289 }]
      : [{ x: STATIONS[id].x, y: 504 }, { x: 379, y: 504 }, { x: 379, y: 353 }, { x: 477, y: 353 }, { x: 477, y: 289 }];
    const doorToLounge = [{ x: 610, y: 289 }, { x: 610, y: 244 }, LOUNGE[id]];
    if (from === 'station' && to === 'lounge') return [...stationToDoor, ...doorToLounge];
    const loungeToDoor = [{ x: 610, y: 244 }, { x: 610, y: 289 }, { x: 477, y: 289 }];
    const doorToStation = id === 'manager'
      ? [{ x: 288, y: 289 }, STATIONS[id]]
      : [{ x: 477, y: 353 }, { x: 379, y: 353 }, { x: 379, y: 504 }, { x: STATIONS[id].x, y: 504 }, STATIONS[id]];
    return [...loungeToDoor, ...doorToStation];
  }

  private applySnapshot(snapshot: WorkspaceSnapshot) {
    this.previousSnapshot = snapshot;
    for (const agent of snapshot.agents) {
      if (!this.avatars.has(agent.id)) this.addAvatar(agent);
      const avatar = this.avatars.get(agent.id)!;
      avatar.agent = agent;
      const destination = agent.status === 'idle' ? 'lounge' : 'station';
      if (destination !== avatar.destination) {
        if (avatar.route.length) {
          // Finish the remaining safe aisle route, then walk to the new
          // destination. This also handles rapid task cancellation/reassignment
          // without teleporting or cutting through furniture.
          avatar.route = [...avatar.route, ...this.routeBetween(agent.id, avatar.destination, destination)];
        } else {
          avatar.route = this.routeBetween(agent.id, avatar.destination, destination);
        }
        avatar.destination = destination;
      }
    }
  }

  update(time: number, delta: number) {
    const snapshot = this.getSnapshot();
    if (snapshot !== this.previousSnapshot) this.applySnapshot(snapshot);
    const selected = this.getSelection();
    for (const [id, avatar] of this.avatars) {
      const { sprite } = avatar;
      let walking = false;
      if (!snapshot.paused && avatar.route.length) {
        let distance = (Math.min(delta, 60) / 1000) * 210;
        while (distance > 0 && avatar.route.length) {
          const target = avatar.route[0];
          const dx = target.x - sprite.x;
          const dy = target.y - sprite.y;
          const length = Math.hypot(dx, dy);
          if (length < 0.1) { avatar.route.shift(); continue; }
          avatar.facing = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : (dy < 0 ? 'up' : 'down');
          const step = Math.min(distance, length);
          sprite.x += dx / length * step;
          sprite.y += dy / length * step;
          distance -= step;
          walking = true;
          if (step === length) avatar.route.shift();
        }
      }
      if (!avatar.route.length) avatar.facing = avatar.destination === 'station' ? 'up' : 'down';
      const atWork = avatar.destination === 'station' && !avatar.route.length;
      const frame = snapshot.paused ? 0 : walking ? Math.floor(time / 140) % 4 : atWork ? Math.floor(time / 380) % 2 : 0;
      sprite.setTexture(`${id}-${avatar.facing}-${frame}`);
      // Subpixel positions remain internal; sprite drawing snaps to the grid.
      sprite.setDepth(sprite.y + 2);
      avatar.shadow.setPosition(sprite.x, sprite.y - 3).setDepth(sprite.y - 1);
      avatar.ring.setPosition(sprite.x, sprite.y - 3).setDepth(sprite.y - 2).setVisible(selected === id || this.hovered === id);
      avatar.dot.setPosition(sprite.x + 17, sprite.y - 42).setDepth(sprite.y + 3).setFillStyle(STATUS_COLORS[avatar.agent.status]);
      let status: string = avatar.agent.status;
      if (id === 'qa' && status === 'working') status = 'testing';
      avatar.caption.setText(`${avatar.agent.name.split(' ')[0]} · ${status}`)
        .setPosition(sprite.x, sprite.y - 56).setDepth(900)
        .setVisible(selected === id || this.hovered === id);
    }
  }
}

export function OfficeWorld({ snapshot, selectedAgentId, onSelectAgent }: OfficeWorldProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<OfficeScene | null>(null);
  const snapshotRef = useRef(snapshot);
  const selectionRef = useRef(selectedAgentId);
  const callbackRef = useRef(onSelectAgent);
  snapshotRef.current = snapshot;
  selectionRef.current = selectedAgentId;
  callbackRef.current = onSelectAgent;

  useEffect(() => {
    const parent = hostRef.current;
    if (!parent) return;
    const scene = new OfficeScene(
      () => snapshotRef.current,
      () => selectionRef.current,
      (id) => callbackRef.current(id),
    );
    sceneRef.current = scene;
    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent,
      width: WORLD_WIDTH,
      height: WORLD_HEIGHT,
      backgroundColor: '#ede8dc',
      pixelArt: true,
      roundPixels: true,
      antialias: false,
      render: { antialias: false, pixelArt: true, roundPixels: true },
      scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
      scene: [scene],
      audio: { noAudio: true },
      banner: false,
    });
    const observer = new ResizeObserver(() => game.scale.refresh());
    observer.observe(parent);
    return () => {
      observer.disconnect();
      sceneRef.current = null;
      game.destroy(true);
    };
  }, []);

  return (
    <div className="office-world" aria-label="Interactive pixel office. Select a worker to inspect their activity.">
      <div className="office-world__canvas" ref={hostRef} />
      <div className="office-world__hint"><span />{snapshot.paused ? 'Office paused' : 'Click a worker to check in'}<span className="office-world__hint-extra"> · drag to explore</span></div>
      <div className="office-world__controls" aria-label="Office view controls">
        <button type="button" onClick={() => sceneRef.current?.zoomBy(-0.15)} aria-label="Zoom out" title="Zoom out">−</button>
        <button className="office-world__reset" type="button" onClick={() => sceneRef.current?.resetView()} aria-label="Fit whole office" title="Fit whole office">Fit</button>
        <button type="button" onClick={() => sceneRef.current?.zoomBy(0.15)} aria-label="Zoom in" title="Zoom in">+</button>
      </div>
    </div>
  );
}
