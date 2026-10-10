// @ts-check
// The stream of transcript entries: everything already in the file, then every appended line — only those on the
// conversation's active branch (see branch.js). A rewind that shows up later rebuilds the feed from the start.
import { open, stat } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { linkOf, rewoundEntries } from './branch.js';
import { slimEntry } from './slim.js';
import { splitLines } from './tail.js';

const chunkBytes = 4 * 1024 * 1024;
const batchSize = 1000;

/**
 * @typedef {(event: 'entries' | 'ready' | 'reset' | 'missing', data: unknown) => void} Send
 * @typedef {(lineStart: number, n: number) => string} ImageUrl — the link to the n-th image of the entry on the line that starts at lineStart
 * @typedef {{ raw: unknown, at: number, link: import('./branch.js').Link }} ReadEntry — at: the file offset of the entry's line
 */

/**
 * Runs until the signal is aborted. The file is looked up again on every round: after /cd it moves.
 * @param {{ locate: () => Promise<string | undefined>, scope: 'main' | 'subagent', imageUrl: ImageUrl, rewoundAt: () => string | undefined, send: Send, signal: AbortSignal, pollMs: number }} options
 *   rewoundAt — the prompt this page rewound the session to, if it did
 */
export async function streamTranscript({ locate, scope, imageUrl, rewoundAt, send, signal, pollMs }) {
  let offset = 0;
  /** @type {Buffer} */
  let carry = Buffer.alloc(0);
  let announced = false;
  /** @type {import('./branch.js').Link[]} */
  let links = [];
  /** Entries that already have a prompt sent from them: another prompt from there means the conversation was rewound. */
  /** @type {Set<string>} */
  let promptParents = new Set();
  let point = rewoundAt();
  const restart = () => {
    offset = 0;
    carry = Buffer.alloc(0);
    links = [];
    promptParents = new Set();
    send('reset', null);
  };
  while (!signal.aborted) {
    const path = await locate();
    const size = path === undefined ? undefined : await stat(path).then((info) => info.size, () => undefined);
    if (path === undefined || size === undefined) {
      if (!announced) send('missing', null);
      announced = true;
    } else {
      const nextPoint = rewoundAt();
      if (size < offset || (nextPoint !== point && offset > 0)) restart();
      point = nextPoint;
      if (size > offset) {
        const read = await readEntries(path, offset, size, carry);
        // A prompt from an entry that already had one, whose branch the page has already shown: rebuild the feed.
        if (read.entries.some(({ link }) => link.turn && link.parent !== undefined && promptParents.has(link.parent))) {
          restart();
          continue;
        }
        offset = read.offset;
        carry = read.carry;
        for (const { link } of read.entries) {
          links.push(link);
          if (link.turn && link.parent !== undefined) promptParents.add(link.parent);
        }
        sendEntries(read.entries, rewoundEntries(links, point), { scope, imageUrl, send });
      }
      if (!announced) send('ready', null);
      announced = true;
    }
    await delay(pollMs, undefined, { signal }).catch(() => undefined);
  }
}

/**
 * @param {string} path
 * @param {number} from
 * @param {number} to
 * @param {Buffer} carry
 * @returns {Promise<{ offset: number, carry: Buffer, entries: ReadEntry[] }>}
 */
async function readEntries(path, from, to, carry) {
  const handle = await open(path, 'r');
  let offset = from;
  let rest = carry;
  /** @type {ReadEntry[]} */
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
        entries.push({ raw, at: linesStart + line.start, link: linkOf(raw) });
      }
    }
  } finally {
    await handle.close();
  }
  return { offset, carry: rest, entries };
}

/**
 * @param {readonly ReadEntry[]} entries
 * @param {ReadonlySet<string>} hidden — entries off the active branch
 * @param {{ scope: 'main' | 'subagent', imageUrl: ImageUrl, send: Send }} output
 */
function sendEntries(entries, hidden, { scope, imageUrl, send }) {
  const shown = entries
    .filter(({ link }) => link.uuid === undefined || !hidden.has(link.uuid))
    .map(({ raw, at }) => slimEntry(raw, scope, (n) => imageUrl(at, n)))
    .filter((entry) => entry !== undefined);
  for (let start = 0; start < shown.length; start += batchSize) send('entries', shown.slice(start, start + batchSize));
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
