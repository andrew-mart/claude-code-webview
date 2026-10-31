// @ts-check
// Files for the right-hand panel, opened from a link in Claude's reply: their text — UTF-8, else Windows-1251 — or a
// picture. A document drawn in the panel and what lies beside it come by file-views' folderFileAt (app.js). A text
// edited in the panel is saved over the file, as long as the file is still the one read: its version — a hash of its
// bytes — tells.
import { isUtf8 } from 'node:buffer';
import { createHash } from 'node:crypto';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { decodeText } from 'file-views/server';
import { imageTypeOfPath } from '../public/model/file-ref.js';

/**
 * @typedef {'not-absolute' | 'not-found' | 'not-a-file' | 'too-large' | 'binary'} FileRefusal
 * @typedef {{ ok: true, path: string, content: string, version: string, size: number, modifiedAt: number } | { ok: false, error: FileRefusal }} FileOutcome
 *   — version: the file's as read, for a save to tell it is still the same
 * @typedef {'not-absolute' | 'not-found' | 'not-a-file' | 'too-large' | 'binary' | 'not-utf8' | 'read-only'} SaveRefusal
 *   — not-utf8: the file is in another encoding, a save in UTF-8 would change every letter of it but Latin ones
 * @typedef {{ ok: true, version: string } | { ok: false, error: 'changed', content: string, version: string } | { ok: false, error: SaveRefusal }} SaveOutcome
 *   — changed: the file is no longer the one read — written meanwhile — and is left as it is: here is what it holds now
 * @typedef {{ ok: true, mediaType: string, bytes: Buffer } | { ok: false, error: ImageRefusal }} ImageOutcome
 * @typedef {'not-absolute' | 'not-found' | 'not-a-file' | 'too-large' | 'not-image'} ImageRefusal
 */

/**
 * The file a path names — absolute, or from the home with ~ — if a file is there: the path as found, the file's size.
 * @param {string} requested
 * @param {string} home
 * @returns {Promise<{ ok: true, path: string, size: number, modifiedAt: number } | { ok: false, error: 'not-absolute' | 'not-found' | 'not-a-file' }>}
 */
export async function fileAt(requested, home) {
  const path = /^~[\\/]/.test(requested) ? join(home, requested.slice(2)) : requested;
  if (!isAbsolute(path)) return { ok: false, error: 'not-absolute' };
  const info = await stat(path).catch(() => undefined);
  if (info === undefined) return { ok: false, error: 'not-found' };
  if (!info.isFile()) return { ok: false, error: 'not-a-file' };
  return { ok: true, path, size: info.size, modifiedAt: info.mtimeMs };
}

/** A zero byte near the start of a file marks binary content. */
const sniffBytes = 8192;

/**
 * @param {string} requested — an absolute path from a link, or a path from the home folder (~/…)
 * @param {{ maxBytes: number, home: string }} options
 * @returns {Promise<FileOutcome>}
 */
export async function readTextFile(requested, { maxBytes, home }) {
  const file = await fileUpTo(requested, { maxBytes, home });
  if (!file.ok) return file;
  const bytes = await readFile(file.path);
  if (bytes.subarray(0, sniffBytes).includes(0)) return { ok: false, error: 'binary' };
  return { ok: true, path: file.path, content: decodeText(bytes), version: versionOf(bytes), size: file.size, modifiedAt: file.modifiedAt };
}

/**
 * A picture, with the media type the browser shows it by.
 * @param {string} requested — an absolute path from a link, or a path from the home folder (~/…)
 * @param {{ maxBytes: number, home: string }} options
 * @returns {Promise<ImageOutcome>}
 */
export async function readImageFile(requested, { maxBytes, home }) {
  const file = await fileUpTo(requested, { maxBytes, home });
  if (!file.ok) return file;
  const mediaType = imageTypeOfPath(file.path);
  if (mediaType === undefined) return { ok: false, error: 'not-image' };
  return { ok: true, mediaType, bytes: await readFile(file.path) };
}

/**
 * The file a link points at, when the panel can show it.
 * @param {string} requested
 * @param {{ maxBytes: number, home: string }} options
 * @returns {Promise<{ ok: true, path: string, size: number, modifiedAt: number } | { ok: false, error: 'not-absolute' | 'not-found' | 'not-a-file' | 'too-large' }>}
 */
async function fileUpTo(requested, { maxBytes, home }) {
  const found = await fileAt(requested, home);
  return found.ok && found.size > maxBytes ? { ok: false, error: 'too-large' } : found;
}


/**
 * A text edited in the panel, saved over its file — as UTF-8, with the mark at its head when the file had one.
 * @param {string} requested — an absolute path, or a path from the home folder (~/…)
 * @param {{ content: string, version: string }} edit — version: the file's as the text was read from it
 * @param {{ maxBytes: number, home: string }} options
 * @returns {Promise<SaveOutcome>}
 */
export async function saveTextFile(requested, { content, version }, { maxBytes, home }) {
  const file = await fileUpTo(requested, { maxBytes, home });
  if (!file.ok) return file;
  const bytes = await readFile(file.path);
  if (versionOf(bytes) !== version) return { ok: false, error: 'changed', content: decodeText(bytes), version: versionOf(bytes) };
  if (!isUtf8(bytes)) return { ok: false, error: 'not-utf8' };
  const marked = bytes.subarray(0, utf8Mark.length).equals(utf8Mark);
  const saved = Buffer.concat([marked ? utf8Mark : Buffer.alloc(0), Buffer.from(content, 'utf8')]);
  if (saved.length > maxBytes) return { ok: false, error: 'too-large' };
  const written = await writeFile(file.path, saved).then(
    () => true,
    (error) => {
      // a file marked read-only, another user's, a folder mounted read-only
      if (error instanceof Error && 'code' in error && typeof error.code === 'string' && readOnlyCodes.has(error.code)) return false;
      throw error;
    },
  );
  return written ? { ok: true, version: versionOf(saved) } : { ok: false, error: 'read-only' };
}

const readOnlyCodes = new Set(['EACCES', 'EPERM', 'EROFS']);

const utf8Mark = Buffer.from([0xef, 0xbb, 0xbf]);

/**
 * @param {Buffer} bytes — a file's
 * @returns {string}
 */
function versionOf(bytes) {
  return createHash('sha256').update(bytes).digest('hex').slice(0, 16);
}
