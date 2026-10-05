import Phaser from 'phaser';

/** Original, code-native office artwork. Coordinates are integer source pixels. */
class OfficePainter {
  private readonly floor: Phaser.GameObjects.Graphics;

  constructor(private readonly scene: Phaser.Scene) {
    this.floor = scene.add.graphics().setDepth(0);
  }

  private r(x: number, y: number, w: number, h: number, color: number, alpha = 1) {
    this.floor.fillStyle(color, alpha).fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  }

  private label(x: number, y: number, text: string, color = '#79533f', size = 10, spacing = 2) {
    return this.scene.add.text(x, y, text, {
      fontFamily: '"Courier New", monospace', fontSize: `${size}px`, fontStyle: 'bold', color,
    }).setLetterSpacing(spacing).setDepth(1);
  }

  private rug(x: number, y: number, w: number, h: number, base: number, border: number) {
    this.r(x - 2, y + 2, w + 4, h, 0x755a43, 0.2);
    this.r(x, y, w, h, border);
    this.r(x + 3, y + 3, w - 6, h - 6, 0xd3b17c);
    this.r(x + 5, y + 5, w - 10, h - 10, border);
    this.r(x + 8, y + 8, w - 16, h - 16, base);
    for (let px = x + 14; px < x + w - 14; px += 12) {
      this.r(px, y + 10, 3, 3, 0xd9b98b);
      this.r(px, y + h - 13, 3, 3, 0xd9b98b);
    }
    for (let py = y + 18; py < y + h - 14; py += 12) {
      this.r(x + 10, py, 3, 3, 0xd9b98b);
      this.r(x + w - 13, py, 3, 3, 0xd9b98b);
    }
    for (let py = y + 16; py < y + h - 16; py += 14) {
      for (let px = x + 21 + (Math.floor((py - y) / 14) % 2) * 7; px < x + w - 18; px += 20) {
        this.r(px, py, 2, 2, border, 0.42);
        this.r(px - 2, py + 2, 6, 2, border, 0.42);
        this.r(px, py + 4, 2, 2, border, 0.42);
        this.r(px + 1, py + 2, 1, 1, 0xe5cda1, 0.5);
      }
    }
    for (let px = x + 3; px < x + w - 3; px += 5) {
      this.r(px, y - 3, 2, 3, 0xd9b98b);
      this.r(px, y + h, 2, 3, 0xd9b98b);
    }
    for (let py = y + 8; py < y + h - 8; py += 3) this.r(x + 8, py, w - 16, 1, 0xeedbb7, 0.04);
  }

  private leaf(g: Phaser.GameObjects.Graphics, x: number, y: number, size: number, color: number, flip = false) {
    const w = size;
    const h = Math.ceil(size * .65);
    // Hand-stepped, asymmetric leaf silhouettes; each row narrows to a tip.
    for (let row = 0; row < h; row++) {
      const breadth = Math.max(2, Math.round(Math.sin((row + 1) / (h + 1) * Math.PI) * w));
      const lean = Math.round(row / h * 3) * (flip ? 1 : -1);
      const left = x + Math.round((w - breadth) / 2) + lean;
      g.fillStyle(0x2e4d35).fillRect(left, y + row, breadth, 1);
      if (breadth > 3 && row > 0 && row < h - 1) g.fillStyle(color).fillRect(left + 1, y + row, breadth - 2, 1);
      if (row > 1 && row < h - 3) g.fillStyle(row < h / 2 ? 0xadc376 : 0x8aab5b).fillRect(left + 2, y + row, Math.max(1, Math.floor(breadth / 4)), 1);
    }
    g.fillStyle(0x54733b).fillRect(x + Math.floor(w / 2), y + 3, 1, h - 5);
    g.fillStyle(0x90ab58).fillRect(x + Math.floor(w / 2) - 1, y + 3, 1, h - 6);
  }

