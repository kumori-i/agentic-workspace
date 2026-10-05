import Phaser from 'phaser';
import type { Agent } from '../../shared/types';

type Facing = 'down' | 'up' | 'left' | 'right';
type Paint = (x: number, y: number, width: number, height: number, color: string) => void;

interface CharacterPalette {
  cloth: string;
  clothLight: string;
  clothDeep: string;
  clothShadow: string;
  hair: string;
  hairLight: string;
  hairMid: string;
  hairShadow: string;
  skin: string;
  skinLight: string;
  skinShade: string;
  skinDeep: string;
  outline: string;
  trousers: string;
  trouserLight: string;
  boots: string;
  bootLight: string;
}

const DETAILS = {
  manager: { hair: '#634238', skin: '#e6b39a', trousers: '#595e50' },
  frontend: { hair: '#814b35', skin: '#e6b496', trousers: '#465668' },
  backend: { hair: '#393438', skin: '#b78060', trousers: '#4b626b' },
  qa: { hair: '#c69058', skin: '#dfae85', trousers: '#65596a' },
} as const;

function tint(hex: string, toward: string, amount: number): string {
  const a = Number.parseInt(hex.slice(1), 16);
  const b = Number.parseInt(toward.slice(1), 16);
  return `#${[16, 8, 0].map((shift) => {
    const channel = Math.round(((a >> shift) & 255) * (1 - amount) + ((b >> shift) & 255) * amount);
    return channel.toString(16).padStart(2, '0');
  }).join('')}`;
}

function palette(agent: Agent): CharacterPalette {
  const detail = DETAILS[agent.id];
  const cloth = /^#[0-9a-f]{6}$/i.test(agent.color) ? agent.color : '#91ad8b';
  return {
    cloth,
    clothLight: tint(cloth, '#fff1d7', 0.30),
    clothDeep: tint(cloth, '#283c40', 0.30),
    clothShadow: tint(cloth, '#2a303a', 0.53),
    hair: detail.hair,
    hairLight: tint(detail.hair, '#edc98d', 0.28),
    hairMid: tint(detail.hair, '#edc98d', 0.12),
    hairShadow: tint(detail.hair, '#261f2a', 0.34),
    skin: detail.skin,
    skinLight: tint(detail.skin, '#fff1cd', 0.22),
    skinShade: tint(detail.skin, '#97564e', 0.25),
    skinDeep: tint(detail.skin, '#69473f', 0.42),
    outline: '#34313b',
    trousers: detail.trousers,
    trouserLight: tint(detail.trousers, '#d3cfb0', 0.18),
    boots: '#443a3a',
    bootLight: '#807263',
  };
}

function bootsAndLegs(p: Paint, c: CharacterPalette, frame: number, back: boolean) {
  const stride = [0, -2, 0, 2][frame];
  const leftY = 35 + Math.max(0, stride);
  const rightY = 35 + Math.max(0, -stride);
  p(10, 33, 6, 11 + Math.max(0, stride), c.outline);
  p(17, 33, 6, 11 + Math.max(0, -stride), c.outline);
  p(11, 34, 4, 9 + Math.max(0, stride), c.trousers);
  p(18, 34, 4, 9 + Math.max(0, -stride), c.trousers);
  p(11, leftY, 1, 7, c.trouserLight);
  p(18, rightY, 1, 7, c.trouserLight);
  p(14, 35, 1, 6, '#39414a');
  p(21, 35, 1, 6, '#39414a');
  const bootYLeft = 42 + Math.max(0, stride);
  const bootYRight = 42 + Math.max(0, -stride);
  p(9, bootYLeft, 7, 4, c.outline);
  p(17, bootYRight, 7, 4, c.outline);
  p(10, bootYLeft, 5, 3, c.boots);
  p(18, bootYRight, 5, 3, c.boots);
  p(10, bootYLeft + (back ? 0 : 1), 4, 1, c.bootLight);
  p(18, bootYRight + (back ? 0 : 1), 4, 1, c.bootLight);
  p(10, bootYLeft + 3, 5, 1, '#a59378');
  p(18, bootYRight + 3, 5, 1, '#a59378');
}

