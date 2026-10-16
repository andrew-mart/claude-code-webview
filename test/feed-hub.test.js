import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFeedHub } from '../public/view/feed-hub.js';

/** The page's stream from the viewer, played by the test: it tells what the server sends. */
class FakeSource {
  static CLOSED = 2;
  readyState = 0;
  /** @param {string} url */
  constructor(url) {
    this.url = url;
    /** @type {Record<string, ((message: { data: string }) => void)[]>} */
    this.listeners = {};
  }
  /** @param {string} type @param {(message: { data: string }) => void} listener */
  addEventListener(type, listener) {
    (this.listeners[type] ??= []).push(listener);
  }
  /** @param {string} type @param {unknown} [data] */
  emit(type, data) {
    if (type === 'open') this.readyState = 1;
    for (const listener of this.listeners[type] ?? []) listener({ data: JSON.stringify(data ?? null) });
  }
  close() {
    this.readyState = FakeSource.CLOSED;
  }
}

/**
 * A hub over fake streams, the requests it makes recorded; asks for a feed answered as told.
 * @param {{ watched?: boolean }} [viewer] whether the viewer agrees to the feeds asked for: false, its stream is gone
 */
function hubOf({ watched = true } = {}) {
  /** @type {FakeSource[]} */
  const sources = [];
  /** @type {{ path: string, body: Record<string, unknown> }[]} */
  const asked = [];
  const hub = createFeedHub({
    page: 'p1',
    connect: (url) => {
      const source = new FakeSource(url);
      sources.push(source);
      return source;
    },
    post: async (path, body) => {
      asked.push({ path, body });
      return path !== '/api/feeds/watch' || watched;
    },
    retryMs: 0,
  });
  /** @type {string[]} */
  const heard = [];
  /**
   * A feed opened, what it hears recorded under its name.
   * @param {string} name @param {{ session: string, tail?: number }} wants @param {() => string | undefined} from
   */
  const feed = (name, wants, from = () => undefined) => {
    const opened = hub.open({ ...wants, from });
    for (const event of ['open', 'error', 'entries', 'cursor', 'reset', 'ready']) opened.on(event, (data) => heard.push(`${name} ${event} ${JSON.stringify(data)}`));
    return opened;
  };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 5));
  return { sources, asked, heard, feed, settle };
}

// Two sessions followed over one stream: each feed asked for with its own name and what it wants — the session, how
// much of it, the token of the copy it goes on from — and each hears its own events alone
test('feedHub_Should_FollowFeedsOverOneStream_EachHearingItsOwn', async () => {
  const page = hubOf();
  page.feed('a', { session: 's1', tail: 800 }, () => 't1');
  page.feed('b', { session: 's2' });
  const [source] = page.sources;
  assert.ok(source);

  source.emit('open');
  await page.settle();
  source.emit('entries', { feed: 'f1', data: [{ uuid: 'u1' }] });
  source.emit('cursor', { feed: 'f2', data: { token: 't9' } });

  assert.deepEqual(
    { sources: page.sources.map((one) => one.url), asked: page.asked, heard: page.heard },
    {
      sources: ['/api/feeds?page=p1'],
      asked: [
        { path: '/api/feeds/watch', body: { page: 'p1', feed: 'f1', session: 's1', tail: 800, from: 't1' } },
        { path: '/api/feeds/watch', body: { page: 'p1', feed: 'f2', session: 's2' } },
      ],
      heard: ['a open {"resumed":true}', 'b open {"resumed":false}', 'a entries [{"uuid":"u1"}]', 'b cursor {"token":"t9"}'],
    },
  );
});

// A feed closed is let go of: the viewer is told, and what still comes for it is not heard
test('feedHub_Should_LetGoOfFeedClosed', async () => {
  const page = hubOf();
  const a = page.feed('a', { session: 's1' });
  const [source] = page.sources;
  assert.ok(source);
  source.emit('open');
  await page.settle();

  a.close();
  await page.settle();
  source.emit('entries', { feed: 'f1', data: [{ uuid: 'u2' }] });

  assert.deepEqual({ asked: page.asked.map((one) => `${one.path} ${one.body.feed}`), heard: page.heard }, { asked: ['/api/feeds/watch f1', '/api/feeds/unwatch f1'], heard: ['a open {"resumed":false}'] });
});

// The stream reconnected — the viewer restarted, the network came back — every feed opens again and is asked for anew,
// from the token of its copy as it is now: it goes on where it stopped
test('feedHub_Should_AskForEveryFeedAgain_FromItsCopyNow_When_StreamReconnects', async () => {
  const page = hubOf();
  let token = 't1';
  page.feed('a', { session: 's1' }, () => token);
  const [source] = page.sources;
  assert.ok(source);
  source.emit('open');
  await page.settle();

  token = 't5';
  source.emit('error');
  source.emit('open');
  await page.settle();

  assert.deepEqual(
    { froms: page.asked.map((one) => one.body.from), heard: page.heard },
    { froms: ['t1', 't5'], heard: ['a open {"resumed":true}', 'a error null', 'a open {"resumed":true}'] },
  );
});

// The viewer refuses a feed — it no longer knows the page's stream, restarted under it: the stream is opened anew, and
// every feed asked for again over it
test('feedHub_Should_OpenStreamAnew_When_ViewerRefusesFeed', async () => {
  const page = hubOf({ watched: false });
  page.feed('a', { session: 's1' });
  const [first] = page.sources;
  assert.ok(first);
  first.emit('open');
  await page.settle();
  await page.settle();

  assert.deepEqual({ sources: page.sources.length, firstClosed: first.readyState === FakeSource.CLOSED }, { sources: 2, firstClosed: true });
});

// A stream the browser gave up on — refused outright, a proxy's error page — is opened again for a feed opened later
test('feedHub_Should_OpenStreamAgain_ForFeedOpenedAfterItClosed', () => {
  const page = hubOf();
  const a = page.feed('a', { session: 's1' });
  const [first] = page.sources;
  assert.ok(first);
  first.close();
  first.emit('error');

  const closedSeen = a.closed();
  page.feed('b', { session: 's2' });

  assert.deepEqual({ closedSeen, sources: page.sources.length }, { closedSeen: true, sources: 2 });
});