  private plant(x: number, y: number, tall = false, flowers = false) {
    const g = this.scene.add.graphics().setDepth(y + 12);
    g.fillStyle(0x573f2e, 0.19).fillRect(x - 18, y + 6, 36, 7).fillRect(x - 12, y + 12, 24, 3);
    g.fillStyle(0x734329).fillRect(x - 12, y - 7, 24, 17).fillRect(x - 9, y + 9, 18, 3);
    g.fillStyle(0xb57042).fillRect(x - 10, y - 5, 20, 15);
    g.fillStyle(0xd29559).fillRect(x - 9, y - 5, 6, 12);
    g.fillStyle(0x8f532f).fillRect(x + 6, y - 4, 4, 13);
    g.fillStyle(0xe7b274).fillRect(x - 8, y + 1, 3, 5);
    g.fillStyle(0x91582f).fillRect(x - 14, y - 9, 28, 6);
    g.fillStyle(0xd18d52).fillRect(x - 13, y - 9, 26, 3);
    g.fillStyle(0x483c2b).fillRect(x - 9, y - 9, 18, 2);
    const height = tall ? 65 : 40;
    g.fillStyle(0x4b6037).fillRect(x - 1, y - height + 4, 3, height - 14);
    g.fillStyle(0x7e8d46).fillRect(x, y - height + 6, 1, height - 19);
    const leaves = tall
      ? [[-22, -53, 18], [0, -65, 17], [-13, -71, 15], [2, -48, 21], [-27, -34, 21], [-9, -40, 19], [5, -26, 21], [-21, -22, 17], [-5, -59, 16]]
      : [[-20, -35, 17], [-2, -47, 16], [-9, -51, 14], [3, -31, 19], [-14, -22, 18], [-5, -35, 17]];
    for (let i = 0; i < leaves.length; i++) {
      const [lx, ly, size] = leaves[i];
      this.leaf(g, x + lx, y + ly, size, [0x63874b, 0x4f794c, 0x719650, 0x829f55][i % 4], i % 2 === 0);
    }
    if (flowers) {
      for (const [fx, fy] of [[-12, -39], [6, -43], [-2, -29]]) {
        g.fillStyle(0x7c4266).fillRect(x + fx - 3, y + fy - 1, 8, 4).fillRect(x + fx, y + fy - 4, 3, 10);
        g.fillStyle(0xcc6b96).fillRect(x + fx - 2, y + fy, 6, 2).fillRect(x + fx + 1, y + fy - 3, 2, 8);
        g.fillStyle(0xf0d086).fillRect(x + fx + 1, y + fy, 2, 2);
      }
    }
  }

  private shelf(x: number, y: number, width: number, height: number) {
    this.r(x + 3, y + height, width + 3, 8, 0x61402b, .22);
    this.r(x - 2, y - 2, width + 4, height + 4, 0x573923);
    this.r(x, y, width, height, 0xb57d47);
    this.r(x + 5, y + 4, width - 10, height - 8, 0x65472e);
    this.r(x + 7, y + 6, width - 14, height - 12, 0x815b37);
    const books = [0xb5634f, 0x748a52, 0xd0a453, 0x668b9c, 0xddd0a1, 0x956488, 0xc98645];
    for (let row = 0; row < 3; row++) {
      const base = y + 33 + row * 35;
      for (let book = 0; book < Math.floor((width - 17) / 8); book++) {
        const bx = x + 9 + book * 8;
        const bh = 17 + (book * 5 + row * 7) % 11;
        this.r(bx - 1, base - bh - 1, 7, bh + 1, 0x49372a);
        this.r(bx, base - bh, 6, bh, books[(book + row * 3) % books.length]);
        this.r(bx, base - bh, 1, bh - 1, 0xf2daa3, .45);
        this.r(bx + 4, base - bh + 1, 1, bh - 1, 0x443a32, .3);
        this.r(bx + 1, base - bh + 3, 4, 1, 0xdecba1);
        this.r(bx + 2, base - 5, 2, 2, 0xe0c592);
      }
      this.r(x + 4, base + 1, width - 8, 4, 0xc29255);
      this.r(x + 4, base + 1, width - 8, 1, 0xe4bc76);
      this.r(x + 5, base + 5, width - 10, 1, 0x5e412b);
    }
    this.r(x, y, 4, height, 0xddad68);
    this.r(x + width - 4, y, 4, height, 0x855632);
    this.r(x - 3, y - 4, width + 6, 6, 0xc58f52);
    this.r(x - 3, y - 4, width + 6, 1, 0xf0c786);
    for (let py = y + 9; py < y + height - 7; py += 15) this.r(x + 1, py, 1, 7, 0xaf7b48);
    // Ceramic cup and stacked sketchbooks above the shelf.
    this.r(x + 8, y - 12, 23, 5, 0x728889);
    this.r(x + 9, y - 11, 20, 2, 0xdac7a4);
    this.r(x + 10, y - 16, 21, 4, 0xad6d59);
    this.r(x + 12, y - 15, 17, 1, 0xe1cba6);
    this.r(x + 46, y - 14, 12, 10, 0x8cae99);
    this.r(x + 45, y - 16, 14, 3, 0xbacbb0);
    this.r(x + 51, y - 32, 2, 18, 0x63804c);
    this.r(x + 43, y - 27, 9, 4, 0x7c9852);
    this.r(x + 52, y - 32, 8, 5, 0x547c48);
  }

