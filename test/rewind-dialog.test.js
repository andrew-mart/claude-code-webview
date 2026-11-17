import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const { window } = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
Object.assign(globalThis, { window, document: window.document, HTMLElement: window.HTMLElement });
// jsdom draws no modal dialogs: opened is enough here
window.HTMLDialogElement.prototype.showModal ??= function showModal() {
  this.open = true;
};
const { createRewindDialog } = await import('../public/view/rewind-dialog.js');

const prompt = { kind: /** @type {const} */ ('prompt'), id: 'codex-1', label: 'Redraw the old map', at: 'codex-1' };

// Codex rewinds the conversation alone — its files stay as they are: for its session the dialog offers that alone; for
// Claude Code's, all its choices
test('rewindDialog_Should_OfferCodexItsConversationAlone', () => {
  const dialog = createRewindDialog({ onDone: () => undefined });
  const offered = () => [...window.document.querySelectorAll('.rewind-choice')].filter((button) => button instanceof window.HTMLElement && !button.hidden).map((button) => button.getAttribute('data-action'));

  dialog.open('s1', prompt, 'codex');
  const codex = { offered: offered(), note: window.document.querySelector('.rewind-note')?.textContent };
  dialog.open('s2', prompt, 'claude');

  assert.deepEqual(
    { codex, claude: offered() },
    { codex: { offered: ['conversation'], note: 'Codex rewinds the conversation alone: files stay as they are.' }, claude: ['both', 'conversation', 'code', 'summarize-from', 'summarize-up-to'] },
  );
});

// agy rewinds its conversation and the files changed since together, with one choice: the dialog offers that alone, and
// says so
test('rewindDialog_Should_OfferAgyItsConversationWithItsFiles', () => {
  const dialog = createRewindDialog({ onDone: () => undefined });
  // the latest dialog made: an earlier test's stays in the document
  const own = [...window.document.querySelectorAll('.rewind-dialog')].at(-1);
  const offered = () => [...(own?.querySelectorAll('.rewind-choice') ?? [])].filter((button) => button instanceof window.HTMLElement && !button.hidden).map((button) => button.getAttribute('data-action'));

  dialog.open('s3', prompt, 'agy');

  assert.deepEqual(
    { offered: offered(), note: own?.querySelector('.rewind-note')?.textContent },
    { offered: ['both'], note: 'agy rewinds the conversation and undoes the file edits made since, together.' },
  );
});
