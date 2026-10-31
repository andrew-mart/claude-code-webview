// @ts-check
// A session's project in the side panel: its folders as a tree — a folder opens in place, shown at once from what was
// read ahead under the one opened before it, read again then and drawn anew if it changed — and its text searched, by text or pattern, case and whole word as asked; a match opens its file at its line, a file opens in
// the panel. The search shows in place of the tree while there is something to search for. A name looked for from the
// editor shows its definitions first, then its uses (definitions.js). Each file downloads as it is, each folder as a
// zip; files picked for a folder upload into it, the folder shown as it is then. Beside the search both go by what is
// chosen in the tree — a folder clicked, the file shown: the download gives it, the upload goes into the folder chosen or
// the one holding the file; with nothing chosen in the project, the project's own folder. One by a name
// already there is asked about: replace the file there — named as it was or as it came, when the names differ only in
// case — upload it under a name of its own, or skip it.
import { isDefinition } from '../model/definitions.js';
import { h } from './dom.js';
import { icon } from './icons.js';

/**
 * @typedef {import('../model/project.js').SearchQuery} SearchQuery
 * @typedef {import('../model/project.js').FolderListing} FolderListing
 * @typedef {import('../model/project.js').SearchFound} SearchFound
 * @typedef {import('../model/project.js').Match} Match
 * @typedef {import('./file-links.js').FileTarget} FileTarget
 * @typedef {import('../model/project.js').UploadOutcome} UploadOutcome
 * @typedef {{ address: (path: string, kind: 'file' | 'folder') => string, upload: (folder: string, file: File, name: string, existing: 'keep' | 'replace') => Promise<UploadOutcome> }} Transfer
 *   — address: where a file, or a folder as a zip, downloads from; upload: a file into a folder under a name, one by
 *   that name there kept — the upload refused — or replaced
 * @typedef {{ kind: 'upload', name: string, existing: 'keep' | 'replace' } | { kind: 'skip' }} UploadAnswer — what to do
 *   with a file whose name is there already
 * @typedef {{ root: string, listFolder: (path: string) => Promise<FolderListing | undefined>, search: (query: SearchQuery) => Promise<SearchFound | undefined>, openFile: (target: FileTarget) => void, iconOf: import('./file-icons.js').IconOf, transfer: Transfer }} ProjectSource
 *   — root: the project's folder, the session's; openFile: a file into the panel, at a line or not; iconOf: a file's or
 *   folder's icon; transfer: its files downloaded and uploaded
 */

/** @type {Readonly<Record<string, string>>} */
const refusals = {
  'not-absolute': 'The folder is not an absolute path.',
  'not-found': 'The folder is not there: deleted, or renamed.',
  'not-a-folder': 'This is a file, not a folder.',
  'bad-pattern': 'The pattern is not one git can read.',
  'no-git': "git is not installed on the viewer's computer: there is no search.",
};

/** Why a file was not uploaded. */
/** @type {Readonly<Record<'too-large' | 'bad-name' | 'failed', string>>} */
const uploadRefusals = { 'too-large': 'too big', 'bad-name': 'a name no folder can hold', failed: 'the viewer did not take it' };

/** A search waits this long after the last key, so a word typed is searched once. */
const typingMs = 350;
/** How many levels under a folder opened — the project's, as the tree opens — are read ahead, so they open at once. */
const aheadLevels = 2;
/** How many folders are read ahead at most each time: a folder of very many is not read through. */
const aheadFolders = 40;
/** Folders of what is installed or built, opened seldom and holding very many: read when opened, not ahead. */
const notReadAhead = new Set(['node_modules', 'bower_components', '.venv', 'venv', '__pycache__', 'obj', 'target', 'dist', 'build', '.next', '.gradle', '.idea', '.vs', 'coverage']);

