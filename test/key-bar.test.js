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
  const bar = createKeyBar({ send: (data) => void sent.push(data), paste: () => undefined, readClipboard: async () => '' });
  /** @param {string} name */
  const press = (name) => {
    const key = bar.querySelector(`button[aria-label="${name}"]`);
    assert.ok(key instanceof window.HTMLButtonElement, `no key ${name}`);
    key.click();
  };

  for (const name of ['Down', 'Enter', 'Up', 'Left', 'Right', 'Tab', 'Esc', 'Ctrl+C']) press(name);

  assert.deepEqual(sent, ['\u001b[B', '\r', '\u001b[A', '\u001b[D', '\u001b[C', '\t', '\u001b', '\u0003']);
});

// A long press on a phone's terminal may bring up no menu to paste from: the clipboard's key pastes what the clipboard
// holds, as a paste in the terminal goes; a clipboard the browser keeps closed pastes nothing
test('keyBar_Should_PasteWhatClipboardHolds', async () => {
  /** @type {string[]} */
  const pasted = [];
  /** @param {() => Promise<string>} readClipboard */
  const pressPaste = async (readClipboard) => {
    const bar = createKeyBar({ send: () => undefined, paste: (text) => void pasted.push(text), readClipboard });
    const key = bar.querySelector('button[aria-label="Paste"]');
    assert.ok(key instanceof window.HTMLButtonElement, 'no key Paste');
    key.click();
    await new Promise((done) => setTimeout(done, 0));
  };

  await pressPaste(async () => 'npm test -- --watch\n');
  await pressPaste(async () => {
    throw new window.DOMException('Read permission denied.', 'NotAllowedError');
  });

  assert.deepEqual(pasted, ['npm test -- --watch\n']);
});
