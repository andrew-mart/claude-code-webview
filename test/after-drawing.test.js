import { test } from 'node:test';
import assert from 'node:assert/strict';
import { afterDrawing } from '../public/view/after-drawing.js';

/**
 * A page whose frames and timers run when the test says.
 * @param {DocumentVisibilityState} visibilityState
 */
function pageShown(visibilityState) {
  /** @type {FrameRequestCallback[]} */
  const frames = [];
  /** @type {(() => void)[]} */
  const timers = [];
  return {
    page: {
      document: { visibilityState },
      requestAnimationFrame: (/** @type {FrameRequestCallback} */ callback) => frames.push(callback),
      setTimeout: (/** @type {() => void} */ handler) => timers.push(handler),
    },
    drawFrame: () => frames.splice(0).forEach((frame) => frame(0)),
    runTimers: () => timers.splice(0).forEach((timer) => timer()),
  };
}

// A tap is answered at once: the page draws what it changed first — the list sliding away — and the heavier work, a
// session put together, comes after that frame, not in it; a hidden page draws no frames, and does it at once
test('afterDrawing_Should_RunTaskOnceNextFrameIsDrawn_OrAtOnceWhilePageIsHidden', () => {
  /** @type {string[]} */
  const done = [];
  const shown = pageShown('visible');
  afterDrawing(shown.page, () => done.push('session put together'));
  done.push('list sliding away');
  shown.drawFrame();
  done.push('frame drawn');
  shown.runTimers();
  afterDrawing(pageShown('hidden').page, () => done.push('hidden page: at once'));

  assert.deepEqual(done, ['list sliding away', 'frame drawn', 'session put together', 'hidden page: at once']);
});
