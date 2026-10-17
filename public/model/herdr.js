// @ts-check
// What herdr shows, as the page gets it from /api/herdr (server/herdr-view.js): workspaces, their tabs, the panes in
// them — and in a pane with Claude Code, its session.
import { isRecord, text } from './narrow.js';

/**
 * @typedef {'idle' | 'working' | 'blocked' | 'done' | 'unknown'} AgentStatus
 * @typedef {{ cols: number, rows: number }} PaneSize
 * @typedef {{ id: string, agent: string | undefined, status: AgentStatus, title: string | undefined, session: string | undefined, size: PaneSize | undefined, activity: number | undefined, hidden?: true }} HerdrPane
 *   agent: the coding agent herdr recognized there (claude, codex, …); session: the Claude Code session it runs;
 *   size: its terminal's, in columns and rows; activity: when its agent changed state last, in herdr's count — the
 *   larger, the more recent; hidden: its user hid it from the sidebar's list while idle, its agent not changed state
 *   since
 * @typedef {{ id: string, number: number, label: string, status: AgentStatus, panes: readonly HerdrPane[] }} HerdrTab
 * @typedef {{ id: string, number: number, label: string, icon?: string | undefined, status: AgentStatus, activeTab: string | undefined, tabs: readonly HerdrTab[] }} HerdrWorkspace
 *   icon: the emoji it is marked with (server/workspace-icons.js)
 * @typedef {{ herdr: boolean, claudeGpt?: true, workspaces: readonly HerdrWorkspace[] }} HerdrLayout — herdr: whether it answers
 * @typedef {{ ok: true, target: string } | { ok: false, error: 'failed' }} NewTab — a tab opened from the page; target: its page address
 * @typedef {'shell' | 'claude' | 'claude-gpt' | 'codex'} TabStart — the shell, ordinary Claude Code, Claude Code through GPT, or Codex
 * @typedef {{ ok: true, target: string } | { ok: false, error: 'empty' | 'no-folder' | 'failed' }} NewWorkspace — a
 *   workspace opened from the page; target: its first pane's page address; no-folder: the folder is not there
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
 * The session Claude Code started in a pane since the page opened its terminal: the page goes to it.
 * @param {HerdrLayout} layout
 * @param {string} paneId
 * @param {string | undefined} sessionWhenOpened — the pane's session when the page opened its terminal
 * @returns {string | undefined}
 */
export function paneSession(layout, paneId, sessionWhenOpened) {
  const pane = layout.workspaces.flatMap((workspace) => workspace.tabs.flatMap((tab) => tab.panes)).find((known) => known.id === paneId);
  return pane?.session === sessionWhenOpened ? undefined : pane?.session;
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
  return { herdr: true, ...(json.claudeGpt === true ? { claudeGpt: /** @type {const} */ (true) } : {}), workspaces: json.workspaces.filter(isRecord).flatMap(parseWorkspace) };
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
 * Every session herdr runs — a pane with a coding agent, in any workspace — as herdr lists its agents: the one whose
 * agent changed state last first. The search keeps those whose workspace, tab or terminal title match, ignoring case.
 * @param {readonly HerdrWorkspace[]} workspaces
 * @param {string} search — the search box text
 * @returns {{ workspace: HerdrWorkspace, tab: HerdrTab, pane: HerdrPane }[]}
 */
export function sessionsByActivity(workspaces, search) {
  const wanted = search.trim().toLowerCase();
  const sessions = workspaces.flatMap((workspace) =>
    workspace.tabs.flatMap((tab) => tab.panes.filter((pane) => pane.agent !== undefined).map((pane) => ({ workspace, tab, pane }))),
  );
  const found =
    wanted === '' ? sessions : sessions.filter(({ workspace, tab, pane }) => [workspace.label, tab.label, pane.title].some((value) => value !== undefined && value.toLowerCase().includes(wanted)));
  // the panes herdr has not seen an agent change in last, in herdr's own order
  return found.sort((a, b) => (b.pane.activity ?? -1) - (a.pane.activity ?? -1));
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
  return { ok: false, error: error === 'empty' || error === 'no-folder' ? error : 'failed' };
}
