import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createCodexReading } from '../server/codex.js';

// DOMPurify binds to window on import (through the feed's markdown), so the DOM is set up before the view loads.
const { window } = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });

/** A session's feed from the viewer, played by the test: it tells what the server sends. */
class FakeFeed {
  /** @param {import('../public/view/feed-hub.js').Wanted} wanted */
  constructor(wanted) {
    this.wanted = wanted;
    /** The token it was asked from, as the page's stream asks it. */
    this.from = wanted.from();
    /** @type {Record<string, ((data: unknown) => void)[]>} */
    this.listeners = {};
    this.letGo = false;
  }
  /** @param {string} type @param {(data: unknown) => void} listener */
  on(type, listener) {
    (this.listeners[type] ??= []).push(listener);
  }
  /** @param {string} type @param {unknown} [data] */
  emit(type, data) {
    for (const listener of this.listeners[type] ?? []) listener(JSON.parse(JSON.stringify(data ?? null)));
  }
  close() {
    this.letGo = true;
  }
  closed() {
    return false;
  }
}

Object.assign(globalThis, {
  window,
  document: window.document,
  NodeFilter: window.NodeFilter,
  Text: window.Text,
  Element: window.Element,
  HTMLElement: window.HTMLElement,
  HTMLAnchorElement: window.HTMLAnchorElement,
  matchMedia: () => ({ matches: false }),
  ResizeObserver: class {
    observe() {}
    disconnect() {}
  },
});
const { mountSession } = await import('../public/view/session-view.js');
const { tailCheck } = await import('../public/model/feed-check.js');

const at = '2026-10-09T07:02:11.686Z';
/** @param {string} uuid @param {string} text */
const prompt = (uuid, text) => ({ type: 'user', uuid, timestamp: at, promptSource: 'typed', message: { role: 'user', content: text } });
const settled = () => new Promise((done) => setTimeout(done, 10));

test('sessionView_Should_ShowAsynchronousCodexQuestionOutsideCollapsedActions', async (t) => {
  const reading = createCodexReading();
  const entries = [
    { type: 'response_item', ordinal: 1, payload: { type: 'function_call', call_id: 'ask', name: 'request_user_input_async', arguments: JSON.stringify({ questions: [{ title: 'Include model selection and account usage?', options: ['Include both', 'Sessions only'] }] }) } },
    { type: 'response_item', ordinal: 2, payload: { type: 'function_call_output', call_id: 'ask', output: '{"accepted":true}' } },
    { type: 'response_item', ordinal: 3, payload: { type: 'function_call', call_id: 'work', name: 'exec_command', arguments: '{"cmd":"git status"}' } },
  ].flatMap((record) => reading.translate({ ...record, timestamp: at }));
  const { view } = await mounted(t, { entries, earlier: 0, lastActivity: undefined, savedAt: 1 });

  const shownAnswers = [...view.element.querySelectorAll('.md.answer')].filter((element) => !element.closest('[hidden]')).map((element) => element.textContent).join('\n');
  assert.match(shownAnswers, /Include model selection and account usage\?/);
  assert.match(shownAnswers, /Include both/);
  assert.match(shownAnswers, /Sessions only/);
});

/** @param {string} uuid @param {string} text */
const answer = (uuid, text) => ({ type: 'assistant', uuid, timestamp: at, message: { role: 'assistant', content: [{ type: 'text', text }] } });

/**
 * What the viewer tells after what it sent, for the page to hold these.
 * @param {string} token @param {readonly unknown[]} held @param {number} [earlier]
 */
const cursor = (token, held, earlier = 0) => ({ token, shown: earlier + held.length, check: tailCheck(held.slice(-16)) });

/**
 * A session mounted with this copy kept from before, the viewer in reach; once the copy is read, its feed asked for. It
 * is let go of when the test ends, a failed one too: its timers would keep the tests running.
 * @param {import('node:test').TestContext} t
 * @param {import('../public/view/offline-store.js').SavedFeed | undefined} saved
 * @param {import('../public/view/bookmark-store.js').BookmarkStore} [bookmarks]
 */
