import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createVsCodeOpener } from '../public/view/vscode-opener.js';

/** @typedef {import('../public/view/vscode-opener.js').VsCodeTarget} VsCodeTarget */
/** @typedef {import('../public/model/machine.js').EditorReach} EditorReach */

/**
 * The opener over a browser whose place is known — or found once asked — and the computer's own VS Code that starts or
 * not; what was opened where, in order.
 * @param {{ known: EditorReach, found?: EditorReach, starts?: boolean }} browser
 */
async function openerIn({ known, found = known, starts = true }) {
  /** @type {string[]} */
  const opened = [];
  let asked = 0;
  const opener = createVsCodeOpener({
    places: {
      known: async () => known,
      find: async () => {
        asked++;
        return found;
      },
    },
    desktop: async (target) => {
      opened.push(`desktop ${JSON.stringify(target)}`);
      return starts;
    },
    web: (target) => void opened.push(`web ${JSON.stringify(target)}`),
  });
  await new Promise((done) => setTimeout(done, 0));
  return { opener, opened, asked: () => asked };
}
const settled = () => new Promise((done) => setTimeout(done, 0));
/** @type {VsCodeTarget} */
const file = { path: 'D:/dev/shop/src/cart.js', line: 12 };

// A browser on the viewer's computer opens the computer's own VS Code; one elsewhere — a phone, another computer, one
// that keeps the page from this computer's apps — opens VS Code in the browser at once, straight from the press, as a
// browser lets a page open a tab only then
test('vsCodeOpener_Should_OpenComputersOwnVsCode_OnItsComputer_AndVsCodeInBrowserElsewhereAtOnce', async () => {
  const here = await openerIn({ known: 'same' });
  const phone = await openerIn({ known: 'none' });
  const away = await openerIn({ known: 'elsewhere' });
  const blocked = await openerIn({ known: 'blocked' });

  here.opener.open({ folder: 'D:/dev/shop' });
  for (const { opener } of [phone, away, blocked]) opener.open(file);
  const atOnce = [phone, away, blocked].map(({ opened }) => opened.length);
  await settled();

  assert.deepEqual({ here: here.opened, atOnce, elsewhere: [phone, away, blocked].map(({ opened }) => opened) }, {
    here: ['desktop {"folder":"D:/dev/shop"}'],
    atOnce: [1, 1, 1],
    elsewhere: Array(3).fill([`web ${JSON.stringify(file)}`]),
  });
});

// Not known yet, the browser is asked once where it is, then opens what is for there; the computer's own VS Code that
// does not start leaves VS Code in the browser
test('vsCodeOpener_Should_AskWhereBrowserIsOnce_And_FallBackToBrowser_When_ComputersVsCodeDoesNotStart', async () => {
  const found = await openerIn({ known: 'unknown', found: 'same' });
  const notStarting = await openerIn({ known: 'same', starts: false });

  found.opener.open(file);
  await settled();
  found.opener.open({ folder: 'D:/dev/shop' });
  notStarting.opener.open(file);
  await settled();

  assert.deepEqual({ found: found.opened, asked: found.asked(), notStarting: notStarting.opened }, {
    found: [`desktop ${JSON.stringify(file)}`, 'desktop {"folder":"D:/dev/shop"}'],
    asked: 1,
    notStarting: [`desktop ${JSON.stringify(file)}`, `web ${JSON.stringify(file)}`],
  });
});
