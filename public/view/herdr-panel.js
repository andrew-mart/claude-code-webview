// @ts-check
// herdr as herdr itself lays it out: in the sidebar its workspaces, and under them every session of every workspace with
// its agent's status, the latest active first; above the open session or terminal, the tabs of its workspace to switch
// between, the open one to name or close.
import { folderOffers, workspaceNameOf } from '../model/folders.js';
import { iconColors, iconValue, parseIcon, searchIcons } from '../model/icon-choice.js';
import { placeOf, searchLayout, sessionsByActivity, tabTarget } from '../model/herdr.js';
import { groupLamp, paneLamp } from '../model/lamps.js';
import { isRecord } from '../model/narrow.js';
import { jokeAt, storyAt } from '../model/stories.js';
import { agentMark } from './agent-marks.js';
import { h } from './dom.js';
import { emojiIcon, icon } from './icons.js';
import { restingRobot } from './rest.js';
import { workingRobots } from './robot.js';
import { waverInOwnTime } from './lamp-time.js';
import { workspaceIconOf } from './workspace-icon.js';
import { lucideIcon } from './lucide.js';
import { createWorkClock } from './work-clock.js';
import { tintByWorkspace } from './workspace-tint.js';
import { workspaceHue } from '../model/workspace-color.js';
import { allowDragging } from './drag-order.js';
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
const lampNames = { working: 'Working', blocked: 'Waiting for you', ready: 'Done — its answer not seen yet', kept: 'Kept lit, to come back to', idle: 'Idle', unknown: 'No agent' };

/**
 * The lamp beside an agent: its robots' story while it works, a robot at rest with a joke once its answer is ready
 * and not seen — its workspace's story and joke: its agents all show them, telling the project — and nothing while
 * it is idle.
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
    // kept lit to come back to: a plain green lamp, with robots and with lamps alike, drawn by its style
    case 'kept':
    case 'idle':
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
 * The name a tab was given: none for a tab nobody named — herdr names it by its place among its workspace's tabs, anew
 * as it is moved; the number it was opened with stays.
 * @param {import('../model/herdr.js').HerdrWorkspace} workspace
 * @param {import('../model/herdr.js').HerdrTab} tab
 * @returns {string}
 */
function givenName(workspace, tab) {
  return tab.label === String(workspace.tabs.findIndex((one) => one.id === tab.id) + 1) ? '' : tab.label;
}

/** Every emoji to pick an icon from (emoji-picker-element), from the viewer itself (server/app.js: vendor). */
/** How tall the icon picker grows with all it holds: placed where there is room for it. */
const pickerHeight = 480;
const everyEmoji = { picker: new URL('../vendor/emoji-picker/picker.js', import.meta.url).href, data: new URL('../vendor/emoji-picker/data.json', import.meta.url).href };

/**
 * What a tab's or a workspace's icon is picked from: the usual emoji at hand, ✕ for none, and every emoji, found by its
 * name or among its kind, the latest picked first — as md-keeper picks them — loaded the first time it opens; out of the
 * viewer's reach, the ones at hand only. A workspace's icon may be one of Lucide's too — a tab of its own beside the
 * emoji: found by name or by its words, in a colour of the palette, or the workspace's own. It opens from what it is
 * opened by — under it, or over it where there is more room — and is put away by its user.
 * Pressing one at hand moves no focus: a name's box being typed in stays focused.
 * @param {{ icons: readonly string[], lucide: { tags: () => Promise<Readonly<Record<string, readonly string[]>>> } | undefined, onChoose: (icon: string | undefined) => void, onEscape: () => void }} options
 *   — the emoji at hand; Lucide's icons — their words — or none; what an icon picked does — none: no icon — and Escape
 */
