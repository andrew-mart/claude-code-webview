// @ts-check
// The registry of running sessions that Claude Code maintains: ~/.claude/sessions/<pid>.json — which process has
// which session open.
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isRecord, text } from '../public/model/narrow.js';

/**
 * @typedef {{ pid: number, sessionId: string, status: string, updatedAt: number }} LiveRecord
 */

/**
 * @param {string} dir — ~/.claude/sessions
 * @returns {Promise<readonly unknown[]>}
 */
export async function readSessionRecords(dir) {
  const names = await readdir(dir).catch(() => []);
  const records = await Promise.all(
    names
      .filter((name) => /^\d+\.json$/.test(name))
      .map(async (name) => {
        const content = await readFile(join(dir, name), 'utf8').catch(() => undefined);
        try {
          return content === undefined ? undefined : JSON.parse(content);
        } catch {
          return undefined; // the file is being rewritten right now — it will be read on the next poll
        }
      }),
  );
  return records.filter((record) => record !== undefined);
}

/**
 * The latest record of each interactive session: a session may have been reopened in another process.
 * @param {readonly unknown[]} records — contents of ~/.claude/sessions/<pid>.json
 * @returns {Map<string, LiveRecord>} — by session id
 */
export function latestRecords(records) {
  /** @type {Map<string, LiveRecord>} */
  const latest = new Map();
  for (const raw of records) {
    const record = parseRecord(raw);
    if (record === undefined) continue;
    const known = latest.get(record.sessionId);
    if (known === undefined || record.updatedAt > known.updatedAt) latest.set(record.sessionId, record);
  }
  return latest;
}

/**
 * @param {unknown} raw — contents of ~/.claude/sessions/<pid>.json
 * @returns {LiveRecord | undefined}
 */
function parseRecord(raw) {
  if (!isRecord(raw) || raw.kind !== 'interactive' || typeof raw.pid !== 'number') return undefined;
  const sessionId = text(raw.sessionId);
  const status = text(raw.status);
  const updatedAt = typeof raw.updatedAt === 'number' ? raw.updatedAt : 0;
  return sessionId === undefined || status === undefined ? undefined : { pid: raw.pid, sessionId, status, updatedAt };
}
