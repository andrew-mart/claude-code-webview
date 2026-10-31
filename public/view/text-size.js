// @ts-check
// The size of the conversation's text — or the notes' — in the view menu: a step smaller, the size it is now, a step
// larger — the browser keeps it (the size and noteSize settings, model/view-settings.js).
import { textSizeStep } from '../model/view-settings.js';
import { h } from './dom.js';

/**
 * @param {{ label: string, size: () => string, choose: (size: string) => void }} setting — label: whose text; size: in
 *   percent of the usual size, as the browser keeps it; choose: another one
 * @returns {HTMLElement}
 */
export function createTextSizeControl({ label, size, choose }) {
  const smaller = h('button', { className: 'text-size-step', text: 'A−', title: 'Smaller text', attrs: { type: 'button', 'aria-label': 'Smaller text' } });
  const larger = h('button', { className: 'text-size-step', text: 'A+', title: 'Larger text', attrs: { type: 'button', 'aria-label': 'Larger text' } });
  const value = h('span', { className: 'text-size-value' });
  // the size as it is now, and a step past either end not there to press
  const show = () => {
    value.textContent = `${size()}%`;
    smaller.disabled = textSizeStep(size(), -1) === size();
    larger.disabled = textSizeStep(size(), 1) === size();
  };
  /** @param {-1 | 1} step */
  const go = (step) => () => {
    choose(textSizeStep(size(), step));
    show();
  };
  smaller.addEventListener('click', go(-1));
  larger.addEventListener('click', go(1));
  show();
  return h('div', { className: 'text-size', attrs: { role: 'group', 'aria-label': label } }, [h('span', { className: 'text-size-label', text: label }), smaller, value, larger]);
}
