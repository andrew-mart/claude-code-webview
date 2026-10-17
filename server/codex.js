// @ts-check
// Codex sessions read as Claude Code's are: its rollout records — ~/.codex/sessions/<year>/<month>/<day>/rollout-*.jsonl —
// put into the records Claude Code writes, so the feed, the list and the stream show a Codex session as they show
// Claude Code's, and nothing past this file knows Codex's own format. A record of Codex becomes none, or one record:
// prompts and answers, reasoning summaries as thinking, its exec scripts as the commands they run, other calls by name,
// their outputs as results, a turn's end with its duration, a turn stopped. Codex's instructions and context come as
// a user's message: kept, marked as not the user's. What a record of the session or the turn says — the folder, the
// branch, the model — goes onto the records after it.
import { isRecord, text } from '../public/model/narrow.js';

/**
 * @typedef {{ type: 'text', text: string } | { type: 'thinking', thinking: string } | { type: 'tool_use', id: string, name: string, input: Record<string, unknown> } | { type: 'tool_result', tool_use_id: string, content: string }} Block
 * @typedef {{ id?: string, role: 'user' | 'assistant', model?: string, content: string | Block[] }} Message
 * @typedef {{ type: 'user' | 'assistant' | 'system', uuid: string, parentUuid: string | null, timestamp: string | undefined, cwd: string | undefined, gitBranch: string | undefined, sessionId: string | undefined, entrypoint: string | undefined, isMeta?: true, subtype?: string, durationMs?: number, message?: Message, toolUseResult?: { stdout: string, stderr: string } }} ClaudeRecord
 * @typedef {Omit<ClaudeRecord, 'parentUuid' | 'timestamp' | 'cwd' | 'gitBranch' | 'sessionId' | 'entrypoint'>} Made — a record before
 *   the session's folder, branch and chain are put on it
 */

/** How Codex's own instructions and context to the model begin: a user's message of them is not the user's. */
const contextMarks = ['# AGENTS.md instructions', '<environment_context>', '<user_instructions>', '<INSTRUCTIONS>'];

/**
 * A reading of one Codex session, record by record in the file's order: the session's folder, branch and the turn's
 * model carry over from the records that say them.
 * @returns {{ translate: (raw: unknown) => ClaudeRecord[] }}
 */
export function createCodexReading() {
  /** @type {{ cwd: string | undefined, branch: string | undefined, sessionId: string | undefined, entrypoint: string | undefined, model: string | undefined, parent: string | null }} */
  const state = { cwd: undefined, branch: undefined, sessionId: undefined, entrypoint: undefined, model: undefined, parent: null };
  return {
    translate(raw) {
      if (!isRecord(raw)) return [];
      const payload = isRecord(raw.payload) ? raw.payload : {};
      // a subagent's file goes on with its parent's session copied in, the parent's session_meta among it: the session is
      // the one the file begins with
      if (raw.type === 'session_meta' && state.entrypoint !== undefined) return [];
      if (raw.type === 'session_meta') {
        state.cwd = text(payload.cwd);
        state.branch = isRecord(payload.git) ? text(payload.git.branch) : undefined;
        state.sessionId = text(payload.id);
        // run by a program — codex exec, or a subagent of another session — as Claude Code names its SDK's runs
        state.entrypoint = payload.source === 'exec' || isRecord(payload.source) || payload.thread_source === 'subagent' ? 'sdk-codex' : 'codex-cli';
        return [];
      }
      if (raw.type === 'turn_context') {
        state.cwd = text(payload.cwd) ?? state.cwd;
        state.model = text(payload.model) ?? state.model;
        return [];
      }
      return madeOf(raw, payload, state.model).map((made) => {
        const record = { ...made, parentUuid: state.parent, timestamp: text(raw.timestamp), cwd: state.cwd, gitBranch: state.branch, sessionId: state.sessionId, entrypoint: state.entrypoint };
        state.parent = made.uuid;
        return record;
      });
    },
  };
}

