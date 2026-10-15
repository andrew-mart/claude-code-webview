// @ts-check
// A file's links in its project: the files it imports, and the files that import it. Read from the text, as each
// language writes an import — JavaScript and TypeScript, CSS, Python, C, Rust, Markdown and HTML links — and resolved
// as the language finds the file: TypeScript's ./clock.js is clock.ts, ./rules is rules/index.ts. An import of a
// package names no file of the project. The files that import this one are found by its name searched in the project
// (project.js), each line found read as an import and kept when it leads here.
import { readFile, stat } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path';
import { searchProject, searchTimeoutMs } from './project.js';

/**
 * @typedef {'script' | 'style' | 'python' | 'c' | 'rust' | 'markdown' | 'html'} Language
 * @typedef {{ line: number, spec: string, path: string | undefined }} Import — path: the file it leads to, none for a
 *   package or a file not there
 * @typedef {{ path: string, line: number, text: string }} Importer
 * @typedef {{ ok: true, imports: Import[], importedBy: Importer[], more: boolean } | { ok: false, error: 'not-absolute' | 'not-found' | 'too-large' | 'not-a-folder' }} FileLinks
 *   — more: the search for the files importing it stopped at its limit
 */

/** @type {Readonly<Record<string, Language>>} */
const languages = {
  js: 'script', mjs: 'script', cjs: 'script', jsx: 'script', ts: 'script', tsx: 'script', mts: 'script', cts: 'script', vue: 'script', svelte: 'script', astro: 'script',
  css: 'style', scss: 'style', sass: 'style', less: 'style',
  py: 'python', pyi: 'python',
  c: 'c', h: 'c', cc: 'c', cpp: 'c', cxx: 'c', hh: 'c', hpp: 'c',
  rs: 'rust',
  md: 'markdown', markdown: 'markdown', mdx: 'markdown',
  html: 'html', htm: 'html',
};

