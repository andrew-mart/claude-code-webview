// @ts-check
// What the page gets of an entry up front. A tool's output — a command's stdout, a file read or written — is most of a
// long session's weight and is seen only when its row is opened: a big one is left out, with what the folded row
// shows worked out here, and the page loads the whole entry when the row opens (/api/entry).
import { isRecord, text } from '../public/model/narrow.js';
import { diffRows, firstChangedLine, summarizeResult } from '../public/model/tool.js';

/** Tool payloads up to this size (JSON characters) go with the entry: opening the row needs no request then. */
const inlineSize = 2048;
/** How much of a long text field of a cut input the row's head gets. */
const previewChars = 300;

/**
 * @typedef {{ name: string, input: unknown }} Call — a tool call whose result has not come yet
 */

/**
 * @param {Record<string, unknown>} slim — the entry as slimEntry makes it
 * @param {{ at: number, calls: Map<string, Call> }} context — at: where the entry's line starts in the file, the page
 *   loads the whole entry from there; calls: the tool calls read so far, by id, until their results come
 * @returns {Record<string, unknown>}
 */
export function liteEntry(slim, { at, calls }) {
  const message = isRecord(slim.message) ? slim.message : undefined;
  const content = message !== undefined && Array.isArray(message.content) ? message.content : undefined;
  if (message === undefined || content === undefined) return slim;
  if (slim.type === 'assistant') {
    let cut = false;
    const blocks = content.map((block) => {
      if (!isRecord(block) || block.type !== 'tool_use') return block;
      const id = text(block.id);
      const name = text(block.name);
      if (id !== undefined && name !== undefined) calls.set(id, { name, input: block.input });
      if (JSON.stringify(block.input ?? null).length <= inlineSize) return block;
      cut = true;
      return { ...block, input: preview(block.input), cut: true };
    });
    return cut ? { ...slim, full: at, message: { ...message, content: blocks } } : slim;
  }
  const results = content.filter((block) => isRecord(block) && block.type === 'tool_result');
  if (results.length === 0) return slim;
  const details = slim.toolUseResult;
  const ids = results.flatMap((block) => (isRecord(block) && typeof block.tool_use_id === 'string' ? [block.tool_use_id] : []));
  const found = ids.map((id) => calls.get(id));
  for (const id of ids) calls.delete(id);
  if (JSON.stringify(results).length + JSON.stringify(details ?? null).length <= inlineSize) return slim;
  const deferred = content.map((block) => {
    if (!isRecord(block) || block.type !== 'tool_result') return block;
    const call = found[ids.indexOf(String(block.tool_use_id))];
    return { type: 'tool_result', tool_use_id: block.tool_use_id, is_error: block.is_error === true, deferred: rowFacts(call, block.is_error === true, details) };
  });
  /** @type {Record<string, unknown>} */
  const lite = { ...slim, full: at, message: { ...message, content: deferred } };
  delete lite.toolUseResult;
  return lite;
}

/**
 * A call's input as its row's head needs it — the file, the command's start: short fields whole, long text cut,
 * nested data left out.
 * @param {unknown} input
 * @returns {Record<string, unknown>}
 */
function preview(input) {
  if (!isRecord(input)) return {};
  return Object.fromEntries(
    Object.entries(input).flatMap(([key, value]) => {
      if (typeof value === 'string') return [[key, value.length > previewChars ? `${value.slice(0, previewChars)}…` : value]];
      return JSON.stringify(value ?? null).length <= previewChars ? [[key, value]] : [];
    }),
  );
}

/**
 * What the folded row shows of a result: the short summary and, for an edit, the first changed line.
 * @param {Call | undefined} call
 * @param {boolean} isError
 * @param {unknown} details
 * @returns {{ meta?: string, line?: number }}
 */
function rowFacts(call, isError, details) {
  if (call === undefined) return {};
  const meta = summarizeResult(call.name, { isError, details });
  const line = isError ? undefined : firstChangedLine(diffRows(call.name, call.input, details));
  return { ...(meta === undefined ? {} : { meta }), ...(line === undefined ? {} : { line }) };
}
