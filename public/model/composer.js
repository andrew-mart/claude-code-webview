// @ts-check
// Prompt input box: the contract with the server (/api/live, /api/send, /api/interrupt) and what to show the user.
import { splitAttachedImages, uploadUrl } from './attachments.js';
import { parseDialog } from './dialog.js';
import { isRecord, text } from './narrow.js';

/**
 * Whether the session can be written to: live — it runs in a herdr pane; herdr-missing — herdr is not installed,
 * sending prompts is unavailable at all; the rest — why it is not possible right now.
 * @typedef {{ state: 'herdr-missing' | 'offline' } | { state: 'no-herdr' | 'outside-herdr', status: string } | { state: 'live', status: string, pane: string, dialog: import('./dialog.js').Dialog | undefined }} LiveState
 *   dialog: the choice Claude Code waits for in its terminal
 * @typedef {'empty' | 'herdr-missing' | 'offline' | 'no-herdr' | 'outside-herdr' | 'send-failed'} SendRefusal
 * @typedef {{ ok: true, pane: string } | { ok: false, error: SendRefusal }} SendOutcome
 * The /api/interrupt reply. prompt — a prompt Claude had not started on, taken out of the terminal's box for the page's
 * box; box-not-cleared — it came back into the terminal's box but could not be taken out of it.
 * @typedef {{ ok: true, pane: string, prompt: string | undefined } | { ok: false, error: SendRefusal | 'box-not-cleared' }} StopOutcome
 * @typedef {{ shown: boolean, enabled: boolean, canInterrupt: boolean, placeholder: string, hint: string }} ComposerView
 * @typedef {'physical' | 'touch'} Keyboard
 * @typedef {Exclude<SendRefusal, 'send-failed'> | 'screen-unreadable' | 'box-not-empty' | 'not-asked' | 'no-answer' | 'answer-unreadable'} BtwRefusal
 *   — why a side question got no answer
 * @typedef {{ ok: true, answer: string } | { ok: false, error: BtwRefusal }} BtwReply — the /api/btw contract
 */

/**
 * How sending works: a phone keyboard has no Shift+Enter, so there Enter starts a new line and the button sends.
 * @type {Readonly<Record<Keyboard, string>>}
 */
const keysHint = { physical: 'Enter to send, Shift+Enter for a new line.', touch: 'The ↑ button sends, Enter starts a new line.' };

/**
 * @param {LiveState} live
 * @param {string} sessionId
 * @param {Keyboard} keyboard
 * @returns {ComposerView}
 */
export function composerState(live, sessionId, keyboard) {
  switch (live.state) {
    case 'live': {
      // typed now, a prompt would land in Claude Code's dialog — its digits picking answers
      if (live.dialog !== undefined) return { shown: true, enabled: false, canInterrupt: false, placeholder: 'Claude Code is asking — answer above', hint: `Pick an answer above, or answer in the session's terminal (herdr pane ${live.pane}).` };
      const busy = live.status === 'busy';
      return {
        shown: true,
        enabled: true,
        canInterrupt: busy,
        placeholder: busy ? 'Claude is working — your message will be queued' : 'Message Claude…',
        hint: `${keysHint[keyboard]} The text goes to the session's terminal (herdr pane ${live.pane}).`,
      };
    }
    case 'herdr-missing':
      // Without herdr the session cannot be written to at all — the box is hidden so as not to promise what is unavailable.
      return { ...unavailable('herdr is not installed — write prompts in the terminal.'), shown: false };
    case 'offline':
      return unavailable(`The session is not running. To write to it from here, open it in a herdr pane: claude --resume ${sessionId}`);
    case 'outside-herdr':
      return unavailable('The session is not running in herdr — its terminal cannot receive text.');
    case 'no-herdr':
      return unavailable('Could not reach herdr. Start the viewer from a herdr pane.');
    default:
      return exhaustive(live);
  }
}

/**
 * @param {StopOutcome} outcome
 * @returns {string}
 */
export function stopMessage(outcome) {
  if (outcome.ok) return outcome.prompt === undefined ? 'Esc sent — Claude will stop the current turn.' : 'Stopped before Claude started on it — the message is back in the box.';
  const { error } = outcome;
  if (error === 'box-not-cleared') return 'Stopped. The message went back to the terminal’s input box and could not be moved here.';
  return outcomeMessage({ ok: false, error });
}

/**
 * @param {SendOutcome} outcome
 * @returns {string}
 */
export function outcomeMessage(outcome) {
  if (outcome.ok) return 'Sent to the terminal.';
  switch (outcome.error) {
    case 'empty':
      return 'An empty prompt was not sent.';
    case 'herdr-missing':
      return 'herdr is not installed — the text cannot be sent to the terminal. The text stays in the box.';
    case 'offline':
      return 'The session is no longer running. The text stays in the box.';
    case 'outside-herdr':
      return 'The session is not running in herdr. The text stays in the box.';
    case 'no-herdr':
      return 'Could not reach herdr. The text stays in the box.';
    case 'send-failed':
      return 'herdr did not accept the text — the pane may have closed. The text stays in the box.';
    default:
      return exhaustive(outcome.error);
  }
}

