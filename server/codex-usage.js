// @ts-check
// Codex's usage of the account — its 5-hour window and its week, how much of each is used and when it resets — as
// Codex itself tells it: every token count it writes into a transcript carries its rate limits. The latest one, in the
// session Codex worked in last, is the freshest reading.
import { open } from 'node:fs/promises';
import { isRecord } from '../public/model/narrow.js';

/** A token count is written after every turn: the tail of a transcript holds the latest one. */
const tailBytes = 512 * 1024;
/** Codex's windows by their length in minutes. */
const fiveHourMinutes = 300;
const weekMinutes = 10080;

/**
 * @param {{ list: () => Promise<readonly import('./sessions.js').SessionInfo[]>, find: (id: string) => Promise<string | undefined>, partsOf: (path: string) => Promise<readonly import('./joined.js').Part[]> }} index
 * @returns {Promise<import('../public/model/usage.js').Usage | undefined>} — none until Codex has told its limits
 */
export async function readCodexUsage(index) {
  const latest = (await index.list()).find((session) => session.agent === 'codex');
  const path = latest === undefined ? undefined : await index.find(latest.id);
  // a session that went on in another file goes on in its last one
  const last = path === undefined ? undefined : (await index.partsOf(path)).at(-1)?.path;
  return last === undefined ? undefined : usageOfRollout(await readTail(last));
}

/**
 * The windows the latest token count of a transcript tells: each by its length — a primary and a secondary one, either
 * of them the week; a line still being written is passed over.
 * @param {string} text — a Codex transcript, or its tail
 * @returns {import('../public/model/usage.js').Usage | undefined}
 */
export function usageOfRollout(text) {
  for (const line of text.split('\n').reverse()) {
    if (!line.includes('"rate_limits"')) continue;
    const record = parsed(line);
    const payload = isRecord(record) && isRecord(record.payload) ? record.payload : undefined;
    const limits = payload !== undefined && isRecord(payload.rate_limits) ? payload.rate_limits : undefined;
    const readAt = isRecord(record) && typeof record.timestamp === 'string' ? Date.parse(record.timestamp) : Number.NaN;
    if (limits === undefined || !Number.isFinite(readAt)) continue;
    const windows = [limits.primary, limits.secondary].flatMap((window) => {
      const read = windowOf(window);
      return read === undefined ? [] : [read];
    });
    return { fiveHour: windows.find((window) => window.minutes === fiveHourMinutes)?.usage, sevenDay: windows.find((window) => window.minutes === weekMinutes)?.usage, readAt };
  }
  return undefined;
}

/**
 * @param {unknown} json — { used_percent, window_minutes, resets_at: seconds }
 * @returns {{ minutes: number, usage: import('../public/model/usage.js').UsageWindow } | undefined}
 */
function windowOf(json) {
  if (!isRecord(json) || typeof json.used_percent !== 'number' || typeof json.window_minutes !== 'number') return undefined;
  return { minutes: json.window_minutes, usage: { percent: json.used_percent, resetsAt: typeof json.resets_at === 'number' ? json.resets_at * 1000 : undefined } };
}

/**
 * @param {string} path
 * @returns {Promise<string>}
 */
async function readTail(path) {
  const handle = await open(path, 'r');
  try {
    const { size } = await handle.stat();
    const length = Math.min(size, tailBytes);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, size - length);
    return buffer.toString('utf8');
  } finally {
    await handle.close();
  }
}

/**
 * @param {string} line
 * @returns {unknown}
 */
function parsed(line) {
  try {
    return JSON.parse(line);
  } catch {
    return undefined; // a line cut by the tail, or still being written
  }
}
