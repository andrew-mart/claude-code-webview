// @ts-check
// The lamp beside an agent in herdr's list: working, waiting for its user, ready — it finished, and its answer is not
// seen yet — or out. An answer is seen once its session, or its terminal, is opened in the page while the agent is
// done — on any device: the viewer keeps what each page saw; the agent finishing again — herdr counts its changes of
// state — lights the lamp again. An agent its user keeps lit to come back to stays ready though seen, until the mark is
// taken off or the agent changes state (keptLit).

/**
 * @typedef {'working' | 'blocked' | 'ready' | 'kept' | 'idle' | 'unknown'} Lamp — kept: kept lit to come back to, its
 *   answer seen (keptLit)
 * @typedef {ReadonlyMap<string, number>} SeenPanes — the panes whose finished agent's answer was seen: herdr's count of
 *   its changes of state when it was, by the pane's id
 */

/** A pane herdr tells no count of: seen while it stays done. */
const uncounted = -1;

/**
 * @param {import('./herdr.js').HerdrPane} pane
 * @param {SeenPanes} seen
 * @returns {Lamp}
 */
export function paneLamp(pane, seen) {
  if (pane.status === 'done' && seen.get(pane.id) !== (pane.activity ?? uncounted)) return 'ready';
  if (pane.status !== 'done' && pane.status !== 'idle') return pane.status;
  return pane.kept === true ? 'kept' : 'idle';
}

/**
 * A tab's or a workspace's lamp: ready while one of its finished agents' answers is not seen, kept while one of its
 * agents is kept lit to come back to, unless one there works or waits.
 * @param {import('./herdr.js').AgentStatus} status — herdr's, for the tab or the workspace
 * @param {readonly import('./herdr.js').HerdrPane[]} panes — its
 * @param {SeenPanes} seen
 * @returns {Lamp}
 */
export function groupLamp(status, panes, seen) {
  if (status !== 'done' && status !== 'idle') return status;
  const lamps = panes.map((pane) => paneLamp(pane, seen));
  if (status === 'done' && lamps.includes('ready')) return 'ready';
  return lamps.includes('kept') ? 'kept' : 'idle';
}

/**
 * What is seen once the page shows what it opened: the opened session's or terminal's finished agent, beside what was
 * seen before — its count tells it from the agent's next answer.
 * @param {import('./herdr.js').HerdrLayout} layout
 * @param {import('./herdr.js').Opened | undefined} opened — none: the page shows no session or terminal
 * @param {SeenPanes} seen
 * @returns {SeenPanes}
 */
export function seeOpened(layout, opened, seen) {
  const panes = layout.workspaces.flatMap((workspace) => workspace.tabs.flatMap((tab) => tab.panes));
  const next = new Map(seen);
  for (const pane of panes) {
    const isOpen = opened !== undefined && (opened.kind === 'session' ? pane.session === opened.id : pane.id === opened.id);
    if (pane.status === 'done' && isOpen) next.set(pane.id, pane.activity ?? uncounted);
  }
  return next;
}

/**
 * The answers seen as the viewer keeps them (/api/seen): seen on any device, they count on every one. What cannot be
 * read is left out; a reply of another shape is nothing seen.
 * @param {unknown} json — { [pane]: herdr's count of its changes when its answer was seen }
 * @returns {SeenPanes}
 */
export function parseSeen(json) {
  if (json === null || typeof json !== 'object' || Array.isArray(json)) return new Map();
  return new Map(Object.entries(json).flatMap(([pane, count]) => (typeof count === 'number' ? [/** @type {const} */ ([pane, count])] : [])));
}

/**
 * @typedef {ReadonlyMap<string, number>} KeptPanes — the agents their user keeps lit to come back to: herdr's count of
 *   the agent's changes of state when it was marked, by its pane's id; the agent changing state again ends the mark
 */

/**
 * Whether an agent is kept lit now: marked, and not changed state since.
 * @param {import('./herdr.js').HerdrPane} pane
 * @param {KeptPanes} kept
 */
export function keptNow(pane, kept) {
  const marked = kept.get(pane.id);
  return marked !== undefined && marked === (pane.activity ?? uncounted);
}

/**
 * herdr's layout as the lamps show it: an agent kept lit to come back to is marked so — its lamp lit steadily, its tab's
 * and its workspace's too, once its answer is seen, in the page or in herdr (idle there). Nothing kept lit: as it is.
 * @param {import('./herdr.js').HerdrLayout} layout
 * @param {KeptPanes} kept
 * @returns {import('./herdr.js').HerdrLayout}
 */
export function keptLit(layout, kept) {
  const lit = new Set(layout.workspaces.flatMap((workspace) => workspace.tabs.flatMap((tab) => tab.panes.filter((pane) => keptNow(pane, kept)).map((pane) => pane.id))));
  if (lit.size === 0) return layout;
  /** @param {import('./herdr.js').HerdrTab} tab */
  const litTab = (tab) => (tab.panes.some((pane) => lit.has(pane.id)) ? { ...tab, panes: tab.panes.map((pane) => (lit.has(pane.id) ? { ...pane, kept: /** @type {const} */ (true) } : pane)) } : tab);
  return { ...layout, workspaces: layout.workspaces.map((workspace) => ({ ...workspace, tabs: workspace.tabs.map(litTab) })) };
}

/**
 * What a press on "come back later" does to an agent: marks it at its count now, or takes off the mark it has; a mark
 * it outlived counts as none.
 * @param {import('./herdr.js').HerdrPane} pane
 * @param {KeptPanes} kept
 * @returns {{ pane: string, count: number | undefined }} — count: the mark; none: taken off
 */
export function keepToggled(pane, kept) {
  return { pane: pane.id, count: keptNow(pane, kept) ? undefined : (pane.activity ?? uncounted) };
}

/**
 * The answers seen here and elsewhere together: of the same agent, the later count — an answer seen after the one
 * before.
 * @param {SeenPanes} one
 * @param {SeenPanes} other
 * @returns {SeenPanes}
 */
export function mergeSeen(one, other) {
  const merged = new Map(one);
  for (const [pane, count] of other) merged.set(pane, Math.max(count, merged.get(pane) ?? count));
  return merged;
}
