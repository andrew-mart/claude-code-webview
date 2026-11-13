// @ts-check
// Antigravity CLI's (agy) conversations read as Claude Code's are: the transcript agy keeps of a conversation —
// <home>/.gemini/antigravity-cli/brain/<id>/.system_generated/logs/transcript_full.jsonl, a step a line — put into the
// records Claude Code writes, so the feed, the list and the stream show an agy conversation as Claude Code's, and
// nothing past this file knows agy's own format. A step becomes none, or one record — and the turn's end after the
// model's last words: the user's request, out of agy's wrapping; the model's response — its thinking, its words and the
// tools it calls, as Claude Code's tools of the same work, with what it took; a tool's output, the calls answered in the
// order they were made — agy names no call.
import { isRecord, text } from '../public/model/narrow.js';

/**
 * @typedef {{ type: 'text', text: string } | { type: 'thinking', thinking: string } | { type: 'tool_use', id: string, name: string, input: Record<string, unknown> } | { type: 'tool_result', tool_use_id: string, content: string, is_error?: true }} Block
 * @typedef {{ input_tokens: number, cache_read_input_tokens: number, output_tokens: number }} Usage
 * @typedef {{ id?: string, role: 'user' | 'assistant', content: string | Block[], usage?: Usage }} Message
 * @typedef {{ type: 'user' | 'assistant' | 'system', uuid: string, parentUuid: string | null, timestamp: string | undefined, subtype?: string, durationMs?: number, content?: string, level?: 'error', isMeta?: true, isCompactSummary?: true, message?: Message, toolUseResult?: { stdout: string, stderr: string } }} AgyRecord
 *   — a step of agy as Claude Code's record: content and level, a notice's; isMeta, context not the user's;
 *   isCompactSummary, what a compaction left
 * @typedef {Omit<AgyRecord, 'parentUuid' | 'timestamp'>} Made — a record before its place in the chain is put on it
 */

/** agy's wrapping of what the user asked: the request itself, between these. */
const requestTags = /<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/;
/** The lines agy puts ahead of a tool's output: when it began and ended. */
const outputStamps = /^(?:Created At|Completed At): .*\n/gm;
/** What a call cut short by agy's stop is answered with. */
const interruptedCall = 'Interrupted: agy was stopped before this ran';

/**
 * A reading of one agy conversation, step by step in the file's order: the calls of the model's last response wait for
 * their outputs, the turn's start for its end. Rewound, agy writes the step it went back to anew, under its number, and
 * goes on from there: a step numbered as one read before it starts a branch — as Claude Code's rewind does — from the
 * last record of the step before it; the records of a branch after a rewind are named apart (-r1, -r2…), and the calls
 * left waiting in the branch left behind are not answered in it.
 * @returns {{ translate: (raw: unknown) => AgyRecord[] }}
 */
export function createAgyReading() {
  /** @type {{ parent: string | null, calls: string[], turnStart: number | undefined, last: number | undefined, rewinds: number }} */
  const state = { parent: null, calls: [], turnStart: undefined, last: undefined, rewinds: 0 };
  /** The last record each step made, by the step's number, in the branch read now. @type {Map<number, string>} */
  const ends = new Map();
  return {
    translate(raw) {
      if (!isRecord(raw) || typeof raw.step_index !== 'number') return [];
      const index = raw.step_index;
      if (state.last !== undefined && index <= state.last) {
        for (const step of [...ends.keys()]) if (step >= index) ends.delete(step);
        state.parent = [...ends.values()].at(-1) ?? null;
        state.calls = [];
        state.rewinds += 1;
      }
      state.last = index;
      const timestamp = text(raw.created_at);
      const records = madeOf(raw, state.rewinds === 0 ? `agy-${index}` : `agy-${index}-r${state.rewinds}`, timestamp, state).map((made) => {
        const record = { ...made, parentUuid: state.parent, timestamp };
        state.parent = made.uuid;
        return record;
      });
      const end = records.at(-1);
      if (end !== undefined) ends.set(index, end.uuid);
      return records;
    },
  };
}

/**
 * What a step of agy is as Claude Code's records.
 * @param {Record<string, unknown>} raw
 * @param {string} uuid — the step's record's, its others' made of it
 * @param {string | undefined} timestamp — when it was written
 * @param {{ calls: string[], turnStart: number | undefined }} state — the calls waiting for their outputs, when the turn began
 * @returns {Made[]}
 */
