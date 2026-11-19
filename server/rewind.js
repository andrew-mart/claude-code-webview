// @ts-check
// Rewinding a live session from the page: Claude Code's /rewind menu, driven with keys in its terminal. Every step is
// checked against the screen, the message by its full text on the confirmation; on any surprise the menu is closed and
// nothing is restored.
import { isRecord } from '../public/model/narrow.js';
import { linkOf, promptText, rewoundEntries } from './branch.js';
import { inputBox, settleOn, settleWithin, squash, stepMs } from './claude-screen.js';

/**
 * @typedef {'both' | 'conversation' | 'code' | 'summarize-from' | 'summarize-up-to'} RewindAction
 * @typedef {import('./claude-screen.js').Terminal} Terminal
 * @typedef {'screen-unreadable' | 'box-not-cleared' | 'menu-not-shown' | 'message-not-found' | 'no-code-changes' | 'option-not-found' | 'not-finished'} RewindRefusal
 * @typedef {{ ok: true, restoredPrompt: boolean } | { ok: false, error: RewindRefusal }} RewindOutcome
 */

const listMarker = 'Restore the code and/or';
/** How the confirmation opens: "Restore to the point before you sent this message:" since Claude Code 2.1.32x. */
const confirmOpening = /Restore to the point|Confirm you want to/g;
/** Actions after which Claude Code puts the message back into the prompt box. */
/** @type {ReadonlySet<RewindAction>} */
const restoresPrompt = new Set(['both', 'conversation', 'summarize-from']);
/** How long a summary from the message may take the model before Claude Code puts the message back into its box. */
const summaryMs = 180_000;
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
 * Whether the confirmation names this message. Only the confirmation counts: the conversation above the menu may
 * show the same words.
 * @param {string} screen
 * @param {string} prompt
 * @returns {boolean}
 */
export function confirmShows(screen, prompt) {
  const from = confirmFrom(screen);
  const wanted = squash(prompt).slice(0, 60);
  return from !== undefined && wanted !== '' && squash(screen.slice(from)).includes(wanted);
}

/**
 * Where the confirmation's words start, right after its opening — the last one, under the conversation; none while the
 * confirmation is not shown.
 * @param {string} screen
 * @returns {number | undefined}
 */
function confirmFrom(screen) {
  const last = [...screen.matchAll(confirmOpening)].at(-1);
  return last?.index === undefined ? undefined : last.index + last[0].length;
}

/** @param {string} screen */
const showsConfirm = (screen) => confirmFrom(screen) !== undefined;

/** A message's age as the confirmation tells it: (20s ago), (9m ago), (8h ago), (2d ago). */
const shownAge = /\((\d+)([smhd]) ago\)/;

/** How much older a message may look on its confirmation than when the rewind began: the menu gone through key by key. */
const keysMs = 60_000;

/**
 * Whether the age the confirmation shows fits the message's: one sent again word for word, hours apart, is told apart
 * so. A unit either way: Claude Code rounds as it does; and older by the time of the keys. With no age shown, or none
 * known, the words alone tell.
 * @param {string} screen
 * @param {number | undefined} sentAt — when the message was sent, ms; none when the transcript has no time for it
 * @param {number} now — when the rewind began, ms
 * @returns {boolean}
 */
function ageFits(screen, sentAt, now) {
  const from = confirmFrom(screen);
  const found = from === undefined ? null : shownAge.exec(screen.slice(from));
  if (found === null || sentAt === undefined) return true;
  const unit = found[2] === 's' ? 1000 : found[2] === 'm' ? 60_000 : found[2] === 'h' ? 3_600_000 : 86_400_000;
  const shown = Number(found[1]);
  const elapsed = now - sentAt;
  return elapsed >= (shown - 1) * unit - keysMs && elapsed < (shown + 2) * unit;
}

/**
 * The number key of the action, as the confirmation numbers it: without code changes the code options are gone.
 * @param {string} screen
 * @param {RewindAction} action
 * @returns {string | undefined}
 */
export function optionKey(screen, action) {
  const from = confirmFrom(screen);
  if (from === undefined) return undefined;
  const options = screen.slice(from).replace(/[│❯↓]/g, ' ').replace(/\s+/g, ' ');
  return optionPatterns[action].exec(options)?.[1];
}

