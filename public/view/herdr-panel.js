// @ts-check
// herdr as herdr itself lays it out: in the sidebar its workspaces, and under them every session of every workspace with
// its agent's status, the latest active first; above the open session or terminal, the tabs of its workspace to switch
// between, the open one to name or close.
import { workspaceNameOf } from '../model/folders.js';
import { placeOf, searchLayout, sessionsByActivity, tabTarget } from '../model/herdr.js';
import { groupLamp, paneLamp } from '../model/lamps.js';
import { isRecord } from '../model/narrow.js';
import { jokeAt, storyAt } from '../model/stories.js';
import { agentMark } from './agent-marks.js';
import { h } from './dom.js';
import { icon } from './icons.js';
import { restingRobot } from './rest.js';
import { workingRobots } from './robot.js';
import { waverInOwnTime } from './lamp-time.js';
import { unpluggedRobot } from './unplugged.js';
import { createWorkClock } from './work-clock.js';
import { tintByWorkspace } from './workspace-tint.js';
import { labelWithIcon, splitTabIcon, tabIcons, workspaceIcons } from '../model/tab-icon.js';

/**
 * What a new tab can start with, drawn: a terminal by its icon, the agents by their own marks — as in the usage rows.
 * @param {import('../model/herdr.js').TabStart} start
 * @returns {Element}
 */
function startMark(start) {
  return start === 'shell' ? icon('shell') : agentMark(start);
}

/** @type {Readonly<Record<import('../model/lamps.js').Lamp, string>>} */
const lampNames = { working: 'Working', blocked: 'Waiting for you', ready: 'Done — its answer not seen yet', idle: 'Idle', unknown: 'No agent' };

/**
 * The lamp beside an agent: its robots' story while it works, a robot at rest with a joke once its answer is ready
 * and not seen — its workspace's story and joke: its agents all show them, telling the project — and a robot unplugged
 * while it is idle.
 * @param {import('../model/lamps.js').Lamp} lamp
 * @param {number} workspace — its workspace's number
 * @param {number} elapsed — how long it has been at work, for the robots' story to go on from
 * @returns {HTMLElement}
 */
function statusDot(lamp, workspace, elapsed) {
  // an attribute, not a class: .working is the feed's own "Working…" line
  return h('span', { className: 'herdr-status', title: lampNames[lamp], attrs: { 'data-status': lamp } }, sceneOf(lamp, workspace, elapsed));
}

/**
 * What the lamp shows: a drawing, or none — a plain lamp, drawn by its style.
 * @param {import('../model/lamps.js').Lamp} lamp
 * @param {number} workspace
 * @param {number} elapsed
 * @returns {Element[]}
 */
function sceneOf(lamp, workspace, elapsed) {
  switch (lamp) {
    case 'working':
      return [workingRobots(storyAt(workspace), elapsed)];
    case 'ready':
      return [restingRobot(jokeAt(workspace))];
    case 'idle':
      return [unpluggedRobot()];
    case 'blocked':
    case 'unknown':
      return [];
    default: {
      /** @type {never} */
      const unexpected = lamp;
      throw new Error(`No lamp ${String(unexpected)}`);
    }
  }
}

/**
 * A lamp whose robots go on with their story from when the clock first saw it at work.
 * @param {ReturnType<typeof createWorkClock>} clock
 * @param {string} key — the agent's, the tab's, the workspace's id: how long it has been at work
 * @param {number} workspace — its workspace's number: whose story and joke it shows
 * @param {import('../model/lamps.js').Lamp} lamp
 */
