// @ts-check
// Answer markdown → safe DOM with code highlighting.
import DOMPurify from 'dompurify';
import hljs from 'highlight.js';
import { Marked } from 'marked';
import { h } from './dom.js';
import { linkFileRefs } from './file-links.js';
import { icon } from './icons.js';

const markdown = new Marked({ gfm: true, breaks: false });

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
  return fragment;
}

/**
 * A code block with a language label and a copy button.
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
  const bar = h('div', { className: 'code-bar' }, [h('span', { text: language ?? '' }), copy]);
  return h('div', { className: 'code-frame' }, [bar, pre]);
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
