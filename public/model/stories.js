// @ts-check
// The stories an agent at work is shown in (view/robot.js): robots building robots, coins mined out of a rock, a
// money tree watered into coins for a safe, a rocket built and launched, coding over coffee, a pole dance with bills
// flying in. Each workspace has its own — herdr's by its number, in turn, so the first six are each different; a
// session out of herdr by its folder — the same each time it is drawn, so a workspace's sessions all show it and a
// session tells its project at a glance.

/**
 * @typedef {'assembly' | 'mine' | 'garden' | 'rocket' | 'coffee' | 'pole'} Story
 * @typedef {'thumbs-up' | 'joint' | 'cocktail' | 'popper' | 'notes'} Joke
 */

/** @type {readonly Story[]} */
export const stories = ['assembly', 'mine', 'garden', 'rocket', 'coffee', 'pole'];

/**
 * @param {string} key — a herdr workspace's name, else a session's folder
 * @returns {Story}
 */
export function storyOf(key) {
  return pick(stories, key);
}

/**
 * @template T
 * @param {readonly T[]} choices
 * @param {string} key
 * @returns {T}
 */
function pick(choices, key) {
  // FNV-1a: a few letters apart give choices far apart
  let hash = 0x811c9dc5;
  for (const char of key) hash = Math.imul(hash ^ (char.codePointAt(0) ?? 0), 0x01000193) >>> 0;
  const chosen = choices[hash % choices.length];
  if (chosen === undefined) throw new Error(`No choice ${hash % choices.length} of ${choices.length}`);
  return chosen;
}

/**
 * A herdr workspace's story by its number: the workspaces take the stories in turn, the first six each its own.
 * @param {number} number — herdr's, from 1
 * @returns {Story}
 */
export function storyAt(number) {
  return inTurn(stories, number);
}

/** @type {readonly Joke[]} */
export const jokes = ['thumbs-up', 'joint', 'cocktail', 'popper', 'notes'];

/**
 * The joke beside a finished agent's face (view/rest.js), by its workspace's number: in turn, as the stories.
 * @param {number} number — herdr's, from 1
 * @returns {Joke}
 */
export function jokeAt(number) {
  return inTurn(jokes, number);
}

/**
 * @template T
 * @param {readonly T[]} choices
 * @param {number} number — from 1
 * @returns {T}
 */
function inTurn(choices, number) {
  const chosen = choices[(((number - 1) % choices.length) + choices.length) % choices.length];
  if (chosen === undefined) throw new Error(`No choice for workspace ${number} of ${choices.length}`);
  return chosen;
}
