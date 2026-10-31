// @ts-check
// What herdr shows, as the page gets it from /api/herdr (server/herdr-view.js): workspaces, their tabs, the panes in
// them — and in a pane with Claude Code, its session.
import { paneLamp } from './lamps.js';
import { isRecord, text } from './narrow.js';

/**
 * @typedef {'idle' | 'working' | 'blocked' | 'done' | 'unknown'} AgentStatus
 * @typedef {{ cols: number, rows: number }} PaneSize
 * @typedef {{ id: string, agent: string | undefined, status: AgentStatus, title: string | undefined, session: string | undefined, size: PaneSize | undefined, activity: number | undefined, hidden?: true, kept?: true }} HerdrPane
 *   agent: the coding agent herdr recognized there (claude, codex, …); session: the Claude Code session it runs;
 *   size: its terminal's, in columns and rows; activity: when its agent changed state last, in herdr's count — the
 *   larger, the more recent; hidden: its user hid it from the sidebar's list while idle, its agent not changed state
 *   since; kept: kept lit to come back to (lamps.js: keptLit), the page's own mark — herdr has none
 * @typedef {{ id: string, number: number, label: string, status: AgentStatus, panes: readonly HerdrPane[] }} HerdrTab
 * @typedef {{ id: string, number: number, label: string, icon?: string | undefined, status: AgentStatus, activeTab: string | undefined, tabs: readonly HerdrTab[] }} HerdrWorkspace
 *   icon: the emoji it is marked with (server/workspace-icons.js)
 * @typedef {{ herdr: boolean, claudeGpt?: true, restartEnv?: readonly string[], workspaces: readonly HerdrWorkspace[] }} HerdrLayout — herdr: whether it answers;
 *   restartEnv: the variables a session restarted from the page starts with, each NAME=VALUE, none when there are none
 * @typedef {{ ok: true, target: string } | { ok: false, error: 'failed' }} NewTab — a tab opened from the page; target: its page address
 * @typedef {'lamps' | 'activity'} SessionOrder — the sessions with their lamp lit first, or by the latest change alone
 * @typedef {'shell' | 'claude' | 'claude-gpt' | 'codex'} TabStart — the shell, ordinary Claude Code, Claude Code through GPT, or Codex
 * @typedef {'refuse' | 'create'} MissingFolder — what a new workspace does of a folder that is not there: opens nothing,
 *   or makes it first
 * @typedef {{ ok: true, target: string } | { ok: false, error: 'empty' | 'no-folder' | 'not-created' | 'failed' }} NewWorkspace — a
 *   workspace opened from the page; target: its first pane's page address; no-folder: the folder is not there;
 *   not-created: it could not be made
 * @typedef {{ ok: true } | { ok: false, error: 'empty' | 'failed' }} TabChange — a tab renamed or closed from the page; empty: a name of
 *   nothing but spaces; failed: herdr did not do it
 * @typedef {{ kind: 'session', id: string } | { kind: 'pane', id: string }} Opened — what the page shows: a session's
 *   feed, or a pane's terminal
 */

/**
 * The page address a tab opens: the feed of its Claude Code session, or else the terminal of its pane — a shell, nvim,
 * another agent. A tab split into panes opens the one with a session, else its first pane.
 * @param {HerdrTab} tab
 * @returns {string | undefined} — none for a tab without panes
 */
export function tabTarget(tab) {
  const session = tab.panes.find((pane) => pane.session !== undefined)?.session;
  if (session !== undefined) return `#/${session}`;
  const [first] = tab.panes;
  return first === undefined ? undefined : `#/pane/${first.id}`;
}

/**
 * The pane of a tab whose agent the tab stands for — its lamp kept lit from the tab: the one with a session, as the tab
 * opens it, else the first with an agent.
 * @param {HerdrTab} tab
 * @returns {HerdrPane | undefined} — none for a tab with no agent in it, a terminal
 */
export function agentPaneOf(tab) {
  return tab.panes.find((pane) => pane.agent !== undefined && pane.session !== undefined) ?? tab.panes.find((pane) => pane.agent !== undefined);
}

/**
 * The session Claude Code started in a pane since the page opened its terminal: the page goes to it.
 * @param {HerdrLayout} layout
 * @param {string} paneId
 * @param {string | undefined} sessionWhenOpened — the pane's session when the page opened its terminal
 * @returns {string | undefined}
 */
