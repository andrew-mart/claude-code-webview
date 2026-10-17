// @ts-check
// Session feed: subscribes to the entry stream and renders entries as they arrive.
import { expandedRows, layoutActivity } from '../model/activity.js';
import { anchorLabel } from '../model/bookmarks.js';
import { interpretEntry } from '../model/entry.js';
import { formatDuration, formatTokens } from '../model/format.js';
import { isRecord, text } from '../model/narrow.js';
import { h } from './dom.js';
import { inlineImage } from './picture.js';
import { icon } from './icons.js';
import { renderMarkdown } from './markdown.js';
import { createFeedCopy } from '../model/feed-copy.js';
import { parseSessionStatus } from '../model/session-status.js';
import { keptEntries, lastActivityOf } from '../model/offline.js';
import { queueAfter, waitingPrompts } from '../model/queue.js';
import { sentBubble, waitingBubble } from './waiting-bubble.js';
import { createToolRow } from './tool-view.js';

/**
 * @typedef {import('../model/entry.js').DisplayEvent} DisplayEvent
 * @typedef {{ title?: string, customTitle?: string, model?: string, contextTokens?: number, contextWindow?: number, contextAt?: number, effort?: string, costUsd?: number, extendedContext?: boolean }} SessionMeta
 * @typedef {'connecting' | 'missing' | 'idle' | 'working'} SessionStatus
 * @typedef {import('../model/bookmarks.js').Bookmark} Anchor — a message one can come back to: a prompt, an answer, a subagent report
 * @typedef {{ onMeta: (meta: SessionMeta) => void, onStatus: (status: SessionStatus) => void, onPrompt: (prompt: Anchor) => void, onReset: () => void }} SessionListener
 * @typedef {(wanted: import('./feed-hub.js').Wanted) => import('./feed-hub.js').FeedSource} OpenFeed — a session's feed from
 *   the viewer, over the page's stream (feed-hub.js)
 * @typedef {{ anchor: (anchor: Anchor, content: HTMLElement) => HTMLElement, onPrompt: (prompt: Anchor) => void, loadEntry: import('./tool-view.js').LoadEntry, sendQueueNow: (() => void) | undefined, openFeed: OpenFeed }} FeedHooks — sendQueueNow:
 *   what waits in Claude Code's queue, sent now; none where nothing can be sent; openFeed: for a subagent's transcript
 * @typedef {{ element: HTMLElement, dispose: () => void, scrollToAnchor: (id: string) => boolean, promptElements: () => readonly HTMLElement[], place: () => ReadingPlace, hasEarlier: () => boolean, loadEarlier: () => Promise<void>, keepPlace: (change: () => void) => void, expectPrompt: (text: string) => void, pause: () => void, resume: () => void, restore: (place: ReadingPlace) => void }} MountedSession
 * pause — the session put out of sight, kept as it is shown: its feed let go of; resume — shown again: the feed asked
 * for again, from its copy; restore — the reader taken back to the place they were at;
 * expectPrompt — a prompt sent from the page: shown, as sent, until Claude Code writes it down;
 * hasEarlier — the session opened with its latest part, the rest is not loaded; loadEarlier loads it;
 * keepPlace — runs a change that resizes the feed (a font, wide tables) keeping the reader at the same message
 * Where the reader is in the feed: at the bottom, following new messages, or at a message — the one at the top of the
 * view, offset px below the view's top edge (negative: partly scrolled past).
 * @typedef {{ kind: 'bottom' } | { kind: 'message', id: string, offset: number }} ReadingPlace
 * The session's copy kept to read offline (view/offline-store.js) and whether the viewer answers now.
 * @typedef {{ load: () => Promise<import('./offline-store.js').SavedFeed | undefined>, save: (feed: import('./offline-store.js').SavedFeed) => void, online: () => boolean, onOnline: (listener: () => void) => () => void }} Keeping
 */

/** Gap between a jumped-to message and the top of the scroll area, px. */
export const jumpMarginPx = 16;

/** A session with no new entries for longer than this counts as stopped, even if the turn has not ended. */
const staleMs = 15 * 60_000;
/** The feed follows new messages only from its very bottom: a line above it, the reader is reading the history. */
const stickPx = 8;
/**
 * How many of the latest entries a session opens with — hours of work; the earlier ones load on request. A phone lays
 * out a few thousand entries for seconds, so it starts with fewer.
 */
const initialTail = { wide: 2000, narrow: 800 };
/** New entries are kept for reading offline at most this often. */
const keepDelayMs = 15_000;
/** Out of reach, the viewer is tried again this often even without news that it answers. */
const retryMs = 20_000;

/**
 * @param {{ scroller: HTMLElement, sessionId: string, agentId: string | undefined, bookmarks: import('./bookmark-store.js').BookmarkStore | undefined, onRewind: ((prompt: Anchor) => void) | undefined, listener: SessionListener, startAt: ReadingPlace | undefined, keeping: Keeping | undefined, sendQueueNow: (() => void) | undefined, openFeed: OpenFeed }} options
 * — bookmarks: undefined for a nested subagent feed, which has no bookmarks; onRewind: likewise, a subagent cannot be rewound;
 * startAt — where the reader left the session last time; undefined — at the bottom; keeping — the copy kept to read
 * offline and to go on from, undefined for a nested subagent feed; openFeed: the session's feed from the viewer
 * @returns {MountedSession}
 */
