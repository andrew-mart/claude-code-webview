import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const { window } = new JSDOM('<!doctype html><html><body></body></html>');
// the icons are drawn as their module loads: the DOM is set up first
Object.assign(globalThis, { window, document: window.document });
const { createPinButton } = await import('../public/view/pin-button.js');

const spec = 'D:\\dev\\shop\\docs\\spec.md';

// The 📌 over a file pins it beside the open session — to its project or to it alone, as chosen once pressed — and,
// pressed while the file is pinned, unpins it; there is none over no file, or while no session is open
test('pinButton_Should_PinFileWhereChosen_UnpinItWhenPinned_AndBeThereOnlyWithSessionOpen', () => {
  /** @type {readonly import('../public/model/pins.js').PinScope[] | undefined} */
  let scopes = [];
  /** @type {string[][]} */
  const asked = [];
  const pin = createPinButton({
    scopesOf: () => scopes,
    pin: (path, scope) => void asked.push(['pin', path, scope]),
    unpin: (path) => void asked.push(['unpin', path]),
  });
  window.document.body.replaceChildren(pin.element);
  const button = () => pin.element.querySelector('.panel-pin');
  const choice = () => pin.element.querySelector('.panel-pin-choice');
  const press = (/** @type {string} */ selector) => pin.element.querySelector(selector)?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

  pin.show(undefined);
  const overNoFile = pin.element.hidden;
  pin.show(spec);
  const unpinned = { shown: !pin.element.hidden, pressed: button()?.getAttribute('aria-pressed') };
  press('.panel-pin');
  const choosing = choice()?.hasAttribute('hidden') === false;
  press('.panel-pin-to-folder');
  const chosen = choice()?.hasAttribute('hidden');
  scopes = ['folder'];
  pin.refresh();
  const pressed = button()?.getAttribute('aria-pressed');
  press('.panel-pin');
  scopes = undefined;
  pin.refresh();

  assert.deepEqual(
    { overNoFile, unpinned, choosing, chosen, pressed, asked, noSession: pin.element.hidden },
    {
      overNoFile: true,
      unpinned: { shown: true, pressed: 'false' },
      choosing: true,
      chosen: true,
      pressed: 'true',
      asked: [
        ['pin', spec, 'folder'],
        ['unpin', spec],
      ],
      noSession: true,
    },
  );
});
