// @ts-check
// The account's usage of Claude — the 5-hour window and the week — as the page shows it, the way Claude Code's
// statusline does: how much of each is used; on hover, how much of each has gone by, when each resets and how old the
// reading is.
import { isRecord } from './narrow.js';

/**
 * @typedef {{ percent: number, resetsAt: number | undefined }} UsageWindow — percent: how much is used; resetsAt: ms
 * @typedef {{ fiveHour: UsageWindow | undefined, sevenDay: UsageWindow | undefined, readAt: number }} Usage — readAt:
 *   when Claude Code read it, ms: it reads it while it runs
 */

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
 * @typedef {{ from: number, to: number, kind: 'spare' | 'over' }} UsageGap — the stretch between how much is used and how
 *   much of the window has gone by, percent: spare while the use lags behind the time, overspent once it runs ahead
 * @typedef {{ name: '5h' | '7d', percent: number | undefined, elapsed: number | undefined, gap: UsageGap | undefined }} UsageMeter —
 *   percent: how much is used, none if the window reset after the reading; elapsed: how much of the window has gone
 *   by, percent; gap: none while either is not known
 */

/** The windows: their names, on the meter and on hover — the window, and the whole of it — and their length. */
const windowsOf = /** @type {const} */ ([
  { name: '5h', said: '5-hour window', whole: 'the 5 hours', ms: 5 * 3_600_000, pick: (/** @type {Usage} */ usage) => usage.fiveHour },
  { name: '7d', said: 'Week', whole: 'the week', ms: 7 * 24 * 3_600_000, pick: (/** @type {Usage} */ usage) => usage.sevenDay },
]);

/**
 * @param {Usage} usage
 * @param {number} now
 * @returns {{ meters: UsageMeter[], title: string }}
 */
export function usageView(usage, now) {
  // a window that reset after the reading: what it says is no longer so
  const shown = windowsOf.map((known) => {
    const read = known.pick(usage);
    const window = read === undefined || (read.resetsAt !== undefined && read.resetsAt <= now) ? undefined : read;
    // how much of the window has gone by, percent
    const elapsed = window?.resetsAt === undefined ? undefined : Math.round(Math.min(100, Math.max(0, 100 - ((window.resetsAt - now) / known.ms) * 100)));
    return { ...known, window, elapsed };
  });
  return {
    meters: shown.map(({ name, window, elapsed }) => ({ name, percent: window?.percent, elapsed, gap: window === undefined || elapsed === undefined ? undefined : gapOf(Math.min(100, window.percent), elapsed) })),
    title: [
      ...shown.map(({ said, whole, window, elapsed }) =>
        window === undefined
          ? `${said}: reset since the reading`
          : `${said}: ${Math.round(window.percent)}% used${window.resetsAt === undefined || elapsed === undefined ? '' : `, ${elapsed}% of ${whole} gone, resets in ${span(window.resetsAt - now)}`}`,
      ),
      `Read ${span(now - usage.readAt)} ago`,
    ].join('\n'),
  };
}

/**
 * @param {number} used — percent
 * @param {number} elapsed — percent
 * @returns {UsageGap}
 */
function gapOf(used, elapsed) {
  return used <= elapsed ? { from: used, to: elapsed, kind: 'spare' } : { from: elapsed, to: used, kind: 'over' };
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