export function paneSession(layout, paneId, sessionWhenOpened) {
  const pane = panesOf(layout).find((known) => known.id === paneId);
  return pane?.session === sessionWhenOpened ? undefined : pane?.session;
}

/**
 * The session a session's pane went on with — /clear, /new or /resume typed in its tab: the one in the pane it was in
 * before, while it is in none now.
 * @param {HerdrLayout} before — what herdr showed last time
 * @param {HerdrLayout} after — what it shows now
 * @param {string} sessionId
 * @returns {string | undefined}
 */
export function successorIn(before, after, sessionId) {
  const was = panesOf(before).find((pane) => pane.session === sessionId);
  const now = panesOf(after);
  if (was === undefined || now.some((pane) => pane.session === sessionId)) return undefined;
  return now.find((pane) => pane.id === was.id)?.session;
}

/**
 * @param {HerdrLayout} layout
 * @returns {HerdrPane[]} — of every tab of every workspace
 */
function panesOf(layout) {
  return layout.workspaces.flatMap((workspace) => workspace.tabs.flatMap((tab) => tab.panes));
}

/**
 * The workspace and tab of what the page shows, if herdr has it in a pane.
 * @param {HerdrLayout} layout
 * @param {Opened} opened
 * @returns {{ workspace: HerdrWorkspace, tab: HerdrTab } | undefined}
 */
export function placeOf(layout, opened) {
  for (const workspace of layout.workspaces) {
    for (const tab of workspace.tabs) {
      if (tab.panes.some((pane) => (opened.kind === 'session' ? pane.session === opened.id : pane.id === opened.id))) return { workspace, tab };
    }
  }
  return undefined;
}

/**
 * The workspaces and tabs the search finds, ignoring case: a workspace whose name matches keeps all its tabs, another one
 * only the tabs whose name or terminal title match.
 * @param {readonly HerdrWorkspace[]} workspaces
 * @param {string} search
 * @returns {HerdrWorkspace[]}
 */
export function searchLayout(workspaces, search) {
  const wanted = search.trim().toLowerCase();
  if (wanted === '') return [...workspaces];
  const matches = (/** @type {string | undefined} */ value) => value !== undefined && value.toLowerCase().includes(wanted);
  return workspaces.flatMap((workspace) => {
    if (matches(workspace.label)) return [workspace];
    const tabs = workspace.tabs.filter((tab) => matches(tab.label) || tab.panes.some((pane) => matches(pane.title)));
    return tabs.length === 0 ? [] : [{ ...workspace, tabs }];
  });
}

/**
 * What the address opens: #/<session id> — the session's feed, #/pane/<herdr pane id> — the pane's terminal.
 * @param {string} hash — location.hash
 * @returns {Opened | undefined} — none: the session list
 */
export function openedAt(hash) {
  const session = /^#\/([0-9a-f-]{36})$/i.exec(hash)?.[1];
  if (session !== undefined) return { kind: 'session', id: session };
  const pane = /^#\/pane\/([\w:-]+)$/.exec(hash)?.[1];
  return pane === undefined ? undefined : { kind: 'pane', id: pane };
}

/**
 * @param {unknown} json — the /api/herdr reply
 * @returns {HerdrLayout} — what does not fit the contract is left out
 */
export function parseHerdrLayout(json) {
  if (!isRecord(json) || json.herdr !== true || !Array.isArray(json.workspaces)) return { herdr: false, workspaces: [] };
  const restartEnv = Array.isArray(json.restartEnv) ? json.restartEnv.filter((variable) => typeof variable === 'string') : [];
  return { herdr: true, ...(json.claudeGpt === true ? { claudeGpt: /** @type {const} */ (true) } : {}), ...(restartEnv.length === 0 ? {} : { restartEnv }), workspaces: json.workspaces.filter(isRecord).flatMap(parseWorkspace) };
}

const statuses = /** @type {const} */ (['idle', 'working', 'blocked', 'done', 'unknown']);

/**
 * @param {Record<string, unknown>} raw
 * @returns {HerdrWorkspace[]}
 */
function parseWorkspace(raw) {
  const id = text(raw.id);
  const label = text(raw.label);
  const status = statuses.find((known) => known === raw.status);
  if (id === undefined || label === undefined || typeof raw.number !== 'number' || status === undefined || !Array.isArray(raw.tabs)) return [];
  const icon = text(raw.icon);
  return [{ id, number: raw.number, label, ...(icon === undefined ? {} : { icon }), status, activeTab: text(raw.activeTab), tabs: raw.tabs.filter(isRecord).flatMap(parseTab) }];
}

