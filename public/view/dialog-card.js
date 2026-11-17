// @ts-check
// What the agent asks in its terminal — Claude Code's AskUserQuestion dialog, a question of Codex's — above the box: the
// question, its choices as buttons, an answer of one's own, ← and → between several questions, Esc. A click is the key
// the terminal would get. A click on its head folds it to that line — who asks, and the question — leaving the
// conversation the room; it stays folded while something is asked, and the next thing asked shows unfolded.
import { h } from './dom.js';
import { icon } from './icons.js';

/** The choice Claude Code's dialog opens a line of words with. */
const ownWords = /^Type something/;

/**
 * @param {{ asker: string, answer: (steps: readonly import('../model/dialog.js').DialogStep[]) => Promise<import('../model/dialog.js').DialogReply> }} actions —
 *   asker: the agent that asks, by name; answer resolves once the terminal has the keys
 */
export function createDialogCard({ asker, answer }) {
  const element = h('section', { className: 'dialog-card', attrs: { hidden: '', 'aria-label': `${asker} asks`, 'aria-live': 'polite' } });
  let shown = '';
  /** Whether the card shows its head alone: kept while something is asked. */
  let folded = false;
  const status = h('div', { className: 'dialog-card-status', attrs: { role: 'status' } });

  /** @param {HTMLElement} fold — the head's button */
  const showFolded = (fold) => {
    element.classList.toggle('folded', folded);
    const title = folded ? 'Unfold the question' : 'Fold the question, for the conversation to have the room';
    fold.title = title;
    fold.setAttribute('aria-label', title);
    fold.setAttribute('aria-expanded', String(!folded));
    fold.replaceChildren(icon(folded ? 'unfold' : 'fold'));
  };

  /**
   * Who asks, the question's own line beside it — seen when the card is folded — and the button that folds it; a click
   * anywhere on it folds or unfolds the card.
   * @param {import('../model/dialog.js').Dialog} dialog
   */
  const head = (dialog) => {
    const fold = h('button', { className: 'icon-button dialog-card-fold', attrs: { type: 'button' } });
    const made = h('header', { className: 'dialog-card-head' }, [h('span', { className: 'dialog-card-asker', text: `${asker} asks` }), h('span', { className: 'dialog-card-question', text: dialog.lines.at(-1) ?? '' }), fold]);
    made.addEventListener('click', () => {
      folded = !folded;
      showFolded(fold);
    });
    showFolded(fold);
    return made;
  };

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
    // the terminal's cursor on it: lit again once one's own words no longer take Enter
    made.dataset.current = String(option.current);
    // an answer of several ticked with Space, as agy ticks them; in a picker one gone to, its levels shown under it — agy
    // shows a choice's default there, not the one in use — the one under the cursor picked; any other picked
    made.addEventListener('click', () => send(dialog.toggles !== undefined && option.checked !== undefined ? [...arrowsTo(dialog, option), { key: 'space' }] : dialog.picker !== undefined ? (option.current ? [{ key: 'enter' }] : arrowsTo(dialog, option)) : dialog.previews ? walkTo(dialog, option) : [{ key: digitOf(option.key) }]));
    return made;
  };

  /**
   * A picker's levels for the choice under the cursor — agy's /model, a model's effort — right under it: a click goes
   * to one with ← and → and picks the choice at it with Enter.
   * @param {import('../model/dialog.js').DialogPicker} picker
   */
  const levelRow = (picker) =>
    h('div', { className: 'dialog-levels' }, [
      h('span', { className: 'dialog-levels-name', text: 'Effort' }),
      ...picker.levels.map((level, at) => {
        const made = button(level, [...levelSteps(picker, at), { key: 'enter' }], 'dialog-level');
        made.classList.toggle('current', at === picker.chosen);
        return made;
      }),
      // what the level set does
      ...(picker.about === undefined ? [] : [h('span', { className: 'dialog-levels-about', text: picker.about })]),
    ]);

  /**
   * The levels a picker has for the choice under the cursor; none for no picker, or a choice with one level.
   * @param {import('../model/dialog.js').DialogPicker | undefined} picker
   * @returns {HTMLElement[]}
   */
  const levelsOf = (picker) => (picker === undefined || picker.levels.length === 0 ? [] : [levelRow(picker)]);

  /**
   * A line of one's own words: in a question with one answer the choice that opens it, the words, Enter, which answers;
   * in one with several the arrows to it, the words, which tick it, and ↑ off it — on it a digit is typed into the words.
   * @param {import('../model/dialog.js').DialogOption} option
   * @param {import('../model/dialog.js').Dialog} dialog
   */
  const ownAnswer = (option, dialog) => {
    const words = h('input', { className: 'dialog-own', attrs: { type: 'text', placeholder: 'An answer of your own', 'aria-label': 'An answer of your own' } });
    const go = h('button', { className: 'dialog-own-send', text: option.checked === undefined ? 'Answer' : 'Add', attrs: { type: 'button' } });
    const submit = () => {
      const text = words.value.replace(/\s+/g, ' ').trim();
      if (text === '') return;
      send(option.checked === undefined ? [{ key: digitOf(option.key) }, { text }, { key: 'enter' }] : [...arrowsTo(dialog, option), { text }, { key: 'up' }]);
    };
    go.addEventListener('click', submit);
    words.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      submit();
    });
    // what Enter presses is lit: with words typed here, this button — else the choice the terminal's cursor is on
    const lightWhatEnterPresses = () => {
      const typed = document.activeElement === words && words.value.trim() !== '';
      go.classList.toggle('current', typed);
      for (const one of element.querySelectorAll('.dialog-option')) one.classList.toggle('current', !typed && one.getAttribute('data-current') === 'true');
    };
    for (const happening of ['input', 'focus', 'blur']) words.addEventListener(happening, lightWhatEnterPresses);
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
      if (dialog === undefined) {
        folded = false;
        return element.replaceChildren();
      }
      element.replaceChildren(
        head(dialog),
        ...dialog.lines.map((line) => h('p', { className: 'dialog-line', text: line })),
        h(
          'div',
          { className: 'dialog-options' },
          dialog.options.flatMap((option) => [ownWords.test(option.label) ? ownAnswer(option, dialog) : choice(option, dialog), ...(option.current ? levelsOf(dialog.picker) : [])]),
        ),
        h('div', { className: 'dialog-nav' }, [
          ...(dialog.tabs ? [button('← Previous', [{ key: 'left' }], 'dialog-nav-button'), button('Next →', [{ key: 'right' }], 'dialog-nav-button')] : []),
          // the answers ticked sent, as Enter does there
          ...(dialog.toggles === undefined ? [] : [button(`${dialog.toggles.enter} (Enter)`, [{ key: 'enter' }], 'dialog-nav-button dialog-use')]),
          button(dialog.goesBack === true ? 'Back (Esc)' : 'Cancel (Esc)', [{ key: 'esc' }], 'dialog-nav-button dialog-cancel'),
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
  return [...arrowsTo(dialog, option), { key: dialog.sessionOnly === true ? 's' : 'enter' }];
}

/**
 * The arrows along a picker's levels from the one set to the one wanted.
 * @param {import('../model/dialog.js').DialogPicker} picker
 * @param {number} at — the level wanted
 * @returns {import('../model/dialog.js').DialogStep[]}
 */
function levelSteps(picker, at) {
  const moves = at - (picker.chosen ?? 0);
  /** @type {import('../model/dialog.js').DialogStep} */
  const step = { key: moves > 0 ? 'right' : 'left' };
  return Array.from({ length: Math.abs(moves) }, () => step);
}

/**
 * The arrows from the answer under the cursor to the one wanted: down or up a list, right or left along a row.
 * @param {import('../model/dialog.js').Dialog} dialog
 * @param {import('../model/dialog.js').DialogOption} option
 * @returns {import('../model/dialog.js').DialogStep[]}
 */
function arrowsTo(dialog, option) {
  const from = Math.max(0, dialog.options.findIndex((known) => known.current));
  const moves = dialog.options.indexOf(option) - from;
  const [ahead, back] = dialog.sideways === true ? /** @type {const} */ (['right', 'left']) : /** @type {const} */ (['down', 'up']);
  /** @type {import('../model/dialog.js').DialogStep} */
  const step = { key: moves > 0 ? ahead : back };
  return Array.from({ length: Math.abs(moves) }, () => step);
}
