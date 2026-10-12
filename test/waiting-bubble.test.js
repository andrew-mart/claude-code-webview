import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const { window } = new JSDOM('<!doctype html><html><body></body></html>');
// The icons are drawn when their module loads: the DOM is set up before it.
Object.assign(globalThis, { window, document: window.document });
const { waitingBubble } = await import('../public/view/waiting-bubble.js');

// A prompt waiting in Claude Code's queue says so, and has an icon on its left — no words — that sends the queue now,
// Claude Code's Ctrl+Enter; where nothing can be sent (a subagent's feed) it has none
test('waitingBubble_Should_OfferToSendQueueNow_WhereItCanBeSent', () => {
  let sent = 0;
  const sendable = waitingBubble('Also check the logs', () => sent++);
  const readOnly = waitingBubble('', undefined);
  const button = sendable.querySelector('.waiting-send-now');
  assert.ok(button instanceof window.HTMLButtonElement);

  button.click();

  assert.deepEqual(
    {
      text: sendable.querySelector('.bubble-text')?.textContent,
      images: readOnly.querySelector('.bubble-text')?.textContent,
      sent,
      button: { words: button.textContent, label: button.getAttribute('aria-label'), title: button.title, beside: button.nextElementSibling?.className },
      readOnlyButton: readOnly.querySelector('.waiting-send-now'),
    },
    {
      text: 'Also check the logs',
      images: 'Images',
      sent: 1,
      button: { words: '', label: 'Send now', title: 'Send now, past the queue (Ctrl+Enter)', beside: 'bubble' },
      readOnlyButton: null,
    },
  );
});
