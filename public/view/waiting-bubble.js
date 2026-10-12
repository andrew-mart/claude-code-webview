// @ts-check
// A prompt waiting in Claude Code's queue, under the feed: not in the conversation yet. A small button on it sends the
// queue now, as Ctrl+Enter does in the terminal.
import { h } from './dom.js';
import { icon } from './icons.js';

/**
 * @param {string} waiting — its text; '' — a prompt of images only
 * @param {(() => void) | undefined} sendNow — sends what waits in the queue now; none where nothing can be sent
 * @returns {HTMLElement}
 */
export function waitingBubble(waiting, sendNow) {
  const note = h('div', { className: 'queued' }, [h('span', { text: 'Queued — Claude reads it after the current step' })]);
  if (sendNow !== undefined) {
    const button = h('button', { className: 'waiting-send-now', title: 'Send now, past the queue (Ctrl+Enter)', attrs: { type: 'button' } }, [icon('forward'), h('span', { text: 'Send now' })]);
    button.addEventListener('click', sendNow);
    note.append(button);
  }
  return h('div', { className: 'msg user waiting' }, [h('div', { className: 'bubble' }, [h('div', { className: 'bubble-text', text: waiting === '' ? 'Images' : waiting }), note])]);
}
