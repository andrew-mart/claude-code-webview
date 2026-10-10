// @ts-check
// Page view settings: their options and the labels of the buttons that switch them.

/** Options of each setting; the first is the default, the button cycles through them. */
export const choices = /** @type {const} */ ({
  activity: ['compact', 'detailed'],
  outline: ['shown', 'hidden'],
  theme: ['auto', 'light', 'dark'],
  font: ['sans', 'serif'],
  service: ['hidden', 'shown'],
  follow: ['off', 'on'],
  sdk: ['hidden', 'shown'],
  tables: ['fit', 'wide'],
});

/**
 * @typedef {keyof typeof choices} SettingKey
 */

/** What the click leads to: the button label names the next option, not the current one. */
/** @type {Readonly<Record<SettingKey, Readonly<Record<string, string>>>>} */
const resultNames = {
  activity: { compact: 'Show briefly', detailed: 'Show in detail' },
  outline: { shown: 'Show outline', hidden: 'Hide outline' },
  theme: { auto: 'System theme', light: 'Light theme', dark: 'Dark theme' },
  font: { serif: 'Serif answers', sans: 'Sans-serif answers' },
  service: { hidden: 'Hide Claude Code service messages', shown: 'Show Claude Code service messages' },
  follow: { off: 'Stop following the active session', on: 'Follow the active session' },
  sdk: { hidden: 'Hide SDK sessions', shown: 'Show SDK sessions' },
  tables: { fit: 'Fit tables to the width everywhere', wide: 'Widen tables everywhere' },
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
