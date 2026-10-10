// @ts-check
// Viewer page: session list on the left, the selected session on the right. Session address is #/<id>.
import { formatAgo, formatTokens } from './model/format.js';
import { isRecord, text } from './model/narrow.js';
import { currentIndex, stepTarget } from './model/outline.js';
import { listedSessions } from './model/session-list.js';
import { actionLabel, choices, nextChoice } from './model/view-settings.js';
import { createBookmarkStore, moveLocalBookmarksToServer } from './view/bookmark-store.js';
import { createComposer } from './view/composer-view.js';
import { createRewindDialog } from './view/rewind-dialog.js';
import { rewindMessage } from './model/rewind.js';
import { createOutline } from './view/outline-view.js';
import { h } from './view/dom.js';
import { createFilePanel } from './view/file-panel.js';
import { icon } from './view/icons.js';
import { activityModeEvent, jumpMarginPx, mountSession } from './view/session-view.js';

/**
 * @typedef {{ id: string, project: string, title: string | undefined, cwd: string | undefined, branch: string | undefined, kind: 'interactive' | 'sdk', modifiedAt: number, size: number }} SessionInfo
 * @typedef {import('./view/session-view.js').SessionMeta} SessionMeta
 * @typedef {import('./view/session-view.js').SessionStatus} SessionStatus
 * @typedef {import('./model/view-settings.js').SettingKey} SettingKey
 */

const refreshMs = 4000;
/** A session written to within this many milliseconds is marked as active in the list. */
const activeMs = 2 * 60_000;

const list = byId('session-list', HTMLElement);
const search = byId('search', HTMLInputElement);
const follow = byId('follow', HTMLInputElement);
const showSdk = byId('show-sdk', HTMLInputElement);
const main = byId('main', HTMLElement);
const emptyState = byId('empty-state', HTMLElement);
const updateNotice = createUpdateNotice();

const drawers = createDrawers(byId('drawer-backdrop', HTMLElement));
const settings = createSettings();
const page = createPage();
const filePanel = createFilePanel({ panel: byId('file-panel', HTMLElement), layout: byId('layout', HTMLElement) });
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
  drawers.close();
  page.openFromHash();
});
// Bookmarks the browser kept before they moved to the server go there before a session opens.
void moveLocalBookmarksToServer()
  .then(() => page.refresh())
  .then(() => page.openFromHash());
setInterval(() => void page.refresh(), refreshMs);

