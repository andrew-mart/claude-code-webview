import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const { window } = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
Object.assign(globalThis, { window, document: window.document, Element: window.Element, HTMLElement: window.HTMLElement });
const { createHistoryView } = await import('../public/view/history-view.js');

/** @typedef {import('../public/model/history.js').Place} Place */

const now = Date.UTC(2026, 9, 20, 10, 0);
/** @param {number} minutes */
const ago = (minutes) => now - minutes * 60_000;
/**
 * Where a session ran in herdr: the tab "checkout" of web, in this terminal, left at this time — or running.
 * @param {string} terminal
 * @param {number | 'open'} lastSeen
 * @param {Partial<Place>} [more]
 * @returns {Place}
 */
const ranIn = (terminal, lastSeen, more = {}) => ({ workspace: 'web', tab: 'checkout', earlierTabs: [], terminal, folder: 'D:/web', firstSeen: 1, lastSeen: lastSeen === 'open' ? undefined : lastSeen, open: lastSeen === 'open', note: undefined, ...more });

/**
 * The history view over these places and titles, showing this session; what it opened and reopened is recorded. The
 * workspace "🚀 infra" has its rocket for an icon, the others none.
 * @param {{ shown: string | undefined, history: Readonly<Record<string, Place>>, titles: Readonly<Record<string, string>>, reopens?: boolean }} setup
 *   — titles: the sessions the list has, by id, each active a minute after it was left; reopens: whether herdr opens
 *   what is asked
 */
function viewOf({ shown, history, titles, reopens = true }) {
  /** @type {string[]} */
  const opened = [];
  /** @type {string[]} */
  const reopened = [];
  const view = createHistoryView({
    shown: () => shown,
    history: () => history,
    listed: (id) => (titles[id] === undefined ? undefined : { title: titles[id], activeAt: (history[id]?.lastSeen ?? now) - 60_000 }),
    open: (id) => opened.push(id),
    reopen: async (id) => {
      reopened.push(id);
      return reopens ? { ok: true, target: `#/${id}` } : { ok: false, error: 'failed' };
    },
    now: () => now,
    iconOf: (workspace) => (workspace === '🚀 infra' ? '🚀' : undefined),
  });
  window.document.body.replaceChildren(view.element);
  return { view, opened, reopened };
}
/**
 * Each row as it reads: its workspace's icon, its title — where it ran — and what marks it.
 * @param {Element} section
 * @returns {string[]}
 */
const rowsOf = (section) =>
  [...section.querySelectorAll('.history-conversation')].map((row) =>
    [row.querySelector('.workspace-icon')?.textContent, row.querySelector('.herdr-tab-title')?.textContent, '—', row.querySelector('.herdr-tab-where')?.textContent, ...[...row.classList].filter((name) => name !== 'history-conversation' && name !== 'herdr-tab')].filter((part) => part !== undefined).join(' '),
  );

// The tab of the session shown: its conversations, the one running first, then those it went on from, each drawn as the
// session list draws a session — its title, where it ran under it, its workspace's colour on its edge — the one shown
// marked; one the viewer has no transcript of is left out, and a click on one opens it
test('historyView_Should_ListConversationsOfShownSessionsTab_AndOpenOneClicked', async () => {
  const history = { first: ranIn('term_x', ago(300)), shownOne: ranIn('term_x', ago(60)), current: ranIn('term_x', 'open'), empty: ranIn('term_x', ago(30)) };
  const { view, opened } = viewOf({ shown: 'shownOne', history, titles: { first: 'Rate limits', shownOne: 'Checkout totals', current: 'Coupon codes' } });

  await view.reload();
  const tab = view.element.querySelector('.history-tab');
  if (tab === null) assert.fail('no section for the tab');
  tab.querySelector('.history-conversation:last-child')?.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));

  assert.deepEqual({ heading: tab.querySelector('.history-heading')?.textContent, rows: rowsOf(tab), opened }, {
    heading: 'This tab',
    rows: ['Coupon codes — web · checkout tinted running', 'Checkout totals — web · checkout tinted selected', 'Rate limits — web · checkout tinted'],
    opened: ['first'],
  });
});

