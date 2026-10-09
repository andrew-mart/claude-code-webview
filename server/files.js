// @ts-check
// File text for the right-hand panel: opened from a link in Claude's reply.
import { readFile, stat } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

/**
 * @typedef {'not-absolute' | 'not-found' | 'not-a-file' | 'too-large' | 'binary'} FileRefusal
 * @typedef {{ ok: true, path: string, content: string, size: number, modifiedAt: number } | { ok: false, error: FileRefusal }} FileOutcome
 */

/** A zero byte near the start of a file marks binary content. */
const sniffBytes = 8192;

/**
 * @param {string} requested — an absolute path from a link, or a path from the home folder (~/…)
 * @param {{ maxBytes: number, home: string }} options
 * @returns {Promise<FileOutcome>}
 */
export async function readTextFile(requested, { maxBytes, home }) {
  const path = /^~[\\/]/.test(requested) ? join(home, requested.slice(2)) : requested;
  if (!isAbsolute(path)) return { ok: false, error: 'not-absolute' };
  const info = await stat(path).catch(() => undefined);
  if (info === undefined) return { ok: false, error: 'not-found' };
  if (!info.isFile()) return { ok: false, error: 'not-a-file' };
  if (info.size > maxBytes) return { ok: false, error: 'too-large' };
  const bytes = await readFile(path);
  if (bytes.subarray(0, sniffBytes).includes(0)) return { ok: false, error: 'binary' };
  return { ok: true, path, content: bytes.toString('utf8'), size: info.size, modifiedAt: info.mtimeMs };
}
