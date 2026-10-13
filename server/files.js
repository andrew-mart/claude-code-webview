// @ts-check
// Files for the right-hand panel, opened from a link in Claude's reply: their text — UTF-8, else Windows-1251 — or a
// picture. A document drawn in the panel and what lies beside it come by file-views' folderFileAt (app.js).
import { readFile, stat } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { decodeText } from 'file-views/server';
import { imageTypeOfPath } from '../public/model/file-ref.js';

/**
 * @typedef {'not-absolute' | 'not-found' | 'not-a-file' | 'too-large' | 'binary'} FileRefusal
 * @typedef {{ ok: true, path: string, content: string, size: number, modifiedAt: number } | { ok: false, error: FileRefusal }} FileOutcome
 * @typedef {{ ok: true, mediaType: string, bytes: Buffer } | { ok: false, error: ImageRefusal }} ImageOutcome
 * @typedef {'not-absolute' | 'not-found' | 'not-a-file' | 'too-large' | 'not-image'} ImageRefusal
 */

/** A zero byte near the start of a file marks binary content. */
const sniffBytes = 8192;

/**
 * @param {string} requested — an absolute path from a link, or a path from the home folder (~/…)
 * @param {{ maxBytes: number, home: string }} options
 * @returns {Promise<FileOutcome>}
 */
export async function readTextFile(requested, { maxBytes, home }) {
  const file = await fileAt(requested, { maxBytes, home });
  if (!file.ok) return file;
  const bytes = await readFile(file.path);
  if (bytes.subarray(0, sniffBytes).includes(0)) return { ok: false, error: 'binary' };
  return { ok: true, path: file.path, content: decodeText(bytes), size: file.size, modifiedAt: file.modifiedAt };
}

/**
 * A picture, with the media type the browser shows it by.
 * @param {string} requested — an absolute path from a link, or a path from the home folder (~/…)
 * @param {{ maxBytes: number, home: string }} options
 * @returns {Promise<ImageOutcome>}
 */
export async function readImageFile(requested, { maxBytes, home }) {
  const file = await fileAt(requested, { maxBytes, home });
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
async function fileAt(requested, { maxBytes, home }) {
  const path = /^~[\\/]/.test(requested) ? join(home, requested.slice(2)) : requested;
  if (!isAbsolute(path)) return { ok: false, error: 'not-absolute' };
  const info = await stat(path).catch(() => undefined);
  if (info === undefined) return { ok: false, error: 'not-found' };
  if (!info.isFile()) return { ok: false, error: 'not-a-file' };
  if (info.size > maxBytes) return { ok: false, error: 'too-large' };
  return { ok: true, path, size: info.size, modifiedAt: info.mtimeMs };
}

