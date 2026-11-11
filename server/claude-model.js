// @ts-check
// The last answer of a Claude Code session: the model it actually came from — through an LLM gateway too — and when.
import { open } from 'node:fs/promises';
import { isRecord, text } from '../public/model/narrow.js';

const tailBytes = 1024 * 1024;

/**
 * @typedef {{ model: string, at: number }} LastAnswer — the model the session last answered with, and when, in ms
 */

/**
 * @param {(id: string) => Promise<string | undefined>} find
 * @returns {(id: string) => Promise<LastAnswer | undefined>}
 */
export function createClaudeModels(find) {
  /** @type {Map<string, { size: number, modifiedAt: number, answer: LastAnswer | undefined }>} */
  const cached = new Map();
  return async (id) => {
    const path = await find(id);
    const handle = path === undefined ? undefined : await open(path, 'r').catch(() => undefined);
    if (handle === undefined || path === undefined) return undefined;
    try {
      const { size, mtimeMs } = await handle.stat();
      const before = cached.get(path);
      if (before !== undefined && before.size === size && before.modifiedAt === mtimeMs) return before.answer;
      const length = Math.min(size, tailBytes);
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, size - length);
      const answer = lastAnswer(buffer.toString('utf8'));
      cached.set(path, { size, modifiedAt: mtimeMs, answer });
      return answer;
    } finally {
      await handle.close();
    }
  };
}

/** @param {string} tail @returns {LastAnswer | undefined} */
function lastAnswer(tail) {
  for (const line of tail.split('\n').reverse()) {
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue; // a line cut at the start of the tail, or still being written
    }
    if (!isRecord(record) || record.type !== 'assistant' || !isRecord(record.message)) continue;
    const model = text(record.message.model);
    const stamp = text(record.timestamp);
    const at = stamp === undefined ? Number.NaN : Date.parse(stamp);
    if (model !== undefined && model !== '<synthetic>' && !Number.isNaN(at)) return { model, at };
  }
  return undefined;
}
