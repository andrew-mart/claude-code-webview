// @ts-check
// Files for the right-hand panel, opened from a link in Claude's reply: their text, a picture, or a file beside a
// document drawn in the panel.
import { readFile, realpath, stat } from 'node:fs/promises';
import { extname, isAbsolute, join, relative as relativePath, resolve } from 'node:path';
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
 * UTF-8 — its mark at the head dropped — and what is not: Windows-1251, the old Russian text files.
 * @param {Buffer} bytes
 */
function decodeText(bytes) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1251').decode(bytes);
  }
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

/** Media types of what a page drawn in the panel loads beside it, and of the documents themselves. */
/** @type {ReadonlyMap<string, string>} */
const mediaTypes = new Map([
  ['.html', 'text/html'],
  ['.htm', 'text/html'],
  ['.css', 'text/css'],
  ['.js', 'text/javascript'],
  ['.mjs', 'text/javascript'],
  ['.json', 'application/json'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
  ['.ico', 'image/x-icon'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
  ['.ttf', 'font/ttf'],
  ['.otf', 'font/otf'],
  ['.pdf', 'application/pdf'],
  ['.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ['.mp4', 'video/mp4'],
  ['.webm', 'video/webm'],
  ['.mp3', 'audio/mpeg'],
  ['.txt', 'text/plain'],
]);

/**
 * @typedef {'not-absolute' | 'not-found' | 'not-a-file' | 'too-large' | 'outside'} FolderFileRefusal
 * @typedef {{ ok: true, path: string, size: number, mediaType: string } | { ok: false, error: FolderFileRefusal }} FolderFileOutcome
 */

/**
 * A file in a document's folder or below it, for a document drawn in the panel — a page, a PDF — and what it loads
 * beside it. Nothing outside the folder: no .. steps out, no absolute path, no link in the folder that leads out.
 * @param {string} folder — the document's folder, absolute
 * @param {string} relative — the file's path from it
 * @param {{ maxBytes: number }} options
 * @returns {Promise<FolderFileOutcome>}
 */
export async function folderFileAt(folder, relative, { maxBytes }) {
  if (!isAbsolute(folder)) return { ok: false, error: 'not-absolute' };
  const path = resolve(folder, relative);
  if (!isInside(folder, path)) return { ok: false, error: 'outside' };
  const info = await stat(path).catch(() => undefined);
  if (info === undefined) return { ok: false, error: 'not-found' };
  if (!info.isFile()) return { ok: false, error: 'not-a-file' };
  const [realFolder, realPath] = await Promise.all([realpath(folder), realpath(path)]);
  if (!isInside(realFolder, realPath)) return { ok: false, error: 'outside' };
  if (info.size > maxBytes) return { ok: false, error: 'too-large' };
  return { ok: true, path, size: info.size, mediaType: mediaTypes.get(extname(path).toLowerCase()) ?? 'application/octet-stream' };
}

/**
 * @param {string} folder
 * @param {string} path
 */
function isInside(folder, path) {
  const steps = relativePath(folder, path);
  return steps !== '' && !steps.startsWith('..') && !isAbsolute(steps);
}
