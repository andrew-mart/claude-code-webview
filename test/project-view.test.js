import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const { window } = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
Object.assign(globalThis, { window, document: window.document, HTMLElement: window.HTMLElement, Element: window.Element });
const { createProjectView } = await import('../public/view/project-view.js');
const { projectOfFile } = await import('../public/model/project.js');

/**
 * An icon that tells what it was asked for: kind, name, open or not.
 * @param {string} name @param {'file' | 'folder'} kind @param {boolean} open
 */
function iconOf(name, kind, open) {
  const icon = document.createElement('span');
  icon.className = 'file-icon';
  icon.setAttribute('data-icon', `${kind}:${name}${open ? ':open' : ''}`);
  return icon;
}

/**
 * A project at D:/dev/shop, its folders by path, and a search over it that finds what is asked in a fixed set of lines.
 * @param {import('../public/model/project.js').Match[]} lines
 */
function projectOf(lines = []) {
  /** @type {Record<string, import('../public/model/project.js').FolderEntry[]>} */
  const folders = {
    'D:/dev/shop': [
      { name: 'src', kind: 'folder' },
      { name: 'README.md', kind: 'file' },
    ],
    'D:/dev/shop/src': [{ name: 'limits.ts', kind: 'file' }],
  };
  /** @type {import('../public/view/file-links.js').FileTarget[]} */
  const opened = [];
  /** @type {import('../public/model/project.js').SearchQuery[]} */
  const asked = [];
  const view = createProjectView({
    root: 'D:/dev/shop',
    listFolder: async (path) => ({ ok: true, path, entries: folders[path] ?? [], more: false }),
    search: async (query) => {
      asked.push(query);
      return { ok: true, root: 'D:/dev/shop', matches: lines.filter((line) => line.text.toLowerCase().includes(query.text.toLowerCase())), more: false };
    },
    openFile: (target) => opened.push(target),
    iconOf,
  });
  document.body.replaceChildren(view.element);
  /** Lets the page's promises settle. */
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  /** The tree's rows as shown, indented by depth. */
  const tree = () => [...view.element.querySelectorAll('.project-tree .project-entry')].map((row) => `${'  '.repeat(Number(row.getAttribute('data-depth')))}${row.textContent}`);
  /** @param {string} label */
  const row = (label) => {
    const found = [...view.element.querySelectorAll('.project-entry')].find((one) => one.textContent === label);
    assert.ok(found instanceof window.HTMLElement, `no row ${label}`);
    return found;
  };
  return { view, opened, asked, settle, tree, row };
}

// The project's folder shows its folders and files; a folder opens in place under its row, and closes again; a file
// opens in the panel
test('projectView_Should_OpenFoldersInPlace_AndFilesInPanel', async () => {
  const project = projectOf();
  await project.view.reload();

  const top = project.tree();
  project.row('src').click();
  await project.settle();
  const opened = project.tree();
  project.row('limits.ts').click();
  project.row('src').click();
  await project.settle();

  assert.deepEqual(
    { top, opened, closed: project.tree(), files: project.opened },
    {
      top: ['src', 'README.md'],
      opened: ['src', '  limits.ts', 'README.md'],
      closed: ['src', 'README.md'],
      files: [{ path: 'D:/dev/shop/src/limits.ts', line: undefined, endLine: undefined }],
    },
  );
});

// The project's text searched: matches by file — its path from the project's folder — each line with what was asked
// marked; the toggles ask as they say; a match opens its file at its line; the tree gives way to the matches and comes
// back once the field is empty
test('projectView_Should_ShowMatchesByFile_AndOpenMatchAtItsLine', async () => {
  const project = projectOf([
    { path: 'D:/dev/shop/src/limits.ts', line: 2, column: 14, text: 'export const perSecond = 10;' },
    { path: 'D:/dev/shop/src/limits.ts', line: 5, column: 20, text: '  return count < perSecond;' },
    { path: 'D:/dev/shop/README.md', line: 3, column: 1, text: 'PerSecond is the limit' },
  ]);
  await project.view.reload();
  const field = project.view.element.querySelector('input');
  assert.ok(field instanceof window.HTMLInputElement);
  /** @param {string} title */
  const toggle = (title) => [...project.view.element.querySelectorAll('button')].find((button) => button.title.startsWith(title));

  field.value = 'persecond';
  toggle('Whole words')?.click();
  await project.settle();
  const files = [...project.view.element.querySelectorAll('.project-file')].map((file) => ({
    name: file.querySelector('.project-file-name')?.textContent,
    lines: [...file.querySelectorAll('.project-match')].map((match) => `${match.querySelector('.project-line')?.textContent}: ${match.querySelector('mark')?.textContent}`),
  }));
  const treeHidden = project.view.element.querySelector('.project-tree')?.hasAttribute('hidden');
  const second = project.view.element.querySelectorAll('.project-file .project-match')[1];
  assert.ok(second instanceof window.HTMLElement);
  second.click();
  field.value = '';
  field.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter' }));
  await project.settle();

  assert.deepEqual(
    { asked: project.asked, files, treeHidden, opened: project.opened, treeBack: !project.view.element.querySelector('.project-tree')?.hasAttribute('hidden') },
    {
      asked: [{ text: 'persecond', mode: 'text', caseSensitive: false, wholeWord: true }],
      files: [
        { name: 'src/limits.ts', lines: ['2: perSecond', '5: perSecond'] },
        { name: 'README.md', lines: ['3: PerSecond'] },
      ],
      treeHidden: true,
      opened: [{ path: 'D:/dev/shop/src/limits.ts', line: 5, endLine: undefined }],
      treeBack: true,
    },
  );
});

