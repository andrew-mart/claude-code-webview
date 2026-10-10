// @ts-check
// Tool call row: collapsed to a single line; the body is built on first expand.
import { diffRows, summarizeCall, summarizeResult } from '../model/tool.js';
import { isRecord, text } from '../model/narrow.js';
import { h, inlineImage } from './dom.js';
import { fileLink } from './file-links.js';
import { icon } from './icons.js';
import { codeFrame, highlightInto, languageOfPath, renderMarkdown } from './markdown.js';

/**
 * @typedef {import('../model/entry.js').ToolCallEvent} ToolCallEvent
 * @typedef {import('../model/entry.js').ToolResultEvent} ToolResultEvent
 * @typedef {import('../model/entry.js').TaskNotificationEvent} TaskNotificationEvent
 * @typedef {(toolUseId: string, holder: HTMLElement) => void} OpenSubagent
 * @typedef {'pending' | 'done' | 'error'} ToolState
 * @typedef {{ mount: () => HTMLDetailsElement, family: import('../model/tool.js').ToolFamily, state: () => ToolState, applyResult: (result: ToolResultEvent) => void, applyNotification: (event: TaskNotificationEvent) => void }} ToolRow — mount: the row's element, built the first time it is shown: a folded group of calls costs no DOM
 */

const shownLines = 400;

/**
 * @param {ToolCallEvent} call
 * @param {OpenSubagent} openSubagent
 * @returns {ToolRow}
 */
export function createToolRow(call, openSubagent) {
  const summary = summarizeCall(call.name, call.input);
  /** @type {ToolResultEvent | undefined} */
  let result;
  /** @type {ToolState} */
  let state = 'pending';
  let metaText = '';
  /** @type {BuiltRow | undefined} */
  let built;

  const render = () => {
    if (built === undefined) return;
    built.body.replaceChildren(...toolBody(call, result, openSubagent));
    built.rendered = true;
  };
  // What the result says goes onto the row once it is built; the changed line of an edit takes a diff, so only a row
  // someone can see pays for it.
  const show = () => {
    if (built === undefined) return;
    built.element.dataset.state = state;
    built.meta.textContent = metaText;
    const changed = result === undefined ? undefined : firstChangedLine(diffRows(call.name, call.input, result.details));
    if (built.target instanceof HTMLAnchorElement && changed !== undefined) built.target.setAttribute('data-line', String(changed));
  };

  return {
    family: summary.family,
    state: () => state,
    mount() {
      if (built === undefined) {
        built = buildRow(call, summary);
        const row = built;
        row.element.addEventListener('toggle', () => {
          if (row.element.open && !row.rendered) render();
        });
        if (summary.family === 'question') row.element.open = true;
        show();
      }
      return built.element;
    },
    applyResult(event) {
      result = event;
      state = event.isError ? 'error' : 'done';
      metaText = summarizeResult(call.name, { isError: event.isError, details: event.details }) ?? '';
      show();
      if (built !== undefined && (built.rendered || built.element.open)) render();
    },
    applyNotification(event) {
      metaText = event.status === 'completed' ? 'completed' : event.status;
      if (event.status === 'failed' || event.status === 'killed') state = 'error';
      show();
    },
  };
}

/**
 * @typedef {{ element: HTMLDetailsElement, meta: HTMLElement, target: HTMLElement, body: HTMLElement, rendered: boolean }} BuiltRow
 */

/**
 * The row's elements: one line with the tool, its target and the result's summary; the body stays empty until opened.
 * @param {ToolCallEvent} call
 * @param {{ family: import('../model/tool.js').ToolFamily, label: string, target: string }} summary
 * @returns {BuiltRow}
 */
