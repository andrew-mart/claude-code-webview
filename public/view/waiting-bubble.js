// @ts-check
// A prompt waiting in Claude Code's queue, under the feed: not in the conversation yet. An icon on its left sends the
// queue now, as Ctrl+Enter does in the terminal. And one sent from the page, not written down yet.
import { h } from './dom.js';
import { icon } from './icons.js';

/**
 * A prompt sent from the page that Claude Code has not written down yet: the terminal took it — under a heavy load it
 * may take a while to show as the prompt itself.
 * @param {string} text
 * @returns {HTMLElement}
 */
export function sentBubble(text) {
  return h('div', { className: 'msg user waiting sent' }, [
    h('div', { className: 'bubble' }, [h('div', { className: 'bubble-text', text: text === '' ? 'Images' : text }), h('div', { className: 'queued', text: 'Sent — the terminal took it; waiting for Claude Code to write it down' })]),
  ]);
}

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
