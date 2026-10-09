// @ts-check
// File paths in rendered text → links that open the file in the right-hand panel.
import { fileRefFromHref, findFileRefs } from '../model/file-ref.js';
import { h } from './dom.js';

/**
 * @typedef {{ path: string, line: number | undefined, endLine: number | undefined }} FileTarget
 */

/**
 * Paths in text, headings and inline code become links; code blocks and existing links are left alone,
 * except file:/// links, which also open in the panel.
 * @param {DocumentFragment | HTMLElement} root
 */
export function linkFileRefs(root) {
  for (const link of root.querySelectorAll('a[href^="file:"]')) {
    const target = fileRefFromHref(link.getAttribute('href') ?? '');
    if (target !== undefined) markFileLink(link, target);
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  /** @type {Text[]} */
  const texts = [];
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if (node instanceof Text && node.parentElement?.closest('pre, a') === null) texts.push(node);
  }
  for (const node of texts) linkText(node);
}

/**
 * @param {FileTarget} target
 * @param {string} label
 * @returns {HTMLAnchorElement}
 */
export function fileLink(target, label) {
  const link = h('a', { text: label });
  markFileLink(link, target);
  return link;
}

/**
 * @param {Text} node
 */
function linkText(node) {
  const source = node.data;
  const refs = findFileRefs(source);
  if (refs.length === 0) return;
  /** @type {(Node | string)[]} */
  const parts = [];
  let position = 0;
  for (const ref of refs) {
    parts.push(source.slice(position, ref.index), fileLink(ref, ref.text));
    position = ref.index + ref.text.length;
  }
  parts.push(source.slice(position));
  node.replaceWith(...parts.filter((part) => part !== ''));
}

/**
 * The page (app.js) intercepts the click; href is there so the path shows on hover.
 * @param {Element} link
 * @param {FileTarget} target
 */
function markFileLink(link, target) {
  link.classList.add('file-link');
  link.setAttribute('href', `file:///${encodeURI(target.path.replaceAll('\\', '/'))}`);
  link.setAttribute('data-path', target.path);
  if (target.line !== undefined) link.setAttribute('data-line', String(target.line));
  if (target.endLine !== undefined) link.setAttribute('data-end-line', String(target.endLine));
  link.removeAttribute('target');
  link.removeAttribute('rel');
}
