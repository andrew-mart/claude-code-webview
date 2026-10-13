import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

// DOMPurify binds to window on import (through markdown.js), so the DOM is set up before the panel loads.
const { window } = new JSDOM('<!doctype html><html><body><main id="layout"><aside id="panel" hidden></aside></main></body></html>', { url: 'http://localhost/' });
Object.assign(globalThis, { window, document: window.document, NodeFilter: window.NodeFilter, Text: window.Text, Element: window.Element });
const { createFilePanel } = await import('../public/view/file-panel.js');

/** @typedef {import('../public/view/editor-opener.js').EditorOpener} EditorOpener */

/** A viewer without an editor. @type {EditorOpener} */
const noEditor = { reach: async () => 'none', check: async () => 'none', open: async () => ({ ok: false, error: 'no-editor' }) };

/**
 * The panel as app.js creates it, in a page of its own.
 * @param {EditorOpener} [editor]
 */
function filePanel(editor = noEditor) {
  const layout = window.document.createElement('main');
  const panel = window.document.createElement('aside');
  panel.hidden = true;
  layout.append(panel);
  window.document.body.append(layout);
  const files = createFilePanel({ panel, layout, editor });
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
    ['panel-message'],
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

// A markdown document opens drawn as a document: its pictures and links read from where it lies — a picture shown
// from the file next to it, a linked file opened in the panel — a page on the web left to the browser; the settings
// block at its head is not shown
test('filePanel_Should_DrawMarkdownAsDocument_WithLinksReadFromItsFolder', async () => {
  serveTexts({ 'D:/dev/x/docs/README.md': '---\ntitle: Guide\n---\n# Guide\n\n![shot](img/shot.png)\n\nSee [the app](../src/App.cs#L12) and [the site](https://example.com).\n' });
  const { panel, open } = filePanel();

  open('D:/dev/x/docs/README.md');
  await settled();

  const doc = panel.querySelector('.panel-body .doc-markdown');
  const image = doc?.querySelector('img');
  const links = [...(doc?.querySelectorAll('a') ?? [])].map((link) => ({ text: link.textContent, path: link.getAttribute('data-path'), line: link.getAttribute('data-line'), target: link.getAttribute('target') }));
  assert.deepEqual(
    { heading: doc?.querySelector('h1')?.textContent, settings: doc?.textContent?.includes('title: Guide'), picture: image instanceof window.HTMLImageElement ? new URL(image.src).searchParams.get('path') : undefined, links },
    {
      heading: 'Guide',
      settings: false,
      picture: 'D:/dev/x/docs/img/shot.png',
      links: [
        { text: 'the app', path: 'D:/dev/x/src/App.cs', line: '12', target: null },
        { text: 'the site', path: null, line: null, target: '_blank' },
      ],
    },
  );
});

// A link to a line of a markdown file opens its source at that line; the button over the panel turns it into the drawn
// document and back
test('filePanel_Should_OpenMarkdownSourceAtLinkedLine_And_SwitchToDocumentAndBack', async () => {
  serveTexts({ 'D:/dev/x/notes.md': '# Notes\n\nfirst\n\nsecond\n' });
  const { panel, files } = filePanel();
  const shown = () => ({ source: panel.querySelector('.panel-body .file-code') !== null, document: panel.querySelector('.panel-body .doc-markdown') !== null, mark: panel.querySelector('.panel-body .line-mark') !== null });
  const toggle = () => {
    const button = panel.querySelector('.panel-view');
    assert.ok(button instanceof window.HTMLButtonElement);
    return button;
  };

  files.open({ path: 'D:/dev/x/notes.md', line: 5, endLine: undefined });
  await settled();
  const atLine = shown();
  toggle().click();
  await settled();
  const drawn = shown();
  toggle().click();
  await settled();

  assert.deepEqual({ atLine, drawn, back: shown() }, {
    atLine: { source: true, document: false, mark: true },
    drawn: { source: false, document: true, mark: false },
    back: { source: true, document: false, mark: true },
  });
});

// A table's columns are told apart by colour, its lines numbered as any file's
test('filePanel_Should_ColourTableColumns', async () => {
  serveTexts({ 'D:/dev/x/rates.csv': 'name;price\nmilk;1,20\n' });
  const { panel, open } = filePanel();

  open('D:/dev/x/rates.csv');
  await settled();

  assert.deepEqual(
    [...panel.querySelectorAll('.panel-body .file-code code span')].map((span) => [span.className, span.textContent]),
    [['csv-c0', 'name'], ['csv-c1', 'price'], ['csv-c0', 'milk'], ['csv-c1', '1,20']],
  );
});

// Addresses in a text file are links to open in the browser
test('filePanel_Should_LinkWebAddressesInTextFile', async () => {
  serveTexts({ 'D:/dev/x/notes.txt': 'docs at https://example.com/guide, and <b>no markup</b>\n' });
  const { panel, open } = filePanel();

  open('D:/dev/x/notes.txt');
  await settled();

  const code = panel.querySelector('.panel-body .file-code code');
  assert.deepEqual(
    { links: [...(code?.querySelectorAll('a') ?? [])].map((link) => [link.getAttribute('href'), link.getAttribute('target')]), bold: code?.querySelector('b'), text: code?.textContent },
    { links: [['https://example.com/guide', '_blank']], bold: null, text: 'docs at https://example.com/guide, and <b>no markup</b>' },
  );
});

// A link to a heading of the document goes to it inside the panel; the page's own address stays as it is
test('filePanel_Should_GoToHeadingInsidePanel_When_DocumentLinksToIt', async () => {
  serveTexts({ 'D:/dev/x/guide.md': '[Install](#install-on-windows)\n\n## Install on Windows\n\n## Install on Windows\n' });
  const { panel, open } = filePanel();
  open('D:/dev/x/guide.md');
  await settled();
  /** @type {string[]} */
  const reached = [];
  for (const heading of panel.querySelectorAll('h2')) heading.scrollIntoView = () => reached.push(heading.id);
  const link = panel.querySelector('.doc-markdown a');
  assert.ok(link);

  const click = new window.MouseEvent('click', { bubbles: true, cancelable: true });
  link.dispatchEvent(click);

  assert.deepEqual({ reached, stays: click.defaultPrevented, ids: [...panel.querySelectorAll('h2')].map((heading) => heading.id) }, { reached: ['install-on-windows'], stays: true, ids: ['install-on-windows', 'install-on-windows-1'] });
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
  press('.panel-view');
  await settled();

  assert.deepEqual(
    { quiet, running, source: panel.querySelector('.panel-body .file-code code')?.textContent },
    {
      quiet: { sandbox: 'allow-same-origin allow-popups allow-popups-to-escape-sandbox', src: `/api/folder/${folder}/page.html` },
      running: { sandbox: 'allow-scripts allow-popups allow-popups-to-escape-sandbox', src: `/api/folder/${folder}/page.html?scripts=1` },
      source: '<p>hi</p>',
    },
  );
});

// A PDF opens as its pages, drawn from the file in its folder, not refused as a file that is not text: the panel does
// not ask for its text at all
test('filePanel_Should_DrawPdfAsPages_WithoutAskingForItsText', async () => {
  /** @type {string[]} */
  const asked = [];
  globalThis.fetch = async (/** @type {string | URL | Request} */ address) => {
    asked.push(String(address));
    return new Response(JSON.stringify({ ok: false, error: 'binary' }));
  };
  const { panel, open } = filePanel();

  open('D:/dev/x/spec.pdf');
  await settled();

  assert.deepEqual({ pages: panel.querySelector('.panel-body > .doc-pdf') !== null, asked: asked.filter((address) => address.startsWith('/api/file?')) }, { pages: true, asked: [] });
});
