// @ts-check
// The commands offered while one is typed in the box: its name — the box's first word, starting with a slash — finds
// them as the agent's own menu does, and the one picked takes the word's place.
import { isRecord, text } from './narrow.js';

/**
 * @typedef {{ name: string, hint: string, about: string, source: string }} SlashCommand — as the viewer sends it
 *   (server/commands.js): name with its slash; hint: its arguments; about: what it does; source: built-in, personal,
 *   project, or a plugin's name
 */

/** The word typed: the box's first, a slash first, up to the caret. */
const typedName = /^\s*(\/\S*)$/;

/**
 * The command name being typed, while the caret is in the box's first word and it starts with a slash.
 * @param {string} text
 * @param {number} caret
 * @returns {string | undefined}
 */
export function commandQuery(text, caret) {
  return typedName.exec(text.slice(0, caret))?.[1];
}

/**
 * The commands a name typed finds, best first: those whose name starts with it, then those with a part after a colon
 * that does — a plugin's skill — then those with it inside the name, then in what they do; the shorter name first among
 * alike. A bare slash offers all: the user's own first, then the built-in ones, then the plugins'.
 * @param {readonly SlashCommand[]} commands
 * @param {string} query — with its slash
 * @returns {SlashCommand[]}
 */
export function rankCommands(commands, query) {
  const typed = query.slice(1).toLowerCase();
  if (typed === '') return [...commands].sort((a, b) => sourceRank(a) - sourceRank(b));
  const scored = commands.flatMap((command) => {
    const score = matchScore(command, typed);
    return score === undefined ? [] : [{ command, score }];
  });
  scored.sort((a, b) => a.score - b.score || a.command.name.length - b.command.name.length || (a.command.name < b.command.name ? -1 : 1));
  return scored.map(({ command }) => command);
}

/**
 * @param {SlashCommand} command
 * @param {string} typed — lower case, no slash
 * @returns {number | undefined} — the lower the better; none: not found
 */
function matchScore(command, typed) {
  const name = command.name.slice(1).toLowerCase();
  if (name.startsWith(typed)) return 0;
  if (name.split(':').slice(1).some((part) => part.startsWith(typed))) return 1;
  if (name.includes(typed)) return 2;
  if (command.about.toLowerCase().includes(typed)) return 3;
  return undefined;
}

/** @param {SlashCommand} command — the user's own first, then the built-in ones, then the plugins' */
function sourceRank(command) {
  if (command.source === 'personal' || command.source === 'project') return 0;
  return command.source === 'built-in' ? 1 : 2;
}

/**
 * The command picked in place of the word typed — what was after the caret of it too — a space after it, the caret
 * there, ready for its arguments.
 * @param {string} text
 * @param {number} caret
 * @param {string} name
 * @returns {{ text: string, caret: number }}
 */
export function completeCommand(text, caret, name) {
  const start = text.slice(0, caret).search(/\/\S*$/);
  const rest = text.slice(caret).replace(/^\S*/, '');
  const head = `${text.slice(0, start)}${name}`;
  const tail = rest.startsWith(' ') ? rest : ` ${rest}`;
  return { text: `${head}${tail}`, caret: head.length + 1 };
}

/**
 * The viewer's /api/commands reply; a command that is not one is left out, a reply of another shape is none.
 * @param {unknown} json
 * @returns {SlashCommand[]}
 */
export function parseCommands(json) {
  if (!Array.isArray(json)) return [];
  return json.flatMap((one) => {
    if (!isRecord(one)) return [];
    const name = text(one.name);
    const hint = text(one.hint);
    const about = text(one.about);
    const source = text(one.source);
    return name === undefined || hint === undefined || about === undefined || source === undefined || !name.startsWith('/') ? [] : [{ name, hint, about, source }];
  });
}
