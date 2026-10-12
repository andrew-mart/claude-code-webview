// @ts-check
// The work a session started besides its own turns: subagents and commands running in the background — what each is,
// whether it still runs, how it ended, where its output goes. Followed entry by entry as the transcript is read.
import { open, stat } from 'node:fs/promises';
import { isRecord, text } from '../public/model/narrow.js';

/**
 * @typedef {'shell' | 'agent'} TaskKind
 * @typedef {'running' | 'completed' | 'failed' | 'killed'} TaskState
 * @typedef {{ id: string, kind: TaskKind, title: string, detail: string | undefined, startedAt: string, endedAt: string | undefined, state: TaskState, note: string | undefined, taskId: string | undefined, output: string | undefined }} Task
 *   id: the call that started it; detail: a command's text; taskId: Claude Code's id of the background work; output:
 *   the file its output goes to
 * @typedef {{ title: string, detail: string | undefined, startedAt: string }} ShellCall
 * @typedef {{ toolUseId: string, status: string, summary: string | undefined, output: string | undefined }} Notification
 */

/** Tools that run a command: one runs in the background when its result names a background task. */
const shellTools = new Set(['Bash', 'PowerShell']);
/** Tools that start a subagent; Task is the name earlier versions of Claude Code gave it. */
const agentTools = new Set(['Agent', 'Task']);
/** Tools that stop background work, by its id; KillShell is the name earlier versions gave it. */
const stopTools = new Set(['TaskStop', 'KillShell']);
/** How a background command's result names its output file. */
const outputFile = /Output is being written to: (.+?\.output)/;
/** Claude Code's word for how background work ended → the task's state; other words leave it as it is. */
/** @type {ReadonlyMap<string, TaskState>} */
const endings = new Map([
  ['completed', 'completed'],
  ['failed', 'failed'],
  ['killed', 'killed'],
]);

export function createTaskTracker() {
  /** Commands called whose results have not come yet: only a result tells whether one went to the background. */
  /** @type {Map<string, ShellCall>} */
  const shellCalls = new Map();
  /** Stops called whose results have not come yet: call id → the background work's id. */
  /** @type {Map<string, string>} */
  const stops = new Map();
  /** @type {Map<string, Task>} */
  const tasks = new Map();
  /** @param {string | undefined} taskId */
  const byTaskId = (taskId) => (taskId === undefined ? undefined : [...tasks.values()].find((task) => task.taskId === taskId));

  /** @param {Record<string, unknown>} block @param {string} at */
  const noteCall = (block, at) => {
    const id = text(block.id);
    const name = String(block.name);
    const input = isRecord(block.input) ? block.input : {};
    if (id === undefined) return;
    if (shellTools.has(name)) {
      const command = text(input.command);
      shellCalls.set(id, { title: text(input.description) ?? command ?? name, detail: command, startedAt: at });
    } else if (agentTools.has(name)) {
      tasks.set(id, { id, kind: 'agent', title: text(input.description) ?? 'Subagent', detail: text(input.subagent_type), startedAt: at, endedAt: undefined, state: 'running', note: undefined, taskId: undefined, output: undefined });
    } else if (name === 'SendMessage') {
      // a message to a subagent that finished sets it working again
      const agent = byTaskId(text(input.to));
      if (agent?.kind === 'agent') tasks.set(agent.id, { ...agent, state: 'running', endedAt: undefined, note: undefined });
    } else if (stopTools.has(name)) {
      const taskId = text(input.task_id) ?? text(input.shell_id);
      if (taskId !== undefined) stops.set(id, taskId);
    }
  };
  /** @param {Record<string, unknown>} block @param {unknown} details @param {string} at */
  const noteResult = (block, details, at) => {
    const id = text(block.tool_use_id);
    if (id === undefined) return;
    const facts = isRecord(details) ? details : {};
    const stopped = byTaskId(stops.get(id));
    stops.delete(id);
    if (stopped !== undefined && block.is_error !== true) {
      tasks.set(stopped.id, { ...stopped, state: 'killed', endedAt: at, note: 'Stopped by Claude' });
      return;
    }
    const agent = tasks.get(id);
    if (agent !== undefined && agent.kind === 'agent') {
      const taskId = text(facts.agentId);
      if (facts.status === 'async_launched') tasks.set(id, { ...agent, taskId, output: text(facts.outputFile) });
      else tasks.set(id, { ...agent, taskId, state: block.is_error === true ? 'failed' : 'completed', endedAt: at });
      return;
    }
    const shell = shellCalls.get(id);
    if (shell === undefined) return;
    shellCalls.delete(id);
    const taskId = text(facts.backgroundTaskId);
    if (taskId === undefined) return;
    tasks.set(id, { id, kind: 'shell', ...shell, endedAt: undefined, state: 'running', note: undefined, taskId, output: outputFile.exec(resultText(block.content))?.[1] });
  };
  /** @param {Notification} told @param {string} at */
  const noteEnd = (told, at) => {
    const task = tasks.get(told.toolUseId);
    const state = endings.get(told.status);
    if (task === undefined || state === undefined) return;
    tasks.set(task.id, { ...task, state, endedAt: at, note: told.summary, output: task.output ?? told.output });
  };

  return {
    /** @param {unknown} raw — a transcript entry */
    note(raw) {
      if (!isRecord(raw)) return;
      const at = text(raw.timestamp) ?? '';
      for (const block of blocksOf(raw)) {
        if (block.type === 'tool_use') noteCall(block, at);
        else if (block.type === 'tool_result') noteResult(block, raw.toolUseResult, at);
      }
      const told = notificationOf(raw);
      if (told !== undefined) noteEnd(told, at);
    },
    /** @returns {Task[]} — in the order they started */
    list() {
      return [...tasks.values()].toSorted((one, other) => one.startedAt.localeCompare(other.startedAt));
    },
  };
}

