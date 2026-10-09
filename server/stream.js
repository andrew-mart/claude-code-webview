// @ts-check
// The stream of transcript entries: everything already in the file, then every appended line.
import { open, stat } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { slimEntry } from './slim.js';
import { splitLines } from './tail.js';

const chunkBytes = 4 * 1024 * 1024;
const batchSize = 1000;

/**
 * @typedef {(event: 'entries' | 'ready' | 'reset' | 'missing', data: unknown) => void} Send
 */

/**
 * Runs until the signal is aborted. The file is looked up again on every round: after /cd it moves.
 * @param {{ locate: () => Promise<string | undefined>, scope: 'main' | 'subagent', send: Send, signal: AbortSignal, pollMs: number }} options
 */
export async function streamTranscript({ locate, scope, send, signal, pollMs }) {
  let offset = 0;
  /** @type {Buffer} */
  let carry = Buffer.alloc(0);
  let announced = false;
  while (!signal.aborted) {
    const path = await locate();
    const size = path === undefined ? undefined : await stat(path).then((info) => info.size, () => undefined);
    if (path === undefined || size === undefined) {
      if (!announced) send('missing', null);
      announced = true;
    } else {
      if (size < offset) {
        offset = 0;
        carry = Buffer.alloc(0);
        send('reset', null);
      }
      if (size > offset) {
        const read = await readRange(path, offset, size, carry, scope, send);
        offset = read.offset;
        carry = read.carry;
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
 * @param {'main' | 'subagent'} scope
 * @param {Send} send
 * @returns {Promise<{ offset: number, carry: Buffer }>}
 */
async function readRange(path, from, to, carry, scope, send) {
  const handle = await open(path, 'r');
  let offset = from;
  let rest = carry;
  try {
    while (offset < to) {
      const chunk = Buffer.alloc(Math.min(chunkBytes, to - offset));
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
      const split = splitLines(rest, chunk.subarray(0, bytesRead));
      rest = split.carry;
      sendEntries(split.lines, scope, send);
    }
  } finally {
    await handle.close();
  }
  return { offset, carry: rest };
}

/**
 * @param {readonly string[]} lines
 * @param {'main' | 'subagent'} scope
 * @param {Send} send
 */
function sendEntries(lines, scope, send) {
  const entries = lines.map((line) => slimEntry(parseLine(line), scope)).filter((entry) => entry !== undefined);
  for (let start = 0; start < entries.length; start += batchSize) send('entries', entries.slice(start, start + batchSize));
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
