// @ts-check
// herdr as herdr itself lays it out: in the sidebar its workspaces, and under them every session of every workspace with
// its agent's status, the latest active first; above the open session or terminal, the tabs of its workspace to switch
// between.
import { placeOf, searchLayout, sessionsByActivity, tabTarget } from '../model/herdr.js';
import { h } from './dom.js';

/** @type {Readonly<Record<import('../model/herdr.js').AgentStatus, string>>} */
const statusNames = { working: 'Working', blocked: 'Waiting for you', done: 'Done', idle: 'Idle', unknown: 'No agent' };

/**
 * @param {import('../model/herdr.js').AgentStatus} status
 * @returns {HTMLElement}
 */
function statusDot(status) {
  // an attribute, not a class: .working is the feed's own "Working…" line
  return h('span', { className: 'herdr-status', title: statusNames[status], attrs: { 'data-status': status } });
}

/**
 * What runs in a tab, under its name: the session's title for Claude Code, else the agent or the terminal's title.
 * @param {import('../model/herdr.js').HerdrTab} tab
 * @returns {string}
 */
function tabContent(tab) {
  const pane = tab.panes.find((one) => one.session !== undefined) ?? tab.panes[0];
  if (pane === undefined) return '';
  const what = pane.agent === undefined || pane.agent === 'claude' ? undefined : pane.agent;
  return [what, pane.title].filter((part) => part !== undefined && part !== '').join(' · ');
}

/**
 * A tab by its number and name; a tab nobody named is named by herdr with its number, which is said once.
 * @param {import('../model/herdr.js').HerdrTab} tab
 * @returns {string}
 */
function tabName(tab) {
  return tab.label === String(tab.number) ? tab.label : `${tab.number} ${tab.label}`;
}

/**
 * @param {string | undefined} target — the page address, none for a tab with nothing to open
 * @param {string} className
 * @param {readonly (Node | string)[]} children
 * @returns {HTMLElement}
 */
function link(target, className, children) {
  return target === undefined ? h('span', { className: `${className} empty` }, children) : h('a', { className, attrs: { href: target } }, children);
}

/**
 * @param {HTMLElement} element — the sidebar's place for it
 */
export function createHerdrSidebar(element) {
  let shown = '';

  return {
    /**
     * @param {import('../model/herdr.js').HerdrLayout} layout
     * @param {import('../model/herdr.js').Opened | undefined} opened
     * @param {string} search — the search box text
     */
    render(layout, opened, search) {
      const workspaces = searchLayout(layout.workspaces, search);
      const sessions = sessionsByActivity(layout.workspaces, search);
      const place = opened === undefined ? undefined : placeOf(layout, opened);
      const look = JSON.stringify([workspaces, sessions.map(({ pane }) => pane.id), place?.tab.id, opened]);
      if (look === shown) return;
      shown = look;
      const list = workspaces.map((workspace) => {
        const active = workspace.tabs.find((tab) => tab.id === workspace.activeTab) ?? workspace.tabs[0];
        const row = link(active === undefined ? undefined : tabTarget(active), 'herdr-workspace', [
          h('span', { className: 'herdr-number', text: String(workspace.number) }),
          h('span', { className: 'herdr-name', text: workspace.label }),
          statusDot(workspace.status),
        ]);
        row.classList.toggle('selected', workspace.id === place?.workspace.id);
        return row;
      });
      const rows = sessions.map(({ workspace, tab, pane }) => {
        const what = pane.agent === 'claude' ? undefined : pane.agent;
        const title = pane.title === '' ? undefined : pane.title;
        const row = link(pane.session === undefined ? `#/pane/${pane.id}` : `#/${pane.session}`, 'herdr-tab', [
          statusDot(pane.status),
          h('span', { className: 'herdr-tab-text' }, [
            h('span', { className: 'herdr-tab-title', text: title === undefined ? tabName(tab) : title }),
            h('span', { className: 'herdr-tab-where', text: [workspace.label, title === undefined ? undefined : tabName(tab), what].filter((part) => part !== undefined).join(' · ') }),
          ]),
        ]);
        row.classList.toggle('selected', opened !== undefined && (opened.kind === 'session' ? pane.session === opened.id : pane.id === opened.id));
        return row;
      });
      element.replaceChildren(
        h('div', { className: 'herdr-workspaces', attrs: { role: 'list' } }, list),
        h('div', { className: 'herdr-tabs-head', text: `Sessions · ${sessions.length}` }),
        h('div', { className: 'herdr-tabs', attrs: { role: 'list' } }, rows),
      );
    },
  };
}

/** The tabs of the open session's or terminal's herdr workspace, above it. */
export function createTabBar() {
  const element = h('nav', { className: 'herdr-tab-bar', attrs: { 'aria-label': 'herdr tabs', hidden: '' } });
  let shown = '';
  return {
    element,
    /**
     * @param {import('../model/herdr.js').HerdrLayout} layout
     * @param {import('../model/herdr.js').Opened | undefined} opened
     */
    render(layout, opened) {
      const place = opened === undefined ? undefined : placeOf(layout, opened);
      const look = JSON.stringify([place?.workspace, place?.tab.id]);
      if (look === shown) return;
      shown = look;
      element.hidden = place === undefined;
      if (place === undefined) {
        element.replaceChildren();
        return;
      }
      const chips = place.workspace.tabs.map((tab) => {
        const chip = link(tabTarget(tab), 'herdr-chip', [statusDot(tab.status), h('span', { text: tabName(tab) })]);
        chip.title = tabContent(tab);
        chip.classList.toggle('selected', tab.id === place.tab.id);
        return chip;
      });
      element.replaceChildren(h('span', { className: 'herdr-chip-workspace', text: place.workspace.label }), ...chips);
      element.querySelector('.herdr-chip.selected')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    },
  };
}