  private desk(x: number, y: number, color: number, role: string, kind: 'code' | 'test' | 'plan') {
    const g = this.scene.add.graphics().setDepth(y + 43);
    const r = (dx: number, dy: number, w: number, h: number, c: number, a = 1) => g.fillStyle(c, a).fillRect(x + dx, y + dy, w, h);
    r(-66, 44, 137, 10, 0x65432c, .22);
    r(-58, 33, 9, 32, 0x65432b); r(49, 33, 9, 32, 0x65432b);
    r(-56, 37, 4, 23, 0xba844c); r(50, 37, 3, 23, 0x936233);
    r(-64, -10, 128, 55, 0x6d452a);
    r(-64, -9, 127, 44, 0xba8752); r(-62, -7, 123, 38, 0xd9ac70);
    r(-62, -7, 122, 3, 0xf0cc8c); r(59, -4, 3, 37, 0x946332);
    r(-62, 33, 124, 8, 0xab7541); r(-62, 33, 124, 2, 0xe5b77a);
    r(-61, 40, 121, 3, 0x795130);
    for (let row = 0; row < 4; row++) {
      const offset = row * 9;
      r(-59, -1 + offset, 116, 1, 0xa77946, .4);
      r(-52 + row * 5, 3 + offset, 17, 1, 0xf4d296, .45);
      r(28 - row * 7, 2 + offset, 22, 1, 0x996936, .26);
    }
    r(-60, 35, 30, 1, 0x8d5b30); r(-59, 37, 25, 1, 0xd49d61);
    // Monitor frame, stand, glass edge, status LED and dark editor desktop.
    r(-5, 1, 10, 20, 0x445349); r(-3, 3, 5, 16, 0x829184); r(-15, 17, 31, 5, 0x516356);
    r(-27, -35, 54, 39, 0x2e3f39); r(-26, -34, 52, 36, 0x6e8579);
    r(-24, -33, 48, 1, 0xb2baa0); r(-23, -30, 46, 29, 0x253b3a);
    r(-23, -30, 46, 5, 0x47665e); r(-20, -28, 3, 1, 0xe1b779);
    r(-15, -28, 3, 1, 0xb58b89); r(-10, -28, 3, 1, 0x97b391);
    r(17, -28, 3, 1, 0x9aaca2); r(19, 1, 2, 1, 0xbfdf96);
    if (kind === 'code') {
      for (let row = 0; row < 5; row++) {
        r(-19, -20 + row * 4, 2, 1, 0x5f847a);
        r(-13 + row % 2 * 4, -20 + row * 4, [16, 12, 23, 9, 18][row], 2, [0xabc48d, 0xd9b184, 0x88b3bd][row % 3]);
      }
      r(-23, -3, 46, 2, 0x38564c);
    } else if (kind === 'test') {
      for (let row = 0; row < 3; row++) {
        r(-17, -20 + row * 6, 4, 4, 0x89b885);
        r(-15, -19 + row * 6, 2, 1, 0x355e48);
        r(-9, -20 + row * 6, 24 - row * 4, 2, 0xa7c1a3);
        r(-9, -17 + row * 6, 17 - row * 3, 1, 0x6d9485);
      }
    } else {
      r(-17, -20, 9, 15, 0x93b78a); r(-5, -12, 9, 7, 0xb28dab); r(8, -23, 8, 18, 0xd8b97c);
      r(-17, -20, 9, 1, 0xc3d4a3); r(8, -23, 8, 1, 0xf2d59c);
    }
    // Keyboard has individual keys, a space bar, mouse and a coiled cable.
    r(-22, 25, 45, 10, 0x7b7862); r(-22, 24, 44, 8, 0xe2d2b1);
    for (let row = 0; row < 2; row++) for (let col = 0; col < 9; col++) r(-20 + col * 4, 25 + row * 3, 2, 2, 0x999581);
    r(-8, 31, 19, 1, 0xbbb69c);
    r(28, 25, 9, 11, 0x777665); r(29, 24, 7, 10, 0xd8cbae); r(32, 24, 1, 4, 0x979782);
    r(31, 20, 2, 4, 0x787b65); r(23, 19, 10, 1, 0x787b65);
    // Coffee mug, notebook pages, bookmark and pen.
    r(43, 12, 12, 13, 0x5d5b45); r(44, 12, 10, 11, color); r(53, 15, 4, 5, color);
    r(45, 10, 8, 3, 0xf5e4bd); r(46, 11, 6, 1, 0x755c3e); r(45, 15, 2, 5, 0xf9edcd, .5);
    r(-52, 17, 22, 18, 0x73533a); r(-51, 15, 20, 18, 0xd8c098);
    r(-49, 16, 16, 14, 0xefe1bc); r(-48, 18, 3, 13, color);
    for (let line = 0; line < 3; line++) r(-43, 20 + line * 3, 7, 1, 0xaaa58b);
    r(-31, 19, 2, 15, 0x4b6259); r(-31, 17, 2, 3, 0xe9c38f);
    if (kind === 'test') { r(35, -1, 17, 10, 0xbb92ba); r(36, -1, 15, 1, 0xdfbcd7); r(39, 3, 8, 1, 0x8c7791); }
    if (kind === 'code' && color === 0xe0b878) { r(-53, 6, 12, 8, 0xf1cf75); r(-51, 8, 8, 1, 0xb69350); }
    // Adjustable reading lamp with a warm, pixel-stepped pool of light.
    r(-57, 7, 20, 4, 0x526044); r(-50, -14, 3, 22, 0x677747); r(-50, -15, 13, 3, 0x8b9555);
    r(-41, -19, 10, 9, 0x465939); r(-42, -17, 13, 6, 0x879951); r(-39, -11, 9, 2, 0xf4d282);
    r(-41, -8, 15, 9, 0xffdf93, .17); r(-44, 1, 22, 10, 0xffdf93, .12);
    const chair = this.scene.add.graphics().setDepth(y + 62);
    const c = (dx: number, dy: number, w: number, h: number, tone: number) => chair.fillStyle(tone).fillRect(x + dx, y + dy, w, h);
    c(-3, 68, 6, 8, 0x52614d); c(-19, 74, 39, 3, 0x53614e);
    c(-20, 77, 5, 3, 0x354b40); c(14, 77, 5, 3, 0x354b40);
    c(-18, 47, 36, 25, 0x394f43); c(-16, 48, 32, 21, color);
    c(-14, 49, 27, 2, 0xe1ddbb); c(-15, 64, 30, 4, 0x697b66);
    c(-20, 55, 5, 12, 0x4f6250); c(15, 55, 5, 12, 0x4f6250);
    this.label(x, y + 105, role, '#886041', 10, 1).setOrigin(.5, 0);
  }

