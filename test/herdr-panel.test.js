import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createHerdrSidebar, createTabBar } from '../public/view/herdr-panel.js';

const { window } = new JSDOM('<!doctype html><html><body></body></html>');
Object.assign(globalThis, { document: window.document });
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
  const bar = createTabBar();

  bar.render({ herdr: true, workspaces: [web] }, { kind: 'session', id: 's1' });

  assert.deepEqual(
    [...bar.element.querySelectorAll('.herdr-chip')].map((chip) => chip.textContent),
    ['1', '2 node-24', '3 notes'],
  );
});
