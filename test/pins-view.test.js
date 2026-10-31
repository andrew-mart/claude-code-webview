import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const { window } = new JSDOM('<!doctype html><html><body></body></html>');
// the icons are drawn as their module loads: the DOM is set up first
Object.assign(globalThis, { window, document: window.document });
const { createPinsView } = await import('../public/view/pins-view.js');

const spec = { path: 'D:\\dev\\shop\\docs\\spec.md', at: '2026-10-28T09:00:00.000Z' };
const design = { path: 'D:\\dev\\shop\\docs\\design.pdf', at: '2026-10-28T09:05:00.000Z' };

/**
 * The pinned files' section in a page, what it asks for recorded; a path pinned by hand comes to these outcomes in turn.
 * @param {readonly import('../public/view/pins-store.js').PinOutcome[]} outcomes
 */
function pinsShown(outcomes = []) {
  /** @type {string[][]} */
  const asked = [];
  const left = [...outcomes];
  const view = createPinsView({
    open: (path) => void asked.push(['open', path]),
    unpin: (path) => void asked.push(['unpin', path]),
    pinPath: async (scope, path) => {
      asked.push(['pin', scope, path]);
      return left.shift() ?? 'failed';
    },
    rename: (path, name) => void asked.push(['rename', path, name]),
    iconOf: (name) => Object.assign(window.document.createElement('span'), { className: 'file-icon', title: name }),
  });
  window.document.body.replaceChildren(view.element);
  /** @param {string} selector */
  const element = (selector) => {
    const found = view.element.querySelector(selector);
    assert.ok(found instanceof window.HTMLElement, `no ${selector}`);
    return found;
  };
  const settled = () => new Promise((done) => setTimeout(done, 0));
  return { view, asked, element, settled };
}

// The files pinned beside the session, first those pinned to it, then its project's, each once — named, and marked by
// where it is pinned; a click opens one, × unpins it; with none pinned the section says how one is pinned
test('pinsView_Should_ListPinnedFilesOnce_MarkedByWhereTheyArePinned_OpeningAndUnpinningThem', () => {
  const { view, asked } = pinsShown();

  view.show({ folder: [spec], session: [design, spec] });
  const rows = [...view.element.querySelectorAll('.pin-row')].map((row) => [row.querySelector('.pin-name')?.textContent, row.querySelector('.pin-scope')?.textContent]);
  view.element.querySelectorAll('.pin-open')[1]?.dispatchEvent(new window.MouseEvent('click'));
  view.element.querySelectorAll('.pin-remove')[0]?.dispatchEvent(new window.MouseEvent('click'));
  view.show({ folder: [], session: [] });

  assert.deepEqual(
    { rows, asked, none: [view.element.hidden, view.element.querySelectorAll('.pin-row').length, view.element.querySelector('.pins-empty') !== null] },
    {
      rows: [
        ['design.pdf', 'session'],
        ['spec.md', 'session · project'],
      ],
      asked: [
        ['open', spec.path],
        ['unpin', design.path],
      ],
      none: [false, 0, true],
    },
  );
});

// A file is pinned by its path too: + over the list asks for it — the spaces and quotes around a path pasted in left out
// — and where to pin it, the project or this session; with no file there it says why and asks on, pinned it asks no more
test('pinsView_Should_PinFileByItsPath_ToProjectOrSession_TellingWhyNot', async () => {
  const { view, asked, element, settled } = pinsShown(['not-found', 'pinned']);
  view.show({ folder: [], session: [] });

  element('.pins-add').click();
  const field = element('input.pins-path');
  assert.ok(field instanceof window.HTMLInputElement);
  field.value = '  "D:\\dev\\shop\\docs\\api.md"  ';
  element('.pins-to-session').click();
  await settled();
  const told = view.element.querySelector('.pins-told')?.textContent;
  field.value = 'D:\\dev\\shop\\docs\\spec.md';
  field.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await settled();

  assert.deepEqual(
    { asked, told, asking: view.element.querySelector('input.pins-path') !== null },
    {
      asked: [
        ['pin', 'session', 'D:\\dev\\shop\\docs\\api.md'],
        ['pin', 'folder', 'D:\\dev\\shop\\docs\\spec.md'],
      ],
      told: 'No file there.',
      asking: false,
    },
  );
});

// A pinned file is named in the list as one likes, the file's own name left as it is: ✎ on its row gives a field — the
// name given, else empty with the file's name in it greyed — Enter or ✓ keeps the name, Esc or ✕ leaves it
test('pinsView_Should_NamePinnedFileInList_FileNameUnchanged', () => {
  const { view, asked, element } = pinsShown();
  view.show({ folder: [spec], session: [] });

  element('.pin-rename').click();
  const field = element('input.pin-name-field');
  assert.ok(field instanceof window.HTMLInputElement);
  const offered = [field.value, field.placeholder];
  field.value = 'Leave it';
  field.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  element('.pin-rename').click();
  element('input.pin-name-field');
  const named = element('input.pin-name-field');
  assert.ok(named instanceof window.HTMLInputElement);
  named.value = 'Spec v2';
  named.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  view.show({ folder: [{ ...spec, name: 'Spec v2' }], session: [] });

  assert.deepEqual(
    { offered, asked, label: view.element.querySelector('.pin-name')?.textContent },
    { offered: ['', 'spec.md'], asked: [['rename', spec.path, 'Spec v2']], label: 'Spec v2' },
  );
});