function madeOf(raw, uuid, timestamp, state) {
  switch (raw.type) {
    case 'USER_INPUT': {
      const said = text(raw.content) ?? '';
      state.turnStart = timeOf(timestamp);
      // agy stopped writes nothing of it: the calls left waiting for outputs were cut short, the turn interrupted
      /** @type {Made[]} */
      const cut = state.calls.map((call, at) => ({ type: 'user', uuid: `${uuid}-cut-${at}`, message: { role: 'user', content: [resultBlock(call, interruptedCall, 'failed')] } }));
      /** @type {Made[]} */
      const interrupted = cut.length === 0 ? [] : [{ type: 'user', uuid: `${uuid}-interrupted`, message: { role: 'user', content: '[Request interrupted by user]' } }];
      state.calls = [];
      return [...cut, ...interrupted, { type: 'user', uuid, message: { role: 'user', content: (requestTags.exec(said)?.[1] ?? said).trim() } }];
    }
    case 'PLANNER_RESPONSE': {
      const calls = Array.isArray(raw.tool_calls) ? raw.tool_calls.filter(isRecord) : [];
      state.calls = calls.map((_, at) => `${uuid}-${at}`);
      const thinking = text(raw.thinking);
      const said = text(raw.content);
      const content = [
        ...(thinking === undefined || thinking === '' ? [] : [thinkingBlock(thinking)]),
        ...(said === undefined || said === '' ? [] : [textBlock(said)]),
        ...calls.map((call, at) => callBlock(`${uuid}-${at}`, toolOf(text(call.name) ?? 'tool', isRecord(call.args) ? call.args : {}))),
      ];
      /** @type {Made[]} */
      const answer = content.length === 0 ? [] : [{ type: 'assistant', uuid, message: { id: uuid, role: 'assistant', content, usage: usageOf(raw) } }];
      // the response that calls no tool is the turn's last
      const started = state.turnStart;
      const ended = timeOf(timestamp);
      if (calls.length > 0 || started === undefined || ended === undefined) return answer;
      state.turnStart = undefined;
      return [...answer, { type: 'system', subtype: 'turn_duration', uuid: `${uuid}-end`, durationMs: ended - started }];
    }
    case 'GENERIC': {
      const [call, ...waiting] = state.calls;
      if (call === undefined) return [];
      state.calls = waiting;
      const output = (text(raw.content) ?? '').replace(outputStamps, '');
      return [{ type: 'user', uuid, message: { role: 'user', content: [resultBlock(call, output, raw.status === 'ERROR' ? 'failed' : 'done')] }, toolUseResult: { stdout: output, stderr: '' } }];
    }
    case 'CHECKPOINT':
      return [{ type: 'user', uuid, isCompactSummary: true, message: { role: 'user', content: text(raw.content) ?? '' } }];
    // another agent's message — a subagent's, a background task's — handed to the model
    case 'SYSTEM_MESSAGE':
      return [{ type: 'user', uuid, isMeta: true, message: { role: 'user', content: text(raw.content) ?? '' } }];
    case 'ERROR_MESSAGE': {
      const said = text(raw.error) ?? text(raw.content);
      return said === undefined || said === '' ? [] : [{ type: 'system', uuid, level: 'error', content: said }];
    }
    default:
      return [];
  }
}

/** @param {string} thinking @returns {Block} */
const thinkingBlock = (thinking) => ({ type: 'thinking', thinking });
/** @param {string} said @returns {Block} */
const textBlock = (said) => ({ type: 'text', text: said });
/** @param {string} id @param {{ name: string, input: Record<string, unknown> }} tool @returns {Block} */
const callBlock = (id, tool) => ({ type: 'tool_use', id, ...tool });
/**
 * @param {string} call — the tool call's id
 * @param {string} output
 * @param {'done' | 'failed'} outcome
 * @returns {Block}
 */
const resultBlock = (call, output, outcome) => (outcome === 'failed' ? { type: 'tool_result', tool_use_id: call, content: output, is_error: true } : { type: 'tool_result', tool_use_id: call, content: output });

/**
 * A tool of agy as Claude Code's tool of the same work — reading a file, running a command, writing or editing one — so
 * the page draws it as it draws Claude Code's; any other by its own name, with its arguments.
 * @param {string} name
 * @param {Record<string, unknown>} args
 * @returns {{ name: string, input: Record<string, unknown> }}
 */
function toolOf(name, args) {
  const path = text(args.Path);
  switch (name) {
    case 'read_file': {
      const from = typeof args.StartLine === 'number' ? args.StartLine : undefined;
      const to = typeof args.EndLine === 'number' ? args.EndLine : undefined;
      return { name: 'Read', input: { file_path: path, ...(from === undefined ? {} : { offset: from }), ...(from === undefined || to === undefined ? {} : { limit: to - from + 1 }) } };
    }
    case 'run_command': {
      const description = text(args.toolSummary);
      return { name: 'Bash', input: { command: text(args.CommandLine), ...(description === undefined ? {} : { description }) } };
    }
    case 'write_file':
      return { name: 'Write', input: { file_path: path, content: text(args.Content) } };
    case 'edit_file':
      return { name: 'Edit', input: { file_path: path, old_string: text(args.Target), new_string: text(args.Replacement) } };
    default:
      return { name, input: args };
  }
}

/**
 * What the model's response took, as Claude Code tells it.
 * @param {Record<string, unknown>} raw
 * @returns {Usage}
 */
function usageOf(raw) {
  const count = (/** @type {unknown} */ value) => (typeof value === 'number' ? value : 0);
  return { input_tokens: count(raw.input_tokens), cache_read_input_tokens: count(raw.cache_read_tokens), output_tokens: count(raw.output_tokens) };
}

/**
 * @param {string | undefined} timestamp
 * @returns {number | undefined}
 */
function timeOf(timestamp) {
  const time = timestamp === undefined ? Number.NaN : Date.parse(timestamp);
  return Number.isFinite(time) ? time : undefined;
}

/**
 * A line of an agy transcript read alone — the page asks for an entry in full — as it was read in turn: a tool's output
 * names no call, the lines before it tell which it answers. The model's response is the line's first record.
 * @param {Buffer} content — the transcript
 * @param {number} lineStart — where the line starts, in bytes
 * @returns {AgyRecord | undefined} — none where no line starts
 */
export function agyRecordAt(content, lineStart) {
  const reading = createAgyReading();
  for (let start = 0; start < content.length && start <= lineStart; ) {
    const end = content.indexOf(0x0a, start);
    const stop = end < 0 ? content.length : end;
    const records = reading.translate(parsedLine(content.subarray(start, stop).toString('utf8')));
    if (start === lineStart) return records[0];
    start = stop + 1;
  }
  return undefined;
}

/**
 * @param {string} line
 * @returns {unknown}
 */
function parsedLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    return undefined; // a line agy is still writing
  }
}