async function mounted(t, saved, bookmarks) {
  /** The feeds asked for, the latest last. @type {FakeFeed[]} */
  const feeds = [];
  /** The copies kept. @type {import('../public/view/offline-store.js').SavedFeed[]} */
  const saves = [];
  /** @type {import('../public/view/session-view.js').SessionMeta[]} */
  const metas = [];
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
    keeping: { load: async () => saved, save: (feed) => void saves.push(feed), online: () => true, onOnline: () => () => undefined },
    listener: { onMeta: (meta) => metas.push(meta), onStatus: () => undefined, onPrompt: () => undefined, onReset: () => undefined },
    openFeed: (wanted) => {
      const feed = new FakeFeed(wanted);
      feeds.push(feed);
      return feed;
    },
  });
  scroller.append(view.element);
  t.after(() => view.dispose());
  await settled();
  const source = feeds[0];
  assert.ok(source);
  /** What the reader sees: the prompts shown, whether it says it loads or updates. */
  const seen = () => ({
    prompts: [...view.element.querySelectorAll('.msg.user .bubble-text')].filter((bubble) => !bubble.closest('[hidden]')).map((bubble) => bubble.textContent),
    loading: !(view.element.querySelector('.loading')?.hasAttribute('hidden') ?? true),
    updating: !(view.element.querySelector('.updating')?.hasAttribute('hidden') ?? true),
  });
  /** Whether the mark of being brought up to date sits under the session's latest message, the feed shown. */
  const markUnderFeed = () => view.element.querySelector('.updating')?.previousElementSibling?.matches('.thread:not(.kept)') === true;
  return { view, source, feeds, saves, seen, markUnderFeed, metas };
}

test('sessionView_Should_ShowLiveModelBeforeFirstAnswer_AndKeepNewerContextOverOldHistory', async (t) => {
  const { source, metas } = await mounted(t, undefined);
  const status = { at: Date.parse(at) + 10_000, model: 'gpt-6-sol', contextTokens: 0, contextWindow: 1_050_000 };
  const facts = () => { const meta = metas.at(-1); return [meta?.model, meta?.contextTokens, meta?.contextWindow]; };
  source.emit('session-status', status);
  assert.deepEqual(facts(), ['gpt-6-sol', 0, 1_050_000]);

  source.emit('entries', [{ type: 'assistant', uuid: 'old', timestamp: at, message: { role: 'assistant', model: 'gpt-6-astra', usage: { input_tokens: 100_000 }, content: [] } }]);
  assert.deepEqual(facts(), ['gpt-6-sol', 0, 1_050_000]);

  source.emit('entries', [{ type: 'assistant', uuid: 'new', timestamp: new Date(Date.parse(at) + 20_000).toISOString(), message: { role: 'assistant', model: 'gpt-6-sol', usage: { input_tokens: 400_000 }, content: [] } }]);
  assert.deepEqual(facts(), ['gpt-6-sol', 400_000, 1_050_000]);
});

