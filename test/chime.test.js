import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createChime } from '../public/view/chime.js';

// The browser's audio is made while the page idles, not at a press — making it takes a while, and a press starts a
// swipe that is to follow the finger at once — a press only wakes it, as the browser lets a page sound once its reader
// has done something
test('chime_Should_MakeItsAudioWhileThePageIdles_APressOnlyWakingIt', (t) => {
  const { window } = new JSDOM('<!doctype html><html><body></body></html>');
  t.after(() => window.close());
  let made = 0;
  let woken = 0;
  /** @type {(() => void)[]} */
  const idling = [];
  createChime(window.document, {
    audio: () => {
      made += 1;
      return {
        state: 'suspended',
        currentTime: 0,
        resume: async () => void (woken += 1),
        createOscillator: () => assert.fail('nothing is played here'),
        createGain: () => assert.fail('nothing is played here'),
        get destination() {
          return assert.fail('nothing is played here');
        },
      };
    },
    idle: (then) => void idling.push(then),
  });
  const press = () => window.document.dispatchEvent(new window.Event('pointerdown'));

  press();
  const madeAtPress = made;
  for (const then of idling.splice(0)) then();
  const madeWhenIdle = made;
  press();

  assert.deepEqual({ madeAtPress, madeWhenIdle, woken }, { madeAtPress: 0, madeWhenIdle: 1, woken: 1 });
});
