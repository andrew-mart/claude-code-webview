// @ts-check
// Which sessions the sidebar lists.

/**
 * SDK sessions (a program drives Claude Code: claude -p, the Agent SDK) are hidden unless shown;
 * the search matches the title or the folder, ignoring case.
 * @template {{ title: string | undefined, cwd: string | undefined, kind: 'interactive' | 'sdk' }} T
 * @param {readonly T[]} sessions
 * @param {{ sdk: 'hidden' | 'shown', search: string }} options
 * @returns {T[]}
 */
export function listedSessions(sessions, { sdk, search }) {
  const wanted = search.trim().toLowerCase();
  return sessions.filter(
    (session) => (sdk === 'shown' || session.kind !== 'sdk') && (wanted === '' || `${session.title ?? ''} ${session.cwd ?? ''}`.toLowerCase().includes(wanted)),
  );
}

/**
 * The list the page knows, with the sessions that changed since: a changed one replaces its old copy, a new one
 * joins; the latest come first.
 * @template {{ id: string, modifiedAt: number }} T
 * @param {readonly T[]} known
 * @param {readonly T[]} changed
 * @returns {T[]}
 */
export function mergeSessions(known, changed) {
  const fresh = new Set(changed.map((session) => session.id));
  return [...changed, ...known.filter((session) => !fresh.has(session.id))].sort((a, b) => b.modifiedAt - a.modifiedAt);
}
