// @ts-check
// Transcripts already read and slimmed for the page. A session opened again — on returning to it, by a second page,
// after a reconnect — is not read and parsed from the start once more: only the lines appended since are. A long
// session is tens of megabytes of JSON, a second or two of work every time otherwise.
import { open, stat } from 'node:fs/promises';
import { linkOf } from './branch.js';
import { liteEntry } from './lite.js';
import { slimEntry } from './slim.js';
import { splitLines } from './tail.js';

const chunkBytes = 4 * 1024 * 1024;

/**
 * @typedef {{ slim: Record<string, unknown> | undefined, link: import('./branch.js').Link }} CachedEntry — slim: what the
 *   page gets up front (lite.js), undefined for records it does not show; link: the entry's place in the conversation,
 *   for every record
 * @typedef {{ scope: 'main' | 'subagent', imageUrl: (lineStart: number, n: number) => string }} Reading
 * @typedef {{ generation: number, offset: number, carry: Buffer, entries: CachedEntry[], calls: Map<string, import('./lite.js').Call>, queue: Promise<unknown> }} FileState — calls: tool calls read whose results have not come yet
 */

/**
 * @param {{ maxFiles: number }} options — how many transcripts stay read; the one opened longest ago goes first
 */
export function createTranscriptCache({ maxFiles }) {
  /** Insertion order is the order of use: the first key is the one used longest ago. */
  /** @type {Map<string, FileState>} */
  const files = new Map();
  let generations = 0;

  /**
   * @param {string} key
   * @returns {FileState}
   */
  const stateOf = (key) => {
    const known = files.get(key);
    const state = known ?? { generation: ++generations, offset: 0, carry: Buffer.alloc(0), entries: [], calls: new Map(), queue: Promise.resolve() };
    files.delete(key);
    files.set(key, state);
    for (const oldest of files.keys()) {
      if (files.size <= maxFiles) break;
      files.delete(oldest);
    }
    return state;
  };

  return {
    /**
     * Everything the file holds now, from its start. The entries list only grows while the generation stays: a file
     * that shrank was rewritten, and is read again under a new generation.
     * @param {string} path
     * @param {Reading} reading
     * @returns {Promise<{ entries: readonly CachedEntry[], generation: number }>}
     */
    read(path, reading) {
      const state = stateOf(`${reading.scope}:${path}`);
      // Two pages reading the same file at once take turns, so no line is read twice.
      const update = state.queue.then(() => catchUp(path, state, reading, () => ++generations));
      state.queue = update.catch(() => undefined);
      return update;
    },
  };
}

/**
 * @param {string} path
 * @param {FileState} state
 * @param {Reading} reading
 * @param {() => number} renew — a generation no file had before
 * @returns {Promise<{ entries: readonly CachedEntry[], generation: number }>}
 */
async function catchUp(path, state, reading, renew) {
  const size = (await stat(path)).size;
  if (size < state.offset) {
    state.generation = renew();
    state.offset = 0;
    state.carry = Buffer.alloc(0);
    state.entries = [];
    state.calls = new Map();
  }
  if (size > state.offset) {
    const read = await readEntries(path, state.offset, size, state.carry, { ...reading, calls: state.calls });
    state.offset = read.offset;
    state.carry = read.carry;
    state.entries.push(...read.entries);
  }
  return { entries: state.entries, generation: state.generation };
}

/**
 * @param {string} path
 * @param {number} from
 * @param {number} to
 * @param {Buffer} carry — the start of a line read before, still without its end
 * @param {Reading & { calls: Map<string, import('./lite.js').Call> }} reading
 * @returns {Promise<{ offset: number, carry: Buffer, entries: CachedEntry[] }>}
 */
async function readEntries(path, from, to, carry, { scope, imageUrl, calls }) {
  const handle = await open(path, 'r');
  let offset = from;
  let rest = carry;
  /** @type {CachedEntry[]} */
  const entries = [];
  try {
    while (offset < to) {
      const chunk = Buffer.alloc(Math.min(chunkBytes, to - offset));
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, offset);
      if (bytesRead === 0) break;
      // the carried start of a line was read before this chunk: line offsets count from it
      const linesStart = offset - rest.length;
      offset += bytesRead;
      const split = splitLines(rest, chunk.subarray(0, bytesRead));
      rest = split.carry;
      for (const line of split.lines) {
        const raw = parseLine(line.text);
        const at = linesStart + line.start;
        const slim = slimEntry(raw, scope, (n) => imageUrl(at, n));
        entries.push({ slim: slim === undefined ? undefined : liteEntry(slim, { at, calls }), link: linkOf(raw) });
      }
    }
  } finally {
    await handle.close();
  }
  return { offset, carry: rest, entries };
}

/**
 * @param {string} line
 * @returns {unknown}
 */
function parseLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    return undefined; // a corrupt line — skip it, the rest of the feed matters more
  }
}
