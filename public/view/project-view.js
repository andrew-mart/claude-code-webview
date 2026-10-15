// @ts-check
// A session's project in the side panel: its folders as a tree — a folder opens in place, read only then — and its
// text searched, by text or pattern, case and whole word as asked; a match opens its file at its line, a file opens in
// the panel. The search shows in place of the tree while there is something to search for. A name looked for from the
// editor shows its definitions first, then its uses (definitions.js).
import { isDefinition } from '../model/definitions.js';
import { h } from './dom.js';

/**
 * @typedef {import('../model/project.js').SearchQuery} SearchQuery
 * @typedef {import('../model/project.js').FolderListing} FolderListing
 * @typedef {import('../model/project.js').SearchFound} SearchFound
 * @typedef {import('../model/project.js').Match} Match
 * @typedef {import('./file-links.js').FileTarget} FileTarget
 * @typedef {{ root: string, listFolder: (path: string) => Promise<FolderListing | undefined>, search: (query: SearchQuery) => Promise<SearchFound | undefined>, openFile: (target: FileTarget) => void, iconOf: import('./file-icons.js').IconOf }} ProjectSource
 *   — root: the project's folder, the session's; openFile: a file into the panel, at a line or not; iconOf: a file's or
 *   folder's icon
 */

/** @type {Readonly<Record<string, string>>} */
const refusals = {
  'not-absolute': 'The folder is not an absolute path.',
  'not-found': 'The folder is not there: deleted, or renamed.',
  'not-a-folder': 'This is a file, not a folder.',
  'bad-pattern': 'The pattern is not one git can read.',
  'no-git': "git is not installed on the viewer's computer: there is no search.",
};

/** A search waits this long after the last key, so a word typed is searched once. */
const typingMs = 350;

/**
 * @param {ProjectSource} source
 * @returns {{ element: HTMLElement, reload: () => Promise<void>, summary: () => string | undefined, searchFor: (query: SearchQuery, how?: { name?: string }) => Promise<Match[]>, select: (path: string) => void }}
 *   — reload: the tree read again, and the search done again; summary: the project's folder, for the panel's header;
 *   searchFor: a search asked from elsewhere — a name, the editor's word under the cursor: its definitions found come
 *   back; select: the file shown beside the tree, marked in it
 */
