// @ts-check
// Right-hand panel: a file linked from the feed, drawn by file-views by what it is — a markdown document or a page, a
// table with its columns coloured, text and code with the target line marked, a picture, a PDF or a Word document as
// its pages. The panel holds its header — the file's name and path, buttons to show the source, run a page's scripts,
// edit the file here, open it in the editor or in VS Code in the browser, reload, copy the path, close — and tells
// file-views where the viewer's
// files are. In place of a file it shows a list — the changes of the session's branch, or its project's files and
// their search — and a file opened from it has a way back to it. A text file is edited in the panel itself
// (file-editor.js), CodeMirror loaded the first time it is.
import { hasSource, kindOfPath, renderFile } from 'file-views';
import { folderAddress } from '../model/folder-address.js';
import { isRecord, text } from '../model/narrow.js';
import { h } from './dom.js';
import { createChangesView } from './changes-view.js';
import { createLinksView } from './links-view.js';
import { createProjectView } from './project-view.js';
import { createFileEditor } from './file-editor.js';
import { linkFileRefs, markFileLink } from './file-links.js';
import { onComputer } from './on-computer.js';
import { icon } from './icons.js';
import { createResizer, restoreWidth } from './resizer.js';
import { createPinButton } from './pin-button.js';

/**
 * @typedef {import('./file-links.js').FileTarget} FileTarget
 * @typedef {Omit<import('./project-view.js').ProjectSource, 'openFile' | 'iconOf'>} ProjectSource
 * @typedef {ProjectSource & { links: (path: string) => Promise<import('../model/project.js').FileLinks | undefined> }} Project
 *   — a file's project: its folders, its search, a file's links in it
 * @typedef {{ open: (target: FileTarget) => void, showChanges: (source: Omit<import('./changes-view.js').ChangesSource, 'openFile'>) => void, showHistory: (history: ShownList) => void, showNote: (note: ShownList & { id: string, name: () => string, actions: HTMLElement }) => void, listChanged: (list: ShownList) => Promise<void>, showNotesHistory: (history: ShownList) => void, showProject: (source: ProjectSource) => void, showFolder: (path: string) => void, pinsChanged: () => void, findName: (intent: 'definition' | 'uses', name: string, path: string) => Promise<void>, close: () => void, isOpen: () => boolean, reopen: () => boolean, docs: () => readonly DocShown[], showDoc: (key: string) => void, forgetDoc: (key: string) => void, top: HTMLElement }} FilePanel
 *   — showChanges: the branch's changes in place of a file, read from the source; showHistory: the conversations of
 *   herdr's tabs (history-view.js); showProject: the project's files; pinsChanged: the pin over a file drawn again for
 *   the files pinned now; listChanged: a list drawn again, changed elsewhere — the panel's title too, if it is the one
 *   shown;
 *   findName: a name in a file looked for in its project — its one definition opened, or its definitions and uses shown;
 *   docs: the documents shown — files, notes — the latest first, kept once the panel is put away until closed for good
 *   by ×, docked under the feed on a phone; showDoc: one of them shown again; forgetDoc: one closed for good; top: its
 *   grip and head — on a phone, what the sheet is pulled down by
 * @typedef {{ key: string, kind: 'file' | 'note', name: string }} DocShown — a document the panel holds: a file, by its
 *   path; a note, by its id
 * @typedef {{ places: import('./editor-opener.js').PlaceFinder, show: (path: string) => void }} FileManager — where the
 *   browser is; show: a file shown in its folder in the computer's file manager
 * @typedef {(path: string, line: number | undefined) => void} OpenInVsCode — a file opened in VS Code in the browser at
 *   its line, in its project's folder, in a tab of its own
 * @typedef {{ element: HTMLElement, reload: () => Promise<void>, summary: () => string | undefined }} ShownList — a list drawn
 *   by its own view: reload draws it anew, summary goes under the panel's title
 * @typedef {ShownList & { name: () => string, icon: string, back: string, backTitle: string, beside: boolean, actions: HTMLElement | undefined }} Listing
 *   — name: the panel's title, as it is now
 *   — actions: the list's own buttons — a note's — in the panel's head before ↻, in one row with the panel's
 *   — beside: a file opened from the list shows beside it, the list staying on the left — the project's files
 *   — a list in place of a file; name: the panel's title over it; back: the button's word for the way back to it
 */

