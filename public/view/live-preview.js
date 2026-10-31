// @ts-check
// A note's markdown shown as it reads while it is edited, as Obsidian's live preview does: the marks of markdown — a
// heading's #, emphasis' asterisks, a link's address, a code block's fences — hidden while the cursor is away from what
// they mark, shown as soon as it touches it; bullets drawn as dots, a task's [ ] as a box to tick, a table as a table —
// a click on a cell edits that cell in place, the table staying one.
// The text itself is never changed: what is saved is the markdown as typed. A link — and a file's path in the text —
// opens on Ctrl+click (note-editor-cm.js).
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import { StateEffect, StateField } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType } from '@codemirror/view';
import { findFileRefs } from '../model/file-ref.js';
import { renderMarkdown } from './markdown.js';

/**
 * @typedef {import('@codemirror/state').EditorState} EditorState
 * @typedef {import('@codemirror/state').Range<Decoration>} DecorationRange
 * @typedef {import('@codemirror/view').DecorationSet} DecorationSet
 * @typedef {import('@lezer/common').SyntaxNode} SyntaxNode
 */

/** The editor taking the focus, or losing it. */
export const focusChanged = StateEffect.define({ map: (/** @type {boolean} */ focused) => focused });

/** Whether the editor has the focus: till it does, its cursor — at the note's start — marks nothing as being edited. */
const focusField = StateField.define({
  create: () => false,
  update: (focused, transaction) => transaction.effects.reduce((now, effect) => (effect.is(focusChanged) ? effect.value : now), focused),
});

/** The editor's focus kept in its state, for the preview to tell where the cursor is. */
export const trackFocus = [focusField, EditorView.focusChangeEffect.of((_state, focusing) => focusChanged.of(focusing))];

/** What a link says of itself on hover. */
const opensTitle = 'Ctrl+click opens it';

const hidden = Decoration.replace({});

/** A callout's kind, as its label reads. @type {Readonly<Record<string, string>>} */
const calloutLabels = { note: 'Note', info: 'Info', tip: 'Tip', important: 'Important', warning: 'Warning', caution: 'Caution', danger: 'Danger', question: 'Question' };

/** A word in place of a mark: a bullet's dot, a code block's language, a callout's kind. */
class TextWidget extends WidgetType {
  /** @param {string} shows @param {string} className */
  constructor(shows, className) {
    super();
    /** What it shows. */
    this.shows = shows;
    this.className = className;
  }

  /** @param {TextWidget} other */
  eq(other) {
    return other.shows === this.shows && other.className === this.className;
  }

  toDOM() {
    const span = document.createElement('span');
    span.className = this.className;
    span.textContent = this.shows;
    return span;
  }
}

/** A task's [ ] or [x] as a box to tick: a click ticks it in the text. */
class CheckboxWidget extends WidgetType {
  /** @param {boolean} checked */
  constructor(checked) {
    super();
    this.checked = checked;
    /** What it shows, in a word. */
    this.shows = checked ? '☑' : '☐';
  }

  /** @param {CheckboxWidget} other */
  eq(other) {
    return other.checked === this.checked;
  }

  /** @param {EditorView} view */
  toDOM(view) {
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = this.checked;
    box.className = 'cm-lp-checkbox';
    box.addEventListener('mousedown', (event) => {
      event.preventDefault();
      const at = view.posAtDOM(box);
      const marker = view.state.doc.sliceString(at, at + 3);
      view.dispatch({ changes: { from: at, to: at + 3, insert: marker === '[ ]' ? '[x]' : '[ ]' } });
    });
    return box;
  }

  ignoreEvent() {
    return false;
  }
}

/** A horizontal rule drawn as a line. */
class RuleWidget extends WidgetType {
  constructor() {
    super();
    /** What it shows, in a word. */
    this.shows = 'rule';
  }

  /** @param {RuleWidget} _other */
  eq(_other) {
    return true;
  }

  toDOM() {
    const line = document.createElement('span');
    line.className = 'cm-lp-hr';
    return line;
  }
}

/**
 * A cell of a table: its row among the table's lines — the header 0, the delimiter 1, then the rows — and its place in
 * the row.
 * @typedef {{ row: number, cell: number }} CellAt
 */

/**
 * The cell to go on editing in once its table is drawn anew — the edit of the one before changed the table's text: told
 * by the transaction that made the edit, for the drawing it makes, and by none after it.
 */
