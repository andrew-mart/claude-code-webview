// @ts-check
// Session bookmarks kept by the viewer's server (~/.claude-code-webview/bookmarks.json): every device sees the same ones.
import { changeBookmarks, parseBookmarks } from '../model/bookmarks.js';

/**
 * @typedef {import('../model/bookmarks.js').Bookmark} Bookmark
 * @typedef {import('../model/bookmarks.js').BookmarkChange} BookmarkChange
 * @typedef {{ list: () => readonly Bookmark[], has: (id: string) => boolean, toggle: (bookmark: Bookmark) => void, onChange: (listener: () => void) => () => void, dispose: () => void }} BookmarkStore
 */

/**
 * A change shows at once; the server's reply then replaces the list. Coming back to the window reloads the list,
 * so bookmarks made on another device appear.
 * @param {string} sessionId
 * @returns {BookmarkStore}
 */
export function createBookmarkStore(sessionId) {
  /** @type {readonly Bookmark[]} */
  let bookmarks = [];
  /** @type {Set<() => void>} */
  const listeners = new Set();
  /** @param {readonly Bookmark[]} next */
  const show = (next) => {
    bookmarks = next;
    for (const listener of listeners) listener();
  };
  const load = async () => {
    const response = await fetch(`/api/bookmarks?session=${sessionId}`).catch(() => undefined);
    if (response?.ok) show(parseBookmarks(await response.json()));
  };
  const reload = () => void load();
  window.addEventListener('focus', reload);
  reload();
  return {
    list: () => bookmarks,
    has: (id) => bookmarks.some((bookmark) => bookmark.id === id),
    toggle(bookmark) {
      /** @type {BookmarkChange} */
      const change = this.has(bookmark.id) ? { action: 'remove', id: bookmark.id } : { action: 'add', bookmark };
      show(changeBookmarks(bookmarks, change));
      void sendChange(sessionId, change).then((saved) => (saved === undefined ? load() : show(saved)));
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      window.removeEventListener('focus', reload);
      listeners.clear();
    },
  };
}

/**
 * Bookmarks this browser kept itself before they moved to the server: each session's are sent to the server
 * and, once it has them, removed from the browser.
 * @returns {Promise<void>}
 */
export async function moveLocalBookmarksToServer() {
  for (const key of localKeys()) {
    const sessionId = /^viewer\.bookmarks\.(.+)$/.exec(key)?.[1];
    if (sessionId === undefined) continue;
    const results = await Promise.all(parseBookmarks(readJson(key)).map((bookmark) => sendChange(sessionId, { action: 'add', bookmark })));
    if (results.every((saved) => saved !== undefined)) removeKey(key);
  }
}

/**
 * @param {string} sessionId
 * @param {BookmarkChange} change
 * @returns {Promise<readonly Bookmark[] | undefined>} — the session's bookmarks after the change; undefined if the server did not take it
 */
async function sendChange(sessionId, change) {
  const response = await fetch('/api/bookmarks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Viewer': '1' },
    body: JSON.stringify({ session: sessionId, change }),
  }).catch(() => undefined);
  return response?.ok ? parseBookmarks(await response.json()) : undefined;
}

/** @returns {string[]} */
function localKeys() {
  try {
    return Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index) ?? '');
  } catch {
    return []; // storage is unavailable — nothing to move
  }
}

/**
 * @param {string} key
 * @returns {unknown}
 */
function readJson(key) {
  try {
    const stored = localStorage.getItem(key);
    return stored === null ? undefined : JSON.parse(stored);
  } catch {
    return undefined; // the record is corrupt — nothing to move
  }
}

/** @param {string} key */
function removeKey(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    // storage is unavailable — the bookmarks are sent again next time, which changes nothing
  }
}
