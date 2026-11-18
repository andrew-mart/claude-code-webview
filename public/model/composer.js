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
 * @typedef {'claude' | 'codex' | 'agy'} Agent — whose session: Claude Code's, Codex's or Antigravity CLI's
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

/** @type {Readonly<Record<Agent, string>>} */
const agentNames = { claude: 'Claude', codex: 'Codex', agy: 'agy' };
/**
 * The program that asks in the terminal, by name.
 * @type {Readonly<Record<Agent, string>>}
 */
export const askerNames = { claude: 'Claude Code', codex: 'Codex', agy: 'Antigravity CLI' };
/**
 * What opens a closed session again in a terminal.
 * @type {Readonly<Record<Agent, (id: string) => string>>}
 */
const resumeCommands = { claude: (id) => `claude --resume ${id}`, codex: (id) => `codex resume ${id}`, agy: (id) => `agy --conversation ${id}` };

/**
 * @param {LiveState} live
 * @param {ComposedSession} session
 * @returns {ComposerView}
 */
export function composerState(live, session) {
  switch (live.state) {
    case 'live': {
      // typed now, a prompt would land in the agent's dialog — its keys picking answers
      if (live.dialog !== undefined) return { shown: true, enabled: false, canInterrupt: false, canReopen: false, placeholder: `${askerNames[session.agent]} is asking — answer above`, hint: `Pick an answer above, or answer in the session's terminal (herdr pane ${live.pane}).` };
      // Codex's terminal shows a sub-agent's thread, whose input its parent controls
      if (live.status === 'subagent') return { shown: true, enabled: false, canInterrupt: false, canReopen: false, placeholder: 'Codex shows a sub-agent — switch its terminal to the main thread', hint: `In the session's terminal (herdr pane ${live.pane}), go back from the sub-agent to the main thread: then the box takes messages again.` };
      // and a side conversation — its /btw — which would take a message for a follow-up question
      if (live.status === 'side') return { shown: true, enabled: false, canInterrupt: false, canReopen: false, placeholder: 'Codex shows a side conversation — switch back with Ctrl+/', hint: `In the session's terminal (herdr pane ${live.pane}), Ctrl+/ goes back to the main thread: then the box takes messages again. A key the viewer can press there for you — such as F12, in Codex's config.toml: tui.keymap.global.toggle_side_conversation — lets it go back by itself after a side question.` };
      const busy = live.status === 'busy';
      // how to send and where the text goes are known to whoever writes here: nothing is said of them
      return {
        shown: true,
        enabled: true,
        canInterrupt: busy,
        canReopen: false,
        placeholder: busy ? `${agentNames[session.agent]} is working — your message will be queued` : `Message ${agentNames[session.agent]}…`,
        hint: '',
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
 * @typedef {{ lost: number, after: string }} PromptCut — a prompt written down with a piece of the one sent gone: lost —
 *   how many characters; after — the last words before the gap, none where the start is gone
 */

/** What Claude Code may put where a character was broken: a piece of it gone with the rest. */
const brokenCharacter = '\uFFFD';

/** The shortest piece of a sent prompt a written one is taken to be made of: a shorter run any text has. */
const shortestPiece = 16;
/** The most pieces a written prompt is taken to be made of: of more, it is another text. */
const mostPieces = 12;

/**
 * A prompt sent from the box that the agent wrote down with pieces gone: Claude Code reads a long prompt from its
 * terminal a kilobyte at a time and, on Windows, now and then drops reads — one, several in a row, two apart — and
 * now and then takes the last one twice. What it writes down is then made of pieces of the prompt sent, in its words,
 * at most a broken character where a piece ends, and lacks some of it. Spaces and line ends do not count; words
 * changed, or two prompts written as one, are no cut: their text the prompt sent has not.
 * @param {string} sent — as the box sent it
 * @param {string} written — as the agent wrote it down
 * @returns {PromptCut | undefined}
 */
export function promptCut(sent, written) {
  const whole = oneSpaced(sent);
  const took = oneSpaced(written);
  if (took === '' || took === whole) return undefined;
  /** Where in the sent prompt each piece of the written one stands. @type {{ from: number, to: number }[]} */
  const pieces = [];
  let at = 0;
  while (at < took.length) {
    if (took[at] === brokenCharacter) {
      at += 1;
      continue;
    }
    const piece = longestPiece(whole, took, at);
    if (piece === undefined || pieces.length === mostPieces) return undefined;
    pieces.push({ from: piece.from, to: piece.from + piece.length });
    at += piece.length;
  }
  const { kept, firstGap } = keptOf(pieces, whole.length);
  if (kept === whole.length) return undefined;
  return { lost: whole.length - kept, after: whole.slice(0, firstGap).trim().split(' ').slice(-4).join(' ') };
}

/**
 * The longest run of the written prompt from a place that the sent one has, and where it stands there; none shorter
 * than a piece — but for the written prompt's last few characters, which the sent one has.
 * @param {string} whole — the prompt sent
 * @param {string} took — the prompt written down
 * @param {number} at
 * @returns {{ from: number, length: number } | undefined}
 */
function longestPiece(whole, took, at) {
  const rest = took.length - at;
  const least = Math.min(shortestPiece, rest);
  if (!whole.includes(took.slice(at, at + least))) return undefined;
  // a longer run had, every shorter one is: the longest is searched by halves
  let had = least;
  let hadNot = rest + 1;
  while (hadNot - had > 1) {
    const middle = Math.floor((had + hadNot) / 2);
    if (whole.includes(took.slice(at, at + middle))) had = middle;
    else hadNot = middle;
  }
  return { from: whole.indexOf(took.slice(at, at + had)), length: had };
}

/**
 * How much of the sent prompt the pieces hold — a piece come twice counted once — and where the first of it they do
 * not hold begins.
 * @param {readonly { from: number, to: number }[]} pieces
 * @param {number} length — the sent prompt's
 * @returns {{ kept: number, firstGap: number }}
 */
function keptOf(pieces, length) {
  let kept = 0;
  let reach = 0;
  let firstGap = length;
  for (const { from, to } of [...pieces].sort((a, b) => a.from - b.from)) {
    if (from > reach && firstGap === length) firstGap = reach;
    if (to > reach) {
      kept += to - Math.max(from, reach);
      reach = to;
    }
  }
  if (reach < length && firstGap === length) firstGap = reach;
  return { kept, firstGap };
}

/**
 * The prompt Claude Code got cut short, held whole by the viewer — Claude stopped on it — as the session's live state
 * carries it; none in a reply without it, or of another shape.
 * @param {unknown} json — the viewer's /api/live reply
 * @returns {{ text: string, cut: PromptCut } | undefined}
 */
export function parseHeldCut(json) {
  const held = isRecord(json) ? json.cut : undefined;
  if (!isRecord(held) || typeof held.text !== 'string' || typeof held.lost !== 'number' || typeof held.after !== 'string') return undefined;
  return { text: held.text, cut: { lost: held.lost, after: held.after } };
}

/**
 * @param {PromptCut} cut
 * @param {Agent} agent — the session's, that got the message so
 * @returns {string}
 */
export function promptCutMessage(cut, agent) {
  const gone = cut.after === '' ? `its first ${cut.lost} characters` : `${cut.lost} characters after “${cut.after}”`;
  return `${askerNames[agent]} got the message without ${gone}. The whole message is back in the box.`;
}

/** @param {string} text — its spaces and line ends one space each, none at its ends */
function oneSpaced(text) {
  return text.replace(/\s+/g, ' ').trim();
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
      return 'The agent shows something over its prompt box in its terminal — a question, a menu — answer or close it there first. The text stays in the box.';
    case 'subagent':
      return 'Codex’s terminal shows a sub-agent, which takes no input — switch it back to the main thread. The text stays in the box.';
    case 'side':
      return 'Codex’s terminal shows a side conversation — switch it back to the main thread with Ctrl+/. The text stays in the box.';
    case 'not-taken':
      return 'Codex did not take the message — it was taken back out of its terminal’s box. The text stays in the box.';
    case 'not-sent':
      return 'The agent kept the message in its box — Enter did not send it. Press Enter in the terminal, or clear its box before sending again. The text stays here too.';
    case 'not-typed':
      return 'The message did not show in the agent’s box — something on its screen took the keys, a dialog — so it was not sent. The text stays in the box.';
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
 * The box with a command an answer names put in — pressed (command-mentions.js): where its cursor is, a space between
 * it and the words around it where there is none.
 * @param {string} draft — the box
 * @param {string} command
 * @param {number} at — where the box's cursor is
 * @returns {{ text: string, at: number }} — at: the cursor, after the command
 */
export function withCommand(draft, command, at) {
  const before = draft.slice(0, at);
  const after = draft.slice(at);
  const lead = before === '' || /\s$/.test(before) ? before : `${before} `;
  return { text: `${lead}${command}${after === '' || /^\s/.test(after) ? '' : ' '}${after}`, at: lead.length + command.length };
}

/**
 * The box with words pasted from the clipboard: in place of what is selected in it — where its cursor is, nothing
 * selected — its lines as the box keeps them.
 * @param {string} draft — the box
 * @param {string} words — the clipboard's
 * @param {number} from — where the selection starts
 * @param {number} to — where it ends
 * @returns {{ text: string, at: number }} — at: the cursor, after the words
 */
export function withPasted(draft, words, from, to) {
  const lines = words.replace(/\r\n?/g, '\n');
  return { text: `${draft.slice(0, from)}${lines}${draft.slice(to)}`, at: from + lines.length };
}

/**
 * The box with a point of an answer added — a 👉 pressed (point-replies.js): after what is written, a blank line
 * between, and a blank line under it for the answer to be written there.
 * @param {string} draft — the box
 * @param {string} point — what the 👉 points at
 * @returns {string}
 */
export function withPoint(draft, point) {
  const written = draft.trimEnd();
  return `${written === '' ? '' : `${written}\n\n`}${point}\n\n`;
}

/**
 * The side question in the box: what follows "/btw" at its start, as the terminal takes it; empty for a bare "/btw".
 * agy has no side question the viewer drives: its box holds a prompt.
 * @param {string} text — the box
 * @param {Agent} agent — whose session
 * @returns {string | undefined} — none when the box holds an ordinary prompt
 */
export function sideQuestionOf(text, agent) {
  if (agent === 'agy') return undefined;
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
