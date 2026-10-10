// @ts-check
// Bookmarks of all sessions in one file on this computer, so that every device opening the viewer sees the same ones.
// The file: { "<session id>": [bookmark, …] }.
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { changeBookmarks, parseBookmarks } from '../public/model/bookmarks.js';
import { isRecord } from '../public/model/narrow.js';

/**
 * @typedef {import('../public/model/bookmarks.js').Bookmark} Bookmark
 * @typedef {import('../public/model/bookmarks.js').BookmarkChange} BookmarkChange
 * @typedef {{ list: (sessionId: string) => Promise<readonly Bookmark[]>, change: (sessionId: string, change: BookmarkChange) => Promise<readonly Bookmark[]> }} Bookmarks
 */

/**
 * @param {string} file
 * @returns {Bookmarks}
 */
export function createBookmarkFile(file) {
  // Changes run one after another, each on the file the previous one wrote: two devices cannot lose each other's change.
  /** @type {Promise<unknown>} */
  let queue = Promise.resolve();
  return {
    async list(sessionId) {
      return parseBookmarks((await readAll(file))[sessionId]);
    },
    change(sessionId, change) {
      const changed = queue.then(async () => {
        const all = await readAll(file);
        const bookmarks = changeBookmarks(parseBookmarks(all[sessionId]), change);
        const others = Object.entries(all).filter(([id]) => id !== sessionId);
        await writeAtomically(file, Object.fromEntries(bookmarks.length === 0 ? others : [...others, [sessionId, bookmarks]]));
        return bookmarks;
      });
      queue = changed.catch(() => undefined);
      return changed;
    },
  };
}

/**
 * No file — no bookmarks yet. A file that is not a JSON object is an error rather than an empty list:
 * the next change would overwrite it and lose every bookmark in it.
 * @param {string} file
 * @returns {Promise<Record<string, unknown>>}
 */
async function readAll(file) {
  /** @type {string} */
  let source;
  try {
    source = await readFile(file, 'utf8');
  } catch (error) {
    if (isRecord(error) && error.code === 'ENOENT') return {};
    throw new Error(`Cannot read the bookmarks in ${file}`, { cause: error });
  }
  /** @type {unknown} */
  let json;
  try {
    json = JSON.parse(source);
  } catch (error) {
    throw new Error(`The bookmarks file ${file} is not valid JSON; fix or remove it`, { cause: error });
  }
  if (!isRecord(json)) throw new Error(`The bookmarks file ${file} is not a JSON object; fix or remove it`);
  return json;
}

/**
 * A reader never sees a half-written file: the new content is written next to it and then renamed over it.
 * @param {string} file
 * @param {unknown} value
 */
async function writeAtomically(file, value) {
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, file);
}
