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
