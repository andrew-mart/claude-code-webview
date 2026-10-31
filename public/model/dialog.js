// @ts-check
// A choice the agent waits for in its terminal — Claude Code's AskUserQuestion dialog, a question of Codex's, with
// numbered answers — as the page shows it and answers it.

/**
 * @typedef {{ key: string, label: string, detail: string | undefined, checked: boolean | undefined, current: boolean }} DialogOption
 *   key: the digit that picks it; detail: the line under it; checked: in a question with several answers, whether it
 *   is ticked; current: the terminal's cursor is on it
 * @typedef {{ lines: readonly string[], options: readonly DialogOption[], tabs: boolean, previews: boolean, sessionOnly?: true, goesBack?: true }} Dialog — lines:
 *   what the dialog says above its options: the tabs of its questions, the question, a review of the answers; tabs: it
 *   has several questions, ← and → go between them; previews: its answers are drawn beside previews — or it is Codex's —
 *   where a digit picks nothing: the arrows go to an answer and Enter picks it; goesBack: Esc goes back to the screen
 *   before — /mcp's, under its first — not out of the dialog; such a screen may have nothing to choose, only to read
 * @typedef {'1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | 'left' | 'right' | 'up' | 'down' | 'enter' | 'esc' | 's'} DialogKey — the keys a
 *   dialog is answered with: a choice's digit, the next or the previous question, the answer above or below, Enter, Esc
 *   to cancel it
 * @typedef {{ key: DialogKey } | { text: string }} DialogStep — a key, or words typed for "Type something"
 * @typedef {{ ok: true } | { ok: false, error: 'no-dialog' | 'send-failed' | 'herdr-missing' | 'offline' | 'no-herdr' | 'outside-herdr' }} DialogReply
 *   no-dialog: the terminal shows no dialog any more — answered there, or gone
 */

import { isRecord, text } from './narrow.js';

/**
 * The dialog the viewer read off the terminal, as /api/live tells it; undefined for any other shape.
 * @param {unknown} json
 * @returns {Dialog | undefined}
 */
export function parseDialog(json) {
  if (!isRecord(json) || !Array.isArray(json.lines) || !Array.isArray(json.options) || typeof json.tabs !== 'boolean' || typeof json.previews !== 'boolean') return undefined;
  const lines = json.lines.flatMap((line) => (typeof line === 'string' ? [line] : []));
  const options = json.options.flatMap((option) => {
    const parsed = optionOf(option);
    return parsed === undefined ? [] : [parsed];
  });
  const goesBack = json.goesBack === true;
  return lines.length === json.lines.length && options.length === json.options.length && (options.length > 0 || goesBack)
    ? { lines, options, tabs: json.tabs, previews: json.previews, ...(json.sessionOnly === true ? { sessionOnly: /** @type {const} */ (true) } : {}), ...(goesBack ? { goesBack: /** @type {const} */ (true) } : {}) }
    : undefined;
}

/** @type {ReadonlySet<string>} */
const dialogKeys = new Set(['1', '2', '3', '4', '5', '6', '7', '8', '9', 'left', 'right', 'up', 'down', 'enter', 'esc', 's']);
/**
 * An answer takes a few keys — a digit, the words, Enter — or, in a list with no digits (/mcp's), the arrows down to a
 * row one by one: as many as the terminal shows rows.
 */
const maxSteps = 60;

/**
 * The steps of an answer from the page: a dialog's keys, and words on one line — Enter in them would answer early.
 * @param {unknown} json
 * @returns {DialogStep[] | undefined} — none for anything else
 */
export function parseSteps(json) {
  if (!Array.isArray(json) || json.length === 0 || json.length > maxSteps) return undefined;
  const steps = json.flatMap((step) => {
    const parsed = stepOf(step);
    return parsed === undefined ? [] : [parsed];
  });
  return steps.length === json.length ? steps : undefined;
}

/**
 * @param {unknown} json
 * @returns {DialogStep | undefined}
 */
function stepOf(json) {
  if (!isRecord(json)) return undefined;
  if (isDialogKey(json.key)) return { key: json.key };
  const words = text(json.text);
  return words !== undefined && words.trim() !== '' && !/[\u0000-\u001f]/.test(words) ? { text: words } : undefined;
}

/**
 * @param {unknown} value
 * @returns {value is DialogKey}
 */
function isDialogKey(value) {
  return typeof value === 'string' && dialogKeys.has(value);
}

/**
 * @param {unknown} json
 * @returns {DialogOption | undefined}
 */
function optionOf(json) {
  if (!isRecord(json)) return undefined;
  const key = text(json.key);
  const label = text(json.label);
  const detail = json.detail === undefined ? undefined : text(json.detail);
  const checked = typeof json.checked === 'boolean' ? json.checked : undefined;
  if (key === undefined || label === undefined || (json.detail !== undefined && detail === undefined) || typeof json.current !== 'boolean') return undefined;
  return { key, label, detail, checked, current: json.current };
}

/** @type {ReadonlySet<string>} */
const replyErrors = new Set(['no-dialog', 'send-failed', 'herdr-missing', 'offline', 'no-herdr', 'outside-herdr']);

/**
 * Reply of /api/dialog; any other — or none, the viewer out of reach — is an answer that did not reach the terminal.
 * @param {unknown} json
 * @returns {DialogReply}
 */
export function parseDialogReply(json) {
  if (isRecord(json) && json.ok === true) return { ok: true };
  return { ok: false, error: isRecord(json) && isReplyError(json.error) ? json.error : 'send-failed' };
}

/**
 * @param {unknown} value
 * @returns {value is Exclude<DialogReply, { ok: true }>['error']}
 */
function isReplyError(value) {
  return typeof value === 'string' && replyErrors.has(value);
}