  private painting() {
    this.r(239, 75, 100, 49, 0x60452f); this.r(241, 77, 96, 45, 0xbd894b);
    this.r(243, 79, 92, 41, 0xe5bf80); this.r(246, 82, 86, 35, 0x547777);
    this.r(248, 84, 82, 15, 0x96b1a3); this.r(249, 85, 79, 6, 0xb7c4ab);
    this.r(310, 85, 9, 8, 0xead29b);
    for (const [x, y, w, h] of [[250, 101, 24, 8], [259, 96, 12, 5], [277, 102, 33, 6], [286, 98, 14, 5]]) this.r(x, y, w, h, 0x6d9277);
    this.r(248, 108, 82, 9, 0x527351); this.r(271, 106, 37, 4, 0x94a479);
    for (let tree = 0; tree < 8; tree++) {
      const x = 250 + tree * 10;
      this.r(x + 3, 103 + tree % 3, 2, 12, 0x5b5d40); this.r(x, 102 + tree % 3, 8, 7, 0x355d47);
      this.r(x + 2, 98 + tree % 3, 4, 7, 0x46734e); this.r(x + 2, 101 + tree % 3, 2, 2, 0x759957);
    }
    this.r(271, 112, 11, 5, 0xc4b182); this.r(269, 116, 19, 1, 0xdcc89c);
    for (const [x, y] of [[240, 76], [334, 76], [240, 119], [334, 119]]) this.r(x, y, 3, 3, 0xf1ce85);
  }

