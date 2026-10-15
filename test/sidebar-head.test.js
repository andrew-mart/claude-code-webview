import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const { window } = new JSDOM('<!doctype html><html><body></body></html>');
// The icons are drawn when their module loads: the DOM is set up before it.
Object.assign(globalThis, { window, document: window.document });
const { createSidebarHead } = await import('../public/view/sidebar-head.js');

/**
 * The sidebar's head as the page has it — its row, the search's row under it, the sessions list's options, herdr's ＋ —
 * with the searches and the lists asked for recorded.
 */
function sidebarHead() {
  const { document } = window;
  const row = document.createElement('div');
  const searchRow = document.createElement('div');
  const search = document.createElement('input');
  searchRow.append(search);
  const options = document.createElement('div');
  options.append(document.createElement('input'));
  const newWorkspace = document.createElement('button');
  document.body.replaceChildren(row, searchRow, options);
  /** @type {string[]} */
  const told = [];
  search.addEventListener('input', () => told.push(`search: ${search.value}`));
  const head = createSidebarHead({ row, searchRow, search, options, newWorkspace, onMode: (mode) => told.push(`list: ${mode}`) });
  /** @param {string} selector */
  const press = (selector) => {
    const button = row.querySelector(selector) ?? searchRow.querySelector(selector);
    assert.ok(button instanceof window.HTMLElement, `no ${selector}`);
    button.click();
  };
  return { head, row, searchRow, search, options, newWorkspace, told, press };
}

// Searching is seldom: the search is out of the way until 🔍 opens it in place of the head's row, its box focused; ✕ —
// or Escape, which goes no further, not to the page's Escape that stops Claude — closes it, the search cleared
test('sidebarHead_Should_OpenSearchInPlaceOfItsRow_And_CloseItCleared', () => {
  const page = sidebarHead();
  let escapesPast = 0;
  window.document.addEventListener('keydown', (event) => (escapesPast += event.key === 'Escape' ? 1 : 0));
  page.head.show({ mode: 'herdr', herdr: true });
  const shown = () => ({ row: !page.row.hidden, search: !page.searchRow.hidden });
  const before = shown();

  page.press('.sidebar-find');
  const opened = { ...shown(), focused: window.document.activeElement === page.search };
  page.search.value = 'shop';
  page.press('.search-close');
  const closed = shown();
  page.press('.sidebar-find');
  page.search.value = 'web';
  page.search.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

  assert.deepEqual(
    { before, opened, closed, escaped: shown(), value: page.search.value, told: page.told, escapesPast },
    { before: { row: true, search: false }, opened: { row: false, search: true, focused: true }, closed: { row: true, search: false }, escaped: { row: true, search: false }, value: '', told: ['search: ', 'search: '], escapesPast: 0 },
  );
});

// ⇄ goes to the other list — herdr's or every session's — named for where it goes; without herdr there is no other
test('sidebarHead_Should_SwitchToTheOtherList_NamedForWhereItGoes', () => {
  const page = sidebarHead();
  const switching = () => page.row.querySelector('.sidebar-switch');

  page.head.show({ mode: 'herdr', herdr: true });
  const fromHerdr = switching()?.getAttribute('aria-label');
  page.press('.sidebar-switch');
  page.head.show({ mode: 'sessions', herdr: true });
  const fromSessions = switching()?.getAttribute('aria-label');
  page.press('.sidebar-switch');
  page.head.show({ mode: 'sessions', herdr: false });

  assert.deepEqual(
    { fromHerdr, fromSessions, told: page.told, withoutHerdr: switching()?.hasAttribute('hidden') },
    { fromHerdr: 'Sessions', fromSessions: 'herdr', told: ['list: sessions', 'list: herdr'], withoutHerdr: true },
  );
});

// Each list's own button ends the row: the sessions list's ⚙ opens its options over it — a press in them, a box
// ticked, keeps them; a press elsewhere or Escape puts them away — herdr's ＋ opens a new workspace
test('sidebarHead_Should_OpenSessionsOptionsOverTheList_AndGiveHerdrItsNewWorkspace', () => {
  const page = sidebarHead();
  const options = () => page.row.querySelector('.sidebar-options');
  page.head.show({ mode: 'herdr', herdr: true });
  const inHerdr = { options: options()?.hasAttribute('hidden'), newWorkspace: page.newWorkspace.hidden };
  page.head.show({ mode: 'sessions', herdr: true });
  const inSessions = { options: options()?.hasAttribute('hidden'), newWorkspace: page.newWorkspace.hidden, open: !page.options.hidden };

  page.press('.sidebar-options');
  const opened = !page.options.hidden;
  page.options.querySelector('input')?.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true }));
  const keptByPressInside = !page.options.hidden;
  window.document.body.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true }));
  const awayOnPressElsewhere = page.options.hidden;
  page.press('.sidebar-options');
  page.options.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

  assert.deepEqual(
    { inHerdr, inSessions, opened, keptByPressInside, awayOnPressElsewhere, awayOnEscape: page.options.hidden },
    { inHerdr: { options: true, newWorkspace: false }, inSessions: { options: false, newWorkspace: true, open: false }, opened: true, keptByPressInside: true, awayOnPressElsewhere: true, awayOnEscape: true },
  );
});