/** The menu's title, on a line of its own under the rule over it. */
const menuTitle = /^\s*Rewind\s*$/;
/** The keys the list of messages takes, under it; the confirmation tells none. */
const listKeys = /Enter to continue · Esc to cancel/;
/** An action of the confirmation: its digit — the cursor ❯ on the one chosen, ↓ on the last shown of more. */
const actionLine = /^\s*([❯↓])?\s*(\d)\.\s+(.*\S)\s*$/;

/**
 * Claude Code's /rewind — typed in the page's box, it opens in the terminal — as the page shows it and answers it: the
 * messages sent, each with what rewinding it does to the code, "(current)" last, gone along with the arrows, Enter
 * opening one; or the confirmation of one, its actions picked by digit, Esc back to the messages. None for any other
 * screen, nor for the narrow list of earlier Claude Code, its messages not set apart by blank lines.
 * @param {string} screen
 * @returns {import('../public/model/dialog.js').Dialog | undefined}
 */
export function rewindDialog(screen) {
  const lines = screen.split('\n');
  const top = lines.findLastIndex((line) => menuTitle.test(line));
  if (top === -1) return undefined;
  const panel = lines.slice(top + 1);
  return confirmationDialog(panel) ?? messagesDialog(panel) ?? nothingDialog(panel);
}

/**
 * /rewind with nothing to rewind to — a conversation summarized up to its last message — says so, to be left with Esc.
 * @param {readonly string[]} panel — the menu's lines under its title
 * @returns {import('../public/model/dialog.js').Dialog | undefined}
 */
function nothingDialog(panel) {
  const said = panel.find((line) => /^\s*Nothing to rewind to/.test(line));
  return said === undefined || !panel.some((line) => /^\s*Esc to cancel\s*$/.test(line)) ? undefined : { lines: ['Rewind', said.trim()], options: [], tabs: false, previews: false, goesBack: true };
}

/**
 * The list of messages: the lines over them, then each message a block of its own — its words, the cursor on the one
 * chosen, and under them what rewinding it does to the code.
 * @param {readonly string[]} panel — the menu's lines under its title
 * @returns {import('../public/model/dialog.js').Dialog | undefined}
 */
function messagesDialog(panel) {
  const head = panel.findIndex((line) => line.includes(listMarker));
  const keys = panel.findLastIndex((line) => listKeys.test(line));
  if (head === -1 || keys < head) return undefined;
  const [said = [], ...messages] = blocksOf(panel.slice(head, keys));
  const options = messages.map(([first = '', ...under]) => {
    const words = first.trim();
    return { key: '', label: words.replace(/^❯\s+/, ''), detail: under.length === 0 ? undefined : under.map((line) => line.trim()).join(' '), checked: undefined, current: words.startsWith('❯') };
  });
  return options.length === 0 ? undefined : { lines: ['Rewind', said.map((line) => line.trim()).join(' ')], options, tabs: false, previews: true };
}

/**
 * The confirmation of a message: what it says — the message and how long ago it was sent, each in its frame │, what
 * rewinding does — the actions, numbered, and what it warns of under them.
 * @param {readonly string[]} panel — the menu's lines under its title
 * @returns {import('../public/model/dialog.js').Dialog | undefined}
 */
function confirmationDialog(panel) {
  const opening = panel.findIndex((line) => line.search(confirmOpening) !== -1);
  const first = panel.findIndex((line, at) => at > opening && actionLine.test(line));
  if (opening === -1 || first === -1) return undefined;
  let last = first;
  while (actionLine.test(panel[last + 1] ?? '')) last++;
  const options = panel.slice(first, last + 1).flatMap((line) => {
    const action = actionLine.exec(line);
    return action === null ? [] : [{ key: action[2] ?? '', label: action[3] ?? '', detail: undefined, checked: undefined, current: action[1] === '❯' }];
  });
  return { lines: ['Rewind', ...framedJoined(panel.slice(opening, first)), ...panel.slice(last + 1).map((line) => line.trim()).filter((line) => line !== '')], options, tabs: false, previews: false, goesBack: true };
}

/**
 * Lines as the page tells them: blank ones gone, the frame │ taken off, a message the terminal broke over several framed
 * lines joined again — its age, framed too, a line of its own.
 * @param {readonly string[]} lines
 * @returns {string[]}
 */
