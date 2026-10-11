// @ts-check
// Which sessions the sidebar lists.

/**
 * SDK sessions (a program drives Claude Code: claude -p, the Agent SDK) are hidden unless shown;
 * the search matches the title, the folder or the herdr workspace, ignoring case.
 * @template {{ id: string, title: string | undefined, cwd: string | undefined, kind: 'interactive' | 'sdk' }} T
 * @param {readonly T[]} sessions
 * @param {{ sdk: 'hidden' | 'shown', search: string, workspaces: ReadonlyMap<string, string> }} options — workspaces:
 *   the herdr workspace of each session, by its id; empty without herdr
 * @returns {T[]}
 */
export function listedSessions(sessions, { sdk, search, workspaces }) {
  const wanted = search.trim().toLowerCase();
  return sessions.filter(
    (session) =>
      (sdk === 'shown' || session.kind !== 'sdk') &&
      (wanted === '' || `${session.title ?? ''} ${session.cwd ?? ''} ${workspaces.get(session.id) ?? ''}`.toLowerCase().includes(wanted)),
  );
}

/**
 * The list the page knows, with the sessions that changed since: a changed one replaces its old copy, a new one
 * joins; the latest activity comes first.
 * @template {{ id: string, activeAt: number }} T
 * @param {readonly T[]} known
 * @param {readonly T[]} changed
 * @returns {T[]}
 */
export function mergeSessions(known, changed) {
  const fresh = new Set(changed.map((session) => session.id));
  return [...changed, ...known.filter((session) => !fresh.has(session.id))].sort((a, b) => b.activeAt - a.activeAt);
}

/**
 * The listed sessions by herdr workspace. The list keeps its order — latest activity first — inside each group, and
 * each workspace stands where its latest session does; the sessions with no workspace — most of the old ones — make one
 * group after them all.
 * @template {{ id: string }} T
 * @param {readonly T[]} listed
 * @param {ReadonlyMap<string, string>} workspaces — the workspace of each session, by its id
 * @returns {{ workspace: string | undefined, sessions: T[] }[]}
 */
export function groupedSessions(listed, workspaces) {
  /** @type {Map<string | undefined, T[]>} */
  const groups = new Map();
  for (const session of listed) {
    const workspace = workspaces.get(session.id);
    const group = groups.get(workspace);
    if (group === undefined) groups.set(workspace, [session]);
    else group.push(session);
  }
  const rest = groups.get(undefined);
  groups.delete(undefined);
  return [...groups, ...(rest === undefined ? [] : [/** @type {const} */ ([undefined, rest])])].map(([workspace, sessions]) => ({ workspace, sessions }));
}
