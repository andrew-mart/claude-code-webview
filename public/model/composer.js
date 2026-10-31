// @ts-check
// Prompt input box: the contract with the server (/api/live, /api/send, /api/interrupt) and what to show the user —
// for a Claude Code session and a Codex one alike.
import { splitAttachedImages, uploadUrl } from './attachments.js';
import { parseDialog } from './dialog.js';
import { isRecord, text } from './narrow.js';

/**
 * Whether the session can be written to: live — it runs in a herdr pane; herdr-missing — herdr is not installed,
 * sending prompts is unavailable at all; the rest — why it is not possible right now.
 * @typedef {{ state: 'herdr-missing' | 'offline' } | { state: 'no-herdr' | 'outside-herdr', status: string } | { state: 'live', status: string, pane: string, dialog: import('./dialog.js').Dialog | undefined, queued: readonly string[] }} LiveState
 *   dialog: the choice the agent waits for in its terminal; queued: what Codex queued to send next — Claude Code's queue
 *   shows in its feed
 * @typedef {'claude' | 'codex'} Agent — whose session: Claude Code's or Codex's
 * @typedef {{ id: string, agent: Agent }} ComposedSession — the session the box writes to
 * @typedef {'empty' | 'herdr-missing' | 'offline' | 'no-herdr' | 'outside-herdr' | 'asking' | 'subagent' | 'side' | 'not-taken' | 'not-typed' | 'not-sent' | 'send-failed'} SendRefusal
 *   — asking: Codex asks something in its terminal, a picker in its box's place; subagent: Codex's terminal shows a
 *   sub-agent's thread, which takes no input; side: it shows a side conversation (its /btw); not-taken: Codex did not
 *   take the prompt, it was taken back out of its box
 * @typedef {{ ok: true, pane: string } | { ok: false, error: SendRefusal }} SendOutcome
 * The /api/interrupt reply. prompt — a prompt Claude had not started on, taken out of the terminal's box for the page's
 * box; box-not-cleared — it came back into the terminal's box but could not be taken out of it.
 * @typedef {{ ok: true, pane: string, prompt: string | undefined } | { ok: false, error: SendRefusal | 'box-not-cleared' }} StopOutcome
 * @typedef {{ shown: boolean, enabled: boolean, canInterrupt: boolean, canReopen: boolean, placeholder: string, hint: string }} ComposerView
 *   canReopen: the session is not running — it can be opened again in herdr, where it ran
 * @typedef {'physical' | 'touch'} Keyboard
 * @typedef {Exclude<SendRefusal, 'send-failed'> | 'screen-unreadable' | 'box-not-empty' | 'not-asked' | 'no-answer' | 'answer-unreadable' | 'panel-closed'} BtwRefusal
 *   — why a side question got no answer
 * @typedef {{ ok: true, answer: string } | { ok: false, error: BtwRefusal }} BtwReply — the /api/btw contract
 */

/**
 * How sending works: a phone keyboard has no Shift+Enter, so there Enter starts a new line and the button sends.
 * @type {Readonly<Record<Keyboard, string>>}
 */
const keysHint = { physical: 'Enter to send, Shift+Enter for a new line.', touch: 'The ↑ button sends, Enter starts a new line.' };
/**
 * While the agent works a message waits in its queue — or goes at once, past it, into the turn under way, or is set
 * aside for later, sent by hand once the turn is over (later-view.js). ⏩ on a waiting message is Claude Code's: the
 * page sees its queue.
 * @type {Readonly<Record<Agent, Readonly<Record<Keyboard, string>>>>}
 */
const busyKeysHint = {
  claude: { physical: 'Enter queues it, Ctrl+Enter sends it now, Alt+Enter sets it aside for later, Shift+Enter for a new line.', touch: 'The ↑ button queues it, Enter starts a new line; ⏩ on a waiting message sends the queue now.' },
  codex: { physical: 'Enter queues it, Ctrl+Enter sends it now, Alt+Enter sets it aside for later, Shift+Enter for a new line.', touch: 'The ↑ button queues it, Enter starts a new line.' },
};
/** @type {Readonly<Record<Agent, string>>} */
const agentNames = { claude: 'Claude', codex: 'Codex' };
/**
 * The program that asks in the terminal, by name.
 * @type {Readonly<Record<Agent, string>>}
 */
export const askerNames = { claude: 'Claude Code', codex: 'Codex' };
/**
 * What opens a closed session again in a terminal.
 * @type {Readonly<Record<Agent, (id: string) => string>>}
 */
const resumeCommands = { claude: (id) => `claude --resume ${id}`, codex: (id) => `codex resume ${id}` };

/**
 * @param {LiveState} live
 * @param {ComposedSession} session
 * @param {Keyboard} keyboard
 * @returns {ComposerView}
 */
