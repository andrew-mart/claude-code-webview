// @ts-check
// Rewinding a live session from the page: Claude Code's /rewind menu, driven with keys in its terminal. Every step is
// checked against the screen, the message by its full text on the confirmation; on any surprise the menu is closed and
// nothing is restored.
import { isRecord } from '../public/model/narrow.js';
import { linkOf, rewoundEntries } from './branch.js';

/**
 * @typedef {'both' | 'conversation' | 'code' | 'summarize-from' | 'summarize-up-to'} RewindAction
 * @typedef {{ read: () => Promise<string | undefined>, keys: (...keys: string[]) => Promise<boolean>, text: (text: string) => Promise<boolean> }} Terminal
 * @typedef {'screen-unreadable' | 'box-not-cleared' | 'menu-not-shown' | 'message-not-found' | 'no-code-changes' | 'option-not-found' | 'not-finished'} RewindRefusal
 * @typedef {{ ok: true, restoredPrompt: boolean } | { ok: false, error: RewindRefusal }} RewindOutcome
 */

const listMarker = 'Restore the code and/or';
const confirmMarker = 'Confirm you want to';
/** The rule lines above and below Claude Code's prompt box. */
const rule = /^\s*─{4,}\s*$/;
/** Actions after which Claude Code puts the message back into the prompt box. */
const restoresPrompt = new Set(['both', 'conversation', 'summarize-from']);
/** How far from the counted position to look for the message: the menu may list a message or two the count did not. */
const searchSteps = [0, 1, -1, 2, -2, 3, -3];

/** @type {Readonly<Record<RewindAction, RegExp>>} */
const optionPatterns = {
  both: /(\d)\. Restore code and conversation/,
  conversation: /(\d)\. Restore conversation/,
  code: /(\d)\. Restore code(?! and)/,
  'summarize-from': /(\d)\. Summarize from here/,
  'summarize-up-to': /(\d)\. Summarize up to here/,
};

/**
 * The text in Claude Code's prompt box; undefined when the box is not on the screen (a menu or a dialog is open).
 * @param {string} screen
 * @returns {string | undefined}
 */
export function inputBox(screen) {
  const lines = screen.split('\n');
  const rules = lines.flatMap((line, index) => (rule.test(line) ? [index] : []));
  const [top, bottom] = rules.slice(-2);
  if (top === undefined || bottom === undefined) return undefined;
  const [first, ...rest] = lines.slice(top + 1, bottom).map((line) => line.trim());
  if (first === undefined || !first.startsWith('❯')) return undefined;
  return [first.slice(1), ...rest].join(' ').trim();
}

/**
 * Whether the confirmation names this message. Only the confirmation counts: the conversation above the menu may
 * show the same words.
 * @param {string} screen
 * @param {string} prompt
 * @returns {boolean}
 */
export function confirmShows(screen, prompt) {
  const at = screen.lastIndexOf(confirmMarker);
  const wanted = squash(prompt).slice(0, 60);
  return at >= 0 && wanted !== '' && squash(screen.slice(at + confirmMarker.length)).includes(wanted);
}

/**
 * The number key of the action, as the confirmation numbers it: without code changes the code options are gone.
 * @param {string} screen
 * @param {RewindAction} action
 * @returns {string | undefined}
 */
export function optionKey(screen, action) {
  const at = screen.lastIndexOf(confirmMarker);
  if (at < 0) return undefined;
  const options = screen.slice(at).replace(/[│❯↓]/g, ' ').replace(/\s+/g, ' ');
  return optionPatterns[action].exec(options)?.[1];
}

/**
 * @param {Terminal} terminal
 * @param {{ stepsUp: number, prompt: string, action: RewindAction, wait: (ms: number) => Promise<void> }} options
 *   stepsUp — how far above "(current)" the message should be: the messages sent after it, plus one
 * @returns {Promise<RewindOutcome>}
 */
export async function driveRewind(terminal, { stepsUp, prompt, action, wait }) {
  const settle = (/** @type {(screen: string) => boolean} */ ready) => settleOn(terminal, wait, ready);
  /** @param {RewindRefusal} error @returns {Promise<RewindOutcome>} */
  const refuse = async (error) => {
    await closeMenu(terminal, wait);
    return { ok: false, error };
  };

  const screen = await terminal.read();
  const box = screen === undefined ? undefined : inputBox(screen);
  if (box === undefined) return { ok: false, error: 'screen-unreadable' };
  // /rewind is typed into the box, so it has to be empty; what was there stays in the terminal's history (Up).
  if (box !== '') {
    await terminal.keys('esc', 'esc');
    if ((await settle((next) => inputBox(next) === '')) === undefined) return { ok: false, error: 'box-not-cleared' };
  }
  await terminal.text('/rewind');
  await terminal.keys('enter');
  if ((await settle((next) => next.includes(listMarker) && !next.includes(confirmMarker))) === undefined) return refuse('menu-not-shown');

  const confirmation = await findMessage(terminal, { stepsUp, prompt, settle });
  if (confirmation === undefined) return refuse('message-not-found');
  const key = optionKey(confirmation, action);
  if (key === undefined) return refuse(action === 'both' || action === 'code' ? 'no-code-changes' : 'option-not-found');
  await terminal.keys(key);
  const after = await settle((next) => !next.includes(listMarker) && !next.includes(confirmMarker));
  if (after === undefined) return refuse('not-finished');

  // The message comes back into the terminal's box a moment after the menu closes: the page takes it over and the box
  // is emptied (the text stays in the terminal's history).
  if (!restoresPrompt.has(action)) return { ok: true, restoredPrompt: false };
  const back = await settle((next) => squash(inputBox(next) ?? '').startsWith(squash(prompt).slice(0, 40)));
  if (back === undefined) return { ok: true, restoredPrompt: false };
  await terminal.keys('esc', 'esc');
  await settle((next) => inputBox(next) === '');
  return { ok: true, restoredPrompt: true };
}

