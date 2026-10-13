// @ts-check
// herdr as herdr itself lays it out: in the sidebar its workspaces, and under them every session of every workspace with
// its agent's status, the latest active first; above the open session or terminal, the tabs of its workspace to switch
// between, the open one to name or close.
import { placeOf, searchLayout, sessionsByActivity, tabTarget } from '../model/herdr.js';
import { h } from './dom.js';
import { icon } from './icons.js';
import { tintByWorkspace } from './workspace-tint.js';
import { labelWithIcon, splitTabIcon, tabIcons } from '../model/tab-icon.js';

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
 * The button that picks a tab's icon — an emoji kept ahead of its name — and the row of emoji it opens beside it; ✕ there
 * leaves the tab without one. The name's box keeps the focus meanwhile: pressing here is no click elsewhere, which ends
 * the naming.
 * @param {string | undefined} initial
 * @param {HTMLElement} nameBox
 */
function createIconPicker(initial, nameBox) {
  let icon = initial;
  const button = h('button', { className: 'herdr-tab-icon', title: 'Icon of the tab', attrs: { type: 'button', 'aria-label': 'Icon of the tab' } });
  const palette = h('span', { className: 'herdr-icon-palette', attrs: { hidden: '' } });
  const show = () => {
    button.textContent = icon ?? '☺';
    button.classList.toggle('empty', icon === undefined);
  };
  /** @param {string | undefined} next */
  const choose = (next) => {
    icon = next;
    show();
    palette.hidden = true;
    nameBox.focus();
  };
  palette.append(
    ...tabIcons.map((emoji) => {
      const made = h('button', { text: emoji, attrs: { type: 'button' } });
      made.addEventListener('click', () => choose(emoji));
      return made;
    }),
    (() => {
      const none = iconButton('herdr-icon-none', 'cross', 'No icon');
      none.addEventListener('click', () => choose(undefined));
      return none;
    })(),
  );
  button.addEventListener('click', () => {
    palette.hidden = !palette.hidden;
    nameBox.focus();
  });
  for (const part of [button, palette]) part.addEventListener('mousedown', (event) => event.preventDefault());
  show();
  return { element: h('span', { className: 'herdr-icon-picker' }, [button, palette]), icon: () => icon };
}

/**
 * A button that is an icon, named on hover and to a screen reader.
 * @param {string} className
 * @param {string} iconName
 * @param {string} name
 * @returns {HTMLButtonElement}
 */
