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
 * A queued text as it is told apart from the others: a message from another Claude session is noted with the hops it
 * came by in its opening tag when it is queued, and without them when it is taken.
 * @param {string} queued
 * @returns {string}
 */
function asNoted(queued) {
  return queued.replace(/^(<cross-session-message\b[^>]*?) hop-chain="[^"]*"/, '$1');
}

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
      const at = queue.findIndex((waiting) => asNoted(waiting) === asNoted(content));
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
