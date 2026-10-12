// @ts-check
// Where Claude Code sessions ran in herdr, kept after their tabs are closed: to find a session by the workspace and tab
// it was in, and to open it there again.

/**
 * @typedef {{ workspace: string, tab: string | undefined, earlierTabs: readonly string[], folder: string | undefined, firstSeen: number | undefined, lastSeen: number | undefined, open: boolean, note: string | undefined }} Place
 *   — tab: the name of the tab the session ran in; none when only its workspace was kept (older viewers); earlierTabs:
 *   names the tab had before; firstSeen, lastSeen: when the viewer saw it in a pane first and last, ms; open: it is in
 *   a pane now; note: what the session is for, in the user's words
 * @typedef {Readonly<Record<string, Place>>} History — places by session id
 */

import { isRecord, text } from './narrow.js';

/**
 * The history as the viewer keeps it in its file and tells it to the page; a session older viewers kept with its
 * workspace alone is a place without a tab.
 * @param {unknown} json
 * @returns {History}
 */
export function parseHistory(json) {
  if (!isRecord(json)) return {};
  return Object.fromEntries(
    Object.entries(json).flatMap(([session, value]) => {
      const place = typeof value === 'string' ? workspaceOnly(value) : placeOf(value);
      return place === undefined ? [] : [[session, place]];
    }),
  );
}

/**
 * @param {string} workspace
 * @returns {Place}
 */
function workspaceOnly(workspace) {
  return { workspace, tab: undefined, earlierTabs: [], folder: undefined, firstSeen: undefined, lastSeen: undefined, open: false, note: undefined };
}

/**
 * @param {unknown} value
 * @returns {Place | undefined}
 */
function placeOf(value) {
  if (!isRecord(value)) return undefined;
  const workspace = text(value.workspace);
  if (workspace === undefined) return undefined;
  const earlierTabs = Array.isArray(value.earlierTabs) ? value.earlierTabs.flatMap((name) => (typeof name === 'string' ? [name] : [])) : [];
  return {
    workspace,
    tab: text(value.tab),
    earlierTabs,
    folder: text(value.folder),
    firstSeen: typeof value.firstSeen === 'number' ? value.firstSeen : undefined,
    lastSeen: typeof value.lastSeen === 'number' ? value.lastSeen : undefined,
    open: value.open === true,
    note: text(value.note),
  };
}