function createPage() {
  /** @type {readonly SessionInfo[]} */
  let sessions = [];
  let listKey = '';
  /** @type {{ id: string, dispose: () => void, step: (direction: 'previous' | 'next') => void, header: ReturnType<typeof sessionHeader>, rewound: (reply: import('./model/rewind.js').RewindReply) => void } | undefined} */
  let current;
  const rewindDialog = createRewindDialog({ onDone: (reply) => current?.rewound(reply) });

  /** @param {string} text — the search box text; following ignores it */
  const listed = (text) => listedSessions(sessions, { sdk: showSdk.checked ? 'shown' : 'hidden', search: text });

  const renderList = () => {
    const now = Date.now();
    const shown = listed(search.value);
    list.replaceChildren(
      ...shown.map((session) => {
        const link = h('a', { className: 'session-item', attrs: { href: `#/${session.id}` } }, [
          h('span', { className: 'session-title', text: session.title ?? 'Untitled' }),
          h('span', { className: 'session-sub' }, [
            h('span', { className: 'session-folder', text: folderName(session.cwd ?? session.project) }),
            h('span', { text: formatAgo(session.modifiedAt, now) }),
          ]),
        ]);
        if (now - session.modifiedAt < activeMs) link.classList.add('active');
        if (session.id === current?.id) link.classList.add('selected');
        return link;
      }),
    );
  };

  /** @param {string} id */
  const open = (id) => {
    if (current?.id === id) return;
    current?.dispose();
    const info = sessions.find((session) => session.id === id);
    const header = sessionHeader(info);
    const scroller = h('div', { className: 'scroller' });
    const outlineElement = h('aside', { className: 'outline', attrs: { 'aria-label': 'Outline' } });
    const bookmarks = createBookmarkStore(id);
    /** @type {import('./view/session-view.js').MountedSession | undefined} */
    let view;
    const outline = createOutline({
      element: outlineElement,
      onJump: (anchorId) => {
        drawers.close();
        void view?.scrollToAnchor(anchorId);
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
    main.replaceChildren(header.element, h('div', { className: 'main-body' }, [h('div', { className: 'feed-column' }, [scroller, composer.element]), outlineElement]));
    const mounted = view;
    current = {
      id,
      header,
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
    /** @param {'previous' | 'next'} direction — move to the neighbouring prompt (Alt+↑ / Alt+↓) */
    step(direction) {
      current?.step(direction);
    },
    async refresh() {
      const response = await fetch('/api/sessions').catch(() => undefined);
      if (response === undefined || !response.ok) return;
      updateNotice.check(response.headers.get('x-viewer-build'));
      const body = await response.text();
      // Re-render only when the list changed or the minute in the "5m"-style labels rolled over.
      const key = `${body.length}:${hash(body)}:${Math.floor(Date.now() / 60_000)}`;
      if (key === listKey) return;
      listKey = key;
      sessions = parseSessions(JSON.parse(body));
      renderList();
      const info = sessions.find((session) => session.id === current?.id);
      if (info !== undefined) current?.header.updateInfo(info);
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
      // A narrow screen shows either the session list or the open session.
      document.documentElement.dataset.view = current === undefined ? 'list' : 'session';
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
 * The session's status as an icon; the words are in its tooltip.
 * @type {Readonly<Record<SessionStatus, { label: string, glyph: () => HTMLElement }>>}
 */
const statusLooks = {
  connecting: { label: 'Loading…', glyph: () => icon('reload') },
  missing: { label: 'Transcript not found', glyph: () => icon('alert') },
  idle: { label: 'Waiting for input', glyph: () => icon('message') },
  working: { label: 'Working', glyph: () => h('span', { className: 'spark', text: '✻' }) },
};

/**
 * Session header: title, folder, model, context size, cost and status.
 * @param {SessionInfo | undefined} info
 */
function sessionHeader(info) {
  const title = h('h1', { className: 'title', text: info?.title ?? 'Session' });
  const sub = h('div', { className: 'head-sub' });
  const status = h('span', { className: 'status', attrs: { role: 'status' } });
  const actions = h('div', { className: 'head-actions' }, [status, drawerButton('outline', 'list', 'Outline'), ...settings.buttons()]);
  const element = h('header', { className: 'session-head' }, [drawerButton('sessions', 'menu', 'Sessions'), h('div', { className: 'head-main' }, [title, sub]), actions]);
  /** @type {SessionMeta} */
  let meta = {};
  let place = info;

  const renderSub = () => {
    const parts = [
      place?.cwd,
      place?.branch === undefined || place.branch === 'HEAD' ? undefined : `⎇ ${place.branch}`,
      meta.model,
      meta.contextTokens === undefined ? undefined : `context ${formatTokens(meta.contextTokens)}`,
      meta.costUsd === undefined ? undefined : `$${meta.costUsd.toFixed(2)}`,
    ].filter((part) => part !== undefined);
    sub.replaceChildren(...parts.map((part) => h('span', { text: part })));
  };
  renderSub();

  return {
    element,
    /** @param {SessionMeta} next */
    onMeta(next) {
      meta = next;
      title.textContent = meta.customTitle ?? meta.title ?? place?.title ?? 'Session';
      document.title = `${title.textContent} — Claude Code`;
      renderSub();
    },
    /** @param {SessionStatus} next */
    onStatus(next) {
      const look = statusLooks[next];
      status.dataset.status = next;
      status.title = look.label;
      status.setAttribute('aria-label', look.label);
      status.replaceChildren(look.glyph());
    },
    /** @param {SessionInfo} next */
    updateInfo(next) {
      place = next;
      renderSub();
    },
  };
}

/**
 * View settings remembered by the browser: agent actions brief or detailed, theme, answer font,
 * service messages, following, SDK sessions in the list.
 */
function createSettings() {
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
    applyAll();
  };
  const applyAll = () => {
    const root = document.documentElement;
    const theme = get('theme');
    if (theme === 'auto') delete root.dataset.theme;
    else root.dataset.theme = theme;
    root.dataset.font = get('font');
    root.dataset.service = get('service');
    root.dataset.outline = get('outline');
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
    if (key === 'activity') button.replaceChildren(icon(nextChoice(key, get(key)) === 'detailed' ? 'unfold' : 'fold'));
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
  const buttons = () => [
    settingButton('activity', iconButton('unfold')),
    settingButton('outline', iconButton('list')),
    settingButton('service', iconButton('eye')),
    settingButton('font', iconButton('type')),
    settingButton('theme', iconButton('moon')),
  ];
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
 * On a narrow screen the session list and the outline do not fit beside the feed: they slide over it as drawers,
 * one at a time, and close on a tap outside, Esc, or once something in them is chosen.
 * @param {HTMLElement} backdrop
 */
function createDrawers(backdrop) {
  const root = document.documentElement;
  const close = () => {
    delete root.dataset.drawer;
  };
  backdrop.addEventListener('click', close);
  return {
    close,
    isOpen: () => root.dataset.drawer !== undefined,
    /** @param {'sessions' | 'outline'} name */
    toggle(name) {
      if (root.dataset.drawer === name) close();
      else root.dataset.drawer = name;
    },
  };
}

/**
 * A header button that opens a drawer; shown only on a narrow screen.
 * @param {'sessions' | 'outline'} name
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
    if (id === undefined || project === undefined || typeof item.modifiedAt !== 'number' || typeof item.size !== 'number') return [];
    const kind = item.kind === 'sdk' ? 'sdk' : 'interactive';
    return [{ id, project, title: text(item.title), cwd: text(item.cwd), branch: text(item.branch), kind, modifiedAt: item.modifiedAt, size: item.size }];
  });
}

/**
 * A short fingerprint of a string, to notice a list change without comparing it in full.
 * @param {string} value
 */
function hash(value) {
  let result = 0;
  for (let index = 0; index < value.length; index++) result = (result * 31 + value.charCodeAt(index)) | 0;
  return result;
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