export function mountSession({ scroller, sessionId, agentId, bookmarks, onRewind, listener, startAt, keeping, sendQueueNow, openFeed }) {
  // The history arrives in batches of a thousand entries: laid out after each, a long session would be laid out again
  // and again as it grows. It stays hidden until the whole history is in, then is shown once, at the bottom.
  const thread = h('div', { className: 'thread', attrs: { hidden: '' } });
  // Meanwhile the reader sees that it loads, and how far it got.
  const loadingCount = h('span', { className: 'loading-count' });
  const loadingText = h('span', { text: 'Loading the session…' });
  const loading = h('div', { className: 'loading', attrs: { role: 'status' } }, [h('span', { className: 'spark', text: '✻' }), loadingText, loadingCount]);
  // A long session opens with its latest part; the rest comes on request.
  const earlier = h('button', { className: 'earlier', attrs: { type: 'button', hidden: '' } });
  const working = h('div', { className: 'working', attrs: { hidden: '' } }, [h('span', { className: 'spark', text: '✻' }), h('span', { text: 'Working…' })]);
  const jump = h('button', { className: 'jump', title: 'Jump to the latest message', attrs: { type: 'button', hidden: '' } }, [icon('down')]);
  const waitingBox = h('div', { className: 'waiting-prompts', attrs: { hidden: '' } });
  // The copy kept from the last time shows at once while the viewer sends the session, marked as being brought up to
  // date — or, the viewer out of reach, as the copy it is — under its latest message, where the reader looks as a session
  // opens; the session the viewer sends takes its place.
  const keptThread = h('div', { className: 'thread kept', attrs: { hidden: '' } });
  const updatingText = h('span', { text: 'Updating…' });
  const updating = h('div', { className: 'updating', attrs: { role: 'status', hidden: '' } }, [h('span', { className: 'spark', text: '✻' }), updatingText]);
  const element = h('div', { className: 'session' }, [earlier, keptThread, updating, thread, loading, working, waitingBox, jump]);
  const anchors = createAnchors(bookmarks, onRewind);
  /** @type {HTMLElement[]} */
  const prompts = [];
  /**
   * A whole entry of this session's transcript, for a tool row whose output the stream left out.
   * @param {number} full — where the entry's line starts
   * @returns {Promise<unknown>}
   */
  const loadEntry = async (full) => {
    const query = new URLSearchParams({ session: sessionId, at: String(full) });
    if (agentId !== undefined) query.set('agent', agentId);
    const response = await fetch(`/api/entry?${query}`);
    if (!response.ok) throw new Error(`The viewer server gave no entry at ${full} of session ${sessionId}: ${response.status}`);
    return response.json();
  };
  const feed = createFeed({ thread, waitingBox }, sessionId, {
    loadEntry,
    sendQueueNow,
    openFeed,
    anchor: anchors.decorate,
    onPrompt(prompt) {
      const promptElement = anchors.find(prompt.id);
      if (promptElement !== undefined) prompts.push(promptElement);
      listener.onPrompt(prompt);
    },
  });
  const unsubscribe = bookmarks?.onChange(anchors.refresh);
  const resetFeed = () => {
    feed.reset();
    anchors.clear();
    prompts.length = 0;
    listener.onReset();
  };
  /** @type {SessionMeta} */
  let meta = {};
  /** @type {import('../model/session-status.js').SessionStatus | undefined} */
  let sessionStatus;
  /** The viewer has sent the session — or gone on from the copy shown. */
  let ready = false;
  /** The feed is shown: the session the viewer sent, or the copy kept, gone on from. */
  let shown = false;
  let received = 0;
  /** @type {(() => void)[]} */
  let onReady = [];

  const nearBottom = () => scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= stickPx;
  const toBottom = () => {
    scroller.scrollTop = scroller.scrollHeight;
  };
  // Once loaded, the feed stays at the newest messages until the reader scrolls up: images that load late and a box
  // that grows below the feed (an attachment, a phone keyboard) would otherwise leave it short of the bottom.
  let stuck = true;
  const keepAtBottom = new ResizeObserver(() => {
    if (shown && stuck) toBottom();
  });
  keepAtBottom.observe(thread);
  keepAtBottom.observe(scroller);
  const refreshStatus = () => {
    const live = feed.isWorking() && Date.now() - feed.lastActivity() < staleMs;
    working.hidden = !(ready && live);
    listener.onStatus(ready ? (live ? 'working' : 'idle') : 'connecting');
  };

  /** The feed starts over: the reader stays where they were once the history is in again, what they saw in view meanwhile. */
  const startOver = () => {
    resumeAt = currentPlace();
    keepStale();
    resetFeed();
    meta = {};
    ready = false;
    shown = false;
    received = 0;
    copy = createFeedCopy(undefined);
    thread.hidden = true;
    earlier.hidden = true;
    loading.hidden = !keptThread.hidden;
    loadingCount.textContent = '';
  };
  /** What the reader saw stays in view, marked as being brought up to date, while the session comes anew in its place. */
  const keepStale = () => {
    if (thread.hidden || thread.childElementCount === 0) return;
    keptThread.replaceChildren(...thread.childNodes);
    keptThread.hidden = false;
    thread.hidden = true;
    keptThread.after(updating);
    updatingText.textContent = 'Updating…';
    updating.hidden = false;
  };
  /** How many entries are not loaded, on the button that loads them. @param {number} count */
  const showEarlier = (count) => {
    earlier.textContent = `Show ${count.toLocaleString('en-US')} earlier entries`;
    earlier.hidden = !(count > 0);
  };
  /**
   * The session's feed from the viewer, over the page's stream: from the copy held — what came since alone — or, with
   * none to go on from, from its start.
   * @param {number | undefined} tail — how many of the latest entries to start with; undefined — the whole session
   * @returns {import('./feed-hub.js').FeedSource}
   */
  const connect = (tail) => {
    const next = openFeed({ session: sessionId, ...(agentId === undefined ? {} : { agent: agentId }), ...(tail === undefined ? {} : { tail }), from: () => copy.goOnFrom() });
    let opened = false;
    next.on('open', (data) => {
      // a reconnect with no copy to go on from: the viewer sends the session from its start
      if (opened && !(isRecord(data) && data.resumed === true)) startOver();
      opened = true;
      if (!keptThread.hidden) updatingText.textContent = 'Updating…';
    });
    next.on('error', () => {
      // The viewer is out of reach: the kept copy meanwhile. A stream refused outright (a proxy's error page) is not
      // retried by the browser — it is opened again when the viewer answers.
      if (!shown) void showKept('out of reach');
      if (next.closed()) waitForViewer();
    });
    next.on('earlier', (data) => {
      copy.take('earlier', data);
      showEarlier(copy.earlier());
    });
    next.on('session-status', (data) => {
      const status = parseSessionStatus(data);
      if (status === undefined || (sessionStatus !== undefined && status.at < sessionStatus.at)) return;
      sessionStatus = status;
      listener.onMeta(metaWithStatus(meta, sessionStatus));
    });
    next.on('entries', (data) => {
      const entries = Array.isArray(data) ? data : [];
      copy.take('entries', entries);
      if (ready) scheduleKeep();
      const update = feed.apply(entries);
      if (Object.keys(update).length > 0) {
        meta = { ...meta, ...update };
        listener.onMeta(metaWithStatus(meta, sessionStatus));
      }
      if (!ready) {
        received += entries.length;
        loadingCount.textContent = `${received.toLocaleString('en-US')} entries`;
      }
      if (shown && stuck) toBottom();
      if (ready) refreshStatus();
    });
    next.on('cursor', (data) => {
      // the copy held is not what the viewer says it sent, whatever went wrong: read anew
      if (copy.take('cursor', data) === 'out-of-step') readAnew();
    });
    next.on('ready', () => {
      ready = true;
      if (shown) {
        updating.hidden = true;
        refreshStatus();
      } else showFeed();
      keepNow();
      const waiting = onReady;
      onReady = [];
      for (const resolve of waiting) resolve();
    });
    next.on('reset', () => {
      copy.take('reset', null);
      // a copy shown that the viewer could not go on from: it stays in view while the session comes whole
      if (shown && !ready) {
        keepStale();
        shown = false;
        loading.hidden = !keptThread.hidden;
      }
      resetFeed();
      meta = {};
      earlier.hidden = true;
    });
    next.on('missing', () => {
      loading.hidden = true;
      listener.onStatus('missing');
    });
    return next;
  };
  /** The copy held is out of step with the viewer: dropped, and the session read anew from its start. */
  const readAnew = () => {
    console.warn(`The feed of session ${sessionId}${agentId === undefined ? '' : ` (subagent ${agentId})`} was out of step with the viewer: it is read anew`);
    source?.close();
    startOver();
    source = connect(tail);
  };
  /** The history in — or the copy kept, gone on from — the feed is shown once, at the reader's place, in place of a copy kept. */
  const showFeed = () => {
    keptThread.replaceChildren();
    keptThread.hidden = true;
    updating.hidden = true;
    thread.hidden = false;
    loading.hidden = true;
    shown = true;
    const returned = resumeAt?.kind === 'message' && returnTo(resumeAt);
    resumeAt = undefined;
    stuck = !returned;
    if (stuck) toBottom();
    jump.hidden = stuck;
    refreshStatus();
  };
  // What the server sent, kept to read offline and to go on from: once the history is in, then at most every so often,
  // and when the page is put away or the session closed.
  let copy = createFeedCopy(undefined);
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let keepTimer;
  const keepNow = () => {
    clearTimeout(keepTimer);
    keepTimer = undefined;
    if (keeping === undefined || !ready) return;
    const kept = copy.kept(keptEntries);
    if (kept.entries.length === 0) return;
    keeping.save({ entries: [...kept.entries], earlier: kept.earlier, token: kept.token, lastActivity: lastActivityOf(kept.entries), savedAt: Date.now() });
  };
  const scheduleKeep = () => {
    keepTimer ??= setTimeout(keepNow, keepDelayMs);
  };
  const onHidden = () => {
    if (document.visibilityState === 'hidden') keepNow();
  };
  document.addEventListener('visibilitychange', onHidden);
  /**
   * The copy kept the last time, read, in a feed of its own until the session the viewer sends is in: shown once.
   * @param {'in reach' | 'out of reach'} viewer — whether the viewer answers, or the copy is all there is
   */
  const showKept = async (viewer) => {
    if (keeping === undefined) return;
    if (!keptThread.hidden) {
      if (viewer === 'out of reach') updatingText.textContent = 'Offline · the copy kept from before';
      return;
    }
    showKeptCopy(await keeping.load(), viewer);
  };
  /**
   * The copy kept the last time, in a feed of its own until the session the viewer sends is in.
   * @param {import('./offline-store.js').SavedFeed | undefined} saved
   * @param {'in reach' | 'out of reach'} viewer
   */
  const showKeptCopy = (saved, viewer) => {
    if (shown || !keptThread.hidden) return;
    if (saved === undefined) {
      if (viewer === 'out of reach') {
        loadingText.textContent = 'The viewer is out of reach, and this session is not saved to read offline.';
        loadingCount.textContent = '';
      }
      return;
    }
    const keptFeed = createFeed({ thread: keptThread, waitingBox: h('div') }, sessionId, { loadEntry, sendQueueNow: undefined, anchor: (_, content) => content, onPrompt: () => {}, openFeed });
    const update = keptFeed.apply(saved.entries);
    if (Object.keys(update).length > 0) listener.onMeta(metaWithStatus({ ...update, ...meta }, sessionStatus));
    keptThread.after(updating);
    updatingText.textContent = viewer === 'out of reach' ? 'Offline · the copy kept from before' : 'Updating…';
    keptThread.hidden = false;
    updating.hidden = false;
    loading.hidden = true;
    toBottom();
  };
  /**
   * The copy kept the last time, shown at once as the session itself — the viewer sends what came since alone: its
   * latest so many entries, those before counted as earlier, marked as being brought up to date under its latest message.
   * @param {{ entries: readonly unknown[], earlier: number, token: string }} saved
   * @param {number | undefined} tail
   */
  const showCopy = (saved, tail) => {
    const dropped = tail === undefined ? 0 : Math.max(saved.entries.length - tail, 0);
    const entries = saved.entries.slice(dropped);
    copy = createFeedCopy({ entries, earlier: saved.earlier + dropped, token: saved.token });
    const update = feed.apply(entries);
    if (Object.keys(update).length > 0) {
      meta = { ...meta, ...update };
      listener.onMeta(metaWithStatus(meta, sessionStatus));
    }
    showEarlier(copy.earlier());
    showFeed();
    thread.after(updating);
    updatingText.textContent = 'Updating…';
    updating.hidden = false;
  };
  /** @type {(() => void) | undefined} */
  let stopWaiting;
  /** The stream is opened again once the viewer answers — or, failing that news, after a while anyway. */
  const waitForViewer = () => {
    if (keeping === undefined || stopWaiting !== undefined) return;
    const retry = () => {
      stopWaiting?.();
      stopWaiting = undefined;
      source?.close();
      source = connect(tail);
    };
    const unsubscribeOnline = keeping.onOnline(retry);
    const retryTimer = setTimeout(retry, retryMs);
    stopWaiting = () => {
      unsubscribeOnline();
      clearTimeout(retryTimer);
    };
  };
  /** How many of the latest entries the stream starts with; undefined once the whole session was asked for. */
  /** @type {number | undefined} */
  let tail = matchMedia('(max-width: 820px)').matches ? initialTail.narrow : initialTail.wide;
  /** @type {import('./feed-hub.js').FeedSource | undefined} */
  let source;
  let disposed = false;
  /** The session out of sight, its feed let go of until it is shown again. */
  let paused = false;
  if (keeping === undefined) source = connect(tail);
  else {
    const kept = keeping;
    // the copy kept first: gone on from when it has a token and the viewer answers, else shown until the session is in
    void kept
      .load()
      .catch(() => undefined)
      .then((saved) => {
        if (disposed || paused) return;
        if (saved !== undefined && saved.token !== undefined && kept.online()) showCopy({ entries: saved.entries, earlier: saved.earlier, token: saved.token }, tail);
        else showKeptCopy(saved, kept.online() ? 'in reach' : 'out of reach');
        source = connect(tail);
      });
  }
  /**
   * The whole session, the reader staying at the message they were at.
   * @returns {Promise<void>} — once it is in
   */
  const loadEarlier = () => {
    source?.close();
    startOver();
    tail = undefined;
    source = connect(tail);
    return new Promise((resolve) => onReady.push(resolve));
  };
  earlier.addEventListener('click', () => void loadEarlier());
  // Scrolling up lets go of the bottom and shows the button back to it; reaching the bottom sticks to it again.
  const onScroll = () => {
    if (!shown) return;
    stuck = nearBottom();
    jump.hidden = stuck;
  };
  scroller.addEventListener('scroll', onScroll, { passive: true });
  jump.addEventListener('click', () => {
    stuck = true;
    toBottom();
    jump.hidden = true;
  });
  /** @returns {ReadingPlace} */
  const currentPlace = () => {
    if (!shown || stuck) return { kind: 'bottom' };
    const top = scroller.getBoundingClientRect().top;
    const message = [...thread.querySelectorAll('[data-anchor]')].find((anchored) => anchored.getBoundingClientRect().bottom > top);
    return message instanceof HTMLElement && message.dataset.anchor !== undefined ? { kind: 'message', id: message.dataset.anchor, offset: message.getBoundingClientRect().top - top } : { kind: 'bottom' };
  };
  /**
   * @param {{ id: string, offset: number }} place
   * @returns {boolean} — false if the message is no longer in the feed (the session was rewound)
   */
  const returnTo = ({ id, offset }) => {
    const message = anchors.find(id);
    if (message === undefined) return false;
    scroller.scrollTop += message.getBoundingClientRect().top - scroller.getBoundingClientRect().top - offset;
    return true;
  };
  /** @type {ReadingPlace | undefined} */
  let resumeAt = startAt;
  const timer = setInterval(refreshStatus, 30_000);
  const relayout = () => feed.relayout();
  document.addEventListener(activityModeEvent, relayout);

  return {
    element,
    dispose() {
      disposed = true;
      keepNow();
      stopWaiting?.();
      document.removeEventListener('visibilitychange', onHidden);
      source?.close();
      onReady = [];
      clearInterval(timer);
      document.removeEventListener(activityModeEvent, relayout);
      scroller.removeEventListener('scroll', onScroll);
      keepAtBottom.disconnect();
      unsubscribe?.();
    },
    scrollToAnchor(id) {
      const target = anchors.find(id);
      if (target === undefined) return false;
      const top = scroller.scrollTop + target.getBoundingClientRect().top - scroller.getBoundingClientRect().top - jumpMarginPx;
      // Long jump: most of the way instantly, the last screen smoothly, so the direction is visible.
      const distance = top - scroller.scrollTop;
      if (Math.abs(distance) > scroller.clientHeight * 2) scroller.scrollTop = top - Math.sign(distance) * scroller.clientHeight;
      scroller.scrollTo({ top, behavior: 'smooth' });
      // The highlight shows exactly where the jump landed; the animation restarts via a reflow.
      target.classList.remove('flash');
      void target.offsetWidth;
      target.classList.add('flash');
      return true;
    },
    promptElements: () => prompts,
    pause() {
      if (paused || disposed) return;
      paused = true;
      keepNow();
      stopWaiting?.();
      stopWaiting = undefined;
      source?.close();
      source = undefined;
    },
    resume() {
      if (!paused || disposed) return;
      paused = false;
      // entries held past the copy's token would be sent again: the session comes anew instead
      if (copy.goOnFrom() === undefined) startOver();
      source = connect(tail);
    },
    restore(place) {
      if (!shown) return;
      stuck = !(place.kind === 'message' && returnTo(place));
      if (stuck) toBottom();
      jump.hidden = stuck;
    },
    hasEarlier: () => !earlier.hidden,
    loadEarlier,
    expectPrompt(text) {
      feed.expect(text);
    },
    keepPlace(change) {
      // At the bottom the feed keeps following it by itself.
      if (!shown || stuck) {
        change();
        return;
      }
      // What is at the top edge of the view — a paragraph, a table row — stays there; a whole message would be too
      // coarse: the change may be inside it.
      const view = scroller.getBoundingClientRect();
      const atTop = document.elementFromPoint(view.left + view.width / 2, view.top + 4);
      const anchor = atTop instanceof HTMLElement && thread.contains(atTop) ? atTop : undefined;
      const before = anchor?.getBoundingClientRect().top;
      const place = currentPlace();
      change();
      if (anchor !== undefined && before !== undefined && anchor.isConnected) scroller.scrollTop += anchor.getBoundingClientRect().top - before;
      else if (place.kind === 'message') returnTo(place);
    },
    place: currentPlace,
  };
}