function createIconPalette({ icons, lucide, onChoose, onEscape }) {
  const atHand = h('span', { className: 'herdr-icon-at-hand' });
  const every = h('span', { className: 'herdr-icon-every' });
  const lucidePane = h('span', { className: 'herdr-icon-lucide', attrs: { hidden: '' } });
  /** @param {'emoji' | 'icons'} which @param {string} label */
  const tab = (which, label) => h('button', { className: 'herdr-icon-tab', text: label, attrs: { type: 'button', 'data-tab': which, 'aria-pressed': String(which === 'emoji') } });
  const tabs = lucide === undefined ? [] : [tab('emoji', 'Emoji'), tab('icons', 'Icons')];
  const palette = h('span', { className: 'herdr-icon-palette', attrs: { hidden: '' } }, [atHand, ...(tabs.length === 0 ? [] : [h('span', { className: 'herdr-icon-tabs' }, tabs)]), every, lucidePane]);
  atHand.append(
    ...icons.map((emoji) => {
      const made = h('button', { text: emoji, attrs: { type: 'button' } });
      made.addEventListener('click', () => onChoose(emoji));
      return made;
    }),
    (() => {
      const none = iconButton('herdr-icon-none', 'cross', 'No icon');
      none.addEventListener('click', () => onChoose(undefined));
      return none;
    })(),
  );
  /** @type {Promise<void> | undefined} */
  let loadingEmoji;
  const loadEvery = () => {
    loadingEmoji ??= import(everyEmoji.picker).then(
      () => {
        const picker = document.createElement('emoji-picker');
        picker.setAttribute('data-source', everyEmoji.data);
        picker.addEventListener('emoji-click', (event) => {
          const detail = event instanceof window.CustomEvent ? event.detail : undefined;
          if (isRecord(detail) && typeof detail.unicode === 'string') onChoose(detail.unicode);
        });
        every.replaceChildren(picker);
        paint();
      },
      () => undefined, // out of the viewer's reach: the ones at hand only
    );
  };
  /** Lucide's icons, built the first time their tab opens; found by name and words; in the colour picked. */
  /** @type {Promise<void> | undefined} */
  let loadingIcons;
  /** @type {(typeof iconColors)[number] | undefined} */
  let color;
  const loadIcons = () => {
    if (lucide === undefined) return Promise.resolve();
    loadingIcons ??= lucide.tags().then(
      (tags) => {
        const search = h('input', { className: 'herdr-icon-search', attrs: { type: 'search', placeholder: 'Search icons — finance, chart…', 'aria-label': 'Search icons', spellcheck: 'false', autocomplete: 'off' } });
        const grid = h('span', { className: 'herdr-icon-grid' });
        const buttons = new Map(
          Object.keys(tags).map((name) => {
            const made = h('button', { title: name, attrs: { type: 'button', 'data-name': name } }, [lucideIcon(name, color)]);
            made.addEventListener('click', () => onChoose(iconValue({ kind: 'lucide', name, color })));
            return [name, made];
          }),
        );
        grid.append(...buttons.values());
        const own = h('button', { className: 'herdr-icon-color own', title: "The workspace's colour", attrs: { type: 'button', 'aria-pressed': 'true' } });
        const swatches = [own, ...iconColors.map((key) => h('button', { className: 'herdr-icon-color', title: key, attrs: { type: 'button', 'data-color': key, 'aria-pressed': 'false' } }))];
        for (const swatch of swatches) {
          swatch.addEventListener('click', () => {
            const key = iconColors.find((one) => one === swatch.getAttribute('data-color'));
            color = key;
            for (const other of swatches) other.setAttribute('aria-pressed', String(other === swatch));
            for (const drawn of grid.querySelectorAll('svg.lucide-icon')) {
              if (key === undefined) drawn.removeAttribute('data-color');
              else drawn.setAttribute('data-color', key);
            }
          });
        }
        // the ones found, the nearest first; the others hidden
        search.addEventListener('input', () => {
          const found = searchIcons(tags, search.value);
          const shown = new Set(found);
          for (const [name, made] of buttons) made.hidden = !shown.has(name);
          grid.append(...found.flatMap((name) => buttons.get(name) ?? []));
        });
        lucidePane.replaceChildren(search, h('span', { className: 'herdr-icon-colors' }, swatches), grid);
      },
      () => undefined, // out of the viewer's reach: no icons of Lucide's
    );
    return loadingIcons;
  };
  for (const made of tabs) {
    made.addEventListener('click', () => {
      const icons = made.getAttribute('data-tab') === 'icons';
      for (const other of tabs) other.setAttribute('aria-pressed', String(other === made));
      every.hidden = icons;
      lucidePane.hidden = !icons;
      if (icons) void loadIcons();
    });
  }
  /** Every emoji in the page's theme: the picker's own colours otherwise follow the system's. */
  const paint = () => {
    const dark = document.documentElement.dataset.theme === 'dark' || (document.documentElement.dataset.theme !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    for (const picker of every.children) {
      picker.classList.toggle('dark', dark);
      picker.classList.toggle('light', !dark);
    }
  };
  /**
   * Under what opened it, kept on the screen: fixed — a row that scrolls would cut it off.
   * @param {Element} from
   */
  const place = (from) => {
    const at = from.getBoundingClientRect();
    const width = Math.min(352, window.innerWidth - 16);
    palette.style.left = `${Math.max(8, Math.min(at.left, window.innerWidth - width - 8))}px`;
    // under it, or over it when there is more room there than under it for all it holds; as tall as the room
    const below = window.innerHeight - at.bottom - 12;
    const above = at.top - 12;
    const over = below < pickerHeight && above > below;
    palette.style.top = over ? '' : `${at.bottom + 4}px`;
    palette.style.bottom = over ? `${window.innerHeight - at.top + 4}px` : '';
    palette.style.maxHeight = `${Math.max(160, over ? above : below)}px`;
    paint();
  };
  palette.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    onEscape();
  });
  atHand.addEventListener('mousedown', (event) => event.preventDefault());
  return {
    element: palette,
    /** @param {Element} from */
    open(from) {
      palette.hidden = false;
      place(from);
      loadEvery();
    },
    close() {
      palette.hidden = true;
    },
    isOpen: () => !palette.hidden,
  };
}

/**
 * The button that picks a tab's or a workspace's icon as it is named — an emoji kept ahead of its name — and the icons
 * it opens under it (createIconPalette). Picking one keeps the name's box focused: pressing there is no click elsewhere,
 * which ends the naming; a search takes the focus — holds tells it, for the naming to go on — and the focus going out of
 * the picker elsewhere ends the naming as the box's would (onLeave).
 * @param {string | undefined} initial — as kept (model/icon-choice.js)
 * @param {HTMLElement} nameBox
 * @param {{ icons: readonly string[], title: string, onLeave: () => void, lucide: { tags: () => Promise<Readonly<Record<string, readonly string[]>>> } | undefined }} options
 *   — the emoji at hand; the button's name; what the focus going elsewhere does; Lucide's icons — their words — or none
 */