/**
 * Why a side question got no answer; the question stays in the box.
 * @param {BtwRefusal} error
 * @returns {string}
 */
export function btwMessage(error) {
  switch (error) {
    case 'empty':
      return 'Write the question after /btw.';
    case 'screen-unreadable':
      return 'Claude Code shows a menu or a question in the terminal — answer it there first. The question stays in the box.';
    case 'box-not-empty':
      return 'The terminal’s input box holds text — send or clear it there first. The question stays in the box.';
    case 'not-asked':
      return 'Claude Code did not open the side question: it was left in the terminal’s input box.';
    case 'no-answer':
      return 'No answer came within three minutes — the side panel in the terminal was closed.';
    case 'answer-unreadable':
      return 'The answer could not be read off the terminal.';
    default:
      return outcomeMessage({ ok: false, error });
  }
}

/**
 * @param {string} hint
 * @returns {ComposerView}
 */
function unavailable(hint) {
  return { shown: true, enabled: false, canInterrupt: false, placeholder: 'Sending is unavailable', hint };
}

/**
 * @param {never} value
 * @returns {never}
 */
function exhaustive(value) {
  throw new Error(`Unexpected composer value ${JSON.stringify(value)}`);
}

/**
 * Reply of /api/live; any other shape (page newer than the server, server error) — undefined.
 * @param {unknown} json
 * @returns {LiveState | undefined}
 */
export function parseLiveState(json) {
  if (!isRecord(json)) return undefined;
  const status = text(json.status);
  const pane = text(json.pane);
  switch (json.state) {
    case 'herdr-missing':
    case 'offline':
      return { state: json.state };
    case 'no-herdr':
    case 'outside-herdr':
      return status === undefined ? undefined : { state: json.state, status };
    case 'live':
      return status === undefined || pane === undefined ? undefined : { state: 'live', status, pane, dialog: parseDialog(json.dialog) };
    default:
      return undefined;
  }
}

/**
 * Reply of /api/send.
 * @param {unknown} json
 * @returns {SendOutcome | undefined}
 */
export function parseOutcome(json) {
  if (!isRecord(json)) return undefined;
  const pane = text(json.pane);
  if (json.ok === true) return pane === undefined ? undefined : { ok: true, pane };
  switch (json.error) {
    case 'empty':
    case 'herdr-missing':
    case 'offline':
    case 'no-herdr':
    case 'outside-herdr':
    case 'send-failed':
      return { ok: false, error: json.error };
    default:
      return undefined;
  }
}

/**
 * Reply of /api/interrupt.
 * @param {unknown} json
 * @returns {StopOutcome | undefined}
 */
export function parseStopOutcome(json) {
  if (!isRecord(json)) return undefined;
  if (json.ok === false && json.error === 'box-not-cleared') return { ok: false, error: 'box-not-cleared' };
  const outcome = parseOutcome(json);
  if (outcome === undefined || !outcome.ok) return outcome;
  return { ok: true, pane: outcome.pane, prompt: text(json.prompt) };
}

/**
 * A prompt that comes back to the box (stopped before Claude started on it, or rewound): its words before what is
 * already typed there, the images the viewer saved for it attached again. A list naming any other file stays text.
 * @param {string} prompt
 * @param {string} draft — what the box holds now
 * @returns {{ text: string, images: string[] }} — images: where the page loads them from
 */
export function promptForBox(prompt, draft) {
  const attached = splitAttachedImages(prompt);
  const images = attached.paths.flatMap((path) => {
    const url = uploadUrl(path);
    return url === undefined ? [] : [url];
  });
  const whole = images.length === attached.paths.length;
  const words = whole ? attached.text : prompt;
  return { text: draft.trim() === '' ? words : `${words}\n\n${draft}`, images: whole ? images : [] };
}

/**
 * The side question in the box: what follows "/btw" at its start, as the terminal takes it; empty for a bare "/btw".
 * @param {string} text — the box
 * @returns {string | undefined} — none when the box holds an ordinary prompt
 */
export function sideQuestionOf(text) {
  const match = /^\s*\/btw(?:\s+([\s\S]*))?$/.exec(text);
  return match === null ? undefined : (match[1] ?? '').trim();
}

/** @type {ReadonlySet<string>} */
const btwRefusals = new Set(['empty', 'herdr-missing', 'offline', 'no-herdr', 'outside-herdr', 'screen-unreadable', 'box-not-empty', 'not-asked', 'no-answer', 'answer-unreadable']);

/**
 * Reply of /api/btw.
 * @param {unknown} json
 * @returns {BtwReply | undefined}
 */
export function parseBtwReply(json) {
  if (!isRecord(json)) return undefined;
  const answer = text(json.answer);
  if (json.ok === true) return answer === undefined ? undefined : { ok: true, answer };
  return json.ok === false && isBtwRefusal(json.error) ? { ok: false, error: json.error } : undefined;
}

/**
 * @param {unknown} value
 * @returns {value is BtwRefusal}
 */
function isBtwRefusal(value) {
  return typeof value === 'string' && btwRefusals.has(value);
}
