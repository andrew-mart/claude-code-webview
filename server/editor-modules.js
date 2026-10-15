// @ts-check
// CodeMirror for the file panel's editor, as the page imports it: each module by its name through the page's import
// map, served from the package installed beside the viewer — /vendor/cm/<package>/<file in it>, so a module's import
// of a file beside it finds it there. Only the packages named here are served, and only their scripts.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isRecord } from '../public/model/narrow.js';

export const editorModulesPrefix = '/vendor/cm/';

/** The modules the editor imports by name, and the ones they import by name in turn. */
const modules = [
  '@codemirror/state',
  '@codemirror/view',
  '@codemirror/commands',
  '@codemirror/language',
  '@codemirror/search',
  '@codemirror/autocomplete',
  '@codemirror/lang-cpp',
  '@codemirror/lang-css',
  '@codemirror/lang-go',
  '@codemirror/lang-html',
  '@codemirror/lang-java',
  '@codemirror/lang-javascript',
  '@codemirror/lang-json',
  '@codemirror/lang-markdown',
  '@codemirror/lang-php',
  '@codemirror/lang-python',
  '@codemirror/lang-rust',
  '@codemirror/lang-sql',
  '@codemirror/lang-xml',
  '@codemirror/lang-yaml',
  '@codemirror/legacy-modes/mode/clike',
  '@codemirror/legacy-modes/mode/diff',
  '@codemirror/legacy-modes/mode/dockerfile',
  '@codemirror/legacy-modes/mode/lua',
  '@codemirror/legacy-modes/mode/nginx',
  '@codemirror/legacy-modes/mode/powershell',
  '@codemirror/legacy-modes/mode/properties',
  '@codemirror/legacy-modes/mode/ruby',
  '@codemirror/legacy-modes/mode/shell',
  '@codemirror/legacy-modes/mode/toml',
  '@lezer/common',
  '@lezer/cpp',
  '@lezer/css',
  '@lezer/go',
  '@lezer/highlight',
  '@lezer/html',
  '@lezer/java',
  '@lezer/javascript',
  '@lezer/json',
  '@lezer/lr',
  '@lezer/markdown',
  '@lezer/php',
  '@lezer/python',
  '@lezer/rust',
  '@lezer/xml',
  '@lezer/yaml',
  '@marijn/find-cluster-break',
  'crelt',
  'style-mod',
  'w3c-keyname',
];

/**
 * Each module's package — its name and folder — and its file in it: Node finds them by its module resolution rules,
 * installed as a package the dependencies live one level up.
 * @type {{ name: string, packageName: string, root: string, file: string }[]}
 */
const located = modules.map((name) => {
  const file = fileURLToPath(import.meta.resolve(name));
  const packageName = name.split('/').slice(0, name.startsWith('@') ? 2 : 1).join('/');
  return { name, packageName, root: packageRoot(file, packageName), file };
});

/**
 * The page's import map entries for the editor's modules.
 * @param {string} assets — where the page's files are served from
 * @returns {Record<string, string>}
 */
export function editorImports(assets) {
  return Object.fromEntries(located.map(({ name, packageName, root, file }) => [name, `${assets}${editorModulesPrefix}${packageName}/${relative(root, file).split(sep).join('/')}`]));
}

/**
 * The file an address under the prefix names: a script of one of the editor's packages, none for anything else.
 * @param {string} rest — the address past the prefix: <package>/<file in it>
 * @returns {string | undefined}
 */
export function editorModuleFile(rest) {
  const owner = located.find(({ packageName }) => rest.startsWith(`${packageName}/`));
  if (owner === undefined || !rest.endsWith('.js')) return undefined;
  const file = resolve(owner.root, rest.slice(owner.packageName.length + 1));
  return file.startsWith(owner.root + sep) ? file : undefined;
}

/** The editor's modules' files, for the page's fingerprint. */
export function editorModuleFiles() {
  return located.map(({ file }) => file);
}

/**
 * @param {string} file — a module's
 * @param {string} packageName
 * @returns {string} — the folder of the package that holds it
 */
function packageRoot(file, packageName) {
  for (let dir = dirname(file); dir !== dirname(dir); dir = dirname(dir)) {
    const manifest = join(dir, 'package.json');
    /** @type {unknown} */
    const json = existsSync(manifest) ? JSON.parse(readFileSync(manifest, 'utf8')) : undefined;
    if (isRecord(json) && json.name === packageName) return dir;
  }
  throw new Error(`No package.json of ${packageName} above ${file}`);
}
