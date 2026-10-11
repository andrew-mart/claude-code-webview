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
 * What of a session's feed is kept to read offline: its latest entries, how many came before them, and when its last
 * prompt or answer was written — compared with the session list, it tells a copy that misses newer messages.
 * @param {{ entries: readonly unknown[], earlier: number }} feed — the entries as the server sent them
 * @param {number} max — how many entries to keep
 * @returns {{ entries: unknown[], earlier: number, lastActivity: number | undefined }}
 */
export function feedToKeep(feed, max) {
  const dropped = Math.max(feed.entries.length - max, 0);
  const entries = feed.entries.slice(dropped);
  const written = entries.flatMap((entry) => {
    const stamp = isRecord(entry) && (entry.type === 'user' || entry.type === 'assistant') ? text(entry.timestamp) : undefined;
    const time = stamp === undefined ? Number.NaN : Date.parse(stamp);
    return Number.isNaN(time) ? [] : [time];
  });
  return { entries, earlier: feed.earlier + dropped, lastActivity: written.length === 0 ? undefined : Math.max(...written) };
}

/** How many of a session's latest entries are kept to read offline. */
export const keptEntries = 3000;
