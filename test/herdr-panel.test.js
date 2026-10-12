import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const { window } = new JSDOM('<!doctype html><html><body></body></html>');
// The icons are drawn when their module loads: the DOM is set up before it.
Object.assign(globalThis, { window, document: window.document });
const { createHerdrSidebar, createTabBar } = await import('../public/view/herdr-panel.js');
// jsdom lays nothing out, so it has no scrolling; the tab bar scrolls the open tab into view
window.HTMLElement.prototype.scrollIntoView = () => undefined;

/**
 * @param {Partial<import('../public/model/herdr.js').HerdrPane> & { id: string }} pane
 * @returns {import('../public/model/herdr.js').HerdrPane}
 */
const paneOf = (pane) => ({ agent: 'claude', status: 'idle', title: undefined, session: undefined, size: undefined, activity: undefined, ...pane });

/** The workspace web: a tab left unnamed (herdr names it by its number), a named one with Codex, one with no title yet. */
const web = {
  id: 'w2',
  number: 2,
  label: 'web',
  status: /** @type {const} */ ('idle'),
  activeTab: 'w2:t1',
  tabs: [
    { id: 'w2:t1', number: 1, label: '1', status: /** @type {const} */ ('idle'), panes: [paneOf({ id: 'w2:p1', title: 'Fix the flaky checkout test', session: 's1', activity: 5 })] },
    { id: 'w2:t2', number: 2, label: 'node-24', status: /** @type {const} */ ('working'), panes: [paneOf({ id: 'w2:p2', agent: 'codex', title: 'Upgrade to Node 24', activity: 9 })] },
    { id: 'w2:t3', number: 3, label: 'notes', status: /** @type {const} */ ('idle'), panes: [paneOf({ id: 'w2:p3', session: 's3', activity: 1 })] },
  ],
};

// Many tabs are never named, so a session is told by its title: it is the row's first line, where it runs comes under it
test('herdrSidebar_Should_LeadSessionRowWithItsTitle_And_TellWorkspaceAndTabUnderIt', () => {
  const element = window.document.createElement('div');

  createHerdrSidebar(element).render({ herdr: true, workspaces: [web] }, undefined, '');

  assert.deepEqual(
    [...element.querySelectorAll('.herdr-tabs .herdr-tab-text')].map((text) => [...text.children].map((line) => line.textContent)),
    [
      ['Upgrade to Node 24', 'web · 2 node-24 · codex'],
      ['Fix the flaky checkout test', 'web · 1'],
      ['3 notes', 'web'],
    ],
  );
});

// Above the open session the tabs of its workspace: a tab nobody named says its number once, not "1 1"
test('tabBar_Should_NameUnnamedTabByItsNumberOnce', () => {
  const { bar } = barAboveSession();

  bar.render({ herdr: true, workspaces: [web] }, { kind: 'session', id: 's1' });

  assert.deepEqual(
    [...bar.element.querySelectorAll('.herdr-chip')].map((chip) => chip.textContent),
    ['1', '2 node-24', '3 notes'],
  );
});

/**
 * The tab bar above a session of web — s1, the unnamed tab 1, unless told — with naming, closing, opening tabs and the
 * addresses it goes to recorded; each succeeds, a new tab opens as w2:p9.
 * @param {string} [session]
 */
function barAboveSession(session = 's1') {
  /** @type {string[][]} */
  const asked = [];
  const bar = createTabBar({
    open: (target) => {
      asked.push(['open', target]);
    },
    create: async (beside, start) => {
      asked.push(['create', beside, start]);
      return { ok: true, target: '#/pane/w2:p9' };
    },
    rename: async (tab, label) => {
      asked.push(['rename', tab, label]);
      return { ok: true };
    },
    close: async (tab) => {
      asked.push(['close', tab]);
      return { ok: true };
    },
  });
  bar.render({ herdr: true, workspaces: [web] }, { kind: 'session', id: session });
  /** @param {string} selector */
  const click = (selector) => {
    const button = bar.element.querySelector(selector);
    assert.ok(button instanceof window.HTMLElement, `no ${selector}`);
    button.click();
  };
  return { bar, asked, click };
}

/** Lets the bar's awaited calls finish. */
const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

// The open tab is named where it is shown: ✎ turns it into a box — empty for a tab nobody named — Enter names it, Esc
// leaves it as it was
test('tabBar_Should_NameOpenTab_WithEnter_And_LeaveItWithEscape', async () => {
  const { bar, asked, click } = barAboveSession();

  click('.herdr-chip.selected');
  click('.herdr-tab-rename');
  const box = bar.element.querySelector('input.herdr-tab-name');
  assert.ok(box instanceof window.HTMLInputElement);
  const empty = box.value;
  box.value = 'checkout';
  box.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter' }));
  await settled();
  click('.herdr-chip.selected');
  click('.herdr-tab-rename');
  bar.element.querySelector('input.herdr-tab-name')?.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
  await settled();

  assert.deepEqual({ empty, asked, boxes: bar.element.querySelectorAll('input.herdr-tab-name').length }, { empty: '', asked: [['rename', 'w2:t1', 'checkout']], boxes: 0 });
});

