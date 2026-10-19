import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const { window } = new JSDOM('<!doctype html><html><body></body></html>');
Object.assign(globalThis, { window, document: window.document });
const { onComputer } = await import('../public/view/on-computer.js');

/** @typedef {import('../public/model/machine.js').EditorReach} EditorReach */

/**
 * A button of a browser whose place is known — or found once asked — and what its presses did.
 * @param {EditorReach} known
 * @param {EditorReach} [found]
 */
async function buttonIn(known, found = known) {
  const button = window.document.createElement('button');
  let acted = 0;
  let asked = 0;
  onComputer(button, { known: async () => known, find: async () => (asked++, found) }, () => void acted++);
  await new Promise((done) => setTimeout(done, 0));
  const press = async () => {
    button.click();
    await new Promise((done) => setTimeout(done, 0));
  };
  return { button, press, acted: () => acted, asked: () => asked };
}

// What is done on the viewer's computer has its button in a browser there, and none in one elsewhere — a phone, another
// computer; where the browser is not known yet, the button is there, and a press finds out first: on the computer it
// does it, elsewhere the button goes
test('onComputer_Should_ShowButtonOnViewersComputerOnly_FindingOutOnPressWhereNotKnown', async () => {
  const here = await buttonIn('same');
  const away = await buttonIn('elsewhere');
  const phone = await buttonIn('none');
  const foundHere = await buttonIn('unknown', 'same');
  const foundAway = await buttonIn('unknown', 'elsewhere');
  const shown = [here, away, phone, foundHere, foundAway].map(({ button }) => !button.hidden);

  for (const one of [here, foundHere, foundAway]) await one.press();

  assert.deepEqual(
    { shown, acted: [here, foundHere, foundAway].map((one) => one.acted()), asked: [here.asked(), foundHere.asked()], foundAwayShown: !foundAway.button.hidden },
    { shown: [true, false, false, true, true], acted: [1, 1, 0], asked: [0, 1], foundAwayShown: false },
  );
});