/**
 * @param {Record<string, unknown>} raw
 * @returns {Record<string, unknown>[]}
 */
function blocksOf(raw) {
  const content = isRecord(raw.message) ? raw.message.content : undefined;
  return Array.isArray(content) ? content.filter(isRecord) : [];
}

/**
 * A note that background work ended: a message of its own, or one folded into a turn going on (queued_command).
 * @param {Record<string, unknown>} raw
 * @returns {Notification | undefined}
 */
function notificationOf(raw) {
  const attachment = isRecord(raw.attachment) ? raw.attachment : undefined;
  const body =
    raw.type === 'user' && isRecord(raw.message)
      ? resultText(raw.message.content)
      : attachment?.type === 'queued_command' && attachment.commandMode === 'task-notification'
        ? (text(attachment.prompt) ?? '')
        : '';
  if (!body.trimStart().startsWith('<task-notification>')) return undefined;
  const toolUseId = tag(body, 'tool-use-id');
  return toolUseId === undefined ? undefined : { toolUseId, status: tag(body, 'status') ?? '', summary: tag(body, 'summary'), output: tag(body, 'output-file') };
}

/**
 * A message's or a result's content as text: a string, or its text blocks joined.
 * @param {unknown} content
 */
function resultText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((block) => (isRecord(block) && typeof block.text === 'string' ? block.text : '')).join('');
}

/**
 * @param {string} body
 * @param {string} name
 */
function tag(body, name) {
  return new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(body)?.[1]?.trim();
}

/** The first look at a command's output takes its end, this much at most; the page reads on from there. */
const shownOutputBytes = 64 * 1024;

/**
 * @typedef {TaskState | 'interrupted'} SeenState — interrupted: it still ran when Claude Code closed the session
 * @typedef {Omit<Task, 'output' | 'state'> & { state: SeenState, hasOutput: boolean }} SeenTask — hasOutput: the
 *   command's output is still kept (Claude Code clears its temporary folder after a while)
 */

/**
 * The session's tasks as the page sees them.
 * @param {readonly Task[]} tasks
 * @param {boolean} sessionRunning — Claude Code has the session open: what it started can still run
 * @returns {Promise<SeenTask[]>}
 */
export async function seenTasks(tasks, sessionRunning) {
  return Promise.all(
    tasks.map(async ({ output, state, ...task }) => ({
      ...task,
      state: state === 'running' && !sessionRunning ? 'interrupted' : state,
      hasOutput: task.kind === 'shell' && output !== undefined && (await stat(output).then((file) => file.isFile(), () => false)),
    })),
  );
}

/**
 * A command's output from a byte on — its end when no byte is given.
 * @param {string} path
 * @param {number | undefined} from
 * @returns {Promise<{ text: string, from: number, size: number } | undefined>} — size: where the text ends, the next
 *   read starts there; none if the output is not kept
 */
export async function readTaskOutput(path, from) {
  const handle = await open(path, 'r').catch(() => undefined);
  if (handle === undefined) return undefined;
  try {
    const { size } = await handle.stat();
    const start = from === undefined ? Math.max(0, size - shownOutputBytes) : Math.min(from, size);
    const chunk = Buffer.alloc(Math.min(size - start, shownOutputBytes));
    const { bytesRead } = await handle.read(chunk, 0, chunk.length, start);
    return { text: chunk.subarray(0, bytesRead).toString('utf8'), from: start, size: start + bytesRead };
  } finally {
    await handle.close();
  }
}
