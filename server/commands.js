// @ts-check
// What a session's "/" offers, as its agent's own menu does. Claude Code's: its built-in commands; the skills and the
// command files of the user's own and of the session's project; those of the plugins turned on, named after their
// plugin. Read anew each time: a skill written meanwhile is offered at once.
import { readdir, readFile } from 'node:fs/promises';
import { basename, join, relative, resolve, sep } from 'node:path';
import { isRecord, text } from '../public/model/narrow.js';
import { claudeBuiltIns } from './claude-builtins.js';
import { codexBuiltIns } from './codex-builtins.js';

/**
 * @typedef {{ name: string, hint: string, about: string, source: string }} SlashCommand — name: with its slash; hint:
 *   its arguments; about: what it does; source: built-in, personal, project, or the plugin's name
 */

/** How much of a description goes with a command: the menu shows a line of it. */
const aboutLength = 200;

/**
 * @param {{ config: string, cwd: string | undefined }} where — config: Claude Code's folder, ~/.claude; cwd: the
 *   session's folder, none while it is not known
 * @returns {Promise<SlashCommand[]>} — by name
 */
export async function claudeCommands({ config, cwd }) {
  const project = cwd === undefined ? undefined : join(cwd, '.claude');
  // of a name, the first stays: the user's own skill before the project's, a skill before a command file
  const found = [
    ...(await skillsIn(join(config, 'skills'), 'personal', '')),
    ...(project === undefined ? [] : await skillsIn(join(project, 'skills'), 'project', '')),
    ...(await commandsIn(join(config, 'commands'), 'personal', '')),
    ...(project === undefined ? [] : await commandsIn(join(project, 'commands'), 'project', '')),
    ...claudeBuiltIns.map((command) => ({ ...command, source: 'built-in' })),
    ...(await pluginCommands(config, cwd)),
  ];
  /** @type {Map<string, SlashCommand>} */
  const byName = new Map();
  for (const command of found) if (!byName.has(command.name)) byName.set(command.name, command);
  return [...byName.values()].sort(nameOrder);
}

/**
 * The skills of a folder of them: each a folder with a SKILL.md, or a link to one — a skill installed elsewhere, a
 * junction on Windows — named by its frontmatter or the folder.
 * @param {string} folder
 * @param {string} source
 * @param {string} prefix — a plugin's name and a colon, or nothing
 * @returns {Promise<SlashCommand[]>}
 */
async function skillsIn(folder, source, prefix) {
  const entries = await readdir(folder, { withFileTypes: true }).catch(() => []);
  const skills = await Promise.all(entries.filter((entry) => entry.isDirectory() || entry.isSymbolicLink()).map((entry) => skillAt(join(folder, entry.name), source, prefix)));
  return skills.flatMap((skill) => (skill === undefined ? [] : [skill]));
}

/**
 * @param {string} folder — holding SKILL.md
 * @param {string} source
 * @param {string} prefix
 * @returns {Promise<SlashCommand | undefined>} — none for a folder with no SKILL.md
 */
async function skillAt(folder, source, prefix) {
  const read = await readFile(join(folder, 'SKILL.md'), 'utf8').catch(() => undefined);
  if (read === undefined) return undefined;
  const { fields, body } = frontmatter(read);
  return commandOf(`/${prefix}${fields.name ?? basename(folder)}`, fields, body, source);
}

/**
 * The command files of a folder, a subfolder's its namespace: frontend/component.md is /frontend:component.
 * @param {string} folder
 * @param {string} source
 * @param {string} prefix
 * @returns {Promise<SlashCommand[]>}
 */
async function commandsIn(folder, source, prefix) {
  const entries = await readdir(folder, { withFileTypes: true, recursive: true }).catch(() => []);
  const files = entries.filter((entry) => entry.isFile() && entry.name.endsWith('.md'));
  return Promise.all(
    files.map(async (entry) => {
      const path = join(entry.parentPath, entry.name);
      const { fields, body } = frontmatter(await readFile(path, 'utf8').catch(() => ''));
      const name = relative(folder, path).slice(0, -'.md'.length).split(sep).join(':');
      return commandOf(`/${prefix}${name}`, fields, body, source);
    }),
  );
}

/**
 * @param {string} name
 * @param {Readonly<Record<string, string>>} fields
 * @param {string} body
 * @param {string} source
 * @returns {SlashCommand}
 */
