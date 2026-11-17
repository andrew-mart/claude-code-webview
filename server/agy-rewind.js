// @ts-check
// Rewinding an agy conversation from the page: agy's /rewind, driven with keys in its terminal. Its panel lists the
// user's messages under the box — each cut short, how long ago under it — over "(current)" (read off a live pane of agy
// 1.5.4). Enter on a message rewinds at once — the conversation, and the files changed since — and puts the message
// back into the box: there is no confirmation to check, so the row under the cursor is checked against the message
// before Enter, once the cursor stands still. On any surprise the panel is closed and nothing is rewound.
import { agyInputBox, rewindRows } from './agy-screen.js';
import { settleOn, squash, stepMs } from './claude-screen.js';

/** How far from the counted row to look for the message: the panel may list a message or two the count did not. */
const searchSteps = [0, 1, -1, 2, -2, 3, -3];
/** Backspaces sent at once, erasing agy's box. */
const eraseChunk = 100;
/** Looks at the panel for its cursor to stand still. */
const stillLooks = 20;

/**
 * @param {import('./claude-screen.js').Terminal} terminal
 * @param {{ stepsUp: number, prompt: string, wait: (ms: number) => Promise<void> }} options — stepsUp: how many of the
 *   listed messages up from "(current)" the one to rewind to is, the newest one up; prompt: its text
 * @returns {Promise<import('./rewind.js').RewindOutcome>}
 */
export async function driveAgyRewind(terminal, { stepsUp, prompt, wait }) {
  const settle = (/** @type {(screen: string) => boolean} */ ready) => settleOn(terminal, wait, ready);
  /** @param {import('./rewind.js').RewindRefusal} error @returns {Promise<import('./rewind.js').RewindOutcome>} */
  const refuse = async (error) => {
    await closePanel(terminal, wait);
    return { ok: false, error };
  };

  const screen = await terminal.read();
  const box = screen === undefined ? undefined : agyInputBox(screen);
  if (box === undefined) return { ok: false, error: 'screen-unreadable' };
  // /rewind is typed into the box, so it has to be empty
  if (box !== '') {
    await erase(terminal, box.length);
    if ((await settle((next) => agyInputBox(next) === '')) === undefined) return { ok: false, error: 'box-not-cleared' };
  }
  await terminal.text('/rewind');
  await terminal.keys('enter');
  if ((await settle((next) => rewindRows(next) !== undefined)) === undefined) return refuse('menu-not-shown');
  if (!(await moveToMessage(terminal, { stepsUp, prompt, wait }))) return refuse('message-not-found');
  await terminal.keys('enter');
  if ((await settle((next) => rewindRows(next) === undefined)) === undefined) return refuse('not-finished');

  // the message comes back into agy's box: the page takes it over, and the box is emptied
  const back = await settle((next) => squash(agyInputBox(next) ?? '').startsWith(squash(prompt).slice(0, 40)));
  if (back === undefined) return { ok: true, restoredPrompt: false };
  await erase(terminal, Math.max(prompt.length, (agyInputBox(back) ?? '').length) + 10);
  await settle((next) => agyInputBox(next) === '');
  return { ok: true, restoredPrompt: true };
}

/**
 * Moves the cursor to the counted message, checked against the row it stands on; if that row is another message, tries
 * the rows around it.
 * @param {import('./claude-screen.js').Terminal} terminal
 * @param {{ stepsUp: number, prompt: string, wait: (ms: number) => Promise<void> }} options
 * @returns {Promise<boolean>} — whether the cursor is on the message
 */
async function moveToMessage(terminal, { stepsUp, prompt, wait }) {
  const furthest = stepsUp + Math.max(...searchSteps);
  for (const step of searchSteps) {
    const target = stepsUp + step;
    // "(current)" is at zero: Enter there rewinds nothing
    if (target < 1) continue;
    // the list stops at its ends: down past the bottom lands on "(current)" whatever its length
    await terminal.keys(...repeat('down', furthest), ...repeat('up', target));
    const chosen = await cursorAtRest(terminal, wait);
    if (chosen !== undefined && names(chosen.text, prompt)) return true;
  }
  return false;
}

/**
 * The row under the cursor once agy has done with the keys: the same on two looks one after another.
 * @param {import('./claude-screen.js').Terminal} terminal
 * @param {(ms: number) => Promise<void>} wait
 * @returns {Promise<{ text: string, when: string | undefined, current: boolean } | undefined>}
 */
async function cursorAtRest(terminal, wait) {
  /** @type {number | undefined} */
  let before;
  for (let look = 0; look < stillLooks; look++) {
    await wait(stepMs);
    const screen = await terminal.read();
    const rows = screen === undefined ? undefined : rewindRows(screen);
    const at = rows?.findIndex((row) => row.current);
    if (rows !== undefined && at !== undefined && at !== -1 && at === before) return rows[at];
    before = at;
  }
  return undefined;
}

/**
 * Whether a row of the panel names the message: agy cuts it short with "..." — a letter cut in two shown as � — and
 * spaces it its own way.
 * @param {string} row
 * @param {string} prompt
 */
function names(row, prompt) {
  const shown = squash(row.replace(/\.\.\.$/, '').replaceAll('\uFFFD', ''));
  return shown !== '' && squash(prompt).startsWith(shown);
}

/**
 * Leaves the panel back to the box.
 * @param {import('./claude-screen.js').Terminal} terminal
 * @param {(ms: number) => Promise<void>} wait
 */
async function closePanel(terminal, wait) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const screen = await terminal.read();
    if (screen === undefined || rewindRows(screen) === undefined) return;
    await terminal.keys('esc');
    await wait(stepMs);
  }
}

/**
 * @param {import('./claude-screen.js').Terminal} terminal
 * @param {number} count — the characters to erase
 */
async function erase(terminal, count) {
  for (let left = count; left > 0; left -= eraseChunk) await terminal.keys(...repeat('backspace', Math.min(eraseChunk, left)));
}

/**
 * @param {string} key
 * @param {number} times
 * @returns {string[]}
 */
function repeat(key, times) {
  return Array.from({ length: times }, () => key);
}
