// @ts-check
// A markdown file drawn as a document for the right-hand panel: its pictures and links read from where it lies, its
// headings named for the links to them, its mermaid diagrams drawn.
import { docLinkTarget, splitFrontMatter } from '../model/doc-links.js';
import { drawDiagrams } from './diagrams.js';
import { h } from './dom.js';
import { markFileLink } from './file-links.js';
import { renderMarkdown } from './markdown.js';

/**
 * @param {string} path — the document's absolute path
 * @param {string} text — its markdown
 * @returns {HTMLElement}
 */
export function renderMarkdownDoc(path, text) {
  const doc = h('div', { className: 'md doc-markdown' });
  doc.append(renderMarkdown(splitFrontMatter(text).body));
  for (const image of doc.querySelectorAll('img')) {
    const target = docLinkTarget(path, image.getAttribute('src') ?? '');
    if (target.kind === 'file') image.setAttribute('src', `/api/file/image?path=${encodeURIComponent(target.path)}`);
  }
  for (const link of doc.querySelectorAll('a:not(.file-link)')) readLink(path, link);
  nameHeadings(doc);
  // a link to a place in the document goes there inside the panel, not to the page's own address
  doc.addEventListener('click', (event) => {
    const link = event.target instanceof Element ? event.target.closest('a.doc-anchor') : null;
    if (link === null) return;
    event.preventDefault();
    const id = link.getAttribute('data-anchor');
    [...doc.querySelectorAll('[id]')].find((element) => element.id === id)?.scrollIntoView({ block: 'start' });
  });
  void drawDiagrams(doc);
  return doc;
}

/**
 * A link read from where the document lies: a file — opened in the panel — a place in it, or a page on the web, which
 * renderMarkdown already leaves to a new tab.
 * @param {string} path
 * @param {Element} link
 */
function readLink(path, link) {
  const href = link.getAttribute('href');
  if (href === null) return;
  const target = docLinkTarget(path, href);
  if (target.kind === 'file') markFileLink(link, { path: target.path, line: target.line, endLine: undefined });
  else if (target.kind === 'anchor') {
    link.classList.add('doc-anchor');
    link.setAttribute('data-anchor', slug(target.id));
    link.removeAttribute('target');
    link.removeAttribute('rel');
  }
}

/**
 * Each heading gets the name GitHub gives it — its words in lower case joined by hyphens — so links to it find it;
 * a second heading of the same words gets -1, a third -2.
 * @param {HTMLElement} doc
 */
function nameHeadings(doc) {
  /** @type {Map<string, number>} */
  const seen = new Map();
  for (const heading of doc.querySelectorAll('h1, h2, h3, h4, h5, h6')) {
    const name = slug(heading.textContent ?? '');
    const count = seen.get(name) ?? 0;
    seen.set(name, count + 1);
    heading.id = count === 0 ? name : `${name}-${count}`;
  }
}

/**
 * @param {string} words
 */
function slug(words) {
  return words.trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-');
}
