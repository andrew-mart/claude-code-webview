import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTerminals } from '../server/terminal.js';

const pane = 'w2:p2';

/**
 * A fake pane: its screens one per read (after the last one the pane is gone), and the text typed into it; a send takes
 * typingMs.
 * @param {{ screens?: readonly string[], typingMs?: number }} [options]
 */
function fakePane({ screens = [], typingMs = 0 } = {}) {
  let reads = 0;
  /** @type {string[]} */
  const typed = [];
  /** @type {import('../server/terminal.js').PaneIo} */
  const io = {
    read: async () => {
      const screen = screens[reads++];
      return screen === undefined ? { ok: false, missing: false } : { ok: true, text: screen };
    },
    type: async (_, text) => {
      await new Promise((resolve) => setTimeout(resolve, typingMs));
      typed.push(text);
      return { ok: true };
    },
  };
  return { io, typed };
}

/** @param {ReturnType<typeof fakePane>} fake */
const terminalsOf = (fake) => createTerminals({ io: fake.io, quickMs: 1, slowMs: 1, quickForMs: 1000 });

// The page redraws the terminal only when its screen changed, and learns when the pane is gone
test('stream_Should_SendScreenWhenItChanges_And_TellWhenPaneIsGone', async () => {
  const fake = fakePane({ screens: ['$ ls', '$ ls', '$ ls\r\na.txt', '$ ls\r\na.txt'] });
  /** @type {[string, unknown][]} */
  const sent = [];

  await terminalsOf(fake).stream(pane, (event, data) => sent.push([event, data]), new AbortController().signal);

  assert.deepEqual(sent, [
    ['screen', { text: '$ ls' }],
    ['screen', { text: '$ ls\r\na.txt' }],
    ['gone', { missing: false }],
  ]);
});

// Keys go in the order typed; while one send is on its way, the next keys wait and go together
test('type_Should_TypeKeysInOrder_TheOnesTypedMeanwhileTogether', async () => {
  const fake = fakePane({ typingMs: 30 });
  const terminals = terminalsOf(fake);

  const outcomes = await Promise.all([terminals.type(pane, 'l'), terminals.type(pane, 's'), terminals.type(pane, '\r')]);

  assert.deepEqual(fake.typed, ['l', 's\r']);
  assert.deepEqual(outcomes, [{ ok: true }, { ok: true }, { ok: true }]);
});

// Ctrl+Space gives a lone NUL, which cannot go in a program's arguments: it is dropped, and typing goes on
test('type_Should_GoOnTyping_AfterKeysThatAreOnlyNul', async () => {
  const fake = fakePane();
  const terminals = terminalsOf(fake);

  await terminals.type(pane, String.fromCharCode(0));
  await terminals.type(pane, 'a');

  assert.deepEqual(fake.typed, ['a']);
});

// While nothing happens the screen is read seldom; a key typed then must not wait for the next read — it wakes it
test('stream_Should_ReadScreenAtOnce_AfterKeysAreTyped', async () => {
  let screen = '$ ';
  /** @type {import('../server/terminal.js').PaneIo} */
  const io = {
    read: async () => ({ ok: true, text: screen }),
    type: async (_, text) => {
      screen += text;
      return { ok: true };
    },
  };
  const terminals = createTerminals({ io, quickMs: 10_000, slowMs: 10_000, quickForMs: 0 });
  const stop = new AbortController();
  /** @type {string[]} */
  const shown = [];
  /** @type {(value: unknown) => void} */
  let showsTyped = () => {};
  const typedShown = new Promise((resolve) => {
    showsTyped = resolve;
  });
  const streaming = terminals.stream(pane, (_, data) => {
    const text = typeof data === 'object' && data !== null && 'text' in data && typeof data.text === 'string' ? data.text : '';
    shown.push(text);
    if (text === '$ ls') showsTyped(undefined);
  }, stop.signal);
  await new Promise((resolve) => setTimeout(resolve, 20));

  await terminals.type(pane, 'ls');
  const inTime = await Promise.race([typedShown.then(() => true), new Promise((resolve) => setTimeout(() => resolve(false), 500))]);
  stop.abort();
  await streaming;

  assert.deepEqual({ inTime, shown }, { inTime: true, shown: ['$ ', '$ ls'] });
});
