// @ts-check
// Icons drawn like public/favicons/<palette>.svg — a square in the palette's colour and a white asterisk — where an SVG won't do:
//   assets/icon.ico — the shortcut icon, in clay;
//   public/favicons/<palette>.png — the home screen icon of iOS, 180 px: a full square without transparency (iOS rounds
//   the corners itself and paints transparent ones black).
// Run: node scripts/make-icon.mjs. Draws the pixels itself (4×4 samples per pixel for anti-aliasing); the colour of each
// palette is taken from its SVG.
import { readFile, writeFile } from 'node:fs/promises';
import { deflateSync, crc32 } from 'node:zlib';
import { palettes } from '../public/model/palettes.js';

const icoSizes = [16, 24, 32, 48, 64, 256];
const homeScreenSize = 180;
const light = [0xfa, 0xf9, 0xf5];
const favicons = new URL('../public/favicons/', import.meta.url);

const clay = await accentOf('clay');
const icoImages = icoSizes.map((size) => png(size, render(size, { corner: 7, accent: clay }), 'rgba'));
await writeFile(new URL('../assets/icon.ico', import.meta.url), ico(icoSizes, icoImages));
console.log(`assets/icon.ico: ${icoSizes.join(', ')} px`);
for (const palette of palettes) {
  const pixels = render(homeScreenSize, { corner: 0, accent: await accentOf(palette) });
  await writeFile(new URL(`${palette}.png`, favicons), png(homeScreenSize, pixels, 'rgb'));
  console.log(`public/favicons/${palette}.png: ${homeScreenSize} px`);
}

/**
 * The square's colour in public/favicons/<palette>.svg.
 * @param {import('../public/model/palettes.js').Palette} palette
 * @returns {Promise<readonly number[]>} red, green, blue
 */
async function accentOf(palette) {
  const svg = await readFile(new URL(`${palette}.svg`, favicons), 'utf8');
  const hex = /<rect [^>]*fill="#([0-9a-f]{6})"/i.exec(svg)?.[1];
  if (hex === undefined) throw new Error(`public/favicons/${palette}.svg: no <rect fill="#rrggbb"> to take the ${palette} colour from`);
  return [0, 2, 4].map((at) => parseInt(hex.slice(at, at + 2), 16));
}

/**
 * The drawing in 0..32 coordinates, as in the SVGs: a square with rounded corners and four lines of width 3.
 * @param {number} x
 * @param {number} y
 * @param {number} corner — radius of the square's corners; 0 — sharp, the square fills the whole picture
 * @returns {'accent' | 'light' | 'none'}
 */
function shapeAt(x, y, corner) {
  if (!insideRoundedSquare(x, y, 32, corner)) return 'none';
  const lines = [
    [16, 6, 16, 26],
    [6, 16, 26, 16],
    [9, 9, 23, 23],
    [23, 9, 9, 23],
  ];
  return lines.some(([x1 = 0, y1 = 0, x2 = 0, y2 = 0]) => distanceToSegment(x, y, x1, y1, x2, y2) <= 1.5) ? 'light' : 'accent';
}

/**
 * @param {number} size
 * @param {{ corner: number, accent: readonly number[] }} drawing — see shapeAt; accent: the square's red, green, blue
 * @returns {Uint8Array} RGBA
 */
function render(size, { corner, accent }) {
  const pixels = new Uint8Array(size * size * 4);
  const samples = 4;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let accentHits = 0;
      let lightHits = 0;
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const shape = shapeAt(((px + (sx + 0.5) / samples) * 32) / size, ((py + (sy + 0.5) / samples) * 32) / size, corner);
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

/**
 * @param {number} size
 * @param {Uint8Array} rgba
 * @param {'rgba' | 'rgb'} format — rgb: without the alpha channel, for a picture that has no transparent pixels
 * @returns {Buffer}
 */
function png(size, rgba, format) {
  const channels = format === 'rgba' ? 4 : 3;
  const rowLength = size * channels + 1; // each row starts with its filter byte, 0 — none
  const rows = Buffer.alloc(size * rowLength);
  for (let pixel = 0; pixel < size * size; pixel++) {
    const at = Math.floor(pixel / size) * rowLength + 1 + (pixel % size) * channels;
    rows.set(rgba.subarray(pixel * 4, pixel * 4 + channels), at);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, format === 'rgba' ? 6 : 2, 0, 0, 0], 8); // 8 bits per channel, colour type (6 — RGBA, 2 — RGB), no interlacing
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
