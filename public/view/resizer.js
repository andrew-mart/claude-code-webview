// @ts-check
// A drag handle on the inner edge of a side panel: drag to resize, double-click for the default width, ←/→ step by
// 16 px. The width is a CSS custom property on the layout and is remembered by the browser.
import { draggedWidth } from '../model/resize.js';
import { h } from './dom.js';

const keyStep = 16;

/**
 * @typedef {{ property: string, storageKey: string }} PanelWidth — the CSS property that holds the width, and where it is remembered
 */

/**
 * @param {{ layout: HTMLElement, width: PanelWidth, side: 'left' | 'right', min: number, max: () => number, measure: () => number, label: string, className: string }} options
 *   side — where the panel is; measure — the panel's width now
 * @returns {HTMLElement}
 */
export function createResizer({ layout, width, side, min, max, measure, label, className }) {
  const handle = h('div', {
    className: `resizer ${className}`,
    title: `${label}: drag to resize, double-click for the default width`,
    attrs: { role: 'separator', 'aria-orientation': 'vertical', 'aria-label': label, tabindex: '0' },
  });
  const apply = (/** @type {number} */ px) => layout.style.setProperty(width.property, `${px}px`);

  handle.addEventListener('pointerdown', (down) => {
    down.preventDefault();
    handle.setPointerCapture(down.pointerId);
    layout.classList.add('resizing');
    const startWidth = measure();
    const move = (/** @type {PointerEvent} */ event) => apply(draggedWidth({ side, startWidth, moved: event.clientX - down.clientX, min, max: max() }));
    const end = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', end);
      handle.removeEventListener('pointercancel', end);
      layout.classList.remove('resizing');
      remember(width.storageKey, String(Math.round(measure())));
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  });
  handle.addEventListener('dblclick', () => {
    layout.style.removeProperty(width.property);
    remember(width.storageKey, '');
  });
  handle.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const next = draggedWidth({ side, startWidth: measure(), moved: event.key === 'ArrowRight' ? keyStep : -keyStep, min, max: max() });
    apply(next);
    remember(width.storageKey, String(next));
  });
  return handle;
}

/**
 * The width the user left the panel at, set before the panel is shown.
 * @param {HTMLElement} layout
 * @param {PanelWidth} width
 */
export function restoreWidth(layout, width) {
  const stored = Number(recall(width.storageKey));
  if (stored > 0) layout.style.setProperty(width.property, `${stored}px`);
}

/** @param {string} key */
function recall(key) {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return ''; // storage is unavailable — the default width
  }
}

/**
 * @param {string} key
 * @param {string} value — empty: forget, back to the default width
 */
function remember(key, value) {
  try {
    if (value === '') localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // storage is unavailable — the width lasts until the page reloads
  }
}
