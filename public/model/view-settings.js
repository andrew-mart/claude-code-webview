// @ts-check
// Page view settings: their options and the labels of the buttons that switch them.

/** The sizes of text — the conversation's, the notes' — in percent of the usual one, the usual one first. */
const textSizeChoices = /** @type {const} */ (['100', '85', '90', '110', '120', '135', '150']);

/** Options of each setting; the first is the default, the button cycles through them. */
export const choices = /** @type {const} */ ({
  activity: ['compact', 'detailed'],
  edits: ['folded', 'shown'],
  outline: ['shown', 'hidden'],
  theme: ['auto', 'light', 'dark'],
  service: ['hidden', 'shown'],
  follow: ['off', 'on'],
  sdk: ['hidden', 'shown'],
  tables: ['fit', 'wide'],
  width: ['column', 'full'],
  copy: ['plain', 'markdown'],
  lamps: ['robots', 'lamps'],
  workspaces: ['flat', 'grouped'],
  sidebar: ['herdr', 'sessions'],
  closed: ['all', 'only'],
  notes: ['live', 'blocks'],
  // the conversation's text, and the notes', in percent of the usual size: made smaller or larger a step at a time
  // (textSizeStep)
  size: textSizeChoices,
  noteSize: textSizeChoices,
});

/**
 * @typedef {keyof typeof choices} SettingKey
 */

/** What the click leads to: the button label names the next option, not the current one. */
/** @type {Readonly<Record<SettingKey, Readonly<Record<string, string>>>>} */
const resultNames = {
  activity: { compact: 'Show briefly', detailed: 'Show in detail' },
  edits: { folded: 'Fold edits into the brief summary', shown: 'Show edits even when brief' },
  outline: { shown: 'Show outline', hidden: 'Hide outline' },
  theme: { auto: 'System theme', light: 'Light theme', dark: 'Dark theme' },
  service: { hidden: 'Hide Claude Code service messages', shown: 'Show Claude Code service messages' },
  follow: { off: 'Stop following the active session', on: 'Follow the active session' },
  sdk: { hidden: 'Hide SDK sessions', shown: 'Show SDK sessions' },
  tables: { fit: 'Fit tables to the width everywhere', wide: 'Widen tables everywhere' },
  width: { column: 'Show the conversation in a column', full: 'Show the conversation at full width' },
  copy: { markdown: 'Ctrl+C copies selections as markdown, as Ctrl+Shift+C does', plain: 'Ctrl+C copies selections as plain text — Ctrl+Shift+C as markdown' },
  lamps: { robots: 'Show robots at work and at rest', lamps: 'Show lamps instead of robots' },
  workspaces: { flat: 'List sessions by time', grouped: 'Group sessions by herdr workspace' },
  sidebar: { herdr: "Show herdr's workspaces and tabs", sessions: 'Show every session' },
  closed: { all: 'List every session', only: 'List only the sessions closed in herdr' },
  notes: { live: 'Edit notes with a live preview, as Obsidian does (CodeMirror)', blocks: 'Edit notes as blocks, as Notion does (Milkdown)' },
  size: {},
  noteSize: {},
};

/**
 * @param {SettingKey} key
 * @param {string} current
 * @returns {string}
 */
export function nextChoice(key, current) {
  /** @type {readonly string[]} */
  const options = choices[key];
  return options[(options.indexOf(current) + 1) % options.length] ?? current;
}

/**
 * The setting button's label is the action the click performs.
 * @param {SettingKey} key
 * @param {string} current
 * @returns {string}
 */
export function actionLabel(key, current) {
  return resultNames[key][nextChoice(key, current)] ?? '';
}

/** The conversation's text sizes, in percent of the usual one, the smallest first. */
/** @type {readonly string[]} */
const textSizes = [...choices.size].sort((one, other) => Number(one) - Number(other));

/**
 * The conversation's text size a step smaller or larger; at either end of the sizes, the same — one not among them, kept
 * by an older page, goes from the usual size.
 * @param {string} current — as the browser keeps it
 * @param {-1 | 1} step — -1: smaller; 1: larger
 * @returns {string}
 */
export function textSizeStep(current, step) {
  const at = textSizes.indexOf(current);
  const from = at === -1 ? textSizes.indexOf(choices.size[0]) : at;
  return textSizes[Math.min(textSizes.length - 1, Math.max(0, from + step))] ?? current;
}