export function composerState(live, session, keyboard) {
  switch (live.state) {
    case 'live': {
      // typed now, a prompt would land in the agent's dialog — its keys picking answers
      if (live.dialog !== undefined) return { shown: true, enabled: false, canInterrupt: false, canReopen: false, placeholder: `${askerNames[session.agent]} is asking — answer above`, hint: `Pick an answer above, or answer in the session's terminal (herdr pane ${live.pane}).` };
      // Codex's terminal shows a sub-agent's thread, whose input its parent controls
      if (live.status === 'subagent') return { shown: true, enabled: false, canInterrupt: false, canReopen: false, placeholder: 'Codex shows a sub-agent — switch its terminal to the main thread', hint: `In the session's terminal (herdr pane ${live.pane}), go back from the sub-agent to the main thread: then the box takes messages again.` };
      // and a side conversation — its /btw — which would take a message for a follow-up question
      if (live.status === 'side') return { shown: true, enabled: false, canInterrupt: false, canReopen: false, placeholder: 'Codex shows a side conversation — switch back with Ctrl+/', hint: `In the session's terminal (herdr pane ${live.pane}), Ctrl+/ goes back to the main thread: then the box takes messages again. A key the viewer can press there for you — such as F12, in Codex's config.toml: tui.keymap.global.toggle_side_conversation — lets it go back by itself after a side question.` };
      const busy = live.status === 'busy';
      return {
        shown: true,
        enabled: true,
        canInterrupt: busy,
        canReopen: false,
        placeholder: busy ? `${agentNames[session.agent]} is working — your message will be queued` : `Message ${agentNames[session.agent]}…`,
        hint: `${(busy ? busyKeysHint[session.agent] : keysHint)[keyboard]} The text goes to the session's terminal (herdr pane ${live.pane}).`,
      };
    }
    case 'herdr-missing':
      // Without herdr the session cannot be written to at all — the box is hidden so as not to promise what is unavailable.
      return { ...unavailable('herdr is not installed — write prompts in the terminal.'), shown: false };
    case 'offline':
      // the page offers to open it where it ran in the box's place; the hint tells the other way
      return { ...unavailable(`Or in a herdr pane: ${resumeCommands[session.agent](session.id)}`), canReopen: true };
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
 * @param {Agent} agent
 * @returns {string}
 */
export function stopMessage(outcome, agent) {
  if (outcome.ok) return outcome.prompt === undefined ? `Esc sent — ${agentNames[agent]} will stop the current turn.` : 'Stopped before Claude started on it — the message is back in the box.';
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
    case 'asking':
      return 'Codex is asking something in its terminal — answer it there first. The text stays in the box.';
    case 'subagent':
      return 'Codex’s terminal shows a sub-agent, which takes no input — switch it back to the main thread. The text stays in the box.';
    case 'side':
      return 'Codex’s terminal shows a side conversation — switch it back to the main thread with Ctrl+/. The text stays in the box.';
    case 'not-taken':
      return 'Codex did not take the message — it was taken back out of its terminal’s box. The text stays in the box.';
    case 'not-sent':
      return 'Claude Code kept the message in its box — Enter did not send it. Press Enter in the terminal, or clear its box before sending again. The text stays here too.';
    case 'not-typed':
      return 'The message did not show in Claude Code’s box — something on its screen took the keys, a dialog — so it was not sent. The text stays in the box.';
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
    case 'panel-closed':
      return 'The connection to the viewer was lost, and the side panel is no longer open in the terminal — its answer, if it came, is there.';
    default:
      return outcomeMessage({ ok: false, error });
  }
}

/**
 * @param {string} hint
 * @returns {ComposerView}
 */
function unavailable(hint) {
  return { shown: true, enabled: false, canInterrupt: false, canReopen: false, placeholder: 'Sending is unavailable', hint };
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
      return status === undefined || pane === undefined ? undefined : { state: 'live', status, pane, dialog: parseDialog(json.dialog), queued: queuedOf(json.queued) };
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
    case 'asking':
    case 'subagent':
    case 'side':
    case 'not-taken':
    case 'not-typed':
    case 'not-sent':
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
const btwRefusals = new Set(['empty', 'herdr-missing', 'offline', 'no-herdr', 'outside-herdr', 'screen-unreadable', 'box-not-empty', 'not-asked', 'no-answer', 'answer-unreadable', 'panel-closed']);

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

/**
 * What Codex queued, as /api/live tells it: a viewer from before it tells nothing — nothing queued.
 * @param {unknown} json
 * @returns {readonly string[]}
 */
function queuedOf(json) {
  return Array.isArray(json) ? json.flatMap((item) => (typeof item === 'string' ? [item] : [])) : [];
}