function frontBody(p: Paint, c: CharacterPalette, agent: Agent, frame: number, back: boolean) {
  const sway = [0, 1, 0, -1][frame];
  bootsAndLegs(p, c, frame, back);
  // Sleeves are separate from the shoulders so both arms have a readable gait.
  p(7, 22 + sway, 4, 10, c.outline);
  p(22, 22 - sway, 4, 10, c.outline);
  p(8, 22 + sway, 3, 8, c.clothDeep);
  p(23, 22 - sway, 2, 8, c.clothDeep);
  p(8, 23 + sway, 1, 6, c.clothLight);
  p(23, 23 - sway, 1, 6, c.cloth);
  p(8, 30 + sway, 3, 4, c.skinDeep);
  p(23, 30 - sway, 3, 4, c.skinDeep);
  p(8, 30 + sway, 2, 3, c.skin);
  p(23, 30 - sway, 2, 3, c.skin);
  p(8, 30 + sway, 1, 1, c.skinLight);
  p(23, 30 - sway, 1, 1, c.skinLight);
  p(11, 21, 11, 15, c.outline);
  p(10, 23, 13, 10, c.outline);
  p(11, 22, 11, 12, c.cloth);
  p(12, 22, 3, 11, c.clothLight);
  p(20, 23, 2, 11, c.clothDeep);
  p(11, 33, 11, 2, c.clothShadow);
  p(13, 19, 7, 5, c.skinDeep);
  p(14, 20, 5, 3, c.skin);

  if (agent.id === 'manager') {
    // Ivory blouse and open cardigan, with a small brass buckle at the waist.
    if (!back) {
      p(14, 23, 5, 10, '#eee5ce');
      p(14, 23, 1, 4, '#fbefd4');
      p(18, 24, 1, 8, '#ceb99e');
      p(13, 22, 2, 3, c.clothDeep);
      p(18, 22, 2, 3, c.clothDeep);
      p(16, 25, 1, 1, '#ab936b');
      p(16, 28, 1, 1, '#ab936b');
      p(12, 31, 2, 1, c.clothDeep);
      p(20, 31, 2, 1, c.clothShadow);
    } else {
      p(13, 22, 7, 1, c.clothLight);
      p(15, 25, 1, 7, c.clothDeep);
      p(12, 29, 1, 3, c.clothLight);
    }
    p(11, 34, 11, 2, '#58453e');
    p(15, 34, 3, 2, '#bfa271');
    p(16, 34, 1, 1, '#f1d39c');
  } else if (agent.id === 'frontend') {
    if (!back) {
      p(13, 22, 2, 3, c.clothDeep);
      p(18, 22, 2, 3, c.clothDeep);
      p(14, 25, 1, 3, '#e0dbbf');
      p(19, 25, 1, 3, '#e0dbbf');
      p(13, 30, 7, 3, c.clothDeep);
      p(14, 30, 5, 1, c.clothLight);
      p(12, 24, 1, 4, c.clothLight);
    } else {
      p(12, 21, 9, 6, c.clothShadow);
      p(13, 21, 7, 5, c.clothDeep);
      p(14, 22, 5, 2, c.cloth);
      p(14, 26, 5, 1, c.clothLight);
      p(16, 29, 1, 4, c.clothDeep);
    }
    p(11, 33, 11, 2, c.clothDeep);
    p(12, 33, 8, 1, c.clothLight);
  } else if (agent.id === 'backend') {
    // A checked overshirt: subdued weave, pockets, and cream buttons.
    for (const x of [12, 16, 20]) p(x, 24, 1, 9, c.clothDeep);
    for (const y of [25, 29, 32]) p(11, y, 11, 1, c.clothDeep);
    p(12, 25, 1, 1, c.clothShadow);
    p(20, 29, 1, 1, c.clothShadow);
    if (!back) {
      p(15, 23, 3, 11, c.cloth);
      p(13, 22, 2, 3, c.clothShadow);
      p(18, 22, 2, 3, c.clothShadow);
      p(16, 25, 1, 1, '#f3dfb9');
      p(16, 28, 1, 1, '#f3dfb9');
      p(16, 31, 1, 1, '#f3dfb9');
      p(19, 26, 3, 3, c.clothDeep);
      p(19, 26, 3, 1, c.clothLight);
    } else p(12, 23, 8, 1, c.clothLight);
    p(8, 29 + sway, 3, 2, c.clothLight);
    p(23, 29 - sway, 2, 2, c.clothLight);
    p(11, 34, 11, 2, '#4a3936');
  } else {
    // Short sleeve tee under a knitted lab vest, plus a little ID card.
    p(8, 23 + sway, 3, 5, '#e6ddca');
    p(23, 23 - sway, 2, 5, '#cfc2b3');
    p(12, 22, 2, 3, '#f2e7d0');
    p(19, 22, 2, 3, '#f2e7d0');
    p(13, 25, 1, 8, c.clothDeep);
    p(19, 25, 1, 8, c.clothDeep);
    p(12, 29, 8, 1, c.clothLight);
    p(12, 32, 8, 1, c.clothLight);
    if (!back) {
      p(15, 23, 1, 7, '#667874');
      p(18, 23, 1, 7, '#667874');
      p(16, 28, 3, 4, '#e9e3cf');
      p(17, 29, 1, 1, '#77928b');
      p(16, 31, 3, 1, '#b8ac9b');
    } else {
      p(16, 25, 1, 4, c.clothLight);
      p(15, 34, 4, 1, '#ebe2ca');
    }
  }
}