/**
 * What a record of Codex is as Claude Code's records: none, or one.
 * @param {Record<string, unknown>} raw
 * @param {Record<string, unknown>} payload
 * @param {string | undefined} model — the turn's
 * @returns {Made[]}
 */
function madeOf(raw, payload, model) {
  // the record's place in its file: the same whether the file is read in turn or a line of it alone
  const uuid = `codex-${typeof raw.ordinal === 'number' ? raw.ordinal : (text(payload.id) ?? 'record')}`;
  if (raw.type === 'event_msg') {
    if (payload.type === 'task_complete' && typeof payload.duration_ms === 'number') return [{ type: 'system', subtype: 'turn_duration', uuid, durationMs: payload.duration_ms }];
    if (payload.type === 'turn_aborted') return [{ type: 'user', uuid, message: { role: 'user', content: '[Request interrupted by user]' } }];
    return [];
  }
  if (raw.type !== 'response_item') return [];
  const callId = text(payload.call_id) ?? uuid;
  switch (payload.type) {
    case 'message':
      return messageOf(payload, uuid, model);
    case 'reasoning': {
      const thought = partsOf(payload.summary, 'summary_text').join('\n\n');
      return thought === '' ? [] : [{ type: 'assistant', uuid, message: { ...idOf(payload), role: 'assistant', ...modelOf(model), content: [{ type: 'thinking', thinking: thought }] } }];
    }
    case 'custom_tool_call': {
      const input = text(payload.input) ?? '';
      const commands = payload.name === 'exec' ? commandsOf(input) : [];
      const call =
        commands.length > 0
          ? { name: 'Bash', input: { command: commands.join('\n') } }
          : payload.name === 'apply_patch'
            ? { name: 'apply_patch', input: { file_path: patchedFiles(input).join(', '), patch: input } }
            : { name: text(payload.name) ?? 'tool', input: { input } };
      return [{ type: 'assistant', uuid, message: { ...idOf(payload), role: 'assistant', ...modelOf(model), content: [{ type: 'tool_use', id: callId, ...call }] } }];
    }
    case 'function_call': {
      const name = text(payload.name) ?? 'tool';
      const args = argumentsOf(payload.arguments);
      const questions = name === 'request_user_input_async' || name === 'request_user_input' ? questionBlocks(args) : [];
      return [{ type: 'assistant', uuid, message: { ...idOf(payload), role: 'assistant', ...modelOf(model), content: [...questions, { type: 'tool_use', id: callId, ...functionCallOf(name, args) }] } }];
    }
    case 'custom_tool_call_output':
    case 'function_call_output': {
      const output = typeof payload.output === 'string' ? payload.output : partsOf(payload.output, 'input_text', 'output_text', 'text').join('');
      return [{ type: 'user', uuid, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: callId, content: output }] }, toolUseResult: { stdout: output, stderr: '' } }];
    }
    default:
      return [];
  }
}

/**
 * Questions are conversation content even after the tool accepts the request and work continues: a completed call
 * folds into the activity summary, but the reader still needs the question and its choices to answer in the box.
 * @param {Record<string, unknown>} args
 * @returns {Block[]}
 */
function questionBlocks(args) {
  if (!Array.isArray(args.questions)) return [];
  return args.questions.filter(isRecord).flatMap((question) => {
    const title = text(question.title) ?? text(question.question);
    if (title === undefined) return [];
    const options = Array.isArray(question.options) ? question.options.flatMap((option) => {
      if (typeof option === 'string') return [option];
      if (!isRecord(option) || typeof option.label !== 'string') return [];
      return [typeof option.description === 'string' ? `${option.label}: ${option.description}` : option.label];
    }) : [];
    return [{ type: /** @type {const} */ ('text'), text: [title, ...options.map((option, at) => `${at + 1}. ${option}`)].join('\n\n') }];
  });
}

/**
 * A message: the user's prompt — or Codex's instructions and context, marked so — or the model's answer; the
 * developer's are Codex's own and are left out.
 * @param {Record<string, unknown>} payload
 * @param {string} uuid
 * @param {string | undefined} model
 * @returns {Made[]}
 */