/** The documents kept once shown, at most: the earliest go past them. */
const keptDocs = 8;

/**
 * @param {string} path
 * @returns {string} — its last part
 */
function fileNameOf(path) {
  return path.split(/[\\/]/).filter((part) => part !== '').at(-1) ?? path;
}

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
  'runs-it': 'The editor did not open it: the program set for this kind of file runs it, and none is set to edit it.',
};
const elsewhere = "The editor opens on the viewer's computer, and this browser is on another one.";
const keptOut =
  'This browser keeps the page from the apps on this computer, so it cannot tell whether the viewer runs here. Allow “Apps on device” (in older Chrome, “Local network access”) for this site — the icon left of the address — and press the button again.';

/** @type {import('./resizer.js').PanelWidth} */
const panelWidth = { property: '--panel-width', storageKey: 'viewer.panelWidth' };
/** Where it is kept whether the project's files are hidden beside a file. */
const treeKey = 'viewer.panelTree';

/** @param {string} key */
function recall(key) {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return ''; // storage is unavailable — the files shown
  }
}

/** @param {string} key @param {string} value — empty: nothing kept */
function remember(key, value) {
  try {
    if (value === '') localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // storage is unavailable — kept for this page only
  }
}

/**
 * @param {{ onDocs: () => void, markdownEditor: import('./file-editor.js').MakeEditor, panel: HTMLElement, layout: HTMLElement, editor: import('./editor-opener.js').EditorOpener, vscode: Promise<OpenInVsCode | undefined>, fileManager: FileManager, project: (path: string) => Project, folder: (root: string) => Project, iconOf: import('./file-icons.js').IconOf, pins: import('./pin-button.js').PinFiles }} parts —
 *   folder: a folder linked, as a project of its own; vscode: none when the viewer runs no VS Code; fileManager: the
 *   file shown in its folder, from a browser on the viewer's computer;
 *   editor: opens the file at its line in the editor of the viewer's computer, from a browser there; project: the
 *   project a file is in, its folders and its search; pins: the files pinned beside the open session (pin-button.js);
 *   markdownEditor: a markdown file edited as a note is, in the notes' editor (markdown-file-editor.js); onDocs: its
 *   documents changed, or it was opened or put away — the dock under the feed drawn anew
 * @returns {FilePanel}
 */
