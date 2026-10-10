// @ts-check
// Bookmarks on feed messages and labels of outline items.
import { isRecord, text } from './narrow.js';

/**
 * @typedef {'prompt' | 'answer' | 'report'} AnchorKind
 * @typedef {{ id: string, kind: AnchorKind, label: string, at: string }} Bookmark
 * @typedef {{ action: 'add', bookmark: Bookmark } | { action: 'remove', id: string }} BookmarkChange
 */

/**
 * Bookmarks from stored JSON (the server file, old browser storage): entries of any other shape are dropped.
 * @param {unknown} stored — result of JSON.parse
 * @returns {readonly Bookmark[]}
 */
export function parseBookmarks(stored) {
  if (!Array.isArray(stored)) return [];
  return stored.filter(isRecord).flatMap((item) => {
    const id = text(item.id);
    const kind = anchorKind(item.kind);
    const label = text(item.label);
    const at = text(item.at);
    return id === undefined || kind === undefined || label === undefined || at === undefined ? [] : [{ id, kind, label, at }];
  });
}

/**
 * @param {unknown} value
 * @returns {AnchorKind | undefined}
 */
function anchorKind(value) {
  switch (value) {
    case 'prompt':
    case 'answer':
    case 'report':
      return value;
    default:
      return undefined;
  }
}

const maxLabelLength = 80;

/**
 * A message label in the outline: the first non-empty line without markdown markup, truncated if long.
 * @param {string} source — prompt text or answer markdown
 * @returns {string}
 */
export function anchorLabel(source) {
  const line = source.split('\n').find((candidate) => candidate.trim() !== '') ?? '';
  const plain = line
    .replace(/^\s*#{1,6}\s+/, '') // heading
    .replace(/^\s*(?:[-*+]|\d+\.)\s+/, '') // list item
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // link → its text
    .replace(/\*\*|\*|`/g, '') // bold, italic, code; underscores are kept — they occur in names (file_path)
    .trim();
  return plain.length > maxLabelLength ? `${plain.slice(0, maxLabelLength)}…` : plain;
}

/**
 * The change is stated explicitly, not as a toggle: when two devices send the same change, the second one keeps the result.
 * @param {readonly Bookmark[]} list
 * @param {BookmarkChange} change
 * @returns {readonly Bookmark[]}
 */
export function changeBookmarks(list, change) {
  switch (change.action) {
    case 'add':
      if (list.some((bookmark) => bookmark.id === change.bookmark.id)) return list;
      // Bookmarks follow the order of messages in the feed, not the order in which they were added.
      return [...list, change.bookmark].sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
    case 'remove':
      return list.filter((bookmark) => bookmark.id !== change.id);
    default:
      return exhaustive(change);
  }
}

/**
 * A change sent by the page; anything of another shape — undefined.
 * @param {unknown} value — from the request's JSON
 * @returns {BookmarkChange | undefined}
 */
export function parseBookmarkChange(value) {
  if (!isRecord(value)) return undefined;
  if (value.action === 'remove' && typeof value.id === 'string') return { action: 'remove', id: value.id };
  const [bookmark] = value.action === 'add' ? parseBookmarks([value.bookmark]) : [];
  return bookmark === undefined ? undefined : { action: 'add', bookmark };
}

/**
 * @param {never} value
 * @returns {never}
 */
function exhaustive(value) {
  throw new Error(`Unexpected bookmark change ${JSON.stringify(value)}`);
}
