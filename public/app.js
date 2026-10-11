// @ts-check
// Viewer page: session list on the left, the selected session on the right. Session address is #/<id>.
import { formatAgo } from './model/format.js';
import { isRecord, text } from './model/narrow.js';
import { currentIndex, stepTarget } from './model/outline.js';
import { feedToKeep, keptEntries, sessionsToSave } from './model/offline.js';
import { listedSessions, mergeSessions } from './model/session-list.js';
import { actionLabel, choices, nextChoice } from './model/view-settings.js';
import { createBookmarkStore, moveLocalBookmarksToServer } from './view/bookmark-store.js';
import { createComposer } from './view/composer-view.js';
import { createDrawers } from './view/drawers.js';
import { openOfflineStore } from './view/offline-store.js';
import { createRewindDialog } from './view/rewind-dialog.js';
import { createSessionHeader } from './view/session-header.js';
import { rewindMessage } from './model/rewind.js';
import { createOutline } from './view/outline-view.js';
import { h } from './view/dom.js';
import { createFilePanel } from './view/file-panel.js';
import { relabelTables } from './view/markdown.js';
import { createResizer, restoreWidth } from './view/resizer.js';
import { icon } from './view/icons.js';
import { activityModeEvent, jumpMarginPx, mountSession } from './view/session-view.js';

/**
 * activeAt — the session's last prompt or answer
 * @typedef {{ id: string, project: string, title: string | undefined, cwd: string | undefined, branch: string | undefined, kind: 'interactive' | 'sdk', modifiedAt: number, size: number, activeAt: number }} SessionInfo
 * @typedef {import('./model/view-settings.js').SettingKey} SettingKey
 */

const refreshMs = 4000;
/** While the viewer answers, the latest sessions are saved to read offline this often at most… */
const keepEveryMs = 5 * 60_000;
/** …that many of the latest ones worked on, within this stretch of time, their latest entries. */
const keptSessions = 8;
const keptWithinMs = 3 * 24 * 3600_000;
const keptTail = 800;
/** A session written to within this many milliseconds is marked as active in the list. */
const activeMs = 2 * 60_000;

const list = byId('session-list', HTMLElement);
const search = byId('search', HTMLInputElement);
const follow = byId('follow', HTMLInputElement);
const showSdk = byId('show-sdk', HTMLInputElement);
const main = byId('main', HTMLElement);
const emptyState = byId('empty-state', HTMLElement);
const updateNotice = createUpdateNotice();
// Out of the viewer's reach — the computer is off — the page shows what it saved: the session list and the sessions'
// feeds (view/offline-store.js); it reconnects by itself.
const offline = openOfflineStore();
const offlineNotice = createOfflineNotice();
const connection = createConnection((online) => {
  offlineNotice.hidden = online;
  page.renderList();
});

const drawers = createDrawers({ root: document.documentElement, backdrop: byId('drawer-backdrop', HTMLElement), history });
// A view setting that resizes the feed keeps the reader at the message they were at.
const settings = createSettings((change) => page.keepPlace(change));
const page = createPage();
const layout = byId('layout', HTMLElement);
const filePanel = createFilePanel({ panel: byId('file-panel', HTMLElement), layout });
/** @type {import('./view/resizer.js').PanelWidth} */
const outlineWidth = { property: '--outline-width', storageKey: 'viewer.outlineWidth' };
restoreWidth(layout, outlineWidth);
mountSidebarResizer(byId('sidebar', HTMLElement));
settings.applyAll();
// File links (marked up by view/file-links.js) open in the right-hand panel, not in the browser.
document.addEventListener('click', (event) => {
  const link = event.target instanceof Element ? event.target.closest('a.file-link') : null;
  const path = link?.getAttribute('data-path');
  if (link === null || path === null || path === undefined) return;
  event.preventDefault();
  filePanel.open({ path, line: lineAttribute(link, 'data-line'), endLine: lineAttribute(link, 'data-end-line') });
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && drawers.isOpen()) drawers.close();
  else if (event.key === 'Escape' && filePanel.isOpen()) filePanel.close();
  if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
    event.preventDefault();
    page.step(event.key === 'ArrowUp' ? 'previous' : 'next');
  }
});
follow.checked = settings.get('follow') === 'on';
showSdk.checked = settings.get('sdk') === 'shown';
search.addEventListener('input', () => page.renderList());
follow.addEventListener('change', () => {
  settings.set('follow', follow.checked ? 'on' : 'off');
  page.followLatest();
});
showSdk.addEventListener('change', () => {
  settings.set('sdk', showSdk.checked ? 'shown' : 'hidden');
  page.renderList();
  page.followLatest();
});
window.addEventListener('hashchange', () => {
  drawers.arrive();
  page.openFromHash();
});
// Bookmarks the browser kept before they moved to the server go there before a session opens.
void moveLocalBookmarksToServer()
  .then(() => page.refresh())
  .then(() => page.openFromHash());
