import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const { window } = new JSDOM('<!doctype html><html><body></body></html>');
Object.assign(globalThis, { window, document: window.document });
const { keepLitButton } = await import('../public/view/keep-lit-button.js');

const session = '6f1c2a3b-5d4e-4f60-8a7b-9c0d1e2f3a4b';
/**
 * The session's agent in herdr, in the tab "tests" of the workspace "web".
 * @param {import('../public/model/herdr.js').AgentStatus} status
 * @param {number} activity
 * @returns {import('../public/model/herdr.js').HerdrLayout}
 */
const runningAs = (status, activity) => ({
  herdr: true,
  workspaces: [
    {
      id: 'w2',
      number: 1,
      label: 'web',
      status,
      activeTab: 'w2:t2',
      tabs: [{ id: 'w2:t2', number: 2, label: 'tests', status, panes: [{ id: 'w2:p2', agent: 'claude', status, title: undefined, session, size: undefined, activity }] }],
    },
  ],
});

// The button over a session keeps its agent lit to come back to — a press marks it, the next takes the mark off: it is
// pressed while the mark holds — not once the agent changed state — and is there only while the session runs in herdr
test('keepLitButton_Should_ToggleSessionsAgent_PressedWhileMarkHolds_ShownOnlyInHerdr', () => {
  const button = window.document.createElement('button');
  /** @type {string[]} */
  const toggled = [];
  const show = keepLitButton(button, session, (pane) => void toggled.push(pane.id));
  const beforeHerdr = !button.hidden;

  show(runningAs('idle', 5), new Map());
  const unmarked = [!button.hidden, button.getAttribute('aria-pressed')];
  button.click();
  show(runningAs('idle', 5), new Map([['w2:p2', 5]]));
  const marked = button.getAttribute('aria-pressed');
  show(runningAs('working', 6), new Map([['w2:p2', 5]]));
  const outlived = button.getAttribute('aria-pressed');
  show({ herdr: true, workspaces: [] }, new Map());

  assert.deepEqual(
    { beforeHerdr, unmarked, marked, outlived, afterTabClosed: !button.hidden, toggled },
    { beforeHerdr: false, unmarked: [true, 'false'], marked: 'true', outlived: 'false', afterTabClosed: false, toggled: ['w2:p2'] },
  );
});
