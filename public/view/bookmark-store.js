// @ts-check
// Session bookmarks in browser storage under the key viewer.bookmarks.<session id>.
import { parseBookmarks, toggleBookmark } from '../model/bookmarks.js';

/**
 * @typedef {import('../model/bookmarks.js').Bookmark} Bookmark
 * @typedef {{ list: () => readonly Bookmark[], has: (id: string) => boolean, toggle: (bookmark: Bookmark) => void, onChange: (listener: () => void) => () => void }} BookmarkStore
 */

/**
 * @param {string} sessionId
 * @returns {BookmarkStore}
 */
export function createBookmarkStore(sessionId) {
  const key = `viewer.bookmarks.${sessionId}`;
  let bookmarks = parseBookmarks(readJson(key));
  /** @type {Set<() => void>} */
  const listeners = new Set();
  return {
    list: () => bookmarks,
    has: (id) => bookmarks.some((bookmark) => bookmark.id === id),
    toggle(bookmark) {
      bookmarks = toggleBookmark(bookmarks, bookmark);
      writeJson(key, bookmarks);
      for (const listener of listeners) listener();
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
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
    return undefined; // storage is unavailable or the record is corrupt — no bookmarks
  }
}

/**
 * @param {string} key
 * @param {unknown} value
 */
function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage is unavailable — bookmarks last until the page reloads
  }
}