/**
 * A fresh statusline can describe a session with no messages yet. Replaying older messages must not replace it;
 * newer answers keep their own token counts and can reuse the reported window for the same model.
 * @param {SessionMeta} meta
 * @param {import('../model/session-status.js').SessionStatus | undefined} status
 * @returns {SessionMeta}
 */
function metaWithStatus(meta, status) {
  if (status === undefined) return meta;
  const next = { ...meta };
  const sameModel = meta.model === status.model;
  if (meta.contextAt !== undefined && Number.isFinite(meta.contextAt) && meta.contextAt > status.at) {
    if (sameModel && status.contextWindow !== undefined) next.contextWindow = status.contextWindow;
    if (sameModel && meta.effort === undefined && status.effort !== undefined) next.effort = status.effort;
    return next;
  }
  next.model = status.model;
  next.contextAt = status.at;
  if (status.contextTokens !== undefined) next.contextTokens = status.contextTokens;
  else if (!sameModel) delete next.contextTokens;
  if (status.contextWindow !== undefined) next.contextWindow = status.contextWindow;
  else if (!sameModel) delete next.contextWindow;
  if (status.effort !== undefined) next.effort = status.effort;
  else if (!sameModel) delete next.effort;
  return next;
}

/**
 * Messages one can come back to: each has a bookmark flag — an answer one under it as well, where it is read to its
 * end — and its element can be found by id.
 * @param {import('./bookmark-store.js').BookmarkStore | undefined} bookmarks
 * @param {((prompt: Anchor) => void) | undefined} onRewind — offers to rewind to a prompt; undefined in a subagent feed
 */