export function createProjectView({ root, listFolder, search, openFile, iconOf }) {
  const separator = root.includes('\\') ? '\\' : '/';
  const field = h('input', { className: 'project-query', attrs: { type: 'search', placeholder: 'Search the project', 'aria-label': 'Search the project', enterkeyhint: 'search', autocomplete: 'off', spellcheck: 'false' } });
  const caseToggle = toggle('Aa', 'Match case');
  const wordToggle = toggle('ab', 'Whole words');
  const patternToggle = toggle('.*', 'A pattern (extended regular expression)');
  const results = h('div', { className: 'project-results' });
  results.hidden = true;
  const tree = h('ul', { className: 'project-tree' });
  const element = h('div', { className: 'project' }, [h('div', { className: 'project-search' }, [field, caseToggle, wordToggle, patternToggle]), results, tree]);
  /** The folders open in the tree, by their paths. */
  /** @type {Set<string>} */
  const open = new Set();
  /** The latest search asked: an earlier one's answer coming later is dropped. */
  let searches = 0;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let typing;
  /** The name the search is for, asked from the editor: its definitions show first. A search typed is for text. */
  /** @type {string | undefined} */
  let name;
  /** The file shown beside the tree, marked in it. */
  /** @type {string | undefined} */
  let selected;

  const childOf = (/** @type {string} */ folder, /** @type {string} */ name) => `${folder.replace(/[\\/]$/, '')}${separator}${name}`;

  /**
   * The folder's entries as rows of the tree, its open folders' entries under them.
   * @param {string} folder
   * @param {number} depth
   * @returns {Promise<HTMLElement[]>}
   */
  const rowsOf = async (folder, depth) => {
    const listing = await listFolder(folder);
    if (listing === undefined || !listing.ok) return [h('li', { className: 'project-note', text: listing === undefined ? 'Could not get the folder from the viewer.' : refusals[listing.error] ?? '' })];
    const rows = await Promise.all(
      listing.entries.map(async (entry) => {
        const path = childOf(folder, entry.name);
        const row = h('button', { className: 'project-entry', title: path, attrs: { type: 'button', 'data-depth': String(depth), 'data-kind': entry.kind } }, [iconOf(entry.name, entry.kind, open.has(path)), entry.name]);
        row.style.setProperty('--depth', String(depth));
        const item = h('li', {}, [row]);
        if (entry.kind === 'file') {
          row.classList.toggle('selected', path === selected);
          row.addEventListener('click', () => openFile({ path, line: undefined, endLine: undefined }));
          return [item];
        }
        row.classList.toggle('open', open.has(path));
        row.setAttribute('aria-expanded', String(open.has(path)));
        row.addEventListener('click', () => void flip(path));
        return [item, ...(open.has(path) ? await rowsOf(path, depth + 1) : [])];
      }),
    );
    return [...rows.flat(), ...(listing.more ? [h('li', { className: 'project-note', text: 'The folder holds more than is shown.' })] : [])];
  };
  const drawTree = async () => {
    tree.replaceChildren(...(await rowsOf(root, 0)));
  };
  /** @param {string} path */
  const flip = async (path) => {
    if (open.has(path)) open.delete(path);
    else open.add(path);
    await drawTree();
  };

  /** @returns {SearchQuery} */
  const query = () => ({ text: field.value, mode: pressed(patternToggle) ? 'regex' : 'text', caseSensitive: pressed(caseToggle), wholeWord: pressed(wordToggle) });
  /** @returns {Promise<Match[]>} — the definitions of the name searched for, if any */
  const runSearch = async () => {
    clearTimeout(typing);
    const asked = query();
    const turn = ++searches;
    tree.hidden = asked.text !== '';
    results.hidden = asked.text === '';
    if (asked.text === '') return [];
    results.replaceChildren(h('div', { className: 'project-note', text: 'Searching…' }));
    const found = await search(asked);
    if (turn !== searches) return [];
    if (found === undefined || !found.ok) {
      results.replaceChildren(h('div', { className: 'project-note', text: found === undefined ? 'Could not search: the viewer did not answer.' : refusals[found.error] ?? '' }));
      return [];
    }
    const marker = markerOf(asked);
    const head = h('div', { className: 'project-found', text: countOf(found) });
    if (name === undefined) {
      results.replaceChildren(head, ...filesOf(found.matches, marker));
      return [];
    }
    const named = name;
    const definitions = found.matches.filter((match) => isDefinition(named, match.text));
    const uses = found.matches.filter((match) => !definitions.includes(match));
    results.replaceChildren(
      head,
      section(definitions.length > 1 ? 'Definitions' : 'Definition', definitions.length === 0 ? [h('div', { className: 'project-note', text: 'None in the project: the name may come from a library, or be defined in a way not recognised.' })] : filesOf(definitions, marker)),
      section('Uses', uses.length === 0 ? [h('div', { className: 'project-note', text: 'None.' })] : filesOf(uses, marker)),
    );
    return definitions;
  };

  /**
   * Matches by file, each file's name opening it, each match opening its file at its line.
   * @param {readonly Match[]} matches
   * @param {RegExp | undefined} marker
   * @returns {HTMLElement[]}
   */
  const filesOf = (matches, marker) => {
    /** @type {Map<string, Match[]>} */
    const byFile = new Map();
    for (const match of matches) byFile.set(match.path, [...(byFile.get(match.path) ?? []), match]);
    const files = [...byFile].map(([path, matches]) =>
      h('section', { className: 'project-file' }, [
        h('button', { className: 'project-file-name', title: path, attrs: { type: 'button' } }, [iconOf(path.split(/[\\/]/).pop() ?? path, 'file', false), relativeTo(root, path)]),
        ...matches.map((match) => {
          const line = h('button', { className: 'project-match', title: `${path}:${match.line}`, attrs: { type: 'button' } }, [h('span', { className: 'project-line', text: String(match.line) }), lineWithMatch(match.text, marker)]);
          line.addEventListener('click', () => openFile({ path, line: match.line, endLine: undefined }));
          return line;
        }),
      ]),
    );
    for (const fileName of files.map((file) => file.querySelector('.project-file-name'))) {
      fileName?.addEventListener('click', () => openFile({ path: fileName.getAttribute('title') ?? '', line: undefined, endLine: undefined }));
    }
    return files;
  };

  field.addEventListener('input', () => {
    name = undefined;
    clearTimeout(typing);
    typing = setTimeout(() => void runSearch(), typingMs);
  });
  field.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') void runSearch();
  });
  for (const button of [caseToggle, wordToggle, patternToggle]) {
    button.addEventListener('click', () => {
      name = undefined;
      button.setAttribute('aria-pressed', String(!pressed(button)));
      void runSearch();
    });
  }

  return {
    element,
    reload: async () => {
      // a search asked while the tree is read is not done twice
      const searching = field.value !== '';
      await drawTree();
      if (searching) await runSearch();
    },
    summary: () => root,
    select: (path) => {
      selected = path;
      for (const row of tree.querySelectorAll('.project-entry[data-kind="file"]')) row.classList.toggle('selected', row.getAttribute('title') === path);
    },
    searchFor: (asked, how = {}) => {
      name = how.name;
      field.value = asked.text;
      caseToggle.setAttribute('aria-pressed', String(asked.caseSensitive));
      wordToggle.setAttribute('aria-pressed', String(asked.wholeWord));
      patternToggle.setAttribute('aria-pressed', String(asked.mode === 'regex'));
      return runSearch();
    },
  };
}