// A file's project: the open session's folder when the file is in it — either kind of slashes, any case of a Windows
// drive's path — else the file's own folder
test('projectOfFile_Should_TakeSessionsFolderHoldingFile_ElseFilesFolder', () => {
  assert.deepEqual(
    [
      projectOfFile('D:/dev/shop/src/limits.ts', 'D:\\dev\\shop'),
      projectOfFile('d:\\Dev\\Shop\\README.md', 'D:\\dev\\shop'),
      projectOfFile('D:/dev/shopping/a.ts', 'D:\\dev\\shop'),
      projectOfFile('/home/ann/notes/todo.md', undefined),
      projectOfFile('/home/ann/notes/todo.md', '/home/ann/shop'),
    ],
    ['D:\\dev\\shop', 'D:\\dev\\shop', 'D:/dev/shopping', '/home/ann/notes', '/home/ann/notes'],
  );
});

// A name looked for from the editor: its definitions first, then its uses, each by file; the definitions are told back
// for the panel to go to the one there is
test('projectView_Should_ShowNamesDefinitionsBeforeItsUses', async () => {
  const project = projectOf([
    { path: 'D:/dev/shop/src/app.ts', line: 7, column: 3, text: '  allow(count);' },
    { path: 'D:/dev/shop/src/limits.ts', line: 4, column: 17, text: 'export function allow(count: number): boolean {' },
    { path: 'D:/dev/shop/src/limits.ts', line: 9, column: 10, text: '  return allow(count - 1);' },
  ]);
  await project.view.reload();

  const told = await project.view.searchFor({ text: 'allow', mode: 'text', caseSensitive: true, wholeWord: true }, { name: 'allow' });
  const sections = [...project.view.element.querySelectorAll('.project-section')].map((section) => ({
    title: section.querySelector('.project-section-title')?.textContent,
    lines: [...section.querySelectorAll('.project-match')].map((match) => match.getAttribute('title')),
  }));

  assert.deepEqual(
    { sections, told: told.map((match) => `${match.path}:${match.line}`) },
    {
      sections: [
        { title: 'Definition', lines: ['D:/dev/shop/src/limits.ts:4'] },
        { title: 'Uses', lines: ['D:/dev/shop/src/app.ts:7', 'D:/dev/shop/src/limits.ts:9'] },
      ],
      told: ['D:/dev/shop/src/limits.ts:4'],
    },
  );
});

// Each folder and file of the tree, each file found, shows its icon — a folder's as it is, open or closed
test('projectView_Should_ShowEachEntrysIcon', async () => {
  const project = projectOf([{ path: 'D:/dev/shop/src/limits.ts', line: 2, column: 1, text: 'export const limit = 1;' }]);
  await project.view.reload();
  project.row('src').click();
  await project.settle();
  const icons = () => [...project.view.element.querySelectorAll('.file-icon')].map((icon) => icon.getAttribute('data-icon'));
  const tree = icons();
  await project.view.searchFor({ text: 'limit', mode: 'text', caseSensitive: false, wholeWord: false });

  const found = [...project.view.element.querySelectorAll('.project-results .file-icon')].map((icon) => icon.getAttribute('data-icon'));

  assert.deepEqual({ tree, found }, { tree: ['folder:src:open', 'file:limits.ts', 'file:README.md'], found: ['file:limits.ts'] });
});

/**
 * A project at D:/dev/shop whose folders the viewer answers for only when told; every folder asked for recorded.
 * @param {Record<string, import('../public/model/project.js').FolderEntry[]>} folders — by path
 */
