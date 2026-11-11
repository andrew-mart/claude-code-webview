import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const { window } = new JSDOM('<!doctype html><html><body></body></html>');
Object.assign(globalThis, { window, document: window.document });
const { createEffortRow } = await import('../public/view/effort-row.js');

const session = '6f1c2a3b-5d4e-4f60-8a7b-9c0d1e2f3a4b';
/** @param {'claude' | 'codex'} agent @returns {import('../public/model/herdr.js').HerdrLayout} */
const runningIn = (agent) => ({
  herdr: true,
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

/**
 * A session's effort row, what it asked the terminal recorded; the terminal takes it, unless told not to.
 * @param {boolean} takes
 */
function effortOf(takes) {
  /** @type {string[]} */
  const asked = [];
  const effort = createEffortRow(session, { set: async (level) => (asked.push(level), takes) });
  /** @param {string} level */
  const press = (level) => {
    const button = [...effort.row.querySelectorAll('button')].find((one) => one.textContent === level);
    assert.ok(button instanceof window.HTMLButtonElement, `no ${level}`);
    button.click();
  };
  const lit = () => [...effort.row.querySelectorAll('button[aria-pressed="true"]')].map((one) => one.textContent);
  return { effort, asked, press, lit };
}

// A session's effort is set from its details: the level pressed is typed into its terminal — /effort — and lit at once,
// staying lit until its status line tells the session works at it; the row is there only while the session runs in
// Claude Code in a herdr tab
test('effortRow_Should_SetLevelPressed_LitUntilSessionWorksAtIt_ShownWhileItRunsInClaudeInHerdr', async () => {
  const { effort, asked, press, lit } = effortOf(true);

  effort.show(runningIn('codex'));
  const inCodex = effort.row.hidden;
  effort.show(runningIn('claude'));
  effort.showCurrent('xhigh');
  const before = lit();
  press('high');
  const pressed = lit();
  await settled();
  effort.showCurrent('xhigh');
  const notYet = lit();
  effort.showCurrent('high');

  assert.deepEqual(
    { inCodex, shown: !effort.row.hidden, before, pressed, notYet, taken: lit(), asked },
    { inCodex: true, shown: true, before: ['xhigh'], pressed: ['high'], notYet: ['high'], taken: ['high'], asked: ['high'] },
  );
});

// A level the terminal did not take is lit no longer — the one the session works at is again — and the row says so
test('effortRow_Should_LightLevelItWorksAtAgain_AndSaySo_WhenTerminalDidNotTakeLevel', async () => {
  const { effort, press, lit } = effortOf(false);
  effort.show(runningIn('claude'));
  effort.showCurrent('xhigh');

  press('max');
  await settled();

  assert.deepEqual({ lit: lit(), told: effort.row.querySelector('[role="status"]')?.textContent }, { lit: ['xhigh'], told: 'Not set — the terminal did not take /effort max' });
});