/**
 * How many matches, in how many files — and whether the search stopped short of them all.
 * @param {Extract<SearchFound, { ok: true }>} found
 */
function countOf(found) {
  const files = new Set(found.matches.map((match) => match.path)).size;
  const counted = `${found.matches.length} ${found.matches.length === 1 ? 'match' : 'matches'} in ${files} ${files === 1 ? 'file' : 'files'}`;
  if (found.matches.length === 0) return 'Nothing found';
  return found.more ? `${counted} — the first ones; there are more` : counted;
}

/**
 * @param {string} title
 * @param {readonly HTMLElement[]} content
 * @returns {HTMLElement}
 */
function section(title, content) {
  return h('section', { className: 'project-section' }, [h('div', { className: 'project-section-title', text: title }), ...content]);
}

/**
 * Where the asked text is in a line: the page's own reading of it, close to git's; a pattern JavaScript cannot read
 * marks nothing.
 * @param {SearchQuery} asked
 * @returns {RegExp | undefined}
 */
function markerOf(asked) {
  const body = asked.mode === 'regex' ? asked.text : asked.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  try {
    return new RegExp(asked.wholeWord ? `\\b(?:${body})\\b` : body, asked.caseSensitive ? 'g' : 'gi');
  } catch {
    return undefined;
  }
}

/**
 * @param {string} text
 * @param {RegExp | undefined} marker
 * @returns {HTMLElement}
 */
function lineWithMatch(text, marker) {
  const line = h('span', { className: 'project-text' });
  let from = 0;
  for (const found of marker === undefined ? [] : text.matchAll(marker)) {
    if (found[0] === '') break;
    line.append(text.slice(from, found.index), h('mark', { text: found[0] }));
    from = found.index + found[0].length;
  }
  line.append(text.slice(from));
  return line;
}

/**
 * @param {string} root
 * @param {string} path
 */
function relativeTo(root, path) {
  return path.startsWith(root) ? path.slice(root.length).replace(/^[\\/]/, '') : path;
}

/**
 * @param {string} label
 * @param {string} title
 * @returns {HTMLButtonElement}
 */
function toggle(label, title) {
  return h('button', { className: 'project-toggle', text: label, title, attrs: { type: 'button', 'aria-pressed': 'false', 'aria-label': title } });
}

/** @param {HTMLElement} button */
function pressed(button) {
  return button.getAttribute('aria-pressed') === 'true';
}