setInterval(() => void page.refresh(), refreshMs);
// The page itself opens from the browser's copy when the viewer is out of reach (sw.js); the browser is asked to keep
// the saved copies rather than clear them to make room.
if ('serviceWorker' in navigator) {
  void navigator.serviceWorker
    .register('/sw.js')
    .then(() => navigator.serviceWorker.ready)
    .then(keepPageForOffline)
    .catch(() => undefined);
}
void navigator.storage?.persist?.().catch(() => false);

function createPage() {
  /** @type {readonly SessionInfo[]} */
  let sessions = [];
  /** The version of the list the page has: the next poll asks only for what changed since. */
  /** @type {number | undefined} */
  let listVersion;
  let listMinute = 0;
  /** @type {{ id: string, dispose: () => void, step: (direction: 'previous' | 'next') => void, header: ReturnType<typeof createSessionHeader>, place: () => import('./view/session-view.js').ReadingPlace, keepPlace: (change: () => void) => void, rewound: (reply: import('./model/rewind.js').RewindReply) => void } | undefined} */
  let current;
  /** Where the reader left each session opened in this tab: coming back returns there. */
  /** @type {Map<string, import('./view/session-view.js').ReadingPlace>} */
  const places = new Map();
  const rewindDialog = createRewindDialog({ onDone: (reply) => current?.rewound(reply) });

  /** @param {string} text — the search box text; following ignores it */
  const listed = (text) => listedSessions(sessions, { sdk: showSdk.checked ? 'shown' : 'hidden', search: text });

  // The list is drawn again every time a session changes — every few seconds while Claude works. A session that shows
  // the same as before keeps its element, and the list is touched only when something in it changed.
  /** @type {Map<string, { look: string, element: HTMLAnchorElement }>} */
  const items = new Map();
  const renderList = () => {
    const now = Date.now();
    const elements = listed(search.value).map((session) => {
      const title = session.title ?? 'Untitled';
      const folder = folderName(session.cwd ?? session.project);
      const ago = formatAgo(session.activeAt, now);
      const active = now - session.activeAt < activeMs;
      // Offline, a session with no saved copy cannot be read.
      const unavailable = !connection.online() && !savedMarks.has(session.id);
      const selected = session.id === current?.id;
      const look = [title, folder, ago, active, selected, unavailable].join('\u0000');
      const known = items.get(session.id);
      if (known !== undefined && known.look === look) return known.element;
      const link = h('a', { className: 'session-item', attrs: { href: `#/${session.id}` } }, [
        h('span', { className: 'session-title', text: title }),
        h('span', { className: 'session-sub' }, [h('span', { className: 'session-folder', text: folder }), h('span', { text: ago })]),
      ]);
      link.classList.toggle('active', active);
      link.classList.toggle('selected', selected);
      link.classList.toggle('unavailable', unavailable);
      items.set(session.id, { look, element: link });
      return link;
    });
    const unchanged = elements.length === list.children.length && elements.every((element, index) => list.children[index] === element);
    if (!unchanged) list.replaceChildren(...elements);
  };

  /** The sessions whose feed is saved to read offline, and how fresh each copy is. */
  /** @type {Map<string, import('./view/offline-store.js').SavedMark>} */
  let savedMarks = new Map();
  const refreshMarks = async () => {
    savedMarks = await offline.marks();
    if (!connection.online()) renderList();
  };
  void refreshMarks();
  /** The viewer does not answer: the list saved the last time it did, if the page has none yet. */
  const goOffline = async () => {
    connection.set(false);
    if (sessions.length > 0) return;
    const saved = await offline.readList();
    if (saved === undefined || sessions.length > 0) return;
    sessions = parseSessions(saved.sessions);
    renderList();
  };
  // While the viewer answers, the latest sessions worked on are saved now and then, to read when it does not — even
  // ones this browser has not opened.
  let keptAt = 0;
  const keepRecent = async () => {
    if (!connection.online() || document.visibilityState !== 'visible' || Date.now() - keptAt < keepEveryMs) return;
    keptAt = Date.now();
    const marks = await offline.marks();
    for (const id of sessionsToSave(sessions, marks, { now: Date.now(), limit: keptSessions, withinMs: keptWithinMs })) {
      // The open session keeps its own copy.
      if (id === current?.id) continue;
      const response = await fetch(`/api/snapshot?session=${encodeURIComponent(id)}&tail=${keptTail}`).catch(() => undefined);
      const snapshot = response?.ok ? await response.json().catch(() => undefined) : undefined;
      if (!isRecord(snapshot) || !Array.isArray(snapshot.entries) || typeof snapshot.earlier !== 'number') break;
      await offline.saveFeed(id, { ...feedToKeep({ entries: snapshot.entries, earlier: snapshot.earlier }, keptEntries), savedAt: Date.now() });
    }
    await refreshMarks();
  };

  /** @param {string} id */
  const open = (id) => {
    if (current?.id === id) return;
    if (current !== undefined) places.set(current.id, current.place());
    current?.dispose();
    const info = sessions.find((session) => session.id === id);
    const tables = sessionTables(id, (change) => (current === undefined ? change() : current.keepPlace(change)));
    tables.apply();
    const header = createSessionHeader({ place: info, currentBranch: () => fetchBranch(id), tables, leading: drawerButton('sessions', 'menu', 'Sessions'), navigation: [drawerButton('outline', 'list', 'Outline')], tools: settings.buttons() });
    const scroller = h('div', { className: 'scroller' });
    const outlineElement = h('aside', { className: 'outline', attrs: { 'aria-label': 'Outline' } });
    const bookmarks = createBookmarkStore(id);
    /** @type {import('./view/session-view.js').MountedSession | undefined} */
    let view;
    const outline = createOutline({
      element: outlineElement,
      onJump: (anchorId) => {
        drawers.close();
        const shown = view;
        // A bookmark in the part of a long session that is not loaded yet: the rest is loaded first.
        if (shown !== undefined && !shown.scrollToAnchor(anchorId) && shown.hasEarlier()) void shown.loadEarlier().then(() => shown.scrollToAnchor(anchorId));
      },
      onRemove: (bookmark) => bookmarks.toggle(bookmark),
    });
    outline.setBookmarks(bookmarks.list());
    const unsubscribe = bookmarks.onChange(() => outline.setBookmarks(bookmarks.list()));
    const spy = createScrollSpy(scroller, () => view?.promptElements() ?? [], outline.setCurrent);
    // While the history loads, finding the prompt on screen would lay out the growing feed on every frame:
    // the outline learns it once the feed is loaded.
    let loaded = false;
    view = mountSession({
      scroller,
      sessionId: id,
      agentId: undefined,
      bookmarks,
      onRewind: (prompt) => rewindDialog.open(id, prompt),
      startAt: places.get(id),
      keeping: {
        load: () => offline.readFeed(id),
        save: (feed) => {
          void offline.saveFeed(id, feed).then(refreshMarks);
        },
        online: () => connection.online(),
        onOnline: (listener) => connection.onOnline(listener),
      },
      listener: {
        onMeta: header.onMeta,
        onStatus(next) {
          header.onStatus(next);
          if (loaded || next === 'connecting') return;
          loaded = true;
          spy.update();
        },
        onPrompt(prompt) {
          outline.addPrompt(prompt);
          if (loaded) spy.update();
        },
        onReset: outline.clear,
      },
    });
    scroller.append(view.element);
    const composer = createComposer(id);
    const outlineResizer = createResizer({
      layout,
      width: outlineWidth,
      side: 'right',
      min: 180,
      max: () => Math.min(480, window.innerWidth * 0.35),
      measure: () => outlineElement.getBoundingClientRect().width,
      label: 'Outline width',
      className: 'outline-resizer',
    });
    main.replaceChildren(header.element, h('div', { className: 'main-body' }, [h('div', { className: 'feed-column' }, [scroller, composer.element]), outlineResizer, outlineElement]));
    const mounted = view;
    current = {
      id,
      header,
      place: () => mounted.place(),
      keepPlace: (change) => mounted.keepPlace(change),
      step: (direction) => {
        const target = spy.target(direction);
        if (target !== undefined) void mounted.scrollToAnchor(target);
      },
      // Like the terminal, the rewound message comes back into the box to be edited and sent again.
      rewound(reply) {
        composer.say(rewindMessage(reply), 'ok');
        if (reply.ok && reply.prompt !== undefined) composer.fill(reply.prompt);
      },
      dispose() {
        mounted.dispose();
        header.dispose();
        composer.dispose();
        unsubscribe();
        bookmarks.dispose();
        spy.dispose();
      },
    };
    renderList();
  };

  return {
    renderList,
    /**
     * Runs a change that resizes the open session's feed, keeping the reader at the message they were at.
     * @param {() => void} change
     */
    keepPlace(change) {
      if (current === undefined) change();
      else current.keepPlace(change);
    },
    /** @param {'previous' | 'next'} direction — move to the neighbouring prompt (Alt+↑ / Alt+↓) */
    step(direction) {
      current?.step(direction);
    },
    async refresh() {
      const response = await fetch(`/api/sessions?since=${listVersion ?? ''}`).catch(() => undefined);
      // No answer, or a proxy's error page for the viewer: out of reach.
      const reply = response?.ok ? await response.json().catch(() => undefined) : undefined;
      if (response === undefined || !isRecord(reply) || typeof reply.version !== 'number' || typeof reply.total !== 'number') {
        await goOffline();
        return;
      }
      connection.set(true);
      updateNotice.check(response.headers.get('x-viewer-build'));
      const changed = parseSessions(reply.sessions);
      const merged = listVersion === undefined ? changed : mergeSessions(sessions, changed);
      // Fewer sessions on the server than here: some were deleted — the next poll takes the whole list again.
      listVersion = merged.length === reply.total ? reply.version : undefined;
      // Re-render only when the list changed or the minute in the "5m"-style labels rolled over.
      const minute = Math.floor(Date.now() / 60_000);
      if (changed.length === 0 && minute === listMinute) return;
      listMinute = minute;
      sessions = merged;
      renderList();
      void offline.saveList(sessions);
      void keepRecent();
      const info = sessions.find((session) => session.id === current?.id);
      if (info !== undefined) current?.header.updatePlace(info);
      this.followLatest();
    },
    followLatest() {
      const [latest] = listed('');
      if (follow.checked && latest !== undefined && latest.id !== current?.id) location.hash = `#/${latest.id}`;
    },
    openFromHash() {
      const id = /^#\/([0-9a-f-]{36})$/i.exec(location.hash)?.[1];
      if (id !== undefined) open(id);
      else if (current === undefined) main.replaceChildren(emptyState);
      // A narrow screen shows the session list while the address names no session — going back to it shows the list
      // again, the session stays open behind it — and the session otherwise.
      document.documentElement.dataset.view = id === undefined ? 'list' : 'session';
    },
  };
}