const editCellNext = StateEffect.define({ map: (/** @type {CellAt & { from: number }} */ at, mapping) => ({ ...at, from: mapping.mapPos(at.from) }) });
const cellToEdit = StateField.define({
  create: /** @returns {(CellAt & { from: number }) | undefined} */ () => undefined,
  update: (_at, transaction) => {
    /** @type {(CellAt & { from: number }) | undefined} */
    let told;
    for (const effect of transaction.effects) if (effect.is(editCellNext)) told = effect.value;
    return told;
  },
});

/**
 * The change a cell edited in place makes to its row: the text between its pipes, its new words padded with a space
 * each side, a pipe in them escaped, a line break a space. None for a row with no pipe at its start, or a cell it does
 * not have.
 * @param {string} line — the row's text
 * @param {number} cell — the cell's place in the row
 * @param {string} words — what it says now
 * @returns {{ from: number, to: number, insert: string } | undefined} — from and to: within the line
 */
export function tableCellChange(line, cell, words) {
  if (!line.startsWith('|')) return undefined;
  /** @type {number[]} */
  const pipes = [];
  for (let at = 0; at < line.length; at++) {
    if (line[at] === '\\') at++;
    else if (line[at] === '|') pipes.push(at);
  }
  const start = pipes[cell];
  const end = pipes[cell + 1];
  if (start === undefined || end === undefined) return undefined;
  return { from: start + 1, to: end, insert: ` ${words.replace(/\r?\n/g, ' ').replace(/(?<!\\)\|/g, '\\|')} ` };
}

/**
 * The words of a row's cell as typed, for its box.
 * @param {string} line @param {number} cell
 * @returns {string | undefined}
 */
function cellWords(line, cell) {
  const change = tableCellChange(line, cell, '');
  return change === undefined ? undefined : line.slice(change.from, change.to).trim();
}

/**
 * A table drawn as the viewer draws one, and stays one when clicked: a cell clicked shows its markdown in a box in its
 * place — Enter keeps it, Tab and Shift+Tab go on to the cell after or before, Esc leaves it as it was, a click
 * elsewhere keeps it. A link in it opens on Ctrl+click.
 */
class TableWidget extends WidgetType {
  /** @param {string} source @param {number} from — where the table starts in the note */
  constructor(source, from) {
    super();
    this.source = source;
    this.from = from;
    /** What it shows, in a word. */
    this.shows = 'table';
  }

  /** @param {TableWidget} other */
  eq(other) {
    return other.source === this.source;
  }

  /** @param {EditorView} view */
  toDOM(view) {
    const wrap = document.createElement('div');
    wrap.className = 'cm-lp-table md';
    wrap.append(renderMarkdown(this.source));
    /** Each cell drawn, with the row and the place in it of its text. */
    const cells = [...wrap.querySelectorAll('tr')].flatMap((tr, index) => [...tr.children].flatMap((element, cell) => (element instanceof window.HTMLElement ? [{ element, row: index === 0 ? 0 : index + 1, cell }] : [])));
    /** The cell being edited: its box kept — going on in another cell — or left. */
    /** @type {{ keep: (next: number | undefined) => void } | undefined} */
    let open;
    /** @param {number} at — a cell's place among them */
    const edit = (at) => {
      const target = cells[at];
      if (target === undefined) return;
      const line = view.state.doc.lineAt(view.posAtDOM(wrap)).number + target.row;
      if (line > view.state.doc.lines) return;
      const row = view.state.doc.line(line);
      const before = cellWords(row.text, target.cell);
      if (before === undefined) return;
      const drawn = [...target.element.childNodes];
      const box = document.createElement('input');
      box.className = 'cm-lp-cell-box';
      box.value = before;
      target.element.replaceChildren(box);
      let over = false;
      const close = () => {
        over = true;
        open = undefined;
        target.element.replaceChildren(...drawn);
      };
      /** @param {number | undefined} next — the cell to go on in */
      const keep = (next) => {
        if (over) return;
        const change = box.value === before ? undefined : tableCellChange(row.text, target.cell, box.value);
        close();
        if (change === undefined) {
          if (next !== undefined) edit(next);
          return;
        }
        const nextCell = next === undefined ? undefined : cells[next];
        view.dispatch({
          changes: { from: row.from + change.from, to: row.from + change.to, insert: change.insert },
          effects: nextCell === undefined ? [] : [editCellNext.of({ from: view.posAtDOM(wrap), row: nextCell.row, cell: nextCell.cell })],
        });
      };
      box.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          keep(undefined);
        } else if (event.key === 'Tab') {
          event.preventDefault();
          keep(event.shiftKey ? at - 1 : at + 1);
        } else if (event.key === 'Escape') {
          // the panel's Escape, which closes it, is not this one's
          event.preventDefault();
          event.stopPropagation();
          close();
        }
      });
      box.addEventListener('blur', () => keep(undefined));
      open = { keep };
      box.focus();
      // a box the page could not give the focus to — the window left meanwhile — would stay open, no blur to close it
      if (document.activeElement !== box) close();
    };
    wrap.addEventListener('mousedown', (event) => {
      if (!(event.target instanceof window.Element) || event.target.closest('.cm-lp-cell-box') !== null) return;
      // a link Ctrl+clicked opens, as in the text — the page's own handler of links takes the click
      if ((event.ctrlKey || event.metaKey) && event.target.closest('a') !== null) return;
      const at = cells.findIndex(({ element }) => event.target instanceof window.Node && element.contains(event.target));
      event.preventDefault();
      if (at === -1) return;
      // one cell at a time: the one open kept, the editing going on in the cell clicked
      if (open !== undefined) open.keep(at);
      else edit(at);
    });
    // the edit before this drawing went on to a cell of it: its box opens, once the table is in the page
    const next = view.state.field(cellToEdit, false);
    const at = next === undefined || next.from !== this.from ? -1 : cells.findIndex(({ row, cell }) => row === next.row && cell === next.cell);
    if (at !== -1) requestAnimationFrame(() => edit(at));
    return wrap;
  }

  /** The table's events are its own: the editor's cursor does not go into it. */
  ignoreEvent() {
    return true;
  }
}

