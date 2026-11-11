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
  /** The statuses told, the latest last. @type {import('../public/view/session-view.js').SessionStatus[]} */
  const statuses = [];
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
    listener: { onMeta: (meta) => metas.push(meta), onStatus: (status) => void statuses.push(status), onPrompt: () => undefined, onReset: () => undefined },
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
  return { view, source, feeds, saves, seen, markUnderFeed, metas, statuses };
}

// A session with nothing written down yet — Codex opened in a tab writes its conversation only with the first message —
// says so in place of its feed, and how it starts: with the first message, from the box; once it is written down the
// feed takes its place
test('sessionView_Should_SayNothingIsWrittenYet_UntilTheConversationComes', async (t) => {
  const { view, source } = await mounted(t, undefined);
  const told = () => {
    const empty = view.element.querySelector('.feed-empty');
    return empty === null || empty.closest('[hidden]') !== null ? undefined : empty.textContent;
  };

  source.emit('missing', null);
  const missing = told();
  const running = await mounted(t, undefined);
  running.source.emit('open');
  running.source.emit('ready');
  await settled();
  const runningEmpty = running.view.element.querySelector('.feed-empty:not([hidden])')?.textContent;
  running.source.emit('entries', [prompt('u1', 'Question')]);
  await settled();

  assert.deepEqual(
    { missing, runningEmpty, written: running.view.element.querySelector('.feed-empty:not([hidden])') },
    {
      missing: 'Nothing is written down yet: the conversation starts with its first message — write it in the box below.',
      runningEmpty: 'Nothing is written down yet: the conversation starts with its first message — write it in the box below.',
      written: null,
    },
  );
});

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

// A session never kept opens with its latest entries alone, shown at once, then the rest of its tail: the latest stay in
// view meanwhile, marked over them where the earlier ones will come, until those are in; one whose latest entries are
// all there is is not asked for again
test('mountSession_Should_OpenWithLatestEntriesFirst_ThenEarlierOnes_MarkedWhereTheyWillCome', async (t) => {
  const { view, feeds, seen } = await mounted(t, undefined);
  const earlierMark = () => view.element.querySelector('.loading-earlier:not([hidden])') !== null;
  const latest = feeds[0];
  assert.ok(latest);

  latest.emit('open');
  latest.emit('earlier', { count: 2 });
  latest.emit('entries', [prompt('u3', 'Latest question')]);
  latest.emit('ready');
  await settled();
  const first = { tail: latest.wanted.tail, seen: seen(), earlierMark: earlierMark(), letGo: latest.letGo };
  const whole = feeds[1];
  assert.ok(whole, 'the rest of the tail not asked for');
  whole.emit('open');
  whole.emit('entries', [prompt('u1', 'First question'), prompt('u2', 'Second question'), prompt('u3', 'Latest question')]);
  whole.emit('ready');
  await settled();
  const then = { tail: whole.wanted.tail, seen: seen(), earlierMark: earlierMark() };
  view.dispose();
  const small = await mounted(t, undefined);
  small.source.emit('open');
  small.source.emit('entries', [prompt('u1', 'The only question')]);
  small.source.emit('ready');
  await settled();

  assert.deepEqual(
    { first, then, askedAgain: small.feeds.length > 1 },
    {
      first: { tail: 50, seen: { prompts: ['Latest question'], loading: false, updating: false }, earlierMark: true, letGo: true },
      then: { tail: 2000, seen: { prompts: ['First question', 'Second question', 'Latest question'], loading: false, updating: false }, earlierMark: false },
      askedAgain: false,
    },
  );
});