function iconButton(className, iconName, name) {
  return h('button', { className: `icon-button ${className}`, title: name, attrs: { type: 'button', 'aria-label': name } }, [icon(iconName)]);
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
 * @typedef {{ createWorkspace: (label: string, folder: string, start: import('../model/herdr.js').TabStart) => Promise<import('../model/herdr.js').NewWorkspace>, open: (target: string) => void }} SidebarActions
 *   — createWorkspace resolves once the page shows the new workspace; open goes to a page address
 */

/** Why a workspace was not opened. */
/** @type {Readonly<Record<'empty' | 'no-folder' | 'failed', string>>} */
const newWorkspaceRefusals = {
  empty: 'Name the workspace.',
  'no-folder': 'There is no such folder.',
  failed: 'herdr did not open the workspace.',
};

/**
 * herdr's workspaces, and the sessions in them by their latest activity. "+" — newButton, for the page to put beside
 * the search — opens a new one: named, in a folder, with a terminal or Claude Code in it; the page goes to it. The
 * form shows at the top, above the workspaces, and stays put while herdr is looked at again; "+" again puts it away.
 * @param {HTMLElement} element — the sidebar's place for it
 * @param {SidebarActions} actions
 */
export function createHerdrSidebar(element, { createWorkspace, open }) {
  let shown = '';
  const slot = h('div', { className: 'herdr-workspace-slot' });
  const workspacesList = h('div', { className: 'herdr-workspaces', attrs: { role: 'list' } });
  const head = h('div', { className: 'herdr-tabs-head' });
  const tabsList = h('div', { className: 'herdr-tabs', attrs: { role: 'list' } });
  element.replaceChildren(slot, workspacesList, head, tabsList);
  const newButton = h('button', { className: 'icon-button herdr-workspace-new', title: 'New herdr workspace', attrs: { type: 'button', 'aria-label': 'New workspace' } }, [icon('plus')]);
  const showButton = () => {
    slot.replaceChildren();
    slot.hidden = true;
    newButton.setAttribute('aria-expanded', 'false');
  };
  const startForm = () => {
    const name = h('input', { className: 'herdr-new-name', attrs: { type: 'text', maxlength: '60', placeholder: 'Name', 'aria-label': 'Name of the new workspace' } });
    const folder = h('input', { className: 'herdr-new-folder', attrs: { type: 'text', placeholder: 'Folder: D:/dev/app or ~/app', spellcheck: 'false', 'aria-label': 'Folder of the new workspace' } });
    const error = h('div', { className: 'herdr-new-error', attrs: { role: 'alert' } });
    let sending = false;
    /** @param {import('../model/herdr.js').TabStart} start */
    const submit = async (start) => {
      if (sending) return;
      sending = true;
      form.classList.add('sending');
      error.textContent = '';
      const outcome = await createWorkspace(name.value, folder.value, start);
      sending = false;
      form.classList.remove('sending');
      if (outcome.ok) {
        showButton();
        open(outcome.target);
        return;
      }
      error.textContent = newWorkspaceRefusals[outcome.error];
      (outcome.error === 'empty' ? name : folder).focus();
    };
    /** @param {string} className @param {string} label @param {import('../model/herdr.js').TabStart} start */
    const choice = (className, label, start) => {
      const button = h('button', { className, text: label, attrs: { type: 'button' } });
      button.addEventListener('click', () => void submit(start));
      return button;
    };
    // an icon, as in a new tab's choices: the three fit on one line in a narrow sidebar
    const cancel = iconButton('herdr-new-cancel', 'cross', 'Cancel (Esc)');
    cancel.addEventListener('click', showButton);
    const form = h('div', { className: 'herdr-new-workspace' }, [name, folder, h('div', { className: 'herdr-new-actions' }, [choice('herdr-new-shell', 'Terminal', 'shell'), choice('herdr-new-claude', 'Claude Code', 'claude'), cancel]), error]);
    // Enter starts Claude Code there, Escape leaves the form
    form.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') showButton();
      else if (event.key === 'Enter' && event.target instanceof HTMLInputElement) void submit('claude');
    });
    slot.replaceChildren(form);
    slot.hidden = false;
    newButton.setAttribute('aria-expanded', 'true');
    name.focus();
  };
  newButton.addEventListener('click', () => (slot.hidden ? startForm() : showButton()));
  showButton();

  return {
    newButton,
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
        tintByWorkspace(row, workspace.label);
        return row;
      });
      const rows = sessions.map(({ workspace, tab, pane }) => {
        const what = pane.agent === 'claude' ? undefined : pane.agent;
        const title = pane.title === '' ? undefined : pane.title;
        // the status on the right, as the workspaces have it
        const row = link(pane.session === undefined ? `#/pane/${pane.id}` : `#/${pane.session}`, 'herdr-tab', [
          h('span', { className: 'herdr-tab-text' }, [
            h('span', { className: 'herdr-tab-title', text: title === undefined ? tabName(tab) : title }),
            h('span', { className: 'herdr-tab-where', text: [workspace.label, title === undefined ? undefined : tabName(tab), what].filter((part) => part !== undefined).join(' · ') }),
          ]),
          statusDot(pane.status),
        ]);
        row.classList.toggle('selected', opened !== undefined && (opened.kind === 'session' ? pane.session === opened.id : pane.id === opened.id));
        tintByWorkspace(row, workspace.label);
        return row;
      });
      workspacesList.replaceChildren(...list);
      head.textContent = `Sessions · ${sessions.length}`;
      tabsList.replaceChildren(...rows);
    },
  };
}

/**
 * @typedef {{ rename: (tabId: string, label: string) => Promise<import('../model/herdr.js').TabChange>, close: (tabId: string) => Promise<import('../model/herdr.js').TabChange>, open: (target: string) => void, create: (besideTab: string, start: import('../model/herdr.js').TabStart, label: string | undefined) => Promise<import('../model/herdr.js').NewTab> }} TabActions
 *   — rename, close and create resolve once the page shows the change; open goes to a page address
 */

/**
 * The tabs of the open session's or terminal's herdr workspace, above it. A second click on the open tab shows its
 * buttons: it can be named — a tab nobody named goes by its number — and closed, which stops what runs in it, so closing asks first; the page then stays in the
 * workspace, on the tab after the closed one, or before it when it was the last. "+" opens a tab beside the open one —
 * a terminal, or Claude Code — and the page goes to it.
 * @param {TabActions} actions
 */
