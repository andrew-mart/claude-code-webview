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

/** A sidebar nobody opens a workspace from. @type {import('../public/view/herdr-panel.js').SidebarActions} */
const noActions = { createWorkspace: async () => ({ ok: false, error: 'failed' }), open: () => undefined, folders: () => [], renameWorkspace: async () => ({ ok: false, error: 'failed' }), closeWorkspace: async () => ({ ok: false, error: 'failed' }), renameTab: async () => ({ ok: false, error: 'failed' }), closeTab: async () => ({ ok: false, error: 'failed' }) };

// Many tabs are never named, so a session is told by its title: it is the row's first line, where it runs comes under it
test('herdrSidebar_Should_LeadSessionRowWithItsTitle_And_TellWorkspaceAndTabUnderIt', () => {
  const element = window.document.createElement('div');

  createHerdrSidebar(element, noActions).render({ herdr: true, workspaces: [web] }, undefined, '', new Map());

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

  bar.render({ herdr: true, workspaces: [web] }, { kind: 'session', id: 's1' }, new Map());

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
  /** @type {(string | undefined)[][]} */
  const asked = [];
  const bar = createTabBar({
    open: (target) => {
      asked.push(['open', target]);
    },
    create: async (beside, start, label) => {
      asked.push(['create', beside, start, label]);
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
  bar.render({ herdr: true, workspaces: [web] }, { kind: 'session', id: session }, new Map());
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

  bar.render({ herdr: true, workspaces: [{ ...web, status: 'working' }] }, { kind: 'session', id: 's1' }, new Map());
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

// "+" opens a tab beside the open one, under the name typed for it — a terminal, or Claude Code — and the page goes to
// it; with no name herdr numbers it; Cancel opens nothing
test('tabBar_Should_OpenNewNamedTabWithTerminalClaudeOrCodex_And_GoToIt', async () => {
  const { bar, asked, click } = barAboveSession();
  /** @param {string} value */
  const name = (value) => {
    const box = bar.element.querySelector('input.herdr-tab-new-name');
    assert.ok(box instanceof window.HTMLInputElement);
    box.value = value;
  };

  click('.herdr-tab-new');
  click('.herdr-tab-new-cancel');
  click('.herdr-tab-new');
  name('  slow  tests ');
  click('.herdr-tab-new-claude');
  await settled();
  click('.herdr-tab-new');
  name('');
  click('.herdr-tab-new-shell');
  await settled();
  click('.herdr-tab-new');
  name('review');
  click('.herdr-tab-new-codex');
  await settled();

  assert.deepEqual(asked, [['create', 'w2:t1', 'claude', 'slow tests'], ['open', '#/pane/w2:p9'], ['create', 'w2:t1', 'shell', undefined], ['open', '#/pane/w2:p9'], ['create', 'w2:t1', 'codex', 'review'], ['open', '#/pane/w2:p9']]);
});

// A workspace's rows take its colour — its own row and the rows of the sessions running in it — set apart from another
// workspace's
test('herdrSidebar_Should_TintWorkspaceAndItsSessions_WithWorkspaceColour', () => {
  const element = window.document.createElement('div');
  const api = { ...web, id: 'w3', number: 3, label: 'api', activeTab: 'w3:t1', tabs: [{ id: 'w3:t1', number: 1, label: '1', status: /** @type {const} */ ('idle'), panes: [paneOf({ id: 'w3:p1', title: 'Add the endpoint', session: 's9', activity: 3 })] }] };

  createHerdrSidebar(element, noActions).render({ herdr: true, workspaces: [web, api] }, undefined, '', new Map());

  /** @param {Element} row */
  const hueOf = (row) => (row instanceof window.HTMLElement ? row.style.getPropertyValue('--workspace-hue') : '');
  const workspaces = new Map([...element.querySelectorAll('.herdr-workspace')].map((row) => [row.querySelector('.herdr-name')?.textContent, hueOf(row)]));
  const sessions = [...element.querySelectorAll('.herdr-tab')].map((row) => hueOf(row) === workspaces.get(row.querySelector('.herdr-tab-where')?.textContent?.split(' · ')[0]));
  assert.deepEqual({ apart: workspaces.get('web') !== workspaces.get('api') && workspaces.get('web') !== '', sessions }, { apart: true, sessions: [true, true, true, true] });
});

// "+" beside the search is an icon, not a row of its own: it opens the form at the top of the panel, right under the
// search, above the workspaces; a second press puts the form away
test('herdrSidebar_Should_OpenNewWorkspaceForm_AboveWorkspaces_FromIconBesideSearch', () => {
  const element = window.document.createElement('div');
  const sidebar = createHerdrSidebar(element, noActions);
  sidebar.render({ herdr: true, workspaces: [web] }, undefined, '', new Map());
  const form = () => element.querySelector('.herdr-new-workspace');
  const before = { panel: element.textContent?.includes('New workspace'), expanded: sidebar.newButton.getAttribute('aria-expanded') };

  sidebar.newButton.click();
  const open = { first: element.querySelector(':scope > :not([hidden])') === form()?.parentElement, expanded: sidebar.newButton.getAttribute('aria-expanded') };
  sidebar.newButton.click();

  assert.deepEqual(
    { words: sidebar.newButton.textContent, label: sidebar.newButton.getAttribute('aria-label'), before, open, closed: { form: form(), expanded: sidebar.newButton.getAttribute('aria-expanded') } },
    { words: '', label: 'New workspace', before: { panel: false, expanded: 'false' }, open: { first: true, expanded: 'true' }, closed: { form: null, expanded: 'false' } },
  );
});

// Cancel in the form is an icon named on hover, as in the new tab's choices: the three fit on one line in a narrow
// sidebar; it puts the form away
test('herdrSidebar_Should_CancelNewWorkspace_WithIconNamedOnHover', () => {
  const element = window.document.createElement('div');
  const sidebar = createHerdrSidebar(element, noActions);
  sidebar.render({ herdr: true, workspaces: [web] }, undefined, '', new Map());
  sidebar.newButton.click();
  const cancel = element.querySelector('.herdr-new-cancel');
  assert.ok(cancel instanceof window.HTMLButtonElement);
  const looks = { text: cancel.textContent, icon: cancel.querySelector('svg') !== null, title: cancel.getAttribute('title') };

  cancel.click();

  assert.deepEqual(
    { looks, form: element.querySelector('.herdr-new-workspace') },
    { looks: { text: '', icon: true, title: 'Cancel (Esc)' }, form: null },
  );
});

// "+" opens a workspace: its name, its folder, a terminal or Claude Code in it — and the page goes there.
// A folder that is not there is said so and the form stays to be put right; a fresh look at herdr leaves it as it is
test('herdrSidebar_Should_OpenNewWorkspace_FromItsNameAndFolder', async () => {
  const element = window.document.createElement('div');
  /** @type {string[][]} */
  const asked = [];
  /** @type {string[]} */
  const opened = [];
  const sidebar = createHerdrSidebar(element, {
    createWorkspace: async (label, folder, start) => {
      asked.push([label, folder, start]);
      return folder === 'D:/nowhere' ? { ok: false, error: 'no-folder' } : { ok: true, target: '#/pane/w5:p1' };
    },
    open: (target) => opened.push(target),
    folders: () => [],
    renameWorkspace: async () => ({ ok: false, error: 'failed' }),
    closeWorkspace: async () => ({ ok: false, error: 'failed' }),
    renameTab: async () => ({ ok: false, error: 'failed' }),
    closeTab: async () => ({ ok: false, error: 'failed' }),
  });
  const layout = { herdr: true, workspaces: [web] };
  sidebar.render(layout, undefined, '', new Map());
  /** @param {string} selector */
  const find = (selector) => {
    const found = element.querySelector(selector);
    assert.ok(found instanceof window.HTMLElement, selector);
    return found;
  };
  /** @param {string} selector @param {string} value */
  const fill = (selector, value) => {
    const box = find(selector);
    assert.ok(box instanceof window.HTMLInputElement);
    box.value = value;
  };
  const settle = () => new Promise((done) => setTimeout(done, 0));

  sidebar.newButton.click();
  fill('.herdr-new-name', 'billing');
  fill('.herdr-new-folder', 'D:/nowhere');
  find('.herdr-new-claude').click();
  await settle();
  const refused = find('.herdr-new-error').textContent;
  sidebar.render({ herdr: true, workspaces: [{ ...web, status: 'working' }] }, undefined, '', new Map());
  const kept = find('.herdr-new-name');
  fill('.herdr-new-folder', 'D:/dev/billing');
  find('.herdr-new-shell').click();
  await settle();
  const formGone = element.querySelector('.herdr-new-workspace') === null;
  sidebar.newButton.click();
  fill('.herdr-new-name', 'review');
  fill('.herdr-new-folder', 'D:/dev/review');
  find('.herdr-new-codex').click();
  await settle();

  assert.deepEqual(
    { asked, refused, kept: kept instanceof window.HTMLInputElement ? kept.value : undefined, opened, formGone },
    { asked: [['billing', 'D:/nowhere', 'claude'], ['billing', 'D:/dev/billing', 'shell'], ['review', 'D:/dev/review', 'codex']], refused: 'There is no such folder.', kept: 'billing', opened: ['#/pane/w5:p1', '#/pane/w5:p1'], formGone: true },
  );
});

// Tabs that do not fit scroll sideways under the mouse wheel; tabs that fit leave the wheel to the page
test('tabBar_Should_ScrollTabsSideways_WithMouseWheel_WhenTheyDoNotFit', () => {
  /** @param {number} scrollWidth */
  const wheelOver = (scrollWidth) => {
    const { bar } = barAboveSession();
    Object.defineProperty(bar.element, 'scrollWidth', { value: scrollWidth });
    Object.defineProperty(bar.element, 'clientWidth', { value: 300 });
    const wheel = new window.WheelEvent('wheel', { deltaY: 120, cancelable: true });
    bar.element.dispatchEvent(wheel);
    return { scrolled: bar.element.scrollLeft, pageKeepsWheel: !wheel.defaultPrevented };
  };

  assert.deepEqual([wheelOver(800), wheelOver(300)], [
    { scrolled: 120, pageKeepsWheel: false },
    { scrolled: 0, pageKeepsWheel: true },
  ]);
});

// What a new tab starts with is chosen with icons — a terminal, Claude Code, cancel — each named on hover
test('tabBar_Should_OfferNewTabChoices_AsIconsNamedOnHover', () => {
  const { bar, click } = barAboveSession();

  click('.herdr-tab-new');

  assert.deepEqual(
    ['.herdr-tab-new-shell', '.herdr-tab-new-claude', '.herdr-tab-new-cancel'].map((selector) => {
      const button = bar.element.querySelector(selector);
      return { text: button?.textContent, icon: button?.querySelector('svg') !== null, title: button?.getAttribute('title') };
    }),
    [
      { text: '', icon: true, title: 'Terminal' },
      { text: '', icon: true, title: 'Claude Code (Enter)' },
      { text: '', icon: true, title: 'Cancel (Esc)' },
    ],
  );
});

// A tab gets an emoji icon ahead of its name — picked as it is named or opened — kept in its herdr label, so herdr
// shows it too
test('tabBar_Should_PutPickedIconAheadOfTabName_WhenNamingOrOpeningIt', async () => {
  const { bar, asked, click } = barAboveSession();
  /** @param {string} value */
  const type = (value) => {
    const box = bar.element.querySelector('input.herdr-tab-name');
    assert.ok(box instanceof window.HTMLInputElement);
    box.value = value;
    return box;
  };
  /** @param {string} icon */
  const pick = (icon) => {
    click('.herdr-tab-icon');
    const choice = [...bar.element.querySelectorAll('.herdr-icon-palette button')].find((button) => button.textContent === icon);
    assert.ok(choice instanceof window.HTMLElement, `no ${icon} to pick`);
    choice.click();
  };

  click('.herdr-chip.selected');
  click('.herdr-tab-rename');
  pick('🐞');
  type('checkout bug').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter' }));
  await settled();
  click('.herdr-tab-new');
  pick('🧪');
  type('tests');
  click('.herdr-tab-new-shell');
  await settled();

  assert.deepEqual(asked.filter(([what]) => what !== 'open'), [
    ['rename', 'w2:t1', '🐞 checkout bug'],
    ['create', 'w2:t1', 'shell', '🧪 tests'],
  ]);
});

/**
 * A sidebar whose changes to workspaces and tabs are recorded and done.
 * @returns {{ element: HTMLElement, sidebar: ReturnType<typeof createHerdrSidebar>, changes: string[][] }}
 */
function changingSidebar() {
  const element = window.document.createElement('div');
  /** @type {string[][]} */
  const changes = [];
  const done = (/** @type {string[]} */ change) => {
    changes.push(change);
    return Promise.resolve(/** @type {const} */ ({ ok: true }));
  };
  const sidebar = createHerdrSidebar(element, {
    ...noActions,
    renameWorkspace: (workspace, label) => done(['rename workspace', workspace, label]),
    closeWorkspace: (workspace) => done(['close workspace', workspace]),
    renameTab: (tab, label) => done(['rename tab', tab, label]),
    closeTab: (tab) => done(['close tab', tab]),
  });
  sidebar.render({ herdr: true, workspaces: [web] }, undefined, '', new Map());
  return { element, sidebar, changes };
}

/**
 * @param {HTMLElement} element
 * @param {string} selector
 */
function pressIn(element, selector) {
  const button = element.querySelector(selector);
  assert.ok(button instanceof window.HTMLElement, selector);
  button.click();
}

/**
 * Names what is in the box and presses Enter.
 * @param {HTMLElement} element
 * @param {string} name
 */
function nameIn(element, name) {
  const box = element.querySelector('input.herdr-row-name');
  assert.ok(box instanceof window.HTMLInputElement);
  const before = box.value;
  box.value = name;
  box.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  return before;
}

/** A click on a row, as a finger or a mouse makes it; whether the page stayed where it was. */
const clickOn = (/** @type {HTMLElement} */ element, /** @type {string} */ selector) => {
  const click = new window.MouseEvent('click', { bubbles: true, cancelable: true });
  element.querySelector(selector)?.dispatchEvent(click);
  return click.defaultPrevented;
};

// A click on the open workspace or the open session — a second click, the first opened it — shows its buttons, as an
// open tab has them: one names it — the box holding its name; an unnamed tab's is empty — the other closes it once the
// closing is confirmed; for a session that is its tab. A click on a row not open opens it, no buttons
test('herdrSidebar_Should_NameAndCloseOpenWorkspaceAndSession_FromButtonsShownOnSecondClick', async () => {
  const { element, sidebar, changes } = changingSidebar();
  const settle = () => new Promise((done) => setTimeout(done, 0));
  sidebar.render({ herdr: true, workspaces: [web] }, { kind: 'session', id: 's1' }, '', new Map());
  const elsewhere = { stays: clickOn(element, '.herdr-tab:not(.selected)'), buttons: element.querySelector('.herdr-row-actions') !== null };

  const stays = clickOn(element, '.herdr-workspace.selected');
  pressIn(element, '.herdr-row-rename');
  const workspaceName = nameIn(element, 'shop');
  await settle();
  clickOn(element, '.herdr-workspace.selected');
  pressIn(element, '.herdr-row-close');
  pressIn(element, '.herdr-row-confirm-close');
  await settle();
  clickOn(element, '.herdr-tab.selected');
  pressIn(element, '.herdr-row-rename');
  const tabName = nameIn(element, 'checkout');
  await settle();
  clickOn(element, '.herdr-tab.selected');
  pressIn(element, '.herdr-row-close');
  pressIn(element, '.herdr-row-confirm-close');
  await settle();

  assert.deepEqual({ elsewhere, stays, workspaceName, tabName, changes }, {
    elsewhere: { stays: false, buttons: false },
    stays: true,
    workspaceName: 'web',
    tabName: '',
    changes: [['rename workspace', 'w2', 'shop'], ['close workspace', 'w2'], ['rename tab', 'w2:t1', 'checkout'], ['close tab', 'w2:t1']],
  });
});

// The buttons go on another click on the row; while a name is being typed, a fresh look at herdr leaves the box as it
// is; Escape leaves the name as it was
test('herdrSidebar_Should_HideButtonsOnClick_And_KeepNameBox_WhileHerdrIsLookedAtAgain', () => {
  const { element, sidebar, changes } = changingSidebar();
  sidebar.render({ herdr: true, workspaces: [web] }, { kind: 'session', id: 's1' }, '', new Map());
  clickOn(element, '.herdr-workspace.selected');
  clickOn(element, '.herdr-workspace.selected');
  const hidden = element.querySelector('.herdr-row-actions') === null;
  clickOn(element, '.herdr-workspace.selected');
  pressIn(element, '.herdr-row-rename');

  sidebar.render({ herdr: true, workspaces: [{ ...web, status: 'working' }] }, { kind: 'session', id: 's1' }, '', new Map());
  const kept = element.querySelector('input.herdr-row-name') !== null;
  element.querySelector('input.herdr-row-name')?.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

  assert.deepEqual({ hidden, kept, after: element.querySelector('input.herdr-row-name'), changes }, { hidden: true, kept: true, after: null, changes: [] });
});

// The folder of a new workspace is chosen from those the page offers — typed before, where sessions ran — or typed
test('herdrSidebar_Should_OfferFoldersForNewWorkspace', () => {
  const element = window.document.createElement('div');
  window.document.body.append(element);
  const sidebar = createHerdrSidebar(element, { ...noActions, folders: () => ['D:/dev/billing', '/home/ann/notes'] });
  sidebar.render({ herdr: true, workspaces: [web] }, undefined, '', new Map());

  sidebar.newButton.click();

  const box = element.querySelector('.herdr-new-folder');
  const list = box === null ? null : element.querySelector(`datalist#${box.getAttribute('list')}`);
  assert.deepEqual([...(list?.querySelectorAll('option') ?? [])].map((option) => option.getAttribute('value')), ['D:/dev/billing', '/home/ann/notes']);
});

/**
 * The new workspace's form, opened: its name and folder boxes, and choosing a folder as the page does — typed, or picked
 * from those offered.
 */
function newWorkspaceForm() {
  const element = window.document.createElement('div');
  const sidebar = createHerdrSidebar(element, noActions);
  sidebar.render({ herdr: true, workspaces: [web] }, undefined, '', new Map());
  sidebar.newButton.click();
  const name = element.querySelector('.herdr-new-name');
  const folder = element.querySelector('.herdr-new-folder');
  assert.ok(name instanceof window.HTMLInputElement && folder instanceof window.HTMLInputElement);
  /** @param {HTMLInputElement} box @param {string} text */
  const type = (box, text) => {
    box.value = text;
    box.dispatchEvent(new window.Event('input', { bubbles: true }));
  };
  return { name, choose: (/** @type {string} */ path) => type(folder, path), typeName: (/** @type {string} */ text) => type(name, text) };
}

// A new workspace given no name is named after its folder as the folder is chosen, however the path is written
test('herdrSidebar_Should_NameNewWorkspaceAfterItsFolder_WhenNoNameIsGiven', () => {
  const form = newWorkspaceForm();
  const namedAfter = (/** @type {string} */ path) => {
    form.choose(path);
    return form.name.value;
  };

  assert.deepEqual([namedAfter('D:/dev/billing'), namedAfter('/home/ann/notes/'), namedAfter('D:\\dev\\shop')], ['billing', 'notes', 'shop']);
});

// A name typed for the new workspace stays as typed whatever folder is chosen; cleared, it follows the folder again
test('herdrSidebar_Should_KeepNameTypedForNewWorkspace_WhenFolderIsChosen', () => {
  const form = newWorkspaceForm();

  form.typeName('review');
  form.choose('D:/dev/billing');
  const typed = form.name.value;
  form.typeName('');
  form.choose('D:/dev/shop');

  assert.deepEqual({ typed, cleared: form.name.value }, { typed: 'review', cleared: 'shop' });
});

// An agent that finished shows its answer ready — its workspace too — until it is seen
test('herdrSidebar_Should_LightReadyAnswer_UntilSeen', () => {
  const element = window.document.createElement('div');
  const finished = { ...web, status: /** @type {const} */ ('done'), tabs: web.tabs.map((tab, index) => (index === 0 ? { ...tab, status: /** @type {const} */ ('done'), panes: tab.panes.map((one) => ({ ...one, status: /** @type {const} */ ('done') })) } : tab)) };
  const sidebar = createHerdrSidebar(element, noActions);
  const lamps = () => [...element.querySelectorAll('.herdr-status')].map((lamp) => lamp.getAttribute('data-status'));

  sidebar.render({ herdr: true, workspaces: [finished] }, undefined, '', new Map());
  const unseen = lamps();
  sidebar.render({ herdr: true, workspaces: [finished] }, undefined, '', new Map([['w2:p1', 5]]));

  assert.deepEqual({ unseen, seen: lamps() }, { unseen: ['ready', 'idle', 'ready', 'idle'], seen: ['idle', 'idle', 'idle', 'idle'] });
});

// An agent at work shows its robots' story, not a lamp
test('herdrSidebar_Should_ShowRobotsStoryAtWork', () => {
  const element = window.document.createElement('div');
  const busy = { ...web, tabs: web.tabs.map((tab, index) => (index === 1 ? { ...tab, panes: tab.panes.map((one) => ({ ...one, status: /** @type {const} */ ('working') })) } : tab)) };

  createHerdrSidebar(element, noActions).render({ herdr: true, workspaces: [busy] }, undefined, '', new Map());

  assert.deepEqual(
    [...element.querySelectorAll('.herdr-tabs .herdr-status')].map((lamp) => `${lamp.getAttribute('data-status')}:${lamp.querySelector('svg.robots') === null ? 'lamp' : 'robot'}`),
    ['working:robot', 'idle:lamp', 'idle:lamp'],
  );
});

// A workspace's agents at work all show its story — the workspace's own, by its name — so a session tells its project
test('herdrSidebar_Should_ShowWorkspacesOwnStoryForEachOfItsAgents', () => {
  const element = window.document.createElement('div');
  const busy = { ...web, status: /** @type {const} */ ('working'), tabs: web.tabs.map((tab) => ({ ...tab, status: /** @type {const} */ ('working'), panes: tab.panes.map((one) => ({ ...one, status: /** @type {const} */ ('working') })) })) };

  createHerdrSidebar(element, noActions).render({ herdr: true, workspaces: [busy] }, undefined, '', new Map());

  const stories = [...element.querySelectorAll('svg.robots')].map((robots) => [...robots.classList].find((name) => name.startsWith('story-')));
  assert.deepEqual({ count: stories.length, distinct: [...new Set(stories)].length }, { count: 4, distinct: 1 });
});

// An agent that finished, its answer not seen, shows a robot at rest rather than a lamp
test('herdrSidebar_Should_ShowRobotAtRest_WhenAnswerIsReady', () => {
  const element = window.document.createElement('div');
  const finished = { ...web, tabs: web.tabs.map((tab, index) => (index === 0 ? { ...tab, panes: tab.panes.map((one) => ({ ...one, status: /** @type {const} */ ('done') })) } : tab)) };

  createHerdrSidebar(element, noActions).render({ herdr: true, workspaces: [finished] }, undefined, '', new Map());

  assert.deepEqual(
    [...element.querySelectorAll('.herdr-tabs .herdr-status')].map((lamp) => `${lamp.getAttribute('data-status')}:${lamp.querySelector('svg.rests') === null ? 'lamp' : 'rest'}`),
    ['idle:lamp', 'ready:rest', 'idle:lamp'],
  );
});

// A finished agent's face has its workspace's joke beside it, by the workspace's number: the second's is a joint
test('herdrSidebar_Should_ShowWorkspacesJokeBesideFaceAtRest', () => {
  const element = window.document.createElement('div');
  /** @param {import('../public/model/herdr.js').HerdrWorkspace} workspace */
  const done = (workspace) => ({ ...workspace, status: /** @type {const} */ ('done'), tabs: workspace.tabs.map((tab) => ({ ...tab, status: /** @type {const} */ ('done'), panes: tab.panes.map((one) => ({ ...one, status: /** @type {const} */ ('done') })) })) });
  const fourth = { ...web, id: 'w4', number: 4, label: 'api', tabs: web.tabs.map((tab) => ({ ...tab, id: tab.id.replace('w2', 'w4'), panes: tab.panes.map((one) => ({ ...one, id: one.id.replace('w2', 'w4'), session: undefined })) })) };

  createHerdrSidebar(element, noActions).render({ herdr: true, workspaces: [done(web), done(fourth)] }, undefined, '', new Map());

  const jokes = [...element.querySelectorAll('.herdr-workspace svg.rests')].map((face) => [...face.classList].find((name) => name.startsWith('joke-')));
  assert.deepEqual(jokes, ['joke-joint', 'joke-popper']);
});
