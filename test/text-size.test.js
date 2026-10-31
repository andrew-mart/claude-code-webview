import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const { window } = new JSDOM('<!doctype html><html><body></body></html>');
// the icons are drawn as their module loads: the DOM is set up first
Object.assign(globalThis, { window, document: window.document });
const { createTextSizeControl } = await import('../public/view/text-size.js');

// The conversation's text is made a step larger or smaller from the menu, its size shown between the two buttons; past
// the largest there is no larger — the button is not there to press
test('textSizeControl_Should_ChooseTextAStepLargerOrSmaller_ShowingItsSize', () => {
  let size = '135';
  /** @type {string[]} */
  const chosen = [];
  const control = createTextSizeControl({
    size: () => size,
    choose: (next) => {
      chosen.push(next);
      size = next;
    },
  });
  /** @param {string} label */
  const button = (label) => {
    const found = control.querySelector(`button[aria-label="${label}"]`);
    assert.ok(found instanceof window.HTMLButtonElement, `no ${label}`);
    return found;
  };
  const shown = () => control.querySelector('.text-size-value')?.textContent;

  const before = shown();
  button('Larger text').click();
  const largest = { shown: shown(), larger: button('Larger text').disabled };
  button('Smaller text').click();

  assert.deepEqual({ before, largest, after: shown(), chosen }, { before: '135%', largest: { shown: '150%', larger: true }, after: '135%', chosen: ['150', '135'] });
});