/**
 * @param {Record<string, unknown>} raw
 * @returns {HerdrTab[]}
 */
function parseTab(raw) {
  const id = text(raw.id);
  const label = text(raw.label);
  const status = statuses.find((known) => known === raw.status);
  if (id === undefined || label === undefined || typeof raw.number !== 'number' || status === undefined || !Array.isArray(raw.panes)) return [];
  return [{ id, number: raw.number, label, status, panes: raw.panes.filter(isRecord).flatMap(parsePane) }];
}

/**
 * @param {Record<string, unknown>} raw
 * @returns {HerdrPane[]}
 */
function parsePane(raw) {
  const id = text(raw.id);
  const status = statuses.find((known) => known === raw.status);
  if (id === undefined || status === undefined) return [];
  const size = isRecord(raw.size) && Number.isInteger(raw.size.cols) && Number.isInteger(raw.size.rows) ? { cols: Number(raw.size.cols), rows: Number(raw.size.rows) } : undefined;
  const activity = typeof raw.activity === 'number' ? raw.activity : undefined;
  return [{ id, agent: text(raw.agent), status, title: text(raw.title), session: text(raw.session), size, activity, ...(raw.hidden === true ? { hidden: /** @type {const} */ (true) } : {}) }];
}

/**
 * Every session herdr runs — a pane with a coding agent, in any workspace — in the order asked: those with their lamp
 * lit first — at work, asking, done with an answer not seen, kept to come back to (lamps.js) — then the idle ones,
 * each part as herdr lists its agents, the one whose agent changed state last first; or by that alone. The search
 * keeps those whose workspace, tab or terminal title match, ignoring case.
 * @param {readonly HerdrWorkspace[]} workspaces
 * @param {string} search — the search box text
 * @param {import('./lamps.js').SeenPanes} seen — the answers seen, their lamps out
 * @param {SessionOrder} order
 * @returns {{ workspace: HerdrWorkspace, tab: HerdrTab, pane: HerdrPane }[]}
 */
export function sessionsByActivity(workspaces, search, seen, order) {
  const wanted = search.trim().toLowerCase();
  const sessions = workspaces.flatMap((workspace) =>
    workspace.tabs.flatMap((tab) => tab.panes.filter((pane) => pane.agent !== undefined).map((pane) => ({ workspace, tab, pane }))),
  );
  const found =
    wanted === '' ? sessions : sessions.filter(({ workspace, tab, pane }) => [workspace.label, tab.label, pane.title].some((value) => value !== undefined && value.toLowerCase().includes(wanted)));
  const lit = (/** @type {HerdrPane} */ pane) => {
    const lamp = paneLamp(pane, seen);
    return lamp !== 'idle' && lamp !== 'unknown';
  };
  /** @param {HerdrPane} one @param {HerdrPane} other */
  const lampsFirst = (one, other) => (order === 'lamps' ? Number(lit(other)) - Number(lit(one)) : 0);
  // the panes herdr has not seen an agent change in last, in herdr's own order
  return found.sort((a, b) => lampsFirst(a.pane, b.pane) || (b.pane.activity ?? -1) - (a.pane.activity ?? -1));
}

/**
 * Reply of /api/tab/rename and /api/tab/close; any other — or none, the viewer out of reach — is a change not made.
 * @param {unknown} json
 * @returns {TabChange}
 */
export function parseTabChange(json) {
  if (isRecord(json) && json.ok === true) return { ok: true };
  return { ok: false, error: isRecord(json) && json.error === 'empty' ? 'empty' : 'failed' };
}

/**
 * Reply of /api/tab/new; any other — or none, the viewer out of reach — is a tab not opened.
 * @param {unknown} json
 * @returns {NewTab}
 */
export function parseNewTab(json) {
  const target = isRecord(json) && json.ok === true ? text(json.target) : undefined;
  return target === undefined ? { ok: false, error: 'failed' } : { ok: true, target };
}

/**
 * The /api/workspace/new reply.
 * @param {unknown} json
 * @returns {NewWorkspace}
 */
export function parseNewWorkspace(json) {
  const target = isRecord(json) && json.ok === true ? text(json.target) : undefined;
  if (target !== undefined) return { ok: true, target };
  const error = isRecord(json) ? json.error : undefined;
  return { ok: false, error: error === 'empty' || error === 'no-folder' || error === 'not-created' ? error : 'failed' };
}
