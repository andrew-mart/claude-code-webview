import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const { window } = new JSDOM('<!doctype html><html><body></body></html>');
// The icons are drawn when their module loads: the DOM is set up before it.
Object.assign(globalThis, { window, document: window.document });
const { createTasksView } = await import('../public/view/tasks-view.js');

const session = '3f2c9a50-1111-4222-8333-944455556666';
const dev = { id: 'toolu_dev', kind: 'shell', title: 'Start the dev server', detail: 'npm run dev', startedAt: '2026-10-12T10:07:00.000Z', state: 'running', taskId: 'bdev', hasOutput: true };
const routes = { id: 'toolu_routes', kind: 'agent', title: 'Find the routes', detail: 'Explore', startedAt: '2026-10-12T10:00:00.000Z', endedAt: '2026-10-12T10:02:10.000Z', state: 'completed', note: 'Agent "Find the routes" finished', taskId: 'aroutes', hasOutput: false };
const settle = () => new Promise((done) => setTimeout(done, 5));

// Over the input box: how many tasks run in the background and which; opened, every task of the session, the running
// ones first — a command shows its output, a subagent its own transcript
test('tasksView_Should_ListBackgroundWork_AndShowWhatEachDid', async () => {
  /** @type {string[]} */
  const asked = [];
  /** @type {string[]} */
  const subagents = [];
  const view = createTasksView({
    sessionId: session,
    load: async (path) => {
      asked.push(path);
      if (path.startsWith('/api/tasks/output')) return { text: 'ready on :3000\n', from: 0, size: 15 };
      return [routes, dev];
    },
    openSubagent: (toolUseId, holder) => {
      subagents.push(toolUseId);
      holder.append(window.document.createElement('article'));
    },
  });
  window.document.body.append(view.element);
  await settle();
  const bar = view.element.querySelector('.tasks-bar');
  assert.ok(bar instanceof window.HTMLButtonElement);
  const line = { shown: !view.element.hidden, summary: view.element.querySelector('.tasks-summary')?.textContent, running: [...view.element.querySelectorAll('.tasks-chip')].map((chip) => chip.textContent) };

  bar.click();
  const rows = [...view.element.querySelectorAll('.task-row')];
  for (const row of rows) {
    assert.ok(row instanceof window.HTMLDetailsElement);
    row.open = true;
    row.dispatchEvent(new window.Event('toggle'));
  }
  await settle();
  view.dispose();

  assert.deepEqual(
    {
      line,
      rows: rows.map((row) => row.querySelector('.task-title')?.textContent),
      output: view.element.querySelector('.task-output')?.textContent,
      subagents,
      asked: asked.filter((path) => path.startsWith('/api/tasks/output')).slice(0, 1),
    },
    {
      line: { shown: true, summary: '1 running in the background · 1 ended', running: ['Start the dev server'] },
      rows: ['Start the dev server', 'Find the routes'],
      output: 'ready on :3000\n',
      subagents: ['toolu_routes'],
      asked: [`/api/tasks/output?session=${session}&task=toolu_dev`],
    },
  );
});

// The list is asked for again now and then — every minute while nothing runs, as the session writes something too: a
// row that shows as it did is left as it is — not moved, not written again — so a long list costs a phone nothing until
// it changes
test('tasksView_Should_LeaveListAsItIs_When_AskedAgainAndNothingChanged', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const lint = { id: 'toolu_lint', kind: 'shell', title: 'Lint the sources', detail: 'npm run lint', startedAt: '2026-10-12T10:03:00.000Z', endedAt: '2026-10-12T10:03:20.000Z', state: 'completed', taskId: 'blint', hasOutput: true };
  const docs = { id: 'toolu_docs', kind: 'shell', title: 'Build the docs', detail: 'npm run docs', startedAt: '2026-10-12T10:05:00.000Z', endedAt: '2026-10-12T10:06:00.000Z', state: 'failed', taskId: 'bdocs', hasOutput: true };
  const replies = [[routes, lint], [routes, lint], [routes, lint, docs]];
  let asked = 0;
  const view = createTasksView({ sessionId: session, load: async () => replies[asked++], openSubagent: () => undefined });
  const flush = () => new Promise((done) => setImmediate(done));
  await flush();
  /** @type {MutationRecord[]} */
  const changes = [];
  new window.MutationObserver((records) => void changes.push(...records)).observe(view.element, { subtree: true, childList: true, attributes: true, characterData: true });

  t.mock.timers.tick(60_000);
  await flush();
  const untouched = changes.length;
  t.mock.timers.tick(60_000);
  await flush();
  const touched = changes.length > untouched;
  view.dispose();

  assert.deepEqual(
    { untouched, touched, rows: [...view.element.querySelectorAll('.task-title')].map((title) => title.textContent), states: [...view.element.querySelectorAll('.task-row')].map((row) => row.getAttribute('data-state')) },
    { untouched: 0, touched: true, rows: ['Build the docs', 'Lint the sources', 'Find the routes'], states: ['failed', 'completed', 'completed'] },
  );
});

// The session wrote something — a task started or ended shows in its transcript — and the list is asked for at once, not
// at its time: told so again while it is asked for, once more as that answer comes; then at its time, a while after
test('tasksView_Should_AskAtOnceWhenTheSessionWrote_OnceMoreIfToldSoMeanwhile', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  /** @type {(() => void)[]} */
  const answers = [];
  let asked = 0;
  const view = createTasksView({
    sessionId: session,
    load: () => {
      asked++;
      return new Promise((resolve) => answers.push(() => resolve([routes])));
    },
    openSubagent: () => undefined,
  });
  const flush = () => new Promise((done) => setImmediate(done));
  answers.shift()?.();
  await flush();
  const atStart = asked;

  view.poke();
  view.poke();
  const whileAsking = asked;
  answers.shift()?.();
  await flush();
  const afterThatAnswer = asked;
  answers.shift()?.();
  await flush();
  t.mock.timers.tick(59_999);
  await flush();
  const beforeItsTime = asked;
  t.mock.timers.tick(1);
  await flush();
  view.dispose();

  assert.deepEqual({ atStart, whileAsking, afterThatAnswer, beforeItsTime, atItsTime: asked }, { atStart: 1, whileAsking: 2, afterThatAnswer: 3, beforeItsTime: 3, atItsTime: 4 });
});
