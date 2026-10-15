// @ts-check
// The lamp beside an agent in herdr's list: working, waiting for its user, ready — it finished, and its answer is not
// seen yet — or out. An answer is seen once its session, or its terminal, is opened in the page while the agent is
// done — on any device: the viewer keeps what each page saw; the agent finishing again — herdr counts its changes of
// state — lights the lamp again.

/**
 * @typedef {'working' | 'blocked' | 'ready' | 'idle' | 'unknown'} Lamp
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
  if (pane.status !== 'done') return pane.status;
  return seen.get(pane.id) === (pane.activity ?? uncounted) ? 'idle' : 'ready';
}

/**
 * A tab's or a workspace's lamp: ready while one of its finished agents' answers is not seen.
 * @param {import('./herdr.js').AgentStatus} status — herdr's, for the tab or the workspace
 * @param {readonly import('./herdr.js').HerdrPane[]} panes — its
 * @param {SeenPanes} seen
 * @returns {Lamp}
 */
export function groupLamp(status, panes, seen) {
  if (status !== 'done') return status;
  return panes.some((pane) => paneLamp(pane, seen) === 'ready') ? 'ready' : 'idle';
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