function createIconPicker(initial, nameBox, { icons, title, onLeave, lucide }) {
  let icon = initial;
  let picked = false;
  const button = h('button', { className: 'herdr-tab-icon', title, attrs: { type: 'button', 'aria-label': title } });
  const show = () => {
    const shown = icon === undefined ? undefined : parseIcon(icon);
    button.replaceChildren(shown === undefined ? '☺' : shown.kind === 'emoji' ? shown.emoji : lucideIcon(shown.name, shown.color));
    button.classList.toggle('empty', icon === undefined);
  };
  const palette = createIconPalette({
    icons,
    lucide,
    onChoose(next) {
      icon = next;
      picked = true;
      show();
      palette.close();
      nameBox.focus();
    },
    onEscape() {
      palette.close();
      nameBox.focus();
    },
  });
  const element = h('span', { className: 'herdr-icon-picker' }, [button, palette.element]);
  /** @param {EventTarget | null} target */
  const holds = (target) => target instanceof window.Node && element.contains(target);
  button.addEventListener('click', () => {
    if (palette.isOpen()) palette.close();
    else palette.open(button);
    nameBox.focus();
  });
  element.addEventListener('focusout', (event) => {
    if (!holds(event.relatedTarget) && event.relatedTarget !== nameBox) onLeave();
  });
  button.addEventListener('mousedown', (event) => event.preventDefault());
  show();
  return { element, icon: () => icon, picked: () => picked, holds };
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
 * @typedef {{ createWorkspace: (label: string, folder: string, start: import('../model/herdr.js').TabStart, missing: import('../model/herdr.js').MissingFolder) => Promise<import('../model/herdr.js').NewWorkspace>, open: (target: string) => void, folders: () => readonly string[], foldersOnDisk: (typed: string) => Promise<readonly string[]>, separator: () => import('../model/folders.js').PathSeparator, renameWorkspace: (workspaceId: string, label: string) => Promise<TabChange>, closeWorkspace: (workspaceId: string) => Promise<TabChange>, setWorkspaceIcon: (workspaceId: string, icon: string | undefined) => Promise<TabChange>, iconTags: () => Promise<Readonly<Record<string, readonly string[]>>>, renameTab: (tabId: string, label: string) => Promise<TabChange>, closeTab: (tabId: string) => Promise<TabChange>, hidePane: (paneId: string) => Promise<TabChange>, showHidden: () => Promise<TabChange>, keptLit: (pane: import('../model/herdr.js').HerdrPane) => boolean, keepLit: (pane: import('../model/herdr.js').HerdrPane) => void }} SidebarActions
 *   — createWorkspace, and the renames and closings, resolve once the page shows the change; open goes to a page address;
 *   folders: the folders to offer for a new workspace — typed before, where sessions ran; foldersOnDisk: those on the
 *   viewer's computer for what is typed, offered after them; separator: how that computer parts a path; keptLit: whether an agent is
 *   kept lit to come back to now; keepLit: it marked so, or its mark taken off (model/lamps.js)
 * @typedef {{ atHand: readonly string[], current: string | undefined, setIcon: (icon: string | undefined) => Promise<TabChange>, tags: () => Promise<Readonly<Record<string, readonly string[]>>> }} RowIcon
 *   — a row's icon, picked as it is named: the emoji at hand; the icon now; how one its name cannot hold — Lucide's — is
 *   kept, or taken back; the words Lucide's icons are found by
 * @typedef {{ label: string, icon: RowIcon | undefined, rename: (label: string) => Promise<TabChange>, close: () => Promise<TabChange>, hide: (() => Promise<TabChange>) | undefined, keep: { lit: () => boolean, toggle: () => void } | undefined, names: string, closes: string }} RowSubject
 *   — what a row stands for, to name and close: its name now, its icon — none: no icon to pick — how to change it; keep:
 *   its agent kept lit to come back to — lit: whether it is now — none: a row of no one agent; the buttons' titles
 * @typedef {{ label: string, keeps: boolean, icon: string | undefined }} Naming
 *   — a row's name as herdr is to hold it, and whether the viewer keeps an icon for it: which — none: no icon
 */

/**
 * A row's name in herdr and the icon the viewer keeps for it with an icon picked: an emoji goes ahead of the name; one
 * of Lucide's — or none — is kept by the viewer, the name holding no emoji then.
 * @param {string} name — without an emoji ahead of it
 * @param {string | undefined} chosen — as kept (model/icon-choice.js); none: no icon
 * @returns {Naming}
 */
function withIcon(name, chosen) {
  return chosen !== undefined && parseIcon(chosen)?.kind === 'emoji' ? { label: labelWithIcon(chosen, name), keeps: false, icon: undefined } : { label: labelWithIcon(undefined, name), keeps: true, icon: chosen };
}

/**
 * Opens a workspace's or a tab's icons to pick from at what they are opened by, over the page: put away once one is
 * picked, on Escape or on a press elsewhere — a press in them, a search typed, keeps them; the keys go to them, not to
 * the page's Escape that stops Claude.
 * @param {{ from: Element, into: Element, hue: string, icons: readonly string[], lucide: { tags: () => Promise<Readonly<Record<string, readonly string[]>>> } | undefined, onChoose: (icon: string | undefined) => void, onAway: () => void }} options
 *   — into: what holds them; hue: the workspace's, Lucide's icons drawn in it as its row has it; icons: the emoji at
 *   hand; lucide: Lucide's icons — a workspace's, the viewer keeping the one picked — or none: a tab's name holds an
 *   emoji only; onAway: put away, nothing picked
 */
function openIconPalette({ from, into, hue, icons, lucide, onChoose, onAway }) {
  const putAway = () => {
    window.document.removeEventListener('pointerdown', onPress, true);
    palette.element.remove();
  };
  /** @param {Event} press */
  const onPress = (press) => {
    if (press.target instanceof window.Node && palette.element.contains(press.target)) return;
    putAway();
    onAway();
  };
  const palette = createIconPalette({
    icons,
    lucide,
    onChoose(chosen) {
      putAway();
      onChoose(chosen);
    },
    onEscape() {
      putAway();
      onAway();
    },
  });
  palette.element.style.setProperty('--workspace-hue', hue);
  into.append(palette.element);
  window.document.addEventListener('pointerdown', onPress, true);
  palette.open(from);
  palette.element.tabIndex = -1;
  palette.element.focus();
}

/**
 * Names a row: herdr renames it unless its name stays as it is, then the viewer keeps the icon it holds for it.
 * @param {Pick<RowSubject, 'label' | 'rename' | 'icon'>} subject
 * @param {Naming} naming
 * @returns {Promise<TabChange>} — herdr's renaming
 */
async function renameWith(subject, naming) {
  const outcome = naming.label === subject.label ? /** @type {TabChange} */ ({ ok: true }) : await subject.rename(naming.label);
  if (outcome.ok && naming.keeps && subject.icon !== undefined) await subject.icon.setIcon(naming.icon);
  return outcome;
}

/** How many of the folders offered for a new workspace are listed at once: the rest are found by typing. */
const offeredFolders = 8;


/** Why a workspace was not opened. */
/** @type {Readonly<Record<'empty' | 'no-folder' | 'not-created' | 'failed', string>>} */
const newWorkspaceRefusals = {
  empty: 'Name the workspace.',
  'no-folder': 'There is no such folder.',
  'not-created': 'The folder could not be made.',
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
export function createHerdrSidebar(element, { createWorkspace, open, folders, foldersOnDisk, separator, renameWorkspace, closeWorkspace, setWorkspaceIcon, iconTags, renameTab, closeTab, hidePane, showHidden, keptLit, keepLit }) {
  /** How long each workspace and agent has been at work: their robots' story goes on across redrawing. */
  const clock = createWorkClock(() => Date.now());
  let shown = '';
  /** Which workspace and session are open, as the rows were marked last. */
  let picked = '';
  /** The rows drawn, with what each is of: the open ones are marked on them. */
  /** @type {{ row: HTMLElement, workspaceId: string }[]} */
  let workspaceRows = [];
  /** @type {{ row: HTMLElement, pane: import('../model/herdr.js').HerdrPane }[]} */
  let sessionRows = [];
  /**
   * Marks the open workspace and session among the rows drawn.
   * @param {ReturnType<typeof placeOf> | undefined} place
   * @param {import('../model/herdr.js').Opened | undefined} opened
   */
  const markOpen = (place, opened) => {
    for (const { row, workspaceId } of workspaceRows) row.classList.toggle('selected', workspaceId === place?.workspace.id);
    for (const { row, pane } of sessionRows) row.classList.toggle('selected', opened !== undefined && (opened.kind === 'session' ? pane.session === opened.id : pane.id === opened.id));
  };
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
    // the icon picked beside the name: an emoji ahead of it, one of Lucide's kept by the viewer
    const rowIcon = subject.icon;
    const named = rowIcon === undefined ? { icon: undefined, name: subject.label } : splitTabIcon(subject.label);
    box.value = named.name;
    const picker = rowIcon === undefined ? undefined : createIconPicker(rowIcon.current, box, { icons: rowIcon.atHand, title: 'Icon of the workspace', onLeave: () => leave(), lucide: { tags: rowIcon.tags } });
    /** @returns {Naming} — the name typed, with the icon picked — or the one it had while none is */
    const typed = () => {
      if (picker === undefined) return { label: box.value, keeps: false, icon: undefined };
      return picker.picked() ? withIcon(box.value, picker.icon()) : { label: labelWithIcon(named.icon, box.value), keeps: false, icon: undefined };
    };
    let sending = false;
    box.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        redraw();
        return;
      }
      if (event.key !== 'Enter' || sending) return;
      event.preventDefault();
      const naming = typed();
      if (box.value.trim() === '' || (naming.label === subject.label && !naming.keeps)) return redraw(); // nothing new: the name stays
      sending = true;
      box.disabled = true;
      void renameWith(subject, naming).then((outcome) => {
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
      const hide = subject.hide;
      // an idle session only: hidden from the list until its agent changes state
      const hiding = hide === undefined ? undefined : iconButton('herdr-row-hide', 'hide', 'Hide until its agent changes state');
      // its agent's lamp kept lit to come back to, until the mark is taken off or the agent changes state
      const keep = subject.keep;
      const lit = keep?.lit() === true;
      const keeping = keep === undefined ? undefined : iconButton('herdr-row-keep', 'later', lit ? 'Let its lamp go out: no need to come back' : 'Keep its lamp lit, to come back to later (Ctrl+Q)');
      keeping?.setAttribute('aria-pressed', String(lit));
      const actions = h('span', { className: 'herdr-row-actions' }, [...(keeping === undefined ? [] : [keeping]), naming, ...(hiding === undefined ? [] : [hiding]), closing]);
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
      hiding?.addEventListener('click', () => {
        hiding.disabled = true;
        void hide?.().then(redraw);
      });
      keeping?.addEventListener('click', () => {
        keep?.toggle();
        redraw();
      });
      row.replaceWith(dressed);
    });
  };
  /**
   * A click on the open row's icon — a second click, the first opened it, as for its buttons — opens the icons to pick
   * from under it, no naming first: the one picked is the row's at once. The lists stay as they are meanwhile; Escape or
   * a press elsewhere puts the icons away. A click on the icon of a row not open opens the row.
   * @param {HTMLElement} row
   * @param {RowSubject} subject
   */
  const offerIcon = (row, subject) => {
    const shown = row.querySelector(':scope > .workspace-icon');
    const rowIcon = subject.icon;
    if (shown === null || rowIcon === undefined) return;
    shown.addEventListener('click', (event) => {
      if (!row.classList.contains('selected')) return;
      event.preventDefault();
      event.stopPropagation();
      if (busy) return;
      busy = true;
      openIconPalette({
        from: shown,
        into: element,
        hue: row.style.getPropertyValue('--workspace-hue'),
        icons: rowIcon.atHand,
        lucide: { tags: rowIcon.tags },
        onChoose: (chosen) => void renameWith(subject, withIcon(splitTabIcon(subject.label).name, chosen)).then(redraw),
        onAway: redraw,
      });
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
    const example = separator() === '\\' ? 'Folder: D:\\dev\\app or ~\\app' : 'Folder: /home/me/app or ~/app';
    const folder = h('input', { className: 'herdr-new-folder', attrs: { type: 'text', placeholder: example, spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Folder of the new workspace' } });
    // no name given — or only the one the folder gave — follows the folder chosen
    let fromFolder = '';
    const followFolder = () => {
      if (name.value !== '' && name.value !== fromFolder) return;
      fromFolder = workspaceNameOf(folder.value);
      name.value = fromFolder;
    };
    // The folder typed, or picked from those the page offers: listed under the box — a phone shows no list of a box's
    // own — the folders worked in that hold what is typed, read anew each time — the page may learn of more meanwhile —
    // then those on the disk found for it as they come, an answer for what was typed before dropped; none once one of
    // them is in the box.
    /** @type {readonly string[]} */
    let found = [];
    let asked = 0;
    const choices = h('div', { className: 'herdr-new-folders' });
    const narrow = () => {
      choices.replaceChildren(
        ...folderOffers(folders(), found, folder.value, offeredFolders).map((path) => {
          const button = h('button', { text: path, title: path, attrs: { type: 'button' } });
          button.addEventListener('click', () => {
            folder.value = path;
            followFolder();
            narrow();
          });
          return button;
        }),
      );
    };
    const lookOnDisk = () => {
      const turn = ++asked;
      void foldersOnDisk(folder.value).then((now) => {
        if (turn !== asked) return;
        found = now;
        narrow();
      });
    };
    narrow();
    const error = h('div', { className: 'herdr-new-error', attrs: { role: 'alert' } });
    // a folder that is not there: offered to be made, the workspace opened there as it was asked for
    const create = h('button', { className: 'herdr-new-create', text: 'Create the folder', attrs: { type: 'button', hidden: '' } });
    /** What was to start in the workspace refused for its folder: the same starts once the folder is made. */
    /** @type {import('../model/herdr.js').TabStart} */
    let refusedStart = 'shell';
    folder.addEventListener('input', () => {
      followFolder();
      narrow();
      lookOnDisk();
      // the offer was for the folder typed before
      create.hidden = true;
    });
    let sending = false;
    /** @param {import('../model/herdr.js').TabStart} start @param {import('../model/herdr.js').MissingFolder} missing */
    const submit = async (start, missing) => {
      if (sending) return;
      sending = true;
      form.classList.add('sending');
      error.textContent = '';
      create.hidden = true;
      const outcome = await createWorkspace(name.value, folder.value, start, missing);
      sending = false;
      form.classList.remove('sending');
      if (outcome.ok) {
        showButton();
        open(outcome.target);
        return;
      }
      error.textContent = newWorkspaceRefusals[outcome.error];
      if (outcome.error === 'no-folder') {
        refusedStart = start;
        create.hidden = false;
      }
      (outcome.error === 'empty' ? name : folder).focus();
    };
    create.addEventListener('click', () => void submit(refusedStart, 'create'));
    /** @param {string} className @param {string} label @param {import('../model/herdr.js').TabStart} start */
    const choice = (className, label, start) => {
      const button = h('button', { className, text: label, attrs: { type: 'button' } });
      button.addEventListener('click', () => void submit(start, 'refuse'));
      return button;
    };
    // an icon, as in a new tab's choices: the four fit on one line in a narrow sidebar
    const cancel = iconButton('herdr-new-cancel', 'cross', 'Cancel (Esc)');
    cancel.addEventListener('click', showButton);
    const form = h('div', { className: 'herdr-new-workspace' }, [name, folder, choices, h('div', { className: 'herdr-new-actions' }, [choice('herdr-new-shell', 'Terminal', 'shell'), choice('herdr-new-claude', 'Claude Code', 'claude'), ...(given?.layout.claudeGpt === true ? [choice('herdr-new-gpt', 'Claude GPT', 'claude-gpt')] : []), choice('herdr-new-codex', 'Codex', 'codex'), cancel]), error, create]);
    // Enter starts Claude Code there, Escape leaves the form
    form.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') showButton();
      else if (event.key === 'Enter' && event.target instanceof HTMLInputElement) void submit('claude', 'refuse');
    });
    slot.replaceChildren(form);
    slot.hidden = false;
    newButton.setAttribute('aria-expanded', 'true');
    name.focus();
  };
  newButton.addEventListener('click', () => (slot.hidden ? startForm() : showButton()));
  showButton();

  /**
   * The button that shows the sessions hidden again, beside the list's name — none while none is hidden.
   * @param {number} hidden
   * @returns {HTMLButtonElement[]}
   */
  const hiddenShown = (hidden) => {
    if (hidden === 0) return [];
    const button = h('button', { className: 'herdr-hidden-show', text: `${hidden} hidden`, title: 'Show the hidden sessions again', attrs: { type: 'button' } });
    button.addEventListener('click', () => {
      button.disabled = true;
      void showHidden().then((outcome) => {
        if (!outcome.ok) button.disabled = false;
      });
    });
    return [button];
  };
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
      const look = JSON.stringify([workspaces, sessions.map(({ pane }) => pane.id), [...seen]]);
      const pick = JSON.stringify([place?.workspace.id, opened]);
      if (look === shown) {
        // the same rows: only which one is open moves — made anew, a long list and its robots cost a phone a moment
        if (pick !== picked) markOpen(place, opened);
        picked = pick;
        return;
      }
      shown = look;
      picked = pick;
      workspaceRows = [];
      sessionRows = [];
      const list = workspaces.map((workspace) => {
        const active = workspace.tabs.find((tab) => tab.id === workspace.activeTab) ?? workspace.tabs[0];
        const row = link(active === undefined ? undefined : tabTarget(active), 'herdr-workspace', [
          h('span', { className: 'herdr-number', text: String(workspace.number) }),
          ...workspaceIconOf(workspace.icon),
          h('span', { className: 'herdr-name', text: workspaceName(workspace) }),
          lampOf(clock, workspace.id, workspace.number, groupLamp(workspace.status, workspace.tabs.flatMap((tab) => tab.panes), seen)),
        ]);
        workspaceRows.push({ row, workspaceId: workspace.id });
        tintByWorkspace(row, workspace.label);
        /** @type {RowSubject} */
        const subject = {
          label: workspace.label,
          icon: { atHand: workspaceIcons, current: workspace.icon, setIcon: (icon) => setWorkspaceIcon(workspace.id, icon), tags: iconTags },
          rename: (label) => renameWorkspace(workspace.id, label),
          close: () => closeWorkspace(workspace.id),
          hide: undefined,
          keep: undefined,
          names: 'Name this workspace',
          closes: 'Close the workspace: what runs in its tabs stops',
        };
        offerChanges(row, '.herdr-name', subject);
        offerIcon(row, subject);
        return row;
      });
      // the sessions their user hid while idle are left out, until their agents change state
      const listed = sessions.filter(({ pane }) => pane.hidden !== true);
      const rows = listed.map(({ workspace, tab, pane }) => {
        const what = pane.agent === 'claude' ? undefined : pane.agent;
        const title = pane.title === '' ? undefined : pane.title;
        // the status on the right, as the workspaces have it
        const row = link(pane.session === undefined ? `#/pane/${pane.id}` : `#/${pane.session}`, 'herdr-tab', [
          ...workspaceIconOf(workspace.icon),
          h('span', { className: 'herdr-tab-text' }, [
            h('span', { className: 'herdr-tab-title', text: title === undefined ? tab.label : title }),
            h('span', { className: 'herdr-tab-where', text: [workspaceName(workspace), title === undefined ? undefined : tab.label, what].filter((part) => part !== undefined).join(' · ') }),
          ]),
          lampOf(clock, pane.id, workspace.number, paneLamp(pane, seen)),
        ]);
        sessionRows.push({ row, pane });
        tintByWorkspace(row, workspace.label);
        offerChanges(row, '.herdr-tab-text', {
          label: givenName(workspace, tab),
          icon: undefined,
          rename: (label) => renameTab(tab.id, label),
          close: () => closeTab(tab.id),
          hide: paneLamp(pane, seen) === 'idle' ? () => hidePane(pane.id) : undefined,
          keep: { lit: () => keptLit(pane), toggle: () => keepLit(pane) },
          names: 'Name its tab',
          closes: 'Close its tab: what runs in it stops',
        });
        return row;
      });
      markOpen(place, opened);
      workspacesList.replaceChildren(...list);
      head.replaceChildren(`Sessions · ${listed.length}`, ...hiddenShown(sessions.length - listed.length));
      tabsList.replaceChildren(...rows);
    },
  };
  return sidebar;
}

/**
 * @typedef {{ rename: (tabId: string, label: string) => Promise<import('../model/herdr.js').TabChange>, close: (tabId: string) => Promise<import('../model/herdr.js').TabChange>, move: (tabId: string, place: number) => Promise<import('../model/herdr.js').TabChange>, open: (target: string) => void, create: (besideTab: string, start: import('../model/herdr.js').TabStart, label: string | undefined) => Promise<import('../model/herdr.js').NewTab>, duplicate: (tabId: string) => Promise<import('../model/herdr.js').NewTab>, renameWorkspace: (workspaceId: string, label: string) => Promise<TabChange>, setWorkspaceIcon: (workspaceId: string, icon: string | undefined) => Promise<TabChange>, iconTags: () => Promise<Readonly<Record<string, readonly string[]>>> }} TabActions
 *   — rename, close, move, create and duplicate resolve once the page shows the change; move: to a place between the
 *   tabs as they stand, 0 before the first; duplicate: a copy of the tab, the session in it forked; open goes to a page
 *   address; renameWorkspace, setWorkspaceIcon and iconTags: the workspace's icon picked from the bar's head
 */

/**
 * The tabs of the open session's or terminal's herdr workspace, above it. A second click on the open tab shows its
 * buttons: its icon can be picked at once, it can be named — a tab nobody named goes by its number — and closed, which
 * stops what runs in it, so closing asks first; the page then stays in the
 * workspace, on the tab after the closed one, or before it when it was the last. "+" opens a tab beside the open one —
 * a terminal, or Claude Code — and the page goes to it.
 * @param {TabActions} actions
 */
export function createTabBar({ rename, close, move, open, create, duplicate, renameWorkspace, setWorkspaceIcon, iconTags }) {
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
  /** Names the open tab as drawn last, as its ✎ does; none while no tab is open. */
  /** @type {(() => void) | undefined} */
  let nameOpen;

  const finish = () => {
    busy = false;
    buttonsOf = undefined;
    shown = '';
    if (given !== undefined) bar.render(given.layout, given.opened, given.seen);
  };
  // a tab dragged to another place among them: the bar stays as it is while it is dragged and moved
  allowDragging(element, {
    items: () => [...element.querySelectorAll('.herdr-chip')].filter((chip) => chip instanceof window.HTMLElement),
    axis: 'x',
    grip: undefined,
    scroller: element,
    idOf: (chip) => chip.dataset.tab,
    canStart: () => !busy,
    onStart: () => {
      busy = true;
    },
    onDrop: (tabId, place) => void move(tabId, place).then(finish),
    onCancel: finish,
  });

  /**
   * The icon of the workspace at the head of its tabs: a press opens its icons to pick from — on a phone a press on the
   * workspace's row in the sidebar goes to it. The bar stays as it is meanwhile.
   * @param {import('../model/herdr.js').HerdrWorkspace} workspace
   * @returns {HTMLButtonElement[]} — none for a workspace without an icon
   */
  const workspaceIconButton = (workspace) => {
    const drawn = workspaceIconOf(workspace.icon);
    if (drawn.length === 0) return [];
    const button = h('button', { className: 'herdr-chip-icon', title: 'Icon of the workspace', attrs: { type: 'button', 'aria-label': 'Icon of the workspace' } }, drawn);
    button.addEventListener('click', () => {
      if (busy) return;
      busy = true;
      const subject = {
        label: workspace.label,
        rename: (/** @type {string} */ label) => renameWorkspace(workspace.id, label),
        icon: { atHand: workspaceIcons, current: workspace.icon, setIcon: (/** @type {string | undefined} */ chosen) => setWorkspaceIcon(workspace.id, chosen), tags: iconTags },
      };
      openIconPalette({
        from: button,
        into: window.document.body,
        hue: String(workspaceHue(workspace.label)),
        icons: subject.icon.atHand,
        lucide: { tags: subject.icon.tags },
        onChoose: (chosen) => void renameWith(subject, withIcon(splitTabIcon(workspace.label).name, chosen)).then(finish),
        onAway: finish,
      });
    });
    return [button];
  };

  /**
   * The tab's chip turns into a box with its name.
   * @param {HTMLElement} chip
   * @param {HTMLElement} actions
   * @param {import('../model/herdr.js').HerdrTab} tab
   * @param {string} given — the name it was given, none for a tab nobody named
   */
  const startNaming = (chip, actions, tab, given) => {
    busy = true;
    const box = h('input', { className: 'herdr-tab-name', attrs: { type: 'text', maxlength: '60', placeholder: 'Tab name', 'aria-label': `Name of tab ${tab.label}` } });
    const named = splitTabIcon(given);
    box.value = named.name;
    const picker = createIconPicker(named.icon, box, { icons: tabIcons, title: 'Icon of the tab', onLeave: () => leave(), lucide: undefined });
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
   * herdr opens the tab's copy — the session in it forked — and the page goes to it; a copy not opened is told beside
   * the tab's buttons.
   * @param {HTMLButtonElement} button
   * @param {HTMLElement} actions
   * @param {import('../model/herdr.js').HerdrTab} tab
   */
  const startDuplicating = (button, actions, tab) => {
    busy = true;
    button.disabled = true;
    void duplicate(tab.id).then((outcome) => {
      if (outcome.ok) {
        finish();
        open(outcome.target);
        return;
      }
      busy = false;
      button.disabled = false;
      actions.querySelector('.herdr-tab-duplicate-failed')?.remove();
      actions.append(h('span', { className: 'herdr-tab-duplicate-failed', text: 'herdr did not open a copy.' }));
    });
  };

  /**
   * The tab's icon picked from its buttons, no naming first: the icons open under it — the emoji only, which its name in
   * herdr holds — the one picked goes ahead of the tab's name, the name kept, ✕ takes it off; one herdr does not take is
   * told beside the buttons.
   * @param {HTMLButtonElement} button
   * @param {HTMLElement} actions
   * @param {import('../model/herdr.js').HerdrWorkspace} workspace
   * @param {import('../model/herdr.js').HerdrTab} tab
   */
  const startPickingIcon = (button, actions, workspace, tab) => {
    busy = true;
    const named = givenName(workspace, tab);
    openIconPalette({
      from: button,
      into: window.document.body,
      hue: String(workspaceHue(workspace.label)),
      icons: tabIcons,
      lucide: undefined,
      onChoose: (chosen) => {
        const label = labelWithIcon(chosen, splitTabIcon(named).name);
        // nothing to name the tab by, or the name it has already: nothing to send
        if (label === '' || label === named) return finish();
        void rename(tab.id, label).then((outcome) => {
          if (outcome.ok) return finish();
          busy = false;
          actions.querySelector('.herdr-tab-icon-failed')?.remove();
          actions.append(h('span', { className: 'herdr-tab-icon-failed', text: 'herdr did not change the icon.' }));
        });
      },
      onAway: finish,
    });
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
    const picker = createIconPicker(undefined, name, { icons: tabIcons, title: 'Icon of the tab', onLeave: () => undefined, lucide: undefined });
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
    const choices = h('span', { className: 'herdr-tab-confirm' }, [picker.element, name, choice('shell', 'Terminal', 'herdr-tab-new-shell'), choice('claude', 'Claude Code (Enter)', 'herdr-tab-new-claude'), ...(given?.layout.claudeGpt === true ? [choice('claude-gpt', 'Claude GPT', 'herdr-tab-new-gpt')] : []), choice('codex', 'Codex', 'herdr-tab-new-codex'), cancel, message]);
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
      nameOpen = undefined;
      if (place === undefined) {
        element.replaceChildren();
        return;
      }
      if (buttonsOf !== place.tab.id) buttonsOf = undefined;
      const chips = place.workspace.tabs.flatMap((tab) => {
        const chip = link(tabTarget(tab), 'herdr-chip', [lampOf(clock, tab.id, place.workspace.number, groupLamp(tab.status, tab.panes, seen)), h('span', { text: tab.label })]);
        chip.title = tabContent(tab);
        chip.dataset.tab = tab.id;
        chip.draggable = false;
        chip.classList.toggle('selected', tab.id === place.tab.id);
        if (tab.id !== place.tab.id) return [chip];
        const tabIcon = splitTabIcon(givenName(place.workspace, tab)).icon;
        const picking = h('button', { className: `icon-button herdr-tab-icon-pick${tabIcon === undefined ? ' empty' : ''}`, title: 'Icon of this tab', attrs: { type: 'button', 'aria-label': 'Icon of this tab' } }, [tabIcon === undefined ? icon('smile') : emojiIcon(tabIcon)]);
        const naming = h('button', { className: 'icon-button herdr-tab-rename', title: 'Name this tab', attrs: { type: 'button', 'aria-label': 'Name this tab' } }, [icon('edit')]);
        const duplicating = h('button', { className: 'icon-button herdr-tab-duplicate', title: 'Duplicate this tab: its session forked into a new one', attrs: { type: 'button', 'aria-label': 'Duplicate this tab' } }, [icon('duplicate')]);
        const closing = h('button', { className: 'icon-button herdr-tab-close', title: 'Close this tab', attrs: { type: 'button', 'aria-label': 'Close this tab' } }, [icon('cross')]);
        const actions = h('span', { className: 'herdr-tab-actions' }, [picking, naming, duplicating, closing]);
        actions.hidden = buttonsOf !== tab.id;
        // the open tab is open already: a click on it shows or hides its buttons
        chip.addEventListener('click', (event) => {
          event.preventDefault();
          buttonsOf = buttonsOf === tab.id ? undefined : tab.id;
          actions.hidden = buttonsOf !== tab.id;
        });
        nameOpen = () => startNaming(chip, actions, tab, givenName(place.workspace, tab));
        naming.addEventListener('click', nameOpen);
        picking.addEventListener('click', () => startPickingIcon(picking, actions, place.workspace, tab));
        duplicating.addEventListener('click', () => startDuplicating(duplicating, actions, tab));
        closing.addEventListener('click', () => startClosing(actions, tab, place.workspace.tabs));
        return [chip, actions];
      });
      const adding = h('button', { className: 'icon-button herdr-tab-new', title: 'New tab', attrs: { type: 'button', 'aria-label': 'New tab' } }, [icon('plus')]);
      adding.addEventListener('click', () => startAdding(adding, place.tab));
      element.replaceChildren(h('span', { className: 'herdr-chip-workspace' }, [...workspaceIconButton(place.workspace), workspaceName(place.workspace)]), ...chips, adding);
      element.querySelector('.herdr-chip.selected')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    },
    /** Names the open tab, as its ✎ does — F2 on the page; while a tab is being named, closed or dragged, nothing. */
    nameOpenTab() {
      if (!busy) nameOpen?.();
    },
  };
  return bar;
}
