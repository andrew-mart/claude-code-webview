// @ts-check
// Transcripts already read and slimmed for the page. A session opened again — on returning to it, by a second page,
// after a reconnect — is not read and parsed from the start once more: only the lines appended since are. A long
// session is tens of megabytes of JSON, a second or two of work every time otherwise. A Codex session's file is read as
// Claude Code's records (codex.js), in turn, from where its reading stopped; a Codex session that went on in more files
// is read as them in turn (joined.js).
import { linkOf } from './branch.js';
import { createCodexReading } from './codex.js';
import { openJoined } from './joined.js';
import { liteEntry } from './lite.js';
import { slimEntry } from './slim.js';
import { splitLines } from './tail.js';
import { createTaskTracker } from './tasks.js';

const chunkBytes = 4 * 1024 * 1024;
/** How many of the last bytes read are kept to tell the file still holds them where they were. */
const seenBytes = 64;

/**
 * @typedef {{ slim: Record<string, unknown> | undefined, link: import('./branch.js').Link, at: number }} CachedEntry — slim: what
 *   the page gets up front (lite.js), undefined for records it does not show; link: the entry's place in the
 *   conversation, for every record; at: where its line starts in the transcript
 * @typedef {{ scope: 'main' | 'subagent', imageUrl: (lineStart: number, n: number) => string }} Reading
 * @typedef {ReturnType<typeof createTaskTracker>} TaskTracker
 * @typedef {{ generation: number, offset: number, carry: Buffer, seen: Buffer, entries: CachedEntry[], calls: Map<string, import('./lite.js').Call>, tasks: TaskTracker, codex: ReturnType<typeof createCodexReading> | undefined, layout: string | undefined, queue: Promise<unknown> }} FileState — calls: tool calls read whose results have not come yet;
 *   tasks: the work the session started in the background, followed as its entries are read; seen: the last bytes
 *   read, up to offset — a file that no longer holds them there was rewritten; codex: the reading of a
 *   Codex session's file, none for Claude Code's; layout: the files the transcript was read from, each to where — none
 *   before the first reading
 * @typedef {(path: string) => Promise<readonly import('./joined.js').Part[]>} PartsOf
 */

/**
 * @param {{ maxFiles: number, agentOf?: (path: string) => import('./sessions.js').Agent, partsOf?: PartsOf }} options —
 *   maxFiles: how many transcripts stay read, the one opened longest ago goes first — but not one a page keeps (keep);
 *   agentOf: whose session a file is —
 *   Claude Code's when not told; partsOf: the files a session's transcript is read from — the file alone when not told
 */
export function createTranscriptCache({ maxFiles, agentOf = () => 'claude', partsOf = async (path) => [{ path, end: undefined }] }) {
  /** Insertion order is the order of use: the first key is the one used longest ago. */
  /** @type {Map<string, FileState>} */
  const files = new Map();
  /** One for every page keeping a file read: the file's key. */
  /** @type {Set<{ key: string }>} */
  const keepers = new Set();
  let generations = 0;

  /**
   * @param {string} key
   * @param {string} path
   * @returns {FileState}
   */
  const stateOf = (key, path) => {
    const known = files.get(key);
    const state = known ?? { generation: ++generations, offset: 0, carry: Buffer.alloc(0), seen: Buffer.alloc(0), entries: [], calls: new Map(), tasks: createTaskTracker(), codex: codexReadingOf(path), layout: undefined, queue: Promise.resolve() };
    files.delete(key);
    files.set(key, state);
    for (const oldest of files.keys()) {
      if (files.size <= maxFiles) break;
      if (![...keepers].some(({ key }) => key === oldest)) files.delete(oldest);
    }
    return state;
  };

  /** @param {string} path */
  const codexReadingOf = (path) => (agentOf(path) === 'codex' ? createCodexReading() : undefined);

  return {
    /**
     * Everything the file holds now, from its start. The entries list only grows while the generation stays: a file
     * that shrank was rewritten, and is read again under a new generation.
     * @param {string} path
     * @param {Reading} reading
     * @returns {Promise<{ entries: readonly CachedEntry[], generation: number, tasks: TaskTracker }>}
     */
    read(path, reading) {
      const state = stateOf(`${reading.scope}:${path}`, path);
      // Two pages reading the same file at once take turns, so no line is read twice.
      const update = state.queue.then(async () => catchUp(await partsOf(path), state, reading, () => ++generations, () => codexReadingOf(path)));
      state.queue = update.catch(() => undefined);
      return update;
    },

    /**
     * Keeps the file read while a page follows it: reading others does not push it out, however many. Kept while any
     * page that kept it has not let it go.
     * @param {string} path
     * @param {Reading['scope']} scope
     * @returns {() => void} lets the file go
     */
    keep(path, scope) {
      const keeper = { key: `${scope}:${path}` };
      keepers.add(keeper);
      return () => {
        keepers.delete(keeper);
      };
    },
  };
}