/**
 * @param {ProjectSource} source
 * @returns {{ element: HTMLElement, reload: () => Promise<void>, summary: () => string | undefined, searchFor: (query: SearchQuery, how?: { name?: string }) => Promise<Match[]>, select: (path: string) => void }}
 *   — reload: the tree read again, and the search done again; summary: the project's folder, for the panel's header;
 *   searchFor: a search asked from elsewhere — a name, the editor's word under the cursor: its definitions found come
 *   back; select: the file shown beside the tree, marked in it
 */
export function createProjectView({ root, listFolder, search, openFile, iconOf, transfer }) {
  const separator = root.includes('\\') ? '\\' : '/';
  const field = h('input', { className: 'project-query', attrs: { type: 'search', placeholder: 'Search the project', 'aria-label': 'Search the project', enterkeyhint: 'search', autocomplete: 'off', spellcheck: 'false' } });
  const caseToggle = toggle('Aa', 'Match case');
  const wordToggle = toggle('ab', 'Whole words');
  const patternToggle = toggle('.*', 'A pattern (extended regular expression)');
  const results = h('div', { className: 'project-results' });
  results.hidden = true;
  const tree = h('ul', { className: 'project-tree' });
  const rootName = root.replace(/[\\/]$/, '').split(/[\\/]/).pop() ?? root;
  const picker = h('input', { className: 'project-picker', attrs: { type: 'file', multiple: '', hidden: '', 'aria-hidden': 'true' } });
  const told = h('div', { className: 'project-transfer', attrs: { hidden: '' } });
  const chosenDownload = downloadLink(root, 'folder', `${rootName}.zip`);
  const chosenUpload = uploadButton(`Upload files into ${rootName}`, () => chosenFolder());
  const element = h('div', { className: 'project' }, [h('div', { className: 'project-search' }, [field, caseToggle, wordToggle, patternToggle, chosenDownload, chosenUpload]), told, picker, results, tree]);
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
  /** What is chosen in the tree — a folder clicked, the file shown beside it — marked there. */
  /** @type {{ path: string, kind: 'folder' | 'file' } | undefined} */
  let selected;
  /** The folders read — open, or read ahead — by their paths: the tree is drawn from them. */
  /** @type {Map<string, FolderListing>} */
  const listings = new Map();
  /** The folders being read now: one asked for twice meanwhile is read once. */
  /** @type {Map<string, Promise<FolderListing | undefined>>} */
  const reading = new Map();

  const childOf = (/** @type {string} */ folder, /** @type {string} */ name) => `${folder.replace(/[\\/]$/, '')}${separator}${name}`;

  /**
   * A file, or a folder as a zip, to download under its own name.
   * @param {string} path @param {'file' | 'folder'} kind @param {string} saved — the name it is saved under
   */
  function downloadLink(path, kind, saved) {
    const title = kind === 'file' ? `Download ${saved}` : `Download ${saved.replace(/\.zip$/, '')} as a zip`;
    return h('a', { className: 'project-download', title, attrs: { href: transfer.address(path, kind), download: saved, 'aria-label': title } }, [icon('download')]);
  }

  /**
   * The files picked go into a folder: the one it gives as it is pressed.
   * @param {string} title @param {() => string} folder
   */
  function uploadButton(title, folder) {
    const button = h('button', { className: 'project-upload', title, attrs: { type: 'button', 'aria-label': title } }, [icon('upload')]);
    button.addEventListener('click', () => {
      pickingFor = folder();
      picker.value = '';
      picker.click();
    });
    return button;
  }

  /** The folder files are picked for. */
  let pickingFor = root;
  /** @param {string} path — a folder or a file in the project, as the panel names it: from the project's name */
  const pathLabel = (path) => (path === root ? rootName : `${rootName}/${relativeTo(root, path).replaceAll('\\', '/')}`);
  /** Whether a path is the project's folder or under it, either kind of slashes. @param {string} path */
  const inProject = (path) => {
    const plain = (/** @type {string} */ one) => one.replaceAll('\\', '/').replace(/\/$/, '');
    return plain(path) === plain(root) || plain(path).startsWith(`${plain(root)}/`);
  };
  /**
   * What the buttons beside the search are for: the folder or file chosen in the project, else the project's folder.
   * @returns {{ path: string, kind: 'folder' | 'file' }}
   */
  const chosenItem = () => (selected !== undefined && inProject(selected.path) ? selected : { path: root, kind: 'folder' });
  /** The folder the upload beside the search goes into: the one chosen, or the one holding the file chosen. */
  const chosenFolder = () => {
    const item = chosenItem();
    return item.kind === 'folder' ? item.path : item.path.replace(/[\\/][^\\/]*$/, '');
  };
  /** The download beside the search pointed at what is chosen: a folder as a zip, a file as it is. */
  const pointDownload = () => {
    const { path, kind } = chosenItem();
    const name = path === root ? rootName : (path.split(/[\\/]/).pop() ?? path);
    chosenDownload.setAttribute('href', transfer.address(path, kind));
    chosenDownload.setAttribute('download', kind === 'file' ? name : `${name}.zip`);
    chosenDownload.title = kind === 'file' ? `Download ${pathLabel(path)}` : `Download ${pathLabel(path)} as a zip`;
    chosenDownload.setAttribute('aria-label', chosenDownload.title);
  };
  /** What is chosen marked in the tree, and the buttons beside the search pointed at it. */
  const markChosen = () => {
    for (const row of tree.querySelectorAll('.project-entry')) row.classList.toggle('selected', row.getAttribute('title') === selected?.path);
    pointDownload();
    chosenUpload.title = `Upload files into ${pathLabel(chosenFolder())}`;
    chosenUpload.setAttribute('aria-label', chosenUpload.title);
  };
  /** @param {string} words */
  const tell = (words) => {
    told.hidden = false;
    told.replaceChildren(words);
  };
  /**
   * A choice of what to do with a file whose name is there, the answer once one is pressed.
   * @param {string} words @param {string} title @param {string} className @param {() => void} answer
   */
  const choice = (words, title, className, answer) => {
    const button = h('button', { className: `project-transfer-choice ${className}`, text: words, title, attrs: { type: 'button' } });
    button.addEventListener('click', answer);
    return button;
  };
  /**
   * What to do with a file whose name is there already: replace the file there, or keep it and skip this one. A name
   * told from the one there only by its case — on Windows, on a Mac — names the file replaced as chosen: as it was
   * there, or as it came.
   * @param {string} name — the file's @param {string} there — the name the folder holds it by @param {string} folder
   * @returns {Promise<UploadAnswer>}
   */
  const askAbout = (name, there, folder) =>
    new Promise((answer) => {
      /** @param {string} words @param {string} named */
      const replaceAs = (words, named) => choice(words, `Replace the ${there} there with this one, named ${named}`, 'project-transfer-replace', () => answer({ kind: 'upload', name: named, existing: 'replace' }));
      const replace = there === name ? [replaceAs('Replace', name)] : [replaceAs(there, there), replaceAs(name, name)];
      const skip = choice('Skip', `Keep the ${there} there, and not upload this one`, 'project-transfer-skip', () => answer({ kind: 'skip' }));
      const rename = choice('Rename', 'Upload this one under another name', 'project-transfer-rename', () => void askName(name, folder, skip).then((named) => answer({ kind: 'upload', name: named, existing: 'keep' })));
      const question = there === name ? `Replace ${name} in ${pathLabel(folder)}?` : `Replace ${there} in ${pathLabel(folder)}, named:`;
      told.hidden = false;
      told.replaceChildren(h('span', { className: 'project-transfer-question', text: question }), ...replace, rename, skip);
      replace[0]?.focus();
    });
  /**
   * The name to upload a file under instead, the one it came by offered to change: the name once Upload or Enter is
   * pressed.
   * @param {string} name @param {string} folder @param {HTMLElement} skip — the file skipped instead
   * @returns {Promise<string>}
   */
  const askName = (name, folder, skip) =>
    new Promise((answer) => {
      const field = h('input', { className: 'project-transfer-name', attrs: { type: 'text', value: name, 'aria-label': `A name to upload ${name} under`, autocomplete: 'off', spellcheck: 'false' } });
      field.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        answer(field.value);
      });
      const upload = choice('Upload', 'Upload it under this name', 'project-transfer-upload', () => answer(field.value));
      told.replaceChildren(h('span', { className: 'project-transfer-question', text: `Upload ${name} into ${pathLabel(folder)} as` }), field, upload, skip);
      field.focus();
      // the name before its extension, to type over
      field.setSelectionRange(0, name.lastIndexOf('.') > 0 ? name.lastIndexOf('.') : name.length);
    });
  /**
   * A file uploaded under a name, asked about while one by that name is there: the name it went in by and how that
   * went, none when it was skipped.
   * @param {string} folder @param {File} file @param {string} name @param {'keep' | 'replace'} existing
   * @returns {Promise<{ name: string, outcome: UploadOutcome } | undefined>}
   */
  const uploadOne = async (folder, file, name, existing) => {
    tell(`Uploading ${name}…`);
    const outcome = await transfer.upload(folder, file, name, existing);
    if (outcome.ok || outcome.error !== 'exists') return { name, outcome };
    const answer = await askAbout(name, outcome.name, folder);
    return answer.kind === 'skip' ? undefined : uploadOne(folder, file, answer.name, answer.existing);
  };
  /**
   * The files picked uploaded into the folder one after another, then the folder — open — shown as it is now.
   * @param {string} folder @param {readonly File[]} files
   */
  const uploadAll = async (folder, files) => {
    /** @type {string[]} */
    const uploaded = [];
    /** @type {string[]} */
    const refused = [];
    for (const file of files) {
      const done = await uploadOne(folder, file, file.name, 'keep');
      if (done === undefined) continue;
      if (done.outcome.ok) uploaded.push(done.name);
      else if (done.outcome.error !== 'exists') refused.push(`${done.name}: ${uploadRefusals[done.outcome.error]}`);
    }
    tell([...(uploaded.length === 0 ? [] : [`Uploaded ${uploaded.join(', ')} into ${pathLabel(folder)}`]), ...(refused.length === 0 ? [] : [`Not uploaded — ${refused.join('; ')}`])].join('. ') || 'Nothing uploaded.');
    if (folder !== root) open.add(folder);
    await readAgain([folder]);
    drawTree();
  };
  picker.addEventListener('change', () => void uploadAll(pickingFor, [...(picker.files ?? [])]));

  /**
   * The folder read from the viewer now, kept; none when the viewer did not answer — what was kept stays.
   * @param {string} folder
   * @returns {Promise<FolderListing | undefined>}
   */
  const read = (folder) => {
    const already = reading.get(folder);
    if (already !== undefined) return already;
    const asked = listFolder(folder).then((listing) => {
      reading.delete(folder);
      if (listing !== undefined) listings.set(folder, listing);
      return listing;
    });
    reading.set(folder, asked);
    return asked;
  };
  /**
   * The folder as kept, read first if it was not.
   * @param {string} folder
   */
  const listingOf = async (folder) => listings.get(folder) ?? (await read(folder));
  /**
   * Reads ahead the folders under this one not read yet, so they open at once: so many levels down, so many folders at
   * most, none of what is installed or built.
   * @param {string} folder
   */
  const readAhead = async (folder) => {
    let level = [folder];
    let left = aheadFolders;
    for (let depth = 0; depth < aheadLevels && level.length > 0 && left > 0; depth++) {
      const read = await Promise.all(level.map(async (path) => ({ path, listing: await listingOf(path) })));
      // the folders take turns: one of very many does not take every place from the others
      level = takeTurns(
        read.map(({ path, listing }) => (listing?.ok === true ? listing.entries.filter((entry) => entry.kind === 'folder' && !notReadAhead.has(entry.name)).map((entry) => childOf(path, entry.name)) : [])),
        left,
      );
      left -= level.length;
    }
    await Promise.all(level.map(listingOf));
  };

  /**
   * The folder's entries as rows of the tree, its open folders' entries under them — as kept.
   * @param {string} folder
   * @param {number} depth
   * @returns {HTMLElement[]}
   */
  const rowsOf = (folder, depth) => {
    const listing = listings.get(folder);
    if (listing === undefined || !listing.ok) return [h('li', { className: 'project-note', text: listing === undefined ? 'Could not get the folder from the viewer.' : refusals[listing.error] ?? '' })];
    const rows = listing.entries.map((entry) => {
        const path = childOf(folder, entry.name);
        const row = h('button', { className: 'project-entry', title: path, attrs: { type: 'button', 'data-depth': String(depth), 'data-kind': entry.kind } }, [iconOf(entry.name, entry.kind, open.has(path)), entry.name]);
        row.style.setProperty('--depth', String(depth));
        const actions = h('span', { className: 'project-actions' }, entry.kind === 'file' ? [downloadLink(path, 'file', entry.name)] : [downloadLink(path, 'folder', `${entry.name}.zip`), uploadButton('Upload files into this folder', () => path)]);
        const item = h('li', { className: 'project-item' }, [row, actions]);
        row.classList.toggle('selected', path === selected?.path);
        if (entry.kind === 'file') {
          row.addEventListener('click', () => openFile({ path, line: undefined, endLine: undefined }));
          return [item];
        }
        row.classList.toggle('open', open.has(path));
        row.setAttribute('aria-expanded', String(open.has(path)));
        row.addEventListener('click', () => {
          selected = { path, kind: 'folder' };
          markChosen();
          void flip(path);
        });
        return [item, ...(open.has(path) ? rowsOf(path, depth + 1) : [])];
    });
    return [...rows.flat(), ...(listing.more ? [h('li', { className: 'project-note', text: 'The folder holds more than is shown.' })] : [])];
  };
  const drawTree = () => {
    tree.replaceChildren(...rowsOf(root, 0));
  };
  /**
   * The folders read again from the viewer, all at once — the project's and those open — then the tree drawn anew if
   * any changed.
   * @param {readonly string[]} folders
   */
  const readAgain = async (folders) => {
    const before = folders.map((folder) => JSON.stringify(listings.get(folder)));
    const now = await Promise.all(folders.map(read));
    if (now.some((listing, at) => listing !== undefined && JSON.stringify(listing) !== before[at])) drawTree();
  };
  /** @param {string} path */
  const flip = async (path) => {
    if (open.has(path)) {
      open.delete(path);
      drawTree();
      return;
    }
    open.add(path);
    // read ahead it opens at once; what it holds now comes after
    if (listings.has(path)) drawTree();
    await readAgain([path]);
    await readAhead(path);
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
      if (listings.has(root)) drawTree();
      await readAgain([root, ...open]);
      drawTree();
      if (searching) await runSearch();
      await readAhead(root);
    },
    summary: () => root,
    select: (path) => {
      selected = { path, kind: 'file' };
      markChosen();
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
 * The lists' items taking turns — the first of each, then the second of each — up to so many.
 * @template T
 * @param {readonly (readonly T[])[]} lists
 * @param {number} limit
 * @returns {T[]}
 */
function takeTurns(lists, limit) {
  /** @type {T[]} */
  const taken = [];
  const longest = Math.max(0, ...lists.map((list) => list.length));
  for (let turn = 0; turn < longest && taken.length < limit; turn++) {
    for (const list of lists) {
      const item = list[turn];
      if (item !== undefined && taken.length < limit) taken.push(item);
    }
  }
  return taken;
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
