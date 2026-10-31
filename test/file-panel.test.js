import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

// DOMPurify binds to window on import (through file-views), so the DOM is set up before the panel loads.
const { window } = new JSDOM('<!doctype html><html><body><main id="layout"><aside id="panel" hidden></aside></main></body></html>', { url: 'http://localhost/' });
Object.assign(globalThis, { window, document: window.document, NodeFilter: window.NodeFilter, Text: window.Text, Element: window.Element, HTMLAnchorElement: window.HTMLAnchorElement });
// jsdom has no media queries: the page's theme is light
window.matchMedia = () => /** @type {MediaQueryList} */ (/** @type {unknown} */ ({ matches: false }));
const { createFilePanel } = await import('../public/view/file-panel.js');

/** @typedef {import('../public/view/editor-opener.js').EditorOpener} EditorOpener */

/** A viewer without an editor. @type {EditorOpener} */
const noEditor = { reach: async () => 'none', check: async () => 'none', open: async () => ({ ok: false, error: 'no-editor' }) };

/** @typedef {import('../public/model/project.js').Match} Match */

/** A project whose files neither download nor upload. @type {import('../public/view/project-view.js').Transfer} */
const noTransfer = { address: () => '', upload: async () => ({ ok: false, error: 'failed' }) };

/**
 * The panel as app.js creates it, in a page of its own; a file's project is D:/dev/shop, its search finding these lines.
 * @param {EditorOpener} [editor]
 * @param {readonly Match[]} [lines]
 * @param {Promise<import('../public/view/file-panel.js').OpenInVsCode | undefined>} [vscode] - none: the viewer runs no
 *   VS Code
 * @param {import('../public/view/file-panel.js').FileManager} [fileManager] - the browser elsewhere by default
 */
function filePanel(editor = noEditor, lines = [], vscode = Promise.resolve(undefined), fileManager = { places: { known: async () => 'none', find: async () => 'none' }, show: () => undefined }) {
  const layout = window.document.createElement('main');
  const panel = window.document.createElement('aside');
  panel.hidden = true;
  layout.append(panel);
  window.document.body.append(layout);
  const files = createFilePanel({
    panel,
    layout,
    editor,
    vscode,
    fileManager,
    // a folder linked: its files, with nothing in them
    folder: (root) => ({ root, listFolder: async (path) => ({ ok: true, path, entries: [], more: false }), search: async () => undefined, links: async () => undefined, transfer: noTransfer }),
    // an icon that tells what it was asked for
    iconOf: (name, kind, open) => Object.assign(window.document.createElement('span'), { className: 'file-icon', title: `${kind}:${name}${open ? ':open' : ''}` }),
    project: () => ({
      root: 'D:/dev/shop',
      listFolder: async (path) => ({ ok: true, path, entries: [], more: false }),
      search: async (query) => ({ ok: true, root: 'D:/dev/shop', matches: lines.filter((line) => line.text.includes(query.text)), more: false }),
      transfer: noTransfer,
      // limits.ts imports clock.ts and express, and app.ts imports it
      links: async () => ({
        ok: true,
        imports: [
          { line: 1, spec: './clock', path: 'D:/dev/shop/src/clock.ts' },
          { line: 2, spec: 'express', path: undefined },
          // a type import of the same file further on: listed once
          { line: 9, spec: './clock', path: 'D:/dev/shop/src/clock.ts' },
        ],
        importedBy: [{ path: 'D:/dev/shop/src/app.ts', line: 3, text: "import { allow } from './limits';" }],
        more: false,
      }),
    }),
  });
  /** Opens the file a link in the feed points at. @param {string} path */
  const open = (path) => files.open({ path, line: undefined, endLine: undefined });
  /** The path of the picture the panel shows. */
  const shownPicture = () => {
    const image = panel.querySelector('.panel-body img');
    return image instanceof window.HTMLImageElement ? new URL(image.src).searchParams.get('path') : undefined;
  };
  return { panel, files, open, shownPicture };
}

/** @param {string} path */
function openedAt(path) {
  const { panel, open } = filePanel();
  open(path);
  return panel;
}

