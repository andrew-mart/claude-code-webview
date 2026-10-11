import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTerminals } from '../server/terminal.js';

const pane = 'w2:p2';

/**
 * A fake herdr: the pane's screens one per read (after the last one the pane is gone), and the text typed into it.
 * missing — herdr is not installed. A send-text takes typingMs.
 * @param {{ screens?: readonly string[], missing?: boolean, typingMs?: number }} [options]
 */
function fakeHerdr({ screens = [], missing = false, typingMs = 0 } = {}) {
  let reads = 0;
  /** @type {string[]} */
  const typed = [];
  /** @param {readonly string[]} args @returns {Promise<import('../server/composer.js').HerdrReply>} */
  const run = async (args) => {
    if (missing) return { ok: false, error: 'spawn herdr ENOENT', missing: true };
    const [subject, command, target, text] = args;
    if (subject !== 'pane' || target !== pane) return { ok: false, error: `no pane ${String(target)}`, missing: false };
    if (command === 'read') {
      const screen = screens[reads++];
      return screen === undefined ? { ok: false, error: 'pane not found', missing: false } : { ok: true, json: undefined, text: screen };
    }
    if (command === 'send-text') {
      await new Promise((resolve) => setTimeout(resolve, typingMs));
      typed.push(String(text));
      return { ok: true, json: undefined, text: '' };
    }
    return { ok: false, error: `the fake herdr does not know ${args.join(' ')}`, missing: false };
  };
  return { run, typed };
}

/** @param {ReturnType<typeof fakeHerdr>} herdr */
const terminalsOf = (herdr) => createTerminals({ herdr: herdr.run, quickMs: 1, slowMs: 1, quickForMs: 1000 });

// The page redraws the terminal only when its screen changed, and learns when the pane is gone
test('stream_Should_SendScreenWhenItChanges_And_TellWhenPaneIsGone', async () => {
  const herdr = fakeHerdr({ screens: ['$ ls', '$ ls', '$ ls\r\na.txt', '$ ls\r\na.txt'] });
  /** @type {[string, unknown][]} */
  const sent = [];

  await terminalsOf(herdr).stream(pane, (event, data) => sent.push([event, data]), new AbortController().signal);

  assert.deepEqual(sent, [
    ['screen', { text: '$ ls' }],
    ['screen', { text: '$ ls\r\na.txt' }],
    ['gone', { missing: false }],
  ]);
});

// Keys go in the order typed; while one send is on its way, the next keys wait and go together
test('type_Should_TypeKeysInOrder_TheOnesTypedMeanwhileTogether', async () => {
  const herdr = fakeHerdr({ typingMs: 30 });
  const terminals = terminalsOf(herdr);

  const outcomes = await Promise.all([terminals.type(pane, 'l'), terminals.type(pane, 's'), terminals.type(pane, '\r')]);

  assert.deepEqual(herdr.typed, ['l', 's\r']);
  assert.deepEqual(outcomes, [{ ok: true }, { ok: true }, { ok: true }]);
});

test('type_Should_TellWhenHerdrIsMissing', async () => {
  assert.deepEqual(await terminalsOf(fakeHerdr({ missing: true })).type(pane, 'x'), { ok: false, error: 'herdr-missing' });
});

// Ctrl+Space gives a lone NUL, which cannot go in a program's arguments: it is dropped, and typing goes on
test('type_Should_GoOnTyping_AfterKeysThatAreOnlyNul', async () => {
  const herdr = fakeHerdr();
  const terminals = terminalsOf(herdr);

  await terminals.type(pane, String.fromCharCode(0));
  await terminals.type(pane, 'a');

  assert.deepEqual(herdr.typed, ['a']);
});
