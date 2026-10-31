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
 * @param {Partial<import('../public/view/project-view.js').Transfer>} transfer — the viewer's transfers, where they go
 *   otherwise than here
 */
function projectOf(lines = [], transfer = {}) {
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
  /** The files uploaded, as [folder, the name saved under, existing]: the viewer takes them all, but one by a name
   *  there — told apart from it in no case, as on Windows — only to replace it. */
  /** @type {[string, string, 'keep' | 'replace'][]} */
  const uploads = [];
  const view = createProjectView({
    root: 'D:/dev/shop',
    listFolder: async (path) => ({ ok: true, path, entries: folders[path] ?? [], more: false }),
    search: async (query) => {
      asked.push(query);
      return { ok: true, root: 'D:/dev/shop', matches: lines.filter((line) => line.text.toLowerCase().includes(query.text.toLowerCase())), more: false };
    },
    openFile: (target) => opened.push(target),
    iconOf,
    transfer: {
      address: (path, kind) => `/download/${kind}?${path}`,
      upload: async (folder, file, name, existing) => {
        uploads.push([folder, name, existing]);
        const there = folders[folder] ?? [];
        const same = there.find((entry) => entry.name.toLowerCase() === name.toLowerCase());
        if (existing === 'keep' && same !== undefined) return { ok: false, error: 'exists', name: same.name };
        folders[folder] = [...there.filter((entry) => entry !== same), { name, kind: 'file' }];
        return { ok: true };
      },
      download: async () => ({ ok: false, error: 'failed' }),
      save: () => {},
      ...transfer,
    },
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
  /**
   * Files picked for an upload, as the browser's file picker gives them.
   * @param {readonly string[]} names @param {number} size — each one's, in bytes
   */
  const pick = (names, size = 5) => {
    const picker = view.element.querySelector('input.project-picker');
    assert.ok(picker instanceof window.HTMLInputElement, 'no file picker');
    Object.defineProperty(picker, 'files', { value: names.map((one) => new window.File([new Uint8Array(size)], one)), configurable: true });
    picker.dispatchEvent(new window.Event('change'));
  };
  /** What the line under the search tells of the upload, and its bar: how far it is filled, of how much. */
  const transferShown = () => {
    const bar = view.element.querySelector('.project-transfer progress');
    return { text: view.element.querySelector('.project-transfer')?.textContent, bar: bar === null ? undefined : [bar.getAttribute('value'), bar.getAttribute('max')] };
  };
  /** The rows under the search of what downloads, and what was downloaded. */
  const downloadsShown = () => [...view.element.querySelectorAll('.project-downloads .project-downloading')].map((one) => one.textContent);
  return { view, opened, asked, uploads, settle, tree, row, pick, transferShown, downloadsShown };
}

// Each file in the tree downloads from its row as it is, each folder as a zip, from the viewer's addresses for them;
// each under its own name
test('projectView_Should_OfferDownloadOfEachFileAndFolderInTree', async () => {
  const project = projectOf();
  await project.view.reload();
  project.row('src').click();
  await project.settle();

  assert.deepEqual(
    [...project.view.element.querySelectorAll('.project-tree a.project-download')].map((link) => [link.getAttribute('href'), link.getAttribute('download')]),
    [
      ['/download/folder?D:/dev/shop/src', 'src.zip'],
      ['/download/file?D:/dev/shop/src/limits.ts', 'limits.ts'],
      ['/download/file?D:/dev/shop/README.md', 'README.md'],
    ],
  );
});

// A folder takes the files picked for it — the project's own folder too: one by a name already there is replaced only
// once that is confirmed, and the folder — open, if it was not — shows what it holds then
test('projectView_Should_UploadFilesPickedIntoFolder_ReplacingOnlyOnceConfirmed', async () => {
  const project = projectOf();
  await project.view.reload();

  project.view.element.querySelector('.project-search .project-upload')?.dispatchEvent(new window.MouseEvent('click'));
  project.pick(['notes.md', 'README.md']);
  await project.settle();
  const asking = project.view.element.querySelector('.project-transfer-question')?.textContent;
  project.view.element.querySelector('.project-transfer-replace')?.dispatchEvent(new window.MouseEvent('click'));
  await project.settle();
  const [uploadIntoSrc] = [...project.view.element.querySelectorAll('.project-tree .project-upload')];
  uploadIntoSrc?.dispatchEvent(new window.MouseEvent('click'));
  project.pick(['orders.ts']);
  await project.settle();

  assert.deepEqual(
    { asking, uploads: project.uploads, tree: project.tree(), told: project.view.element.querySelector('.project-transfer')?.textContent },
    {
      asking: 'Replace README.md in shop?',
      uploads: [
        ['D:/dev/shop', 'notes.md', 'keep'],
        ['D:/dev/shop', 'README.md', 'keep'],
        ['D:/dev/shop', 'README.md', 'replace'],
        ['D:/dev/shop/src', 'orders.ts', 'keep'],
      ],
      tree: ['src', '  limits.ts', '  orders.ts', 'notes.md', 'README.md'],
      told: 'Uploaded orders.ts into shop/src',
    },
  );
});

// A file uploading tells how far it got — of how many picked, when more than one — its bar filling as its bytes go; an
// empty one has no share of its length to tell
test('projectView_Should_TellHowFarEachUploadGot_ItsBarFilling', async () => {
  /** @type {ReturnType<ReturnType<typeof projectOf>['transferShown']>[]} */
  const shown = [];
  const project = projectOf([], {
    upload: async (folder, file, name, existing, progress) => {
      shown.push(project.transferShown());
      progress(file.size / 4);
      shown.push(project.transferShown());
      return { ok: true };
    },
  });
  await project.view.reload();

  project.view.element.querySelector('.project-search .project-upload')?.dispatchEvent(new window.MouseEvent('click'));
  project.pick(['big.zip', 'notes.md'], 2048);
  await project.settle();
  project.view.element.querySelector('.project-search .project-upload')?.dispatchEvent(new window.MouseEvent('click'));
  project.pick(['empty.txt'], 0);
  await project.settle();

  assert.deepEqual(
    { shown, after: project.transferShown() },
    {
      shown: [
        { text: 'Uploading big.zip, 1 of 2 — 0% of 2 KB', bar: ['0', '2048'] },
        { text: 'Uploading big.zip, 1 of 2 — 25% of 2 KB', bar: ['512', '2048'] },
        { text: 'Uploading notes.md, 2 of 2 — 0% of 2 KB', bar: ['0', '2048'] },
        { text: 'Uploading notes.md, 2 of 2 — 25% of 2 KB', bar: ['512', '2048'] },
        { text: 'Uploading empty.txt — 0 B so far', bar: [null, null] },
        { text: 'Uploading empty.txt — 0 B so far', bar: [null, null] },
      ],
      after: { text: 'Uploaded empty.txt into shop', bar: undefined },
    },
  );
});

// A file or a folder downloads in the panel, not by the browser: its row under the search tells how far it got — of the
// file's length; a zip, made as it goes, by its bytes so far — then the file is saved under its own name. A download
// takes the place of those ended; one the viewer did not give says why
test('projectView_Should_DownloadInPanel_TellingHowFarItGot_ThenSaveUnderItsName', async () => {
  /** @type {(string | null)[][]} */
  const shown = [];
  /** @type {[string, number][]} */
  const saved = [];
  const project = projectOf([], {
    download: async (path, kind, progress) => {
      if (kind === 'folder') {
        progress(3_250_000, undefined);
        shown.push(project.downloadsShown());
        return { ok: false, error: 'too-large' };
      }
      progress(512, 2048);
      shown.push(project.downloadsShown());
      return { ok: true, file: new window.Blob([new Uint8Array(2048)]) };
    },
    save: (file, name) => saved.push([name, file.size]),
  });
  await project.view.reload();
  project.row('src').click();
  await project.settle();
  /** @param {Element | null | undefined} link */
  const press = async (link) => {
    const click = new window.MouseEvent('click', { bubbles: true, cancelable: true });
    link?.dispatchEvent(click);
    await project.settle();
    return click.defaultPrevented;
  };

  const fileByBrowser = await press([...project.view.element.querySelectorAll('.project-tree a.project-download')].find((link) => link.getAttribute('download') === 'limits.ts'));
  const fileEnded = project.downloadsShown();
  const zipByBrowser = await press(project.view.element.querySelector('.project-search a.project-download'));

  assert.deepEqual(
    { prevented: [fileByBrowser, zipByBrowser], shown, fileEnded, zipEnded: project.downloadsShown(), saved },
    {
      prevented: [true, true],
      shown: [['Downloading limits.ts — 25% of 2 KB'], ['Downloading src.zip — 3.1 MB so far']],
      fileEnded: ['Downloaded limits.ts — 2 KB'],
      zipEnded: ['Not downloaded — src.zip: too big to zip'],
      saved: [['limits.ts', 2048]],
    },
  );
});

// The download beside the search gives what is chosen in the tree, as its title says: a folder clicked as a zip, the
// file shown as it is; the project as a zip while nothing is chosen, or the file shown is not in the project
test('projectView_Should_DownloadFromBesideSearchWhatIsChosenInTree', async () => {
  const project = projectOf();
  await project.view.reload();
  const offered = () => {
    const link = project.view.element.querySelector('.project-search .project-download');
    return [link?.getAttribute('href'), link?.getAttribute('download'), link?.getAttribute('title')];
  };

  const nothing = offered();
  project.row('src').click();
  await project.settle();
  const folder = offered();
  project.view.select('D:/dev/shop/src/limits.ts');
  const file = offered();
  project.view.select('D:/dev/shopping/cart.ts');
  const elsewhere = offered();

  assert.deepEqual(
    { nothing, folder, file, elsewhere },
    {
      nothing: ['/download/folder?D:/dev/shop', 'shop.zip', 'Download shop as a zip'],
      folder: ['/download/folder?D:/dev/shop/src', 'src.zip', 'Download shop/src as a zip'],
      file: ['/download/file?D:/dev/shop/src/limits.ts', 'limits.ts', 'Download shop/src/limits.ts'],
      elsewhere: ['/download/folder?D:/dev/shop', 'shop.zip', 'Download shop as a zip'],
    },
  );
});

// The upload beside the search goes where its title says: into the folder chosen in the tree — clicked, closed again
// too — marked there, or into the folder holding the file shown; into the project's own folder while nothing is chosen,
// or the file shown is not in the project
test('projectView_Should_UploadFromBesideSearchIntoFolderChosenInTree', async () => {
  const project = projectOf();
  await project.view.reload();
  const upload = project.view.element.querySelector('.project-search .project-upload');
  assert.ok(upload instanceof window.HTMLElement, 'no upload beside the search');
  /** @type {string[]} */
  const titles = [];
  /** @param {string} name */
  const uploadFromSearch = async (name) => {
    titles.push(upload.title);
    upload.dispatchEvent(new window.MouseEvent('click'));
    project.pick([name]);
    await project.settle();
  };
  const marked = () => [...project.view.element.querySelectorAll('.project-entry.selected')].map((row) => row.getAttribute('title'));

  await uploadFromSearch('a.ts');
  project.row('src').click();
  await project.settle();
  const markedFolder = marked();
  await uploadFromSearch('b.ts');
  project.row('src').click();
  await project.settle();
  await uploadFromSearch('c.ts');
  project.view.select('D:/dev/shop/README.md');
  await uploadFromSearch('d.ts');
  project.view.select('D:/dev/shop/src/limits.ts');
  await uploadFromSearch('e.ts');
  project.view.select('D:/dev/shopping/cart.ts');
  await uploadFromSearch('f.ts');

  assert.deepEqual(
    { titles, markedFolder, uploads: project.uploads.map(([folder, name]) => `${folder} ← ${name}`) },
    {
      titles: ['Upload files into shop', 'Upload files into shop/src', 'Upload files into shop/src', 'Upload files into shop', 'Upload files into shop/src', 'Upload files into shop'],
      markedFolder: ['D:/dev/shop/src'],
      uploads: ['D:/dev/shop ← a.ts', 'D:/dev/shop/src ← b.ts', 'D:/dev/shop/src ← c.ts', 'D:/dev/shop ← d.ts', 'D:/dev/shop/src ← e.ts', 'D:/dev/shop ← f.ts'],
    },
  );
});

// A name told from the file there only by its case is that file: the question offers both names, and the file
// replaced is named as chosen — as it came, or as it was there
test('projectView_Should_OfferBothNames_When_FileThereDiffersOnlyInCase', async () => {
  const project = projectOf();
  await project.view.reload();
  const asked = () => ({
    question: project.view.element.querySelector('.project-transfer-question')?.textContent,
    offered: [...project.view.element.querySelectorAll('.project-transfer-replace')].map((button) => button.textContent),
  });
  /** @param {string} name */
  const replaceAs = (name) => [...project.view.element.querySelectorAll('.project-transfer-replace')].find((button) => button.textContent === name)?.dispatchEvent(new window.MouseEvent('click'));
  /** @param {string} name */
  const upload = async (name) => {
    project.view.element.querySelector('.project-search .project-upload')?.dispatchEvent(new window.MouseEvent('click'));
    project.pick([name]);
    await project.settle();
  };

  await upload('readme.md');
  const first = asked();
  replaceAs('readme.md');
  await project.settle();
  const renamed = project.tree();
  await upload('README.md');
  const second = asked();
  replaceAs('readme.md');
  await project.settle();

  assert.deepEqual(
    { first, renamed, second, uploads: project.uploads, tree: project.tree() },
    {
      first: { question: 'Replace README.md in shop, named:', offered: ['README.md', 'readme.md'] },
      renamed: ['src', 'readme.md'],
      second: { question: 'Replace readme.md in shop, named:', offered: ['readme.md', 'README.md'] },
      uploads: [
        ['D:/dev/shop', 'readme.md', 'keep'],
        ['D:/dev/shop', 'readme.md', 'replace'],
        ['D:/dev/shop', 'README.md', 'keep'],
        ['D:/dev/shop', 'readme.md', 'replace'],
      ],
      tree: ['src', 'readme.md'],
    },
  );
});

// A file whose name is there can go in under a name of its own instead, the one it came by offered to change; a name
// that is there too is asked about anew, and Enter uploads as the button does
test('projectView_Should_UploadFileUnderNewName_AskingAgain_While_ThatNameIsThereToo', async () => {
  const project = projectOf();
  await project.view.reload();
  /** @param {string} name — typed over the one offered @returns {string} the one offered */
  const rename = (name) => {
    project.view.element.querySelector('.project-transfer-rename')?.dispatchEvent(new window.MouseEvent('click'));
    const field = project.view.element.querySelector('input.project-transfer-name');
    assert.ok(field instanceof window.HTMLInputElement, 'no field for the new name');
    const offered = field.value;
    field.value = name;
    return offered;
  };

  project.view.element.querySelector('.project-search .project-upload')?.dispatchEvent(new window.MouseEvent('click'));
  project.pick(['README.md']);
  await project.settle();
  const offered = rename('readme.MD');
  project.view.element.querySelector('.project-transfer-upload')?.dispatchEvent(new window.MouseEvent('click'));
  await project.settle();
  const askedAgain = project.view.element.querySelector('.project-transfer-question')?.textContent;
  rename('README-new.md');
  project.view.element.querySelector('input.project-transfer-name')?.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter' }));
  await project.settle();

  assert.deepEqual(
    { offered, askedAgain, uploads: project.uploads, tree: project.tree(), told: project.view.element.querySelector('.project-transfer')?.textContent },
    {
      offered: 'README.md',
      askedAgain: 'Replace README.md in shop, named:',
      uploads: [
        ['D:/dev/shop', 'README.md', 'keep'],
        ['D:/dev/shop', 'readme.MD', 'keep'],
        ['D:/dev/shop', 'README-new.md', 'keep'],
      ],
      tree: ['src', 'README.md', 'README-new.md'],
      told: 'Uploaded README-new.md into shop',
    },
  );
});

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
    // nothing goes either way here
    transfer: { address: (path) => `/download?${path}`, upload: async () => ({ ok: false, error: 'failed' }), download: async () => ({ ok: false, error: 'failed' }), save: () => {} },
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
