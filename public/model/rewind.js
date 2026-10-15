// @ts-check
// Rewinding from the page: the /api/rewind reply and what to tell the user.
import { isRecord, text } from './narrow.js';

/**
 * prompt — the rewound message, back for editing (Claude Code put it into its box, the page takes it over)
 * @typedef {{ ok: true, prompt: string | undefined } | { ok: false, error: string }} RewindReply
 */

/** @type {Readonly<Record<string, string>>} */
const refusals = {
  busy: 'Claude is working — press Stop or wait, then rewind.',
  offline: 'The session is not running — rewind in its terminal after resuming it.',
  'outside-herdr': 'The session is not running in herdr — rewind in its terminal.',
  'no-herdr': 'Could not reach herdr — rewind in the terminal.',
  'herdr-missing': 'herdr is not installed — rewind in the terminal.',
  'no-code-changes': 'This message has no code changes to restore.',
  'message-not-found': 'The rewind menu does not show this message — rewind in the terminal.',
  'not-listed': 'The rewind menu does not list this message: it was sent while Claude was working.',
  'screen-unreadable': 'The terminal shows a dialog — answer it there, then rewind.',
  subagent: 'Codex’s terminal shows a sub-agent — switch it to the main thread, then rewind.',
};

/**
 * @param {unknown} json — the /api/rewind reply
 * @returns {RewindReply | undefined}
 */
export function parseRewindReply(json) {
  if (!isRecord(json)) return undefined;
  if (json.ok === true) return { ok: true, prompt: text(json.prompt) };
  const error = text(json.error);
  return json.ok === false && error !== undefined ? { ok: false, error } : undefined;
}

/**
 * @param {RewindReply} reply
 * @returns {string}
 */
export function rewindMessage(reply) {
  if (reply.ok) return reply.prompt === undefined ? 'Rewound.' : 'Rewound. The message is back in the box — edit it and send.';
  return refusals[reply.error] ?? `The rewind did not go through (${reply.error}) — check the terminal.`;
}
