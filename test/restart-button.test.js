import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const { window } = new JSDOM('<!doctype html><html><body></body></html>');
// the icons are drawn as their module loads: the DOM is set up first
Object.assign(globalThis, { window, document: window.document });
const { exitButton, restartButton } = await import('../public/view/restart-button.js');

const session = '6f1c2a3b-5d4e-4f60-8a7b-9c0d1e2f3a4b';
/** @param {'claude' | 'codex' | 'agy'} agent @returns {import('../public/model/herdr.js').HerdrLayout} */
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

// The button in a session's details restarts it — Claude Code quits and resumes it in its tab, with the variables the
// viewer was given, which it names — once a second press confirms it; it is there only while the session runs in Claude
// Code in a herdr tab, and says so when the restart failed
test('restartButton_Should_RestartSessionOnSecondPress_ShownWhileItRunsInClaudeInHerdr', async () => {
  const button = document.createElement('button');
  /** @type {import('../public/model/herdr.js').TabChange[]} */
  const outcomes = [{ ok: true }, { ok: false, error: 'failed' }];
  let asked = 0;
  const show = restartButton(button, session, {
    variables: 'given',
    launcher: 'as-it-ran',
    throughGpt: () => false,
    restart: async () => {
      asked += 1;
      return outcomes[asked - 1] ?? { ok: false, error: 'failed' };
    },
  });
  const shown = () => ({ hidden: button.hidden, asking: button.classList.contains('asking'), failed: button.classList.contains('failed') });

  const before = shown();
  show(runningIn('codex'));
  const inCodex = shown();
  show(runningIn('claude'));
  const named = button.title.includes('CLAUDE_CODE_DISABLE_BG_SHELL_PRESSURE_REAP=1');
  const ready = button.textContent;
  button.click();
  const first = { ...shown(), restarts: asked, words: button.textContent };
  button.click();
  await settled();
  const second = { ...shown(), restarts: asked };
  button.click();
  button.click();
  await settled();
  const failed = shown();
  show({ herdr: true, workspaces: [] });

  assert.deepEqual(
    { before, inCodex, named, ready, first, second, failed, gone: button.hidden },
    {
      before: { hidden: true, asking: false, failed: false },
      inCodex: { hidden: true, asking: false, failed: false },
      named: true,
      ready: 'Restart with CLAUDE_CODE_DISABLE_BG_SHELL_PRESSURE_REAP=1',
      first: { hidden: false, asking: true, failed: false, restarts: 0, words: 'Press again to restart' },
      second: { hidden: false, asking: false, failed: false, restarts: 1 },
      failed: { hidden: false, asking: false, failed: true },
      gone: true,
    },
  );
});

// Beside it a plain restart — Claude Code resumes the session with no variables set — named so and shown whenever the
// session runs in Claude Code in a herdr tab; the restart with variables only while the viewer was given some
test('restartButton_Should_OfferPlainRestart_AndRestartWithVariablesOnlyWhenGiven', async () => {
  /** @type {string[]} */
  const asked = [];
  /** @param {'given' | 'none'} variables */
  const made = (variables) => {
    const button = document.createElement('button');
    const show = restartButton(button, session, { variables, launcher: 'as-it-ran', throughGpt: () => false, restart: async () => (asked.push(variables), { ok: true }) });
    return { button, show };
  };
  const plain = made('none');
  const given = made('given');
  /** @param {import('../public/model/herdr.js').HerdrLayout} layout */
  const showBoth = (layout) => {
    plain.show(layout);
    given.show(layout);
    return [plain, given].map(({ button }) => (button.hidden ? 'hidden' : button.textContent));
  };

  const withVariables = showBoth(runningIn('claude'));
  const withNone = showBoth({ ...runningIn('claude'), restartEnv: [] });
  plain.button.click();
  plain.button.click();
  await settled();

  assert.deepEqual(
    { withVariables, withNone, plainTitle: plain.button.title.includes('CLAUDE_CODE'), asked },
    { withVariables: ['Restart the session', 'Restart with CLAUDE_CODE_DISABLE_BG_SHELL_PRESSURE_REAP=1'], withNone: ['Restart the session', 'hidden'], plainTitle: false, asked: ['none'] },
  );
});

// While the viewer has Claude Code through GPT, a restart in the other launcher: through GPT for a session in ordinary
// Claude Code, in ordinary Claude Code for one through GPT — named so, and asked for so once a second press confirms it
test('restartButton_Should_OfferRestartInOtherLauncher_WhileViewerHasClaudeGpt', async () => {
  let throughGpt = false;
  /** @type {import('../public/model/herdr.js').RestartLauncher[]} */
  const asked = [];
  const button = document.createElement('button');
  const show = restartButton(button, session, { variables: 'none', launcher: 'other', throughGpt: () => throughGpt, restart: async (launcher) => (asked.push(launcher), { ok: true }) });
  const withGpt = { ...runningIn('claude'), claudeGpt: /** @type {const} */ (true) };

  show(runningIn('claude'));
  const noGptLauncher = button.hidden;
  show(withGpt);
  const inOrdinary = button.textContent;
  button.click();
  button.click();
  await settled();
  throughGpt = true;
  show(withGpt);
  const inGpt = button.textContent;
  button.click();
  button.click();
  await settled();

  assert.deepEqual({ noGptLauncher, inOrdinary, inGpt, asked }, { noGptLauncher: true, inOrdinary: 'Restart in Claude GPT', inGpt: 'Restart in Claude Code', asked: ['claude-gpt', 'claude'] });
});

// Exit beside the restarts: the session's agent — Claude Code, Codex or agy — quits to its tab's shell once a second
// press confirms it; there while one of them runs the session in a herdr tab, named in its title, and says so when it
// did not quit
test('exitButton_Should_QuitAgentToShellOnSecondPress_ShownWhileClaudeCodexOrAgyRunsInHerdr', async () => {
  const button = document.createElement('button');
  /** @type {import('../public/model/herdr.js').TabChange[]} */
  const outcomes = [{ ok: true }, { ok: false, error: 'failed' }];
  let asked = 0;
  const show = exitButton(button, session, {
    exit: async () => {
      asked += 1;
      return outcomes[asked - 1] ?? { ok: false, error: 'failed' };
    },
  });

  const before = button.hidden;
  show(runningIn('codex'));
  const inCodex = { hidden: button.hidden, words: button.textContent };
  show(runningIn('agy'));
  const inAgy = { hidden: button.hidden, title: button.title };
  show({ herdr: true, workspaces: [] });
  const nowhere = button.hidden;
  show(runningIn('claude'));
  button.click();
  const first = { asked, words: button.textContent };
  button.click();
  await settled();
  const second = { asked, failed: button.classList.contains('failed') };
  button.click();
  button.click();
  await settled();
  const third = { asked, failed: button.classList.contains('failed'), words: button.textContent };

  assert.deepEqual(
    { before, inCodex, inAgy, nowhere, first, second, third },
    {
      before: true,
      inCodex: { hidden: false, words: 'Exit to the terminal' },
      inAgy: { hidden: false, title: 'Exit to the terminal: Antigravity CLI quits in its tab — its turn and background commands end — and the tab stays at its shell' },
      nowhere: true,
      first: { asked: 0, words: 'Press again to exit' },
      second: { asked: 1, failed: false },
      third: { asked: 2, failed: true, words: 'Not exited — try again' },
    },
  );
});
