// @ts-check
// Answer markdown → safe DOM with code highlighting.
import DOMPurify from 'dompurify';
import hljs from 'highlight.js';
import { Marked } from 'marked';
import { h } from './dom.js';
import { linkFileRefs } from './file-links.js';
import { icon } from './icons.js';

// a line break in an answer is a line break, as the terminal shows it — not a space within the paragraph
const markdown = new Marked({ gfm: true, breaks: true });

/** Text struck out between two tildes on each side; GFM's single ones are not — "~$2,7" is "about $2.7". */
const struckOut = /^~~(?=[^\s~])((?:\\.|[^\\])*?(?:\\.|[^\s~\\]))~~(?=[^~]|$)/;
markdown.use({
  tokenizer: {
    /**
     * As the terminal shows an answer: struck out between double tildes only; anything else is no strikethrough — the
     * undefined that tells marked so, where false would hand the text to its own, which takes single tildes too.
     * @this {import('marked').Tokenizer}
     * @param {string} source
     * @returns {import('marked').Tokens.Del | undefined}
     */
    del(source) {
      const [raw, text] = struckOut.exec(source) ?? [];
      if (raw === undefined || text === undefined) return undefined;
      return { type: 'del', raw, text, tokens: this.lexer.inlineTokens(text) };
    },
  },
});