// A picture linked from the feed is shown as the picture, not refused as a file that is not text
test('filePanel_Should_ShowPicture_When_LinkedFileIsImage', () => {
  const panel = openedAt('D:/dev/x/docs/mobile.png');

  const image = panel.querySelector('.panel-body img');
  assert.ok(image instanceof window.HTMLImageElement);
  const source = new URL(image.src);
  assert.deepEqual({ address: source.pathname, path: source.searchParams.get('path') }, { address: '/api/file/image', path: 'D:/dev/x/docs/mobile.png' });
});

// A picture that does not load — gone, too large, not a picture inside — leaves a word instead of a broken image
test('filePanel_Should_SayPictureIsNotShown_When_ItDoesNotLoad', () => {
  const panel = openedAt('D:/dev/x/docs/gone.png');
  const image = panel.querySelector('.panel-body img');
  assert.ok(image);

  image.dispatchEvent(new window.Event('error'));

  assert.deepEqual(
    [...panel.querySelectorAll('.panel-body > *')].map((node) => node.className),
    ['fv-message'],
  );
});

// A picture that fails only after another file was opened leaves that file in the panel
test('filePanel_Should_KeepFileOpenedLater_When_EarlierPictureFails', () => {
  const { panel, open, shownPicture } = filePanel();
  open('D:/dev/x/docs/gone.png');
  const earlier = panel.querySelector('.panel-body img');
  assert.ok(earlier);
  open('D:/dev/x/docs/screenshot.png');

  earlier.dispatchEvent(new window.Event('error'));

  assert.equal(shownPicture(), 'D:/dev/x/docs/screenshot.png');
});

// A file opens in the editor at its marked line from a browser on the viewer's computer; one elsewhere gets no button;
// one not known yet finds out on the press, and the button goes if the browser is elsewhere
test('filePanel_Should_OpenFileInEditorAtItsLine_OnViewersComputerOnly', async () => {
  /** @type {(string | number)[][]} */
  const opened = [];
  /** @param {import('../public/model/machine.js').EditorReach} reach @param {import('../public/model/machine.js').EditorReach} checked @returns {EditorOpener} */
  const editor = (reach, checked) => ({
    reach: async () => reach,
    check: async () => checked,
    open: async (path, line) => {
      opened.push([path, line]);
      return { ok: true };
    },
  });
  const panels = [filePanel(editor('same', 'same')), filePanel(editor('elsewhere', 'elsewhere')), filePanel(editor('unknown', 'elsewhere')), filePanel(editor('unknown', 'same'))];
  for (const { files } of panels) files.open({ path: 'D:/dev/x/App.cs', line: 21, endLine: undefined });
  const settle = () => new Promise((done) => setTimeout(done, 10));
  /** @param {HTMLElement} panel */
  const buttonOf = (panel) => {
    const button = panel.querySelector('.panel-editor');
    assert.ok(button instanceof window.HTMLButtonElement);
    return button;
  };
  const shown = () => panels.map(({ panel }) => !buttonOf(panel).hidden);
  await settle();
  const before = shown();

  for (const at of [0, 2, 3]) buttonOf(panels[at]?.panel ?? window.document.body).click();
  await settle();

  assert.deepEqual({ before, after: shown(), opened }, { before: [true, false, true, true], after: [true, false, false, true], opened: [['D:/dev/x/App.cs', 21], ['D:/dev/x/App.cs', 21]] });
});