function buildRow(call, summary) {
  const meta = h('span', { className: 'tool-meta' });
  const target = targetElement(call, summary.target);
  const head = h('summary', { className: 'tool-head' }, [
    icon(summary.family),
    h('span', { className: 'tool-label', text: summary.label }),
    target,
    meta,
    h('span', { className: 'tool-status' }),
    h('span', { className: 'chevron' }, [icon('chevron')]),
  ]);
  const body = h('div', { className: 'tool-body' });
  const element = h('details', { className: 'tool', attrs: { 'data-family': summary.family, 'data-state': 'pending' } }, [head, body]);
  return { element, meta, target, body, rendered: false };
}

/**
 * The row target: for file tools, a link that opens the file in the right-hand panel.
 * @param {ToolCallEvent} call
 * @param {string} label
 * @returns {HTMLElement}
 */
function targetElement(call, label) {
  const input = isRecord(call.input) ? call.input : {};
  const path = fileTools.has(call.name) ? text(input.file_path) ?? text(input.notebook_path) : undefined;
  if (path === undefined) return h('span', { className: 'tool-target', text: label, title: label });
  const line = typeof input.offset === 'number' && input.offset > 0 ? input.offset : undefined;
  const link = fileLink({ path, line, endLine: undefined }, label);
  link.classList.add('tool-target');
  link.title = `Open ${path} in the side panel`;
  return link;
}

const fileTools = new Set(['Read', 'Edit', 'MultiEdit', 'Write', 'NotebookRead', 'NotebookEdit']);

/**
 * The first changed line of an edit — the panel opens the file there after Edit.
 * @param {readonly import('../model/tool.js').DiffRow[] | undefined} rows
 * @returns {number | undefined}
 */
function firstChangedLine(rows) {
  const row = rows?.find((candidate) => candidate.kind === 'add' || candidate.kind === 'del');
  return row?.newNo ?? row?.oldNo;
}

/**
 * @param {ToolCallEvent} call
 * @param {ToolResultEvent | undefined} result
 * @param {OpenSubagent} openSubagent
 * @returns {Node[]}
 */
function toolBody(call, result, openSubagent) {
  const input = isRecord(call.input) ? call.input : {};
  const output = result === undefined ? '' : result.parts.map((part) => (part.type === 'text' ? part.text : '')).join('\n');
  const images = result === undefined ? [] : result.parts.flatMap((part) => (part.type === 'image' ? [inlineImage(part.image)] : []));
  const diff = diffRows(call.name, call.input, result?.details);
  /** @type {Node[]} */
  const parts = [];
  switch (call.name) {
    case 'Bash':
    case 'PowerShell':
      parts.push(codeBlock(text(input.command) ?? '', call.name === 'Bash' ? 'bash' : 'powershell', '$'));
      break;
    case 'Read':
      if (result !== undefined && !result.isError) return [numberedFile(output, text(input.file_path) ?? ''), ...images];
      break;
    case 'Agent':
    case 'Task':
      // For a background agent the call result is just a launch marker; its report arrives later as a separate message.
      return agentBody(call, input, isRecord(result?.details) && result.details.status === 'async_launched' ? '' : output, openSubagent);
    default:
      if (diff === undefined) parts.push(inputBlock(input));
  }
  if (diff !== undefined) parts.push(diffTable(diff, languageOfPath(text(input.file_path) ?? '')));
  if (result === undefined) parts.push(h('div', { className: 'tool-waiting', text: 'Waiting for the result…' }));
  else if (output.trim() !== '' && (diff === undefined || result.isError)) parts.push(outputBlock(output, result.isError));
  return [...parts, ...images];
}

/**
 * @param {Readonly<Record<string, unknown>>} input
 * @returns {Node}
 */
function inputBlock(input) {
  const json = JSON.stringify(input, undefined, 2);
  return codeFrame(h('pre', { className: 'code' }, [highlighted(json, 'json')]), json, 'input');
}

/**
 * @param {string} source
 * @param {string} language
 * @param {string} prompt — the prompt symbol before the command
 * @returns {Node}
 */
