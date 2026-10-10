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
 * @typedef {{ title?: string, customTitle?: string, model?: string, contextTokens?: number, costUsd?: number }} SessionMeta
 * @typedef {'connecting' | 'missing' | 'idle' | 'working'} SessionStatus
 * @typedef {import('../model/bookmarks.js').Bookmark} Anchor — a message one can come back to: a prompt, an answer, a subagent report
 * @typedef {{ onMeta: (meta: SessionMeta) => void, onStatus: (status: SessionStatus) => void, onPrompt: (prompt: Anchor) => void, onReset: () => void }} SessionListener
 * @typedef {{ anchor: (anchor: Anchor, content: HTMLElement) => HTMLElement, onPrompt: (prompt: Anchor) => void }} FeedHooks
 * @typedef {{ element: HTMLElement, dispose: () => void, scrollToAnchor: (id: string) => boolean, promptElements: () => readonly HTMLElement[] }} MountedSession
 */

/** Gap between a jumped-to message and the top of the scroll area, px. */
export const jumpMarginPx = 16;

/** A session with no new entries for longer than this counts as stopped, even if the turn has not ended. */
const staleMs = 15 * 60_000;
const nearBottomPx = 120;

/**
 * @param {{ scroller: HTMLElement, sessionId: string, agentId: string | undefined, bookmarks: import('./bookmark-store.js').BookmarkStore | undefined, listener: SessionListener }} options
 * — bookmarks: undefined for a nested subagent feed, which has no bookmarks
 * @returns {MountedSession}
 */
export function mountSession({ scroller, sessionId, agentId, bookmarks, listener }) {
  const thread = h('div', { className: 'thread' });
  const working = h('div', { className: 'working', attrs: { hidden: '' } }, [h('span', { className: 'spark', text: '✻' }), h('span', { text: 'Working…' })]);
  const jump = h('button', { className: 'jump', title: 'Jump to the latest message', attrs: { type: 'button', hidden: '' } }, [icon('down')]);
  const element = h('div', { className: 'session' }, [thread, working, jump]);
  const anchors = createAnchors(bookmarks);
  /** @type {HTMLElement[]} */
  const prompts = [];
  const feed = createFeed(thread, sessionId, {
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
  let opened = false;

  const query = new URLSearchParams({ session: sessionId });
  if (agentId !== undefined) query.set('agent', agentId);
  const source = new EventSource(`/api/stream?${query}`);

  const nearBottom = () => scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < nearBottomPx;
  const toBottom = () => {
    scroller.scrollTop = scroller.scrollHeight;
  };
  const refreshStatus = () => {
    const live = feed.isWorking() && Date.now() - feed.lastActivity() < staleMs;
    working.hidden = !(ready && live);
    listener.onStatus(ready ? (live ? 'working' : 'idle') : 'connecting');
  };

  source.addEventListener('open', () => {
    // Reconnect: the server sends the transcript again from the start.
    if (opened) {
      resetFeed();
      meta = {};
      ready = false;
    }
    opened = true;
  });
  source.addEventListener('entries', (message) => {
    const stick = !ready || nearBottom();
    const update = feed.apply(JSON.parse(message.data));
    if (Object.keys(update).length > 0) {
      meta = { ...meta, ...update };
      listener.onMeta(meta);
    }
    if (ready && stick) toBottom();
    if (ready && !stick) jump.hidden = false;
    if (ready) refreshStatus();
  });
  source.addEventListener('ready', () => {
    ready = true;
    toBottom();
    refreshStatus();
  });
  source.addEventListener('reset', () => {
    resetFeed();
    meta = {};
  });
  source.addEventListener('missing', () => {
    listener.onStatus('missing');
  });
  const onScroll = () => {
    if (nearBottom()) jump.hidden = true;
  };
  scroller.addEventListener('scroll', onScroll, { passive: true });
  jump.addEventListener('click', () => {
    toBottom();
    jump.hidden = true;
  });
  const timer = setInterval(refreshStatus, 30_000);
  const relayout = () => feed.relayout();
  document.addEventListener(activityModeEvent, relayout);

  return {
    element,
    dispose() {
      source.close();
      clearInterval(timer);
      document.removeEventListener(activityModeEvent, relayout);
      scroller.removeEventListener('scroll', onScroll);
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
  };
}

/**
 * Messages one can come back to: each has a bookmark flag, and its element can be found by id.
 * @param {import('./bookmark-store.js').BookmarkStore | undefined} bookmarks
 */
function createAnchors(bookmarks) {
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
        group.appendThinking(thinkingRow(event));
        changed.add(group);
        working = true;
        break;
      }
      case 'tool-call': {
        const row = createToolRow(event, openSubagent);
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
        break;
      case 'title':
        if (event.custom) meta.customTitle = event.title;
        else meta.title = event.title;
        break;
      case 'cost':
        meta.costUsd = event.usd;
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
 * @typedef {{ element: HTMLElement, appendThinking: (row: HTMLElement) => void, appendTool: (row: import('./tool-view.js').ToolRow) => void, refresh: () => void }} ActivityGroup
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
 * A frame of consecutive thinking and tool calls; layoutActivity decides what is visible in it.
 * @returns {ActivityGroup}
 */
function createActivityGroup() {
  /** @type {{ element: HTMLElement, item: () => import('../model/activity.js').ActivityItem }[]} */
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
      row.element.hidden = layout.visible[index] !== true;
      row.element.classList.toggle('flush', index === flush);
    });
    element.hidden = layout.header.kind === 'none' && !layout.visible.includes(true);
  };
  header.addEventListener('click', () => {
    expanded = !expanded;
    refresh();
  });
  /**
   * The caller lays the group out (refresh) once it has added everything it had.
   * @param {HTMLElement} row
   * @param {() => import('../model/activity.js').ActivityItem} item
   */
  const add = (row, item) => {
    rows.push({ element: row, item });
    element.append(row);
  };

  return {
    element,
    appendThinking: (row) => add(row, () => ({ kind: 'thinking' })),
    appendTool: (row) => add(row.element, () => ({ kind: 'tool', family: row.family, state: row.state() })),
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
    bookmarks: undefined,
    listener: { onMeta: () => {}, onStatus: () => {}, onPrompt: () => {}, onReset: () => {} },
  });
  scroller.append(view.element);
}
