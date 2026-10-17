// @ts-check
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseSessionStatus } from '../public/model/session-status.js';

/**
 * @param {string} directory
 * @param {string} session
 * @returns {Promise<import('../public/model/session-status.js').SessionStatus | undefined>}
 */
export async function readSessionStatus(directory, session) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(session)) return undefined;
  const content = await readFile(join(directory, `${session}.json`), 'utf8').catch(() => undefined);
  if (content === undefined) return undefined;
  try {
    return parseSessionStatus(JSON.parse(content));
  } catch {
    return undefined; // no usable snapshot while it is missing or being replaced
  }
}
