// @ts-check
// The shortcut icon (assets/icon.ico) — the same drawing as public/favicon.svg: an orange square and a white asterisk.
// Run: node scripts/make-icon.mjs. Draws the pixels itself (4×4 samples per pixel for anti-aliasing) and packs the PNGs into an ICO.
import { writeFile } from 'node:fs/promises';
import { deflateSync, crc32 } from 'node:zlib';

const sizes = [16, 24, 32, 48, 64, 256];
const accent = [0xd9, 0x77, 0x57];
const light = [0xfa, 0xf9, 0xf5];

const images = sizes.map((size) => png(size, render(size)));
await writeFile(new URL('../assets/icon.ico', import.meta.url), ico(sizes, images));
console.log(`assets/icon.ico: ${sizes.join(', ')} px`);

/**
 * The drawing in 0..32 coordinates, as in favicon.svg: a rounded square (r = 7) and four lines of width 3.
 * @param {number} x
 * @param {number} y
 * @returns {'accent' | 'light' | 'none'}
 */
function shapeAt(x, y) {
  if (!insideRoundedSquare(x, y, 32, 7)) return 'none';
  const lines = [
    [16, 6, 16, 26],
    [6, 16, 26, 16],
    [9, 9, 23, 23],
    [23, 9, 9, 23],
  ];
  return lines.some(([x1 = 0, y1 = 0, x2 = 0, y2 = 0]) => distanceToSegment(x, y, x1, y1, x2, y2) <= 1.5) ? 'light' : 'accent';
}

/** @param {number} size @returns {Uint8Array} RGBA */
function render(size) {
  const pixels = new Uint8Array(size * size * 4);
  const samples = 4;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let accentHits = 0;
      let lightHits = 0;
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const shape = shapeAt(((px + (sx + 0.5) / samples) * 32) / size, ((py + (sy + 0.5) / samples) * 32) / size);
          if (shape === 'accent') accentHits++;
          if (shape === 'light') lightHits++;
        }
      }
      const covered = accentHits + lightHits;
      const offset = (py * size + px) * 4;
      if (covered === 0) continue;
      for (let channel = 0; channel < 3; channel++) {
        pixels[offset + channel] = Math.round(((accent[channel] ?? 0) * accentHits + (light[channel] ?? 0) * lightHits) / covered);
      }
      pixels[offset + 3] = Math.round((255 * covered) / (samples * samples));
    }
  }
  return pixels;
}

/** @param {number} x @param {number} y @param {number} side @param {number} radius */
function insideRoundedSquare(x, y, side, radius) {
  const dx = Math.max(radius - x, 0, x - (side - radius));
  const dy = Math.max(radius - y, 0, y - (side - radius));
  return dx * dx + dy * dy <= radius * radius;
}

/** @param {number} px @param {number} py @param {number} x1 @param {number} y1 @param {number} x2 @param {number} y2 */
function distanceToSegment(px, py, x1, y1, x2, y2) {
  const length = (x2 - x1) ** 2 + (y2 - y1) ** 2;
  const t = Math.max(0, Math.min(1, ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / length));
  return Math.hypot(px - (x1 + t * (x2 - x1)), py - (y1 + t * (y2 - y1)));
}

/** @param {number} size @param {Uint8Array} rgba @returns {Buffer} */
function png(size, rgba) {
  const rows = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) Buffer.from(rgba.subarray(y * size * 4, (y + 1) * size * 4)).copy(rows, y * (size * 4 + 1) + 1);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 6, 0, 0, 0], 8); // 8 bits per channel, RGBA, no interlacing
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}

/** @param {string} type @param {Buffer} data */
function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** An ICO with PNGs inside — the form Windows Vista and later understand. @param {readonly number[]} imageSizes @param {readonly Buffer[]} pngs */
function ico(imageSizes, pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  let offset = 6 + 16 * pngs.length;
  const entries = pngs.map((image, index) => {
    const entry = Buffer.alloc(16);
    const size = imageSizes[index] ?? 0;
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(image.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += image.length;
    return entry;
  });
  return Buffer.concat([header, ...entries, ...pngs]);
}