// A browser that keeps the page from this computer's apps keeps the button: a press says where to let the page in — over
// the file, not in it, where a file scrolled down would hide it — and the next press, the page let in, opens the file
test('filePanel_Should_TellHowToLetPageIn_When_BrowserKeepsItFromThisComputersApps', async () => {
  /** @type {import('../public/model/machine.js').EditorReach[]} */
  const checks = ['blocked', 'same'];
  /** @type {(string | number)[][]} */
  const opened = [];
  const { panel, files } = filePanel({
    reach: async () => 'unknown',
    check: async () => checks.shift() ?? 'none',
    open: async (path, line) => {
      opened.push([path, line]);
      return { ok: true };
    },
  });
  files.open({ path: 'D:/dev/x/App.cs', line: 21, endLine: undefined });
  const settle = () => new Promise((done) => setTimeout(done, 10));
  await settle();
  const button = panel.querySelector('.panel-editor');
  assert.ok(button instanceof window.HTMLButtonElement);

  button.click();
  await settle();
  const note = panel.querySelector('.panel-note:not([hidden])');
  const told = { shown: !button.hidden, inFile: note?.closest('.panel-body') !== null, letIn: note?.textContent?.includes('Apps on device') };
  button.click();
  await settle();

  assert.deepEqual({ told, opened }, { told: { shown: true, inFile: false, letIn: true }, opened: [['D:/dev/x/App.cs', 21]] });
});

// A file opens in VS Code in the browser at its line when the viewer runs VS Code — from any browser, it is reached
// through the viewer; a viewer without it shows no button, nor does a list in place of a file
// The file open shows in its folder in the computer's file manager, picked out — from a browser on the viewer's
// computer; one elsewhere has no such button, nor does a list in place of a file
test('filePanel_Should_ShowFileInItsFolder_FromBrowserOnViewersComputer', async () => {
  /** @type {string[]} */
  const shown = [];
  /** @param {import('../public/model/machine.js').EditorReach} place @returns {import('../public/view/file-panel.js').FileManager} */
  const at = (place) => ({ places: { known: async () => place, find: async () => place }, show: (path) => void shown.push(path) });
  const here = filePanel(noEditor, [], undefined, at('same'));
  const away = filePanel(noEditor, [], undefined, at('elsewhere'));
  for (const { files } of [here, away]) files.open({ path: 'D:/dev/x/App.cs', line: 21, endLine: undefined });
  await settled();
  /** @param {HTMLElement} panel */
  const buttonOf = (panel) => {
    const button = panel.querySelector('.panel-folder');
    assert.ok(button instanceof window.HTMLButtonElement);
    return button;
  };
  /** @param {Element | null} element — shown unless it or a box it is in is hidden */
  const visible = (element) => element !== null && element.closest('[hidden]') === null;
  const before = [here, away].map(({ panel }) => visible(buttonOf(panel)));

  buttonOf(here.panel).click();
  await settled();
  here.files.showFolder('D:/dev/x/');

  assert.deepEqual({ before, shown, overList: visible(buttonOf(here.panel)) }, { before: [true, false], shown: ['D:/dev/x/App.cs'], overList: false });
});

test('filePanel_Should_OpenFileInVsCodeAtItsLine_When_ViewerRunsIt', async () => {
  /** @type {(string | number | undefined)[][]} */
  const opened = [];
  const withVsCode = filePanel(noEditor, [], Promise.resolve((path, line) => void opened.push([path, line])));
  const without = filePanel(noEditor, [], Promise.resolve(undefined));
  for (const { files } of [withVsCode, without]) files.open({ path: 'D:/dev/x/App.cs', line: 21, endLine: undefined });
  await settled();
  /** @param {HTMLElement} panel */
  const buttonOf = (panel) => {
    const button = panel.querySelector('.panel-vscode');
    assert.ok(button instanceof window.HTMLButtonElement);
    return button;
  };
  const shown = [withVsCode, without].map(({ panel }) => !buttonOf(panel).hidden);

  buttonOf(withVsCode.panel).click();
  withVsCode.files.showFolder('D:/dev/x/');

  assert.deepEqual({ shown, opened, overList: !buttonOf(withVsCode.panel).hidden }, { shown: [true, false], opened: [['D:/dev/x/App.cs', 21]], overList: false });
});

/**
 * The viewer's answers to /api/file: the text of each file by its path.
 * @param {Record<string, string>} texts
 */
function serveTexts(texts) {
  globalThis.fetch = async (/** @type {string | URL | Request} */ address) => {
    const path = new URL(String(address), 'http://localhost/').searchParams.get('path') ?? '';
    const content = texts[path];
    return new Response(JSON.stringify(content === undefined ? { ok: false, error: 'not-found' } : { ok: true, content }));
  };
}
const settled = () => new Promise((done) => setTimeout(done, 10));