function createAnchors(bookmarks, onRewind) {
  /** @type {Map<string, { element: HTMLElement, buttons: readonly HTMLButtonElement[] }>} */
  const registry = new Map();
  const press = (/** @type {HTMLButtonElement} */ button, /** @type {boolean} */ on) => {
    button.classList.toggle('on', on);
    button.setAttribute('aria-pressed', String(on));
    // The tooltip names the action the click will perform.
    button.title = on ? 'Remove bookmark' : 'Bookmark this message';
  };
  return {
    /**
     * A prompt already sits in a .msg.user row, so the flag goes left of the bubble; answers and reports get wrapped.
     * @param {Anchor} anchor
     * @param {HTMLElement} content
     * @returns {HTMLElement}
     */
    decorate(anchor, content) {
      const holder = anchor.kind === 'prompt' ? content : h('div', { className: 'anchored' }, [content]);
      holder.classList.add('anchor');
      holder.dataset.anchor = anchor.id;
      /** @type {HTMLButtonElement[]} */
      const buttons = [];
      if (bookmarks !== undefined) {
        const store = bookmarks;
        /** @param {string} className */
        const flag = (className) => {
          const button = h('button', { className, attrs: { type: 'button' } }, [icon('bookmark')]);
          button.addEventListener('click', (event) => {
            event.stopPropagation();
            store.toggle(anchor);
          });
          press(button, store.has(anchor.id));
          buttons.push(button);
          return button;
        };
        holder.prepend(flag('bookmark-toggle'));
        if (anchor.kind === 'answer') holder.append(flag('bookmark-toggle bookmark-under'));
      }
      // A prompt can be rewound to, as with Esc Esc in the terminal.
      if (anchor.kind === 'prompt' && onRewind !== undefined) {
        const rewind = h('button', { className: 'rewind-toggle', title: 'Rewind to before this message', attrs: { type: 'button', 'aria-label': 'Rewind to before this message' } }, [icon('rewind')]);
        rewind.addEventListener('click', (event) => {
          event.stopPropagation();
          onRewind(anchor);
        });
        holder.prepend(rewind);
      }
      registry.set(anchor.id, { element: holder, buttons });
      return holder;
    },
    refresh() {
      for (const [id, { buttons }] of registry) for (const button of buttons) if (bookmarks !== undefined) press(button, bookmarks.has(id));
    },
    /** @param {string} id */
    find: (id) => registry.get(id)?.element,
    clear: () => registry.clear(),
  };
}

