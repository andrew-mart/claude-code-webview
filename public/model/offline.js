// @ts-check
// Reading offline: which sessions the page keeps a copy of, and how much of each.
import { isRecord, text } from './narrow.js';

/**
 * The sessions to fetch a copy of while the viewer is reachable: the latest ones worked on in a terminal (not ones a
 * program drives), within a recent stretch of time, whose saved copy misses their latest messages or that have none.
 * @param {readonly { id: string, kind: 'interactive' | 'sdk', activeAt: number }[]} sessions
 * @param {ReadonlyMap<string, { lastActivity: number | undefined }>} saved — the copies the page has, by session
 * @param {{ now: number, limit: number, withinMs: number }} options — limit: how many of the latest sessions to keep
 * @returns {string[]}
 */
export function sessionsToSave(sessions, saved, { now, limit, withinMs }) {
  return sessions
    .filter((session) => session.kind === 'interactive' && now - session.activeAt <= withinMs)
    .sort((a, b) => b.activeAt - a.activeAt)
    .slice(0, limit)
    .filter((session) => {
      const copy = saved.get(session.id)?.lastActivity;
      return copy === undefined || copy < session.activeAt;
    })
    .map((session) => session.id);
}

/**
 * When the last prompt or answer among these entries was written — compared with the session list, it tells a copy kept
 * that misses newer messages; none among them, none.
 * @param {readonly unknown[]} entries
 * @returns {number | undefined}
 */
export function lastActivityOf(entries) {
  const written = entries.flatMap((entry) => {
    const stamp = isRecord(entry) && (entry.type === 'user' || entry.type === 'assistant') ? text(entry.timestamp) : undefined;
    const time = stamp === undefined ? Number.NaN : Date.parse(stamp);
    return Number.isNaN(time) ? [] : [time];
  });
  return written.length === 0 ? undefined : Math.max(...written);
}

/** How many of a session's latest entries are kept to read offline. */
export const keptEntries = 3000;
