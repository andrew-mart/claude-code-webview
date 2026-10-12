// @ts-check
// The work a session runs besides its own turns — subagents and commands in the background — as the page shows it.
import { formatDuration } from './format.js';
import { isRecord, text } from './narrow.js';

/**
 * @typedef {'running' | 'completed' | 'failed' | 'killed' | 'interrupted'} TaskState — interrupted: it still ran when
 *   Claude Code closed the session
 * @typedef {{ id: string, kind: 'shell' | 'agent', title: string, detail: string | undefined, startedAt: string, endedAt: string | undefined, state: TaskState, note: string | undefined, taskId: string | undefined, hasOutput: boolean, lastActiveAt: string | undefined }} Task
 *   id: the call that started it; detail: a command's text, a subagent's type; hasOutput: a command's output is kept;
 *   lastActiveAt: when a subagent last wrote to its transcript
 */

/** A running subagent that has not written for this long has likely stopped without a word. */
const quietMs = 20 * 60_000;

/** @type {readonly TaskState[]} */
const states = ['running', 'completed', 'failed', 'killed', 'interrupted'];

/** How an ended task ended, and the word before how long it took. */
/** @type {Readonly<Record<Exclude<TaskState, 'running' | 'interrupted'>, readonly [string, string]>>} */
const endings = { completed: ['done', ''], failed: ['failed', 'after '], killed: ['stopped', 'after '] };

/**
 * The /api/tasks reply.
 * @param {unknown} json
 * @returns {Task[]}
 */
export function parseTasks(json) {
  return (Array.isArray(json) ? json : []).flatMap((entry) => {
    const task = taskOf(entry);
    return task === undefined ? [] : [task];
  });
}

/**
 * @param {unknown} json
 * @returns {Task | undefined}
 */
function taskOf(json) {
  if (!isRecord(json)) return undefined;
  const id = text(json.id);
  const title = text(json.title);
  const startedAt = text(json.startedAt);
  const kind = json.kind === 'shell' || json.kind === 'agent' ? json.kind : undefined;
  const state = states.find((known) => known === json.state);
  if (id === undefined || title === undefined || startedAt === undefined || kind === undefined || state === undefined) return undefined;
  return { id, kind, title, detail: text(json.detail), startedAt, endedAt: text(json.endedAt), state, note: text(json.note), taskId: text(json.taskId), hasOutput: json.hasOutput === true, lastActiveAt: text(json.lastActiveAt) };
}

/**
 * How the task stands, in a few words.
 * @param {Task} task
 * @param {number} now
 */
export function taskState(task, now) {
  const started = Date.parse(task.startedAt);
  switch (task.state) {
    case 'running': {
      const quiet = task.lastActiveAt === undefined ? 0 : now - Date.parse(task.lastActiveAt);
      return quiet >= quietMs ? `quiet for ${formatDuration(quiet)} · no word that it ended` : `running · ${formatDuration(now - started)}`;
    }
    case 'interrupted':
      return 'cut short: the session closed';
    default: {
      const [word, before] = endings[task.state];
      return task.endedAt === undefined ? word : `${word} · ${before}${formatDuration(Date.parse(task.endedAt) - started)}`;
    }
  }
}

/**
 * The line over the input box; none for a session that started no such work.
 * @param {readonly Task[]} tasks
 * @returns {string | undefined}
 */
export function tasksSummary(tasks) {
  const running = tasks.filter((task) => task.state === 'running').length;
  const ended = tasks.length - running;
  if (running === 0) return ended === 0 ? undefined : `${ended} background ${ended === 1 ? 'task' : 'tasks'} ended`;
  return `${running} running in the background${ended === 0 ? '' : ` · ${ended} ended`}`;
}
