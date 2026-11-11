// @ts-check
// Where Claude Code sessions ran in herdr, kept after their tabs are closed: to find a session by the workspace and tab
// it was in, and to open it there again.

/**
 * @typedef {{ workspace: string, claudeGpt?: true, tab: string | undefined, earlierTabs: readonly string[], terminal: string | undefined, folder: string | undefined, firstSeen: number | undefined, lastSeen: number | undefined, open: boolean, note: string | undefined }} Place
 *   — tab: the name of the tab the session ran in; none when only its workspace was kept (older viewers); earlierTabs:
 *   names the tab had before; terminal: herdr's id of the terminal of the tab's pane — what tells the tab from others,
 *   its conversations one after another in it; none when older viewers kept it; firstSeen, lastSeen: when the viewer
 *   saw it in a pane first and last, ms; open: it is in a pane now; note: what the session is for, in the user's words
 * @typedef {Readonly<Record<string, Place>>} History — places by session id
 * @typedef {{ id: string, agent: import('./composer.js').Agent, cwd: string | undefined, kind: 'interactive' | 'sdk', modifiedAt: number }} ListedSession
 *   — a session as the session list tells it: whose it is, the folder it ran in, whether someone worked in it or a
 *   script ran it, when it changed last, ms
 */

import { folderKey } from './folders.js';
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
  return { workspace, tab: undefined, earlierTabs: [], terminal: undefined, folder: undefined, firstSeen: undefined, lastSeen: undefined, open: false, note: undefined };
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
    ...(value.claudeGpt === true ? { claudeGpt: /** @type {const} */ (true) } : {}),
    tab: text(value.tab),
    earlierTabs,
    terminal: text(value.terminal),
    folder: text(value.folder),
    firstSeen: typeof value.firstSeen === 'number' ? value.firstSeen : undefined,
    lastSeen: typeof value.lastSeen === 'number' ? value.lastSeen : undefined,
    open: value.open === true,
    note: text(value.note),
  };
}

/**
 * @typedef {{ id: string, place: Place }} Conversation — a session, as one of its tab's conversations
 * @typedef {{ workspace: string, tab: string, conversations: readonly Conversation[] }} ClosedTab — a tab no
 *   conversation runs in now, named as when it was left; its conversations, the latest left first
 */

/**
 * The conversations of the tab a session ran in last: the one running in it now first, then those it went on from,
 * the latest left first. A session kept by an older viewer, with no terminal to tell its tab, is alone in it.
 * @param {History} history
 * @param {string} sessionId
 * @returns {Conversation[]}
 */
export function tabConversations(history, sessionId) {
  const place = history[sessionId];
  if (place === undefined) return [];
  if (place.terminal === undefined) return [{ id: sessionId, place }];
  return Object.entries(history)
    .flatMap(([id, other]) => (other.terminal === place.terminal ? [{ id, place: other }] : []))
    .sort(byLatestLeft);
}

/**
 * The conversation running first, then the latest left; one never seen leaving last.
 * @param {Conversation} a
 * @param {Conversation} b
 */
function byLatestLeft(a, b) {
  return Number(b.place.open) - Number(a.place.open) || (b.place.lastSeen ?? 0) - (a.place.lastSeen ?? 0);
}

/**
 * The tabs no conversation runs in now, the latest closed first. A session kept by an older viewer with no terminal to
 * tell its tab is a tab of its own; one kept with its workspace alone has no tab to open it in again.
 * @param {History} history
 * @returns {ClosedTab[]}
 */
export function closedTabs(history) {
  /** @type {Map<string, Conversation[]>} — by the tab's terminal, or by the session where none tells its tab */
  const tabs = new Map();
  for (const [id, place] of Object.entries(history)) {
    const key = place.terminal === undefined ? `session ${id}` : `terminal ${place.terminal}`;
    tabs.set(key, [...(tabs.get(key) ?? []), { id, place }]);
  }
  return [...tabs.values()]
    .flatMap((conversations) => {
      const sorted = conversations.sort(byLatestLeft);
      const latest = sorted[0]?.place;
      return latest === undefined || latest.open || latest.tab === undefined ? [] : [{ workspace: latest.workspace, tab: latest.tab, conversations: sorted }];
    })
    .sort((a, b) => leftAt(b) - leftAt(a));
}

/**
 * When a closed tab's latest conversation left it; never, for one never seen leaving.
 * @param {ClosedTab} tab
 */
function leftAt(tab) {
  return tab.conversations[0]?.place.lastSeen ?? 0;
}

/**
 * Where a conversation stands in its tab: the one it went on from, and the one its tab runs now, if not this one.
 * @param {History} history
 * @param {string} sessionId
 * @param {(id: string) => boolean} readable — whether the viewer has anything of a session to show
 * @returns {{ earlier: Conversation | undefined, runningNow: Conversation | undefined }}
 */
export function tabNeighbours(history, sessionId, readable) {
  const conversations = tabConversations(history, sessionId);
  const at = conversations.findIndex((conversation) => conversation.id === sessionId);
  const [first] = conversations;
  return {
    earlier: conversations.slice(at + 1).find((conversation) => readable(conversation.id)),
    runningNow: first !== undefined && first.place.open && first.id !== sessionId ? first : undefined,
  };
}

/**
 * @typedef {{ kind: 'conversation', session: string } | { kind: 'latest-in-folder', session: string } | { kind: 'running' } | { kind: 'none' }} TabToContinue
 *   — what a tab with nothing running in it goes on with: a conversation of its own; its folder's latest Claude Code
 *   conversation (claude --continue), the history knowing no tab of its name; nothing, its latest conversation running
 *   now in another tab; or nothing at all, no conversation in its folder either
 */

/**
 * @typedef {{ workspace: string, tab: string, folder: string | undefined }} TabByName — a herdr tab by its workspace's
 *   name and its own, with the folder its first pane is in, as herdr tells it
 */

/**
 * What a tab with nothing running in it goes on with: the conversation that ran last in a tab of its name in its
 * workspace — herdr brings tabs back, as after a restart of the computer, with terminals of their own, their names kept;
 * for a tab the history does not know, its folder's latest Claude Code conversation someone worked in.
 * @param {History} history
 * @param {readonly ListedSession[]} sessions — the session list
 * @param {TabByName} where
 * @returns {TabToContinue}
 */
export function tabToContinue(history, sessions, { workspace, tab, folder }) {
  const [latest] = Object.entries(history)
    .flatMap(([id, place]) => (place.workspace === workspace && place.tab === tab ? [{ id, place }] : []))
    .sort(byLatestLeft);
  if (latest !== undefined) return latest.place.open ? { kind: 'running' } : { kind: 'conversation', session: latest.id };
  const inFolder = folder === undefined ? undefined : latestInFolder(sessions, folder);
  return inFolder === undefined ? { kind: 'none' } : { kind: 'latest-in-folder', session: inFolder };
}

/**
 * The Claude Code conversation claude --continue goes on with in a folder: its latest one there someone worked in.
 * @param {readonly ListedSession[]} sessions
 * @param {string} folder
 * @returns {string | undefined}
 */
function latestInFolder(sessions, folder) {
  const [latest] = sessions.filter((one) => one.agent === 'claude' && one.kind === 'interactive' && one.cwd !== undefined && folderKey(one.cwd) === folderKey(folder)).sort((a, b) => b.modifiedAt - a.modifiedAt);
  return latest?.id;
}
