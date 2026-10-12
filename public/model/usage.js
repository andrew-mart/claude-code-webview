// @ts-check
// The account's usage of Claude — the 5-hour window and the week — as the page shows it, the way Claude Code's
// statusline does: how much of each is used; on hover, when each resets and how old the reading is.
import { isRecord } from './narrow.js';

/**
 * @typedef {{ percent: number, resetsAt: number | undefined }} UsageWindow — percent: how much is used; resetsAt: ms
 * @typedef {{ fiveHour: UsageWindow | undefined, sevenDay: UsageWindow | undefined, readAt: number }} Usage — readAt:
 *   when Claude Code read it, ms: it reads it while it runs
 */

/** From this share of a window on its line is warm, then hot. */
const warmPercent = 70;
const hotPercent = 90;

/**
 * The viewer's /api/usage reply; any other shape — or nothing read yet — is no usage.
 * @param {unknown} json
 * @returns {Usage | undefined}
 */
export function parseUsage(json) {
  if (!isRecord(json) || typeof json.readAt !== 'number') return undefined;
  const fiveHour = windowOf(json.fiveHour);
  const sevenDay = windowOf(json.sevenDay);
  if (fiveHour === 'unreadable' || sevenDay === 'unreadable') return undefined;
  return { fiveHour, sevenDay, readAt: json.readAt };
}

/**
 * @param {unknown} json
 * @returns {UsageWindow | undefined | 'unreadable'}
 */
function windowOf(json) {
  if (json === undefined) return undefined;
  if (!isRecord(json) || typeof json.percent !== 'number' || (json.resetsAt !== undefined && typeof json.resetsAt !== 'number')) return 'unreadable';
  return { percent: json.percent, resetsAt: typeof json.resetsAt === 'number' ? json.resetsAt : undefined };
}

/**
 * @param {Usage} usage
 * @param {number} now
 * @returns {{ label: string, level: 'calm' | 'warm' | 'hot', title: string }} — level: of the fuller window
 */
export function usageText(usage, now) {
  const windows = /** @type {const} */ ([
    ['5h', '5-hour window', usage.fiveHour],
    ['7d', 'Week', usage.sevenDay],
  ]);
  // a window that reset after the reading: what it says is no longer so
  const shown = windows.map(([short, name, window]) => ({ short, name, window: window === undefined || (window.resetsAt !== undefined && window.resetsAt <= now) ? undefined : window }));
  const fullest = Math.max(0, ...shown.flatMap(({ window }) => (window === undefined ? [] : [window.percent])));
  return {
    label: shown.map(({ short, window }) => `${short} ${window === undefined ? '—' : `${Math.round(window.percent)}%`}`).join(' · '),
    level: fullest >= hotPercent ? 'hot' : fullest >= warmPercent ? 'warm' : 'calm',
    title: [
      ...shown.map(({ name, window }) =>
        window === undefined ? `${name}: reset since the reading` : `${name}: ${Math.round(window.percent)}% used${window.resetsAt === undefined ? '' : `, resets in ${span(window.resetsAt - now)}`}`,
      ),
      `Read ${span(now - usage.readAt)} ago`,
    ].join('\n'),
  };
}

/**
 * A stretch of time in its two largest units: 2d 15h, 1h 38m, 3m.
 * @param {number} ms
 */
function span(ms) {
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  const days = Math.floor(minutes / (24 * 60));
  const hours = Math.floor((minutes % (24 * 60)) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  return `${minutes}m`;
}