/** Link URLs that DOMPurify keeps: its default list plus file:, since such links open the file in the panel. */
const allowedUris = /^(?:(?:(?:f|ht)tps?|mailto|tel|file):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i;

/** File extension → highlight.js language (only languages from the standard build). */
/** @type {Readonly<Record<string, string>>} */
const languageByExtension = {
  cs: 'csharp',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  py: 'python',
  json: 'json',
  jsonl: 'json',
  md: 'markdown',
  sql: 'sql',
  yml: 'yaml',
  yaml: 'yaml',
  xml: 'xml',
  html: 'xml',
  csproj: 'xml',
  props: 'xml',
  css: 'css',
  scss: 'scss',
  sh: 'bash',
  bash: 'bash',
  ps1: 'powershell',
  go: 'go',
  rs: 'rust',
  java: 'java',
  kt: 'kotlin',
  rb: 'ruby',
  php: 'php',
  toml: 'ini',
  ini: 'ini',
  dockerfile: 'dockerfile',
};

/**
 * @param {string} source
 * @returns {DocumentFragment}
 */
export function renderMarkdown(source) {
  const html = markdown.parse(source, { async: false });
  const fragment = DOMPurify.sanitize(html, { RETURN_DOM_FRAGMENT: true, ALLOWED_URI_REGEXP: allowedUris });
  for (const link of fragment.querySelectorAll('a')) {
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
  }
  linkFileRefs(fragment);
  // A heading that is nothing but a file path names the code below it: it is shown as a caption, not as a heading.
  for (const heading of fragment.querySelectorAll('h1, h2, h3, h4, h5, h6')) {
    const links = heading.querySelectorAll('a.file-link');
    if (links.length === 1 && heading.textContent?.trim() === links[0]?.textContent?.trim()) heading.classList.add('file-caption');
  }
  for (const code of fragment.querySelectorAll('pre > code')) {
    const language = /language-([\w+-]+)/.exec(code.className)?.[1];
    if (language !== undefined) highlightInto(code, code.textContent ?? '', language);
    const pre = code.parentElement;
    if (pre === null) continue;
    // codeFrame moves pre inside the frame, so its place in the document is marked first.
    const place = document.createComment('');
    pre.replaceWith(place);
    place.replaceWith(codeFrame(pre, code.textContent ?? '', language));
  }
  for (const table of fragment.querySelectorAll('table')) {
    const place = document.createComment('');
    table.replaceWith(place);
    place.replaceWith(tableFrame(table));
  }
  return fragment;
}

/**
 * A table with a button in its corner: it widens the table past the answer's width — each column as wide as is
 * comfortable to read, the table scrolling sideways — or fits it back. The button overrides, for this table, what the
 * session or the whole viewer says (the --table-width property inherited from above, see style.css). A cell's text
 * sits in a block: a block can be kept from growing too wide, a table cell cannot.
 * @param {HTMLTableElement} table
 * @returns {HTMLElement}
 */
function tableFrame(table) {
  for (const cell of table.querySelectorAll('th, td')) {
    const block = h('div', { className: 'cell' });
    block.append(...cell.childNodes);
    cell.append(block);
  }
  const button = h('button', { className: 'table-width', attrs: { type: 'button' } });
  const frame = h('div', { className: 'table-frame' }, [h('div', { className: 'table-scroll' }, [table]), button]);
  // A wide table is much shorter than a fitted one: what is below it would jump. The button stays where it was under
  // the pointer — the feed scrolls by as much as the table changed.
  button.addEventListener('click', () => {
    const before = button.getBoundingClientRect().top;
    frame.dataset.width = isWide(frame) ? 'fit' : 'wide';
    labelWidthButton(frame, button);
    const shift = button.getBoundingClientRect().top - before;
    const scroller = scrollingAncestor(frame);
    if (shift !== 0 && scroller !== undefined) scroller.scrollTop += shift;
  });
  // The inherited width may have changed since the label was set: it is read again when the button is about to be used.
  button.addEventListener('pointerenter', () => labelWidthButton(frame, button));
  button.addEventListener('focus', () => labelWidthButton(frame, button));
  labelWidthButton(frame, button);
  return frame;
}

/**
 * The nearest element that scrolls what is inside it: the feed, or the panel of a subagent's transcript.
 * @param {Element} element
 * @returns {Element | undefined}
 */
function scrollingAncestor(element) {
  for (let parent = element.parentElement; parent !== null; parent = parent.parentElement) {
    const overflow = getComputedStyle(parent).overflowY;
    if (overflow === 'auto' || overflow === 'scroll') return parent;
  }
  return document.scrollingElement ?? undefined;
}

/**
 * The tables' buttons name what a click does: after the session's or the viewer's table setting changed, they are
 * named again.
 * @param {ParentNode} root
 */
export function relabelTables(root) {
  for (const frame of root.querySelectorAll('.table-frame')) {
    const button = frame.querySelector(':scope > .table-width');
    if (frame instanceof HTMLElement && button instanceof HTMLButtonElement) labelWidthButton(frame, button);
  }
}

/**
 * @param {HTMLElement} frame
 * @param {HTMLButtonElement} button
 */
function labelWidthButton(frame, button) {
  const wide = isWide(frame);
  // labelled so already: left as it is — a button made anew would have the styles of the page worked out again
  if (button.dataset.wide === String(wide)) return;
  button.dataset.wide = String(wide);
  const text = wide ? 'Fit this table to the width' : 'Widen this table, scrolling sideways';
  button.title = text;
  button.setAttribute('aria-label', text);
  button.replaceChildren(icon(wide ? 'narrow' : 'widen'), h('span', { text: wide ? 'Fit' : 'Wide' }));
}

/**
 * The table's own choice, otherwise what is inherited from the session or the viewer.
 * @param {HTMLElement} frame
 */
function isWide(frame) {
  const own = frame.dataset.width;
  if (own !== undefined) return own === 'wide';
  return frame.isConnected && getComputedStyle(frame).getPropertyValue('--table-width').trim() === 'max-content';
}

/**
 * A code block with a language label, a Wrap button — its long lines wrapped in its width, not scrolled sideways — and a
 * copy button.
 * @param {HTMLElement} pre
 * @param {string} text
 * @param {string | undefined} language
 * @returns {HTMLElement}
 */
export function codeFrame(pre, text, language) {
  const copy = h('button', { className: 'copy', title: 'Copy', attrs: { type: 'button' } }, [icon('copy')]);
  copy.addEventListener('click', () => {
    void navigator.clipboard.writeText(text).then(() => {
      copy.replaceChildren(icon('check'));
      setTimeout(() => copy.replaceChildren(icon('copy')), 1500);
    });
  });
  const wrap = h('button', { className: 'code-wrap', title: 'Wrap long lines', attrs: { type: 'button', 'aria-pressed': 'false', 'aria-label': 'Wrap long lines' } }, [icon('wrap')]);
  const bar = h('div', { className: 'code-bar' }, [h('span', { text: language ?? '' }), h('span', { className: 'code-tools' }, [wrap, copy])]);
  const frame = h('div', { className: 'code-frame' }, [bar, pre]);
  wrap.addEventListener('click', () => {
    const wrapped = frame.dataset.wrap !== 'on';
    frame.dataset.wrap = wrapped ? 'on' : 'off';
    wrap.setAttribute('aria-pressed', String(wrapped));
    wrap.title = wrapped ? 'Scroll long lines sideways' : 'Wrap long lines';
    wrap.setAttribute('aria-label', wrap.title);
  });
  return frame;
}

/**
 * @param {Element} element
 * @param {string} text
 * @param {string} language
 */
export function highlightInto(element, text, language) {
  if (hljs.getLanguage(language) === undefined) {
    element.textContent = text;
    return;
  }
  // highlight.js escapes the text itself; the markup contains only its spans.
  element.innerHTML = hljs.highlight(text, { language, ignoreIllegals: true }).value;
  element.classList.add('hljs');
}

/**
 * @param {string} path
 * @returns {string | undefined}
 */
export function languageOfPath(path) {
  const name = path.split(/[\\/]/).pop()?.toLowerCase() ?? '';
  if (name === 'dockerfile') return 'dockerfile';
  return languageByExtension[name.split('.').pop() ?? ''];
}
