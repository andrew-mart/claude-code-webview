// @ts-check
// Lists kept per session in one file on this computer, so that every device opening the viewer sees the same ones —
// the bookmarks, the prompts set aside for later. The file: { "<session id>": [item, …] }.
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { isRecord } from '../public/model/narrow.js';

/**
 * @template Item, Change
 * @typedef {{ list: (sessionId: string) => Promise<readonly Item[]>, change: (sessionId: string, change: Change) => Promise<readonly Item[]> }} SessionLists
 */

/**
 * @template Item, Change
 * @param {{ file: string, what: string, parse: (stored: unknown) => readonly Item[], apply: (list: readonly Item[], change: Change) => readonly Item[] }} kind —
 *   what: the lists' name, as errors tell it; parse: a session's list as stored; apply: a change to it
 * @returns {SessionLists<Item, Change>}
 */
export function createSessionListFile({ file, what, parse, apply }) {
  // Changes run one after another, each on the file the previous one wrote: two devices cannot lose each other's change.
  /** @type {Promise<unknown>} */
  let queue = Promise.resolve();
  return {
    async list(sessionId) {
      return parse((await readAll(file, what))[sessionId]);
    },
    change(sessionId, change) {
      const changed = queue.then(async () => {
        const all = await readAll(file, what);
        const items = apply(parse(all[sessionId]), change);
        const others = Object.entries(all).filter(([id]) => id !== sessionId);
        await writeAtomically(file, Object.fromEntries(items.length === 0 ? others : [...others, [sessionId, items]]));
        return items;
      });
      queue = changed.catch(() => undefined);
      return changed;
    },
  };
}

/**
 * No file — no lists yet. A file that is not a JSON object is an error rather than empty lists: the next change would
 * overwrite it and lose everything in it.
 * @param {string} file
 * @param {string} what
 * @returns {Promise<Record<string, unknown>>}
 */
async function readAll(file, what) {
  /** @type {string} */
  let source;
  try {
    source = await readFile(file, 'utf8');
  } catch (error) {
    if (isRecord(error) && error.code === 'ENOENT') return {};
    throw new Error(`Cannot read the ${what} in ${file}`, { cause: error });
  }
  /** @type {unknown} */
  let json;
  try {
    json = JSON.parse(source);
  } catch (error) {
    throw new Error(`The ${what} file ${file} is not valid JSON; fix or remove it`, { cause: error });
  }
  if (!isRecord(json)) throw new Error(`The ${what} file ${file} is not a JSON object; fix or remove it`);
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
