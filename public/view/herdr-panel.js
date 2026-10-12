// @ts-check
// herdr as herdr itself lays it out: in the sidebar its workspaces, and under them every session of every workspace with
// its agent's status, the latest active first; above the open session or terminal, the tabs of its workspace to switch
// between, the open one to name or close.
import { placeOf, searchLayout, sessionsByActivity, tabTarget } from '../model/herdr.js';
import { h } from './dom.js';
import { icon } from './icons.js';

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

/**
 * @typedef {{ rename: (tabId: string, label: string) => Promise<import('../model/herdr.js').TabChange>, close: (tabId: string) => Promise<import('../model/herdr.js').TabChange>, open: (target: string) => void }} TabActions
 *   — rename and close resolve once the page shows the change; open goes to a page address
 */

/**
 * The tabs of the open session's or terminal's herdr workspace, above it. A second click on the open tab shows its
 * buttons: it can be named — a tab nobody named goes by its number — and closed, which stops what runs in it, so closing asks first; the page then stays in the
 * workspace, on the tab after the closed one, or before it when it was the last.
 * @param {TabActions} actions
 */
export function createTabBar({ rename, close, open }) {
  const element = h('nav', { className: 'herdr-tab-bar', attrs: { 'aria-label': 'herdr tabs', hidden: '' } });
  let shown = '';
  /** What the bar was given last: shown once naming or closing is over. */
  /** @type {{ layout: import('../model/herdr.js').HerdrLayout, opened: import('../model/herdr.js').Opened | undefined } | undefined} */
  let given;
  /** While the open tab is being named or closed the bar stays as it is: a look at herdr every few seconds would undo the typing. */
  let busy = false;
  /** The open tab whose buttons are shown: they are out of the way until it is clicked again. */
  /** @type {string | undefined} */
  let buttonsOf;

  const finish = () => {
    busy = false;
    buttonsOf = undefined;
    shown = '';
    if (given !== undefined) bar.render(given.layout, given.opened);
  };

  /**
   * The tab's chip turns into a box with its name.
   * @param {HTMLElement} chip
   * @param {HTMLElement} actions
   * @param {import('../model/herdr.js').HerdrTab} tab
   */
  const startNaming = (chip, actions, tab) => {
    busy = true;
    const box = h('input', { className: 'herdr-tab-name', attrs: { type: 'text', maxlength: '60', placeholder: 'Tab name', 'aria-label': `Name of tab ${tab.number}` } });
    box.value = tab.label === String(tab.number) ? '' : tab.label;
    let sending = false;
    box.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        finish();
        return;
      }
      if (event.key !== 'Enter' || sending) return;
      event.preventDefault();
      if (box.value.trim() === '') return finish();
      sending = true;
      box.disabled = true;
      void rename(tab.id, box.value).then((outcome) => {
        sending = false;
        if (outcome.ok) return finish();
        box.disabled = false;
        box.classList.add('failed');
        box.title = 'herdr did not rename the tab.';
        box.focus();
      });
    });
    // clicking elsewhere leaves the name as it was
    box.addEventListener('blur', () => {
      if (busy && !sending && box.isConnected) finish();
    });
    chip.replaceWith(box);
    actions.hidden = true;
    box.focus();
    box.select();
  };

  /**
   * The tab's buttons give way to the question whether to close it.
   * @param {HTMLElement} actions
   * @param {import('../model/herdr.js').HerdrTab} tab
   * @param {readonly import('../model/herdr.js').HerdrTab[]} tabs — the tabs of its workspace
   */
  const startClosing = (actions, tab, tabs) => {
    const at = tabs.findIndex((known) => known.id === tab.id);
    const neighbour = tabs[at + 1] ?? tabs[at - 1];
    busy = true;
    const yes = h('button', { className: 'herdr-tab-confirm-close', text: 'Close', attrs: { type: 'button' } });
    const no = h('button', { className: 'herdr-tab-confirm-cancel', text: 'Cancel', attrs: { type: 'button' } });
    const question = h('span', { text: 'Close the tab? What runs in it stops.' });
    no.addEventListener('click', finish);
    yes.addEventListener('click', () => {
      yes.disabled = true;
      void close(tab.id).then((outcome) => {
        if (outcome.ok) {
          const target = neighbour === undefined ? undefined : tabTarget(neighbour);
          finish();
          if (target !== undefined) open(target);
          return;
        }
        yes.disabled = false;
        question.textContent = 'herdr did not close the tab.';
      });
    });
    actions.replaceWith(h('span', { className: 'herdr-tab-confirm', attrs: { role: 'alertdialog', 'aria-label': 'Close the tab' } }, [question, yes, no]));
    yes.focus();
  };

  const bar = {
    element,
    /**
     * @param {import('../model/herdr.js').HerdrLayout} layout
     * @param {import('../model/herdr.js').Opened | undefined} opened
     */
    render(layout, opened) {
      given = { layout, opened };
      if (busy) return;
      const place = opened === undefined ? undefined : placeOf(layout, opened);
      const look = JSON.stringify([place?.workspace, place?.tab.id]);
      if (look === shown) return;
      shown = look;
      element.hidden = place === undefined;
      if (place === undefined) {
        element.replaceChildren();
        return;
      }
      if (buttonsOf !== place.tab.id) buttonsOf = undefined;
      const chips = place.workspace.tabs.flatMap((tab) => {
        const chip = link(tabTarget(tab), 'herdr-chip', [statusDot(tab.status), h('span', { text: tabName(tab) })]);
        chip.title = tabContent(tab);
        chip.classList.toggle('selected', tab.id === place.tab.id);
        if (tab.id !== place.tab.id) return [chip];
        const naming = h('button', { className: 'icon-button herdr-tab-rename', title: 'Name this tab', attrs: { type: 'button', 'aria-label': 'Name this tab' } }, [icon('edit')]);
        const closing = h('button', { className: 'icon-button herdr-tab-close', title: 'Close this tab', attrs: { type: 'button', 'aria-label': 'Close this tab' } }, [icon('cross')]);
        const actions = h('span', { className: 'herdr-tab-actions' }, [naming, closing]);
        actions.hidden = buttonsOf !== tab.id;
        // the open tab is open already: a click on it shows or hides its buttons
        chip.addEventListener('click', (event) => {
          event.preventDefault();
          buttonsOf = buttonsOf === tab.id ? undefined : tab.id;
          actions.hidden = buttonsOf !== tab.id;
        });
        naming.addEventListener('click', () => startNaming(chip, actions, tab));
        closing.addEventListener('click', () => startClosing(actions, tab, place.workspace.tabs));
        return [chip, actions];
      });
      element.replaceChildren(h('span', { className: 'herdr-chip-workspace', text: place.workspace.label }), ...chips);
      element.querySelector('.herdr-chip.selected')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    },
  };
  return bar;
}