// A document's diagram fits the panel, drawn smaller when it is wider (style.css): a click shows it at its own size,
// scrolling sideways, and the next one fits it again
test('filePanel_Should_ShowDiagramAtItsOwnSizeOnClick_AndFitItAgainOnTheNext', async () => {
  Object.assign(globalThis, { DOMParser: window.DOMParser, XMLSerializer: window.XMLSerializer, SVGSVGElement: window.SVGSVGElement, HTMLElement: window.HTMLElement, HTMLImageElement: window.HTMLImageElement, HTMLScriptElement: window.HTMLScriptElement });
  Reflect.set(window, 'mermaid', { initialize() {}, render: async () => ({ svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 400"><text>wide</text></svg>' }) });
  serveTexts({ 'D:/dev/x/flow.md': '# Flow\n\n```mermaid\nflowchart LR\n  A --> B\n```\n' });
  const { panel, open } = filePanel();
  open('D:/dev/x/flow.md');
  await settled();
  const diagram = panel.querySelector('.panel-body .fv-diagram');
  const ownSize = () => diagram?.classList.contains('natural-size');

  diagram?.querySelector('img')?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  const once = ownSize();
  diagram?.querySelector('img')?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  Reflect.deleteProperty(window, 'mermaid');

  assert.deepEqual({ drawn: diagram !== null, once, twice: ownSize() }, { drawn: true, once: true, twice: false });
});

// A markdown document opens drawn as a document, its pictures from the viewer and its links to files opening in the
// panel — a link written as a link and a path in its text alike — a page on the web left to the browser
test('filePanel_Should_DrawMarkdownDocument_WithItsLinksToFilesOpeningInPanel', async () => {
  serveTexts({ 'D:/dev/x/docs/README.md': '# Guide\n\n![shot](img/shot.png)\n\nSee [the app](../src/App.cs#L12), D:/dev/x/notes.md:3 and [the site](https://example.com).\n' });
  const { panel, open } = filePanel();

  open('D:/dev/x/docs/README.md');
  await settled();

  const doc = panel.querySelector('.panel-body .fv-markdown');
  const image = doc?.querySelector('img');
  const links = [...(doc?.querySelectorAll('a') ?? [])].map((link) => ({ text: link.textContent, path: link.getAttribute('data-path'), line: link.getAttribute('data-line'), panel: link.classList.contains('file-link') }));
  assert.deepEqual(
    { picture: image instanceof window.HTMLImageElement ? new URL(image.src).searchParams.get('path') : undefined, links },
    {
      picture: 'D:/dev/x/docs/img/shot.png',
      links: [
        { text: 'the app', path: 'D:/dev/x/src/App.cs', line: '12', panel: true },
        { text: 'D:/dev/x/notes.md:3', path: 'D:/dev/x/notes.md', line: '3', panel: true },
        { text: 'the site', path: null, line: null, panel: false },
      ],
    },
  );
});

// A markdown file opens drawn as a document even from a link to a line of it — as the feed's links mostly are; Source
// over the panel shows its text, the linked line marked, and Document the drawn document again
test('filePanel_Should_OpenMarkdownLinkedAtLineAsDocument_And_ShowItsSourceAtThatLine', async () => {
  serveTexts({ 'D:/dev/x/notes.md': '# Notes\n\nfirst\n\nsecond\n' });
  const { panel, files } = filePanel();
  const shown = () => ({ source: panel.querySelector('.panel-body .fv-code') !== null, document: panel.querySelector('.panel-body .fv-markdown') !== null, mark: panel.querySelector('.panel-body .fv-line-mark') !== null });
  /** @param {string} label */
  const press = (label) => {
    const button = [...panel.querySelectorAll('.panel-view button')].find((one) => one.textContent === label);
    assert.ok(button instanceof window.HTMLButtonElement, label);
    button.click();
  };

  files.open({ path: 'D:/dev/x/notes.md', line: 5, endLine: undefined });
  await settled();
  const atLine = shown();
  press('Source');
  await settled();
  const source = shown();
  press('Document');
  await settled();

  assert.deepEqual({ atLine, source, back: shown() }, {
    atLine: { source: false, document: true, mark: false },
    source: { source: true, document: false, mark: true },
    back: { source: false, document: true, mark: false },
  });
});

// A page opens drawn in a frame from its folder, in a sandbox that runs none of its scripts; the button over the
// panel runs them — in an origin of its own, out of reach of the viewer's page — and the source is a button away
test('filePanel_Should_DrawPageInSandboxedFrame_And_RunScriptsOnlyWhenAsked', async () => {
  serveTexts({ 'D:/dev/x/site/page.html': '<p>hi</p>\n' });
  const { panel, open } = filePanel();
  const frame = () => {
    const found = panel.querySelector('.panel-body iframe');
    return found === null ? undefined : { sandbox: found.getAttribute('sandbox'), src: found.getAttribute('src') };
  };
  /** @param {string} selector */
  const press = (selector) => {
    const button = panel.querySelector(selector);
    assert.ok(button instanceof window.HTMLButtonElement, selector);
    button.click();
  };
  const folder = Buffer.from('D:/dev/x/site').toString('base64url');

  open('D:/dev/x/site/page.html');
  await settled();
  const quiet = frame();
  press('.panel-scripts');
  await settled();
  const running = frame();
  press('.panel-view-source');
  await settled();

  assert.deepEqual(
    { quiet, running, source: panel.querySelector('.panel-body .fv-code code')?.textContent },
    {
      quiet: { sandbox: 'allow-same-origin allow-popups allow-popups-to-escape-sandbox', src: `/api/folder/${folder}/page.html` },
      running: { sandbox: 'allow-scripts allow-popups allow-popups-to-escape-sandbox', src: `/api/folder/${folder}/page.html?scripts=1` },
      source: '<p>hi</p>',
    },
  );
});


// The branch's changes come into the panel in place of a file; a changed file opened from them shows in the panel, and
// the panel goes back to the changes as they were
test('filePanel_Should_ShowBranchChanges_And_GoBackToThemFromFileOpenedThere', async () => {
  const { panel, files } = filePanel();
  /** @type {import('../public/model/branch-changes.js').BranchChanges} */
  const changes = {
    ok: true,
    root: 'D:/dev/shop',
    branch: 'feat',
    base: { name: 'main', sha: 'a'.repeat(40), how: 'made-from' },
    commits: [],
    files: [{ path: 'src/limits.ts', oldPath: undefined, status: 'modified', added: 2, removed: 1 }],
    branches: ['main', 'feat'],
  };
  const title = () => [panel.querySelector('.panel-name')?.textContent, panel.querySelector('.panel-path')?.textContent];
  files.showChanges({ load: async () => changes, loadDiff: async () => undefined });
  await new Promise((done) => setTimeout(done, 0));
  const shownChanges = title();
  const listed = panel.querySelector('.panel-body .changes');

  panel.querySelector('.change-open')?.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  const shownFile = title();
  panel.querySelector('.panel-back')?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

  assert.deepEqual(
    { shownChanges, shownFile, back: title(), sameList: panel.querySelector('.panel-body .changes') === listed },
    { shownChanges: ['Branch changes', 'feat since main'], shownFile: ['limits.ts', 'D:/dev/shop/src/limits.ts'], back: ['Branch changes', 'feat since main'], sameList: true },
  );
});

// A text file — code, a document's source, a table — is edited in the panel; a picture, a PDF, a Word document is not
test('filePanel_Should_OfferEditingOfTextFilesOnly', () => {
  const offered = ['D:/dev/x/src/limits.ts', 'D:/dev/x/README.md', 'D:/dev/x/orders.csv', 'D:/dev/x/docs/mobile.png', 'D:/dev/x/docs/spec.pdf', 'D:/dev/x/docs/spec.docx'].map((path) => {
    const button = openedAt(path).querySelector('.panel-edit');
    return button instanceof window.HTMLButtonElement && !button.hidden;
  });

  assert.deepEqual(offered, [true, true, true, false, false, false]);
});

// The project's files in place of a file: its folder's tree, a file opened from it in the panel, and the way back to
// the tree as it was left — named for what it leads back to
test('filePanel_Should_ShowProjectFiles_And_GoBackToThemFromFileOpenedThere', async () => {
  const { panel, files } = filePanel();
  const title = () => [panel.querySelector('.panel-name')?.textContent, panel.querySelector('.panel-path')?.textContent];
  files.showProject({
    root: 'D:/dev/shop',
    listFolder: async (path) => ({ ok: true, path, entries: path === 'D:/dev/shop' ? [{ name: 'README.md', kind: 'file' }] : [], more: false }),
    search: async () => undefined,
    transfer: noTransfer,
  });
  await new Promise((done) => setTimeout(done, 0));
  const shownFiles = title();
  const listed = panel.querySelector('.panel-body .project');

  panel.querySelector('.project-entry')?.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  const shownFile = title();
  const back = panel.querySelector('.panel-back');
  const backSays = back?.textContent;
  back?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

  assert.deepEqual(
    { shownFiles, shownFile, backSays, back: title(), sameList: panel.querySelector('.panel-body .project') === listed },
    { shownFiles: ['Files', 'D:/dev/shop'], shownFile: ['README.md', 'D:/dev/shop/README.md'], backSays: '← Files', back: ['Files', 'D:/dev/shop'], sameList: true },
  );
});

// A name looked for from the editor: its one definition opens at its line, the way back leading to what was found; its
// uses show in the project's files, definitions first
test('filePanel_Should_GoToNamesOneDefinition_And_ShowItsUsesInProject', async () => {
  const lines = [
    { path: 'D:/dev/shop/src/app.ts', line: 7, column: 3, text: '  allow(count);' },
    { path: 'D:/dev/shop/src/limits.ts', line: 4, column: 17, text: 'export function allow(count: number): boolean {' },
  ];
  const { panel, files } = filePanel(noEditor, lines);
  const title = () => [panel.querySelector('.panel-name')?.textContent, panel.querySelector('.panel-line')?.textContent];

  await files.findName('definition', 'allow', 'D:/dev/shop/src/app.ts');
  const definition = { title: title(), back: panel.querySelector('.panel-back')?.hasAttribute('hidden') === false };
  await files.findName('uses', 'allow', 'D:/dev/shop/src/app.ts');
  const uses = { title: title(), sections: [...panel.querySelectorAll('.project-section-title')].map((one) => one.textContent) };

  assert.deepEqual(
    { definition, uses },
    { definition: { title: ['limits.ts', 'line 4'], back: true }, uses: { title: ['Files', ''], sections: ['Definition', 'Uses'] } },
  );
});

// A code file's links: what it imports — a package's import leading to no file — and what imports it; an import opens
// its file, with the way back to the links
test('filePanel_Should_ShowFilesLinks_And_OpenImportedFile', async () => {
  const { panel, open } = filePanel();
  open('D:/dev/shop/src/limits.ts');
  const button = panel.querySelector('.panel-links');
  assert.ok(button instanceof window.HTMLButtonElement && !button.hidden);

  button.click();
  await new Promise((done) => setTimeout(done, 0));
  const shown = {
    title: panel.querySelector('.panel-name')?.textContent,
    sections: [...panel.querySelectorAll('.links-section')].map((section) => ({
      title: section.querySelector('.project-section-title')?.textContent,
      rows: [...section.querySelectorAll('.links-row')].map((row) => row.textContent),
    })),
  };
  const clock = [...panel.querySelectorAll('.links-row')].find((row) => row.textContent?.includes('clock'));
  assert.ok(clock instanceof window.HTMLElement);
  clock.click();

  assert.deepEqual(
    { shown, opened: panel.querySelector('.panel-name')?.textContent, back: panel.querySelector('.panel-back')?.textContent },
    {
      shown: {
        title: 'Links',
        sections: [
          { title: 'Imports', rows: ['1./clocksrc/clock.ts', '2expresspackage'] },
          { title: 'Imported by', rows: ["src/app.ts3import { allow } from './limits';"] },
        ],
      },
      opened: 'clock.ts',
      back: '← Links',
    },
  );
});

// A file opened from the project's files shows beside them: the tree stays on the left, the file on the right, the one
// opened marked in the tree; another file from the tree takes its place; the way back to the files leaves the file
test('filePanel_Should_ShowFileBesideProjectsTree_TreeStaying', async () => {
  const { panel, files } = filePanel();
  files.showProject({
    root: 'D:/dev/shop',
    listFolder: async (path) => ({ ok: true, path, entries: path === 'D:/dev/shop' ? [{ name: 'README.md', kind: 'file' }, { name: 'limits.ts', kind: 'file' }] : [], more: false }),
    search: async () => undefined,
    transfer: noTransfer,
  });
  await new Promise((done) => setTimeout(done, 0));
  /** @param {string} label */
  const row = (label) => [...panel.querySelectorAll('.project-entry')].find((one) => one.textContent === label);
  const state = () => ({
    split: panel.classList.contains('split'),
    tree: panel.querySelector('.panel-side .project') !== null,
    file: panel.querySelector('.panel-name')?.textContent,
    marked: [...panel.querySelectorAll('.project-entry.selected')].map((one) => one.textContent),
  });

  row('README.md')?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  const first = state();
  row('limits.ts')?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  const second = state();
  panel.querySelector('.panel-back')?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

  assert.deepEqual(
    { first, second, back: state() },
    {
      first: { split: true, tree: true, file: 'README.md', marked: ['README.md'] },
      second: { split: true, tree: true, file: 'limits.ts', marked: ['limits.ts'] },
      back: { split: false, tree: false, file: 'Files', marked: ['limits.ts'] },
    },
  );
});

// Beside the project's files a file can take the whole panel: a button hides the files and shows them again; the files'
// list itself has no such button
test('filePanel_Should_HideProjectsTreeBesideFile_AndShowItAgain', async () => {
  const { panel, files } = filePanel();
  files.showProject({
    root: 'D:/dev/shop',
    listFolder: async (path) => ({ ok: true, path, entries: path === 'D:/dev/shop' ? [{ name: 'README.md', kind: 'file' }] : [], more: false }),
    search: async () => undefined,
    transfer: noTransfer,
  });
  await new Promise((done) => setTimeout(done, 0));
  const toggle = () => panel.querySelector('.panel-tree');
  const state = () => ({ offered: toggle() instanceof window.HTMLElement && !toggle()?.hasAttribute('hidden'), treeHidden: panel.classList.contains('tree-hidden') });
  const listed = state();

  [...panel.querySelectorAll('.project-entry')].find((one) => one.textContent === 'README.md')?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  const beside = state();
  toggle()?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  const hidden = state();
  toggle()?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

  assert.deepEqual(
    { listed, beside, hidden, shown: state() },
    {
      listed: { offered: false, treeHidden: false },
      beside: { offered: true, treeHidden: false },
      hidden: { offered: true, treeHidden: true },
      shown: { offered: true, treeHidden: false },
    },
  );
});

// A link to a folder opens its files: one written as a folder — its slash at the end — at once, one that turns out to be
// a folder once the viewer says so
test('filePanel_Should_ShowFolderLinkedAsItsFiles', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ ok: false, error: 'not-a-file' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  try {
    const { panel, open } = filePanel();
    const title = () => [panel.querySelector('.panel-name')?.textContent, panel.querySelector('.panel-path')?.textContent];

    open('D:/Downloads/puzzle/unpacked/');
    await new Promise((done) => setTimeout(done, 0));
    const slashed = title();
    open('D:/Downloads/puzzle/assets');
    await new Promise((done) => setTimeout(done, 20));

    assert.deepEqual({ slashed, plain: title() }, { slashed: ['Files', 'D:/Downloads/puzzle/unpacked'], plain: ['Files', 'D:/Downloads/puzzle/assets'] });
  } finally {
    globalThis.fetch = realFetch;
  }
});
