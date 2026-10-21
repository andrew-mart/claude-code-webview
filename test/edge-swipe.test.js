import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { watchEdgeSwipe } from '../public/view/edge-swipe.js';

/**
 * A phone's page that counts the swipes from its left edge.
 * @param {import('node:test').TestContext} t
 */
function phonePage(t) {
  const { window } = new JSDOM('<!doctype html><html><body></body></html>');
  t.after(() => window.close());
  const seen = { swipes: 0 };
  watchEdgeSwipe(window.document, () => seen.swipes++);
  return { window, seen };
}

/**
 * A finger put down at the first point and drawn through the others, then lifted.
 * @param {import('jsdom').DOMWindow} window
 * @param {readonly (readonly [number, number])[]} path — [x, y] in CSS pixels
 */
function drag(window, path) {
  /**
   * @param {string} type
   * @param {readonly (readonly [number, number])[]} at
   */
  const fire = (type, at) => {
    const event = new window.Event(type, { bubbles: true });
    Object.defineProperty(event, 'touches', { value: at.map(([clientX, clientY]) => ({ clientX, clientY })) });
    window.document.body.dispatchEvent(event);
  };
  const [first, ...rest] = path;
  if (first !== undefined) fire('touchstart', [first]);
  for (const point of rest) fire('touchmove', [point]);
  fire('touchend', []);
}

// A finger drawn to the right from the screen's left edge is a swipe that opens the session list
test('edgeSwipe_Should_BeTold_When_FingerDrawnRightFromLeftEdge', (t) => {
  const { window, seen } = phonePage(t);

  drag(window, [
    [6, 400],
    [30, 404],
    [90, 410],
  ]);

  assert.equal(seen.swipes, 1);
});

// The feed scrolled by a finger put down at the edge, or a finger drawn right in the middle of the screen, is no swipe
test('edgeSwipe_Should_NotBeTold_When_FingerScrollsOrStartsAwayFromEdge', (t) => {
  const { window, seen } = phonePage(t);

  drag(window, [
    [6, 400],
    [12, 470],
    [70, 560],
  ]);
  drag(window, [
    [120, 400],
    [220, 404],
  ]);

  assert.equal(seen.swipes, 0);
});