/** How each language writes an import, its path in the first group. */
/** @type {Readonly<Record<Language, readonly RegExp[]>>} */
const importShapes = {
  script: [/\bfrom\s*['"]([^'"]+)['"]/g, /^\s*import\s*['"]([^'"]+)['"]/g, /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g, /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g, /\b(?:src|href)\s*=\s*['"]([^'"#?]+)['"]/g],
  style: [/@(?:import|use|forward)\s+(?:url\()?\s*['"]?([^'")\s;]+)/g],
  python: [/^\s*from\s+(\.*[\w.]*)\s+import\b/g, /^\s*import\s+([\w.]+)/g],
  c: [/^\s*#\s*include\s*"([^"]+)"/g],
  rust: [/^\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+(\w+)\s*;/g],
  markdown: [/\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g],
  html: [/\b(?:src|href)\s*=\s*['"]([^'"#?]+)['"]/g],
};

/** The endings a script's import leaves out, in the order a bundler or TypeScript tries them. */
const scriptEndings = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.json', '.vue', '.svelte'];

/**
 * @param {string} requested — the file's absolute path
 * @param {string} root — its project's folder
 * @param {{ home: string, maxMatches: number, maxBytes: number }} options
 * @returns {Promise<FileLinks>}
 */
export async function fileLinks(requested, root, { home, maxMatches, maxBytes }) {
  if (!isAbsolute(requested)) return { ok: false, error: 'not-absolute' };
  const info = await stat(requested).catch(() => undefined);
  if (info === undefined || !info.isFile()) return { ok: false, error: 'not-found' };
  if (info.size > maxBytes) return { ok: false, error: 'too-large' };
  const text = await readFile(requested, 'utf8');
  const imports = await importsOf(requested, text, root);
  const importers = await importersOf(requested, root, { home, maxMatches });
  if (!importers.ok) return importers;
  return { ok: true, imports, importedBy: importers.importedBy, more: importers.more };
}

/**
 * @param {string} file
 * @param {string} text — the file's
 * @param {string} root
 * @returns {Promise<Import[]>}
 */
async function importsOf(file, text, root) {
  const language = languageOf(file);
  if (language === undefined) return [];
  const found = text.split('\n').flatMap((line, index) => specsIn(line, language).map((spec) => ({ line: index + 1, spec })));
  return Promise.all(found.map(async ({ line, spec }) => ({ line, spec, path: await resolveImport(file, spec, language, root) })));
}

/**
 * The files whose imports lead to this one.
 * @param {string} file
 * @param {string} root
 * @param {{ home: string, maxMatches: number }} options
 * @returns {Promise<{ ok: true, importedBy: Importer[], more: boolean } | { ok: false, error: 'not-absolute' | 'not-found' | 'not-a-folder' }>}
 */
async function importersOf(file, root, { home, maxMatches }) {
  const stem = basename(file, extname(file));
  // an index is imported by its folder's name
  const names = stem === 'index' || stem === '__init__' || stem === 'mod' ? [stem, basename(dirname(file))] : [stem];
  /** @type {Importer[]} */
  const importedBy = [];
  let more = false;
  for (const name of names) {
    const found = await searchProject(root, { text: name, mode: 'text', caseSensitive: true, wholeWord: false }, { home, maxMatches, timeoutMs: searchTimeoutMs });
    if (!found.ok) {
      // no git to search with: the imports alone are known
      if (found.error === 'bad-pattern' || found.error === 'no-git') return { ok: true, importedBy: [], more: false };
      return { ok: false, error: found.error };
    }
    more ||= found.more;
    for (const match of found.matches) {
      if (samePath(match.path, file) || importedBy.some((known) => samePath(known.path, match.path) && known.line === match.line)) continue;
      const language = languageOf(match.path);
      if (language === undefined) continue;
      const leads = await Promise.all(specsIn(match.text, language).map((spec) => resolveImport(match.path, spec, language, root)));
      if (leads.some((path) => path !== undefined && samePath(path, file))) importedBy.push({ path: match.path, line: match.line, text: match.text });
    }
  }
  return { ok: true, importedBy, more };
}

/**
 * @param {string} line
 * @param {Language} language
 * @returns {string[]}
 */
function specsIn(line, language) {
  return importShapes[language].flatMap((shape) => [...line.matchAll(shape)].flatMap(([, spec]) => (spec === undefined || /^[a-z][a-z0-9+.-]*:/i.test(spec) ? [] : [spec])));
}

/**
 * The file an import leads to, as its language finds it; none for a package or a file not there.
 * @param {string} from — the importing file
 * @param {string} spec
 * @param {Language} language
 * @param {string} root
 * @returns {Promise<string | undefined>}
 */
async function resolveImport(from, spec, language, root) {
  const dir = dirname(from);
  switch (language) {
    case 'script': {
      if (!spec.startsWith('.') && !spec.startsWith('/')) return undefined;
      const base = resolve(dir, spec);
      // TypeScript's ESM imports name the .js its .ts becomes
      const typed = /\.[mc]?js$/.test(base) ? ['.ts', '.tsx', '.mts', '.cts'].map((ending) => base.replace(/\.[mc]?js$/, ending)) : [];
      return firstFile([base, ...typed, ...scriptEndings.map((ending) => base + ending), ...scriptEndings.map((ending) => join(base, `index${ending}`))]);
    }
    case 'style': {
      const base = resolve(dir, spec);
      return firstFile([base, `${base}.css`, `${base}.scss`, join(dirname(base), `_${basename(base)}.scss`), `${base}.less`]);
    }
    case 'python': {
      const dots = /^\.*/.exec(spec)?.[0].length ?? 0;
      const parts = spec.slice(dots).split('.').filter((part) => part !== '');
      const starts = dots > 0 ? [resolve(dir, ...Array(dots - 1).fill('..'))] : [root, dir];
      return firstFile(starts.flatMap((start) => (parts.length === 0 ? [join(start, '__init__.py')] : [`${join(start, ...parts)}.py`, join(start, ...parts, '__init__.py')])));
    }
    case 'rust': {
      const own = basename(from, '.rs');
      const home = ['mod', 'lib', 'main'].includes(own) ? dir : join(dir, own);
      return firstFile([join(home, `${spec}.rs`), join(home, spec, 'mod.rs')]);
    }
    case 'c':
    case 'markdown':
    case 'html':
      return firstFile([resolve(spec.startsWith('/') ? root : dir, safeDecode(spec.replace(/^\//, '')))]);
    default: {
      /** @type {never} */
      const unknown = language;
      return unknown;
    }
  }
}

/**
 * @param {readonly string[]} paths
 * @returns {Promise<string | undefined>}
 */
async function firstFile(paths) {
  for (const path of paths) {
    if ((await stat(path).catch(() => undefined))?.isFile()) return path;
  }
  return undefined;
}

/** @param {string} path */
function languageOf(path) {
  const extension = extname(path).slice(1).toLowerCase();
  return Object.hasOwn(languages, extension) ? languages[extension] : undefined;
}

/**
 * @param {string} one
 * @param {string} other
 */
function samePath(one, other) {
  const plain = (/** @type {string} */ path) => (process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path));
  return plain(one) === plain(other);
}

/** @param {string} text */
function safeDecode(text) {
  try {
    return decodeURI(text);
  } catch {
    return text;
  }
}