/** Reading line, px from the top of the feed: the prompt whose top is above it counts as the one being read. */
const readingLinePx = 80;

/**
 * Watches the feed scroll: which prompt is being read now (highlighted in the outline) and where Alt+↑/↓ goes.
 * @param {HTMLElement} scroller
 * @param {() => readonly HTMLElement[]} prompts
 * @param {(index: number) => void} onCurrent
 */
function createScrollSpy(scroller, prompts, onCurrent) {
  const tops = () => {
    const origin = scroller.getBoundingClientRect().top;
    return prompts().map((element) => element.getBoundingClientRect().top - origin);
  };
  let frame = 0;
  const update = () => {
    if (frame !== 0) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      onCurrent(currentIndex(tops(), readingLinePx));
    });
  };
  scroller.addEventListener('scroll', update, { passive: true });
  return {
    update,
    /**
     * @param {'previous' | 'next'} direction
     * @returns {string | undefined} — data-anchor of the prompt to jump to
     */
    target(direction) {
      const index = stepTarget(tops(), { readingLine: readingLinePx, landing: jumpMarginPx }, direction);
      return index === undefined ? undefined : prompts()[index]?.dataset.anchor;
    },
    dispose() {
      scroller.removeEventListener('scroll', update);
      cancelAnimationFrame(frame);
    },
  };
}