/**
 * @param {readonly import('./joined.js').Part[]} parts — the transcript's files, read as one
 * @param {FileState} state
 * @param {Reading} reading
 * @param {() => number} renew — a generation no file had before
 * @param {() => FileState['codex']} reread — a Codex file's reading from its start, none for Claude Code's
 * @returns {Promise<{ entries: readonly CachedEntry[], generation: number, tasks: TaskTracker }>}
 */
async function catchUp(parts, state, reading, renew, reread) {
  const joined = await openJoined(parts);
  try {
    return await readOn(joined, JSON.stringify(parts), state, reading, renew, reread);
  } finally {
    await joined.close();
  }
}

/**
 * @param {import('./joined.js').Joined} joined
 * @param {string} layout — the files it is read from, each to where
 * @param {FileState} state
 * @param {Reading} reading
 * @param {() => number} renew
 * @param {() => FileState['codex']} reread
 * @returns {Promise<{ entries: readonly CachedEntry[], generation: number, tasks: TaskTracker }>}
 */
async function readOn(joined, layout, state, reading, renew, reread) {
  const size = joined.size;
  // a file that shrank, or no longer holds what was read of it where it was, was rewritten; a Codex session that went on
  // in another file left the end of the one before
  const rewritten = size < state.offset || !(await endOf(joined, state.offset)).equals(state.seen);
  if (rewritten || (state.layout !== undefined && layout !== state.layout)) {
    state.generation = renew();
    state.offset = 0;
    state.carry = Buffer.alloc(0);
    state.seen = Buffer.alloc(0);
    state.entries = [];
    state.calls = new Map();
    state.tasks = createTaskTracker();
    state.codex = reread();
  }
  state.layout = layout;
  if (size > state.offset) {
    const read = await readEntries(joined, state.offset, size, state.carry, { ...reading, calls: state.calls, tasks: state.tasks, codex: state.codex });
    state.offset = read.offset;
    state.carry = read.carry;
    state.seen = await endOf(joined, read.offset);
    state.entries.push(...read.entries);
  }
  return { entries: state.entries, generation: state.generation, tasks: state.tasks };
}

/**
 * The last bytes of the file up to offset: those kept as seen.
 * @param {import('./joined.js').Joined} joined
 * @param {number} offset
 * @returns {Promise<Buffer>}
 */
async function endOf(joined, offset) {
  const length = Math.min(seenBytes, offset);
  const bytes = Buffer.alloc(length);
  const read = length === 0 ? 0 : await joined.read(bytes, offset - length);
  return bytes.subarray(0, read);
}

/**
 * @param {import('./joined.js').Joined} joined
 * @param {number} from
 * @param {number} to
 * @param {Buffer} carry — the start of a line read before, still without its end
 * @param {Reading & { calls: Map<string, import('./lite.js').Call>, tasks: TaskTracker, codex: FileState['codex'] }} reading
 * @returns {Promise<{ offset: number, carry: Buffer, entries: CachedEntry[] }>}
 */
async function readEntries(joined, from, to, carry, { scope, imageUrl, calls, tasks, codex }) {
  let offset = from;
  let rest = carry;
  /** @type {CachedEntry[]} */
  const entries = [];
  while (offset < to) {
    const chunk = Buffer.alloc(Math.min(chunkBytes, to - offset));
    const bytesRead = await joined.read(chunk, offset);
    if (bytesRead === 0) break;
    // the carried start of a line was read before this chunk: line offsets count from it
    const linesStart = offset - rest.length;
    offset += bytesRead;
    const split = splitLines(rest, chunk.subarray(0, bytesRead));
    rest = split.carry;
    for (const line of split.lines) {
      const parsed = parseLine(line.text);
      const at = linesStart + line.start;
      // a line of Codex is none or one of Claude Code's records, all found again from the line
      for (const raw of codex === undefined ? [parsed] : codex.translate(parsed)) {
        tasks.note(raw);
        const slim = slimEntry(raw, scope, (n) => imageUrl(at, n));
        entries.push({ slim: slim === undefined ? undefined : liteEntry(slim, { at, calls }), link: linkOf(raw), at });
      }
    }
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
