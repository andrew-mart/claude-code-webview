import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const { window } = new JSDOM('<!doctype html><html><body></body></html>');
// the icons are drawn as their module loads: the DOM is set up first
Object.assign(globalThis, { window, document: window.document });
const { restartButton } = await import('../public/view/restart-button.js');

const session = '6f1c2a3b-5d4e-4f60-8a7b-9c0d1e2f3a4b';
/** @param {'claude' | 'codex'} agent @returns {import('../public/model/herdr.js').HerdrLayout} */
const runningIn = (agent) => ({
  herdr: true,
  restartEnv: ['CLAUDE_CODE_DISABLE_BG_SHELL_PRESSURE_REAP=1'],
  workspaces: [
    {
      id: 'w2',
      number: 1,
      label: 'web',
      status: 'idle',
      activeTab: 'w2:t1',
      tabs: [{ id: 'w2:t1', number: 1, label: 'shop', status: 'idle', panes: [{ id: 'w2:p1', agent, status: 'idle', title: undefined, session, size: undefined, activity: undefined }] }],
    },
  ],
});
const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

// The button over a session restarts it — Claude Code quits and resumes it in its tab, with the variables the viewer
// was given, which its title names — once a second press confirms it; it is there only while the session runs in Claude
// Code in a herdr tab, and says so when the restart failed
test('restartButton_Should_RestartSessionOnSecondPress_ShownWhileItRunsInClaudeInHerdr', async () => {
  const button = document.createElement('button');
  /** @type {import('../public/model/herdr.js').TabChange[]} */
  const outcomes = [{ ok: true }, { ok: false, error: 'failed' }];
  let asked = 0;
  const show = restartButton(button, session, async () => {
    asked += 1;
    return outcomes[asked - 1] ?? { ok: false, error: 'failed' };
  });
  const shown = () => ({ hidden: button.hidden, asking: button.classList.contains('asking'), failed: button.classList.contains('failed') });

  const before = shown();
  show(runningIn('codex'));
  const inCodex = shown();
  show(runningIn('claude'));
  const named = button.title.includes('CLAUDE_CODE_DISABLE_BG_SHELL_PRESSURE_REAP=1');
  button.click();
  const first = { ...shown(), restarts: asked };
  button.click();
  await settled();
  const second = { ...shown(), restarts: asked };
  button.click();
  button.click();
  await settled();
  const failed = shown();
  show({ herdr: true, workspaces: [] });

  assert.deepEqual(
    { before, inCodex, named, first, second, failed, gone: button.hidden },
    {
      before: { hidden: true, asking: false, failed: false },
      inCodex: { hidden: true, asking: false, failed: false },
      named: true,
      first: { hidden: false, asking: true, failed: false, restarts: 0 },
      second: { hidden: false, asking: false, failed: false, restarts: 1 },
      failed: { hidden: false, asking: false, failed: true },
      gone: true,
    },
  );
});
