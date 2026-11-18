import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createSwipeAlong } from '../public/view/swipe-along.js';

/**
 * A session's head and its workspace's tabs' row, laid out as a phone draws them: the open tab, redis, between
 * rate-limit and checkout.
 * @param {import('node:test').TestContext} t
 */
function headOver(t) {
  const { window } = new JSDOM(
    '<!doctype html><html><body><header class="session-head"><h1 class="title">Move the counters</h1></header><span class="herdr-tab-strip"><a class="herdr-chip" data-tab="w1:t1">rate-limit</a><a class="herdr-chip selected" data-tab="w1:t2">redis</a><a class="herdr-chip" data-tab="w1:t3">checkout</a></span></body></html>',
  );
  t.after(() => window.close());
  const strip = window.document.querySelector('.herdr-tab-strip');
  const title = window.document.querySelector('.title');
  assert.ok(strip instanceof window.HTMLElement && title instanceof window.HTMLElement);
  const laidOut = (/** @type {Element} */ element, /** @type {Record<string, number>} */ box) => {
    for (const [key, value] of Object.entries(box)) Object.defineProperty(element, key, { value });
  };
  const [rateLimit, redis, checkout] = strip.children;
  assert.ok(rateLimit !== undefined && redis !== undefined && checkout !== undefined);
  laidOut(rateLimit, { offsetLeft: 0, offsetWidth: 80, offsetTop: 2, offsetHeight: 26 });
  laidOut(redis, { offsetLeft: 84, offsetWidth: 60, offsetTop: 2, offsetHeight: 26 });
  laidOut(checkout, { offsetLeft: 148, offsetWidth: 100, offsetTop: 2, offsetHeight: 26 });
  laidOut(title, { offsetLeft: 40, offsetTop: 8, offsetWidth: 200, offsetHeight: 22 });
  const along = createSwipeAlong({
    strip: () => strip,
    tabBeside: (direction) => (direction === 'next' ? 'w1:t3' : 'w1:t1'),
    title: () => title,
    titleBeside: (direction) => (direction === 'next' ? 'Fix the flaky checkout test' : 'Rate limiting for the orders API'),
  });
  /** Where the open tab's mark is drawn, how much the title shows, and the title beside. */
  const drawn = () => {
    const mark = strip.querySelector('.herdr-chip-glide');
    const beside = window.document.querySelector('.title-beside');
    return {
      gliding: strip.classList.contains('gliding'),
      mark: mark instanceof window.HTMLElement ? `${mark.style.transform} ${mark.style.width}` : 'none',
      title: title.style.opacity,
      beside: beside instanceof window.HTMLElement ? `${beside.textContent} ${beside.style.opacity}` : 'none',
    };
  };
  return { along, drawn };
}

// As the feed is drawn toward the tab beside, the open tab's mark in the tabs' row glides toward that tab's, and the
// title gives way to the title of the session beside, each as far as the feed is drawn; settled on the tab beside both
// go the rest of the way, settled back they go back; cleared, the row and the title are as they were
test('swipeAlong_Should_GlideTheTabsMarkAndGiveTheTitleWay_AsFarAsTheFeedIsDrawn', (t) => {
  const { along, drawn } = headOver(t);

  along.follow('next', 0.5);
  const halfwayNext = drawn();
  along.follow('previous', 0.25);
  const quarterBefore = drawn();
  along.settle('previous');
  const settledBefore = drawn();
  along.clear();
  const cleared = drawn();
  along.follow('next', 0.5);
  along.settle(undefined);
  const settledBack = drawn();

  assert.deepEqual(
    { halfwayNext, quarterBefore, settledBefore, cleared, settledBack },
    {
      halfwayNext: { gliding: true, mark: 'translateX(116px) 80px', title: '0.5', beside: 'Fix the flaky checkout test 0.5' },
      quarterBefore: { gliding: true, mark: 'translateX(63px) 65px', title: '0.75', beside: 'Rate limiting for the orders API 0.25' },
      settledBefore: { gliding: true, mark: 'translateX(0px) 80px', title: '0', beside: 'Rate limiting for the orders API 1' },
      cleared: { gliding: false, mark: 'none', title: '', beside: 'none' },
      settledBack: { gliding: true, mark: 'translateX(84px) 60px', title: '1', beside: 'Fix the flaky checkout test 0' },
    },
  );
});