function frontHead(p: Paint, c: CharacterPalette, agent: Agent, back: boolean) {
  // The head has stepped cheek/jaw edges rather than a square fill.
  p(12, 3, 9, 1, c.hairShadow);
  p(10, 4, 13, 2, c.hairShadow);
  p(9, 6, 15, 11, c.hairShadow);
  p(10, 17, 13, 3, c.hairShadow);
  p(12, 20, 9, 1, c.outline);
  p(10, 6, 13, 10, c.hair);
  p(11, 4, 11, 4, c.hair);
  p(12, 4, 6, 1, c.hairLight);
  p(10, 7, 2, 5, c.hairMid);
  p(20, 6, 3, 8, c.hairShadow);

  if (agent.id === 'manager') {
    // A side parted bob and a low twist: recognisable from the rear as well.
    p(8, 9, 2, 8, c.hairShadow);
    p(9, 17, 3, 3, c.hairShadow);
    p(21, 9, 3, 10, c.hairShadow);
    p(21, 10, 2, 7, c.hair);
    p(22, 9, 1, 4, c.hairMid);
    p(10, 7, 3, 7, c.hairMid);
    p(11, 5, 5, 2, c.hairLight);
    if (back) {
      p(12, 7, 1, 8, c.hairMid);
      p(15, 6, 1, 9, c.hairMid);
      p(18, 8, 1, 6, c.hairShadow);
      p(12, 15, 9, 4, c.hairShadow);
      p(13, 15, 7, 3, c.hair);
      p(14, 16, 5, 1, c.hairLight);
      p(15, 18, 4, 1, '#8ca093');
    }
  } else if (agent.id === 'frontend') {
    // Tousled fringe, with a narrow graphite headset and padded cups.
    p(10, 3, 5, 2, c.hairShadow);
    p(12, 2, 3, 2, c.hair);
    p(18, 3, 4, 2, c.hairShadow);
    p(20, 5, 4, 3, c.hairShadow);
    p(11, 5, 3, 1, c.hairLight);
    p(17, 6, 3, 1, c.hairMid);
    p(10, 4, 1, 6, '#424b55');
    p(11, 3, 10, 1, '#424b55');
    p(22, 5, 1, 6, '#424b55');
    p(8, 10, 3, 7, '#30383f');
    p(23, 10, 3, 7, '#30383f');
    p(8, 11, 2, 4, '#617a88');
    p(24, 11, 1, 4, '#617a88');
    if (back) {
      p(12, 8, 1, 5, c.hairLight);
      p(16, 7, 2, 4, c.hairMid);
      p(20, 10, 1, 5, c.hairShadow);
      p(12, 16, 9, 2, c.hairShadow);
      p(14, 18, 5, 2, c.skinShade);
    }
  } else if (agent.id === 'backend') {
    // Compact curls use alternating warm and cool clusters, never a solid cap.
    p(11, 3, 3, 2, c.hairShadow);
    p(16, 2, 3, 2, c.hairShadow);
    p(21, 4, 2, 3, c.hairShadow);
    p(8, 7, 2, 5, c.hairShadow);
    for (const [x, y] of [[11, 5], [15, 4], [19, 5], [10, 8], [16, 7], [21, 8]]) {
      p(x, y, 2, 2, c.hairMid);
      p(x, y, 1, 1, c.hairLight);
    }
    if (back) {
      for (const [x, y] of [[12, 10], [18, 10], [15, 13], [20, 14], [11, 14]]) {
        p(x, y, 2, 2, c.hairMid);
        p(x + 1, y + 2, 1, 1, c.hairShadow);
      }
      p(12, 17, 9, 2, c.hairShadow);
      p(14, 19, 5, 1, c.skinShade);
    }
  } else {
    // Golden cropped bob; the little crown clip and glasses define QA.
    p(8, 9, 2, 9, c.hairShadow);
    p(9, 17, 4, 4, c.hairShadow);
    p(21, 16, 3, 5, c.hairShadow);
    p(9, 10, 2, 9, c.hair);
    p(22, 9, 1, 10, c.hairMid);
    p(12, 5, 6, 1, c.hairLight);
    p(11, 7, 2, 3, c.hairLight);
    p(21, 7, 2, 2, '#e1cab0');
    p(22, 7, 1, 1, '#8d799f');
    if (back) {
      p(12, 8, 1, 10, c.hairLight);
      p(15, 7, 1, 11, c.hairMid);
      p(18, 9, 1, 10, c.hairShadow);
      p(20, 11, 1, 8, c.hairMid);
      p(11, 19, 11, 1, c.hairLight);
    }
  }
  if (back) return;

  p(12, 10, 9, 9, c.skinShade);
  p(12, 10, 8, 7, c.skin);
  p(13, 10, 6, 3, c.skinLight);
  p(13, 18, 7, 2, c.skin);
  p(14, 20, 5, 1, c.skinShade);
  p(11, 12, 1, 4, c.skinShade);
  p(21, 12, 1, 4, c.skinDeep);
  // A stepped fringe and shaded temples vary between the four identities.
  p(12, 8, 8, 3, c.hair);
  p(12, 10, 2, 2, c.hair);
  p(14, 9, 3, 2, c.hairMid);
  p(20, 10, 1, 2, c.hairShadow);
  if (agent.id === 'backend') {
    p(13, 9, 2, 1, c.hairLight);
    p(18, 9, 2, 2, c.hairShadow);
    p(12, 17, 2, 2, c.skinDeep);
    p(19, 17, 2, 2, c.skinDeep);
    p(14, 20, 5, 1, c.hairMid);
  }
  p(13, 12, 2, 1, c.skinDeep);
  p(18, 12, 2, 1, c.skinDeep);
  p(13, 13, 2, 2, '#f5e6ce');
  p(18, 13, 2, 2, '#f5e6ce');
  p(14, 13, 1, 2, c.outline);
  p(18, 13, 1, 2, c.outline);
  p(16, 15, 1, 2, c.skinShade);
  p(15, 16, 1, 1, c.skinLight);
  p(15, 18, 3, 1, c.skinDeep);
  p(16, 18, 1, 1, '#b97061');
  if (agent.id === 'manager') {
    p(11, 16, 1, 1, '#ddc48c');
    p(21, 16, 1, 1, '#ddc48c');
    p(12, 16, 1, 1, '#d29482');
    p(20, 16, 1, 1, '#d29482');
  }
  if (agent.id === 'frontend') {
    p(23, 16, 1, 3, '#30383f');
    p(20, 18, 4, 1, '#30383f');
    p(20, 18, 1, 1, '#a0b3b3');
  }
  if (agent.id === 'qa') {
    // Round frames: one-pixel corners are open, with a shared nose bridge.
    for (const x of [12, 18]) {
      p(x + 1, 12, 3, 1, '#5c505d');
      p(x, 13, 1, 2, '#5c505d');
      p(x + 4, 13, 1, 2, '#5c505d');
      p(x + 1, 15, 3, 1, '#5c505d');
      p(x + 1, 13, 1, 1, '#d5e5e0');
    }
    p(16, 13, 2, 1, '#5c505d');
  }
}

