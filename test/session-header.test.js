import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const { window } = new JSDOM('<!doctype html><html><body></body></html>');
Object.assign(globalThis, { window, document: window.document });
/** A screen the tests narrow and widen: wide unless told; jsdom has no media queries of its own. */
const screen = { narrow: false };
/** @type {((event: { matches: boolean }) => void)[]} */
const screenListeners = [];
window.matchMedia = (/** @type {string} */ query) =>
  /** @type {MediaQueryList} */ (
    /** @type {unknown} */ ({
      matches: screen.narrow,
      media: query,
      addEventListener: (/** @type {string} */ _, /** @type {(event: { matches: boolean }) => void} */ listener) => void screenListeners.push(listener),
      removeEventListener: (/** @type {string} */ _, /** @type {(event: { matches: boolean }) => void} */ listener) => void screenListeners.splice(screenListeners.indexOf(listener), 1),
    })
  );
const { createSessionHeader } = await import('../public/view/session-header.js');

/**
 * A session's header, with no folder or branch known yet and nothing around it.
 * @param {string} sessionId
 */
const headerOf = (sessionId) => createSessionHeader({ sessionId, place: undefined, currentBranch: async () => undefined, tables: { value: () => 'default', choose: () => undefined }, leading: window.document.createElement('div'), navigation: [], folds: [], tools: [] });

// On a narrow screen the buttons used less there fold into the view menu, as its first group — the words of what they do
// beside them, as the view buttons have — and come back to their places, in their order, once the screen is wide; one of
// them pressed in the menu puts the menu away, as what it opens takes the screen
test('sessionHeader_Should_FoldLessUsedButtonsIntoViewMenu_OnNarrowScreen_AndBackOnWide', (t) => {
  /** @param {string} name */
  const button = (name) => {
    const made = window.document.createElement('button');
    made.dataset.name = name;
    return made;
  };
  /** @param {HTMLElement[]} buttons */
  const group = (...buttons) => {
    const made = window.document.createElement('span');
    made.append(...buttons);
    return made;
  };
  const outline = button('outline');
  const history = button('history');
  const changes = button('changes');
  const files = button('files');
  const herdr = button('herdr');
  const keep = button('keep');
  const vscode = button('vscode');
  const activity = button('activity');
  const header = createSessionHeader({ sessionId: '0d3f9a2c-1b7e-4c55-9e0a-6f2d8b41c7e3', place: undefined, currentBranch: async () => undefined, tables: { value: () => 'default', choose: () => undefined }, leading: window.document.createElement('div'), navigation: [group(outline, history, changes, files), group(herdr, keep, vscode)], folds: [history, changes, herdr, vscode], tools: [group(activity)] });
  t.after(header.dispose);
  const shown = () => {
    const all = [...header.element.querySelectorAll('button[data-name]')].filter((one) => one instanceof window.HTMLElement);
    return { row: all.filter((one) => one.closest('.head-tools') === null).map((one) => one.dataset.name), menu: all.filter((one) => one.closest('.head-tools') !== null).map((one) => one.dataset.name) };
  };
  /** @param {boolean} narrow */
  const make = (narrow) => {
    screen.narrow = narrow;
    for (const listener of [...screenListeners]) listener({ matches: narrow });
  };

  const wide = shown();
  make(true);
  const narrow = shown();
  header.element.querySelector('.head-more')?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  history.click();
  const menuOpen = header.element.querySelector('.head-tools.open') !== null;
  make(false);

  assert.deepEqual(
    { wide, narrow, menuOpen, wideAgain: shown() },
    {
      wide: { row: ['outline', 'history', 'changes', 'files', 'herdr', 'keep', 'vscode'], menu: ['activity'] },
      narrow: { row: ['outline', 'files', 'keep'], menu: ['history', 'changes', 'herdr', 'vscode', 'activity'] },
      menuOpen: false,
      wideAgain: { row: ['outline', 'history', 'changes', 'files', 'herdr', 'keep', 'vscode'], menu: ['activity'] },
    },
  );
});

test('sessionHeader_Should_ShowGptModelAndItsReportedContextWindow', (t) => {
  const header = headerOf('0d3f9a2c-1b7e-4c55-9e0a-6f2d8b41c7e3');
  t.after(header.dispose);

  header.onMeta({ model: 'gpt-6-sol', contextTokens: 420_000, contextWindow: 1_050_000, effort: 'high' });

  assert.match(header.element.querySelector('.fact-model')?.textContent ?? '', /gpt-6-sol/);
  assert.equal(header.element.querySelector('.fact-context')?.textContent, '420k/1.05M');
  assert.equal(header.element.querySelector('.fact-context')?.getAttribute('data-level'), 'calm');

  header.onMeta({ model: 'gpt-6-sol', contextTokens: 0, contextWindow: 1_050_000 });
  assert.equal(header.element.querySelector('.fact-context')?.getAttribute('title'), 'Context: 0 of 1.05M — 1.05M left');
});

// The session's id is in view at a glance — its first eight characters, as a commit's short hash — and in full in the
// details
test('sessionHeader_Should_ShowSessionId_ShortAmongFacts_InFullInDetails', (t) => {
  const header = headerOf('675eea90-5475-430f-ad4a-86e0de5c27cb');
  t.after(header.dispose);

  assert.equal(header.element.querySelector('.head-facts .fact-session')?.textContent, '675eea90');
  assert.match(header.element.querySelector('.head-details')?.textContent ?? '', /675eea90-5475-430f-ad4a-86e0de5c27cb/);
});

// The id is copied in full from the details — for `claude --resume`, or to name the session elsewhere
test('sessionHeader_Should_CopyWholeSessionId_FromDetails', async (t) => {
  /** @type {string[]} */
  const copied = [];
  Object.defineProperty(globalThis.navigator, 'clipboard', { value: { writeText: async (/** @type {string} */ text) => void copied.push(text) }, configurable: true });
  t.after(() => Reflect.deleteProperty(globalThis.navigator, 'clipboard'));
  const header = headerOf('675eea90-5475-430f-ad4a-86e0de5c27cb');
  t.after(header.dispose);

  const copy = header.element.querySelector('.head-details button[aria-label="Copy the session id"]');
  assert.ok(copy instanceof window.HTMLButtonElement);
  copy.click();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(copied, ['675eea90-5475-430f-ad4a-86e0de5c27cb']);
});