/**
 * @param {EditorState} state @param {number} from @param {number} to
 * @returns {boolean} — whether the cursor, or a selection, touches the text from from to to — in an editor with the
 *   focus: one without it edits nothing
 */
function touched(state, from, to) {
  return state.field(focusField, false) === true && state.selection.ranges.some((range) => range.from <= to && range.to >= from);
}

/** @param {EditorState} state @param {number} at @returns {boolean} — whether the cursor is on the line of at */
function lineTouched(state, at) {
  const line = state.doc.lineAt(at);
  return touched(state, line.from, line.to);
}

/** @param {EditorState} state @param {number} at @returns {number} — at, or past the space after it */
function pastSpace(state, at) {
  return state.doc.sliceString(at, at + 1) === ' ' ? at + 1 : at;
}

/** @param {string} className @returns {Decoration} */
function lineClass(className) {
  return Decoration.line({ class: className });
}

/**
 * A code block: its lines one block; its fences, while the cursor is outside it, its language in place of the first and
 * nothing in place of the last.
 * @param {EditorState} state @param {SyntaxNode} node @param {DecorationRange[]} out
 */
function decorateCodeBlock(state, node, out) {
  const first = state.doc.lineAt(node.from);
  const last = state.doc.lineAt(node.to);
  for (let number = first.number; number <= last.number; number++) {
    const edge = number === first.number ? ' cm-lp-code-first' : number === last.number ? ' cm-lp-code-last' : '';
    out.push(lineClass(`cm-lp-code${edge}`).range(state.doc.line(number).from));
  }
  for (const quote of node.getChildren('QuoteMark')) if (!lineTouched(state, quote.from)) out.push(hidden.range(quote.from, pastSpace(state, quote.to)));
  if (touched(state, node.from, node.to)) return;
  const marks = node.getChildren('CodeMark');
  const open = marks[0];
  const close = marks.length > 1 ? marks[marks.length - 1] : undefined;
  const info = node.getChild('CodeInfo');
  if (open !== undefined) out.push(Decoration.replace({ widget: new TextWidget(info === null ? 'text' : state.doc.sliceString(info.from, info.to), 'cm-lp-fence-label') }).range(open.from, first.to));
  if (close !== undefined && last.number !== first.number) out.push(hidden.range(close.from, last.to));
}

/**
 * A quote's lines marked as a quote's — a callout's, > [!note], as its kind, its [!note] in words off its line.
 * @param {EditorState} state @param {SyntaxNode} node @param {DecorationRange[]} out
 */
