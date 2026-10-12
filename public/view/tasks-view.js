// @ts-check
// The work a session runs in the background — subagents and commands — over its input box: a line saying how many run
// and which; opened, every task of the session, the running ones first. A command shows its output as it grows, a
// subagent its own transcript as it works.
import { parseTasks, tasksSummary, taskState } from '../model/tasks.js';
import { isRecord, text } from '../model/narrow.js';
import { h } from './dom.js';
import { icon } from './icons.js';

/**
 * @typedef {import('../model/tasks.js').Task} Task
 * @typedef {{ element: HTMLElement, size: number | undefined, reading: boolean }} Output — a command's output shown: size:
 *   where it was read to; reading: it is being read on
 * @typedef {{ element: HTMLDetailsElement, title: HTMLElement, detail: HTMLElement, state: HTMLElement, body: HTMLElement, task: Task, opened: boolean, output: Output | undefined }} TaskRow
 */

/** The viewer is asked this often while something runs, and this often while nothing does. */
const runningEveryMs = 3000;
const idleEveryMs = 15_000;
/** A command's output, open, is read on this often while it runs. */
const outputEveryMs = 1500;
/** How many running tasks the line names; the rest it counts. */
const namedRunning = 3;
const notKept = 'The output is no longer kept: Claude Code clears it after a while.';

/**
 * @param {{ sessionId: string, load: (path: string) => Promise<unknown>, openSubagent: (toolUseId: string, holder: HTMLElement) => void }} deps —
 *   load: the viewer's JSON reply at a path, none if it did not answer; openSubagent: a subagent's live transcript into
 *   the holder
 */
export function createTasksView({ sessionId, load, openSubagent }) {
  const summary = h('span', { className: 'tasks-summary' });
  const chips = h('span', { className: 'tasks-chips' });
  const bar = h('button', { className: 'tasks-bar', attrs: { type: 'button', 'aria-expanded': 'false' } }, [icon('agent'), summary, chips, h('span', { className: 'chevron' }, [icon('chevron')])]);
  const list = h('div', { className: 'tasks-list', attrs: { hidden: '' } });
  const element = h('section', { className: 'tasks', attrs: { hidden: '', 'aria-label': 'Background work' } }, [bar, list]);
  /** @type {Map<string, TaskRow>} */
  const rows = new Map();
  /** Timers of the outputs being read on: they stop with the view. */
  /** @type {Set<ReturnType<typeof setTimeout>>} */
  const outputTimers = new Set();
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  let disposed = false;

  bar.addEventListener('click', () => {
    list.hidden = !list.hidden;
    bar.setAttribute('aria-expanded', String(!list.hidden));
    element.classList.toggle('open', !list.hidden);
  });

  /**
   * A command's output from where it was read last, and on while its row is open: while the command runs, and once
   * more after it ends — until nothing new comes.
   * @param {TaskRow} row
   * @param {Output} output
   */
  const readOutput = async (row, output) => {
    output.reading = true;
    const from = output.size;
    const reply = await load(`/api/tasks/output?session=${encodeURIComponent(sessionId)}&task=${encodeURIComponent(row.task.id)}${from === undefined ? '' : `&from=${from}`}`);
    if (disposed) return;
    const chunk = isRecord(reply) && typeof reply.size === 'number' ? { text: text(reply.text) ?? '', size: reply.size } : undefined;
    if (chunk === undefined) {
      output.reading = false;
      if (from === undefined) output.element.replaceWith(h('div', { className: 'task-note', text: notKept }));
      return;
    }
    const atEnd = output.element.scrollTop + output.element.clientHeight >= output.element.scrollHeight - 4;
    output.element.append(withoutColours(chunk.text));
    if (atEnd) output.element.scrollTop = output.element.scrollHeight;
    output.size = chunk.size;
    if (!row.element.open || (row.task.state !== 'running' && chunk.text === '')) {
      output.reading = false;
      return;
    }
    const next = setTimeout(() => {
      outputTimers.delete(next);
      void readOutput(row, output);
    }, outputEveryMs);
    outputTimers.add(next);
  };

  /** @param {TaskRow} row */
  const openRow = (row) => {
    if (row.opened) {
      if (row.output !== undefined && !row.output.reading) void readOutput(row, row.output);
      return;
    }
    row.opened = true;
    if (row.task.note !== undefined) row.body.append(h('div', { className: 'task-note', text: row.task.note }));
    if (row.task.kind === 'agent') {
      openSubagent(row.task.id, row.body);
      return;
    }
    if (row.task.detail !== undefined) row.body.append(h('pre', { className: 'task-command', text: row.task.detail }));
    if (!row.task.hasOutput) {
      row.body.append(h('div', { className: 'task-note', text: notKept }));
      return;
    }
    row.output = { element: h('pre', { className: 'task-output' }), size: undefined, reading: false };
    row.body.append(row.output.element);
    void readOutput(row, row.output);
  };

  /** @param {Task} task */
  const rowOf = (task) => {
    const known = rows.get(task.id);
    if (known !== undefined) return known;
    const title = h('span', { className: 'task-title' });
    const detail = h('span', { className: 'task-detail' });
    const state = h('span', { className: 'task-state' });
    const body = h('div', { className: 'task-body' });
    const rowElement = h('details', { className: 'task-row' }, [h('summary', { className: 'task-head' }, [icon(task.kind === 'shell' ? 'shell' : 'agent'), title, detail, state]), body]);
    /** @type {TaskRow} */
    const row = { element: rowElement, title, detail, state, body, task, opened: false, output: undefined };
    rowElement.addEventListener('toggle', () => {
      if (rowElement.open) openRow(row);
    });
    rows.set(task.id, row);
    return row;
  };

  /** @param {readonly Task[]} tasks */
  const render = (tasks) => {
    const said = tasksSummary(tasks);
    element.hidden = said === undefined;
    summary.textContent = said ?? '';
    const running = tasks.filter((task) => task.state === 'running');
    chips.replaceChildren(...running.slice(0, namedRunning).map((task) => h('span', { className: 'tasks-chip', text: task.title })));
    const now = Date.now();
    const ordered = [...running.toReversed(), ...tasks.filter((task) => task.state !== 'running').toReversed()];
    list.replaceChildren(
      ...ordered.map((task) => {
        const row = rowOf(task);
        row.task = task;
        row.element.dataset.state = task.state;
        row.title.textContent = task.title;
        row.detail.textContent = task.kind === 'agent' ? (task.detail ?? '') : '';
        row.state.textContent = taskState(task, now);
        return row.element;
      }),
    );
  };

  const refresh = async () => {
    const reply = await load(`/api/tasks?session=${encodeURIComponent(sessionId)}`);
    if (disposed) return;
    const tasks = parseTasks(reply);
    if (reply !== undefined) render(tasks);
    timer = setTimeout(() => void refresh(), tasks.some((task) => task.state === 'running') ? runningEveryMs : idleEveryMs);
  };
  void refresh();

  return {
    element,
    dispose() {
      disposed = true;
      clearTimeout(timer);
      for (const pending of outputTimers) clearTimeout(pending);
    },
  };
}

/**
 * A terminal's colour codes left out of a command's output.
 * @param {string} output
 */
function withoutColours(output) {
  return output.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '');
}