function heldProject(folders) {
  /** @type {string[]} */
  const asked = [];
  /** @type {(() => void)[]} */
  const held = [];
  const view = createProjectView({
    root: 'D:/dev/shop',
    listFolder: (path) =>
      new Promise((resolve) => {
        asked.push(path);
        held.push(() => resolve({ ok: true, path, entries: folders[path] ?? [], more: false }));
      }),
    search: async () => undefined,
    openFile: () => undefined,
    iconOf,
  });
  document.body.replaceChildren(view.element);
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  /** The viewer answers every folder asked for, and those asked for meanwhile, until none waits. */
  const answer = async () => {
    while (held.length > 0) {
      for (const go of held.splice(0)) go();
      await settle();
    }
  };
  const tree = () => [...view.element.querySelectorAll('.project-tree .project-entry')].map((row) => `${'  '.repeat(Number(row.getAttribute('data-depth')))}${row.textContent}`);
  /** @param {string} label */
  const row = (label) => {
    const found = [...view.element.querySelectorAll('.project-entry')].find((one) => one.textContent === label);
    assert.ok(found instanceof window.HTMLElement, `no row ${label}`);
    return found;
  };
  /** The tree as it opens: the project's folder read, and what is read ahead under it. */
  const load = async () => {
    const loaded = view.reload();
    await answer();
    await loaded;
  };
  return { asked, answer, settle, tree, row, load };
}

// The folders under the project's are read ahead as its tree opens: one opened shows what it holds at once, before the
// viewer answers again
test('projectView_Should_ShowFolderReadAhead_AtOnceAsItOpens', async () => {
  const project = heldProject({ 'D:/dev/shop': [{ name: 'src', kind: 'folder' }, { name: 'README.md', kind: 'file' }], 'D:/dev/shop/src': [{ name: 'limits.ts', kind: 'file' }] });
  await project.load();

  project.row('src').click();
  await project.settle();

  assert.deepEqual(project.tree(), ['src', '  limits.ts', 'README.md']);
});

// Reading ahead goes two levels under the folder opened — the project's as the tree opens — not into what is installed
// or built there (node_modules), and not through every folder of one holding very many
test('projectView_Should_ReadAheadTwoLevelsUnderFolderOpened_ButNotIntoDependencies', async () => {
  const many = Array.from({ length: 300 }, (_, at) => ({ name: `d${at}`, kind: /** @type {const} */ ('folder') }));
  const project = heldProject({
    'D:/dev/shop': [
      { name: 'assets', kind: 'folder' },
      { name: 'node_modules', kind: 'folder' },
      { name: 'src', kind: 'folder' },
    ],
    'D:/dev/shop/assets': many,
    'D:/dev/shop/src': [{ name: 'view', kind: 'folder' }],
    'D:/dev/shop/src/view': [{ name: 'parts', kind: 'folder' }],
    'D:/dev/shop/src/view/parts': [{ name: 'deep', kind: 'folder' }],
  });
  await project.load();
  const atOpen = [...project.asked];

  project.row('src').click();
  await project.answer();
  const ofProject = (/** @type {string[]} */ paths) => [...new Set(paths.filter((path) => !path.startsWith('D:/dev/shop/assets/')))].sort();

  assert.deepEqual(
    { atOpen: ofProject(atOpen), assetsFoldersReadAhead: atOpen.filter((path) => path.startsWith('D:/dev/shop/assets/')).length < many.length, underSrc: ofProject(project.asked.slice(atOpen.length)) },
    { atOpen: ['D:/dev/shop', 'D:/dev/shop/assets', 'D:/dev/shop/src', 'D:/dev/shop/src/view'], assetsFoldersReadAhead: true, underSrc: ['D:/dev/shop/src', 'D:/dev/shop/src/view/parts'] },
  );
});

// A folder read ahead may have changed by the time it opens: it is read again as it opens, and drawn as it is now
test('projectView_Should_DrawFolderAsItIsNow_When_ItChangedSinceReadAhead', async () => {
  /** @type {Record<string, import('../public/model/project.js').FolderEntry[]>} */
  const folders = { 'D:/dev/shop': [{ name: 'src', kind: 'folder' }], 'D:/dev/shop/src': [{ name: 'limits.ts', kind: 'file' }] };
  const project = heldProject(folders);
  await project.load();
  folders['D:/dev/shop/src'] = [{ name: 'limits.ts', kind: 'file' }, { name: 'quotas.ts', kind: 'file' }];

  project.row('src').click();
  await project.answer();

  assert.deepEqual(project.tree(), ['src', '  limits.ts', '  quotas.ts']);
});