function framedJoined(lines) {
  /** @type {string[]} */
  const said = [];
  let framing = false;
  for (const line of lines) {
    const text = line.trim();
    const framed = text.startsWith('│');
    const words = framed ? text.slice(1).trim() : text;
    const previous = said.at(-1);
    if (text === '') {
      framing = false;
      continue;
    }
    if (framed && framing && previous !== undefined && !shownAge.test(words) && !shownAge.test(previous)) said[said.length - 1] = `${previous} ${words}`;
    else said.push(words);
    framing = framed;
  }
  return said;
}

/**
 * Lines in blocks, blank lines between them.
 * @param {readonly string[]} lines
 * @returns {string[][]}
 */
function blocksOf(lines) {
  /** @type {string[][]} */
  const blocks = [[]];
  for (const line of lines) {
    const block = blocks.at(-1);
    if (line.trim() === '') blocks.push([]);
    else block?.push(line);
  }
  return blocks.filter((block) => block.length > 0);
}

/**
 * @param {Terminal} terminal
 * @param {{ stepsUp: number, prompt: string, sentAt: number | undefined, now: number, action: RewindAction, wait: (ms: number) => Promise<void> }} options
 *   stepsUp — how far above "(current)" the message should be: the messages sent after it, plus one; sentAt — when it
 *   was sent, ms, none when not known; now — ms
 * @returns {Promise<RewindOutcome>}
 */
export async function driveRewind(terminal, { stepsUp, prompt, sentAt, now, action, wait }) {
  const settle = (/** @type {(screen: string) => boolean} */ ready) => settleOn(terminal, wait, ready);
  /** @param {RewindRefusal} error @returns {Promise<RewindOutcome>} */
  const refuse = async (error) => {
    await closeMenu(terminal, wait);
    return { ok: false, error };
  };

  // a /rewind menu left open — typed in the page's box, where the page cannot go on with it — is closed first
  await closeMenu(terminal, wait);
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
  if ((await settle((next) => next.includes(listMarker) && !showsConfirm(next))) === undefined) return refuse('menu-not-shown');

  const confirmation = await findMessage(terminal, { stepsUp, prompt, fits: (screen) => ageFits(screen, sentAt, now), settle });
  if (confirmation === undefined) return refuse('message-not-found');
  // without code changes the menu has no code options: the code and the conversation restored is the conversation
  const chosen = action === 'both' && optionKey(confirmation, 'both') === undefined ? 'conversation' : action;
  const key = optionKey(confirmation, chosen);
  if (key === undefined) return refuse(chosen === 'code' ? 'no-code-changes' : 'option-not-found');
  await terminal.keys(key);
  const after = await settle((next) => !next.includes(listMarker) && !showsConfirm(next));
  if (after === undefined) return refuse('not-finished');

  // The message comes back into the terminal's box a moment after the menu closes: the page takes it over and the box
  // is emptied (the text stays in the terminal's history).
  if (!restoresPrompt.has(action)) return { ok: true, restoredPrompt: false };
  return { ok: true, restoredPrompt: await takeBackPrompt(terminal, prompt, { action, wait }) };
}

/**
 * The action these keys pick, answering the rewind's confirmation on this screen — from the page's card — if it puts
 * the message back into Claude Code's box: its conversation restored, or summarized from it; none for any other.
 * @param {string} screen
 * @param {readonly import('../public/model/dialog.js').DialogStep[]} steps
 * @returns {RewindAction | undefined}
 */
export function messagePutBackBy(screen, steps) {
  const [step, ...more] = steps;
  return step === undefined || more.length > 0 || !('key' in step) ? undefined : [...restoresPrompt].find((action) => optionKey(screen, action) === step.key);
}

/**
 * The message Claude Code put back into its box, once the box shows it — at once, or once a summary from it is
 * written — taken out of it, Esc twice, for the page's box (the text stays in the terminal's history).
 * @param {Terminal} terminal
 * @param {string} prompt — the message, whole
 * @param {{ action: RewindAction, wait: (ms: number) => Promise<void> }} options — action: the one that put it back
 * @returns {Promise<boolean>} — whether it came back and was taken out
 */
export async function takeBackPrompt(terminal, prompt, { action, wait }) {
  const settle = (/** @type {(screen: string) => boolean} */ ready) => settleOn(terminal, wait, ready);
  /** @param {string} next */
  const shown = (next) => squash(inputBox(next) ?? '').startsWith(squash(prompt).slice(0, 40));
  const back = action === 'summarize-from' ? await settleWithin(terminal, wait, shown, Math.ceil(summaryMs / stepMs)) : await settle(shown);
  if (back === undefined) return false;
  await terminal.keys('esc', 'esc');
  await settle((next) => inputBox(next) === '');
  return true;
}