/**
 * The view buttons in the header and their icons.
 * @type {readonly (readonly [SettingKey, string])[]}
 */
const headerSettings = [
  ['activity', 'unfold'],
  ['outline', 'list'],
  ['service', 'eye'],
  ['font', 'type'],
  ['theme', 'moon'],
  ['tables', 'table'],
];

/**
 * View settings remembered by the browser: agent actions brief or detailed, theme, answer font,
 * service messages, following, SDK sessions in the list.
 */
/** @param {(change: () => void) => void} keepPlace — runs a change keeping the reader's place in the feed */
function createSettings(keepPlace) {
  /** @param {SettingKey} key */
  const get = (key) => {
    const stored = readStorage(`viewer.${key}`);
    /** @type {readonly string[]} */
    const options = choices[key];
    return stored !== undefined && options.includes(stored) ? stored : (options[0] ?? '');
  };
  /** @param {SettingKey} key @param {string} value */
  const set = (key, value) => {
    writeStorage(`viewer.${key}`, value);
    keepPlace(applyAll);
  };
  const applyAll = () => {
    const root = document.documentElement;
    const theme = get('theme');
    if (theme === 'auto') delete root.dataset.theme;
    else root.dataset.theme = theme;
    root.dataset.font = get('font');
    root.dataset.service = get('service');
    root.dataset.outline = get('outline');
    root.dataset.tables = get('tables');
    relabelTables(document);
    const activity = get('activity');
    if (root.dataset.activity !== activity) {
      root.dataset.activity = activity;
      document.dispatchEvent(new Event(activityModeEvent));
    }
    // A button's text and tooltip name what the click will do, so they change after each toggle.
    for (const button of document.querySelectorAll('button[data-setting]')) if (button instanceof HTMLButtonElement) labelButton(button);
  };
  /** @param {HTMLButtonElement} button */
  const labelButton = (button) => {
    const key = settingKeyOf(button.dataset.setting);
    if (key === undefined) return;
    const label = actionLabel(key, get(key));
    button.title = label;
    button.setAttribute('aria-label', label);
    // The actions button shows what a click does: unfold the folded actions, or fold them back.
    const glyph = key === 'activity' ? (nextChoice(key, get(key)) === 'detailed' ? 'unfold' : 'fold') : headerSettings.find(([setting]) => setting === key)?.[1];
    // the label is hidden beside the title and shown in the menu the buttons fold into on a narrow screen
    if (glyph !== undefined) button.replaceChildren(icon(glyph), h('span', { className: 'head-tool-label', text: label }));
  };
  /** @param {SettingKey} key */
  const cycle = (key) => set(key, nextChoice(key, get(key)));
  /**
   * @param {SettingKey} key
   * @param {HTMLButtonElement} button
   */
  const settingButton = (key, button) => {
    button.dataset.setting = key;
    button.addEventListener('click', () => cycle(key));
    labelButton(button);
    return button;
  };
  const buttons = () => headerSettings.map(([key, glyph]) => settingButton(key, iconButton(glyph)));
  return { get, set, applyAll, buttons };
}

