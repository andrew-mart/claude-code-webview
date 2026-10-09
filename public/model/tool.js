// @ts-check
// Tool call → a row in the feed: label, target, result counters, edit diff.
import { countOf, formatDuration } from './format.js';
import { count, isRecord, text } from './narrow.js';

/**
 * @typedef {'shell' | 'read' | 'edit' | 'search' | 'web' | 'agent' | 'skill' | 'question' | 'mcp' | 'other'} ToolFamily
 * @typedef {{ family: ToolFamily, label: string, target: string }} CallSummary
 * @typedef {{ family: ToolFamily, targetKeys: readonly string[] }} ToolShape
 * @typedef {{ kind: 'add' | 'del' | 'ctx' | 'gap', oldNo: number | undefined, newNo: number | undefined, text: string }} DiffRow
 */

/** @type {Readonly<Record<string, ToolShape>>} */
const shapes = {
  Bash: { family: 'shell', targetKeys: ['command'] },
  PowerShell: { family: 'shell', targetKeys: ['command'] },
  Monitor: { family: 'shell', targetKeys: ['command', 'description'] },
  Read: { family: 'read', targetKeys: ['file_path'] },
  NotebookRead: { family: 'read', targetKeys: ['notebook_path'] },
  Edit: { family: 'edit', targetKeys: ['file_path'] },
  MultiEdit: { family: 'edit', targetKeys: ['file_path'] },
  Write: { family: 'edit', targetKeys: ['file_path'] },
  NotebookEdit: { family: 'edit', targetKeys: ['notebook_path'] },
  Grep: { family: 'search', targetKeys: ['pattern'] },
  Glob: { family: 'search', targetKeys: ['pattern'] },
  ToolSearch: { family: 'search', targetKeys: ['query'] },
  WebSearch: { family: 'web', targetKeys: ['query'] },
  WebFetch: { family: 'web', targetKeys: ['url'] },
  Agent: { family: 'agent', targetKeys: ['description'] },
  Task: { family: 'agent', targetKeys: ['description'] },
  SendMessage: { family: 'agent', targetKeys: ['to'] },
  Skill: { family: 'skill', targetKeys: ['skill'] },
  AskUserQuestion: { family: 'question', targetKeys: [] },
};

/**
 * @param {string} name
 * @param {unknown} input
 * @returns {CallSummary}
 */
export function summarizeCall(name, input) {
  const fields = isRecord(input) ? input : {};
  const mcp = /^mcp__(.+?)__(.+)$/.exec(name);
  if (mcp !== null) return { family: 'mcp', label: `${mcp[1]} · ${mcp[2]}`, target: firstLine(firstText(fields)) };
  const shape = shapes[name];
  if (shape === undefined) return { family: 'other', label: name, target: firstLine(firstText(fields)) };
  return { family: shape.family, label: callLabel(name, fields), target: firstLine(textAt(fields, shape.targetKeys)) };
}

/**
 * Diff of a file edit: from the result's structuredPatch (with line numbers), or from the call itself while there is no result yet.
 * @param {string} name
 * @param {unknown} input
 * @param {unknown} details — toolUseResult
 * @returns {readonly DiffRow[] | undefined}
 */
export function diffRows(name, input, details) {
  const patch = isRecord(details) && Array.isArray(details.structuredPatch) ? details.structuredPatch.filter(isRecord) : [];
  if (patch.length > 0) return withGaps(patch.map(hunkRows));
  const fields = isRecord(input) ? input : {};
  switch (name) {
    case 'Edit':
      return replacementRows(fields);
    case 'MultiEdit':
      return withGaps((Array.isArray(fields.edits) ? fields.edits.filter(isRecord) : []).map(replacementRows));
    case 'Write':
      return linesOf(fields.content).map((line) => unnumbered('add', line));
    default:
      return undefined;
  }
}

/**
 * @param {Record<string, unknown>} edit — { old_string, new_string }
 * @returns {readonly DiffRow[]}
 */
function replacementRows(edit) {
  return [...linesOf(edit.old_string).map((line) => unnumbered('del', line)), ...linesOf(edit.new_string).map((line) => unnumbered('add', line))];
}

/**
 * @param {'add' | 'del'} kind
 * @param {string} line
 * @returns {DiffRow}
 */
function unnumbered(kind, line) {
  return { kind, oldNo: undefined, newNo: undefined, text: line };
}

/**
 * @param {unknown} value
 * @returns {readonly string[]}
 */
function linesOf(value) {
  return typeof value === 'string' && value !== '' ? value.split('\n') : [];
}

/**
 * @param {readonly (readonly DiffRow[])[]} parts
 * @returns {readonly DiffRow[]}
 */
function withGaps(parts) {
  return parts.flatMap((rows, index) => (index === 0 ? rows : [gapRow, ...rows]));
}

/** @type {DiffRow} */
const gapRow = { kind: 'gap', oldNo: undefined, newNo: undefined, text: '' };

