import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createFeedPager } from '../public/view/feed-pager.js';

/**
 * A phone's feed column, 400px wide: the feed shown, and the feeds of the tabs beside it parked there — or none.
 * @param {import('node:test').TestContext} t
 * @param {'both' | 'none'} beside
 */
function pagerOver(t, beside) {
  const { window } = new JSDOM('<!doctype html><html><body><div class="feed-column"><div class="scroller shown"></div><div class="scroller parked before"></div><div class="scroller parked after"></div></div></body></html>');
  t.after(() => window.close());
  const find = (/** @type {string} */ selector) => {
    const found = window.document.querySelector(selector);
    assert.ok(found instanceof window.HTMLElement);
    return found;
  };
  const [column, shown, before, after] = ['.feed-column', '.shown', '.before', '.after'].map(find);
  assert.ok(column !== undefined && shown !== undefined && before !== undefined && after !== undefined);
  /** @type {string[]} */
  const gone = [];
  /** The feeds beside asked for: one is mounted for it when not kept. @type {string[]} */
  const asks = [];
  /** @type {(() => void)[]} */
  const waiting = [];
  /** What goes along with the feed was told. @type {string[]} */
  const told = [];
  const pager = createFeedPager({
    column,
    shown: () => shown,
    beside: (direction) => {
      asks.push(direction);
      return beside === 'none' ? undefined : direction === 'next' ? after : before;
    },
    go: (direction) => void gone.push(direction),
    width: () => 400,
    frame: (draw) => draw(),
    later: (_, done) => void waiting.push(done),
    along: {
      follow: (direction, share) => void told.push(`follow ${direction} ${share}`),
      settle: (direction) => void told.push(`settle ${direction ?? 'back'}`),
      clear: () => void told.push('clear'),
    },
  });
  /** The waits over: what was to happen after them, done. */
  const waited = () => {
    for (const done of waiting.splice(0)) done();
  };
  /** Where each feed is drawn, and which peek in. */
  const drawn = () => ({
    swiping: column.classList.contains('swiping'),
    shown: shown.style.transform,
    before: `${before.classList.contains('peeking') ? 'peeking ' : ''}${before.style.transform}`,
    after: `${after.classList.contains('peeking') ? 'peeking ' : ''}${after.style.transform}`,
  });
  return { pager, gone, asks, told, waited, drawn };
}

// The feed drawn sideways brings the feed of the tab beside with it, side by side as a pager's — the next one from the
// right when drawn left, the one before from the left when drawn right, each asked for once it is drawn that way and
// not before — and, settled on it, both slide the rest of the way before the page goes there; the feed shown there, the
// pager is cleared
test('feedPager_Should_BringTheFeedBesideAlong_AndSlideOnToIt_BeforeGoingThere', (t) => {
  const { pager, gone, asks, waited, drawn } = pagerOver(t, 'both');

  pager.follow(-100);
  pager.follow(-120);
  pager.follow(-100);
  const drawnLeft = drawn();
  pager.follow(50);
  const drawnRight = drawn();
  pager.settle('previous');
  const sliding = { ...drawn(), gone: [...gone] };
  waited();
  const slid = [...gone];
  pager.clear();

  assert.deepEqual(
    { drawnLeft, drawnRight, sliding, slid, cleared: drawn(), asks },
    {
      drawnLeft: { swiping: true, shown: 'translateX(-100px)', before: '', after: 'peeking translateX(300px)' },
      drawnRight: { swiping: true, shown: 'translateX(50px)', before: 'peeking translateX(-350px)', after: '' },
      sliding: { swiping: true, shown: 'translateX(400px)', before: 'peeking translateX(0px)', after: '', gone: [] },
      slid: ['previous'],
      cleared: { swiping: false, shown: '', before: '', after: '' },
      asks: ['next', 'previous'],
    },
  );
});

// With no tab beside the feed follows a third as far, and let go — even far enough — it slides back in its place, the
// page going nowhere
test('feedPager_Should_FollowAThirdAsFar_AndSlideBack_When_NoTabIsBeside', (t) => {
  const { pager, gone, waited, drawn } = pagerOver(t, 'none');

  pager.follow(-90);
  const drawnLeft = drawn();
  pager.settle('next');
  const sliding = drawn();
  waited();

  assert.deepEqual(
    { drawnLeft, sliding, gone, after: drawn() },
    {
      drawnLeft: { swiping: true, shown: 'translateX(-30px)', before: '', after: '' },
      sliding: { swiping: true, shown: 'translateX(0px)', before: '', after: '' },
      gone: [],
      after: { swiping: false, shown: '', before: '', after: '' },
    },
  );
});

// What goes along with the feed — the tabs' row, the title — is told how far toward the tab beside the feed is drawn, as
// a share of the column's width, where it settles, and when the pager is cleared; with no tab beside, only where it
// settles — back — and the clearing
test('feedPager_Should_TellWhatGoesAlongHowFarTowardTheTabBeside_AndWhereItSettles', (t) => {
  const both = pagerOver(t, 'both');
  const none = pagerOver(t, 'none');

  both.pager.follow(-100);
  both.pager.follow(50);
  both.pager.settle('previous');
  both.waited();
  both.pager.clear();
  none.pager.follow(-90);
  none.pager.settle('next');
  none.waited();

  assert.deepEqual(
    { both: both.told, none: none.told },
    { both: ['follow next 0.25', 'follow previous 0.125', 'settle previous', 'clear'], none: ['settle back', 'clear'] },
  );
});