/**
 * @param {string | undefined} value — the button's data-setting
 * @returns {SettingKey | undefined}
 */
function settingKeyOf(value) {
  switch (value) {
    case 'activity':
    case 'outline':
    case 'theme':
    case 'font':
    case 'service':
    case 'follow':
    case 'sdk':
    case 'tables':
      return value;
    default:
      return undefined;
  }
}

/**
 * After the viewer is updated, a page opened earlier keeps running the old code — and on a phone there is no gesture
 * to reload it. The page knows its build from its own URL (/b/<build>/app.js) and offers to reload once the server
 * names another build.
 */
function createUpdateNotice() {
  const ownBuild = /\/b\/([0-9a-f]+)\//.exec(import.meta.url)?.[1];
  const reload = h('button', { className: 'update-reload', text: 'Reload', attrs: { type: 'button' } });
  reload.addEventListener('click', () => location.reload());
  const element = h('div', { className: 'update-notice', attrs: { role: 'status', hidden: '' } }, [h('span', { text: 'The viewer was updated' }), reload]);
  document.body.append(element);
  return {
    /** @param {string | null} serverBuild — the X-Viewer-Build header of a reply */
    check(serverBuild) {
      if (ownBuild !== undefined && serverBuild !== null && serverBuild !== ownBuild) element.hidden = false;
    },
  };
}

