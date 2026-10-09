// @ts-check
// Bookmarks on feed messages and labels of outline items.
import { isRecord, text } from './narrow.js';

/**
 * @typedef {'prompt' | 'answer' | 'report'} AnchorKind
 * @typedef {{ id: string, kind: AnchorKind, label: string, at: string }} Bookmark
 */

/**
 * @param {readonly Bookmark[]} list
 * @param {Bookmark} candidate
 * @returns {readonly Bookmark[]}
 */
export function toggleBookmark(list, candidate) {
  if (list.some((bookmark) => bookmark.id === candidate.id)) return list.filter((bookmark) => bookmark.id !== candidate.id);
  // Bookmarks follow the order of messages in the feed, not the order in which they were added.
  return [...list, candidate].sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
}

/**
 * Bookmarks from browser storage: entries of any other shape (an old version, a manual edit) are dropped.
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