function decorateQuote(state, node, out) {
  const first = state.doc.lineAt(node.from);
  const last = state.doc.lineAt(node.to);
  const callout = /^\s*>\s*\[!([a-zA-Z]+)\][+-]?/.exec(first.text);
  const kind = callout?.[1]?.toLowerCase();
  for (let number = first.number; number <= last.number; number++) {
    const className = kind === undefined ? 'cm-lp-quote' : `cm-lp-callout cm-lp-callout-${kind}${number === first.number ? ' cm-lp-callout-title' : ''}`;
    out.push(lineClass(className).range(state.doc.line(number).from));
  }
  if (callout === null || kind === undefined || lineTouched(state, first.from)) return;
  const start = first.from + first.text.indexOf('[!');
  out.push(Decoration.replace({ widget: new TextWidget(calloutLabels[kind] ?? kind, 'cm-lp-callout-label') }).range(start, first.from + callout[0].length));
}

/**
 * A link: its words marked as a link's, to open on Ctrl+click; its brackets and address hidden while the cursor is off it.
 * @param {EditorState} state @param {SyntaxNode} node @param {DecorationRange[]} out
 */
function decorateLink(state, node, out) {
  const url = node.getChild('URL');
  const href = url === null ? undefined : state.doc.sliceString(url.from, url.to);
  out.push(Decoration.mark({ class: 'cm-lp-link', attributes: href === undefined ? { title: opensTitle } : { 'data-href': href, title: opensTitle } }).range(node.from, node.to));
  if (touched(state, node.from, node.to)) return;
  for (const child of [...node.getChildren('LinkMark'), ...node.getChildren('URL'), ...node.getChildren('LinkTitle')]) out.push(hidden.range(child.from, child.to));
}

/**
 * A list's bullet as a dot — a task's hidden, its box standing for it — off the cursor's line.
 * @param {EditorState} state @param {SyntaxNode} node @param {DecorationRange[]} out
 */
function decorateListMark(state, node, out) {
  const item = node.parent;
  if (item === null || item.parent?.name !== 'BulletList' || lineTouched(state, node.from)) return;
  if (item.getChild('Task') !== null) out.push(hidden.range(node.from, pastSpace(state, node.to)));
  else out.push(Decoration.replace({ widget: new TextWidget('•', 'cm-lp-bullet') }).range(node.from, node.to));
}

/**
 * @param {EditorState} state @param {SyntaxNode} node @param {string} markName @param {DecorationRange[]} out
 */
function hideMarksUntouched(state, node, markName, out) {
  if (touched(state, node.from, node.to)) return;
  for (const mark of node.getChildren(markName)) out.push(hidden.range(mark.from, mark.to));
}

/**
 * The files' paths in the text between from and to — not in code blocks, nor in links — marked as links to them.
 * @param {EditorState} state @param {{ from: number, to: number }} visible
 * @param {readonly { from: number, to: number }[]} apart — the code blocks and links there
 * @param {DecorationRange[]} out
 */
function linkPaths(state, { from, to }, apart, out) {
  for (let number = state.doc.lineAt(from).number; number <= state.doc.lineAt(to).number; number++) {
    const line = state.doc.line(number);
    for (const ref of findFileRefs(line.text)) {
      const start = line.from + ref.index;
      const end = start + ref.text.length;
      if (apart.some((one) => one.from < end && one.to > start)) continue;
      const attributes = ref.line === undefined ? { 'data-path': ref.path, title: opensTitle } : { 'data-path': ref.path, 'data-line': String(ref.line), title: opensTitle };
      out.push(Decoration.mark({ class: 'cm-lp-link', attributes }).range(start, end));
    }
  }
}

/**
 * What the preview lays over the markdown between from and to — the part of the note shown: the marks hidden away from
 * the cursor, the words in their place, the classes of lines and spans. Tables are block widgets, laid by
 * blockDecorations.
 * @param {EditorState} state
 * @param {{ from: number, to: number }} visible
 * @returns {DecorationSet}
 */