  private window() {
    this.r(607, 72, 188, 59, 0x684b34); this.r(610, 75, 182, 53, 0xad824e);
    this.r(615, 78, 172, 46, 0xe2c18c); this.r(618, 81, 166, 40, 0x759da0);
    this.r(620, 83, 162, 14, 0xb9d7c1); this.r(620, 97, 162, 10, 0x99beab);
    this.r(620, 108, 162, 12, 0x709358);
    for (const [x, y, w] of [[631, 87, 22], [651, 85, 16], [737, 90, 26]]) {
      this.r(x, y, w, 4, 0xece4ba); this.r(x + 4, y - 2, w - 10, 2, 0xece4ba);
    }
    for (let tree = 0; tree < 14; tree++) {
      const x = 620 + tree * 12;
      this.r(x + 3, 103 + tree % 3 * 2, 2, 17, 0x5d7852);
      this.r(x, 102 + tree % 3 * 2, 9, 8, 0x3e714b);
      this.r(x + 2, 99 + tree % 3 * 2, 6, 9, 0x668c50);
      this.r(x + 3, 101 + tree % 3 * 2, 3, 3, 0x92ad63);
    }
    this.r(698, 78, 5, 47, 0xe2cba0); this.r(699, 78, 1, 45, 0xffdfab);
    this.r(617, 101, 168, 4, 0xe2cba0); this.r(618, 101, 166, 1, 0xffdfab);
    this.r(611, 126, 181, 5, 0x845a32); this.r(607, 125, 188, 3, 0xe2b779);
    this.r(607, 70, 188, 3, 0x745038); this.r(602, 67, 198, 3, 0xbc9c62);
    // Rust linen curtains, hems, tie-backs and visible folded fabric.
    for (const x of [599, 788]) {
      this.r(x, 73, 16, 57, 0x8e4f37); this.r(x + 2, 73, 13, 55, 0xbb7750);
      this.r(x + 3, 75, 3, 46, 0xd69b64); this.r(x + 8, 74, 2, 50, 0x9c5e3e);
      this.r(x + 12, 73, 2, 51, 0xd09b69); this.r(x, 119, 16, 4, 0xe2bc79);
      this.r(x + 3, 129, 11, 2, 0x6f4632);
    }
    // A planted sill adds small flowers and foliage to the architecture.
    this.r(719, 117, 59, 12, 0xa77748); this.r(717, 115, 63, 4, 0xc0915d);
    this.r(723, 116, 52, 2, 0x59452e);
    for (let sprig = 0; sprig < 7; sprig++) {
      const x = 724 + sprig * 7;
      this.r(x + 2, 106 + sprig % 2 * 3, 2, 12, 0x3f6740);
      this.r(x, 108 + sprig % 2 * 3, 6, 4, 0x7f9b49);
      this.r(x + 1, 103 + sprig % 2 * 3, 4, 4, sprig % 3 ? 0xc47b8b : 0xe7b555);
      this.r(x + 2, 104 + sprig % 2 * 3, 2, 2, 0xf2d28d);
    }
  }

  private sofa() {
    this.r(590, 225, 246, 13, 0x593f2c, .22);
    this.r(594, 222, 9, 14, 0x644b30); this.r(819, 222, 9, 14, 0x644b30);
    this.r(594, 178, 237, 49, 0x314e3d); this.r(589, 185, 248, 38, 0x314e3d);
    this.r(593, 181, 239, 39, 0x527855); this.r(597, 183, 231, 18, 0x709361);
    this.r(597, 184, 230, 3, 0x95ae74); this.r(597, 199, 230, 3, 0x3e6146);
    this.r(598, 203, 228, 19, 0x85a46c); this.r(598, 218, 228, 4, 0x5e8154);
    for (let seat = 0; seat < 4; seat++) {
      const x = 602 + seat * 57;
      this.r(x, 204, 51, 2, 0xa1b37d); this.r(x + 51, 204, 2, 17, 0x46684a);
      this.r(x + 22, 190, 4, 1, 0x486c4b); this.r(x + 23, 188, 2, 5, 0x486c4b);
      for (let speck = 0; speck < 6; speck++) this.r(x + 5 + speck * 7, 209 + speck % 2 * 3, 2, 1, 0x4c744a, .35);
    }
    this.r(589, 197, 10, 29, 0x3c6145); this.r(591, 198, 5, 22, 0x789866);
    this.r(826, 197, 10, 29, 0x3c6145); this.r(828, 198, 4, 20, 0x789866);
    this.r(603, 186, 20, 17, 0x9a623f); this.r(604, 186, 18, 14, 0xd4a05a);
    this.r(605, 188, 3, 10, 0xebc077); this.r(611, 191, 5, 5, 0x8f6445); this.r(612, 192, 3, 3, 0xe4b578);
    this.r(801, 185, 19, 18, 0x929c64); this.r(802, 186, 17, 15, 0xd1c18e);
    this.r(807, 188, 3, 10, 0x799264); this.r(806, 189, 7, 3, 0x799264);
    // Folded quilt hangs over the far arm.
    this.r(589, 205, 20, 20, 0xad6856);
    for (let stripe = 0; stripe < 5; stripe++) this.r(589, 207 + stripe * 4, 20, 2, stripe % 2 ? 0xe0bb82 : 0x87513e);
    this.r(589, 223, 20, 2, 0x5b3c2e);
  }

  private coffeeTable() {
    this.r(697, 296, 132, 6, 0x64432b, .2); this.r(704, 278, 8, 22, 0x6c482b); this.r(810, 278, 8, 22, 0x6c482b);
    this.r(695, 262, 133, 28, 0x71462a); this.r(696, 263, 131, 23, 0xbc8650); this.r(698, 264, 127, 19, 0xd9a76b);
    this.r(699, 264, 125, 2, 0xf1c385); this.r(697, 282, 129, 3, 0x946233);
    for (let i = 0; i < 3; i++) this.r(703, 269 + i * 5, 112, 1, 0xaa7840, .4);
    this.r(744, 267, 33, 15, 0x796040); this.r(745, 266, 31, 14, 0xefe0b7); this.r(760, 267, 1, 12, 0xb3a27c);
    for (let line = 0; line < 3; line++) { this.r(749, 270 + line * 3, 8, 1, 0xa29b7a); this.r(763, 270 + line * 3, 9, 1, 0xa29b7a); }
    this.r(790, 268, 11, 12, 0x8f5341); this.r(791, 267, 9, 10, 0xca886c); this.r(799, 270, 4, 5, 0xb57052);
    this.r(792, 266, 7, 3, 0xf0dfb5); this.r(793, 267, 5, 1, 0x6c513b);
    this.r(711, 267, 17, 12, 0x47715d); this.r(713, 269, 13, 8, 0x76977d); this.r(715, 271, 8, 1, 0xc9d4ac);
  }

