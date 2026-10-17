// @ts-check
// What the agent asks in its terminal — Claude Code's AskUserQuestion dialog, a question of Codex's — above the box: the
// question, its choices as buttons, an answer of one's own, ← and → between several questions, Esc. A click is the key
// the terminal would get.
import { h } from './dom.js';

/** The choice Claude Code's dialog opens a line of words with. */
const ownWords = /^Type something/;

/**
 * @param {{ asker: string, answer: (steps: readonly import('../model/dialog.js').DialogStep[]) => Promise<import('../model/dialog.js').DialogReply> }} actions —
 *   asker: the agent that asks, by name; answer resolves once the terminal has the keys
 */
export function createDialogCard({ asker, answer }) {
  const element = h('section', { className: 'dialog-card', attrs: { hidden: '', 'aria-label': `${asker} asks`, 'aria-live': 'polite' } });
  let shown = '';
  const status = h('div', { className: 'dialog-card-status', attrs: { role: 'status' } });

  /** @param {readonly import('../model/dialog.js').DialogStep[]} steps */
  const send = (steps) => {
    for (const button of element.querySelectorAll('button')) button.disabled = true;
    status.textContent = '';
    void answer(steps).then((reply) => {
      for (const button of element.querySelectorAll('button')) button.disabled = false;
      if (!reply.ok) status.textContent = reply.error === 'no-dialog' ? 'The question is no longer in the terminal.' : 'The answer did not reach the terminal.';
    });
  };

  /**
   * @param {string} text
   * @param {readonly import('../model/dialog.js').DialogStep[]} steps
   * @param {string} className
   */
  const button = (text, steps, className) => {
    const made = h('button', { className, text, attrs: { type: 'button' } });
    made.addEventListener('click', () => send(steps));
    return made;
  };

  /**
   * @param {import('../model/dialog.js').DialogOption} option
   * @param {import('../model/dialog.js').Dialog} dialog
   */
  const choice = (option, dialog) => {
    const mark = option.checked === undefined ? '' : option.checked ? '☑ ' : '☐ ';
    const made = h('button', { className: 'dialog-option', attrs: { type: 'button', 'aria-pressed': String(option.checked === true) } }, [
      h('span', { className: 'dialog-option-key', text: option.key }),
      h('span', { className: 'dialog-option-text' }, [h('span', { className: 'dialog-option-label', text: `${mark}${option.label}` }), ...(option.detail === undefined ? [] : [h('span', { className: 'dialog-option-detail', text: option.detail })])]),
    ]);
    made.classList.toggle('current', option.current);
    made.addEventListener('click', () => send(dialog.previews ? walkTo(dialog, option) : [{ key: digitOf(option.key) }]));
    return made;
  };

  /**
   * A line of one's own words: the choice that opens it, the words, Enter — only in a question with one answer, where
   * Enter answers.
   * @param {import('../model/dialog.js').DialogOption} option
   */
  const ownAnswer = (option) => {
    const words = h('input', { className: 'dialog-own', attrs: { type: 'text', placeholder: 'An answer of your own', 'aria-label': 'An answer of your own' } });
    const go = h('button', { className: 'dialog-own-send', text: 'Answer', attrs: { type: 'button' } });
    const submit = () => {
      const text = words.value.replace(/\s+/g, ' ').trim();
      if (text !== '') send([{ key: digitOf(option.key) }, { text }, { key: 'enter' }]);
    };
    go.addEventListener('click', submit);
    words.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      submit();
    });
    return h('div', { className: 'dialog-own-row' }, [words, go]);
  };

  return {
    element,
    /** @param {import('../model/dialog.js').Dialog | undefined} dialog — none: nothing is asked */
    show(dialog) {
      const look = JSON.stringify(dialog ?? null);
      if (look === shown) return;
      shown = look;
      element.hidden = dialog === undefined;
      if (dialog === undefined) return element.replaceChildren();
      const own = dialog.options.find((option) => ownWords.test(option.label) && option.checked === undefined);
      const choices = dialog.options.filter((option) => option !== own);
      element.replaceChildren(
        h('header', { className: 'dialog-card-head', text: `${asker} asks` }),
        ...dialog.lines.map((line) => h('p', { className: 'dialog-line', text: line })),
        h('div', { className: 'dialog-options' }, choices.map((option) => choice(option, dialog))),
        ...(own === undefined ? [] : [ownAnswer(own)]),
        h('div', { className: 'dialog-nav' }, [
          ...(dialog.tabs ? [button('← Previous', [{ key: 'left' }], 'dialog-nav-button'), button('Next →', [{ key: 'right' }], 'dialog-nav-button')] : []),
          button('Cancel (Esc)', [{ key: 'esc' }], 'dialog-nav-button dialog-cancel'),
        ]),
        status,
      );
    },
  };
}

/**
 * @param {string} key — an option's, as read off the screen
 * @returns {import('../model/dialog.js').DialogKey}
 */
function digitOf(key) {
  switch (key) {
    case '1':
    case '2':
    case '3':
    case '4':
    case '5':
    case '6':
    case '7':
    case '8':
    case '9':
      return key;
    default:
      return 'esc';
  }
}

/**
 * Beside previews a digit picks nothing: the arrows go from the answer under the cursor to the one wanted, Enter picks it.
 * @param {import('../model/dialog.js').Dialog} dialog
 * @param {import('../model/dialog.js').DialogOption} option
 * @returns {import('../model/dialog.js').DialogStep[]}
 */
function walkTo(dialog, option) {
  const from = Math.max(0, dialog.options.findIndex((known) => known.current));
  const moves = dialog.options.indexOf(option) - from;
  /** @type {import('../model/dialog.js').DialogStep} */
  const step = { key: moves > 0 ? 'down' : 'up' };
  return [...Array.from({ length: Math.abs(moves) }, () => step), { key: dialog.sessionOnly === true ? 's' : 'enter' }];
}
