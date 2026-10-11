// @ts-check
// Prompts waiting in Claude Code's queue. A prompt sent while Claude works waits there until the turn ends, or until
// Claude takes it in the middle of the turn, and only then shows up in the transcript as a message. Claude Code notes
// the queue itself as it goes, in queue-operation records: enqueue with the text; dequeue — the oldest taken; remove
// with the text — that one taken in mid-turn or back into the input box; popAll — all taken back.
import { isRecord, text } from './narrow.js';

/** @typedef {readonly string[]} Queue — the texts waiting, oldest first; '' — a prompt of images only */

/** Claude Code's notes on finished background tasks wait in the same line. */
const backgroundTaskNote = '<task-notification>';

/**
 * @param {Queue} queue — waiting before this entry
 * @param {unknown} entry — a transcript entry after the server filter
 * @returns {Queue}
 */
export function queueAfter(queue, entry) {
  if (!isRecord(entry) || entry.type !== 'queue-operation') return queue;
  const content = text(entry.content) ?? '';
  switch (entry.operation) {
    case 'enqueue':
      return [...queue, content];
    case 'dequeue':
      return queue.slice(1);
    case 'remove': {
      const at = queue.indexOf(content);
      return at < 0 ? queue : queue.toSpliced(at, 1);
    }
    case 'popAll':
      return [];
    default:
      return queue;
  }
}

/**
 * What of the queue the page shows: the prompts the user sent, not the notes on background tasks.
 * @param {Queue} queue
 * @returns {readonly string[]}
 */
export function waitingPrompts(queue) {
  return queue.filter((waiting) => !waiting.startsWith(backgroundTaskNote));
}
