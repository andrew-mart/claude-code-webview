// @ts-check
// The prompts set aside for later, over the session's box, in the order they were written: each goes into the box to
// be edited, is sent as the box sends — into an empty box only, which it takes — or is let go.
import { h } from './dom.js';
import { icon } from './icons.js';

/** @typedef {import('../model/later.js').LaterPrompt} LaterPrompt */

/**
 * @param {{ intoBox: (prompt: LaterPrompt) => void, send: (prompt: LaterPrompt) => void, remove: (prompt: LaterPrompt) => void }} actions
 */
export function createLaterList({ intoBox, send, remove }) {
  const head = h('div', { className: 'later-head' });
  const items = h('ul', { className: 'later-items' });
  const element = h('section', { className: 'later', attrs: { hidden: '', 'aria-label': 'Set aside for later' } }, [head, items]);
  /** @type {readonly LaterPrompt[]} */
  let prompts = [];
  let sendable = false;

  /**
   * @param {string} name
   * @param {string} label
   * @param {string} title
   * @param {() => void} act
   */
  const button = (name, label, title, act) => {
    const made = h('button', { className: `icon-button later-${name}`, title, attrs: { type: 'button', 'aria-label': label } }, [icon(name === 'into' ? 'edit' : name === 'send' ? 'send' : 'cross')]);
    made.addEventListener('click', act);
    return made;
  };
  const render = () => {
    element.hidden = prompts.length === 0;
    head.textContent = `Later · ${prompts.length}`;
    items.replaceChildren(
      ...prompts.map((prompt) => {
        const sending = button('send', 'Send it', sendable ? 'Send it, as the box sends' : 'The box has text: send it or set it aside first', () => send(prompt));
        sending.disabled = !sendable;
        return h('li', { className: 'later-item' }, [
          h('span', { className: 'later-text', text: prompt.text, title: prompt.text }),
          button('into', 'Into the box', 'Into the box, to edit before sending', () => intoBox(prompt)),
          sending,
          button('remove', 'Remove it', 'Remove it', () => remove(prompt)),
        ]);
      }),
    );
  };
  return {
    element,
    /** @param {readonly LaterPrompt[]} next */
    show(next) {
      prompts = next;
      render();
    },
    /** @param {boolean} can — the box is empty and takes a prompt */
    allowSend(can) {
      if (can === sendable) return;
      sendable = can;
      render();
    },
  };
}
