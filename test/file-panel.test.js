import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

// DOMPurify binds to window on import (through markdown.js), so the DOM is set up before the panel loads.
const { window } = new JSDOM('<!doctype html><html><body><main id="layout"><aside id="panel" hidden></aside></main></body></html>', { url: 'http://localhost/' });
Object.assign(globalThis, { window, document: window.document, NodeFilter: window.NodeFilter, Text: window.Text });
const { createFilePanel } = await import('../public/view/file-panel.js');

/** The panel as app.js creates it. */
function filePanel() {
  const panel = window.document.getElementById('panel');
  const layout = window.document.getElementById('layout');
  assert.ok(panel && layout);
  const files = createFilePanel({ panel, layout });
  /** Opens the file a link in the feed points at. @param {string} path */
  const open = (path) => files.open({ path, line: undefined, endLine: undefined });
  /** The path of the picture the panel shows. */
  const shownPicture = () => {
    const image = panel.querySelector('.panel-body img');
    return image instanceof window.HTMLImageElement ? new URL(image.src).searchParams.get('path') : undefined;
  };
  return { panel, open, shownPicture };
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
