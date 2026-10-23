// Заставка portable-EXE (видна, пока программа распаковывается): пиксельная надпись BARANUS CHAOS
// в стиле меню игры. Запуск: node build/make-splash.cjs → build/splash.bmp (24-битный BMP для NSIS).
const fs = require('fs');
const path = require('path');

const W = 480, H = 160, SCALE = 5;
const BG = [0x0b, 0x08, 0x09], WHITE = [0xff, 0xf3, 0xf4], RED = [0xe8, 0x26, 0x3a];
const SHADOW_W = [0x3a, 0x32, 0x36], SHADOW_R = [0x4a, 0x0d, 0x16], LINE = [0xe8, 0x26, 0x3a];
const G = {
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  R: ['11110', '10001', '10001', '11110', '10001', '10001', '10001'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  C: ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110']
};

const pixels = Array.from({length: H}, () => Array.from({length: W}, () => BG));
const set = (x, y, color) => { if (x >= 0 && x < W && y >= 0 && y < H) pixels[y][x] = color; };
const block = (gx, gy, color, ox, oy) => {
  for (let dy = 0; dy < SCALE; dy++) for (let dx = 0; dx < SCALE; dx++) set(ox + gx * SCALE + dx, oy + gy * SCALE + dy, color);
};

// Ширина надписи в пикселях шрифта: 7 букв + пробел + 5 букв.
const textWidth = (7 * 6 - 1) + 4 + (5 * 6 - 1);
const ox = Math.round((W - (textWidth + 1) * SCALE) / 2), oy = Math.round((H - 8 * SCALE) / 2) - 6;
let x = 0;
for (const [word, color, shadow] of [['BARANUS', WHITE, SHADOW_W], ['CHAOS', RED, SHADOW_R]]) {
  for (const letter of word) {
    G[letter].forEach((row, y) => [...row].forEach((bit, dx) => { if (bit === '1') block(x + dx + 1, y + 1, shadow, ox, oy); }));
    G[letter].forEach((row, y) => [...row].forEach((bit, dx) => { if (bit === '1') block(x + dx, y, color, ox, oy); }));
    x += 6;
  }
  x += 4;
}
// Красная полоска сверху, как у панели меню в игре.
for (let y = 0; y < 4; y++) for (let xx = 0; xx < W; xx++) set(xx, y, LINE);

// 24-битный BMP: строки снизу вверх, BGR, выравнивание строки до 4 байт.
const rowSize = Math.ceil(W * 3 / 4) * 4;
const data = Buffer.alloc(54 + rowSize * H);
data.write('BM', 0);
data.writeUInt32LE(data.length, 2);
data.writeUInt32LE(54, 10);
data.writeUInt32LE(40, 14);
data.writeInt32LE(W, 18);
data.writeInt32LE(H, 22);
data.writeUInt16LE(1, 26);
data.writeUInt16LE(24, 28);
data.writeUInt32LE(rowSize * H, 34);
for (let y = 0; y < H; y++) {
  const row = 54 + (H - 1 - y) * rowSize;
  for (let xx = 0; xx < W; xx++) {
    const [r, g, b] = pixels[y][xx];
    data[row + xx * 3] = b; data[row + xx * 3 + 1] = g; data[row + xx * 3 + 2] = r;
  }
}
fs.writeFileSync(path.join(__dirname, 'splash.bmp'), data);
console.log('build/splash.bmp', W + 'x' + H);
