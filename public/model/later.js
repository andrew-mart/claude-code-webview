// @ts-check
// Prompts set aside for later: written in a session's box while its agent works, so as not to break into its turn,
// and sent by hand once it is time.
import { isRecord, text } from './narrow.js';

/**
 * @typedef {{ id: string, text: string, at: string }} LaterPrompt — at: when it was set aside
 * @typedef {{ action: 'add', prompt: LaterPrompt } | { action: 'remove', id: string }} LaterChange
 */

/**
 * Prompts from stored JSON — the server's file, its reply: entries of any other shape, or with no words, are dropped.
 * @param {unknown} stored — result of JSON.parse
 * @returns {readonly LaterPrompt[]}
 */
export function parseLaterPrompts(stored) {
  if (!Array.isArray(stored)) return [];
  return stored.filter(isRecord).flatMap((item) => {
    const id = text(item.id);
    const words = text(item.text);
    const at = text(item.at);
    return id === undefined || words === undefined || words.trim() === '' || at === undefined ? [] : [{ id, text: words, at }];
  });
}

/**
 * The change is stated explicitly: when two devices send the same one, the second keeps the result. The list keeps the
 * order the prompts were set aside in — the order to go on in.
 * @param {readonly LaterPrompt[]} list
 * @param {LaterChange} change
 * @returns {readonly LaterPrompt[]}
 */
export function changeLaterPrompts(list, change) {
  switch (change.action) {
    case 'add':
      if (list.some((prompt) => prompt.id === change.prompt.id)) return list;
      return [...list, change.prompt].sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
    case 'remove':
      return list.filter((prompt) => prompt.id !== change.id);
    default:
      return exhaustive(change);
  }
}

/**
 * A change sent by the page; anything of another shape — undefined.
 * @param {unknown} value — from the request's JSON
 * @returns {LaterChange | undefined}
 */
export function parseLaterChange(value) {
  if (!isRecord(value)) return undefined;
  if (value.action === 'remove' && typeof value.id === 'string') return { action: 'remove', id: value.id };
  const [prompt] = value.action === 'add' ? parseLaterPrompts([value.prompt]) : [];
  return prompt === undefined ? undefined : { action: 'add', prompt };
}

/**
 * @param {never} value
 * @returns {never}
 */
function exhaustive(value) {
  throw new Error(`Unexpected change of the prompts set aside ${JSON.stringify(value)}`);
}