/**
 * Moves to the counted message and opens its confirmation; if it names another message, tries the neighbours.
 * @param {Terminal} terminal
 * @param {{ stepsUp: number, prompt: string, settle: (ready: (screen: string) => boolean) => Promise<string | undefined> }} options
 * @returns {Promise<string | undefined>} — the confirmation screen of the message
 */
async function findMessage(terminal, { stepsUp, prompt, settle }) {
  const furthest = stepsUp + Math.max(...searchSteps);
  for (const step of searchSteps) {
    const target = stepsUp + step;
    // "(current)" is at zero: Enter there does not open a confirmation
    if (target < 1) continue;
    // The list stops at its ends, so going down past the bottom lands on "(current)" whatever the list's length.
    await terminal.keys(...repeat('down', furthest), ...repeat('up', target));
    await terminal.keys('enter');
    const confirmation = await settle((screen) => screen.includes(confirmMarker));
    if (confirmation !== undefined && confirmShows(confirmation, prompt)) return confirmation;
    if (confirmation !== undefined) {
      await terminal.keys('esc');
      await settle((screen) => screen.includes(listMarker) && !screen.includes(confirmMarker));
    }
  }
  return undefined;
}

/**
 * Leaves the menu, from the confirmation or the list, back to the prompt box.
 * @param {Terminal} terminal
 * @param {(ms: number) => Promise<void>} wait
 */
async function closeMenu(terminal, wait) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const screen = await terminal.read();
    if (screen === undefined || (!screen.includes(listMarker) && !screen.includes(confirmMarker))) return;
    await terminal.keys('esc');
    await wait(stepMs);
  }
}

const stepMs = 150;
const settleTries = 20;

/**
 * The screen once it is ready; undefined if it is not within a few seconds.
 * @param {Terminal} terminal
 * @param {(ms: number) => Promise<void>} wait
 * @param {(screen: string) => boolean} ready
 * @returns {Promise<string | undefined>}
 */
async function settleOn(terminal, wait, ready) {
  for (let attempt = 0; attempt < settleTries; attempt++) {
    const screen = await terminal.read();
    if (screen !== undefined && ready(screen)) return screen;
    await wait(stepMs);
  }
  return undefined;
}

/**
 * @param {string} key
 * @param {number} times
 * @returns {string[]}
 */
function repeat(key, times) {
  return Array.from({ length: times }, () => key);
}

/**
 * Text without whitespace, frame bars and ellipses: the terminal wraps and frames lines at its own width.
 * @param {string} text
 */
function squash(text) {
  return text.replace(/[\s│…]/g, '');
}

/**
 * Where the message is in the rewind menu and what its confirmation shows. The menu lists the messages of the active
 * branch; slash commands, interrupt marks and tool results are not among them. The count is checked against the
 * confirmation anyway (driveRewind), so a message the menu lists differently costs a step, not a wrong rewind.
 * @param {readonly unknown[]} records — the transcript entries in file order
 * @param {string} uuid — the message to rewind to
 * @returns {{ stepsUp: number, prompt: string } | undefined} — undefined if the menu would not list it
 */
export function rewindTarget(records, uuid) {
  const links = records.map(linkOf);
  const hidden = rewoundEntries(links, undefined);
  const listed = records.flatMap((raw, index) => {
    const link = links[index];
    const prompt = link?.turn === true && link.uuid !== undefined && !hidden.has(link.uuid) && isRecord(raw) && raw.isCompactSummary !== true ? promptText(raw) : undefined;
    return prompt === undefined || link?.uuid === undefined || !isMenuPrompt(prompt) ? [] : [{ uuid: link.uuid, prompt }];
  });
  const index = listed.findIndex((entry) => entry.uuid === uuid);
  const target = listed[index];
  return target === undefined ? undefined : { stepsUp: listed.length - index, prompt: target.prompt };
}

/**
 * @param {Record<string, unknown>} raw
 * @returns {string | undefined}
 */
function promptText(raw) {
  const content = isRecord(raw.message) ? raw.message.content : undefined;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return undefined;
  const texts = content.flatMap((block) => (isRecord(block) && block.type === 'text' && typeof block.text === 'string' ? [block.text] : []));
  return texts.length === 0 ? undefined : texts.join('\n');
}

/**
 * @param {string} text
 */
function isMenuPrompt(text) {
  return !/^\s*(?:<command-name>|<command-message>|<local-command-|<bash-|<task-notification>|\[Request interrupted)/.test(text);
}
