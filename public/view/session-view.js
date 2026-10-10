// @ts-check
// Session feed: subscribes to the entry stream and renders entries as they arrive.
import { layoutActivity } from '../model/activity.js';
import { anchorLabel } from '../model/bookmarks.js';
import { interpretEntry } from '../model/entry.js';
import { formatDuration, formatTokens } from '../model/format.js';
import { isRecord, text } from '../model/narrow.js';
import { h, inlineImage } from './dom.js';
import { icon } from './icons.js';
import { renderMarkdown } from './markdown.js';
import { createToolRow } from './tool-view.js';

/**
 * @typedef {import('../model/entry.js').DisplayEvent} DisplayEvent
 * @typedef {{ title?: string, customTitle?: string, model?: string, contextTokens?: number, effort?: string, costUsd?: number, extendedContext?: boolean }} SessionMeta
 * @typedef {'connecting' | 'missing' | 'idle' | 'working'} SessionStatus
 * @typedef {import('../model/bookmarks.js').Bookmark} Anchor — a message one can come back to: a prompt, an answer, a subagent report
 * @typedef {{ onMeta: (meta: SessionMeta) => void, onStatus: (status: SessionStatus) => void, onPrompt: (prompt: Anchor) => void, onReset: () => void }} SessionListener
 * @typedef {{ anchor: (anchor: Anchor, content: HTMLElement) => HTMLElement, onPrompt: (prompt: Anchor) => void, loadEntry: import('./tool-view.js').LoadEntry }} FeedHooks
 * @typedef {{ element: HTMLElement, dispose: () => void, scrollToAnchor: (id: string) => boolean, promptElements: () => readonly HTMLElement[], place: () => ReadingPlace, hasEarlier: () => boolean, loadEarlier: () => Promise<void> }} MountedSession
 * hasEarlier — the session opened with its latest part, the rest is not loaded; loadEarlier loads it
 * Where the reader is in the feed: at the bottom, following new messages, or at a message — the one at the top of the
 * view, offset px below the view's top edge (negative: partly scrolled past).
 * @typedef {{ kind: 'bottom' } | { kind: 'message', id: string, offset: number }} ReadingPlace
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

/**
 * @param {{ scroller: HTMLElement, sessionId: string, agentId: string | undefined, bookmarks: import('./bookmark-store.js').BookmarkStore | undefined, onRewind: ((prompt: Anchor) => void) | undefined, listener: SessionListener, startAt: ReadingPlace | undefined }} options
 * — bookmarks: undefined for a nested subagent feed, which has no bookmarks; onRewind: likewise, a subagent cannot be rewound;
 * startAt — where the reader left the session last time; undefined — at the bottom
 * @returns {MountedSession}
 */
export function mountSession({ scroller, sessionId, agentId, bookmarks, onRewind, listener, startAt }) {
  // The history arrives in batches of a thousand entries: laid out after each, a long session would be laid out again
  // and again as it grows. It stays hidden until the whole history is in, then is shown once, at the bottom.
  const thread = h('div', { className: 'thread', attrs: { hidden: '' } });
  // Meanwhile the reader sees that it loads, and how far it got.
  const loadingCount = h('span', { className: 'loading-count' });
  const loading = h('div', { className: 'loading', attrs: { role: 'status' } }, [h('span', { className: 'spark', text: '✻' }), h('span', { text: 'Loading the session…' }), loadingCount]);
  // A long session opens with its latest part; the rest comes on request.
  const earlier = h('button', { className: 'earlier', attrs: { type: 'button', hidden: '' } });
  const working = h('div', { className: 'working', attrs: { hidden: '' } }, [h('span', { className: 'spark', text: '✻' }), h('span', { text: 'Working…' })]);
  const jump = h('button', { className: 'jump', title: 'Jump to the latest message', attrs: { type: 'button', hidden: '' } }, [icon('down')]);
  const element = h('div', { className: 'session' }, [earlier, thread, loading, working, jump]);
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
  const feed = createFeed(thread, sessionId, {
    loadEntry,
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
  let ready = false;
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
    if (ready && stuck) toBottom();
  });
  keepAtBottom.observe(thread);
  keepAtBottom.observe(scroller);
  const refreshStatus = () => {
    const live = feed.isWorking() && Date.now() - feed.lastActivity() < staleMs;
    working.hidden = !(ready && live);
    listener.onStatus(ready ? (live ? 'working' : 'idle') : 'connecting');
  };

  /** The feed starts over: the reader stays where they were once the history is in again. */
  const startOver = () => {
    resumeAt = currentPlace();
    resetFeed();
    meta = {};
    ready = false;
    received = 0;
    thread.hidden = true;
    earlier.hidden = true;
    loading.hidden = false;
    loadingCount.textContent = '';
  };
  /**
   * @param {number | undefined} tail — how many of the latest entries to start with; undefined — the whole session
   * @returns {EventSource}
   */
  const connect = (tail) => {
    const query = new URLSearchParams({ session: sessionId });
    if (agentId !== undefined) query.set('agent', agentId);
    if (tail !== undefined) query.set('tail', String(tail));
    const next = new EventSource(`/api/stream?${query}`);
    let opened = false;
    next.addEventListener('open', () => {
      // Reconnect: the server sends the transcript again from the start.
      if (opened) startOver();
      opened = true;
    });
    next.addEventListener('earlier', (message) => {
      const count = Number(JSON.parse(message.data)?.count);
      earlier.textContent = `Show ${count.toLocaleString('en-US')} earlier entries`;
      earlier.hidden = !(count > 0);
    });
    next.addEventListener('entries', (message) => {
      const entries = JSON.parse(message.data);
      const update = feed.apply(entries);
      if (Object.keys(update).length > 0) {
        meta = { ...meta, ...update };
        listener.onMeta(meta);
      }
      if (!ready && Array.isArray(entries)) {
        received += entries.length;
        loadingCount.textContent = `${received.toLocaleString('en-US')} entries`;
      }
      if (ready && stuck) toBottom();
      if (ready) refreshStatus();
    });
    next.addEventListener('ready', () => {
      ready = true;
      thread.hidden = false;
      loading.hidden = true;
      const returned = resumeAt?.kind === 'message' && returnTo(resumeAt);
      resumeAt = undefined;
      stuck = !returned;
      if (stuck) toBottom();
      jump.hidden = stuck;
      refreshStatus();
      const waiting = onReady;
      onReady = [];
      for (const resolve of waiting) resolve();
    });
    next.addEventListener('reset', () => {
      resetFeed();
      meta = {};
      earlier.hidden = true;
    });
    next.addEventListener('missing', () => {
      loading.hidden = true;
      listener.onStatus('missing');
    });
    return next;
  };
  let source = connect(matchMedia('(max-width: 820px)').matches ? initialTail.narrow : initialTail.wide);
  /**
   * The whole session, the reader staying at the message they were at.
   * @returns {Promise<void>} — once it is in
   */
  const loadEarlier = () => {
    source.close();
    startOver();
    source = connect(undefined);
    return new Promise((resolve) => onReady.push(resolve));
  };
  earlier.addEventListener('click', () => void loadEarlier());
  // Scrolling up lets go of the bottom and shows the button back to it; reaching the bottom sticks to it again.
  const onScroll = () => {
    if (!ready) return;
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
    if (!ready || stuck) return { kind: 'bottom' };
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
      source.close();
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
    hasEarlier: () => !earlier.hidden,
    loadEarlier,
    place: currentPlace,
  };
}

