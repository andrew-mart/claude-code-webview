// @ts-check
// The herdr panes whose sessions their user hid from the page's list while idle: hidden until the agent in the pane
// changes state — herdr counts its changes — then shown again. Kept by the viewer in a file, so they stay hidden over a
// restart and on every device.
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { isRecord } from '../public/model/narrow.js';

/** How many panes are kept hidden at most: the ones hidden earliest are let go first. */
const limit = 200;

/**
 * @typedef {Map<string, number | undefined>} Hidden — herdr's count of the agent's changes when its pane was hidden,
 *   by the pane's id; none where herdr tells no count
 */

/**
 * @param {string} file — ~/.claude-code-webview/hidden-panes.json
 */
export function createHiddenPanes(file) {
  /** Read from the file once, then kept here and written back. */
  /** @type {Promise<Hidden> | undefined} */
  let kept;
  /** Changes run one after another, each written after the one before. */
  /** @type {Promise<unknown>} */
  let queue = Promise.resolve();

  /** @param {(hidden: Hidden) => void} change */
  const changeHidden = (change) => {
    const changed = queue.then(async () => {
      kept ??= readHidden(file);
      const hidden = await kept;
      change(hidden);
      await writeHidden(file, hidden);
    });
    queue = changed.catch(() => undefined);
    return changed;
  };

  return {
    /**
     * Hides the pane until its agent changes state.
     * @param {string} pane
     * @param {number | undefined} activity — herdr's count of its agent's changes now; none where herdr tells none
     */
    hide: (pane, activity) =>
      changeHidden((hidden) => {
        // the one hidden last goes last: the earliest hidden are the first let go
        hidden.delete(pane);
        hidden.set(pane, activity);
        for (const earliest of hidden.keys()) {
          if (hidden.size <= limit) break;
          hidden.delete(earliest);
        }
      }),
    /** Shows every pane hidden again. */
    showAll: () => changeHidden((hidden) => hidden.clear()),
    /**
     * The panes hidden now among these: their agents idle or done, not changed state since they were hidden.
     * @param {readonly import('./herdr.js').Pane[]} panes
     * @returns {Promise<ReadonlySet<string>>}
     */
    async hiddenAmong(panes) {
      kept ??= readHidden(file);
      const hidden = await kept;
      const stillHidden = (/** @type {import('./herdr.js').Pane} */ pane) => hidden.has(pane.paneId) && hidden.get(pane.paneId) === pane.activity && (pane.status === 'idle' || pane.status === 'done');
      return new Set(panes.filter(stillHidden).map((pane) => pane.paneId));
    },
  };
}

/**
 * The panes hidden as kept; none kept yet — or the file unreadable — none: a session shown again costs little.
 * @param {string} file
 * @returns {Promise<Hidden>}
 */
async function readHidden(file) {
  const text = await readFile(file, 'utf8').catch(() => undefined);
  if (text === undefined) return new Map();
  /** @type {unknown} */
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    return new Map();
  }
  /** @type {Hidden} */
  const hidden = new Map();
  if (!isRecord(json)) return hidden;
  for (const [pane, count] of Object.entries(json)) {
    if (typeof count === 'number') hidden.set(pane, count);
    // null in the file: herdr told no count
    else if (count === null) hidden.set(pane, undefined);
  }
  return hidden;
}

/**
 * @param {string} file
 * @param {Hidden} hidden
 */
async function writeHidden(file, hidden) {
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(Object.fromEntries([...hidden].map(([pane, count]) => [pane, count === undefined ? null : count]))));
  await rename(temporary, file);
}
