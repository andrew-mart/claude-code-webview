import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const { window } = new JSDOM('<!doctype html><html><body></body></html>');
Object.assign(globalThis, { window, document: window.document });
const { createDeskView } = await import('../public/view/desk-view.js');
const { parseDeskChanged, parseDeskState } = await import('../public/model/desks.js');

/** @typedef {import('../public/model/desks.js').DeskState} DeskState */

const orders = { path: 'D:\\dev\\acme\\billing-fix\\.desks\\orders.json', name: 'orders', folder: 'D:\\dev\\acme\\billing-fix' };
const next = { path: 'D:\\dev\\acme\\.desks\\Next task.json', name: 'Next task', folder: 'D:\\dev\\acme' };

/**
 * The desk's control over the notes, its changes answered in turn by these replies, what it asked recorded; the folders
 * on the disk are D:\\dev\\acme\\ with billing-fix in it.
 * @param {readonly import('../public/model/desks.js').DeskChanged[]} replies
 */
function deskShown(replies) {
  /** @type {unknown[]} */
  const asked = [];
  const left = [...replies];
  const view = createDeskView({
    change: async (what) => {
      asked.push(what);
      return left.shift() ?? { ok: false, error: 'failed' };
    },
    foldersOnDisk: async (typed) => (typed === 'D:\\dev\\acme\\' ? [{ path: 'D:\\dev\\acme\\billing-fix\\', name: 'billing-fix', kind: 'folder' }] : []),
  });
  window.document.body.replaceChildren(view.label, view.panel);
  const settled = () => new Promise((done) => setTimeout(done, 0));
  /** @param {string} selector */
  const element = (selector) => {
    const found = window.document.body.querySelector(selector);
    assert.ok(found instanceof window.HTMLElement, `no ${selector}`);
    return found;
  };
  /** @param {string} selector @param {string} value */
  const type = (selector, value) => {
    const field = element(selector);
    assert.ok(field instanceof window.HTMLInputElement);
    field.value = value;
    field.dispatchEvent(new window.Event('input', { bubbles: true }));
    field.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  };
  const rows = () => [...view.panel.querySelectorAll('.desk-row')].map((row) => `${row.querySelector('.desk-row-name')?.textContent}${row.getAttribute('aria-current') === 'true' ? ' ✓' : ''}`);
  return { view, asked, settled, element, type, rows };
}

// The session's desk is named over its notes — none yet: the first note or file pinned makes one; pressed, its name
// lists the desks around, the session's marked, and one picked is taken up — the name the new desk's, the list put away
test('deskView_Should_NameSessionsDesk_AndTakeUpDeskPickedAmongThoseAround', async () => {
  const { view, asked, settled, element, rows } = deskShown([{ ok: true, desk: { current: next, offered: [next, orders] } }]);
  view.show({ current: undefined, offered: [] });
  const none = { name: view.label.textContent, title: view.label.title };
  view.show({ current: orders, offered: [orders, next] });

  view.label.click();
  const listed = { open: !view.panel.hidden, rows: rows() };
  [...view.panel.querySelectorAll('.desk-row')][1]?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await settled();

  assert.deepEqual(
    { none, listed, asked, after: { name: view.label.textContent, open: !view.panel.hidden } },
    {
      none: { name: 'No desk yet', title: "The first note or file pinned makes this session's desk, in the folder it started in" },
      listed: { open: true, rows: ['orders ✓', 'Next task'] },
      asked: [{ action: 'choose', path: next.path }],
      after: { name: 'Next task', open: false },
    },
  );
  assert.equal(element('.desk-label').getAttribute('aria-expanded'), 'false');
});

// A desk is made anew by its name; the session's desk is moved to a folder typed — the folders on the disk offered as
// it is typed, one picked going into the field — and a folder refused says why, the field left as it was
test('deskView_Should_MakeDeskByName_AndMoveDeskToFolderTyped_TellingWhyNot', async () => {
  const { view, asked, settled, element, type } = deskShown([
    { ok: true, desk: { current: next, offered: [next, orders] } },
    { ok: false, error: 'exists' },
  ]);
  view.show({ current: orders, offered: [orders] });
  view.label.click();

  type('.desk-new-name', 'Next task');
  await settled();
  view.label.click();
  const folder = element('.desk-move-folder');
  assert.ok(folder instanceof window.HTMLInputElement);
  folder.value = 'D:\\dev\\acme\\';
  folder.dispatchEvent(new window.Event('input', { bubbles: true }));
  await settled();
  const offered = [...view.panel.querySelectorAll('.desk-offer')].map((one) => one.textContent);
  view.panel.querySelector('.desk-offer')?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  const picked = folder.value;
  type('.desk-move-folder', picked);
  await settled();

  assert.deepEqual(
    { asked, offered, picked, told: element('.desk-told').textContent, kept: folder.value },
    {
      asked: [
        { action: 'create', name: 'Next task' },
        { action: 'move', folder: 'D:\\dev\\acme\\billing-fix\\' },
      ],
      offered: ['billing-fix'],
      picked: 'D:\\dev\\acme\\billing-fix\\',
      told: 'That folder has a desk of this name already.',
      kept: 'D:\\dev\\acme\\billing-fix\\',
    },
  );
});

// The viewer's replies read: a desk of another shape left out; a refusal it does not know is its not answering
test('parseDesk_Should_ReadViewersReplies_LeavingOutWhatItCannotRead', () => {
  assert.deepEqual(
    {
      state: parseDeskState({ current: null, offered: [orders, { name: 'no path' }] }),
      refused: parseDeskChanged(false, { ok: false, error: 'exists' }),
      odd: parseDeskChanged(false, { error: 'on fire' }),
    },
    { state: { current: undefined, offered: [orders] }, refused: { ok: false, error: 'exists' }, odd: { ok: false, error: 'failed' } },
  );
});
