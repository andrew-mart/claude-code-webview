// @ts-check
// What herdr shows, as the page gets it from /api/herdr (server/herdr-view.js): workspaces, their tabs, the panes in
// them — and in a pane with Claude Code, its session.
import { isRecord, text } from './narrow.js';

/**
 * @typedef {'idle' | 'working' | 'blocked' | 'done' | 'unknown'} AgentStatus
 * @typedef {{ cols: number, rows: number }} PaneSize
 * @typedef {{ id: string, agent: string | undefined, status: AgentStatus, title: string | undefined, session: string | undefined, size: PaneSize | undefined }} HerdrPane
 *   agent: the coding agent herdr recognized there (claude, codex, …); session: the Claude Code session it runs;
 *   size: its terminal's, in columns and rows
 * @typedef {{ id: string, number: number, label: string, status: AgentStatus, panes: readonly HerdrPane[] }} HerdrTab
 * @typedef {{ id: string, number: number, label: string, status: AgentStatus, activeTab: string | undefined, tabs: readonly HerdrTab[] }} HerdrWorkspace
 * @typedef {{ herdr: boolean, workspaces: readonly HerdrWorkspace[] }} HerdrLayout — herdr: whether it answers
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
  return { herdr: true, workspaces: json.workspaces.filter(isRecord).flatMap(parseWorkspace) };
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
  return [{ id, number: raw.number, label, status, activeTab: text(raw.activeTab), tabs: raw.tabs.filter(isRecord).flatMap(parseTab) }];
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
  return [{ id, agent: text(raw.agent), status, title: text(raw.title), session: text(raw.session), size }];
}
