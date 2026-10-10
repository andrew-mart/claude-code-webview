// @ts-check
// Images in transcript entries. The stream sends links instead of their bytes, the page loads an image when it scrolls
// into view, and /api/image finds it again: the n-th image of the entry on the line that starts at a given byte.
import { open } from 'node:fs/promises';
import { isRecord, text } from '../public/model/narrow.js';

/**
 * Only raster images are served: an SVG from the viewer's own address could run a script in its page.
 * @type {ReadonlySet<string>}
 */
const rasterTypes = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const readBytes = 1024 * 1024;
/** A transcript line longer than this is not an entry the stream could have sent. */
const maxLineBytes = 64 * 1024 * 1024;

/**
 * @typedef {{ ok: true, mediaType: string, bytes: Buffer } | { ok: false, error: 'not-found' | 'not-raster' }} ImageOutcome
 */

/**
 * The n-th image of the entry on the transcript line that starts at byte lineStart.
 * @param {string} path
 * @param {number} lineStart
 * @param {number} n
 * @returns {Promise<ImageOutcome>}
 */
export async function readImage(path, lineStart, n) {
  const line = await readLineAt(path, lineStart);
  const entry = line === undefined ? undefined : parse(line);
  /** @type {Record<string, unknown> | undefined} */
  let found;
  if (isRecord(entry) && isRecord(entry.message)) {
    mapImages(entry.message.content, (image, index) => {
      if (index === n) found = image;
      return image;
    });
  }
  const source = isRecord(found) && isRecord(found.source) && found.source.type === 'base64' ? found.source : undefined;
  const mediaType = text(source?.media_type);
  const data = text(source?.data);
  if (mediaType === undefined || data === undefined) return { ok: false, error: 'not-found' };
  if (!rasterTypes.has(mediaType)) return { ok: false, error: 'not-raster' };
  return { ok: true, mediaType, bytes: Buffer.from(data, 'base64') };
}

/**
 * The whole line that starts at the offset; undefined if no line starts there (the offset points inside one).
 * @param {string} path
 * @param {number} lineStart
 * @returns {Promise<string | undefined>}
 */
async function readLineAt(path, lineStart) {
  const handle = await open(path, 'r');
  try {
    if (lineStart > 0) {
      const before = Buffer.alloc(1);
      await handle.read(before, 0, 1, lineStart - 1);
      if (before[0] !== 0x0a) return undefined;
    }
    /** @type {Buffer[]} */
    const parts = [];
    for (let position = lineStart, length = 0; length < maxLineBytes; ) {
      const chunk = Buffer.alloc(readBytes);
      const { bytesRead } = await handle.read(chunk, 0, readBytes, position);
      if (bytesRead === 0) return undefined; // the line is not finished yet — the stream has not sent it
      const end = chunk.subarray(0, bytesRead).indexOf(0x0a);
      parts.push(chunk.subarray(0, end < 0 ? bytesRead : end));
      if (end >= 0) return Buffer.concat(parts).toString('utf8');
      position += bytesRead;
      length += bytesRead;
    }
    return undefined;
  } finally {
    await handle.close();
  }
}

/**
 * @param {string} line
 * @returns {unknown}
 */
function parse(line) {
  try {
    return JSON.parse(line);
  } catch {
    return undefined; // not an entry — there is no image in it
  }
}

/**
 * Calls replace for every image of message content in one fixed order — the content's own blocks and the blocks
 * inside tool results — and returns the content with the images replaced. The stream numbers images in this order
 * and /api/image finds them in the same order.
 * @param {unknown} content — message.content of an entry
 * @param {(image: Record<string, unknown>, n: number) => unknown} replace
 * @returns {unknown}
 */
export function mapImages(content, replace) {
  if (!Array.isArray(content)) return content;
  let n = 0;
  /** @param {unknown} block @returns {unknown} */
  const visit = (block) => {
    if (!isRecord(block)) return block;
    if (block.type === 'image') return replace(block, n++);
    if (block.type === 'tool_result' && Array.isArray(block.content)) return { ...block, content: block.content.map(visit) };
    return block;
  };
  return content.map(visit);
}

/**
 * An image kept as base64 becomes a link to the server; any other block stays as it is.
 * @param {Record<string, unknown>} image
 * @param {string} url
 * @returns {Record<string, unknown>}
 */
export function linkImage(image, url) {
  const { source } = image;
  if (!isRecord(source) || source.type !== 'base64') return image;
  return { ...image, source: { type: 'webview', url, media_type: source.media_type } };
}