/**
 * Lays events out in the feed: prompts and markers as separate rows, Claude's answer as a turn block,
 * consecutive thinking and tool calls within a turn as one group. Under the feed — the prompts waiting in Claude
 * Code's queue (model/queue.js), until Claude takes them and they come as messages.
 * @param {{ thread: HTMLElement, waitingBox: HTMLElement }} parts
 * @param {string} sessionId
 * @param {FeedHooks} hooks
 */
function createFeed({ thread, waitingBox }, sessionId, hooks) {
  /** @type {import('../model/queue.js').Queue} */
  let queue = [];
  /** Prompts sent from the page that Claude Code has not written down yet: each goes once it does. */
  /** @type {string[]} */
  const sent = [];
  /** The waiting prompts on screen, to redraw them only when they change — entries come every few seconds. */
  let shownWaiting = '[]';
  const showWaiting = () => {
    const waiting = waitingPrompts(queue);
    // a sent one Claude Code queued shows as queued
    const queued = waiting.map(spaced);
    const unwritten = sent.filter((text) => {
      const at = queued.indexOf(spaced(text));
      if (at === -1) return true;
      queued.splice(at, 1);
      return false;
    });
    const key = JSON.stringify([waiting, unwritten]);
    if (key === shownWaiting) return;
    shownWaiting = key;
    waitingBox.replaceChildren(...waiting.map((prompt) => waitingBubble(prompt, hooks.sendQueueNow)), ...unwritten.map(sentBubble));
    waitingBox.hidden = waiting.length + unwritten.length === 0;
  };
  /** A sent prompt written down: it goes from the sent ones. @param {string} text */
  const written = (text) => {
    const at = sent.findIndex((one) => spaced(one) === spaced(text));
    if (at !== -1) sent.splice(at, 1);
  };
  /** A call row and the group it sits in: the result arrives later and changes the group layout. */
  /** @type {Map<string, { row: import('./tool-view.js').ToolRow, group: ActivityGroup }>} */
  const tools = new Map();
  /** @type {ActivityGroup[]} */
  const groups = [];
  // Groups whose rows changed while a batch of entries is applied: each is laid out once at the end of the batch,
  // not after every row — a group of dozens of tool calls would otherwise be laid out dozens of times.
  /** @type {Set<ActivityGroup>} */
  const changed = new Set();
  /** @type {HTMLElement | undefined} */
  let turn;
  /** @type {ActivityGroup | undefined} */
  let activity;
  let working = false;
  let lastActivity = 0;

  const top = (/** @type {HTMLElement} */ node) => {
    thread.append(node);
    turn = undefined;
    activity = undefined;
  };
  const currentTurn = () => {
    if (turn === undefined) {
      turn = h('div', { className: 'turn' });
      thread.append(turn);
    }
    return turn;
  };
  const currentActivity = () => {
    if (activity === undefined) {
      activity = createActivityGroup();
      groups.push(activity);
      currentTurn().append(activity.element);
    }
    return activity;
  };
  const openSubagent = (/** @type {string} */ toolUseId, /** @type {HTMLElement} */ holder) => {
    void openSubagentTranscript(sessionId, toolUseId, holder, hooks.openFeed);
  };

  /**
   * @param {DisplayEvent} event
   * @param {SessionMeta} meta — collects the details for the header
   */
  const apply = (event, meta) => {
    if ('at' in event) lastActivity = Math.max(lastActivity, Date.parse(event.at));
    switch (event.kind) {
      case 'prompt': {
        /** @type {Anchor} */
        const prompt = { id: event.id, kind: 'prompt', label: anchorLabel(event.text), at: event.at };
        top(hooks.anchor(prompt, promptBubble(event)));
        hooks.onPrompt(prompt);
        written(event.text);
        working = true;
        break;
      }
      case 'command':
        top(h('div', { className: 'msg user' }, [h('div', { className: 'slash-command', text: event.text })]));
        // a shell command or a slash command sent from the page is written down as this, not as a prompt
        written(event.text);
        break;
      case 'command-output':
        top(h('pre', { className: event.isError ? 'command-output error' : 'command-output', text: event.text }));
        break;
      case 'text': {
        /** @type {Anchor} */
        const answer = { id: event.id, kind: 'answer', label: anchorLabel(event.text), at: event.at };
        currentTurn().append(hooks.anchor(answer, h('div', { className: 'md answer' }, [renderMarkdown(event.text)])));
        activity = undefined;
        break;
      }
      case 'thinking': {
        const group = currentActivity();
        group.appendThinking(() => thinkingRow(event));
        changed.add(group);
        working = true;
        break;
      }
      case 'tool-call': {
        const row = createToolRow(event, { openSubagent, loadEntry: hooks.loadEntry });
        const group = currentActivity();
        tools.set(event.id, { row, group });
        group.appendTool(row);
        changed.add(group);
        working = true;
        break;
      }
      case 'tool-result': {
        const placed = tools.get(event.toolUseId);
        placed?.row.applyResult(event);
        if (placed !== undefined) changed.add(placed.group);
        break;
      }
      case 'task-notification': {
        const placed = event.toolUseId === undefined ? undefined : tools.get(event.toolUseId);
        placed?.row.applyNotification(event);
        if (placed !== undefined) changed.add(placed.group);
        top(notice(`Background task: ${event.summary}`, event.status === 'completed' ? 'info' : 'warning'));
        break;
      }
      case 'interrupted':
        top(notice('Interrupted by user', 'warning'));
        working = false;
        break;
      case 'subagent-report': {
        /** @type {Anchor} */
        const report = { id: event.id, kind: 'report', label: anchorLabel(event.text), at: event.at };
        top(hooks.anchor(report, card(`Subagent report${event.name === undefined ? '' : `: ${event.name}`}`, event.text, 'report')));
        break;
      }
      case 'context-summary':
        top(card('Summary of the earlier conversation (after compaction)', event.text, 'summary'));
        break;
      case 'meta':
        top(card('Claude Code service message', event.text, 'meta'));
        break;
      case 'notice':
        top(notice(event.text, event.tone));
        break;
      case 'compacted':
        top(divider(`Context compacted${event.trigger === 'auto' ? ' automatically' : ''}${event.preTokens === undefined ? '' : ` · was ${formatTokens(event.preTokens)}`}`));
        break;
      case 'turn-end':
        (turn ?? thread).append(h('div', { className: 'turn-end' }, [h('span', { className: 'spark', text: '✻' }), h('span', { text: formatDuration(event.durationMs) })]));
        turn = undefined;
        activity = undefined;
        working = false;
        break;
      case 'usage':
        meta.contextAt = Date.parse(event.at);
        meta.model = event.model;
        meta.contextTokens = event.contextTokens;
        if (event.effort !== undefined) meta.effort = event.effort;
        break;
      case 'title':
        if (event.custom) meta.customTitle = event.title;
        else meta.title = event.title;
        break;
      case 'cost':
        meta.costUsd = event.usd;
        meta.extendedContext = event.extendedContext;
        break;
      default:
        exhaustive(event);
    }
  };

  return {
    /**
     * @param {readonly unknown[]} entries — transcript entries after the server filter
     * @returns {SessionMeta} — changes for the header
     */
    apply(entries) {
      /** @type {SessionMeta} */
      const meta = {};
      for (const entry of entries) {
        queue = queueAfter(queue, entry);
        // An entry that fails to render must not break the rest of the feed.
        try {
          for (const event of interpretEntry(entry)) apply(event, meta);
        } catch (error) {
          console.error('Could not render a transcript entry', isRecord(entry) ? entry.uuid : entry, error);
          top(notice('This record could not be shown — see the browser console', 'error'));
        }
      }
      for (const group of changed) group.refresh();
      changed.clear();
      showWaiting();
      return meta;
    },
    /** The action display mode changed — rebuild the layout of every group. */
    relayout() {
      for (const group of groups) group.refresh();
    },
    reset() {
      thread.replaceChildren();
      tools.clear();
      groups.length = 0;
      changed.clear();
      turn = undefined;
      activity = undefined;
      working = false;
      lastActivity = 0;
      queue = [];
      showWaiting();
    },
    isWorking: () => working,
    lastActivity: () => lastActivity,
    /** A prompt sent from the page, shown until Claude Code writes it down. @param {string} text */
    expect(text) {
      sent.push(text);
      showWaiting();
    },
  };
}