// "Show earlier" loads the entries before those shown a part at a time — as many as the session opened with — not the
// whole session: thousands in a long one, a phone's page thrown away for its size. The button tells how many it loads of
// how many are left; the last part, all that is left
test('mountSession_Should_LoadEarlierEntriesAPartAtATime_NotTheWholeSession', async (t) => {
  const { view, feeds } = await mounted(t, undefined);
  const button = () => view.element.querySelector('.earlier:not([hidden])')?.textContent;
  const latest = feeds[0];
  assert.ok(latest);
  latest.emit('open');
  latest.emit('earlier', { count: 5049 });
  latest.emit('entries', [prompt('u9', 'Latest question')]);
  latest.emit('ready');
  await settled();
  const tail = feeds[1];
  assert.ok(tail);
  tail.emit('open');
  tail.emit('earlier', { count: 3050 });
  tail.emit('entries', [prompt('u8', 'Question before'), prompt('u9', 'Latest question')]);
  tail.emit('ready');
  await settled();
  const first = button();

  void view.loadEarlier();
  const part = feeds[2];
  assert.ok(part);
  part.emit('open');
  part.emit('earlier', { count: 1050 });
  part.emit('entries', [prompt('u7', 'Older question'), prompt('u8', 'Question before'), prompt('u9', 'Latest question')]);
  part.emit('ready');
  await settled();

  assert.deepEqual({ first, asked: part.wanted.tail, then: button() }, { first: 'Show 2,000 of 3,050 earlier entries', asked: 4000, then: 'Show 1,050 earlier entries' });
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

// A call left without its output once the agent is at its prompt — agy, stopped, writes nothing of it — shows cut
// short, not running; the agent at work again, it runs as far as the feed can tell
test('mountSession_Should_ShowCallLeftWaiting_CutShort_WhileAgentIsAtItsPrompt', async (t) => {
  const { view, source } = await mounted(t, undefined);
  source.emit('open');
  source.emit('entries', [prompt('u1', 'Write the notes'), { type: 'assistant', uuid: 'a1', timestamp: at, message: { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Write', input: { file_path: 'D:\\shop\\notes.md', content: '# Notes' } }] } }]);
  source.emit('ready');
  await settled();
  const states = () => [...view.element.querySelectorAll('.tool')].map((tool) => tool.getAttribute('data-state'));

  const working = states();
  view.agentAtPrompt(true);
  const atPrompt = states();
  view.agentAtPrompt(false);
  const again = states();

  assert.deepEqual({ working, atPrompt, again }, { working: ['pending'], atPrompt: ['stopped'], again: ['pending'] });
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

// A slash command sent from the page that opens a dialog in the terminal — /mcp — is written down only once the dialog
// does something, and not at all when it is left with Esc: the dialog showing, the slash commands sent are let go of;
// a prompt sent stays until it is written down
test('mountSession_Should_LetGoOfSlashCommandsSent_When_TerminalShowsDialog', async (t) => {
  const { view, source } = await mounted(t, undefined);
  source.emit('open');
  source.emit('entries', [prompt('u1', 'Question')]);
  source.emit('ready');
  await settled();
  view.expectPrompt('/mcp');
  view.expectPrompt('Check the limits');

  view.forgetSentCommands();
  const shown = [...view.element.querySelectorAll('.msg.user.sent .bubble-text')].map((bubble) => bubble.textContent);
  view.dispose();

  assert.deepEqual(shown, ['Check the limits']);
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
// its latest message — and the viewer, asked from the token, sends what came since alone: no entry twice, the session
// not asked for again — a long one's copy, earlier entries not in it, as it is; the copy is kept again with the
// viewer's new token
test('mountSession_Should_GoOnFromKeptCopyWithToken_ShowingItAtOnceAsTheSession', async (t) => {
  const old = prompt('u1', 'Old question');
  const { view, source, feeds, saves, seen, markUnderFeed } = await mounted(t, { entries: [old], earlier: 900, token: 't1', lastActivity: undefined, savedAt: 1 });
  const meanwhile = { ...seen(), from: source.from, markUnderFeed: markUnderFeed() };

  source.emit('open', { resumed: true });
  source.emit('entries', [prompt('u2', 'New question')]);
  source.emit('cursor', cursor('t2', [old, prompt('u2', 'New question')], 900));
  source.emit('ready');
  await settled();
  const asked = feeds.length;
  view.dispose();

  assert.deepEqual(
    { meanwhile, after: seen(), asked, keptToken: saves.at(-1)?.token },
    { meanwhile: { prompts: ['Old question'], loading: false, updating: true, from: 't1', markUnderFeed: true }, after: { prompts: ['Old question', 'New question'], loading: false, updating: false }, asked: 1, keptToken: 't2' },
  );
});

/**
 * The session's scroller laid out as jsdom does not: an entry of the feed 100 px tall, a mark 40 px, none of it in view
 * but its bottom edge.
 * @param {{ element: HTMLElement }} view
 */
function laidOut(view) {
  const scroller = view.element.parentElement;
  assert.ok(scroller);
  Object.defineProperty(scroller, 'scrollHeight', { get: () => 100 * view.element.querySelectorAll('.thread:not([hidden]) > *').length + 40 * view.element.querySelectorAll('.updating:not([hidden])').length });
  Object.defineProperty(scroller, 'clientHeight', { get: () => 0 });
  return scroller;
}

// What shows under the feed once it is brought to the bottom — the mark of being brought up to date, under a copy kept
// — lets go of nothing: the reader did not scroll up, and what came since brings them to the latest message
test('mountSession_Should_EndAtLatestMessage_When_MarkShowsUnderCopyBroughtToBottom', async (t) => {
  const old = prompt('u1', 'Old question');
  const { view, source } = await mounted(t, { entries: [old], earlier: 0, token: 't1', lastActivity: undefined, savedAt: 1 });
  const scroller = laidOut(view);
  // the browser tells of the feed brought to the bottom as the copy showed — after the mark showed under it
  scroller.dispatchEvent(new window.Event('scroll'));

  source.emit('open', { resumed: true });
  const since = [prompt('u2', 'New question'), prompt('u3', 'Newer question')];
  source.emit('entries', since);
  source.emit('cursor', cursor('t2', [old, ...since]));
  source.emit('ready');
  await settled();
  const below = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
  const jumpShown = view.element.querySelector('.jump:not([hidden])') !== null;
  view.dispose();

  assert.deepEqual({ atLatest: below <= 0, jumpShown }, { atLatest: true, jumpShown: false });
});

// The reader scrolling up is let go of the bottom: what comes next leaves them where they read, the button back to the
// latest message showing
test('mountSession_Should_LeaveReaderWhereTheyRead_When_TheyScrollUp', async (t) => {
  const { view, source } = await mounted(t, undefined);
  const scroller = laidOut(view);
  source.emit('open');
  source.emit('entries', [prompt('u1', 'First question'), prompt('u2', 'Second question'), prompt('u3', 'Third question')]);
  source.emit('ready');
  await settled();
  scroller.dispatchEvent(new window.Event('scroll'));

  scroller.scrollTop = 50;
  scroller.dispatchEvent(new window.Event('scroll'));
  source.emit('entries', [prompt('u4', 'Fourth question')]);
  await settled();
  const read = { scrollTop: scroller.scrollTop, jumpShown: view.element.querySelector('.jump:not([hidden])') !== null };
  view.dispose();

  assert.deepEqual(read, { scrollTop: 50, jumpShown: true });
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

// The page's stream lost — a phone's app put away and brought back, the link gone a while — the session shown is behind
// it, and says so: under its latest message, as being brought up to date, its status no longer the one it had — not
// "Working" over a feed that stopped moving — until the stream is back and the viewer tells it is up to date again
test('mountSession_Should_SayItIsBehind_WhileTheStreamIsLostAndBack_UntilTheViewerTellsItIsUpToDate', async (t) => {
  const { view, source, seen, statuses, markUnderFeed } = await mounted(t, undefined);
  const first = [prompt('u1', 'First')];
  source.emit('open');
  source.emit('entries', first);
  source.emit('cursor', cursor('t1', first));
  source.emit('ready');
  await settled();
  const upToDate = { ...seen(), status: statuses.at(-1) };

  /** What the mark under the feed says. */
  const said = () => view.element.querySelector('.updating')?.textContent;
  source.emit('error');
  const lost = { ...seen(), status: statuses.at(-1), markUnderFeed: markUnderFeed(), said: said() };
  source.emit('open', { resumed: true });
  source.emit('entries', [prompt('u2', 'Second')]);
  const back = { ...seen(), status: statuses.at(-1), said: said() };
  source.emit('cursor', cursor('t2', [...first, prompt('u2', 'Second')]));
  source.emit('ready');
  await settled();
  view.dispose();

  assert.deepEqual(
    { upToDate, lost, back, again: { ...seen(), status: statuses.at(-1) } },
    {
      upToDate: { prompts: ['First'], loading: false, updating: false, status: 'idle' },
      lost: { prompts: ['First'], loading: false, updating: true, status: 'connecting', markUnderFeed: true, said: '✻Reconnecting…' },
      back: { prompts: ['First', 'Second'], loading: false, updating: true, status: 'connecting', said: '✻Updating…' },
      again: { prompts: ['First', 'Second'], loading: false, updating: false, status: 'idle' },
    },
  );
});

// A prompt sent from the page and written down otherwise — edited in the terminal before it went, Esc having brought it
// back to the box — will not come as it was sent: a new prompt written down in its place lets it go; the session laid
// out anew — its prompts coming again after a reset — lets go of nothing
test('mountSession_Should_LetGoOfPromptSent_When_AnotherIsWrittenDownInItsPlace', async (t) => {
  const { view, source } = await mounted(t, undefined);
  source.emit('open');
  source.emit('entries', [prompt('u1', 'Question')]);
  source.emit('ready');
  await settled();
  const sentShown = () => [...view.element.querySelectorAll('.msg.user.sent .bubble-text')].map((bubble) => bubble.textContent);

  view.expectPrompt('Check the limits');
  source.emit('reset', null);
  source.emit('entries', [prompt('u1', 'Question')]);
  await settled();
  const laidAnew = sentShown();
  source.emit('entries', [prompt('u2', 'Check the limits again — edited in the terminal')]);
  await settled();
  const after = sentShown();
  view.dispose();

  assert.deepEqual({ laidAnew, after }, { laidAnew: ['Check the limits'], after: [] });
});