/**
 * A hunk line starts with " ", "-" or "+"; "\" is diff's marker for a missing newline at end of file.
 * @param {Record<string, unknown>} hunk
 * @returns {readonly DiffRow[]}
 */
function hunkRows(hunk) {
  let oldNo = typeof hunk.oldStart === 'number' ? hunk.oldStart : 1;
  let newNo = typeof hunk.newStart === 'number' ? hunk.newStart : 1;
  const lines = Array.isArray(hunk.lines) ? hunk.lines.filter((line) => typeof line === 'string') : [];
  /** @type {DiffRow[]} */
  const rows = [];
  for (const line of lines) {
    const body = line.slice(1);
    switch (line[0]) {
      case '-':
        rows.push({ kind: 'del', oldNo: oldNo++, newNo: undefined, text: body });
        break;
      case '+':
        rows.push({ kind: 'add', oldNo: undefined, newNo: newNo++, text: body });
        break;
      case ' ':
        rows.push({ kind: 'ctx', oldNo: oldNo++, newNo: newNo++, text: body });
        break;
    }
  }
  return rows;
}

/**
 * For Bash the label is the command description, for a subagent its type; for the rest the tool name.
 * @param {string} name
 * @param {Record<string, unknown>} fields
 * @returns {string}
 */
function callLabel(name, fields) {
  const description = textAt(fields, ['description']);
  const agentType = textAt(fields, ['subagent_type']);
  if ((name === 'Bash' || name === 'PowerShell') && description !== '') return description;
  if ((name === 'Agent' || name === 'Task') && agentType !== '') return agentType;
  return name;
}

/**
 * @param {Record<string, unknown>} fields
 * @param {readonly string[]} keys
 * @returns {string}
 */
function textAt(fields, keys) {
  for (const key of keys) {
    const value = fields[key];
    if (typeof value === 'string' && value !== '') return value;
  }
  return '';
}

/**
 * @param {Record<string, unknown>} fields
 * @returns {string}
 */
function firstText(fields) {
  return textAt(fields, Object.keys(fields));
}

/** @param {string} value */
function firstLine(value) {
  return value.split('\n', 1)[0] ?? '';
}

/**
 * @param {string} name
 * @param {{ isError: boolean, details: unknown }} result
 * @returns {string | undefined}
 */
export function summarizeResult(name, result) {
  if (result.isError) return 'error';
  const details = isRecord(result.details) ? result.details : {};
  switch (name) {
    case 'Edit':
    case 'MultiEdit':
      return changeStats(diffRows(name, {}, details) ?? []);
    case 'Write':
      // For a new file structuredPatch is empty; the whole text is in content.
      return changeStats(diffRows(name, { content: details.content }, details) ?? []);
    case 'Read':
      return linesCount(isRecord(details.file) ? count(details.file.numLines) : undefined);
    case 'Grep':
      return grepCount(details);
    case 'Glob': {
      const files = count(details.numFiles);
      return files === undefined ? undefined : countOf(files, 'file');
    }
    case 'Agent':
    case 'Task':
      return agentStats(details);
    case 'Bash':
    case 'PowerShell':
      return details.interrupted === true ? 'interrupted' : undefined;
    default:
      return undefined;
  }
}

/**
 * @param {readonly DiffRow[]} rows
 * @returns {string | undefined}
 */
function changeStats(rows) {
  const added = rows.filter((row) => row.kind === 'add').length;
  const removed = rows.filter((row) => row.kind === 'del').length;
  if (added === 0 && removed === 0) return undefined;
  return removed === 0 ? `+${added}` : `+${added} −${removed}`;
}

/**
 * @param {number | undefined} lines
 * @returns {string | undefined}
 */
function linesCount(lines) {
  return lines === undefined ? undefined : countOf(lines, 'line');
}

/**
 * Grep in files_with_matches mode counts files, in content mode output lines, in count mode matches.
 * @param {Record<string, unknown>} details
 * @returns {string | undefined}
 */
function grepCount(details) {
  const files = count(details.numFiles);
  const lines = count(details.numLines);
  const matches = count(details.numMatches);
  switch (text(details.mode)) {
    case 'content':
      return linesCount(lines);
    case 'count':
      return matches === undefined ? undefined : countOf(matches, 'match');
    default:
      return files === undefined ? undefined : countOf(files, 'file');
  }
}

/**
 * @param {Record<string, unknown>} details
 * @returns {string | undefined}
 */
function agentStats(details) {
  if (details.status === 'async_launched') return 'in background';
  const actions = count(details.totalToolUseCount);
  const ms = count(details.totalDurationMs);
  const parts = [actions === undefined ? undefined : countOf(actions, 'action'), ms === undefined ? undefined : formatDuration(ms)];
  const shown = parts.filter((part) => part !== undefined);
  return shown.length === 0 ? undefined : shown.join(' · ');
}