/**
 * A prompt's text as it is compared: its spaces and line breaks as one space, none at its ends — and one after a shell
 * command's "!", which the terminal writes down whether it was typed or not.
 * @param {string} text
 */
function spaced(text) {
  return text.replace(/\s+/g, ' ').trim().replace(/^! ?/, '! ');
}

/**
 * @typedef {{ element: HTMLElement, appendThinking: (build: () => HTMLElement) => void, appendTool: (row: import('./tool-view.js').ToolRow) => void, refresh: () => void }} ActivityGroup
 */

/**
 * The action display mode is set by the header toggles (app.js) through the data-activity and data-edits attributes on <html>
 * and the activityModeEvent event; this way it also applies to nested subagent feeds.
 * @returns {'compact' | 'detailed'}
 */
function activityMode() {
  return document.documentElement.dataset.activity === 'detailed' ? 'detailed' : 'compact';
}

export const activityModeEvent = 'viewer:activity-mode';

/**
 * A frame of consecutive thinking and tool calls; layoutActivity decides what is visible in it. A row is built and
 * put into the page only once it is to be seen: folded away, a long session's thousands of calls cost no DOM.
 * @returns {ActivityGroup}
 */
function createActivityGroup() {
  /** @type {{ build: () => HTMLElement, element: HTMLElement | undefined, item: () => import('../model/activity.js').ActivityItem, opened: boolean | undefined }[]} */
  const rows = [];
  let expanded = false;
  const header = h('button', { className: 'activity-header', attrs: { type: 'button' } });
  const element = h('div', { className: 'activity' }, [header]);

  const refresh = () => {
    const items = rows.map((row) => row.item());
    const edits = document.documentElement.dataset.edits === 'shown' ? 'shown' : 'folded';
    const layout = layoutActivity(items, { mode: activityMode(), expanded, edits });
    const opened = expandedRows(items, edits);
    renderActivityHeader(header, layout.header);
    // Without a header the first visible row is the top of the frame, so it needs no separator line above it.
    const flush = header.hidden ? layout.visible.indexOf(true) : -1;
    rows.forEach((row, index) => {
      const visible = layout.visible[index] === true;
      if (!visible && row.element === undefined) return;
      const shown = row.element ?? place(index, row.build());
      shown.hidden = !visible;
      shown.classList.toggle('flush', index === flush);
      // The setting opens its rows and closes them again; a row it never opened is left as it is — a question opens
      // by itself, a row opened by hand stays open.
      const open = opened[index] === true;
      if (open !== (row.opened ?? false) && shown instanceof HTMLDetailsElement) {
        shown.open = open;
        row.opened = open;
      }
    });
    element.hidden = layout.header.kind === 'none' && !layout.visible.includes(true);
  };
  header.addEventListener('click', () => {
    expanded = !expanded;
    refresh();
  });
  /**
   * Puts a row built just now into the page, before the next row that is already there.
   * @param {number} index
   * @param {HTMLElement} built
   */
  const place = (index, built) => {
    const row = rows[index];
    if (row !== undefined) row.element = built;
    const next = rows.slice(index + 1).find((later) => later.element !== undefined)?.element;
    element.insertBefore(built, next ?? null);
    return built;
  };
  /**
   * The caller lays the group out (refresh) once it has added everything it had.
   * @param {() => HTMLElement} build
   * @param {() => import('../model/activity.js').ActivityItem} item
   */
  const add = (build, item) => {
    rows.push({ build, element: undefined, item, opened: undefined });
  };

  return {
    element,
    appendThinking: (build) => add(build, () => ({ kind: 'thinking' })),
    appendTool: (row) => add(row.mount, () => ({ kind: 'tool', family: row.family, state: row.state() })),
    refresh,
  };
}

