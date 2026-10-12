// @ts-check
// A prompt waiting in Claude Code's queue, under the feed: not in the conversation yet. An icon on its left sends the
// queue now, as Ctrl+Enter does in the terminal.
import { h } from './dom.js';
import { icon } from './icons.js';

/**
 * @param {string} waiting — its text; '' — a prompt of images only
 * @param {(() => void) | undefined} sendNow — sends what waits in the queue now; none where nothing can be sent
 * @returns {HTMLElement}
 */
export function waitingBubble(waiting, sendNow) {
  const bubble = h('div', { className: 'bubble' }, [
    h('div', { className: 'bubble-text', text: waiting === '' ? 'Images' : waiting }),
    h('div', { className: 'queued', text: 'Queued — Claude reads it after the current step' }),
  ]);
  if (sendNow === undefined) return h('div', { className: 'msg user waiting' }, [bubble]);
  const button = h('button', { className: 'icon-button waiting-send-now', title: 'Send now, past the queue (Ctrl+Enter)', attrs: { type: 'button', 'aria-label': 'Send now' } }, [icon('forward')]);
  button.addEventListener('click', sendNow);
  return h('div', { className: 'msg user waiting' }, [button, bubble]);
}
