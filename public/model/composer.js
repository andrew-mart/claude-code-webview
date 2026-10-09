// @ts-check
// Prompt input box: the contract with the server (/api/live, /api/send) and what to show the user.
import { isRecord, text } from './narrow.js';

/**
 * Whether the session can be written to: live — it runs in a herdr pane; herdr-missing — herdr is not installed,
 * sending prompts is unavailable at all; the rest — why it is not possible right now.
 * @typedef {{ state: 'herdr-missing' | 'offline' } | { state: 'no-herdr' | 'outside-herdr', status: string } | { state: 'live', status: string, pane: string }} LiveState
 * @typedef {'empty' | 'herdr-missing' | 'offline' | 'no-herdr' | 'outside-herdr' | 'send-failed'} SendRefusal
 * @typedef {{ ok: true, pane: string } | { ok: false, error: SendRefusal }} SendOutcome
 * @typedef {{ shown: boolean, enabled: boolean, canInterrupt: boolean, placeholder: string, hint: string }} ComposerView
 */

const keysHint = 'Enter to send, Shift+Enter for a new line.';

/**
 * @param {LiveState} live
 * @param {string} sessionId
 * @returns {ComposerView}
 */
export function composerState(live, sessionId) {
  switch (live.state) {
    case 'live': {
      const busy = live.status === 'busy';
      return {
        shown: true,
        enabled: true,
        canInterrupt: busy,
        placeholder: busy ? 'Claude is working — your message will be queued' : 'Message Claude…',
        hint: `${keysHint} The text goes to the session's terminal (herdr pane ${live.pane}).`,
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
      return status === undefined || pane === undefined ? undefined : { state: 'live', status, pane };
    default:
      return undefined;
  }
}

/**
 * Reply of /api/send and /api/interrupt.
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
