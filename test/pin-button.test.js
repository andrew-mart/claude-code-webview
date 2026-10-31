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
    pin: async (path, scope) => {
      asked.push(['pin', path, scope]);
      return 'pinned';
    },
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

// On a phone the 📌 stands at the left of the panel head's second row: its choice, hung leftward from it as on a wide
// screen, would go off the screen's left edge — only the ends of its words showing — so it opens rightward from it there
test('pinButton_Should_OpenChoiceRightward_WhereLeftwardItWouldGoOffScreen', () => {
  const pin = createPinButton({ scopesOf: () => [], pin: async () => 'pinned', unpin: () => undefined });
  window.document.body.replaceChildren(pin.element);
  const choice = pin.element.querySelector('.panel-pin-choice');
  assert.ok(choice instanceof window.HTMLElement);
  /** Where the 📌's left edge is: the choice, 112 wide, is drawn leftward from its right edge, 40 on — or rightward from its left. */
  let pinAt = 17;
  choice.getBoundingClientRect = () => new window.DOMRect(choice.classList.contains('rightward') ? pinAt : pinAt + 40 - 112, 144, 112, 71);
  const press = () => pin.element.querySelector('.panel-pin')?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  pin.show(spec);

  press();
  const atLeftEdge = choice.classList.contains('rightward');
  press();
  pinAt = 300;
  press();
  const farFromIt = choice.classList.contains('rightward');

  assert.deepEqual({ atLeftEdge, farFromIt }, { atLeftEdge: true, farFromIt: false });
});

// A pin the viewer refuses — no file at the path any more — or does not answer says why by the 📌; one made says nothing
test('pinButton_Should_SayWhyFileWasNotPinned', async () => {
  /** @type {import('../public/view/pins-store.js').PinOutcome} */
  let outcome = 'not-found';
  const pin = createPinButton({ scopesOf: () => [], pin: async () => outcome, unpin: () => undefined });
  window.document.body.replaceChildren(pin.element);
  const press = (/** @type {string} */ selector) => pin.element.querySelector(selector)?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  const told = () => {
    const status = pin.element.querySelector('[role="status"]');
    return status instanceof window.HTMLElement && !status.hidden ? status.textContent : '';
  };
  const pinned = async () => {
    press('.panel-pin');
    press('.panel-pin-to-folder');
    await new Promise((done) => setTimeout(done, 0));
    return told();
  };
  pin.show(spec);

  const refused = await pinned();
  outcome = 'failed';
  const unanswered = await pinned();
  outcome = 'pinned';
  const made = await pinned();

  assert.deepEqual({ refused, unanswered, made }, { refused: 'No file there.', unanswered: 'The viewer did not answer.', made: '' });
});
