// @ts-check
// Green checks on feed messages: a message the reader marked — done with, dealt with — by its id.
import { isRecord } from './narrow.js';

/**
 * @typedef {{ action: 'check', id: string } | { action: 'uncheck', id: string }} CheckChange
 */

/**
 * The messages checked, from stored JSON — the server's file, its reply: anything but an id is dropped.
 * @param {unknown} stored — result of JSON.parse
 * @returns {readonly string[]}
 */
export function parseChecks(stored) {
  return Array.isArray(stored) ? stored.filter((id) => typeof id === 'string') : [];
}

/**
 * The change is stated, not toggled: two devices sending the same one leave the same checks.
 * @param {readonly string[]} list
 * @param {CheckChange} change
 * @returns {readonly string[]}
 */
export function changeChecks(list, change) {
  switch (change.action) {
    case 'check':
      return list.includes(change.id) ? list : [...list, change.id];
    case 'uncheck':
      return list.filter((id) => id !== change.id);
    default:
      return exhaustive(change);
  }
}

/**
 * A change sent by the page; anything of another shape — undefined.
 * @param {unknown} value — from the request's JSON
 * @returns {CheckChange | undefined}
 */
export function parseCheckChange(value) {
  if (!isRecord(value) || typeof value.id !== 'string') return undefined;
  switch (value.action) {
    case 'check':
    case 'uncheck':
      return { action: value.action, id: value.id };
    default:
      return undefined;
  }
}

/**
 * @param {never} value
 * @returns {never}
 */
function exhaustive(value) {
  throw new Error(`Unexpected check change ${JSON.stringify(value)}`);
}
