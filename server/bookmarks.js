// @ts-check
// Bookmarks of all sessions in one file on this computer, so that every device opening the viewer sees the same ones.
import { changeBookmarks, parseBookmarks } from '../public/model/bookmarks.js';
import { createSessionListFile } from './session-lists.js';

/**
 * @typedef {import('../public/model/bookmarks.js').Bookmark} Bookmark
 * @typedef {import('../public/model/bookmarks.js').BookmarkChange} BookmarkChange
 * @typedef {import('./session-lists.js').SessionLists<Bookmark, BookmarkChange>} Bookmarks
 */

/**
 * @param {string} file
 * @returns {Bookmarks}
 */
export function createBookmarkFile(file) {
  return createSessionListFile({ file, what: 'bookmarks', parse: parseBookmarks, apply: changeBookmarks });
}