// Closing a tab stops what runs in it: × asks first, and only "Close" closes
test('tabBar_Should_CloseOpenTab_OnlyAfterItIsConfirmed', async () => {
  const { asked, click } = barAboveSession();

  click('.herdr-chip.selected');
  click('.herdr-tab-close');
  click('.herdr-tab-confirm-cancel');
  const closes = () => asked.filter(([kind]) => kind === 'close');
  const afterCancel = closes();
  click('.herdr-chip.selected');
  click('.herdr-tab-close');
  click('.herdr-tab-confirm-close');
  await settled();

  assert.deepEqual({ afterCancel, closes: closes() }, { afterCancel: [], closes: [['close', 'w2:t1']] });
});

// herdr is looked at every few seconds: a name half typed stays in its box when the tabs come again, changed
test('tabBar_Should_KeepNameBeingTyped_When_TabsComeAgain', async () => {
  const { bar, asked, click } = barAboveSession();
  click('.herdr-chip.selected');
  click('.herdr-tab-rename');
  const box = bar.element.querySelector('input.herdr-tab-name');
  assert.ok(box instanceof window.HTMLInputElement);
  box.value = 'check';

  bar.render({ herdr: true, workspaces: [{ ...web, status: 'working' }] }, { kind: 'session', id: 's1' });
  const stillShown = bar.element.contains(box);
  box.value += 'out';
  box.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter' }));
  await settled();

  assert.deepEqual({ stillShown, asked }, { stillShown: true, asked: [['rename', 'w2:t1', 'checkout']] });
});

// A closed tab leaves the page in its workspace: on the tab after it, or before it when it was the last
test('tabBar_Should_OpenNeighbourTab_When_OpenTabIsClosed', async () => {
  const first = barAboveSession('s1');
  const last = barAboveSession('s3');

  for (const { click } of [first, last]) {
    click('.herdr-chip.selected');
  click('.herdr-tab-close');
    click('.herdr-tab-confirm-close');
  }
  await settled();

  assert.deepEqual([first.asked, last.asked], [
    [['close', 'w2:t1'], ['open', '#/pane/w2:p2']],
    [['close', 'w2:t3'], ['open', '#/pane/w2:p2']],
  ]);
});

// The open tab's buttons stay out of the way: a second click on the open tab shows them, the next one hides them
test('tabBar_Should_ShowOpenTabsButtons_OnlyWhenItIsClickedAgain', () => {
  const { bar, click } = barAboveSession();
  const shown = () => [...bar.element.querySelectorAll('.herdr-tab-actions')].some((actions) => actions instanceof window.HTMLElement && !actions.hidden);

  const before = shown();
  click('.herdr-chip.selected');
  const afterSecondClick = shown();
  click('.herdr-chip.selected');

  assert.deepEqual([before, afterSecondClick, shown()], [false, true, false]);
});

// "+" opens a tab beside the open one — a terminal, or Claude Code — and the page goes to it; Cancel opens nothing
test('tabBar_Should_OpenNewTabWithTerminalOrClaude_And_GoToIt', async () => {
  const { asked, click } = barAboveSession();

  click('.herdr-tab-new');
  click('.herdr-tab-new-cancel');
  click('.herdr-tab-new');
  click('.herdr-tab-new-claude');
  await settled();

  assert.deepEqual(asked, [['create', 'w2:t1', 'claude'], ['open', '#/pane/w2:p9']]);
});

// A workspace's rows take its colour — its own row and the rows of the sessions running in it — set apart from another
// workspace's
test('herdrSidebar_Should_TintWorkspaceAndItsSessions_WithWorkspaceColour', () => {
  const element = window.document.createElement('div');
  const api = { ...web, id: 'w3', number: 3, label: 'api', activeTab: 'w3:t1', tabs: [{ id: 'w3:t1', number: 1, label: '1', status: /** @type {const} */ ('idle'), panes: [paneOf({ id: 'w3:p1', title: 'Add the endpoint', session: 's9', activity: 3 })] }] };

  createHerdrSidebar(element).render({ herdr: true, workspaces: [web, api] }, undefined, '');

  /** @param {Element} row */
  const hueOf = (row) => (row instanceof window.HTMLElement ? row.style.getPropertyValue('--workspace-hue') : '');
  const workspaces = new Map([...element.querySelectorAll('.herdr-workspace')].map((row) => [row.querySelector('.herdr-name')?.textContent, hueOf(row)]));
  const sessions = [...element.querySelectorAll('.herdr-tab')].map((row) => hueOf(row) === workspaces.get(row.querySelector('.herdr-tab-where')?.textContent?.split(' · ')[0]));
  assert.deepEqual({ apart: workspaces.get('web') !== workspaces.get('api') && workspaces.get('web') !== '', sessions }, { apart: true, sessions: [true, true, true, true] });
});
