// @ts-check
// ✓ and ✕ beside a note being written or edited, for ending it without a keyboard: ✓ keeps it, ✕ leaves it. Pressed,
// they take no focus from what is being written — its losing the focus would keep it first.
import { h } from './dom.js';
import { icon } from './icons.js';

/**
 * @param {{ keep: () => void, leave: () => void, keepTitle: string, leaveTitle: string }} actions — keepTitle, leaveTitle:
 *   what each says it does
 * @returns {[HTMLButtonElement, HTMLButtonElement]} — ✓, then ✕
 */
export function keepOrLeave({ keep, leave, keepTitle, leaveTitle }) {
  /** @param {string} className @param {string} iconName @param {string} title @param {() => void} does */
  const button = (className, iconName, title, does) => {
    const made = h('button', { className: `icon-button ${className}`, title, attrs: { type: 'button', 'aria-label': title } }, [icon(iconName)]);
    made.addEventListener('mousedown', (event) => event.preventDefault());
    made.addEventListener('click', does);
    return made;
  };
  return [button('note-keep-edit', 'check', keepTitle, keep), button('note-leave-edit', 'cross', leaveTitle, leave)];
}
