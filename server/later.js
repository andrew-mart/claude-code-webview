// @ts-check
// The prompts set aside for later, of all sessions, in one file on this computer: every device sees the same ones.
import { changeLaterPrompts, parseLaterPrompts } from '../public/model/later.js';
import { createSessionListFile } from './session-lists.js';

/**
 * @typedef {import('../public/model/later.js').LaterPrompt} LaterPrompt
 * @typedef {import('../public/model/later.js').LaterChange} LaterChange
 * @typedef {import('./session-lists.js').SessionLists<LaterPrompt, LaterChange>} LaterPrompts
 */

/**
 * @param {string} file
 * @returns {LaterPrompts}
 */
export function createLaterFile(file) {
  return createSessionListFile({ file, what: 'prompts set aside for later', parse: parseLaterPrompts, apply: changeLaterPrompts });
}
