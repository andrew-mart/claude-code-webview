import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const { window } = new JSDOM('<!doctype html><html><body></body></html>');
// the icons are drawn as their module loads: the DOM is set up first
Object.assign(globalThis, { window, document: window.document });
const { createPinsView } = await import('../public/view/pins-view.js');

const spec = { path: 'D:\\dev\\shop\\docs\\spec.md', at: '2026-10-28T09:00:00.000Z' };
const design = { path: 'D:\\dev\\shop\\docs\\design.pdf', at: '2026-10-28T09:05:00.000Z' };

// The files pinned beside the session, first those pinned to it, then its project's, each once — named, and marked by
// where it is pinned; a click opens one, × unpins it; with none pinned there is no section
test('pinsView_Should_ListPinnedFilesOnce_MarkedByWhereTheyArePinned_OpeningAndUnpinningThem', () => {
  /** @type {string[][]} */
  const asked = [];
  const view = createPinsView({
    open: (path) => void asked.push(['open', path]),
    unpin: (path) => void asked.push(['unpin', path]),
    iconOf: (name) => Object.assign(window.document.createElement('span'), { className: 'file-icon', title: name }),
  });
  window.document.body.replaceChildren(view.element);

  view.show({ folder: [spec], session: [design, spec] });
  const rows = [...view.element.querySelectorAll('.pin-row')].map((row) => [row.querySelector('.pin-name')?.textContent, row.querySelector('.pin-scope')?.textContent]);
  view.element.querySelectorAll('.pin-open')[1]?.dispatchEvent(new window.MouseEvent('click'));
  view.element.querySelectorAll('.pin-remove')[0]?.dispatchEvent(new window.MouseEvent('click'));
  const shown = !view.element.hidden;
  view.show({ folder: [], session: [] });

  assert.deepEqual(
    { rows, asked, shown, hiddenWhenNone: view.element.hidden },
    {
      rows: [
        ['design.pdf', 'session'],
        ['spec.md', 'session · project'],
      ],
      asked: [
        ['open', spec.path],
        ['unpin', design.path],
      ],
      shown: true,
      hiddenWhenNone: true,
    },
  );
});