// The tabs closed, the latest first, each with its conversations, under a head of their own: Restore — an icon in the
// row of the tab's latest conversation — opens the tab again in herdr, that conversation resumed, and shows it; herdr not
// opening it is told on the tab. A row has its workspace's icon, the workspace named without it
test('historyView_Should_ListClosedTabs_AndRestoreOneWithItsLatestConversation', async () => {
  const history = {
    current: ranIn('term_x', 'open'),
    docsDraft: ranIn('term_y', ago(200), { tab: 'docs' }),
    docs: ranIn('term_y', ago(100), { tab: 'docs' }),
    deploy: ranIn('term_z', ago(50), { workspace: '🚀 infra', tab: 'deploy' }),
  };
  const titles = { current: 'Coupon codes', docsDraft: 'API outline', docs: 'API reference', deploy: 'Blue-green' };
  const restoring = viewOf({ shown: 'current', history, titles });
  const failing = viewOf({ shown: 'current', history, titles, reopens: false });
  await restoring.view.reload();
  await failing.view.reload();
  /** @param {HTMLElement} element @param {number} at */
  const restore = (element, at) => element.querySelectorAll('.history-closed-tab')[at]?.querySelector('button')?.click();

  restore(restoring.view.element, 1);
  restore(failing.view.element, 0);
  await new Promise((done) => setTimeout(done, 0));

  assert.deepEqual(
    {
      heading: restoring.view.element.querySelector('.history-closed-heading')?.textContent,
      tabs: [...restoring.view.element.querySelectorAll('.history-closed-tab')].map((tab) => {
        const restores = tab.querySelector('.history-restore');
        return [restores?.textContent === '' && restores.querySelector('svg') !== null ? restores.getAttribute('title') : 'no icon', ...rowsOf(tab)];
      }),
      reopened: [restoring.reopened, failing.reopened],
      opened: [restoring.opened, failing.opened],
      told: failing.view.element.querySelector('.history-closed-tab .history-error')?.textContent,
    },
    {
      heading: 'Closed tabs',
      tabs: [
        ['Restore: open the tab again in herdr, its latest conversation resumed — the others along', '🚀 Blue-green — infra · deploy tinted'],
        ['Restore: open the tab again in herdr, its latest conversation resumed — the others along', 'API reference — web · docs tinted', 'API outline — web · docs tinted'],
      ],
      reopened: [['docs'], ['deploy']],
      opened: [['docs'], []],
      told: 'herdr did not open the tab.',
    },
  );
});

// A conversation of a closed tab shown: its tab is among the closed ones, the conversation marked there — there is no
// tab of it open to head the panel
test('historyView_Should_MarkShownConversation_AmongClosedTabs_When_ItsTabIsClosed', async () => {
  const history = { current: ranIn('term_x', 'open'), docsDraft: ranIn('term_y', ago(200), { tab: 'docs' }), docs: ranIn('term_y', ago(100), { tab: 'docs' }) };
  const { view } = viewOf({ shown: 'docsDraft', history, titles: { current: 'Coupon codes', docsDraft: 'API outline', docs: 'API reference' } });

  await view.reload();

  assert.deepEqual(
    [...view.element.querySelectorAll('section')].map((section) => [section.className, ...rowsOf(section)]),
    [['history-closed-tab', 'API reference — web · docs tinted', 'API outline — web · docs tinted selected']],
  );
});

// Nothing seen in herdr yet — no herdr, or no tab with a conversation the viewer can show: the panel says so
test('historyView_Should_SayNoTabHadConversation_When_HistoryHasNoneToShow', async () => {
  const { view } = viewOf({ shown: 'outside', history: { gone: ranIn('term_y', ago(10)) }, titles: { outside: 'Run outside herdr' } });

  await view.reload();

  assert.equal(view.element.textContent, 'No herdr tab has had a conversation to show yet.');
});

// Drawn anew every few seconds while sessions work: with nothing changed the panel keeps what it shows — a tab being
// restored stays so — and what changed is drawn
test('historyView_Should_KeepWhatItShows_When_NothingChanged', async () => {
  const history = { current: ranIn('term_x', 'open'), docs: ranIn('term_y', ago(100), { tab: 'docs' }) };
  /** @type {Record<string, string>} */
  const titles = { current: 'Coupon codes', docs: 'API reference' };
  const { view } = viewOf({ shown: 'current', history, titles });
  await view.reload();
  const restore = view.element.querySelector('.history-restore');

  await view.reload();
  const kept = view.element.querySelector('.history-restore') === restore;
  titles.docs = 'API reference v2';
  await view.reload();

  assert.deepEqual({ kept, redrawn: view.element.querySelector('.history-closed-tab .herdr-tab-title')?.textContent }, { kept: true, redrawn: 'API reference v2' });
});
