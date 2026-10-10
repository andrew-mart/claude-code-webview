// @ts-check
// The rewind dialog: the same choices as Esc Esc in the terminal, for one of the user's messages.
import { parseRewindReply, rewindMessage } from '../model/rewind.js';
import { h } from './dom.js';

/**
 * @typedef {import('../model/bookmarks.js').Bookmark} Anchor
 * @typedef {import('../model/rewind.js').RewindReply} RewindReply
 */

/** The actions in the order the terminal lists them. */
const actions = /** @type {const} */ ([
  ['both', 'Restore code and conversation', 'Undo the file edits made since, and the conversation'],
  ['conversation', 'Restore conversation', 'Go back to before this message, keep the code as it is'],
  ['code', 'Restore code', 'Undo the file edits made since, keep the conversation'],
  ['summarize-from', 'Summarize from here', 'Compress this message and everything after it into a summary'],
  ['summarize-up-to', 'Summarize up to here', 'Compress everything before this message into a summary'],
]);

/**
 * @param {{ onDone: (reply: RewindReply & { ok: true }) => void }} hooks — after a rewind went through
 */
export function createRewindDialog({ onDone }) {
  const quote = h('blockquote', { className: 'rewind-quote' });
  const status = h('div', { className: 'rewind-status', attrs: { role: 'status' } });
  // The dialog opens with the harmless choice focused: a stray Enter must not restore anything.
  const cancel = h('button', { className: 'rewind-cancel', text: 'Never mind', attrs: { type: 'button', autofocus: '' } });
  const choices = actions.map(([action, label, detail]) => {
    const button = h('button', { className: 'rewind-choice', attrs: { type: 'button' } }, [h('span', { className: 'rewind-label', text: label }), h('span', { className: 'rewind-detail', text: detail })]);
    button.dataset.action = action;
    return button;
  });
  const dialog = h('dialog', { className: 'rewind-dialog', attrs: { 'aria-label': 'Rewind' } }, [
    h('h2', { text: 'Rewind to before this message' }),
    quote,
    h('div', { className: 'rewind-choices' }, choices),
    status,
    h('div', { className: 'rewind-foot' }, [h('span', { className: 'rewind-note', text: 'Edits made by shell commands are not restored.' }), cancel]),
  ]);
  document.body.append(dialog);
  /** @type {{ sessionId: string, prompt: Anchor } | undefined} */
  let target;
  let busy = false;

  const setBusy = (/** @type {boolean} */ next) => {
    busy = next;
    for (const button of [...choices, cancel]) button.disabled = next;
  };
  cancel.addEventListener('click', () => dialog.close());
  for (const button of choices) {
    button.addEventListener('click', () => {
      const action = button.dataset.action;
      if (target === undefined || action === undefined || busy) return;
      setBusy(true);
      status.textContent = 'Rewinding in the terminal…';
      status.dataset.tone = 'ok';
      void post(target.sessionId, target.prompt.id, action).then((reply) => {
        setBusy(false);
        if (reply?.ok === true) {
          dialog.close();
          onDone(reply);
          return;
        }
        status.textContent = reply === undefined ? 'The viewer server did not answer.' : rewindMessage(reply);
        status.dataset.tone = 'error';
      });
    });
  }

  return {
    /**
     * @param {string} sessionId
     * @param {Anchor} prompt
     */
    open(sessionId, prompt) {
      target = { sessionId, prompt };
      quote.textContent = prompt.label;
      status.textContent = '';
      setBusy(false);
      dialog.showModal();
    },
  };
}

/**
 * @param {string} sessionId
 * @param {string} prompt — the message's id (its transcript uuid)
 * @param {string} action
 * @returns {Promise<RewindReply | undefined>}
 */
async function post(sessionId, prompt, action) {
  const response = await fetch('/api/rewind', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Viewer': '1' },
    body: JSON.stringify({ session: sessionId, prompt, action }),
  }).catch(() => undefined);
  return response === undefined ? undefined : parseRewindReply(await response.json().catch(() => undefined));
}