function commandOf(name, fields, body, source) {
  // with no description, the first line of the text, as Claude Code takes it
  const about = (fields.description ?? body.split(/\r?\n/).find((line) => line.trim() !== '') ?? '').replace(/^#+\s*/, '').trim();
  return { name, hint: fields['argument-hint'] ?? '', about: about.length > aboutLength ? `${about.slice(0, aboutLength - 1)}…` : about, source };
}

/**
 * The skills and commands of the plugins turned on — in the user's settings or the project's — where Claude Code
 * installed them, laid out as each plugin's manifest says: /<plugin>:<name>.
 * @param {string} config
 * @param {string | undefined} cwd
 * @returns {Promise<SlashCommand[]>}
 */
async function pluginCommands(config, cwd) {
  const settings = [join(config, 'settings.json'), ...(cwd === undefined ? [] : [join(cwd, '.claude', 'settings.json'), join(cwd, '.claude', 'settings.local.json')])];
  /** @type {Map<string, boolean>} */
  const turnedOn = new Map();
  for (const file of settings) {
    const enabled = (await readJson(file))?.enabledPlugins;
    if (isRecord(enabled)) for (const [key, on] of Object.entries(enabled)) if (typeof on === 'boolean') turnedOn.set(key, on);
  }
  const installed = (await readJson(join(config, 'plugins', 'installed_plugins.json')))?.plugins;
  if (!isRecord(installed)) return [];
  const lists = await Promise.all(
    [...turnedOn].flatMap(([key, on]) => {
      const place = on ? installedFor(installed[key], cwd) : undefined;
      return place === undefined ? [] : [pluginAt(place, key.replace(/@.*$/, ''))];
    }),
  );
  return lists.flat();
}

/**
 * Where a plugin is installed for the user — or for this project.
 * @param {unknown} installs
 * @param {string | undefined} cwd
 * @returns {string | undefined}
 */
function installedFor(installs, cwd) {
  if (!Array.isArray(installs)) return undefined;
  const forHere = (/** @type {unknown} */ install) => isRecord(install) && (install.scope === 'user' || (cwd !== undefined && typeof install.projectPath === 'string' && resolve(install.projectPath) === resolve(cwd)));
  const install = installs.find(forHere);
  return isRecord(install) ? text(install.installPath) : undefined;
}

/**
 * A plugin's skills and commands: its manifest names their folders — a skills folder may be one skill's own — or they
 * are the default skills/ and commands/.
 * @param {string} folder
 * @param {string} fallbackName — the plugin's key's, when its manifest names none
 * @returns {Promise<SlashCommand[]>}
 */
async function pluginAt(folder, fallbackName) {
  const manifest = await readJson(join(folder, '.claude-plugin', 'plugin.json'));
  const name = text(manifest?.name) ?? fallbackName;
  const prefix = `${name}:`;
  const skills = await Promise.all(
    pathsOf(manifest?.skills, './skills').map(async (path) => {
      const one = await skillAt(join(folder, path), name, prefix);
      return one === undefined ? skillsIn(join(folder, path), name, prefix) : [one];
    }),
  );
  const commands = await Promise.all(pathsOf(manifest?.commands, './commands').map((path) => commandsIn(join(folder, path), name, prefix)));
  return [...skills.flat(), ...commands.flat()];
}

/**
 * @param {unknown} value — a manifest's path, or its list of them
 * @param {string} standard — the folder when it names none
 * @returns {string[]}
 */
function pathsOf(value, standard) {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.filter((path) => typeof path === 'string');
  return [standard];
}

/**
 * @param {string} file
 * @returns {Promise<Record<string, unknown> | undefined>}
 */
async function readJson(file) {
  const read = await readFile(file, 'utf8').catch(() => undefined);
  if (read === undefined) return undefined;
  try {
    const json = JSON.parse(read);
    return isRecord(json) ? json : undefined;
  } catch {
    return undefined; // not JSON: as if it were not there
  }
}

/**
 * A markdown file's frontmatter — its key: value lines, a folded or literal block (> or |) as one value — and the text
 * after it.
 * @param {string} read
 * @returns {{ fields: Record<string, string>, body: string }}
 */
export function frontmatter(read) {
  const lines = read.split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return { fields: {}, body: read };
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
  if (end === -1) return { fields: {}, body: read };
  /** @type {Record<string, string>} */
  const fields = {};
  for (let index = 1; index < end; index++) {
    const field = /^([\w-]+):\s*(.*?)\s*$/.exec(lines[index] ?? '');
    if (field === null) continue;
    const [, key = '', value = ''] = field;
    if (/^[>|][+-]?$/.test(value)) {
      const block = [];
      while (index + 1 < end && /^\s/.test(lines[index + 1] ?? '')) block.push((lines[++index] ?? '').trim());
      fields[key] = block.join(value.startsWith('>') ? ' ' : '\n');
    } else fields[key] = unquoted(value);
  }
  return { fields, body: lines.slice(end + 1).join('\n') };
}

/** @param {string} value */
function unquoted(value) {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) return value.slice(1, -1).replace(/\\(["\\])/g, '$1');
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replaceAll("''", "'");
  return value;
}

/**
 * What a Codex session's "/" offers: Codex's built-in commands, and the user's own prompts as /prompts:<name>.
 * @param {{ home: string }} where — home: Codex's folder, ~/.codex
 * @returns {Promise<SlashCommand[]>} — by name
 */
export async function codexCommands({ home }) {
  const prompts = await commandsIn(join(home, 'prompts'), 'personal', 'prompts:');
  return [...prompts, ...codexBuiltIns.map((command) => ({ ...command, source: 'built-in' }))].sort(nameOrder);
}

/** @param {SlashCommand} a @param {SlashCommand} b */
function nameOrder(a, b) {
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}
