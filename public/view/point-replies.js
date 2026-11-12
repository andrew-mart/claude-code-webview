// @ts-check
// A 👉 that starts a line of an answer marks what the reader is to answer — a question, a decision, a step to take. It is
// made a button: pressed, what it points at goes into the prompt box, for the reader's answer to be written under it
// (app.js). What it points at is the rest of its line, and the lines after it up to the next 👉 starting one, or to its
// paragraph's or list item's end. A 👉 in the middle of a sentence points at nothing to answer.
import { h } from './dom.js';
import { markdownOf } from './markdown-copy.js';

/** The pointing hand, with a skin tone or the emoji form after it, if any. */
const hand = /^👉[\u{1F3FB}-\u{1F3FF}]?\uFE0F?/u;

/** The blocks whose lines a 👉 may start: paragraphs and list items. */
const lineBlocks = 'p, li';

/**
 * The 👉 starting a line in an answer's paragraphs and list items made buttons; code is left as it is.
 * @param {Element} root — an answer as the feed shows it
 */
export function markPoints(root) {
  for (const block of root.querySelectorAll(lineBlocks)) {
    if (block.closest('pre, code') !== null) continue;
    let lineStart = true;
    for (const node of [...block.childNodes]) {
      if (node instanceof Element) {
        if (node.matches('br')) lineStart = true;
        else if ((node.textContent ?? '').trim() !== '') lineStart = false;
        continue;
      }
      if (!(node instanceof Text)) continue;
      const text = node.data;
      const lead = text.length - text.trimStart().length;
      const found = lineStart ? hand.exec(text.slice(lead)) : null;
      if (text.trim() !== '') lineStart = false;
      if (found === null) continue;
      const rest = node.splitText(lead);
      rest.data = rest.data.slice(found[0].length);
      rest.before(pointButton(found[0]));
    }
  }
}

/**
 * What a 👉 points at, as markdown — the way the answer was written — led by the 👉 itself: the rest of its line and the
 * lines after it, up to the next 👉 starting a line, a list inside its item, or its block's end.
 * @param {Element} point — a 👉 made a button
 * @returns {string}
 */
export function pointText(point) {
  const block = point.parentElement;
  if (block === null) return point.textContent ?? '';
  const range = document.createRange();
  range.setStartAfter(point);
  range.setEnd(block, block.childNodes.length);
  const after = [...block.childNodes].slice([...block.childNodes].indexOf(point) + 1);
  const end = after.find((node) => node instanceof Element && (node.matches('button.point-reply') || node.matches('ul, ol')));
  if (end !== undefined) range.setEndBefore(end);
  return `${point.textContent ?? ''} ${markdownOf(range.cloneContents())}`.trim();
}

/**
 * @param {string} shown — the 👉 as the answer has it
 * @returns {HTMLButtonElement}
 */
function pointButton(shown) {
  const label = 'Answer this in the prompt box: it goes there, your answer under it';
  return h('button', { className: 'point-reply', text: shown, title: label, attrs: { type: 'button', 'aria-label': label } });
}
