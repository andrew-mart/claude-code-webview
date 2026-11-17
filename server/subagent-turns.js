// @ts-check
// An agent's turn ended while the subagents it set going work on is no turn finished: told a subagent's report, the
// agent says it waits for the others and stops — herdr takes it for done, the page would light its lamp green and
// chime. It is shown at work until its subagents are done; a command left running in the background — a server — keeps
// it at work no longer than its turn.

/**
 * @typedef {import('../public/model/herdr.js').AgentStatus} AgentStatus
 */

/**
 * herdr's layout with the agents at rest whose subagents work on shown at work — their panes, their tabs, their
 * workspaces; one asking is shown asking.
 * @param {import('../public/model/herdr.js').HerdrLayout} layout
 * @param {ReadonlySet<string>} working — the sessions whose subagents work on
 * @returns {import('../public/model/herdr.js').HerdrLayout}
 */
export function withSubagentsAtWork(layout, working) {
  return {
    ...layout,
    workspaces: layout.workspaces.map((workspace) => {
      const tabs = workspace.tabs.map((tab) => {
        const panes = tab.panes.map((pane) => ({ ...pane, status: atWork(pane.status, pane.session !== undefined && working.has(pane.session)) }));
        return { ...tab, status: atWork(tab.status, panes.some((pane) => waitsOn(pane, working))), panes };
      });
      return { ...workspace, status: atWork(workspace.status, tabs.some((tab) => tab.panes.some((pane) => waitsOn(pane, working)))), tabs };
    }),
  };
}

/**
 * @param {AgentStatus} status — as herdr tells it
 * @param {boolean} waits — subagents work on
 * @returns {AgentStatus}
 */
function atWork(status, waits) {
  return waits && (status === 'done' || status === 'idle') ? 'working' : status;
}

/**
 * @param {import('../public/model/herdr.js').HerdrPane} pane
 * @param {ReadonlySet<string>} working
 */
function waitsOn(pane, working) {
  return pane.session !== undefined && working.has(pane.session);
}

/** How long a subagent may write nothing and still be taken for at work: a long command of its runs that quiet. */
const quietMs = 15 * 60_000;

/**
 * Whether a session's subagents work on: one its transcript's tasks take for running (tasks.js) whose own transcript
 * wrote lately. One gone quiet, or whose transcript is nowhere, is not: the tasks may take for running a subagent left
 * in a branch rewound, or one whose report never came — a restart. The session's transcript is read again only once
 * it has changed; its subagents' are looked at each time, a look at a file each.
 * @param {{ find: (session: string) => Promise<string | undefined>, stampOf: (path: string) => Promise<string | undefined>, tasksOf: (path: string) => Promise<readonly { kind: 'agent' | 'shell', state: string, taskId: string | undefined }[]>, activeAt: (session: string, taskId: string) => Promise<number | undefined>, now: () => number }} deps
 *   — find: the session's transcript; stampOf: its time and size now, none once it is gone; tasksOf: its tasks;
 *   activeAt: when a subagent's own transcript wrote last, ms — none where it is not found
 * @returns {(session: string) => Promise<boolean>}
 */
export function createSubagentWatch({ find, stampOf, tasksOf, activeAt, now }) {
  /** The subagents each transcript took for running last, by its path, and the stamp it had then. */
  /** @type {Map<string, { stamp: string, running: readonly string[] }>} */
  const told = new Map();
  return async (session) => {
    const path = await find(session);
    const stamp = path === undefined ? undefined : await stampOf(path);
    if (path === undefined || stamp === undefined) return false;
    const known = told.get(path);
    const running = known?.stamp === stamp ? known.running : (await tasksOf(path)).flatMap((task) => (task.kind === 'agent' && task.state === 'running' && task.taskId !== undefined ? [task.taskId] : []));
    told.set(path, { stamp, running });
    const wrote = await Promise.all(running.map((taskId) => activeAt(session, taskId)));
    return wrote.some((at) => at !== undefined && now() - at < quietMs);
  };
}