/**
 * The session list's width is set by dragging its right edge and remembered by the browser.
 * @param {HTMLElement} sidebar
 */
function mountSidebarResizer(sidebar) {
  /** @type {import('./view/resizer.js').PanelWidth} */
  const width = { property: '--sidebar-width', storageKey: 'viewer.sidebarWidth' };
  restoreWidth(layout, width);
  sidebar.append(
    createResizer({
      layout,
      width,
      side: 'left',
      min: 200,
      max: () => Math.min(520, window.innerWidth * 0.45),
      measure: () => sidebar.getBoundingClientRect().width,
      label: 'Session list width',
      className: 'sidebar-resizer',
    }),
  );
}

/**
 * A header button that opens a drawer; shown only on a narrow screen.
 * @param {import('./view/drawers.js').Drawer} name
 * @param {string} iconName
 * @param {string} label
 */
function drawerButton(name, iconName, label) {
  const button = iconButton(iconName);
  button.classList.add('drawer-button');
  button.dataset.drawer = name;
  button.title = label;
  button.setAttribute('aria-label', label);
  button.addEventListener('click', () => drawers.toggle(name));
  return button;
}

/**
 * Whether the viewer answers: told by the session list's polls, heard by the open session to reconnect.
 * @param {(online: boolean) => void} onChange
 */
function createConnection(onChange) {
  let online = true;
  /** @type {Set<() => void>} */
  const waiting = new Set();
  return {
    online: () => online,
    /** @param {boolean} next */
    set(next) {
      if (next === online) return;
      online = next;
      onChange(online);
      if (online) for (const listener of [...waiting]) listener();
    },
    /**
     * @param {() => void} listener — called when the viewer answers again
     * @returns {() => void} — stops listening
     */
    onOnline(listener) {
      waiting.add(listener);
      return () => waiting.delete(listener);
    },
  };
}

/**
 * The page and its files, saved for the service worker to open offline. The first visit loads them before the
 * worker runs, so the worker never sees them: the page hands them over itself — its build's files as the browser
 * loaded them, and the page as the viewer serves it now. The cache names are the ones sw.js uses.
 */
async function keepPageForOffline() {
  const files = performance
    .getEntriesByType('resource')
    .map((entry) => new URL(entry.name))
    .filter((url) => url.origin === location.origin && url.pathname.startsWith('/b/'))
    .map((url) => url.pathname);
  const pageNow = await fetch('/', { cache: 'no-store' }).catch(() => undefined);
  if (pageNow?.ok) await (await caches.open('viewer-page')).put('/', pageNow);
  await (await caches.open('viewer-files')).addAll([...new Set(files)]);
}

