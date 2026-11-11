// @ts-check
// The herdr workspaces their user hid from the page's list, to keep them open out of the way: each by its id — herdr
// keeps a workspace's id over its restarts, and two workspaces open in one folder have their own — kept by the viewer in
// a file, so they stay hidden over a restart of herdr or the viewer and on every device, until shown again.
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * @param {string} file — ~/.claude-code-webview/hidden-workspaces.json
 */
export function createHiddenWorkspaces(file) {
  /** The workspaces hidden, by id: read from the file once, then kept here and written back. */
  /** @type {Promise<Set<string>> | undefined} */
  let kept;
  /** Changes run one after another, each written after the one before. */
  /** @type {Promise<unknown>} */
  let queue = Promise.resolve();

  /** @param {(hidden: Set<string>) => void} change */
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
     * Hides the workspace.
     * @param {string} workspaceId
     */
    hide: (workspaceId) =>
      changeHidden((hidden) => {
        hidden.add(workspaceId);
      }),
    /**
     * Shows the workspace again.
     * @param {string} workspaceId
     */
    show: (workspaceId) =>
      changeHidden((hidden) => {
        hidden.delete(workspaceId);
      }),
    /**
     * The workspaces hidden among these.
     * @param {readonly string[]} workspaceIds
     * @returns {Promise<ReadonlySet<string>>}
     */
    async hiddenAmong(workspaceIds) {
      kept ??= readHidden(file);
      const hidden = await kept;
      return new Set(workspaceIds.filter((id) => hidden.has(id)));
    },
  };
}

/**
 * The workspaces hidden as kept; none kept yet — or the file unreadable — none: a workspace shown again costs little.
 * @param {string} file
 * @returns {Promise<Set<string>>}
 */
async function readHidden(file) {
  const text = await readFile(file, 'utf8').catch(() => undefined);
  if (text === undefined) return new Set();
  /** @type {unknown} */
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    return new Set();
  }
  return new Set(Array.isArray(json) ? json.filter((id) => typeof id === 'string') : []);
}

/**
 * @param {string} file
 * @param {ReadonlySet<string>} hidden
 */
async function writeHidden(file, hidden) {
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify([...hidden]));
  await rename(temporary, file);
}