/**
 * @param {HTMLButtonElement} header
 * @param {import('../model/activity.js').ActivityHeader} layout
 */
function renderActivityHeader(header, layout) {
  header.hidden = layout.kind === 'none';
  header.dataset.kind = layout.kind;
  switch (layout.kind) {
    case 'none':
      header.replaceChildren();
      return;
    case 'summary': {
      const errors = layout.errors === undefined ? [] : [h('span', { className: 'activity-errors', text: layout.errors })];
      header.replaceChildren(h('span', { className: 'spark', text: '✻' }), h('span', { className: 'activity-parts', text: layout.parts.join(', ') }), ...errors, h('span', { className: 'chevron' }, [icon('chevron')]));
      header.classList.toggle('expanded', layout.expanded);
      return;
    }
    case 'fold':
      header.replaceChildren(icon('chevron'), h('span', { text: `Show ${layout.hidden}` }));
      header.classList.remove('expanded');
      return;
    case 'unfold':
      header.replaceChildren(icon('chevron'), h('span', { text: 'Collapse' }));
      header.classList.add('expanded');
      return;
    default:
      exhaustive(layout);
  }
}

/**
 * @param {never} event
 * @returns {never}
 */
function exhaustive(event) {
  throw new Error(`Unhandled display event ${JSON.stringify(event)}`);
}

