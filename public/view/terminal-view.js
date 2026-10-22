// @ts-check
// A herdr pane's terminal on the page — a shell, nvim, another agent — mirroring the one in herdr: the screen comes
// from /api/pane/stream whenever it changes, the keys go to /api/pane/input as typed (server/terminal.js). The terminal
// has the pane's own size; on a narrow screen its font shrinks to fit the width — down to a size still readable, past
// which the terminal scrolls sideways.
import { Terminal } from '@xterm/xterm';
import { isRecord } from '../model/narrow.js';
import { redraw } from '../model/terminal.js';
import { h } from './dom.js';
import { createKeyBar } from './key-bar.js';

const largestFont = 14;
const smallestFont = 9;
/** A monospace character's width, of the font size. */
const charWidth = 0.6;

/**
 * @param {{ pane: string, size: import('../model/herdr.js').PaneSize | undefined }} options — size: unknown until the
 *   page has heard from herdr; the terminal takes it later through resize
 * @returns {{ element: HTMLElement, resize: (size: import('../model/herdr.js').PaneSize) => void, dispose: () => void }}
 */
export function mountTerminal({ pane, size }) {
  const host = h('div', { className: 'terminal-host' });
  const notice = h('div', { className: 'terminal-notice', attrs: { hidden: '' } });
  const view = h('div', { className: 'terminal-view' }, [host, notice]);
  const terminal = new Terminal({
    cols: size?.cols ?? 120,
    rows: size?.rows ?? 40,
    scrollback: 0,
    cursorBlink: false,
    fontFamily: getComputedStyle(document.documentElement).getPropertyValue('--font-mono'),
    fontSize: largestFont,
    // Terminal programs draw for a dark background, whatever the page's theme.
    theme: { background: '#1e1d1c', foreground: '#f5f4ef' },
  });
  terminal.open(host);
  terminal.focus();
  const fit = () => {
    const fitting = Math.floor(view.clientWidth / (terminal.cols * charWidth));
    terminal.options.fontSize = Math.max(smallestFont, Math.min(largestFont, fitting));
  };
  const watchWidth = new ResizeObserver(fit);
  watchWidth.observe(view);

  const source = new EventSource(`/api/pane/stream?${new URLSearchParams({ pane })}`);
  source.addEventListener('screen', (message) => {
    const reply = JSON.parse(message.data);
    if (isRecord(reply) && typeof reply.text === 'string') terminal.write(redraw(reply.text));
  });
  source.addEventListener('gone', (message) => {
    const reply = JSON.parse(message.data);
    source.close();
    notice.textContent = isRecord(reply) && reply.missing === true ? 'herdr is not running: the terminal cannot be shown.' : 'This pane is closed in herdr.';
    notice.hidden = false;
  });

  const keys = createKeySender(pane);
  const typing = terminal.onData(keys.send);
  // the terminal, scrolling as it needs, over the keys a phone's keyboard lacks — style.css shows them to a finger only
  const element = h('div', { className: 'terminal-pane' }, [view, createKeyBar(keys.send)]);
  return {
    element,
    resize(next) {
      if (next.cols === terminal.cols && next.rows === terminal.rows) return;
      terminal.resize(next.cols, next.rows);
      fit();
    },
    dispose() {
      source.close();
      typing.dispose();
      watchWidth.disconnect();
      terminal.dispose();
    },
  };
}

/**
 * Keys to the pane in the order typed: while one request is on its way, the keys typed meanwhile wait and go together.
 * @param {string} pane
 */
function createKeySender(pane) {
  let waiting = '';
  let sending = false;
  const flush = async () => {
    sending = true;
    while (waiting !== '') {
      const data = waiting;
      waiting = '';
      await fetch('/api/pane/input', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-viewer': '1' },
        body: JSON.stringify({ pane, data }),
      }).catch(() => undefined);
    }
    sending = false;
  };
  return {
    /** @param {string} data — what the terminal produced: text, Enter as \r, arrows as escape sequences */
    send(data) {
      waiting += data;
      if (!sending) void flush();
    },
  };
}
