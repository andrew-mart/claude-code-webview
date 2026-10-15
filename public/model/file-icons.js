// @ts-check
// A file's or a folder's icon from an icon theme — Material Icon Theme's, as VS Code shows it — picked the way VS Code
// picks: a file by its whole name, then by its longest extension the theme knows — limits.test.ts is a test before it
// is TypeScript — then by its language, else the plain file; a folder by its name, open or closed. The light theme's
// own icon where it has one.
import { languageOfPath } from './code-language.js';
import { isRecord, text } from './narrow.js';

/**
 * @typedef {Readonly<Record<string, string>>} Names
 * @typedef {{ file: string, folder: string, folderExpanded: string, fileNames: Names, fileExtensions: Names, languageIds: Names, folderNames: Names, folderNamesExpanded: Names, light: { fileNames: Names, fileExtensions: Names, folderNames: Names, folderNamesExpanded: Names } }} IconTheme
 *   — an icon theme's choices, each an icon's name
 */

/** The languages the editor knows, by the names VS Code gives them. */
/** @type {Readonly<Record<import('./code-language.js').CodeLanguage, string>>} */
const vscodeLanguages = {
  javascript: 'javascript',
  jsx: 'javascriptreact',
  typescript: 'typescript',
  tsx: 'typescriptreact',
  json: 'json',
  python: 'python',
  css: 'css',
  html: 'html',
  markdown: 'markdown',
  sql: 'sql',
  xml: 'xml',
  yaml: 'yaml',
  rust: 'rust',
  go: 'go',
  java: 'java',
  kotlin: 'kotlin',
  scala: 'scala',
  cpp: 'cpp',
  csharp: 'csharp',
  php: 'php',
  shell: 'shellscript',
  powershell: 'powershell',
  toml: 'toml',
  dockerfile: 'dockerfile',
  properties: 'properties',
  lua: 'lua',
  ruby: 'ruby',
  diff: 'diff',
  nginx: 'nginx',
};

/**
 * @param {IconTheme} theme
 * @param {{ name: string, kind: 'file' | 'folder', open: boolean, light: boolean }} entry — light: the page's theme is light
 * @returns {string} — the icon's name
 */
export function iconFor(theme, { name, kind, open, light }) {
  const lower = name.toLowerCase();
  if (kind === 'folder') {
    const names = open ? 'folderNamesExpanded' : 'folderNames';
    return pick(light ? theme.light[names] : undefined, lower) ?? pick(theme[names], lower) ?? (open ? theme.folderExpanded : theme.folder);
  }
  const byName = pick(light ? theme.light.fileNames : undefined, lower) ?? pick(theme.fileNames, lower);
  if (byName !== undefined) return byName;
  // limits.test.ts: test.ts before ts
  const parts = lower.split('.');
  for (let start = 1; start < parts.length; start++) {
    const extension = parts.slice(start).join('.');
    const byExtension = pick(light ? theme.light.fileExtensions : undefined, extension) ?? pick(theme.fileExtensions, extension);
    if (byExtension !== undefined) return byExtension;
  }
  const language = languageOfPath(name);
  return (language === undefined ? undefined : pick(theme.languageIds, vscodeLanguages[language])) ?? theme.file;
}

/**
 * @param {Names | undefined} names
 * @param {string} key
 * @returns {string | undefined}
 */
function pick(names, key) {
  return names !== undefined && Object.hasOwn(names, key) ? names[key] : undefined;
}

/**
 * The theme as the viewer sends it (/vendor/file-icons/theme.json): a choice that cannot be read is left out, a reply
 * of another shape is none.
 * @param {unknown} json
 * @returns {IconTheme | undefined}
 */
export function parseIconTheme(json) {
  if (!isRecord(json)) return undefined;
  const file = text(json.file);
  const folder = text(json.folder);
  const folderExpanded = text(json.folderExpanded);
  if (file === undefined || folder === undefined || folderExpanded === undefined) return undefined;
  const light = isRecord(json.light) ? json.light : {};
  return {
    file,
    folder,
    folderExpanded,
    fileNames: namesOf(json.fileNames),
    fileExtensions: namesOf(json.fileExtensions),
    languageIds: namesOf(json.languageIds),
    folderNames: namesOf(json.folderNames),
    folderNamesExpanded: namesOf(json.folderNamesExpanded),
    light: { fileNames: namesOf(light.fileNames), fileExtensions: namesOf(light.fileExtensions), folderNames: namesOf(light.folderNames), folderNamesExpanded: namesOf(light.folderNamesExpanded) },
  };
}

/**
 * @param {unknown} value
 * @returns {Names}
 */
function namesOf(value) {
  return isRecord(value) ? Object.fromEntries(Object.entries(value).flatMap(([key, name]) => (typeof name === 'string' ? [[key, name]] : []))) : {};
}