function lampOf(clock, key, workspace, lamp) {
  const dot = statusDot(lamp, workspace, clock.elapsed(key, lamp === 'working'));
  // a lamp at work wavers in its own time, not with the others
  if (lamp === 'working') waverInOwnTime(dot, key);
  return dot;
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

/** Every emoji to pick an icon from (emoji-picker-element), from the viewer itself (server/app.js: vendor). */
const everyEmoji = { picker: new URL('../vendor/emoji-picker/picker.js', import.meta.url).href, data: new URL('../vendor/emoji-picker/data.json', import.meta.url).href };

/**
 * The button that picks a tab's or a workspace's icon — an emoji kept ahead of its name — and what it opens under it:
 * the usual emoji at hand, ✕ for none, and every emoji, found by its name or among its kind, the latest picked first —
 * as md-keeper picks them — loaded the first time it opens; out of the viewer's reach, the ones at hand only.
 * Picking one at hand keeps the name's box focused: pressing there is no click elsewhere, which ends the naming; the
 * search of every emoji takes the focus — holds tells it, for the naming to go on — and the focus going out of the
 * picker elsewhere ends the naming as the box's would (onLeave).
 * @param {string | undefined} initial
 * @param {HTMLElement} nameBox
 * @param {{ icons: readonly string[], title: string, onLeave: () => void }} options — the emoji at hand; the button's
 *   name; what the focus going elsewhere does
 */
function createIconPicker(initial, nameBox, { icons, title, onLeave }) {
  let icon = initial;
  const button = h('button', { className: 'herdr-tab-icon', title, attrs: { type: 'button', 'aria-label': title } });
  const atHand = h('span', { className: 'herdr-icon-at-hand' });
  const every = h('span', { className: 'herdr-icon-every' });
  const palette = h('span', { className: 'herdr-icon-palette', attrs: { hidden: '' } }, [atHand, every]);
  const element = h('span', { className: 'herdr-icon-picker' }, [button, palette]);
  /** @param {EventTarget | null} target */
  const holds = (target) => target instanceof window.Node && element.contains(target);
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
  atHand.append(
    ...icons.map((emoji) => {
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
  /** @type {Promise<void> | undefined} */
  let loading;
  const loadEvery = () => {
    loading ??= import(everyEmoji.picker).then(
      () => {
        const picker = document.createElement('emoji-picker');
        picker.setAttribute('data-source', everyEmoji.data);
        picker.addEventListener('emoji-click', (event) => {
          const detail = event instanceof window.CustomEvent ? event.detail : undefined;
          if (isRecord(detail) && typeof detail.unicode === 'string') choose(detail.unicode);
        });
        every.replaceChildren(picker);
        paint();
      },
      () => undefined, // out of the viewer's reach: the ones at hand only
    );
  };
  /** Every emoji in the page's theme: the picker's own colours otherwise follow the system's. */
  const paint = () => {
    const dark = document.documentElement.dataset.theme === 'dark' || (document.documentElement.dataset.theme !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    for (const picker of every.children) {
      picker.classList.toggle('dark', dark);
      picker.classList.toggle('light', !dark);
    }
  };
  /** Under the button, kept on the screen: fixed — a row that scrolls would cut it off. */
  const place = () => {
    const at = button.getBoundingClientRect();
    const width = Math.min(352, window.innerWidth - 16);
    palette.style.left = `${Math.max(8, Math.min(at.left, window.innerWidth - width - 8))}px`;
    palette.style.top = `${at.bottom + 4}px`;
    paint();
  };
  button.addEventListener('click', () => {
    palette.hidden = !palette.hidden;
    if (!palette.hidden) {
      place();
      loadEvery();
    }
    nameBox.focus();
  });
  palette.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    palette.hidden = true;
    nameBox.focus();
  });
  element.addEventListener('focusout', (event) => {
    if (!holds(event.relatedTarget) && event.relatedTarget !== nameBox) onLeave();
  });
  for (const part of [button, atHand]) part.addEventListener('mousedown', (event) => event.preventDefault());
  show();
  return { element, icon: () => icon, holds };
}

/**
 * A workspace's icon (server/workspace-icons.js), as its rows show it left of their names; none without one.
 * @param {import('../model/herdr.js').HerdrWorkspace} workspace
 * @returns {HTMLElement[]}
 */
function workspaceIconOf(workspace) {
  return workspace.icon === undefined ? [] : [h('span', { className: 'workspace-icon', text: workspace.icon, attrs: { 'aria-hidden': 'true' } })];
}

/**
 * A workspace's name without the emoji its user put ahead of it: that is shown as its icon.
 * @param {import('../model/herdr.js').HerdrWorkspace} workspace
 */
function workspaceName(workspace) {
  return splitTabIcon(workspace.label).name;
}

/**
 * A button that is an icon, named on hover and to a screen reader.
 * @param {string} className
 * @param {string} iconName
 * @param {string} name
 * @returns {HTMLButtonElement}
 */
function iconButton(className, iconName, name) {
  return drawnButton(className, icon(iconName), name);
}

/**
 * A button that is a drawing — an icon, a mark — named on hover and to a screen reader.
 * @param {string} className
 * @param {Element} drawing
 * @param {string} name
 * @returns {HTMLButtonElement}
 */
function drawnButton(className, drawing, name) {
  return h('button', { className: `icon-button ${className}`, title: name, attrs: { type: 'button', 'aria-label': name } }, [drawing]);
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
 * @typedef {import('../model/herdr.js').TabChange} TabChange
 * @typedef {{ createWorkspace: (label: string, folder: string, start: import('../model/herdr.js').TabStart) => Promise<import('../model/herdr.js').NewWorkspace>, open: (target: string) => void, folders: () => readonly string[], renameWorkspace: (workspaceId: string, label: string) => Promise<TabChange>, closeWorkspace: (workspaceId: string) => Promise<TabChange>, renameTab: (tabId: string, label: string) => Promise<TabChange>, closeTab: (tabId: string) => Promise<TabChange> }} SidebarActions
 *   — createWorkspace, and the renames and closings, resolve once the page shows the change; open goes to a page address;
 *   folders: the folders to offer for a new workspace — typed before, where sessions ran
 * @typedef {{ label: string, icons: readonly string[] | undefined, rename: (label: string) => Promise<TabChange>, close: () => Promise<TabChange>, names: string, closes: string }} RowSubject
 *   — what a row stands for, to name and close: its name now, the emoji its icon is picked from as it is named — none:
 *   no icon to pick — how to change it, the buttons' titles
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
 * A click on the open workspace or the open session — a second click, the first opened it — shows its buttons, as an
 * open tab has them: one names it — for a session, its tab — the other closes it once the closing is confirmed.
 * @param {HTMLElement} element — the sidebar's place for it
 * @param {SidebarActions} actions
 */
export function createHerdrSidebar(element, { createWorkspace, open, folders, renameWorkspace, closeWorkspace, renameTab, closeTab }) {
  /** How long each workspace and agent has been at work: their robots' story goes on across redrawing. */
  const clock = createWorkClock(() => Date.now());
  let shown = '';
  /** What the sidebar was given last: drawn again once a name is typed or a closing answered. */
  /** @type {{ layout: import('../model/herdr.js').HerdrLayout, opened: import('../model/herdr.js').Opened | undefined, search: string, seen: import('../model/lamps.js').SeenPanes } | undefined} */
  let given;
  /** While a row is being named or closed the lists stay as they are: a look at herdr every few seconds would undo the
   * typing. */
  let busy = false;
  const redraw = () => {
    busy = false;
    shown = '';
    if (given !== undefined) sidebar.render(given.layout, given.opened, given.search, given.seen);
  };

  /**
   * The row's name — its text part — turns into a box holding it; Enter names it, Escape or a click elsewhere leaves it.
   * @param {HTMLElement} dressed
   * @param {Element} text
   * @param {RowSubject} subject
   */
  const startNaming = (dressed, text, subject) => {
    busy = true;
    const box = h('input', { className: 'herdr-row-name', attrs: { type: 'text', maxlength: '60', 'aria-label': subject.names } });
    // the icon ahead of the name picked beside it
    const named = subject.icons === undefined ? { icon: undefined, name: subject.label } : splitTabIcon(subject.label);
    box.value = named.name;
    const picker = subject.icons === undefined ? undefined : createIconPicker(named.icon, box, { icons: subject.icons, title: 'Icon of the workspace', onLeave: () => leave() });
    const typed = () => (picker === undefined ? box.value : labelWithIcon(picker.icon(), box.value));
    let sending = false;
    box.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        redraw();
        return;
      }
      if (event.key !== 'Enter' || sending) return;
      event.preventDefault();
      if (box.value.trim() === '' || typed() === subject.label) return redraw(); // nothing new: the name stays
      sending = true;
      box.disabled = true;
      void subject.rename(typed()).then((outcome) => {
        sending = false;
        if (outcome.ok) return redraw();
        box.disabled = false;
        box.classList.add('failed');
        box.title = 'herdr did not rename it.';
        box.focus();
      });
    });
    // clicking elsewhere leaves the name as it was; into the icon picker, the naming goes on
    const leave = () => {
      if (busy && !sending && box.isConnected) redraw();
    };
    box.addEventListener('blur', (event) => {
      if (!(picker?.holds(event.relatedTarget) ?? false)) leave();
    });
    text.replaceWith(...(picker === undefined ? [] : [picker.element]), box);
    dressed.querySelector('.herdr-row-actions')?.remove();
    box.focus();
    box.select();
  };

  /**
   * The row's buttons give way to the question whether to close what it stands for: ✓ closes — the title tells what
   * that stops — ✕ keeps it.
   * @param {HTMLElement} actions
   * @param {RowSubject} subject
   */
  const startClosing = (actions, subject) => {
    busy = true;
    const yes = iconButton('herdr-row-confirm-close', 'check', subject.closes);
    const no = iconButton('herdr-row-confirm-cancel', 'cross', 'Keep it');
    const failed = h('span', { className: 'herdr-row-failed', attrs: { hidden: '' } });
    no.addEventListener('click', redraw);
    yes.addEventListener('click', () => {
      yes.disabled = true;
      void subject.close().then((outcome) => {
        if (outcome.ok) return redraw();
        yes.disabled = false;
        failed.hidden = false;
        failed.textContent = 'herdr did not close it.';
      });
    });
    actions.replaceChildren(yes, no, failed);
    yes.focus();
  };

  /**
   * A click on the open row — it is open already — shows its buttons in place of its status, a row of a link no more
   * while they are shown; another click on it hides them. A click on a row not open opens it.
   * @param {HTMLElement} row
   * @param {string} textSelector — the row's name part, which naming turns into a box
   * @param {RowSubject} subject
   */
  const offerChanges = (row, textSelector, subject) => {
    row.addEventListener('click', (event) => {
      if (!row.classList.contains('selected')) return;
      event.preventDefault();
      if (busy) return;
      const dressed = h('div', { className: `${row.className} herdr-row-dressed` });
      const style = row.getAttribute('style');
      if (style !== null) dressed.setAttribute('style', style);
      const status = row.querySelector(':scope > .herdr-status');
      dressed.append(...[...row.childNodes].filter((child) => child !== status));
      const naming = iconButton('herdr-row-rename', 'edit', subject.names);
      const closing = iconButton('herdr-row-close', 'cross', subject.closes);
      const actions = h('span', { className: 'herdr-row-actions' }, [naming, closing]);
      dressed.append(actions);
      dressed.addEventListener('click', (again) => {
        const on = again.target instanceof window.HTMLElement ? again.target.closest('button, input') : null;
        if (on === null && !busy) redraw();
      });
      naming.addEventListener('click', () => {
        const text = dressed.querySelector(textSelector);
        if (text !== null) startNaming(dressed, text, subject);
      });
      closing.addEventListener('click', () => startClosing(actions, subject));
      row.replaceWith(dressed);
    });
  };
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
    // the folder chosen from those the page offers, or typed
    const choices = h('datalist', { attrs: { id: 'herdr-new-folders' } }, folders().map((choice) => h('option', { attrs: { value: choice } })));
    const folder = h('input', { className: 'herdr-new-folder', attrs: { type: 'text', placeholder: 'Folder: D:/dev/app or ~/app', spellcheck: 'false', autocomplete: 'off', list: 'herdr-new-folders', 'aria-label': 'Folder of the new workspace' } });
    // no name given — or only the one the folder gave — follows the folder chosen
    let fromFolder = '';
    folder.addEventListener('input', () => {
      if (name.value !== '' && name.value !== fromFolder) return;
      fromFolder = workspaceNameOf(folder.value);
      name.value = fromFolder;
    });
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
    // an icon, as in a new tab's choices: the four fit on one line in a narrow sidebar
    const cancel = iconButton('herdr-new-cancel', 'cross', 'Cancel (Esc)');
    cancel.addEventListener('click', showButton);
    const form = h('div', { className: 'herdr-new-workspace' }, [name, folder, choices, h('div', { className: 'herdr-new-actions' }, [choice('herdr-new-shell', 'Terminal', 'shell'), choice('herdr-new-claude', 'Claude Code', 'claude'), choice('herdr-new-codex', 'Codex', 'codex'), cancel]), error]);
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

  const sidebar = {
    newButton,
    /**
     * @param {import('../model/herdr.js').HerdrLayout} layout
     * @param {import('../model/herdr.js').Opened | undefined} opened
     * @param {string} search — the search box text
     * @param {import('../model/lamps.js').SeenPanes} seen — the answers seen, the lamps out
     */
    render(layout, opened, search, seen) {
      given = { layout, opened, search, seen };
      if (busy) return;
      const workspaces = searchLayout(layout.workspaces, search);
      const sessions = sessionsByActivity(layout.workspaces, search);
      const place = opened === undefined ? undefined : placeOf(layout, opened);
      const look = JSON.stringify([workspaces, sessions.map(({ pane }) => pane.id), place?.tab.id, opened, [...seen]]);
      if (look === shown) return;
      shown = look;
      const list = workspaces.map((workspace) => {
        const active = workspace.tabs.find((tab) => tab.id === workspace.activeTab) ?? workspace.tabs[0];
        const row = link(active === undefined ? undefined : tabTarget(active), 'herdr-workspace', [
          h('span', { className: 'herdr-number', text: String(workspace.number) }),
          ...workspaceIconOf(workspace),
          h('span', { className: 'herdr-name', text: workspaceName(workspace) }),
          lampOf(clock, workspace.id, workspace.number, groupLamp(workspace.status, workspace.tabs.flatMap((tab) => tab.panes), seen)),
        ]);
        row.classList.toggle('selected', workspace.id === place?.workspace.id);
        tintByWorkspace(row, workspace.label);
        offerChanges(row, '.herdr-name', {
          label: workspace.label,
          icons: workspaceIcons,
          rename: (label) => renameWorkspace(workspace.id, label),
          close: () => closeWorkspace(workspace.id),
          names: 'Name this workspace',
          closes: 'Close the workspace: what runs in its tabs stops',
        });
        return row;
      });
      const rows = sessions.map(({ workspace, tab, pane }) => {
        const what = pane.agent === 'claude' ? undefined : pane.agent;
        const title = pane.title === '' ? undefined : pane.title;
        // the status on the right, as the workspaces have it
        const row = link(pane.session === undefined ? `#/pane/${pane.id}` : `#/${pane.session}`, 'herdr-tab', [
          ...workspaceIconOf(workspace),
          h('span', { className: 'herdr-tab-text' }, [
            h('span', { className: 'herdr-tab-title', text: title === undefined ? tabName(tab) : title }),
            h('span', { className: 'herdr-tab-where', text: [workspaceName(workspace), title === undefined ? undefined : tabName(tab), what].filter((part) => part !== undefined).join(' · ') }),
          ]),
          lampOf(clock, pane.id, workspace.number, paneLamp(pane, seen)),
        ]);
        row.classList.toggle('selected', opened !== undefined && (opened.kind === 'session' ? pane.session === opened.id : pane.id === opened.id));
        tintByWorkspace(row, workspace.label);
        offerChanges(row, '.herdr-tab-text', {
          // a tab herdr numbers has no name of its own to start from
          label: tab.label === String(tab.number) ? '' : tab.label,
          icons: undefined,
          rename: (label) => renameTab(tab.id, label),
          close: () => closeTab(tab.id),
          names: 'Name its tab',
          closes: 'Close its tab: what runs in it stops',
        });
        return row;
      });
      workspacesList.replaceChildren(...list);
      head.textContent = `Sessions · ${sessions.length}`;
      tabsList.replaceChildren(...rows);
    },
  };
  return sidebar;
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
  /** How long each tab has been at work: its robots' story goes on across redrawing. */
  const clock = createWorkClock(() => Date.now());
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
  /** @type {{ layout: import('../model/herdr.js').HerdrLayout, opened: import('../model/herdr.js').Opened | undefined, seen: import('../model/lamps.js').SeenPanes } | undefined} */
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
    if (given !== undefined) bar.render(given.layout, given.opened, given.seen);
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
    const picker = createIconPicker(named.icon, box, { icons: tabIcons, title: 'Icon of the tab', onLeave: () => leave() });
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
    // clicking elsewhere leaves the name as it was; into the icon picker, the naming goes on
    const leave = () => {
      if (busy && !sending && box.isConnected) finish();
    };
    box.addEventListener('blur', (event) => {
      if (!picker.holds(event.relatedTarget)) leave();
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
    // the new tab's choices stay while the focus is elsewhere
    const picker = createIconPicker(undefined, name, { icons: tabIcons, title: 'Icon of the tab', onLeave: () => undefined });
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
      const made = drawnButton(className, startMark(start), text);
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
    const choices = h('span', { className: 'herdr-tab-confirm' }, [picker.element, name, choice('shell', 'Terminal', 'herdr-tab-new-shell'), choice('claude', 'Claude Code (Enter)', 'herdr-tab-new-claude'), choice('codex', 'Codex', 'herdr-tab-new-codex'), cancel, message]);
    adding.replaceWith(choices);
    name.focus();
  };

  const bar = {
    element,
    /**
     * @param {import('../model/herdr.js').HerdrLayout} layout
     * @param {import('../model/herdr.js').Opened | undefined} opened
     * @param {import('../model/lamps.js').SeenPanes} seen — the answers seen, the lamps out
     */
    render(layout, opened, seen) {
      given = { layout, opened, seen };
      if (busy) return;
      const place = opened === undefined ? undefined : placeOf(layout, opened);
      const look = JSON.stringify([place?.workspace, place?.tab.id, [...seen]]);
      if (look === shown) return;
      shown = look;
      element.hidden = place === undefined;
      if (place === undefined) {
        element.replaceChildren();
        return;
      }
      if (buttonsOf !== place.tab.id) buttonsOf = undefined;
      const chips = place.workspace.tabs.flatMap((tab) => {
        const chip = link(tabTarget(tab), 'herdr-chip', [lampOf(clock, tab.id, place.workspace.number, groupLamp(tab.status, tab.panes, seen)), h('span', { text: tabName(tab) })]);
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
      element.replaceChildren(h('span', { className: 'herdr-chip-workspace' }, [...workspaceIconOf(place.workspace), workspaceName(place.workspace)]), ...chips, adding);
      element.querySelector('.herdr-chip.selected')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    },
  };
  return bar;
}
