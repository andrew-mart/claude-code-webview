// @ts-check
// Layout of a series of agent actions (consecutive thoughts and tool calls): what to show as rows, what as a summary.
import { countOf } from './format.js';

/**
 * @typedef {import('./tool.js').ToolFamily} ToolFamily
 * @typedef {{ kind: 'thinking' } | { kind: 'tool', family: ToolFamily, state: 'pending' | 'done' | 'error' }} ActivityItem
 * @typedef {{ kind: 'summary', parts: readonly string[], errors: string | undefined, expanded: boolean }} SummaryHeader
 * @typedef {SummaryHeader | { kind: 'fold', hidden: string } | { kind: 'unfold' } | { kind: 'none' }} ActivityHeader
 * @typedef {{ header: ActivityHeader, visible: readonly boolean[] }} ActivityLayout
 */

/** In detailed mode a long series is folded down to its last rows. */
const foldThreshold = 8;
const visibleWhenFolded = 4;

/** Order and names of the counters in the summary. */
/** @type {readonly [ToolFamily, import('./format.js').Noun][]} */
const familyNouns = [
  ['shell', 'command'],
  ['read', 'reading'],
  ['edit', 'edit'],
  ['search', 'search'],
  ['web', 'webRequest'],
  ['agent', 'subagent'],
  ['skill', 'skill'],
  ['question', 'question'],
  ['mcp', 'mcpCall'],
  ['other', 'action'],
];

/**
 * @param {readonly ActivityItem[]} items
 * @param {{ mode: string, expanded: boolean }} view
 * @returns {ActivityLayout}
 */
export function layoutActivity(items, view) {
  return view.mode === 'detailed' ? detailedLayout(items, view.expanded) : compactLayout(items, view.expanded);
}

/**
 * Detailed: every row; in a long series the last ones are visible and the rest are folded under a button.
 * @param {readonly ActivityItem[]} items
 * @param {boolean} expanded
 * @returns {ActivityLayout}
 */
function detailedLayout(items, expanded) {
  if (items.length <= foldThreshold) return { header: { kind: 'none' }, visible: items.map(() => true) };
  if (expanded) return { header: { kind: 'unfold' }, visible: items.map(() => true) };
  const hidden = items.length - visibleWhenFolded;
  return { header: { kind: 'fold', hidden: countOf(hidden, 'earlierAction') }, visible: items.map((_, index) => index >= hidden) };
}

/**
 * Compact: a series of calls is one summary row, as in Claude Code.
 * @param {readonly ActivityItem[]} items
 * @param {boolean} expanded
 * @returns {ActivityLayout}
 */
function compactLayout(items, expanded) {
  const toolCount = items.filter((item) => item.kind === 'tool').length;
  // A single call already takes one row — a summary would not shorten anything; thoughts without calls are not shown.
  if (toolCount <= 1) return { header: { kind: 'none' }, visible: items.map((item) => item.kind === 'tool') };
  return { header: summaryHeader(items, expanded), visible: items.map((item) => expanded || isRunning(item)) };
}

/**
 * A running call stays visible even in a collapsed series: it shows what the agent is doing right now.
 * @param {ActivityItem} item
 */
function isRunning(item) {
  return item.kind === 'tool' && item.state === 'pending';
}

/**
 * @param {readonly ActivityItem[]} items
 * @param {boolean} expanded
 * @returns {SummaryHeader}
 */
function summaryHeader(items, expanded) {
  const tools = items.flatMap((item) => (item.kind === 'tool' ? [item] : []));
  const thoughts = items.length - tools.length;
  const parts = familyNouns.flatMap(([family, noun]) => {
    const count = tools.filter((item) => item.family === family).length;
    return count === 0 ? [] : [countOf(count, noun)];
  });
  const errors = tools.filter((item) => item.state === 'error').length;
  return {
    kind: 'summary',
    parts: thoughts === 0 ? parts : [...parts, countOf(thoughts, 'thinking')],
    errors: errors === 0 ? undefined : countOf(errors, 'error'),
    expanded,
  };
}
