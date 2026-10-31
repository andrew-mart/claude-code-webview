// @ts-check
// Numbers, sizes and durations for labels in the feed and the panels.

/** Noun forms for exactly one and for any other count. */
const nouns = /** @type {const} */ ({
  line: ['line', 'lines'],
  file: ['file', 'files'],
  match: ['match', 'matches'],
  action: ['action', 'actions'],
  earlierAction: ['earlier action', 'earlier actions'],
  command: ['command', 'commands'],
  reading: ['read', 'reads'],
  edit: ['edit', 'edits'],
  search: ['search', 'searches'],
  webRequest: ['web request', 'web requests'],
  subagent: ['subagent', 'subagents'],
  skill: ['skill', 'skills'],
  question: ['question', 'questions'],
  mcpCall: ['MCP call', 'MCP calls'],
  thinking: ['thought', 'thoughts'],
  error: ['error', 'errors'],
});

/**
 * @typedef {keyof typeof nouns} Noun
 */

/**
 * @param {number} n
 * @param {Noun} noun
 * @returns {string}
 */
export function countOf(n, noun) {
  const [one, many] = nouns[noun];
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * @param {number} ms
 * @returns {string}
 */
export function formatDuration(ms) {
  const seconds = Math.round(ms / 1000);
  if (seconds < 1) return '<1s';
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

/**
 * @param {number} n
 * @returns {string}
 */
export function formatTokens(n) {
  // 999,600 rounds to a thousand thousands: that is already a million
  if (n >= 999_500) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
}

/**
 * A file's size, as a transfer tells it.
 * @param {number} bytes
 * @returns {string}
 */
export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  // 1023.6 KB rounds to 1024 KB: that is already a megabyte
  if (bytes < 1023.5 * 1024) return `${Math.round(bytes / 1024)} KB`;
  const [size, unit] = bytes < 1023.95 * 1024 ** 2 ? [bytes / 1024 ** 2, 'MB'] : [bytes / 1024 ** 3, 'GB'];
  return `${size.toFixed(1).replace(/\.0$/, '')} ${unit}`;
}

/**
 * @param {number} then — ms
 * @param {number} now — ms
 * @returns {string}
 */
export function formatAgo(then, now) {
  const minutes = Math.floor((now - then) / 60_000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)}h`;
  const date = new Date(then);
  const monthDay = `${monthNames[date.getMonth()] ?? ''} ${date.getDate()}`;
  return date.getFullYear() === new Date(now).getFullYear() ? monthDay : `${monthDay}, ${date.getFullYear()}`;
}

/** Fixed month names, so the label does not depend on the browser locale. */
const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