function codeBlock(source, language, prompt) {
  const pre = h('pre', { className: 'code command' }, [h('span', { className: 'prompt', text: `${prompt} ` }), highlighted(source, language)]);
  return codeFrame(pre, source, language);
}

/**
 * @param {string} source
 * @param {string} language
 * @returns {HTMLElement}
 */
function highlighted(source, language) {
  const code = h('code');
  highlightInto(code, source, language);
  return code;
}

/**
 * Tool output; a long one is shown partially, the rest behind a button.
 * @param {string} output
 * @param {boolean} isError
 * @returns {Node}
 */
function outputBlock(output, isError) {
  const lines = output.split('\n');
  const pre = h('pre', { className: isError ? 'output error' : 'output', text: lines.slice(0, shownLines).join('\n') });
  if (lines.length <= shownLines) return pre;
  const more = h('button', { className: 'more', text: `Show ${lines.length - shownLines} more lines`, attrs: { type: 'button' } });
  more.addEventListener('click', () => {
    pre.textContent = output;
    more.remove();
  });
  return h('div', {}, [pre, more]);
}

/**
 * Read returns text in `cat -n` format: "     12\tline". The numbers go into a separate column.
 * @param {string} output
 * @param {string} path
 * @returns {Node}
 */
function numberedFile(output, path) {
  const lines = output.split('\n').slice(0, shownLines);
  const parsed = lines.map((line) => /^\s*(\d+)\t(.*)$/.exec(line));
  if (parsed.some((match) => match === null)) return outputBlock(output, false);
  const numbers = parsed.map((match) => match?.[1] ?? '').join('\n');
  const source = parsed.map((match) => match?.[2] ?? '').join('\n');
  const code = h('code');
  highlightInto(code, source, languageOfPath(path) ?? 'plaintext');
  const pre = h('pre', { className: 'code numbered' }, [h('span', { className: 'gutter', text: numbers }), code]);
  return codeFrame(pre, source, path.split(/[\\/]/).pop());
}

/**
 * @param {readonly import('../model/tool.js').DiffRow[]} rows
 * @param {string | undefined} language
 * @returns {Node}
 */
function diffTable(rows, language) {
  const table = h('table', { className: 'diff' });
  for (const row of rows.slice(0, shownLines * 2)) {
    if (row.kind === 'gap') {
      table.append(h('tr', { className: 'gap' }, [h('td', { attrs: { colspan: '4' }, text: '⋯' })]));
      continue;
    }
    const code = h('td', { className: 'line' });
    highlightInto(code, row.text, language ?? 'plaintext');
    const sign = row.kind === 'add' ? '+' : row.kind === 'del' ? '−' : '';
    table.append(
      h('tr', { className: row.kind }, [
        h('td', { className: 'no', text: row.oldNo === undefined ? '' : String(row.oldNo) }),
        h('td', { className: 'no', text: row.newNo === undefined ? '' : String(row.newNo) }),
        h('td', { className: 'sign', text: sign }),
        code,
      ]),
    );
  }
  return h('div', { className: 'diff-frame' }, [table]);
}

/**
 * @param {ToolCallEvent} call
 * @param {Readonly<Record<string, unknown>>} input
 * @param {string} output
 * @param {OpenSubagent} openSubagent
 * @returns {Node[]}
 */
function agentBody(call, input, output, openSubagent) {
  const task = h('details', { className: 'agent-task' }, [h('summary', { text: 'Task for the subagent' }), h('div', { className: 'md' }, [renderMarkdown(text(input.prompt) ?? '')])]);
  const holder = h('div', { className: 'subagent-holder' });
  const open = h('button', { className: 'open-subagent', text: "Show the subagent's work", attrs: { type: 'button' } });
  open.addEventListener('click', () => {
    open.remove();
    openSubagent(call.id, holder);
  });
  const report = output.trim() === '' ? [] : [h('div', { className: 'md agent-report' }, [renderMarkdown(output)])];
  return [task, open, holder, ...report];
}
