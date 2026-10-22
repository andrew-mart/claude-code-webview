import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const { window } = new JSDOM('<!doctype html><html><body></body></html>');
Object.assign(globalThis, { window, document: window.document });
const { createKeyBar } = await import('../public/view/key-bar.js');

// A phone's keyboard has no arrows nor Esc: the keys under the terminal give them, as the terminal's own keys go —
// Claude Code asking whether to trust a folder is answered with ↓ and Enter, a shell's command stopped with Ctrl+C
test('keyBar_Should_SendKeysPhoneKeyboardLacks_AsTerminalSendsThem', () => {
  /** @type {string[]} */
  const sent = [];
  const bar = createKeyBar((data) => sent.push(data));
  /** @param {string} name */
  const press = (name) => {
    const key = bar.querySelector(`button[aria-label="${name}"]`);
    assert.ok(key instanceof window.HTMLButtonElement, `no key ${name}`);
    key.click();
  };

  for (const name of ['Down', 'Enter', 'Up', 'Left', 'Right', 'Tab', 'Esc', 'Ctrl+C']) press(name);

  assert.deepEqual(sent, ['\u001b[B', '\r', '\u001b[A', '\u001b[D', '\u001b[C', '\t', '\u001b', '\u0003']);
});
