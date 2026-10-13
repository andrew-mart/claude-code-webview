// @ts-check
// Right-hand panel: a file linked from the feed, shown by what it is — a markdown document or a page drawn, a table
// with its columns coloured, text with its addresses as links, code highlighted, a picture — the target line
// highlighted and scrolled into view in the file's text.
import { csvDelimiterOf, csvLines } from '../model/csv.js';
import { docKindOfPath } from '../model/doc-kind.js';
import { folderAddress } from '../model/doc-links.js';
import { countOf } from '../model/format.js';
import { isRecord, text } from '../model/narrow.js';
import { renderMarkdownDoc } from './doc-markdown.js';
import { renderPdf } from './doc-pdf.js';
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
/** Larger files are shown without syntax highlighting or column colours so the page does not freeze. */
const highlightLimit = 400 * 1024;

/** @type {Readonly<Record<string, string>>} */
const refusals = {
  'not-found': 'File not found: it was deleted, renamed, or the path is not exact.',
  'too-large': 'The file is larger than 2 MB and is not shown.',
  binary: 'This is not a text file.',
  'not-a-file': 'This is a folder, not a file.',
  'not-absolute': 'The path is not absolute — it is unclear which folder it is relative to.',
};

/** Why the editor did not open the file. */
/** @type {Readonly<Record<string, string>>} */
const editorRefusals = {
  'not-a-file': 'The editor did not open it: the file is not there.',
  'no-project': 'The editor did not open it: there is no project folder (.sln, .slnx or .git) above the file.',
  'not-started': "The editor did not start: check the viewer's --editor-command.",
  'no-editor': 'The viewer has no editor to open files in.',
};
const elsewhere = "The editor opens on the viewer's computer, and this browser is on another one.";

/** An <img> does not tell why it did not load. */
const notShownImage = 'The picture is not shown: the file is gone, larger than 20 MB, or not a picture.';

/** @type {import('./resizer.js').PanelWidth} */
const panelWidth = { property: '--panel-width', storageKey: 'viewer.panelWidth' };

/**
 * @param {{ panel: HTMLElement, layout: HTMLElement, editor: import('./editor-opener.js').EditorOpener }} parts — editor:
 *   opens the file at its line in the editor of the viewer's computer, from a browser there
 * @returns {FilePanel}
 */
export function createFilePanel({ panel, layout, editor }) {
  const name = h('div', { className: 'panel-name' });
  const path = h('div', { className: 'panel-path' });
  const where = h('span', { className: 'panel-line' });
  const inEditor = panelButton('external', 'Open in the editor at this line');
  inEditor.classList.add('panel-editor');
  inEditor.hidden = true;
  // a document drawn, or its text
  const view = panelButton('eye', 'Show as a document');
  view.classList.add('panel-view');
  view.hidden = true;
  // a page's scripts: off until asked
  const scripts = panelButton('skill', "Run the page's scripts");
  scripts.classList.add('panel-scripts');
  scripts.hidden = true;
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
    h('header', { className: 'panel-head' }, [h('div', { className: 'panel-title' }, [h('div', { className: 'panel-name-row' }, [icon('read'), name, where]), path]), scripts, view, inEditor, reload, copy, close]),
    body,
  );
  /** @type {FileTarget | undefined} */
  let current;
  let request = 0;
  /** How a document shows: drawn, or its text — at a line a link names. */
  /** @type {'document' | 'source'} */
  let mode = 'document';
  /** Whether the page shown runs its scripts. */
  /** @type {'on' | 'off'} */
  let pageScripts = 'off';
  /** Lets go of what the document shown holds — a PDF's pages — before the panel shows something else. */
  let letGo = () => {};

  /** The buttons over the panel, for what the file is and how it shows. */
  const dress = (/** @type {import('../model/doc-kind.js').DocKind} */ kind) => {
    view.hidden = kind !== 'markdown' && kind !== 'html';
    view.replaceChildren(icon(mode === 'document' ? 'code' : 'eye'));
    view.title = mode === 'document' ? 'Show the source' : 'Show as a document';
    scripts.hidden = kind !== 'html' || mode !== 'document';
    scripts.classList.toggle('on', pageScripts === 'on');
    scripts.title = pageScripts === 'on' ? "Stop the page's scripts" : "Run the page's scripts — in a sandbox, out of reach of this page";
  };

  const load = async (/** @type {FileTarget} */ target) => {
    const ticket = ++request;
    const kind = docKindOfPath(target.path);
    dress(kind);
    letGo();
    if (kind === 'image') {
      showImage(body, target, ticket);
      return;
    }
    if (kind === 'html' && mode === 'document') {
      body.replaceChildren(pageFrame(target.path, pageScripts));
      return;
    }
    if (kind === 'pdf') {
      const pages = renderPdf(target.path, body);
      letGo = pages.dispose;
      body.replaceChildren(pages.element);
      return;
    }
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
    if (kind === 'markdown' && mode === 'document') body.replaceChildren(renderMarkdownDoc(target.path, content));
    else showContent(body, target, content, painterOf(kind, target.path));
  };

  /** @param {string} message */
  const say = (message) => {
    body.querySelector('.panel-note')?.remove();
    body.prepend(h('div', { className: 'panel-message panel-note', text: message }));
  };
  /** @param {import('../model/machine.js').EditorReach} reach */
  const offerEditor = (reach) => {
    inEditor.hidden = reach !== 'same' && reach !== 'unknown';
    inEditor.title = reach === 'unknown' ? "Open in the editor at this line — first checks that this browser is on the viewer's computer" : 'Open in the editor at this line';
  };
  inEditor.addEventListener('click', async () => {
    const target = current;
    if (target === undefined) return;
    const known = await editor.reach();
    const reach = known === 'unknown' ? await editor.check() : known;
    offerEditor(reach);
    if (reach !== 'same') {
      say(elsewhere);
      return;
    }
    const reply = await editor.open(target.path, target.line ?? 1);
    if (!reply.ok) say(editorRefusals[reply.error] ?? 'The viewer did not answer.');
  });

  const api = {
    /** @param {FileTarget} target */
    open(target) {
      current = target;
      void editor.reach().then((reach) => {
        if (current === target) offerEditor(reach);
      });
      name.textContent = target.path.split(/[\\/]/).pop() ?? target.path;
      path.textContent = target.path;
      path.title = target.path;
      where.textContent = lineLabel(target);
      mode = target.line === undefined ? 'document' : 'source';
      pageScripts = 'off';
      panel.hidden = false;
      layout.classList.add('with-panel');
      void load(target);
    },
    close() {
      current = undefined;
      request++;
      letGo();
      letGo = () => {};
      panel.hidden = true;
      layout.classList.remove('with-panel');
    },
    isOpen: () => current !== undefined,
  };

  view.addEventListener('click', () => {
    if (current === undefined) return;
    mode = mode === 'document' ? 'source' : 'document';
    void load(current);
  });
  scripts.addEventListener('click', () => {
    if (current === undefined) return;
    pageScripts = pageScripts === 'on' ? 'off' : 'on';
    void load(current);
  });
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
 * A page drawn in a frame from its folder (server/app.js, /api/folder/), what it loads beside it coming from there
 * too. Its scripts off: no script runs, and the frame shares the page's origin only to be drawn; on: they run in an
 * origin of their own, out of reach of the viewer's page, which can send prompts to Claude.
 * @param {string} path
 * @param {'on' | 'off'} scripts
 * @returns {HTMLElement}
 */