/**
 * Messages one can come back to: each has a bookmark flag, and its element can be found by id.
 * @param {import('./bookmark-store.js').BookmarkStore | undefined} bookmarks
 * @param {((prompt: Anchor) => void) | undefined} onRewind — offers to rewind to a prompt; undefined in a subagent feed
 */
function createAnchors(bookmarks, onRewind) {
  /** @type {Map<string, { element: HTMLElement, button: HTMLButtonElement | undefined }>} */
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
      /** @type {HTMLButtonElement | undefined} */
      let button;
      if (bookmarks !== undefined) {
        const store = bookmarks;
        button = h('button', { className: 'bookmark-toggle', attrs: { type: 'button' } }, [icon('bookmark')]);
        button.addEventListener('click', (event) => {
          event.stopPropagation();
          store.toggle(anchor);
        });
        press(button, store.has(anchor.id));
        holder.prepend(button);
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
      registry.set(anchor.id, { element: holder, button });
      return holder;
    },
    refresh() {
      for (const [id, { button }] of registry) if (button !== undefined && bookmarks !== undefined) press(button, bookmarks.has(id));
    },
    /** @param {string} id */
    find: (id) => registry.get(id)?.element,
    clear: () => registry.clear(),
  };
}

/**
 * Lays events out in the feed: prompts and markers as separate rows, Claude's answer as a turn block,
 * consecutive thinking and tool calls within a turn as one group.
 * @param {HTMLElement} thread
 * @param {string} sessionId
 * @param {FeedHooks} hooks
 */
function createFeed(thread, sessionId, hooks) {
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
    void openSubagentTranscript(sessionId, toolUseId, holder);
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
        working = true;
        break;
      }
      case 'command':
        top(h('div', { className: 'msg user' }, [h('div', { className: 'slash-command', text: event.text })]));
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
    },
    isWorking: () => working,
    lastActivity: () => lastActivity,
  };
}

/**
 * @typedef {{ element: HTMLElement, appendThinking: (build: () => HTMLElement) => void, appendTool: (row: import('./tool-view.js').ToolRow) => void, refresh: () => void }} ActivityGroup
 */

/**
 * The action display mode is set by the header toggle (app.js) through the data-activity attribute on <html>
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
  /** @type {{ build: () => HTMLElement, element: HTMLElement | undefined, item: () => import('../model/activity.js').ActivityItem }[]} */
  const rows = [];
  let expanded = false;
  const header = h('button', { className: 'activity-header', attrs: { type: 'button' } });
  const element = h('div', { className: 'activity' }, [header]);

  const refresh = () => {
    const layout = layoutActivity(
      rows.map((row) => row.item()),
      { mode: activityMode(), expanded },
    );
    renderActivityHeader(header, layout.header);
    // Without a header the first visible row is the top of the frame, so it needs no separator line above it.
    const flush = header.hidden ? layout.visible.indexOf(true) : -1;
    rows.forEach((row, index) => {
      const visible = layout.visible[index] === true;
      if (!visible && row.element === undefined) return;
      const shown = row.element ?? place(index, row.build());
      shown.hidden = !visible;
      shown.classList.toggle('flush', index === flush);
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
    rows.push({ build, element: undefined, item });
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
 */
async function openSubagentTranscript(sessionId, toolUseId, holder) {
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
    bookmarks: undefined,
    onRewind: undefined,
    listener: { onMeta: () => {}, onStatus: () => {}, onPrompt: () => {}, onReset: () => {} },
  });
  scroller.append(view.element);
}
