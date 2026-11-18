// @ts-check
// The green checks on feed messages, of all sessions in one file on this computer, so that every device opening the
// viewer sees the same ones.
import { changeChecks, parseChecks } from '../public/model/checks.js';
import { createSessionListFile } from './session-lists.js';

/**
 * @typedef {import('./session-lists.js').SessionLists<string, import('../public/model/checks.js').CheckChange>} Checks
 */

/**
 * @param {string} file
 * @returns {Checks}
 */
export function createCheckFile(file) {
  return createSessionListFile({ file, what: 'checks', parse: parseChecks, apply: changeChecks });
}