export function previewDecorations(state, visible) {
  /** @type {DecorationRange[]} */
  const out = [];
  /** @type {{ from: number, to: number }[]} */
  const apart = [];
  syntaxTree(state).iterate({
    from: visible.from,
    to: visible.to,
    enter: (ref) => {
      const node = ref.node;
      const heading = /^ATXHeading([1-6])$/.exec(ref.name);
      if (heading !== null) {
        out.push(lineClass(`cm-lp-h${heading[1] ?? '1'}`).range(state.doc.lineAt(ref.from).from));
        if (!lineTouched(state, ref.from)) for (const mark of node.getChildren('HeaderMark')) out.push(hidden.range(mark.from, pastSpace(state, mark.to)));
        return undefined;
      }
      switch (ref.name) {
        case 'FencedCode':
          apart.push({ from: ref.from, to: ref.to });
          decorateCodeBlock(state, node, out);
          return false;
        case 'Blockquote':
          decorateQuote(state, node, out);
          return undefined;
        case 'QuoteMark':
          if (!lineTouched(state, ref.from)) out.push(hidden.range(ref.from, pastSpace(state, ref.to)));
          return undefined;
        case 'InlineCode':
          out.push(Decoration.mark({ class: 'cm-lp-inline-code' }).range(ref.from, ref.to));
          hideMarksUntouched(state, node, 'CodeMark', out);
          return false;
        case 'Emphasis':
        case 'StrongEmphasis':
          hideMarksUntouched(state, node, 'EmphasisMark', out);
          return undefined;
        case 'Strikethrough':
          hideMarksUntouched(state, node, 'StrikethroughMark', out);
          return undefined;
        case 'Link':
          apart.push({ from: ref.from, to: ref.to });
          decorateLink(state, node, out);
          return undefined;
        case 'URL':
          // an address standing alone — <https://…> or a bare one — opens as a link's does
          if (node.parent?.name !== 'Link') {
            apart.push({ from: ref.from, to: ref.to });
            out.push(Decoration.mark({ class: 'cm-lp-link', attributes: { 'data-href': state.doc.sliceString(ref.from, ref.to), title: opensTitle } }).range(ref.from, ref.to));
          }
          return undefined;
        case 'ListMark':
          decorateListMark(state, node, out);
          return undefined;
        case 'TaskMarker':
          if (!lineTouched(state, ref.from)) out.push(Decoration.replace({ widget: new CheckboxWidget(/x/i.test(state.doc.sliceString(ref.from, ref.to))) }).range(ref.from, ref.to));
          return undefined;
        case 'HorizontalRule':
          if (!lineTouched(state, ref.from)) out.push(Decoration.replace({ widget: new RuleWidget() }).range(ref.from, ref.to));
          return undefined;
        case 'Escape':
          if (!touched(state, ref.from, ref.to)) out.push(hidden.range(ref.from, ref.from + 1));
          return undefined;
        case 'HTMLTag':
        case 'HTMLBlock':
          out.push(Decoration.mark({ class: 'cm-lp-html' }).range(ref.from, ref.to));
          return undefined;
        default:
          return undefined;
      }
    },
  });
  linkPaths(state, visible, apart, out);
  return Decoration.set(out, true);
}

/**
 * The note's tables drawn as tables while the cursor is outside them: block widgets, which only the editor's state may
 * lay.
 * @param {EditorState} state
 * @returns {DecorationSet}
 */
export function blockDecorations(state) {
  /** @type {DecorationRange[]} */
  const out = [];
  const tree = ensureSyntaxTree(state, state.doc.length, 200) ?? syntaxTree(state);
  tree.iterate({
    enter: (ref) => {
      if (ref.name !== 'Table') return undefined;
      const from = state.doc.lineAt(ref.from).from;
      const to = state.doc.lineAt(ref.to).to;
      if (!touched(state, from, to)) out.push(Decoration.replace({ widget: new TableWidget(state.doc.sliceString(from, to), from), block: true }).range(from, to));
      return false;
    },
  });
  return Decoration.set(out, true);
}

/** The preview of the part of the note shown, laid anew as the note, the cursor or the part shown changes. */
const inlinePreview = ViewPlugin.fromClass(
  class {
    /** @param {EditorView} view */
    constructor(view) {
      /** @type {DecorationSet} */
      this.decorations = previewDecorations(view.state, view.viewport);
    }

    /** @param {import('@codemirror/view').ViewUpdate} update */
    update(update) {
      if (update.docChanged || update.viewportChanged || update.selectionSet || update.focusChanged || syntaxTree(update.startState) !== syntaxTree(update.state)) {
        this.decorations = previewDecorations(update.state, update.view.viewport);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

/** The tables, laid anew as the note or the cursor changes. */
const tables = StateField.define({
  create: (state) => blockDecorations(state),
  update: (decorations, transaction) => (transaction.docChanged || transaction.selection !== undefined || transaction.effects.some((effect) => effect.is(focusChanged)) ? blockDecorations(transaction.state) : decorations),
  provide: (field) => EditorView.decorations.from(field),
});

/** The live preview, as an editor's extension. */
export const livePreview = [trackFocus, inlinePreview, tables, cellToEdit];