export function createFilePanel({ onDocs, markdownEditor, panel, layout, editor, vscode, fileManager, project, folder, iconOf, pins }) {
  const name = h('div', { className: 'panel-name' });
  /** What the panel shows, at the head of its title: the file's icon, or the list's */
  const headIcon = h('span', { className: 'panel-icon' }, [icon('read')]);
  const path = h('div', { className: 'panel-path' });
  const where = h('span', { className: 'panel-line' });
  const inEditor = panelButton('external', 'Open in the editor at this line');
  inEditor.classList.add('panel-editor');
  inEditor.hidden = true;
  // reached through the viewer: from any browser
  const inVsCode = panelButton('code', "Open in VS Code at this line, in the file's project");
  inVsCode.classList.add('panel-vscode');
  inVsCode.hidden = true;
  // the file in its folder, on the viewer's computer: the button there only — and over a file, not a list
  const inFolder = panelButton('folder-open', "Show the file in its folder, in the computer's file manager");
  inFolder.classList.add('panel-folder');
  const inFolderSlot = h('span', { className: 'panel-folder-slot', attrs: { hidden: '' } }, [inFolder]);
  onComputer(inFolder, fileManager.places, () => {
    if (current !== undefined) fileManager.show(current.path);
  });
  // a document drawn, or its text: the two named, the one shown pressed
  const showDocument = h('button', { className: 'panel-view-document', text: 'Document', title: 'Show as a document', attrs: { type: 'button' } });
  const showSource = h('button', { className: 'panel-view-source', text: 'Source', title: 'Show the source', attrs: { type: 'button' } });
  const view = h('span', { className: 'panel-view', attrs: { role: 'group', 'aria-label': 'Show the file as' } }, [showDocument, showSource]);
  view.hidden = true;
  // a page's scripts: off until asked
  const scripts = panelButton('skill', "Run the page's scripts");
  scripts.classList.add('panel-scripts');
  scripts.hidden = true;
  // the file's text edited here, and back to the file shown
  const editHere = panelButton('edit', 'Edit the file here');
  editHere.classList.add('panel-edit');
  editHere.hidden = true;
  // what the file imports and what imports it
  const linksButton = panelButton('links', 'Links: what the file imports, and what imports it');
  linksButton.classList.add('panel-links');
  linksButton.hidden = true;
  // beside the project's files: the file the whole panel, the files hidden — and back
  const treeToggle = panelButton('widen', 'Hide the files: the file the whole panel');
  treeToggle.classList.add('panel-tree');
  treeToggle.hidden = true;
  const reload = panelButton('reload', 'Reload file');
  reload.classList.add('panel-reload');
  // a list's own buttons — a note's — before ↻, in one row with the panel's
  const listActions = h('span', { className: 'panel-list-actions', attrs: { hidden: '' } });
  const copy = panelButton('copy', 'Copy path');
  // the file pinned beside the open session, in its outline
  const pin = createPinButton(pins);
  const close = panelButton('cross', 'Close (Esc)');
  // a file opened from a list — the branch's changes, the project's files — goes back to it
  const back = h('button', { className: 'panel-back', attrs: { type: 'button' } });
  back.hidden = true;
  const body = h('div', { className: 'panel-body' });
  // a document's diagram, drawn smaller to fit the panel, shows at its own size on a click — scrolling sideways — and
  // fits again on the next (style.css)
  body.addEventListener('click', (event) => {
    const picture = event.target instanceof Element ? event.target.closest('.fv-diagram > img') : null;
    picture?.parentElement?.classList.toggle('natural-size');
  });
  // what the panel says of a button pressed: over the file, which may be scrolled far from its top
  const note = h('div', { className: 'panel-message panel-note', attrs: { hidden: '', role: 'status' } });
  // the project's files on the left while a file opened from them shows on the right — when the panel is wide enough
  const side = h('div', { className: 'panel-side', attrs: { hidden: '' } });
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
  close.classList.add('panel-close');
  // the panel's top: a grip — on a phone, where the panel is a sheet to pull down — and the head, its buttons in a row of
  // their own there, under the file's name
  const top = h('div', { className: 'panel-top' }, [
    h('div', { className: 'panel-grip', attrs: { 'aria-hidden': 'true' } }),
    h('header', { className: 'panel-head' }, [back, treeToggle, h('div', { className: 'panel-title' }, [h('div', { className: 'panel-name-row' }, [headIcon, name, where]), path]), h('div', { className: 'panel-tools' }, [scripts, view, editHere, linksButton, inEditor, inVsCode, inFolderSlot, listActions, reload, pin.element, copy]), close]),
  ]);
  panel.replaceChildren(
    resizer,
    side,
    h('div', { className: 'panel-main' }, [
      top,
      note,
      body,
    ]),
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
  /** The list shown, or kept for the way back from a file opened from it. */
  /** @type {Listing | undefined} */
  let listing;
  let showingList = false;
  /**
   * The documents the panel showed — files, notes — the latest first, kept once it is put away, until closed for good;
   * the one shown now, if it is one of them.
   */
  /** @type {({ key: string, kind: 'file', target: FileTarget } | { key: string, kind: 'note', listing: Listing })[]} */
  let docs = [];
  /** @type {string | undefined} */
  let docShown;
  /** @param {(typeof docs)[number]} doc */
  const keepDoc = (doc) => {
    docs = [doc, ...docs.filter((one) => one.key !== doc.key)].slice(0, keptDocs);
    docShown = doc.key;
  };
  /** The file drawn: let go of before the panel shows something else. */
  /** @type {import('file-views').FileView | undefined} */
  let shown;
  /** The file's text edited in the panel, in place of the file drawn. */
  const editorHere = createFileEditor({
    fetchFile: (url, init) => fetch(url, init),
    // a markdown file as a note is edited, any other as code
    makeEditor: async (host, options) => (/\.(?:md|markdown)$/i.test(options.path) ? markdownEditor(host, options) : (await import('./code-editor.js')).createCodeEditor(host, options)),
    onName: (intent, name, path) => void api.findName(intent, name, path),
  });
  /** The project's files shown last: shown again as they were left for a project of the same folder. */
  /** @type {{ root: string, view: ReturnType<typeof createProjectView> } | undefined} */
  let projectShown;
  let editing = false;

  /** @type {import('file-views').Host} */
  const host = {
    // a path that turns out to be a folder shows its files
    text: async (file) => {
      const reply = await readText(file);
      if (!reply.ok && reply.folder && current?.path === file) api.showFolder(file);
      return reply;
    },
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
    editHere.hidden = !editable(kind);
    linksButton.hidden = !editable(kind);
    editHere.classList.toggle('on', editing);
    editHere.title = editing ? 'Show the file' : 'Edit the file here';
    reload.hidden = editing;
    view.hidden = editing || !hasSource(kind);
    showDocument.setAttribute('aria-pressed', String(mode === 'document'));
    showSource.setAttribute('aria-pressed', String(mode === 'source'));
    scripts.hidden = editing || kind !== 'html' || mode !== 'document';
    scripts.classList.toggle('on', pageScripts === 'on');
    scripts.title = pageScripts === 'on' ? "Stop the page's scripts" : "Run the page's scripts — in a sandbox, out of reach of this page";
  };

  const load = (/** @type {FileTarget} */ target) => {
    loads++;
    shown?.dispose();
    stopEditing();
    dress(kindOfPath(target.path));
    shown = renderFile(body, target, { view: mode, scripts: pageScripts }, host);
  };
  /** The file's text in the editor, at the line shown. */
  const startEditing = (/** @type {FileTarget} */ target) => {
    shown?.dispose();
    shown = undefined;
    editing = true;
    body.classList.add('editing');
    dress(kindOfPath(target.path));
    body.replaceChildren(editorHere.element);
    void editorHere.open(target);
  };
  /** Changes left unsaved stay with the editor, for the next time the file is edited. */
  const stopEditing = () => {
    if (!editing) return;
    editorHere.leave();
    editing = false;
    body.classList.remove('editing');
  };

  /** @param {string} message */
  const say = (message) => {
    note.textContent = message;
    note.hidden = false;
  };
  /** @param {import('../model/machine.js').EditorReach} reach */
  const offerEditor = (reach) => {
    inEditor.hidden = reach !== 'same' && reach !== 'unknown' && reach !== 'blocked';
    inEditor.title = reach === 'same' ? 'Open in the editor at this line' : "Open in the editor at this line — first checks that this browser is on the viewer's computer";
  };
  inEditor.addEventListener('click', async () => {
    const target = current;
    if (target === undefined) return;
    const known = await editor.reach();
    const reach = known === 'unknown' ? await editor.check() : known;
    offerEditor(reach);
    if (reach !== 'same') {
      say(reach === 'blocked' ? keptOut : elsewhere);
      return;
    }
    const reply = await editor.open(target.path, target.line ?? 1);
    if (!reply.ok) say(editorRefusals[reply.error] ?? 'The viewer did not answer.');
  });
  // known once the viewer tells it runs VS Code: a press opens the tab at once — a browser lets a page open one only
  // straight from a press
  /** @type {OpenInVsCode | undefined} */
  let openInVsCode;
  void vscode.then((openFile) => {
    openInVsCode = openFile;
  });
  inVsCode.addEventListener('click', () => {
    if (current !== undefined && openInVsCode !== undefined) openInVsCode(current.path, current.line);
  });

  /** The files hidden beside the file, or shown: as the reader left them, the next time too. */
  const showTree = (/** @type {boolean} */ shownTree) => {
    panel.classList.toggle('tree-hidden', !shownTree);
    treeToggle.replaceChildren(icon(shownTree ? 'widen' : 'folder'));
    treeToggle.title = shownTree ? 'Hide the files: the file the whole panel' : 'Show the files beside the file';
    treeToggle.setAttribute('aria-label', treeToggle.title);
    treeToggle.setAttribute('aria-pressed', String(!shownTree));
    remember(treeKey, shownTree ? '' : 'hidden');
  };
  treeToggle.addEventListener('click', () => showTree(panel.classList.contains('tree-hidden')));
  showTree(recall(treeKey) !== 'hidden');
  /** The list on the left, the file on the right. */
  const showBeside = () => {
    if (listing === undefined) return;
    side.replaceChildren(listing.element);
    side.hidden = false;
    panel.classList.add('split');
    treeToggle.hidden = false;
  };
  /** The list back in the panel's body, or gone. */
  const stopBeside = () => {
    side.hidden = true;
    side.replaceChildren();
    panel.classList.remove('split');
    treeToggle.hidden = true;
  };
  /** The list in the panel, as it was left. */
  const showList = () => {
    if (listing === undefined) return;
    stopBeside();
    current = undefined;
    showingList = true;
    note.hidden = true;
    shown?.dispose();
    shown = undefined;
    stopEditing();
    name.textContent = listing.name();
    headIcon.replaceChildren(icon(listing.icon));
    reload.title = 'Reload';
    path.textContent = listing.summary() ?? '';
    path.title = '';
    where.textContent = '';
    for (const button of [view, scripts, editHere, linksButton, inEditor, inVsCode, inFolderSlot, copy, back]) button.hidden = true;
    pin.show(undefined);
    listActions.replaceChildren(...(listing.actions === undefined ? [] : [listing.actions]));
    listActions.hidden = listing.actions === undefined;
    reload.hidden = false;
    panel.hidden = false;
    layout.classList.add('with-panel');
    body.replaceChildren(listing.element);
  };
  const readList = async () => {
    await listing?.reload();
    retitle();
  };
  /** The list shown under its title and summary as they are now. */
  const retitle = () => {
    if (!showingList || listing === undefined) return;
    name.textContent = listing.name();
    path.textContent = listing.summary() ?? '';
  };
  /** @param {Listing} shownList */
  const showListing = (shownList) => {
    listing = shownList;
    docShown = undefined;
    back.textContent = shownList.back;
    back.title = shownList.backTitle;
    showList();
    void readList();
    onDocs();
  };
  /** @param {ProjectSource} source */
  const projectViewOf = (source) => {
    const view = createProjectView({ ...source, openFile: openFromList, iconOf });
    projectShown = { root: source.root, view };
    return view;
  };
  /** @param {ReturnType<typeof createProjectView>} view @returns {Listing} */
  const filesListing = (view) => ({ ...view, name: () => 'Files', icon: 'folder', back: '← Files', backTitle: "Back to the project's files", beside: true, actions: undefined });
  /** A file, or nothing, in place of the list: its buttons go with it. */
  const dropListActions = () => {
    listActions.hidden = true;
    listActions.replaceChildren();
  };
  /** A file opened from the list, with the way back to it — beside it, for the project's files. @param {FileTarget} target */
  const openFromList = (target) => {
    if (listing?.beside === true) showBeside();
    api.open(target);
    back.hidden = false;
  };

  const api = {
    /** @param {FileTarget} target */
    open(target) {
      // a folder written as one — its slash at the end — shows its files
      if (/[\\/]$/.test(target.path)) {
        api.showFolder(target.path);
        return;
      }
      current = target;
      keepDoc({ key: `file:${target.path}`, kind: 'file', target });
      onDocs();
      showingList = false;
      dropListActions();
      note.hidden = true;
      // beside the project's files, the way back stays: a narrow panel shows one of them at a time
      back.hidden = !panel.classList.contains('split');
      projectShown?.view.select(target.path);
      copy.hidden = false;
      inFolderSlot.hidden = false;
      pin.show(target.path);
      void editor.reach().then((reach) => {
        if (current === target) offerEditor(reach);
      });
      void vscode.then((openFile) => {
        if (current === target) inVsCode.hidden = openFile === undefined;
      });
      name.textContent = target.path.split(/[\\/]/).pop() ?? target.path;
      headIcon.replaceChildren(iconOf(name.textContent, 'file', false));
      reload.title = 'Reload file';
      path.textContent = target.path;
      path.title = target.path;
      where.textContent = lineLabel(target);
      // a page linked at a line opens its source there; a markdown document is read drawn — the feed links it at a line
      // mostly — its source, the line marked, a press away
      mode = target.line !== undefined && kindOfPath(target.path) !== 'markdown' ? 'source' : 'document';
      pageScripts = 'off';
      panel.hidden = false;
      layout.classList.add('with-panel');
      load(target);
    },
    /** @param {Omit<import('./changes-view.js').ChangesSource, 'openFile'>} source */
    showChanges(source) {
      const changes = createChangesView({ ...source, openFile: (file) => openFromList({ path: file, line: undefined, endLine: undefined }) });
      changes.element.replaceChildren(h('div', { className: 'panel-message', text: 'Reading the branch…' }));
      showListing({ ...changes, name: () => 'Branch changes', icon: 'branch', back: '← Changes', backTitle: "Back to the branch's changes", beside: false, actions: undefined });
    },
    /** @param {ShownList} history */
    showHistory(history) {
      showListing({ ...history, name: () => 'History', icon: 'history', back: '← History', backTitle: 'Back to the history', beside: false, actions: undefined });
    },
    /** @param {ShownList & { id: string, name: () => string, actions: HTMLElement }} note — a note opened from its name among the notes (note-panel.js), by its id */
    showNote(note) {
      const noteListing = { ...note, icon: 'note', back: '← Note', backTitle: 'Back to the note', beside: false };
      showListing(noteListing);
      keepDoc({ key: `note:${note.id}`, kind: 'note', listing: noteListing });
      onDocs();
    },
    /** @param {ShownList} history — the changes of the session's notes (notes-history-view.js) */
    showNotesHistory(history) {
      showListing({ ...history, name: () => 'Notes history', icon: 'history', back: '← Notes history', backTitle: 'Back to the notes history', beside: false, actions: undefined });
    },
    pinsChanged() {
      pin.refresh();
    },
    /** @param {ShownList} list */
    async listChanged(list) {
      await list.reload();
      if (listing?.element === list.element) retitle();
    },
    /** @param {string} path — a folder: its files, as a project of its own */
    showFolder(path) {
      const root = path.replace(/(?<=[^\\/:])[\\/]+$/, '');
      showListing(filesListing(projectShown?.root === root ? projectShown.view : projectViewOf(folder(root))));
    },
    /** @param {ProjectSource} source */
    showProject(source) {
      // the same project's files as they were left
      showListing(filesListing(projectShown?.root === source.root ? projectShown.view : projectViewOf(source)));
    },
    /**
     * @param {'definition' | 'uses'} intent
     * @param {string} name
     * @param {string} path — the file the name is in
     */
    async findName(intent, name, path) {
      const source = project(path);
      const known = projectShown?.root === source.root ? projectShown.view : undefined;
      const view = known ?? projectViewOf(source);
      // a project shown before keeps its tree; a new one reads it
      if (known === undefined) showListing(filesListing(view));
      else {
        listing = filesListing(view);
        back.textContent = listing.back;
        back.title = listing.backTitle;
        showList();
      }
      const definitions = await view.searchFor({ text: name, mode: 'text', caseSensitive: true, wholeWord: true }, { name });
      const [only] = definitions;
      // the one definition at once — unless the panel went on to something else meanwhile
      if (intent === 'definition' && only !== undefined && definitions.length === 1 && showingList && listing?.element === view.element) {
        openFromList({ path: only.path, line: only.line, endLine: undefined });
      }
    },
    close() {
      stopBeside();
      current = undefined;
      listing = undefined;
      showingList = false;
      dropListActions();
      back.hidden = true;
      shown?.dispose();
      shown = undefined;
      stopEditing();
      panel.hidden = true;
      layout.classList.remove('with-panel');
      docShown = undefined;
      onDocs();
    },
    isOpen: () => current !== undefined || showingList,
    /**
     * What the panel showed last shown again — a file, a note — after it was closed: a phone's second swipe from the
     * right edge.
     * @returns {boolean} — whether there was something to show
     */
    reopen() {
      const [latest] = docs;
      if (latest === undefined) return false;
      api.showDoc(latest.key);
      return true;
    },
    docs: () => docs.map((doc) => ({ key: doc.key, kind: doc.kind, name: doc.kind === 'file' ? fileNameOf(doc.target.path) : doc.listing.name() })),
    /** @param {string} key */
    showDoc(key) {
      const doc = docs.find((one) => one.key === key);
      if (doc === undefined) return;
      if (doc.kind === 'file') {
        api.open(doc.target);
        return;
      }
      showListing(doc.listing);
      keepDoc(doc);
      onDocs();
    },
    top,
    /** @param {string} key */
    forgetDoc(key) {
      docs = docs.filter((one) => one.key !== key);
      onDocs();
    },
  };

  /** @param {'document' | 'source'} next */
  const showAs = (next) => {
    if (current === undefined || mode === next) return;
    mode = next;
    load(current);
  };
  showDocument.addEventListener('click', () => showAs('document'));
  showSource.addEventListener('click', () => showAs('source'));
  scripts.addEventListener('click', () => {
    if (current === undefined) return;
    pageScripts = pageScripts === 'on' ? 'off' : 'on';
    load(current);
  });
  editHere.addEventListener('click', () => {
    if (current === undefined) return;
    if (editing) load(current);
    else startEditing(current);
  });
  linksButton.addEventListener('click', () => {
    if (current === undefined) return;
    const path = current.path;
    const { root, links } = project(path);
    const view = createLinksView({ path, root, load: () => links(path), openFile: openFromList, iconOf });
    showListing({ ...view, name: () => 'Links', icon: 'links', back: '← Links', backTitle: "Back to the file's links", beside: false, actions: undefined });
  });
  reload.addEventListener('click', () => {
    if (current !== undefined) load(current);
    else if (showingList) void readList();
  });
  back.addEventListener('click', showList);
  copy.addEventListener('click', () => {
    if (current !== undefined) void navigator.clipboard.writeText(current.path);
  });
  // × closes the document shown for good: put away otherwise — Esc, a swipe down on a phone — it stays among the docs
  close.addEventListener('click', () => {
    const closing = docShown;
    api.close();
    if (closing !== undefined) api.forgetDoc(closing);
  });
  return api;
}

/**
 * A file's text from the viewer, or why it is not there — and whether it is a folder.
 * @param {string} file
 * @returns {Promise<{ ok: true, text: string } | { ok: false, message: string, folder: boolean }>}
 */
async function readText(file) {
  const response = await fetch(`/api/file?path=${encodeURIComponent(file)}`).catch(() => undefined);
  /** @type {unknown} */
  const json = response === undefined ? undefined : await response.json().catch(() => undefined);
  const content = isRecord(json) && json.ok === true ? text(json.content) : undefined;
  if (content !== undefined) return { ok: true, text: content };
  const reason = isRecord(json) ? text(json.error) : undefined;
  return { ok: false, message: (reason === undefined ? undefined : refusals[reason]) ?? 'Could not get the file from the server.', folder: reason === 'not-a-file' };
}

/**
 * Whether a file of this kind is text to edit: not a picture, a PDF, a Word document.
 * @param {import('file-views').FileKind} kind
 */
function editable(kind) {
  return kind !== 'image' && kind !== 'pdf' && kind !== 'docx';
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
