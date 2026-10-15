import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

// DOMPurify binds to window on import (through the feed's markdown), so the DOM is set up before the view loads.
const { window } = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });

/** The page's stream from the viewer, played by the test: it tells what the server sends. */
class FakeSource {
  static CLOSED = 2;
  /** @type {FakeSource[]} */
  static made = [];
  readyState = 1;
  /** @param {string} url */
  constructor(url) {
    this.url = url;
    /** @type {Record<string, ((message: { data: string }) => void)[]>} */
    this.listeners = {};
    FakeSource.made.push(this);
  }
  /** @param {string} type @param {(message: { data: string }) => void} listener */
  addEventListener(type, listener) {
    (this.listeners[type] ??= []).push(listener);
  }
  /** @param {string} type @param {unknown} [data] */
  emit(type, data) {
    for (const listener of this.listeners[type] ?? []) listener({ data: JSON.stringify(data ?? null) });
  }
  close() {
    this.readyState = FakeSource.CLOSED;
  }
}

Object.assign(globalThis, {
  window,
  document: window.document,
  NodeFilter: window.NodeFilter,
  Text: window.Text,
  Element: window.Element,
  HTMLElement: window.HTMLElement,
  EventSource: FakeSource,
  matchMedia: () => ({ matches: false }),
  ResizeObserver: class {
    observe() {}
    disconnect() {}
  },
});
const { mountSession } = await import('../public/view/session-view.js');

const at = '2026-10-09T07:02:11.686Z';
/** @param {string} uuid @param {string} text */
const prompt = (uuid, text) => ({ type: 'user', uuid, timestamp: at, promptSource: 'typed', message: { role: 'user', content: text } });
const settled = () => new Promise((done) => setTimeout(done, 10));

/** @param {string} uuid @param {string} text */
const answer = (uuid, text) => ({ type: 'assistant', uuid, timestamp: at, message: { role: 'assistant', content: [{ type: 'text', text }] } });

/**
 * A session mounted with this copy kept from before, the viewer in reach.
 * @param {import('../public/view/offline-store.js').SavedFeed | undefined} saved
 * @param {import('../public/view/bookmark-store.js').BookmarkStore} [bookmarks]
 */
function mounted(saved, bookmarks) {
  FakeSource.made = [];
  const scroller = window.document.createElement('div');
  window.document.body.append(scroller);
  const view = mountSession({
    scroller,
    sessionId: '3f2c9a50-1111-4222-8333-944455556666',
    agentId: undefined,
    bookmarks,
    onRewind: undefined,
    sendQueueNow: undefined,
    startAt: undefined,
    keeping: { load: async () => saved, save: () => undefined, online: () => true, onOnline: () => () => undefined },
    listener: { onMeta: () => undefined, onStatus: () => undefined, onPrompt: () => undefined, onReset: () => undefined },
  });
  scroller.append(view.element);
  const source = FakeSource.made[0];
  assert.ok(source);
  /** What the reader sees: the prompts shown, whether it says it loads or updates. */
  const seen = () => ({
    prompts: [...view.element.querySelectorAll('.msg.user .bubble-text')].filter((bubble) => !bubble.closest('[hidden]')).map((bubble) => bubble.textContent),
    loading: !(view.element.querySelector('.loading')?.hasAttribute('hidden') ?? true),
    updating: !(view.element.querySelector('.updating')?.hasAttribute('hidden') ?? true),
  });
  return { view, source, seen };
}

// A session opens at once with the copy kept from the last time, marked as being brought up to date; once the viewer
// has sent the session, it shows that — the copy gone, the mark too
test('mountSession_Should_ShowKeptCopyAtOnce_MarkedAsUpdating_ThenTheFreshSession', async () => {
  const { view, source, seen } = mounted({ entries: [prompt('u1', 'Old question')], earlier: 0, lastActivity: undefined, savedAt: 1 });
  await settled();
  const meanwhile = seen();

  source.emit('open');
  source.emit('entries', [prompt('u1', 'Old question'), prompt('u2', 'New question')]);
  source.emit('ready');
  await settled();
  view.dispose();

  assert.deepEqual({ meanwhile, after: seen() }, {
    meanwhile: { prompts: ['Old question'], loading: false, updating: true },
    after: { prompts: ['Old question', 'New question'], loading: false, updating: false },
  });
});

// A session never kept opens as before: it says it loads until the viewer has sent it
test('mountSession_Should_SayItLoads_When_NoCopyIsKept', async () => {
  const { view, source, seen } = mounted(undefined);
  await settled();
  const meanwhile = seen();

  source.emit('open');
  source.emit('entries', [prompt('u1', 'Question')]);
  source.emit('ready');
  await settled();
  view.dispose();

  assert.deepEqual({ meanwhile, after: seen() }, {
    meanwhile: { prompts: [], loading: true, updating: false },
    after: { prompts: ['Question'], loading: false, updating: false },
  });
});

// An answer is bookmarked from its corner or from under it — read to its end — both flags showing it bookmarked
test('mountSession_Should_OfferAnswersBookmarkUnderItToo_BothFlagsShowingIt', async () => {
  /** @type {Set<string>} */
  const marked = new Set();
  /** @type {(() => void)[]} */
  const listeners = [];
  /** @type {import('../public/view/bookmark-store.js').BookmarkStore} */
  const bookmarks = {
    list: () => [],
    has: (id) => marked.has(id),
    toggle: (anchor) => {
      if (!marked.delete(anchor.id)) marked.add(anchor.id);
      for (const listener of listeners) listener();
    },
    onChange: (listener) => {
      listeners.push(listener);
      return () => undefined;
    },
    dispose: () => undefined,
  };
  const { view, source } = mounted(undefined, bookmarks);
  source.emit('open');
  source.emit('entries', [prompt('u1', 'Question'), answer('a1', 'The answer.')]);
  source.emit('ready');
  await settled();
  const flags = () => [...view.element.querySelectorAll('.anchored > .bookmark-toggle')].map((flag) => `${flag.classList.contains('bookmark-under') ? 'under' : 'corner'} ${flag.getAttribute('aria-pressed')}`);

  const before = flags();
  const under = view.element.querySelector('.anchored > .bookmark-under');
  if (under instanceof window.HTMLElement) under.click();
  const after = flags();
  view.dispose();

  assert.deepEqual({ before, after }, { before: ['corner false', 'under false'], after: ['corner true', 'under true'] });
});

// A prompt sent from the page shows in the feed at once, as sent — the terminal took it — until Claude Code writes it
// down: then it is the prompt itself, once
test('mountSession_Should_ShowPromptSentFromPage_UntilClaudeWritesItDown', async () => {
  const { view, source } = mounted(undefined);
  source.emit('open');
  source.emit('entries', [prompt('u1', 'Question')]);
  source.emit('ready');
  await settled();
  const sentShown = () => [...view.element.querySelectorAll('.msg.user.sent .bubble-text')].map((bubble) => bubble.textContent);

  view.expectPrompt('Check the  limits\nagain');
  const meanwhile = sentShown();
  source.emit('entries', [prompt('u2', 'Check the limits again')]);
  await settled();
  const after = { sent: sentShown(), prompts: [...view.element.querySelectorAll('.msg.user:not(.waiting) .bubble-text')].map((bubble) => bubble.textContent) };
  view.dispose();

  assert.deepEqual({ meanwhile, after }, { meanwhile: ['Check the  limits\nagain'], after: { sent: [], prompts: ['Question', 'Check the limits again'] } });
});
