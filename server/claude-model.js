// @ts-check
// The last model a Claude Code session actually used, including sessions launched through an LLM gateway.
import { open } from 'node:fs/promises';
import { isRecord, text } from '../public/model/narrow.js';

const tailBytes = 1024 * 1024;

/**
 * @param {(id: string) => Promise<string | undefined>} find
 * @returns {(id: string) => Promise<string | undefined>}
 */
export function createClaudeModels(find) {
  /** @type {Map<string, { size: number, modifiedAt: number, model: string | undefined }>} */
  const cached = new Map();
  return async (id) => {
    const path = await find(id);
    const handle = path === undefined ? undefined : await open(path, 'r').catch(() => undefined);
    if (handle === undefined || path === undefined) return undefined;
    try {
      const { size, mtimeMs } = await handle.stat();
      const before = cached.get(path);
      if (before !== undefined && before.size === size && before.modifiedAt === mtimeMs) return before.model;
      const length = Math.min(size, tailBytes);
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, size - length);
      const model = lastModel(buffer.toString('utf8'));
      cached.set(path, { size, modifiedAt: mtimeMs, model });
      return model;
    } finally {
      await handle.close();
    }
  };
}

/** @param {string} tail @returns {string | undefined} */
function lastModel(tail) {
  for (const line of tail.split('\n').reverse()) {
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue; // a line cut at the start of the tail, or still being written
    }
    if (!isRecord(record) || record.type !== 'assistant' || !isRecord(record.message)) continue;
    const model = text(record.message.model);
    if (model !== undefined && model !== '<synthetic>') return model;
  }
  return undefined;
}