/**
 * @param {import('../model/entry.js').PromptEvent} event
 * @returns {HTMLElement}
 */
function promptBubble(event) {
  const bubble = h('div', { className: 'bubble', title: new Date(event.at).toLocaleString() }, [
    ...event.images.map(inlineImage),
    h('div', { className: 'bubble-text', text: event.text }),
  ]);
  if (event.queued) bubble.append(h('div', { className: 'queued', text: 'sent while Claude was working' }));
  return h('div', { className: 'msg user' }, [bubble]);
}

/**
 * @param {import('../model/entry.js').ThinkingEvent} event
 * @returns {HTMLElement}
 */
function thinkingRow(event) {
  const label = event.durationMs === undefined ? 'Thinking' : `Thought for ${formatDuration(event.durationMs)}`;
  const head = [h('span', { className: 'spark', text: '✻' }), h('span', { className: 'tool-label', text: label })];
  if (event.text.trim() === '') return h('div', { className: 'thinking empty', title: 'Claude Code does not store the thinking text in the transcript' }, head);
  // The text is rendered on the first open: most thinking stays folded, and a long session has hundreds of them.
  const body = h('div', { className: 'md thinking-text' });
  const row = h('details', { className: 'thinking' }, [h('summary', { className: 'tool-head' }, [...head, h('span', { className: 'chevron' }, [icon('chevron')])]), body]);
  row.addEventListener('toggle', () => {
    if (row.open && body.childElementCount === 0) body.append(renderMarkdown(event.text));
  });
  return row;
}

/**
 * @param {string} message
 * @param {import('../model/entry.js').Tone} tone
 * @returns {HTMLElement}
 */
function notice(message, tone) {
  return h('div', { className: `notice ${tone}`, text: message });
}

/**
 * @param {string} label
 * @returns {HTMLElement}
 */
function divider(label) {
  return h('div', { className: 'divider' }, [h('span', { text: label })]);
}

/**
 * @param {string} title
 * @param {string} body
 * @param {'report' | 'summary' | 'meta'} variant
 * @returns {HTMLElement}
 */
function card(title, body, variant) {
  const content = h('div', { className: 'md' });
  const details = h('details', { className: `card ${variant}` }, [h('summary', {}, [h('span', { text: title }), h('span', { className: 'chevron' }, [icon('chevron')])]), content]);
  details.addEventListener('toggle', () => {
    if (details.open && content.childElementCount === 0) content.append(renderMarkdown(body));
  });
  return details;
}

/**
 * A subagent transcript inside an Agent call row: finds it by the call id and subscribes the same way as for a session.
 * @param {string} sessionId
 * @param {string} toolUseId
 * @param {HTMLElement} holder
 * @param {OpenFeed} openFeed
 */
export async function openSubagentTranscript(sessionId, toolUseId, holder, openFeed) {
  const response = await fetch(`/api/subagents?session=${encodeURIComponent(sessionId)}`);
  /** @type {unknown} */
  const list = await response.json();
  const agents = Array.isArray(list) ? list.filter(isRecord) : [];
  const agentId = text(agents.find((agent) => agent.toolUseId === toolUseId)?.agentId);
  if (agentId === undefined) {
    holder.append(notice('Subagent transcript not found', 'warning'));
    return;
  }
  const scroller = h('div', { className: 'subagent' });
  holder.append(scroller);
  const view = mountSession({
    scroller,
    sessionId,
    agentId,
    startAt: undefined,
    keeping: undefined,
    bookmarks: undefined,
    onRewind: undefined,
    sendQueueNow: undefined,
    listener: { onMeta: () => {}, onStatus: () => {}, onPrompt: () => {}, onReset: () => {} },
    openFeed,
  });
  scroller.append(view.element);
}
