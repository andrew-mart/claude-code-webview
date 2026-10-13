// @ts-check
// Right-hand panel: a file linked from the feed, drawn by file-views by what it is — a markdown document or a page, a
// table with its columns coloured, text and code with the target line marked, a picture, a PDF or a Word document as
// its pages. The panel holds its header — the file's name and path, buttons to show the source, run a page's scripts,
// open the file in the editor, reload, copy the path, close — and tells file-views where the viewer's files are. In
// place of a file it shows the changes of the session's branch; a changed file opened from them has a way back.
import { hasSource, kindOfPath, renderFile } from 'file-views';
import { folderAddress } from '../model/folder-address.js';
import { isRecord, text } from '../model/narrow.js';
import { h } from './dom.js';
import { createChangesView } from './changes-view.js';
import { linkFileRefs, markFileLink } from './file-links.js';
import { icon } from './icons.js';
import { createResizer, restoreWidth } from './resizer.js';

/**
 * @typedef {import('./file-links.js').FileTarget} FileTarget
 * @typedef {{ open: (target: FileTarget) => void, showChanges: (source: Omit<import('./changes-view.js').ChangesSource, 'openFile'>) => void, close: () => void, isOpen: () => boolean }} FilePanel
 *   — showChanges: the branch's changes in place of a file, read from the source
 */

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
  // a file opened from the branch's changes goes back to them
  const back = h('button', { className: 'panel-back', text: '← Changes', title: "Back to the branch's changes", attrs: { type: 'button' } });
  back.hidden = true;
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
    h('header', { className: 'panel-head' }, [back, h('div', { className: 'panel-title' }, [h('div', { className: 'panel-name-row' }, [icon('read'), name, where]), path]), scripts, view, inEditor, reload, copy, close]),
    body,
  );
  /** @type {FileTarget | undefined} */
  let current;
  /** The panel's count of loads: in a picture's address, it makes Reload fetch it again — a page reuses a picture it
   * has loaded from the same address. */
  let loads = 0;
  /** How a document shows: drawn, or its text — at a line a link names. */
  /** @type {'document' | 'source'} */
  let mode = 'document';
  /** Whether the page shown runs its scripts. */
  /** @type {'on' | 'off'} */
  let pageScripts = 'off';
  /** The branch's changes shown, or kept for the way back from a file opened from them. */
  /** @type {ReturnType<typeof createChangesView> | undefined} */
  let changes;
  let showingChanges = false;
  /** The file drawn: let go of before the panel shows something else. */
  /** @type {import('file-views').FileView | undefined} */
  let shown;

  /** @type {import('file-views').Host} */
  const host = {
    text: readText,
    documentUrl: folderAddress,
    imageUrl: (file) => `/api/file/image?path=${encodeURIComponent(file)}&load=${loads}`,
    assets: new URL('../vendor/file-views/', import.meta.url).href,
    fileLink: markFileLink,
    // paths in the document's text open in the panel too
    decorate: linkFileRefs,
    theme: () => {
      const chosen = document.documentElement.dataset.theme;
      return chosen === 'dark' || (chosen !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
    },
  };

  /** The buttons over the panel, for what the file is and how it shows. */
  const dress = (/** @type {import('file-views').FileKind} */ kind) => {
    view.hidden = !hasSource(kind);
    view.replaceChildren(icon(mode === 'document' ? 'code' : 'eye'));
    view.title = mode === 'document' ? 'Show the source' : 'Show as a document';
    scripts.hidden = kind !== 'html' || mode !== 'document';
    scripts.classList.toggle('on', pageScripts === 'on');
    scripts.title = pageScripts === 'on' ? "Stop the page's scripts" : "Run the page's scripts — in a sandbox, out of reach of this page";
  };

  const load = (/** @type {FileTarget} */ target) => {
    loads++;
    shown?.dispose();
    dress(kindOfPath(target.path));
    shown = renderFile(body, target, { view: mode, scripts: pageScripts }, host);
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

  /** The changes in the panel, as they were left. */
  const showList = () => {
    if (changes === undefined) return;
    current = undefined;
    showingChanges = true;
    shown?.dispose();
    shown = undefined;
    name.textContent = 'Branch changes';
    path.textContent = changes.summary() ?? '';
    path.title = '';
    where.textContent = '';
    for (const button of [view, scripts, inEditor, copy, back]) button.hidden = true;
    panel.hidden = false;
    layout.classList.add('with-panel');
    body.replaceChildren(changes.element);
  };
  const readChanges = async () => {
    await changes?.reload();
    if (showingChanges) path.textContent = changes?.summary() ?? '';
  };

  const api = {
    /** @param {FileTarget} target */
    open(target) {
      current = target;
      showingChanges = false;
      back.hidden = true;
      copy.hidden = false;
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
      load(target);
    },
    /** @param {Omit<import('./changes-view.js').ChangesSource, 'openFile'>} source */
    showChanges(source) {
      changes = createChangesView({
        ...source,
        openFile: (file) => {
          api.open({ path: file, line: undefined, endLine: undefined });
          back.hidden = false;
        },
      });
      showList();
      changes.element.replaceChildren(h('div', { className: 'panel-message', text: 'Reading the branch…' }));
      void readChanges();
    },
    close() {
      current = undefined;
      changes = undefined;
      showingChanges = false;
      back.hidden = true;
      shown?.dispose();
      shown = undefined;
      panel.hidden = true;
      layout.classList.remove('with-panel');
    },
    isOpen: () => current !== undefined || showingChanges,
  };

  view.addEventListener('click', () => {
    if (current === undefined) return;
    mode = mode === 'document' ? 'source' : 'document';
    load(current);
  });
  scripts.addEventListener('click', () => {
    if (current === undefined) return;
    pageScripts = pageScripts === 'on' ? 'off' : 'on';
    load(current);
  });
  reload.addEventListener('click', () => {
    if (current !== undefined) load(current);
    else if (showingChanges) void readChanges();
  });
  back.addEventListener('click', showList);
  copy.addEventListener('click', () => {
    if (current !== undefined) void navigator.clipboard.writeText(current.path);
  });
  close.addEventListener('click', () => api.close());
  return api;
}

/**
 * A file's text from the viewer, or why it is not there.
 * @param {string} file
 * @returns {Promise<import('file-views').TextReply>}
 */
async function readText(file) {
  const response = await fetch(`/api/file?path=${encodeURIComponent(file)}`).catch(() => undefined);
  /** @type {unknown} */
  const json = response === undefined ? undefined : await response.json().catch(() => undefined);
  const content = isRecord(json) && json.ok === true ? text(json.content) : undefined;
  if (content !== undefined) return { ok: true, text: content };
  const reason = isRecord(json) ? text(json.error) : undefined;
  return { ok: false, message: (reason === undefined ? undefined : refusals[reason]) ?? 'Could not get the file from the server.' };
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