/**
 * Moves to the counted message and opens its confirmation; if it names another message — other words, or the same
 * words sent at another time — tries the neighbours.
 * @param {Terminal} terminal
 * @param {{ stepsUp: number, prompt: string, fits: (screen: string) => boolean, settle: (ready: (screen: string) => boolean) => Promise<string | undefined> }} options
 *   fits — whether the confirmation's age is the message's
 * @returns {Promise<string | undefined>} — the confirmation screen of the message
 */
async function findMessage(terminal, { stepsUp, prompt, fits, settle }) {
  const furthest = stepsUp + Math.max(...searchSteps);
  for (const step of searchSteps) {
    const target = stepsUp + step;
    // "(current)" is at zero: Enter there does not open a confirmation
    if (target < 1) continue;
    // The list stops at its ends, so going down past the bottom lands on "(current)" whatever the list's length.
    await terminal.keys(...repeat('down', furthest), ...repeat('up', target));
    await terminal.keys('enter');
    const confirmation = await settle((screen) => showsConfirm(screen));
    if (confirmation !== undefined && confirmShows(confirmation, prompt) && fits(confirmation)) return confirmation;
    if (confirmation !== undefined) {
      await terminal.keys('esc');
      await settle((screen) => screen.includes(listMarker) && !showsConfirm(screen));
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
    // the box shown, the menu is not: the same words may stand in the conversation, and Esc twice there rewinds
    if (screen === undefined || inputBox(screen) !== undefined || (!screen.includes(listMarker) && !showsConfirm(screen))) return;
    await terminal.keys('esc');
    await wait(stepMs);
  }
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
 * Where the message is in the rewind menu and what its confirmation shows. The menu lists the messages of the active
 * branch; slash commands, interrupt marks and tool results are not among them. The count is checked against the
 * confirmation anyway (driveRewind), so a message the menu lists differently costs a step, not a wrong rewind.
 * @param {readonly unknown[]} records — the transcript entries in file order
 * @param {string} uuid — the message to rewind to
 * @returns {{ stepsUp: number, prompt: string, sentAt: number | undefined } | undefined} — sentAt: when it was sent, ms,
 *   as its record tells — the confirmation tells its age; undefined if the menu would not list it
 */
export function rewindTarget(records, uuid) {
  const listed = menuListed(records);
  const index = listed.findIndex((entry) => entry.uuid === uuid);
  const target = listed[index];
  return target === undefined ? undefined : { stepsUp: listed.length - index, prompt: target.prompt, sentAt: target.sentAt };
}

/**
 * The messages the rewind menu lists, in its order, as the transcript has them, whole: the page's box takes one back.
 * @param {readonly unknown[]} records — the transcript entries in file order
 * @returns {string[]}
 */
export function menuPrompts(records) {
  return menuListed(records).map((entry) => entry.prompt);
}

/**
 * The messages the menu lists: those of the active branch the user sent — no slash commands, interrupt marks, tool
 * results — each with when it was sent, ms, as its record tells.
 * @param {readonly unknown[]} records — the transcript entries in file order
 * @returns {{ uuid: string, prompt: string, sentAt: number | undefined }[]}
 */
function menuListed(records) {
  const links = records.map(linkOf);
  const hidden = rewoundEntries(links, undefined);
  return records.flatMap((raw, index) => {
    const link = links[index];
    const prompt = link?.turn === true && link.uuid !== undefined && !hidden.has(link.uuid) && isRecord(raw) && raw.isCompactSummary !== true ? promptText(raw) : undefined;
    const sentAt = isRecord(raw) && typeof raw.timestamp === 'string' ? Date.parse(raw.timestamp) : Number.NaN;
    return prompt === undefined || link?.uuid === undefined || !isMenuPrompt(prompt) ? [] : [{ uuid: link.uuid, prompt, sentAt: Number.isFinite(sentAt) ? sentAt : undefined }];
  });
}

/**
 * @param {string} text
 */
function isMenuPrompt(text) {
  return !/^\s*(?:<command-name>|<command-message>|<local-command-|<bash-|<task-notification>|\[Request interrupted)/.test(text);
}