/** A strip at the top of the page while the viewer is out of reach. */
function createOfflineNotice() {
  const element = h('div', { className: 'offline-notice', title: 'The viewer is out of reach: the sessions saved in this browser can be read. It reconnects by itself.', attrs: { role: 'status', hidden: '' } }, [
    h('span', { className: 'offline-dot' }),
    h('span', { text: 'Offline · reading saved copies' }),
  ]);
  document.body.append(element);
  return element;
}

/**
 * The branch checked out in the session's folder now; undefined outside a repository or when the server does not say.
 * @param {string} sessionId
 * @returns {Promise<string | undefined>}
 */
async function fetchBranch(sessionId) {
  const response = await fetch(`/api/branch?session=${encodeURIComponent(sessionId)}`).catch(() => undefined);
  const json = response?.ok ? await response.json().catch(() => undefined) : undefined;
  return isRecord(json) ? text(json.branch) : undefined;
}

/**
 * @param {string} iconName
 * @returns {HTMLButtonElement}
 */
function iconButton(iconName) {
  return h('button', { className: 'icon-button', attrs: { type: 'button' } }, [icon(iconName)]);
}

/**
 * @param {unknown} json — the /api/sessions response
 * @returns {SessionInfo[]}
 */
function parseSessions(json) {
  if (!Array.isArray(json)) return [];
  return json.filter(isRecord).flatMap((item) => {
    const id = text(item.id);
    const project = text(item.project);
    if (id === undefined || project === undefined || typeof item.modifiedAt !== 'number' || typeof item.size !== 'number' || typeof item.activeAt !== 'number') return [];
    const kind = item.kind === 'sdk' ? 'sdk' : 'interactive';
    return [{ id, project, title: text(item.title), cwd: text(item.cwd), branch: text(item.branch), kind, modifiedAt: item.modifiedAt, size: item.size, activeAt: item.activeAt }];
  });
}

/**
 * @param {Element} link
 * @param {string} name
 * @returns {number | undefined}
 */
function lineAttribute(link, name) {
  const value = Number(link.getAttribute(name));
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

/** @param {string} path */
function folderName(path) {
  return path.split(/[\\/]/).filter((part) => part !== '').pop() ?? path;
}

/**
 * @template {HTMLElement} T
 * @param {string} id
 * @param {new () => T} type
 * @returns {T}
 */
function byId(id, type) {
  const element = document.getElementById(id);
  if (!(element instanceof type)) throw new Error(`Element #${id} is missing in index.html`);
  return element;
}

/** @type {readonly import('./view/session-header.js').TablesChoice[]} */
const tablesChoices = ['default', 'fit', 'wide'];

/**
 * How one session shows its tables, over the viewer-wide setting: as everywhere, fitted to the width or wide. The
 * choice is remembered by the browser per session and set on the page's root for the stylesheet.
 * @param {string} sessionId
 * @param {(change: () => void) => void} keepPlace — runs a change keeping the reader's place in the feed
 * @returns {import('./view/session-header.js').SessionTables & { apply: () => void }}
 */
function sessionTables(sessionId, keepPlace) {
  const key = `viewer.tables.${sessionId}`;
  /** @returns {import('./view/session-header.js').TablesChoice} */
  const value = () => {
    const stored = readStorage(key);
    return tablesChoices.find((choice) => choice === stored) ?? 'default';
  };
  const apply = () => {
    const choice = value();
    if (choice === 'default') delete document.documentElement.dataset.sessionTables;
    else document.documentElement.dataset.sessionTables = choice;
    relabelTables(document);
  };
  return {
    value,
    choose(choice) {
      writeStorage(key, choice);
      keepPlace(apply);
    },
    apply,
  };
}

/** @param {string} key */
function readStorage(key) {
  try {
    return localStorage.getItem(key) ?? undefined;
  } catch {
    return undefined; // storage is unavailable (private mode) — fall back to the default settings
  }
}

/** @param {string} key @param {string} value */
function writeStorage(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // storage is unavailable — the setting lasts until the page reloads
  }
}
