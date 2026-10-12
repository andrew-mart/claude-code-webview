import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

// DOMPurify binds to window on import (through markdown.js), so the DOM is set up before the panel loads.
const { window } = new JSDOM('<!doctype html><html><body><main id="layout"><aside id="panel" hidden></aside></main></body></html>', { url: 'http://localhost/' });
Object.assign(globalThis, { window, document: window.document, NodeFilter: window.NodeFilter, Text: window.Text });
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