  private coffeeCounter() {
    this.r(542, 184, 39, 65, 0x66452c); this.r(544, 187, 35, 58, 0xb6814d);
    this.r(546, 188, 30, 54, 0xcd9a60); this.r(546, 212, 31, 2, 0x8b5e35);
    this.r(549, 188, 2, 50, 0xe0b177); this.r(572, 189, 2, 49, 0xab7743);
    this.r(554, 205, 9, 2, 0x5f5138); this.r(555, 231, 8, 2, 0x5f5138);
    this.r(540, 177, 43, 10, 0x6a4930); this.r(541, 178, 41, 6, 0xdfba82); this.r(542, 178, 39, 1, 0xf5d299);
    this.r(547, 154, 28, 27, 0x2d493f); this.r(549, 155, 24, 24, 0x537b68);
    this.r(550, 156, 21, 2, 0x8bab83); this.r(552, 160, 17, 8, 0x283d36);
    this.r(554, 162, 7, 2, 0xd8bf79); this.r(565, 162, 2, 2, 0x97c08b);
    this.r(553, 171, 16, 3, 0x9caa8d); this.r(558, 170, 7, 10, 0xe6d7b5); this.r(559, 170, 5, 2, 0x7b5b3e);
    this.r(568, 171, 5, 7, 0xb3c7a5); this.r(551, 179, 18, 1, 0x283d36);
    this.r(552, 146, 1, 5, 0xb0bb95, .55); this.r(553, 145, 2, 1, 0xb0bb95, .55);
    this.r(560, 143, 1, 6, 0xb0bb95, .4); this.r(559, 142, 2, 1, 0xb0bb95, .4);
  }

  private serverRack() {
    this.r(109, 432, 52, 86, 0x384d40); this.r(111, 434, 48, 80, 0x729071); this.r(115, 438, 40, 72, 0x2b4238);
    this.r(112, 434, 3, 77, 0xa6b58d); this.r(156, 434, 2, 79, 0x4e704f);
    for (let row = 0; row < 4; row++) {
      const y = 442 + row * 16;
      this.r(117, y, 36, 12, 0x536e57); this.r(117, y, 36, 1, 0x94a87c);
      for (let slot = 0; slot < 4; slot++) this.r(121 + slot * 4, y + 4, 2, 5, 0x2c4636);
      this.r(143, y + 4, 3, 2, row === 2 ? 0xe0bc74 : 0xc6dca1); this.r(148, y + 4, 2, 2, 0x90bda3);
      this.r(144, y + 8, 6, 1, 0x263f34);
    }
    this.r(114, 515, 7, 4, 0x654b32); this.r(148, 515, 7, 4, 0x654b32);
    this.r(120, 427, 26, 5, 0xaa794b); this.r(122, 426, 22, 2, 0xe6c992);
  }

  private pinboard() {
    this.r(792, 395, 56, 83, 0x61432d); this.r(794, 397, 52, 79, 0xbb8851); this.r(797, 400, 46, 73, 0xcaac7a);
    this.r(794, 397, 52, 2, 0xe4b67b);
    for (let speck = 0; speck < 45; speck++) this.r(799 + speck * 17 % 41, 404 + speck * 11 % 66, 1, 1, 0x9b8054, .5);
    const notes = [[801, 407, 14, 19, 0xe9cb78], [823, 408, 14, 24, 0xa9be91], [806, 437, 23, 19, 0xd59d8d]];
    for (const [x, y, w, h, color] of notes) {
      this.r(x + 1, y + 1, w, h, 0x8a6a46, .5); this.r(x, y, w, h, color); this.r(x, y, w, 1, 0xf1dfb5);
      this.r(x + Math.floor(w / 2), y + 1, 2, 2, 0xa75144);
      for (let line = 0; line < 3; line++) this.r(x + 3, y + 6 + line * 3, w - 6 - line % 2 * 2, 1, 0x8e8967);
    }
    this.r(797, 486, 52, 40, 0x69462b); this.r(799, 488, 48, 36, 0xc08e55);
    this.r(801, 490, 44, 14, 0xd5a96b); this.r(801, 507, 44, 14, 0xb5814e);
    this.r(818, 496, 9, 2, 0x65513a); this.r(818, 513, 9, 2, 0x65513a);
    this.r(797, 484, 52, 4, 0xe2b57b); this.r(804, 478, 22, 5, 0x71978f); this.r(806, 479, 18, 2, 0xdcd0ad);
    this.r(808, 474, 20, 4, 0xad7c97); this.r(810, 475, 15, 1, 0xe4d1b0);
  }

