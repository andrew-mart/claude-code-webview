// @ts-check
// The commands offered over the box while one is typed in it (model/command-suggest.js): ↑ and ↓ go through them,
// Enter or Tab puts the one marked in the box, a click or a tap puts any, Esc puts the list away. The commands are
// asked of the viewer each time the list opens: a skill written meanwhile is offered the next time a slash is typed.
import { commandQuery, rankCommands } from '../model/command-suggest.js';
import { h } from './dom.js';

/** How many the list holds at most: the rest are found by typing on. */
const shownAtMost = 50;

/**
 * @param {{ load: () => Promise<readonly import('../model/command-suggest.js').SlashCommand[]>, onPick: (name: string) => void }} parts —
 *   load: the session's commands, asked of the viewer; onPick: the command picked, to put in the box
 * @returns {{ element: HTMLElement, update: (text: string, caret: number) => void, hide: () => void, key: (event: KeyboardEvent) => boolean }} —
 *   update: the box's text and caret, the list shown for them or put away; key: a key while the list shows taken by it,
 *   whether it was
 */
export function createCommandMenu({ load, onPick }) {
  const element = h('ul', { className: 'command-menu', attrs: { role: 'listbox', 'aria-label': 'Commands', hidden: '' } });
  /** @type {readonly import('../model/command-suggest.js').SlashCommand[]} */
  let shown = [];
  let marked = 0;
  /** The latest update's number: a list loaded for an earlier text is not shown. */
  let asked = 0;
  /** The commands asked for since the list opened: typing on reuses them, the list put away lets them go. */
  /** @type {Promise<readonly import('../model/command-suggest.js').SlashCommand[]> | undefined} */
  let loaded;

  const hide = () => {
    asked++;
    loaded = undefined;
    shown = [];
    element.hidden = true;
    element.replaceChildren();
  };
  /** @param {number} index */
  const mark = (index) => {
    marked = (index + shown.length) % shown.length;
    element.querySelectorAll('.command-option').forEach((option, at) => {
      option.classList.toggle('marked', at === marked);
      option.setAttribute('aria-selected', String(at === marked));
      if (at === marked) option.scrollIntoView?.({ block: 'nearest' });
    });
  };
  /** @param {number} index */
  const pick = (index) => {
    const command = shown[index];
    hide();
    if (command !== undefined) onPick(command.name);
  };
  /** @param {readonly import('../model/command-suggest.js').SlashCommand[]} commands */
  const show = (commands) => {
    shown = commands;
    element.replaceChildren(
      ...commands.map((command, index) => {
        const option = h('li', { className: 'command-option', attrs: { role: 'option' } }, [
          h('span', { className: 'command-name', text: command.name }),
          ...(command.hint === '' ? [] : [h('span', { className: 'command-hint', text: command.hint })]),
          ...(command.source === 'built-in' ? [] : [h('span', { className: 'command-source', text: command.source })]),
          h('span', { className: 'command-about', text: command.about }),
        ]);
        // the box keeps the focus — and a phone its keyboard — while one is picked
        option.addEventListener('pointerdown', (event) => event.preventDefault());
        option.addEventListener('mousedown', (event) => event.preventDefault());
        option.addEventListener('click', () => pick(index));
        return option;
      }),
    );
    element.hidden = commands.length === 0;
    if (commands.length > 0) mark(0);
  };

  return {
    element,
    update(text, caret) {
      const query = commandQuery(text, caret);
      if (query === undefined) return hide();
      const number = ++asked;
      void (loaded ??= load()).then((commands) => {
        if (number === asked) show(rankCommands(commands, query).slice(0, shownAtMost));
      });
    },
    hide,
    key(event) {
      if (element.hidden || shown.length === 0) return false;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') mark(marked + (event.key === 'ArrowDown' ? 1 : -1));
      else if (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey && !event.isComposing)) pick(marked);
      else if (event.key === 'Escape') hide();
      else return false;
      event.preventDefault();
      return true;
    },
  };
}