export function createTabBar({ rename, close, open, create }) {
  const element = h('nav', { className: 'herdr-tab-bar', attrs: { 'aria-label': 'herdr tabs', hidden: '' } });
  // tabs that do not fit scroll sideways under the mouse wheel; tabs that fit leave the wheel to the page
  element.addEventListener(
    'wheel',
    (event) => {
      if (element.scrollWidth <= element.clientWidth || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
      event.preventDefault();
      element.scrollLeft += event.deltaY;
    },
    { passive: false },
  );
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
    const named = splitTabIcon(tab.label === String(tab.number) ? '' : tab.label);
    box.value = named.name;
    const picker = createIconPicker(named.icon, box);
    let sending = false;
    box.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        finish();
        return;
      }
      if (event.key !== 'Enter' || sending) return;
      event.preventDefault();
      const label = labelWithIcon(picker.icon(), box.value);
      if (label === '') return finish();
      sending = true;
      box.disabled = true;
      void rename(tab.id, label).then((outcome) => {
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
    chip.replaceWith(picker.element, box);
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
    // two buttons say it all: ✓ closes — the title tells what that stops — ✕ keeps the tab
    const yes = iconButton('herdr-tab-confirm-close', 'check', 'Close the tab: what runs in it stops');
    const no = iconButton('herdr-tab-confirm-cancel', 'cross', 'Keep the tab');
    const question = h('span', { className: 'herdr-tab-confirm-failed', attrs: { hidden: '' } });
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
        question.hidden = false;
        question.textContent = 'herdr did not close the tab.';
      });
    });
    actions.replaceWith(h('span', { className: 'herdr-tab-confirm', attrs: { role: 'alertdialog', 'aria-label': 'Close the tab' } }, [yes, no, question]));
    yes.focus();
  };

  /**
   * "+" gives way to the new tab's name and the choice of what it runs; Enter starts Claude Code, Escape leaves it.
   * @param {HTMLElement} adding
   * @param {import('../model/herdr.js').HerdrTab} beside — the open tab
   */
  const startAdding = (adding, beside) => {
    busy = true;
    const message = h('span', { className: 'herdr-tab-new-failed', attrs: { hidden: '' } });
    const name = h('input', { className: 'herdr-tab-name herdr-tab-new-name', attrs: { type: 'text', maxlength: '60', placeholder: 'New tab name', 'aria-label': 'Name of the new tab' } });
    const picker = createIconPicker(undefined, name);
    /** @param {import('../model/herdr.js').TabStart} start */
    const add = (start) => {
      for (const button of choices.querySelectorAll('button')) button.disabled = true;
      const label = labelWithIcon(picker.icon(), name.value.replace(/\s+/g, ' '));
      void create(beside.id, start, label === '' ? undefined : label).then((outcome) => {
        if (outcome.ok) {
          finish();
          open(outcome.target);
          return;
        }
        for (const button of choices.querySelectorAll('button')) button.disabled = false;
        message.hidden = false;
        message.textContent = 'herdr did not open a tab.';
      });
    };
    /** @param {import('../model/herdr.js').TabStart} start @param {string} text @param {string} className */
    const choice = (start, text, className) => {
      const made = iconButton(className, start === 'shell' ? 'shell' : 'model', text);
      made.addEventListener('click', () => add(start));
      return made;
    };
    name.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        finish();
      } else if (event.key === 'Enter') {
        event.preventDefault();
        add('claude');
      }
    });
    const cancel = iconButton('herdr-tab-new-cancel', 'cross', 'Cancel (Esc)');
    cancel.addEventListener('click', finish);
    const choices = h('span', { className: 'herdr-tab-confirm' }, [picker.element, name, choice('shell', 'Terminal', 'herdr-tab-new-shell'), choice('claude', 'Claude Code (Enter)', 'herdr-tab-new-claude'), cancel, message]);
    adding.replaceWith(choices);
    name.focus();
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
      const adding = h('button', { className: 'icon-button herdr-tab-new', title: 'New tab', attrs: { type: 'button', 'aria-label': 'New tab' } }, [icon('plus')]);
      adding.addEventListener('click', () => startAdding(adding, place.tab));
      element.replaceChildren(h('span', { className: 'herdr-chip-workspace', text: place.workspace.label }), ...chips, adding);
      element.querySelector('.herdr-chip.selected')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    },
  };
  return bar;
}
