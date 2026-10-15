// @ts-check
// The answers seen — herdr's finished agents whose session or terminal a page opened (public/model/lamps.js) — kept by
// the viewer, so what one device saw counts on every other: the phone does not light up what the computer has seen.
// In a file of its own, over a restart; the latest of each agent's, at most so many, the earliest seen let go first.
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * @param {string} file — ~/.claude-code-webview/seen.json
 * @param {{ limit: number }} options — limit: how many agents it keeps at most
 * @returns {{ all: () => Promise<Record<string, number>>, mark: (pane: string, count: number) => Promise<void> }} —
 *   mark: the pane's answer seen at herdr's count of its changes
 */
export function createSeenFile(file, { limit }) {
  /** Marks run one after another, each on what the one before wrote. */
  /** @type {Promise<unknown>} */
  let queue = Promise.resolve();
  return {
    all: () => queue.then(() => readSeen(file)),
    mark(pane, count) {
      const marked = queue.then(async () => {
        const seen = await readSeen(file);
        // the one seen last goes last: the earliest seen are the first let go
        delete seen[pane];
        const kept = Object.entries({ ...seen, [pane]: count }).slice(-limit);
        await mkdir(dirname(file), { recursive: true });
        const temporary = `${file}.${randomUUID()}.tmp`;
        await writeFile(temporary, JSON.stringify(Object.fromEntries(kept)));
        await rename(temporary, file);
      });
      queue = marked.catch(() => undefined);
      return marked;
    },
  };
}

/**
 * No file, or one not of answers seen: nothing seen — a lamp lit again costs little.
 * @param {string} file
 * @returns {Promise<Record<string, number>>}
 */
async function readSeen(file) {
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