function sideCharacter(p: Paint, c: CharacterPalette, agent: Agent, frame: number) {
  const stride = [0, 3, 0, -3][frame];
  const farX = 13 - stride;
  const nearX = 17 + stride;
  // Back leg/sleeve sit under the torso. This creates a proper side silhouette.
  p(farX, 33, 5, 11, c.outline);
  p(farX + 1, 34, 3, 9, tint(c.trousers, '#302b35', 0.18));
  p(farX, 43, 7, 3, c.outline);
  p(farX + 1, 43, 5, 2, c.boots);
  p(19 - Math.sign(stride), 23, 4, 10, c.clothShadow);
  p(21 - Math.sign(stride), 31, 2, 3, c.skinDeep);
  p(nearX, 33, 5, 11, c.outline);
  p(nearX + 1, 34, 3, 9, c.trousers);
  p(nearX + 1, 35, 1, 6, c.trouserLight);
  p(nearX, 43, 7, 4, c.outline);
  p(nearX + 1, 43, 5, 3, c.boots);
  p(nearX + 3, 44, 3, 1, c.bootLight);
  p(nearX + 1, 46, 5, 1, '#a59378');
  p(12, 22, 10, 14, c.outline);
  p(13, 22, 8, 12, c.cloth);
  p(13, 23, 2, 9, c.clothLight);
  p(20, 23, 1, 11, c.clothDeep);
  p(13, 34, 8, 1, c.clothShadow);
  if (agent.id === 'manager') {
    p(20, 24, 1, 9, '#e7dec6');
    p(13, 34, 8, 2, '#58453e');
    p(20, 34, 1, 1, '#d3b581');
  } else if (agent.id === 'frontend') {
    p(12, 21, 4, 6, c.clothShadow);
    p(13, 21, 3, 4, c.clothDeep);
    p(13, 21, 2, 1, c.clothLight);
    p(20, 29, 1, 3, c.clothDeep);
  } else if (agent.id === 'backend') {
    for (const y of [25, 29, 32]) p(13, y, 8, 1, c.clothDeep);
    p(17, 24, 1, 10, c.clothDeep);
    p(20, 26, 1, 1, '#f3dfb9');
    p(13, 34, 8, 1, '#4a3936');
  } else {
    p(13, 29, 7, 1, c.clothLight);
    p(13, 32, 7, 1, c.clothLight);
    p(20, 24, 1, 6, '#667874');
    p(20, 29, 2, 3, '#e8dfc9');
  }
  const armX = 14 + Math.sign(stride);
  const armY = 23 + (frame === 1 || frame === 3 ? -1 : 0);
  p(armX, armY, 5, 9, c.outline);
  p(armX + 1, armY, 3, 8, c.clothDeep);
  p(armX + 1, armY + 1, 1, 6, c.clothLight);
  if (agent.id === 'qa') p(armX + 1, armY + 1, 3, 4, '#e6ddca');
  if (agent.id === 'backend') p(armX + 1, armY + 6, 3, 2, c.clothLight);
  p(armX + 1, armY + 8, 3, 4, c.skinDeep);
  p(armX + 1, armY + 8, 2, 3, c.skin);
  p(armX + 1, armY + 8, 1, 1, c.skinLight);
  p(16, 18, 5, 5, c.skinDeep);
  p(17, 19, 3, 3, c.skin);
  // Profile anatomy has a small forehead, projecting nose, and stepped chin.
  p(12, 3, 8, 1, c.hairShadow);
  p(10, 4, 12, 3, c.hairShadow);
  p(9, 7, 14, 10, c.hairShadow);
  p(11, 17, 12, 3, c.hairShadow);
  p(11, 5, 10, 11, c.hair);
  p(11, 5, 6, 1, c.hairLight);
  p(10, 8, 2, 6, c.hairMid);
  p(16, 9, 7, 9, c.skinShade);
  p(17, 10, 6, 7, c.skin);
  p(19, 10, 3, 3, c.skinLight);
  p(23, 13, 2, 3, c.skinShade);
  p(23, 13, 1, 2, c.skinLight);
  p(21, 17, 3, 1, c.skinDeep);
  p(18, 18, 4, 2, c.skin);
  p(21, 12, 2, 1, c.skinDeep);
  p(22, 13, 1, 2, c.outline);
  p(16, 13, 2, 3, c.skinDeep);
  p(16, 13, 1, 2, c.skin);
  p(16, 8, 6, 2, c.hair);
  p(16, 10, 3, 2, c.hair);
  p(15, 10, 2, 4, c.hairShadow);
  if (agent.id === 'manager') {
    p(9, 13, 4, 8, c.hairShadow);
    p(10, 14, 3, 5, c.hair);
    p(10, 15, 2, 1, c.hairLight);
    p(16, 16, 1, 1, '#e8ce93');
  } else if (agent.id === 'frontend') {
    p(12, 3, 3, 2, c.hair);
    p(10, 5, 1, 5, '#424b55');
    p(11, 4, 8, 1, '#424b55');
    p(15, 9, 5, 7, '#30383f');
    p(16, 10, 3, 5, '#617a88');
    p(16, 10, 1, 3, '#8198a3');
    p(19, 16, 1, 3, '#30383f');
    p(20, 18, 3, 1, '#30383f');
  } else if (agent.id === 'backend') {
    p(14, 2, 3, 2, c.hairShadow);
    p(19, 4, 4, 2, c.hairShadow);
    for (const [x, y] of [[11, 6], [15, 5], [18, 7], [12, 10]]) {
      p(x, y, 2, 2, c.hairMid);
      p(x, y, 1, 1, c.hairLight);
    }
    p(18, 18, 4, 1, c.skinDeep);
    p(19, 19, 2, 1, c.hairMid);
  } else {
    p(9, 11, 3, 9, c.hairShadow);
    p(10, 11, 3, 8, c.hair);
    p(10, 12, 1, 6, c.hairLight);
    p(11, 19, 5, 2, c.hairShadow);
    p(19, 7, 3, 1, '#e1cab0');
    p(20, 7, 1, 1, '#8d799f');
    p(20, 12, 3, 1, '#5c505d');
    p(19, 13, 1, 2, '#5c505d');
    p(23, 13, 1, 2, '#5c505d');
    p(20, 15, 3, 1, '#5c505d');
    p(17, 13, 3, 1, '#5c505d');
    p(20, 13, 1, 1, '#d5e5e0');
  }
}