// A session opens at once with the copy kept from the last time, marked as being brought up to date; once the viewer
// has sent the session, it shows that — the copy gone, the mark too
test('mountSession_Should_ShowKeptCopyAtOnce_MarkedAsUpdating_ThenTheFreshSession', async (t) => {
  const { view, source, seen } = await mounted(t, { entries: [prompt('u1', 'Old question')], earlier: 0, lastActivity: undefined, savedAt: 1 });
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
test('mountSession_Should_SayItLoads_When_NoCopyIsKept', async (t) => {
  const { view, source, seen } = await mounted(t, undefined);
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
test('mountSession_Should_OfferAnswersBookmarkUnderItToo_BothFlagsShowingIt', async (t) => {
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
  const { view, source } = await mounted(t, undefined, bookmarks);
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
test('mountSession_Should_ShowPromptSentFromPage_UntilClaudeWritesItDown', async (t) => {
  const { view, source } = await mounted(t, undefined);
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

// /clear, /new or /resume sent from the page: the tab goes on with another session, and what was sent and not written
// down here never will be — it is let go of
test('mountSession_Should_LetGoOfPromptsSentAndNotWrittenDown_When_TabWentOnWithAnotherSession', async (t) => {
  const { view, source } = await mounted(t, undefined);
  source.emit('open');
  source.emit('entries', [prompt('u1', 'Question')]);
  source.emit('ready');
  await settled();
  view.expectPrompt('/new');

  view.forgetSent();
  const shown = [...view.element.querySelectorAll('.msg.user.sent')].length;
  view.dispose();

  assert.equal(shown, 0);
});

// Over the feed — above its earliest entries and the button that loads earlier ones — the page puts the conversation
// the tab went on from; another takes its place, none leaves nothing there
test('mountSession_Should_ShowLeadAboveEverything_ReplacingTheOneBefore', async (t) => {
  const { view, source } = await mounted(t, { entries: [prompt('u1', 'Question')], earlier: 3, lastActivity: undefined, savedAt: 1 });
  source.emit('open');
  source.emit('ready');
  await settled();
  /** @param {string} text */
  const lead = (text) => Object.assign(window.document.createElement('a'), { textContent: text });
  const first = () => view.element.firstElementChild?.textContent;

  view.setLead(lead('Earlier: rate limits'));
  const set = first();
  view.setLead(lead('Earlier: checkout'));
  const replaced = [first(), view.element.textContent?.includes('rate limits')];
  view.setLead(undefined);
  const cleared = view.element.textContent?.includes('checkout');
  view.dispose();

  assert.deepEqual({ set, replaced, cleared }, { set: 'Earlier: rate limits', replaced: ['Earlier: checkout', false], cleared: false });
});

// A shell command or a slash command sent from the page is written down as a command, not a prompt: it is no longer
// shown as sent then either — a shell command typed right after its "!" too
test('mountSession_Should_StopShowingCommandSentFromPage_When_ClaudeWritesItDown', async (t) => {
  const { view, source } = await mounted(t, undefined);
  source.emit('open');
  source.emit('entries', [prompt('u1', 'Question')]);
  source.emit('ready');
  await settled();
  const sentShown = () => [...view.element.querySelectorAll('.msg.user.sent .bubble-text')].map((bubble) => bubble.textContent);

  for (const text of ["! npm run deploy -- --env 'shop prod'", '!git status', '/model opus']) view.expectPrompt(text);
  const meanwhile = sentShown();
  source.emit('entries', [
    prompt('u2', "<bash-input> npm run deploy -- --env 'shop prod'</bash-input>"),
    prompt('u3', '<bash-input>git status</bash-input>'),
    prompt('u4', '<command-name>/model</command-name>\n<command-message>model</command-message>\n<command-args>opus</command-args>'),
  ]);
  await settled();
  const after = sentShown();
  view.dispose();

  assert.deepEqual({ meanwhile, after }, { meanwhile: ["! npm run deploy -- --env 'shop prod'", '!git status', '/model opus'], after: [] });
});

// A copy kept with the viewer's token shows at once as the session itself — marked as being brought up to date under
// its latest message — and the viewer, asked from the token, sends what came since alone: no entry twice; the copy is
// kept again with the viewer's new token
test('mountSession_Should_GoOnFromKeptCopyWithToken_ShowingItAtOnceAsTheSession', async (t) => {
  const old = prompt('u1', 'Old question');
  const { view, source, saves, seen, markUnderFeed } = await mounted(t, { entries: [old], earlier: 0, token: 't1', lastActivity: undefined, savedAt: 1 });
  const meanwhile = { ...seen(), from: source.from, markUnderFeed: markUnderFeed() };

  source.emit('open', { resumed: true });
  source.emit('entries', [prompt('u2', 'New question')]);
  source.emit('cursor', cursor('t2', [old, prompt('u2', 'New question')]));
  source.emit('ready');
  await settled();
  view.dispose();

  assert.deepEqual(
    { meanwhile, after: seen(), keptToken: saves.at(-1)?.token },
    { meanwhile: { prompts: ['Old question'], loading: false, updating: true, from: 't1', markUnderFeed: true }, after: { prompts: ['Old question', 'New question'], loading: false, updating: false }, keptToken: 't2' },
  );
});

// A copy the viewer cannot go on from — the file rewritten, another build — stays in view, marked as being brought up
// to date, while the session comes whole; then the session shows in its place, no entry twice
test('mountSession_Should_KeepCopyInView_When_ViewerCannotGoOnFromIt_ThenShowSessionWhole', async (t) => {
  const { view, source, seen } = await mounted(t, { entries: [prompt('u1', 'Old question')], earlier: 0, token: 't1', lastActivity: undefined, savedAt: 1 });

  source.emit('open', { resumed: true });
  source.emit('reset');
  const meanwhile = seen();
  const whole = [prompt('u1', 'Old question'), prompt('u9', 'Another question')];
  source.emit('entries', whole);
  source.emit('cursor', cursor('t9', whole));
  source.emit('ready');
  await settled();
  view.dispose();

  assert.deepEqual({ meanwhile, after: seen() }, { meanwhile: { prompts: ['Old question'], loading: false, updating: true }, after: { prompts: ['Old question', 'Another question'], loading: false, updating: false } });
});

// The viewer says the page should hold other entries than it does — whatever went wrong: the session is read anew from
// its start, asked for with no token, the feed out of step let go of
test('mountSession_Should_ReadSessionAnew_When_ItsCopyIsOutOfStepWithViewer', async (t) => {
  const { view, source, feeds, seen } = await mounted(t, undefined);
  source.emit('open');
  source.emit('entries', [prompt('u1', 'Question')]);

  source.emit('cursor', { token: 't1', shown: 5, check: 'x' });
  const anew = feeds[1];
  assert.ok(anew);
  const whole = [prompt('u1', 'Question'), prompt('u2', 'Next question')];
  anew.emit('open');
  anew.emit('entries', whole);
  anew.emit('cursor', cursor('t2', whole));
  anew.emit('ready');
  await settled();
  view.dispose();

  assert.deepEqual({ firstLetGo: source.letGo, from: anew.from, after: seen().prompts }, { firstLetGo: true, from: undefined, after: ['Question', 'Next question'] });
});

// The stream reconnected: the feed goes on from its copy, nothing sent again; reconnected while entries past the last
// token are held — they would come twice — it starts over and the session comes whole, no entry twice either
test('mountSession_Should_GoOnAfterReconnect_FromItsCopy_OrStartOverWithEntriesPastToken', async (t) => {
  const { view, source, seen } = await mounted(t, undefined);
  const first = [prompt('u1', 'First')];
  source.emit('open');
  source.emit('entries', first);
  source.emit('cursor', cursor('t1', first));
  source.emit('ready');
  await settled();

  const goesOnFrom = source.wanted.from();
  source.emit('open', { resumed: true });
  source.emit('entries', [prompt('u2', 'Second')]);
  source.emit('cursor', cursor('t2', [...first, prompt('u2', 'Second')]));
  const wentOn = seen().prompts;
  source.emit('entries', [prompt('u3', 'Third')]);
  const pastToken = source.wanted.from();
  source.emit('open', { resumed: false });
  const whole = [...first, prompt('u2', 'Second'), prompt('u3', 'Third')];
  source.emit('entries', whole);
  source.emit('cursor', cursor('t3', whole));
  source.emit('ready');
  await settled();
  view.dispose();

  assert.deepEqual({ goesOnFrom, wentOn, pastToken, after: seen().prompts }, { goesOnFrom: 't1', wentOn: ['First', 'Second'], pastToken: undefined, after: ['First', 'Second', 'Third'] });
});
