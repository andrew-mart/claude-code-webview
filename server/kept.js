// @ts-check
// The agents kept lit to come back to (public/model/lamps.js: keptLit), kept by the viewer so every device shows them:
// marked on the phone, lit on the computer too, until a page takes the mark off. In a file of their own, over a
// restart; at most so many, the earliest marked let go first.
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * @param {string} file — ~/.claude-code-webview/kept.json
 * @param {{ limit: number }} options — limit: how many agents it keeps marked at most
 * @returns {{ all: () => Promise<Record<string, number>>, set: (pane: string, count: number | undefined) => Promise<void> }} —
 *   set: the pane's agent marked at herdr's count of its changes, or its mark taken off
 */
export function createKeptFile(file, { limit }) {
  /** Marks run one after another, each on what the one before wrote. */
  /** @type {Promise<unknown>} */
  let queue = Promise.resolve();
  return {
    all: () => queue.then(() => readKept(file)),
    set(pane, count) {
      const changed = queue.then(async () => {
        const kept = await readKept(file);
        // the one marked last goes last: the earliest marked are the first let go
        delete kept[pane];
        const marks = Object.entries(count === undefined ? kept : { ...kept, [pane]: count }).slice(-limit);
        await mkdir(dirname(file), { recursive: true });
        const temporary = `${file}.${randomUUID()}.tmp`;
        await writeFile(temporary, JSON.stringify(Object.fromEntries(marks)));
        await rename(temporary, file);
      });
      queue = changed.catch(() => undefined);
      return changed;
    },
  };
}

/**
 * No file, or one not of marks: nothing kept lit — a lamp out costs little.
 * @param {string} file
 * @returns {Promise<Record<string, number>>}
 */
async function readKept(file) {
  const text = await readFile(file, 'utf8').catch(() => undefined);
  const json = text === undefined ? undefined : parsed(text);
  if (json === null || typeof json !== 'object' || Array.isArray(json)) return {};
  return Object.fromEntries(Object.entries(json).flatMap(([pane, count]) => (typeof count === 'number' ? [[pane, count]] : [])));
}

/**
 * @param {string} text
 * @returns {unknown}
 */
function parsed(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