function pageFrame(path, scripts) {
  const sandbox = `${scripts === 'on' ? 'allow-scripts' : 'allow-same-origin'} allow-popups allow-popups-to-escape-sandbox`;
  return h('iframe', { className: 'doc-frame', attrs: { sandbox, src: folderAddress(path, scripts), referrerpolicy: 'no-referrer', title: path } });
}

/**
 * @typedef {(code: HTMLElement, text: string) => void} Painter — fills the code element with the file's text, marked up
 */

/**
 * @param {import('../model/doc-kind.js').DocKind} kind
 * @param {string} path
 * @returns {Painter}
 */
function painterOf(kind, path) {
  if (kind === 'csv') return paintColumns;
  if (kind === 'text') return paintAddresses;
  return (code, text) => highlightInto(code, text, languageOfPath(path) ?? 'plaintext');
}

/**
 * A table's cells coloured by their column, eight colours over and over; the signs between them left plain.
 * @type {Painter}
 */
function paintColumns(code, text) {
  const delimiter = csvDelimiterOf(text);
  /** @type {(Node | string)[]} */
  const parts = [];
  for (const [index, line] of csvLines(text, delimiter).entries()) {
    if (index > 0) parts.push('\n');
    for (const piece of line) parts.push(piece.column === undefined ? piece.text : h('span', { className: `csv-c${piece.column % 8}`, text: piece.text }));
  }
  code.replaceChildren(...parts);
}

/** A web address in text, without the sign that ends the sentence after it. */
const webAddress = /https?:\/\/[^\s<>"'`]+[^\s<>"'`.,;:!?)\]]/g;

/**
 * Text as it is, its web addresses links to open in the browser.
 * @type {Painter}
 */
function paintAddresses(code, text) {
  /** @type {(Node | string)[]} */
  const parts = [];
  let position = 0;
  for (const found of text.matchAll(webAddress)) {
    parts.push(text.slice(position, found.index), h('a', { text: found[0], attrs: { href: found[0], target: '_blank', rel: 'noopener noreferrer' } }));
    position = found.index + found[0].length;
  }
  parts.push(text.slice(position));
  code.replaceChildren(...parts.filter((part) => part !== ''));
}

/**
 * @param {HTMLElement} body
 * @param {FileTarget} target
 * @param {string} content
 * @param {Painter} paint
 */
function showContent(body, target, content, paint) {
  const lines = content.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n');
  const code = h('code');
  if (content.length <= highlightLimit) paint(code, lines.join('\n'));
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
 * The picture, fitted to the panel's width; a click shows it at its own size. The load's number in the address makes
 * Reload fetch the file again: a page reuses an image it has loaded from the same address.
 * @param {HTMLElement} body
 * @param {FileTarget} target
 * @param {number} ticket — the panel's count of loads
 */
function showImage(body, target, ticket) {
  const image = h('img', { className: 'file-image', attrs: { alt: target.path } });
  image.src = `/api/file/image?path=${encodeURIComponent(target.path)}&load=${ticket}`;
  image.addEventListener('click', () => image.classList.toggle('zoomed'));
  image.addEventListener('error', () => {
    if (image.parentNode === body) body.replaceChildren(h('div', { className: 'panel-message', text: notShownImage })); // else another file is open now
  });
  body.replaceChildren(image);
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
