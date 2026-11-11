// @ts-check
// File paths in rendered text → links that open the file in the right-hand panel.
import { fileRefFromHref, findFileRefs, wholeFileRef } from '../model/file-ref.js';
import { isRecord } from '../model/narrow.js';
import { h } from './dom.js';

/**
 * @typedef {{ path: string, line: number | undefined, endLine: number | undefined }} FileTarget
 * @typedef {{ link: HTMLAnchorElement, longer: import('../model/file-ref.js').LongerRef }} Offered — a link to a path
 *   cut at a space, and the whole path through a folder with spaces it may be
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
  // inline code that is a path as a whole is one link, spaces and all
  for (const code of root.querySelectorAll('code')) {
    const text = code.textContent;
    const whole = text === null || code.closest('pre, a') !== null ? undefined : wholeFileRef(text);
    if (whole !== undefined) code.replaceChildren(fileLink(whole, whole.text));
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  /** @type {Text[]} */
  const texts = [];
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if (node instanceof Text && node.parentElement?.closest('pre, a') === null) texts.push(node);
  }
  const offered = texts.flatMap((node) => linkText(node));
  if (offered.length > 0) void linkWholeWhereFound(offered);
}

/**
 * The paths through folders with spaces offered, linked whole where the viewer finds the file — asked once for them
 * all: the words after the link join it. Out of the viewer's reach, or the text changed meanwhile, they stay as they are.
 * @param {readonly Offered[]} offered
 */
async function linkWholeWhereFound(offered) {
  const paths = [...new Set(offered.map(({ longer }) => longer.path))];
  const response = await fetch('/api/paths/existing', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Viewer': '1' }, body: JSON.stringify({ paths }) }).catch(() => undefined);
  const json = response?.ok === true ? await response.json().catch(() => undefined) : undefined;
  const existing = new Set(isRecord(json) && Array.isArray(json.existing) ? json.existing.filter((one) => typeof one === 'string') : []);
  for (const { link, longer } of offered) {
    const rest = longer.text.slice((link.textContent ?? '').length);
    const after = link.nextSibling;
    if (!existing.has(longer.path) || !(after instanceof Text) || !after.data.startsWith(rest)) continue;
    after.data = after.data.slice(rest.length);
    link.textContent = longer.text;
    markFileLink(link, longer);
  }
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
 * @returns {Offered[]} — its links to paths cut at a space, with the whole paths they may be
 */
function linkText(node) {
  const source = node.data;
  const refs = findFileRefs(source);
  if (refs.length === 0) return [];
  /** @type {(Node | string)[]} */
  const parts = [];
  /** @type {Offered[]} */
  const offered = [];
  let position = 0;
  for (const ref of refs) {
    const link = fileLink(ref, ref.text);
    parts.push(source.slice(position, ref.index), link);
    if (ref.longer !== undefined) offered.push({ link, longer: ref.longer });
    position = ref.index + ref.text.length;
  }
  parts.push(source.slice(position));
  node.replaceWith(...parts.filter((part) => part !== ''));
  return offered;
}

/**
 * The page (app.js) intercepts the click; href is there so the path shows on hover.
 * @param {Element} link
 * @param {FileTarget} target
 */
export function markFileLink(link, target) {
  link.classList.add('file-link');
  link.setAttribute('href', `file:///${encodeURI(target.path.replaceAll('\\', '/'))}`);
  link.setAttribute('data-path', target.path);
  if (target.line !== undefined) link.setAttribute('data-line', String(target.line));
  if (target.endLine !== undefined) link.setAttribute('data-end-line', String(target.endLine));
  link.removeAttribute('target');
  link.removeAttribute('rel');
}