/**
 * Original 32×48 pixel employees. All source shapes are integer-aligned and
 * direction-specific; nearest filtering preserves clusters at any world zoom.
 * Textures are data only: no task state, model calls, or runtime actions.
 */
export function drawCharacterFrames(scene: Phaser.Scene, agent: Agent): void {
  const colors = palette(agent);
  const facings: Facing[] = ['down', 'up', 'left', 'right'];
  for (const facing of facings) {
    for (let frame = 0; frame < 4; frame++) {
      const key = `${agent.id}-${facing}-${frame}`;
      if (scene.textures.exists(key)) continue;
      const texture = scene.textures.createCanvas(key, 32, 48);
      if (!texture) continue;
      const context = texture.getContext();
      context.imageSmoothingEnabled = false;
      context.clearRect(0, 0, 32, 48);
      context.save();
      if (facing === 'left') {
        context.translate(32, 0);
        context.scale(-1, 1);
      }
      const paint: Paint = (x, y, width, height, color) => {
        context.fillStyle = color;
        context.fillRect(x, y, width, height);
      };
      if (facing === 'left' || facing === 'right') {
        sideCharacter(paint, colors, agent, frame);
      } else {
        frontBody(paint, colors, agent, frame, facing === 'up');
        frontHead(paint, colors, agent, facing === 'up');
      }
      context.restore();
      texture.refresh();
      texture.setFilter(Phaser.Textures.FilterMode.NEAREST);
    }
  }
}
