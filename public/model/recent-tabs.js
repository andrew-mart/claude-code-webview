// @ts-check
// The tabs opened in the page, the latest first — a session, a terminal — for switching back to them as an editor's
// Ctrl+Tab does (view/tab-switcher.js): herdr's tabs, each once, in the order they were opened.
import { placeOf } from './herdr.js';
import { isRecord } from './narrow.js';

/**
 * @typedef {import('./herdr.js').Opened} Opened
 * @typedef {{ place: Opened, workspace: import('./herdr.js').HerdrWorkspace, tab: import('./herdr.js').HerdrTab, pane: import('./herdr.js').HerdrPane }} SwitcherEntry
 *   — a herdr tab to switch to: what of it the page opened last, its workspace, and the pane that holds it — the
 *   session's, the terminal's — to be drawn as the session list draws it
 */

/**
 * @param {readonly Opened[]} recent — the latest first
 * @param {Opened} opened — opened now
 * @param {number} limit — how many are kept
 * @returns {readonly Opened[]}
 */
export function noteOpened(recent, opened, limit) {
  return [opened, ...recent.filter((one) => one.kind !== opened.kind || one.id !== opened.id)].slice(0, limit);
}

/**
 * @param {unknown} stored — what the browser kept
 * @returns {readonly Opened[]}
 */
export function parseRecent(stored) {
  if (!Array.isArray(stored)) return [];
  return stored.flatMap((item) => {
    /** @type {Opened['kind'] | undefined} */
    const kind = isRecord(item) && (item.kind === 'session' || item.kind === 'pane') ? item.kind : undefined;
    return isRecord(item) && typeof item.id === 'string' && kind !== undefined ? [{ kind, id: item.id }] : [];
  });
}

/**
 * herdr's tabs as they were opened, each once — by what of it was opened last — those herdr no longer has left out.
 * @param {readonly Opened[]} recent — the latest first
 * @param {import('./herdr.js').HerdrLayout} layout
 * @returns {readonly SwitcherEntry[]}
 */
export function switcherEntries(recent, layout) {
  /** @type {Set<string>} */
  const listed = new Set();
  return recent.flatMap((place) => {
    const found = placeOf(layout, place);
    const pane = found?.tab.panes.find((one) => (place.kind === 'session' ? one.session === place.id : one.id === place.id));
    if (found === undefined || pane === undefined || listed.has(found.tab.id)) return [];
    listed.add(found.tab.id);
    return [{ place, workspace: found.workspace, tab: found.tab, pane }];
  });
}
