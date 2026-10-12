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
