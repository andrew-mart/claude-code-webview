// @ts-check
// Right-hand panel: the content of a file linked from the feed, with the target line highlighted and scrolled into view.
import { countOf } from '../model/format.js';
import { isRecord, text } from '../model/narrow.js';
import { h } from './dom.js';
import { icon } from './icons.js';
import { highlightInto, languageOfPath } from './markdown.js';
import { createResizer, restoreWidth } from './resizer.js';

/**
 * @typedef {import('./file-links.js').FileTarget} FileTarget
 * @typedef {{ open: (target: FileTarget) => void, close: () => void, isOpen: () => boolean }} FilePanel
 */

/** Height of a code line in the panel, px — the highlight position is computed from it. */
const lineHeight = 20;
const codePaddingTop = 10;
/** Larger files are shown without syntax highlighting so the page does not freeze. */
const highlightLimit = 400 * 1024;

/** @type {Readonly<Record<string, string>>} */
const refusals = {
  'not-found': 'File not found: it was deleted, renamed, or the path is not exact.',
  'too-large': 'The file is larger than 2 MB and is not shown.',
  binary: 'This is not a text file.',
  'not-a-file': 'This is a folder, not a file.',
  'not-absolute': 'The path is not absolute — it is unclear which folder it is relative to.',
};

/** @type {import('./resizer.js').PanelWidth} */
const panelWidth = { property: '--panel-width', storageKey: 'viewer.panelWidth' };

/**
 * @param {{ panel: HTMLElement, layout: HTMLElement }} elements
 * @returns {FilePanel}
 */
export function createFilePanel({ panel, layout }) {
  const name = h('div', { className: 'panel-name' });
  const path = h('div', { className: 'panel-path' });
  const where = h('span', { className: 'panel-line' });
  const reload = panelButton('reload', 'Reload file');
  const copy = panelButton('copy', 'Copy path');
  const close = panelButton('cross', 'Close (Esc)');
  const body = h('div', { className: 'panel-body' });
  restoreWidth(layout, panelWidth);
  const resizer = createResizer({
    layout,
    width: panelWidth,
    side: 'right',
    min: 320,
    max: () => window.innerWidth - 480,
    measure: () => panel.getBoundingClientRect().width,
    label: 'File panel width',
    className: 'panel-resizer',
  });
  panel.replaceChildren(
    resizer,
    h('header', { className: 'panel-head' }, [h('div', { className: 'panel-title' }, [h('div', { className: 'panel-name-row' }, [icon('read'), name, where]), path]), reload, copy, close]),
    body,
  );
  /** @type {FileTarget | undefined} */
  let current;
  let request = 0;

  const load = async (/** @type {FileTarget} */ target) => {
    const ticket = ++request;
    body.replaceChildren(h('div', { className: 'panel-message', text: 'Loading…' }));
    const response = await fetch(`/api/file?path=${encodeURIComponent(target.path)}`).catch(() => undefined);
    /** @type {unknown} */
    const json = response === undefined ? undefined : await response.json().catch(() => undefined);
    if (ticket !== request) return; // another file was opened while this one was loading
    const content = isRecord(json) && json.ok === true ? text(json.content) : undefined;
    if (content === undefined) {
      const reason = isRecord(json) ? text(json.error) : undefined;
      body.replaceChildren(h('div', { className: 'panel-message', text: (reason === undefined ? undefined : refusals[reason]) ?? 'Could not get the file from the server.' }));
      return;
    }
    showContent(body, target, content);
  };

  const api = {
    /** @param {FileTarget} target */
    open(target) {
      current = target;
      name.textContent = target.path.split(/[\\/]/).pop() ?? target.path;
      path.textContent = target.path;
      path.title = target.path;
      where.textContent = lineLabel(target);
      panel.hidden = false;
      layout.classList.add('with-panel');
      void load(target);
    },
    close() {
      current = undefined;
      request++;
      panel.hidden = true;
      layout.classList.remove('with-panel');
    },
    isOpen: () => current !== undefined,
  };

  reload.addEventListener('click', () => {
    if (current !== undefined) void load(current);
  });
  copy.addEventListener('click', () => {
    if (current !== undefined) void navigator.clipboard.writeText(current.path);
  });
  close.addEventListener('click', () => api.close());
  return api;
}

/**
 * @param {HTMLElement} body
 * @param {FileTarget} target
 * @param {string} content
 */
function showContent(body, target, content) {
  const lines = content.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n');
  const code = h('code');
  if (content.length <= highlightLimit) highlightInto(code, lines.join('\n'), languageOfPath(target.path) ?? 'plaintext');
  else code.textContent = lines.join('\n');
  const gutter = h('span', { className: 'gutter', text: lines.map((_, index) => index + 1).join('\n') });
  const view = h('div', { className: 'file-view' }, [h('pre', { className: 'code numbered file-code' }, [gutter, code])]);
  body.replaceChildren(view);
  const first = target.line;
  if (first === undefined) return;
  if (first > lines.length) {
    body.prepend(h('div', { className: 'panel-message', text: `There is no line ${first}: the file has ${countOf(lines.length, 'line')}.` }));
    return;
  }
  const last = Math.min(Math.max(target.endLine ?? first, first), lines.length);
  const top = codePaddingTop + (first - 1) * lineHeight;
  const mark = h('div', { className: 'line-mark' });
  mark.style.top = `${top}px`;
  mark.style.height = `${(last - first + 1) * lineHeight}px`;
  view.prepend(mark);
  body.scrollTop = Math.max(0, top - body.clientHeight / 3);
  body.scrollLeft = 0;
}

/**
 * @param {FileTarget} target
 * @returns {string}
 */
function lineLabel(target) {
  if (target.line === undefined) return '';
  return target.endLine === undefined ? `line ${target.line}` : `lines ${target.line}–${target.endLine}`;
}

/**
 * @param {string} iconName
 * @param {string} title
 * @returns {HTMLButtonElement}
 */
function panelButton(iconName, title) {
  return h('button', { className: 'icon-button', title, attrs: { type: 'button' } }, [icon(iconName)]);
}
