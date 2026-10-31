import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const { window } = new JSDOM('<!doctype html><html><body></body></html>');
Object.assign(globalThis, { window, document: window.document });
const { herdrTabButton } = await import('../public/view/herdr-tab-button.js');

const session = '6f1c2a3b-5d4e-4f60-8a7b-9c0d1e2f3a4b';
/** @param {string} id @param {string | undefined} runs @returns {import('../public/model/herdr.js').HerdrPane} */
const pane = (id, runs) => ({ id, agent: runs === undefined ? undefined : 'claude', status: 'idle', title: undefined, session: runs, size: undefined, activity: undefined });
/** herdr shows the workspace "web" at its first tab, a shell; the session runs in the second, "tests" */
/** @type {import('../public/model/herdr.js').HerdrLayout} */
const runningInTests = {
  herdr: true,
  workspaces: [
    {
      id: 'w2',
      number: 1,
      label: 'web',
      status: 'idle',
      activeTab: 'w2:t1',
      tabs: [
        { id: 'w2:t1', number: 1, label: 'shell', status: 'idle', panes: [pane('w2:p1', undefined)] },
        { id: 'w2:t2', number: 2, label: 'tests', status: 'idle', panes: [pane('w2:p2', session)] },
      ],
    },
  ],
};
/** @type {import('../public/model/herdr.js').HerdrLayout} */
const tabClosed = { herdr: true, workspaces: [] };

// The button over a session takes herdr to the tab the session runs in — not the one herdr shows in that workspace —
// and is there only while the session runs in a herdr tab: none before herdr is heard from, none once the tab is gone
test('herdrTabButton_Should_TakeHerdrToSessionsTab_ShownOnlyWhileItRunsInOne', () => {
  const button = document.createElement('button');
  /** @type {string[]} */
  const focused = [];
  const show = herdrTabButton(button, session, (tab) => void focused.push(tab));
  const beforeHerdr = !button.hidden;

  show(runningInTests);
  const whileRunning = !button.hidden;
  button.click();
  show(tabClosed);
  const afterClosed = !button.hidden;
  button.click();

  assert.deepEqual({ beforeHerdr, whileRunning, afterClosed, focused }, { beforeHerdr: false, whileRunning: true, afterClosed: false, focused: ['w2:t2'] });
});
