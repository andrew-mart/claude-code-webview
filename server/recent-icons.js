// @ts-check
// The icons put on tabs and workspaces last, the latest first (public/model/recent-icons.js), kept by the viewer so
// every device has them at hand: picked on the phone, first on the computer too. In a file of their own, over a restart.
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { parseIcon } from '../public/model/icon-choice.js';
import { withIconUsed } from '../public/model/recent-icons.js';

/**
 * @param {string} file — ~/.claude-code-webview/recent-icons.json
 * @returns {{ all: () => Promise<string[]>, use: (icon: string) => Promise<void> }} — all: the latest first; use: an
 *   icon put on a tab or a workspace now
 */
export function createRecentIconsFile(file) {
  /** Uses run one after another, each on what the one before wrote. */
  /** @type {Promise<unknown>} */
  let queue = Promise.resolve();
  return {
    all: () => queue.then(() => readRecent(file)),
    use(icon) {
      const changed = queue.then(async () => {
        const recent = withIconUsed(await readRecent(file), icon);
        await mkdir(dirname(file), { recursive: true });
        const temporary = `${file}.${randomUUID()}.tmp`;
        await writeFile(temporary, JSON.stringify(recent));
        await rename(temporary, file);
      });
      queue = changed.catch(() => undefined);
      return changed;
    },
  };
}

/**
 * No file, or one not of icons: none used yet — the picker's usual ones are at hand.
 * @param {string} file
 * @returns {Promise<string[]>}
 */
async function readRecent(file) {
  const text = await readFile(file, 'utf8').catch(() => undefined);
  if (text === undefined) return [];
  try {
    const json = JSON.parse(text);
    return Array.isArray(json) ? json.filter((icon) => typeof icon === 'string' && parseIcon(icon) !== undefined) : [];
  } catch {
    return [];
  }
}