function messageOf(payload, uuid, model) {
  if (payload.role === 'user') {
    const said = partsOf(payload.content, 'input_text').join('\n');
    if (said === '') return [];
    const context = contextMarks.some((mark) => said.startsWith(mark));
    return [{ type: 'user', uuid, ...(context ? { isMeta: /** @type {const} */ (true) } : {}), message: { role: 'user', content: said } }];
  }
  if (payload.role === 'assistant') {
    const said = partsOf(payload.content, 'output_text').join('\n');
    return said === '' ? [] : [{ type: 'assistant', uuid, message: { ...idOf(payload), role: 'assistant', ...modelOf(model), content: [{ type: 'text', text: said }] } }];
  }
  return [];
}

/**
 * The commands an exec script runs: Codex's exec writes a script of tools.exec_command({ cmd: "…" }) calls, and the
 * strings given as cmd are what a terminal ran.
 * @param {string} script
 * @returns {string[]}
 */
function commandsOf(script) {
  return [...script.matchAll(/["']?\bcmd["']?\s*:\s*"((?:[^"\\]|\\.)*)"/g)].flatMap(([, quoted]) => {
    try {
      const command = JSON.parse(`"${quoted ?? ''}"`);
      return typeof command === 'string' ? [command] : [];
    } catch {
      return [];
    }
  });
}

/**
 * A function call as Claude Code's tool of the same work: a command — exec_command, shell_command, shell — as its
 * terminal's, a plan as its list of tasks; any other by its own name.
 * @param {string} name
 * @param {Record<string, unknown>} args
 * @returns {{ name: string, input: Record<string, unknown> }}
 */
function functionCallOf(name, args) {
  const command = name === 'exec_command' ? text(args.cmd) : name === 'shell_command' ? text(args.command) : name === 'shell' && Array.isArray(args.command) ? shellCommand(args.command) : undefined;
  if (command !== undefined) return { name: 'Bash', input: { command } };
  if (name === 'update_plan' && Array.isArray(args.plan)) {
    const todos = args.plan.filter(isRecord).map((step) => ({ content: text(step.step) ?? '', status: text(step.status) ?? 'pending', activeForm: text(step.step) ?? '' }));
    return { name: 'TodoWrite', input: { todos } };
  }
  return { name, input: args };
}

/**
 * A command given as its words: ["bash", "-lc", "ls -la"] is the script the shell runs.
 * @param {readonly unknown[]} words
 */
function shellCommand(words) {
  const [shell, flag, script] = words;
  return typeof shell === 'string' && (flag === '-lc' || flag === '-c') && typeof script === 'string' && words.length === 3 ? script : words.map(String).join(' ');
}

/**
 * The files a patch of apply_patch changes, adds or deletes.
 * @param {string} patch
 * @returns {string[]}
 */
function patchedFiles(patch) {
  return [...patch.matchAll(/^\*\*\* (?:Update|Add|Delete) File: (.+)$/gm)].flatMap(([, file]) => (file === undefined ? [] : [file.trim()]));
}

/**
 * A function call's arguments, given as JSON; what is not a JSON object goes as it is.
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
function argumentsOf(value) {
  const given = text(value) ?? '';
  try {
    const parsed = JSON.parse(given);
    return isRecord(parsed) ? parsed : { arguments: given };
  } catch {
    return { arguments: given };
  }
}

/**
 * The texts of a list of parts of these kinds, in order.
 * @param {unknown} parts
 * @param {...string} kinds
 * @returns {string[]}
 */
function partsOf(parts, ...kinds) {
  return (Array.isArray(parts) ? parts : []).flatMap((part) => (isRecord(part) && kinds.includes(String(part.type)) && typeof part.text === 'string' ? [part.text] : []));
}

/**
 * @param {Record<string, unknown>} payload
 * @returns {{ id?: string }}
 */
function idOf(payload) {
  const id = text(payload.id);
  return id === undefined ? {} : { id };
}

/**
 * @param {string | undefined} model
 * @returns {{ model?: string }}
 */
function modelOf(model) {
  return model === undefined ? {} : { model };
}