  draw() {
    // Layered foundation and timber trim make an architectural cutaway.
    this.r(71, 75, 829, 524, 0xc9b596); this.r(75, 73, 818, 521, 0x69482f);
    this.r(82, 127, 800, 460, 0x9d7045); this.r(88, 132, 788, 449, 0xcfa574);
    const boards = [0xd9ad75, 0xd1a26a, 0xe0b77f, 0xc99a63, 0xdcb179, 0xd4a76f];
    for (let row = 0; row < 16; row++) {
      const y = 133 + row * 28;
      const offset = row % 2 ? -46 : 0;
      for (let col = 0; col < 10; col++) {
        const rawX = 89 + offset + col * 94;
        const x = Math.max(89, rawX);
        const width = Math.min(875, rawX + 93) - x;
        if (width <= 0) continue;
        this.r(x, y, width, 27, boards[(row * 7 + col * 3) % boards.length]);
        this.r(x, y, width, 1, 0xeac68d, .65); this.r(x, y + 26, width, 1, 0x9f7049, .45);
        for (let grain = 0; grain < 4; grain++) {
          const gx = x + 7 + (col * 11 + row * 9 + grain * 15) % Math.max(8, width - 32);
          this.r(gx, y + 4 + grain * 5, Math.min(25, x + width - gx - 3), 1, grain % 2 ? 0xefce93 : 0xa77746, grain % 2 ? .25 : .23);
        }
        if (width > 35) {
          this.r(x + 4, y + 5, 1, 1, 0x8b6b46); this.r(x + width - 5, y + 21, 1, 1, 0x8b6b46);
          if ((row + col) % 4 === 0) {
            this.r(x + 33, y + 13, 9, 1, 0xb18451); this.r(x + 35, y + 11, 5, 1, 0xb18451); this.r(x + 36, y + 12, 3, 3, 0xc7985e);
          }
        }
      }
    }
    // Warm plaster wall has hand-painted flecks, wood panels and oak posts.
    this.r(74, 61, 818, 74, 0x63412b); this.r(80, 66, 806, 63, 0xdcbf92); this.r(89, 70, 787, 53, 0xe9d2a7);
    for (let i = 0; i < 92; i++) this.r(94 + i * 37 % 775, 76 + i * 17 % 42, 2 + i % 3, 1, i % 2 ? 0xcab181 : 0xf1dfb7, .65);
    this.r(89, 116, 787, 10, 0xb18550); this.r(89, 117, 787, 2, 0xe1b77a); this.r(89, 125, 787, 8, 0x7d5735);
    this.r(89, 129, 787, 2, 0xcd9f61); this.r(89, 133, 787, 7, 0x815c37, .23);
    this.r(74, 60, 818, 9, 0x916236); this.r(76, 60, 814, 2, 0xd4a15d);
    for (const x of [81, 438, 878]) {
      this.r(x, 67, 10, 65, 0x85582f); this.r(x + 1, 68, 3, 61, 0xc39556); this.r(x + 7, 68, 2, 62, 0x6f472b);
      this.r(x + 2, 84, 1, 17, 0xddb478); this.r(x + 5, 110, 1, 10, 0x5d412b);
    }
    for (const x of [76, 879]) {
      this.r(x, 130, 10, 454, 0x79502f); this.r(x + 1, 130, 3, 454, 0xc59659);
      for (let stud = 0; stud < 16; stud++) this.r(x + 4, 140 + stud * 28, 2, 9, 0xa3703d);
    }
    this.r(84, 579, 796, 11, 0x6d482d); this.r(84, 579, 796, 3, 0xddac6d); this.r(86, 583, 792, 2, 0xa87542);
    this.painting(); this.window();
    // Brass clock is an illustration, rather than a synthetic activity meter.
    this.r(474, 80, 24, 29, 0x795231); this.r(470, 84, 32, 21, 0x795231); this.r(472, 82, 28, 25, 0xc89955);
    this.r(475, 85, 22, 19, 0xebd7a7); this.r(478, 83, 16, 23, 0xebd7a7);
    this.r(485, 86, 2, 2, 0x997749); this.r(485, 100, 2, 2, 0x997749); this.r(476, 93, 2, 2, 0x997749); this.r(494, 93, 2, 2, 0x997749);
    this.r(485, 91, 2, 6, 0x5d513b); this.r(481, 88, 2, 4, 0x5d513b); this.r(483, 90, 2, 3, 0x5d513b); this.r(487, 89, 4, 2, 0x5d513b);
    // Decorative vine shelving brings density to the top left of the room.
    this.r(115, 94, 80, 6, 0xb1834a); this.r(115, 94, 80, 1, 0xe3b96f);
    this.r(118, 99, 3, 9, 0x78542f); this.r(188, 99, 3, 9, 0x78542f);
    this.r(126, 78, 18, 16, 0xa56c4b); this.r(125, 76, 20, 4, 0xd49a63);
    for (let leaf = 0; leaf < 14; leaf++) {
      const x = 123 + leaf * 9 % 24; const y = 63 + leaf * 7 % 47;
      this.r(x, y, 7, 5, [0x537748, 0x6d8a49, 0x87a153][leaf % 3]); this.r(x + 1, y + 1, 2, 1, 0xb1c378);
    }
    this.r(155, 85, 6, 9, 0xa14e45); this.r(164, 80, 6, 14, 0x788e99); this.r(172, 83, 6, 11, 0xd1a257);
    this.r(182, 82, 9, 12, 0xdad3a7); this.r(184, 83, 3, 8, 0x8ca788);
    this.rug(214, 182, 148, 116, 0xbe8060, 0x895c42);
    this.rug(579, 169, 253, 102, 0x75968b, 0x3b665c);
    this.rug(354, 544, 346, 27, 0xba875f, 0x835d42);
    this.rug(191, 387, 150, 114, 0x7f9aa0, 0x466970);
    this.rug(407, 387, 150, 114, 0xb9956b, 0x866144);
    this.rug(623, 387, 150, 114, 0x9d849b, 0x715771);
    // Low brick-and-timber partition, with a clear, unchanged walking doorway.
    for (const [x, width] of [[89, 341], [520, 355]]) {
      this.r(x, 315, width, 23, 0x815736); this.r(x + 1, 317, width - 2, 18, 0xc39461);
      for (let brick = 0; brick < Math.ceil(width / 24); brick++) {
        const bx = x + brick * 24;
        this.r(bx, 318, Math.min(23, width - brick * 24), 6, 0xd7ab75);
        this.r(bx + 1, 325, Math.min(21, width - brick * 24 - 1), 6, 0xb98b58);
      }
      this.r(x - 1, 309, width + 2, 8, 0x7b4f2e); this.r(x - 1, 309, width + 2, 2, 0xe1b47a); this.r(x, 311, width, 3, 0xc79152);
      this.r(x, 338, width, 5, 0x714b32, .17);
    }
    this.r(430, 313, 5, 25, 0x815634); this.r(515, 313, 5, 25, 0x815634);
    this.r(441, 332, 65, 3, 0xb68854); this.r(441, 333, 65, 1, 0xe2bb83);
    this.label(115, 149, 'THE STUDIO', '#81613d', 11, 3); this.label(593, 149, 'COMMON ROOM', '#456e53', 11, 3);
    this.label(115, 358, 'ENGINEERING', '#81613d', 11, 3); this.label(745, 358, '3 STATIONS', '#997247', 9, 1);
    this.shelf(111, 180, 70, 110);
    this.plant(395, 263, true); this.plant(849, 158, true); this.plant(123, 560, true); this.plant(837, 562, true, true);
    this.desk(288, 192, 0xa8cf8f, 'M · COORDINATION', 'plan');
    this.sofa(); this.coffeeTable(); this.coffeeCounter();
    this.desk(266, 404, 0x8ebce8, '01 · FRONTEND', 'code');
    this.desk(482, 404, 0xe0b878, '02 · BACKEND', 'code');
    this.desk(698, 404, 0xceafe8, '03 · QUALITY', 'test');
    this.serverRack(); this.pinboard();
    // Carefully bounded afternoon window light sits under all furniture.
    const light = this.scene.add.graphics().setDepth(.5);
    light.fillStyle(0xffe5a3, .11).fillPoints([{ x: 620, y: 136 }, { x: 780, y: 136 }, { x: 643, y: 305 }, { x: 483, y: 305 }], true);
    light.fillStyle(0xffefb8, .1).fillPoints([{ x: 621, y: 136 }, { x: 693, y: 136 }, { x: 556, y: 305 }, { x: 483, y: 305 }], true);
    this.label(480, 604, 'A LITTLE SPACE FOR BIG IDEAS', '#9c8361', 9, 2).setOrigin(.5, 0);
  }
}

export function drawOfficeArt(scene: Phaser.Scene): void {
  new OfficePainter(scene).draw();
}
