// @ts-check
// Each herdr workspace's icon — an emoji, or one of Lucide's (model/icon-choice.js): the emoji ahead of its name, which
// its user put there; else the one its folder had before — one picked by hand among them; else one picked at random
// among those no other workspace has. Each is remembered for the workspace's folder, kept in a file: a workspace opened
// there later gets it too.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { isRecord } from '../public/model/narrow.js';
import { splitTabIcon, workspaceIcons } from '../public/model/tab-icon.js';
import { folderKey } from './folders.js';

/**
 * @typedef {{ id: string, label: string, folder: string | undefined }} IconedWorkspace — a workspace, its name as herdr
 *   has it and its folder: the one its first tab's pane opened in; none without a pane
 */

/**
 * @param {{ file: string, random: () => number }} deps — file: where the folders' icons are kept; random: a number in
 *   [0, 1), which icon a workspace without one gets
 */
export function createWorkspaceIcons({ file, random }) {
  /** @type {Promise<Map<string, string>> | undefined} */
  let kept;
  /** A workspace with no folder — no pane — keeps its random icon by its id while the viewer runs. */
  /** @type {Map<string, string>} */
  const byId = new Map();

  /** @param {ReadonlySet<string>} taken */
  const pick = (taken) => {
    const free = workspaceIcons.filter((icon) => !taken.has(icon));
    const pool = free.length > 0 ? free : workspaceIcons;
    const icon = pool[Math.floor(random() * pool.length)];
    if (icon === undefined) throw new Error(`No icon at ${pool.length} to pick from`);
    return icon;
  };

  return {
    /**
     * An icon picked by hand for a folder's workspaces — one a name cannot hold, Lucide's — or taken back: none, and the
     * folder gets one at random again.
     * @param {string} folder
     * @param {string | undefined} icon — as kept (model/icon-choice.js)
     */
    async setIcon(folder, icon) {
      kept ??= readIcons(file);
      const byFolder = await kept;
      if (icon === undefined) byFolder.delete(folderKey(folder));
      else byFolder.set(folderKey(folder), icon);
      await writeIcons(file, byFolder);
    },
    /**
     * @param {readonly IconedWorkspace[]} workspaces
     * @returns {Promise<Map<string, string>>} — each workspace's icon, by its id, in their order
     */
    async iconsOf(workspaces) {
      kept ??= readIcons(file);
      const byFolder = await kept;
      const before = JSON.stringify([...byFolder]);
      /** @param {IconedWorkspace} workspace */
      const known = (workspace) => splitTabIcon(workspace.label).icon ?? (workspace.folder === undefined ? byId.get(workspace.id) : byFolder.get(folderKey(workspace.folder)));
      // the ones their users chose, and their folders', first: one picked at random is to differ from them
      const found = new Map(workspaces.flatMap((workspace) => {
        const icon = known(workspace);
        return icon === undefined ? [] : [/** @type {const} */ ([workspace.id, icon])];
      }));
      for (const workspace of workspaces) {
        // one picked for another workspace of its folder on this look is the folder's
        const icon = found.get(workspace.id) ?? known(workspace) ?? pick(new Set(found.values()));
        found.set(workspace.id, icon);
        if (workspace.folder === undefined) byId.set(workspace.id, icon);
        else byFolder.set(folderKey(workspace.folder), icon);
      }
      if (JSON.stringify([...byFolder]) !== before) await writeIcons(file, byFolder);
      return new Map(workspaces.flatMap((workspace) => {
        const icon = found.get(workspace.id);
        return icon === undefined ? [] : [/** @type {const} */ ([workspace.id, icon])];
      }));
    },
  };
}

/**
 * The folders' icons as kept; none kept yet — or the file unreadable — none.
 * @param {string} file
 * @returns {Promise<Map<string, string>>}
 */
async function readIcons(file) {
  const text = await readFile(file, 'utf8').catch(() => undefined);
  if (text === undefined) return new Map();
  /** @type {unknown} */
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    return new Map();
  }
  return new Map(isRecord(json) ? Object.entries(json).flatMap(([folder, icon]) => (typeof icon === 'string' ? [/** @type {const} */ ([folder, icon])] : [])) : []);
}

/**
 * @param {string} file
 * @param {ReadonlyMap<string, string>} icons — by folder
 */
async function writeIcons(file, icons) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(Object.fromEntries(icons), null, 2)}\n`);
}
