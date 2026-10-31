// @ts-check
// A note's markdown shown as it reads while it is edited, as Obsidian's live preview does: the marks of markdown — a
// heading's #, emphasis' asterisks, a link's address, a code block's fences — hidden while the cursor is away from what
// they mark, shown as soon as it touches it; bullets drawn as dots, a task's [ ] as a box to tick, a table as a table.
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

/** A table drawn as the viewer draws one: a click on it puts the cursor in, its markdown there to edit. */
class TableWidget extends WidgetType {
  /** @param {string} source */
  constructor(source) {
    super();
    this.source = source;
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
    wrap.addEventListener('mousedown', (event) => {
      // a link in it opens, as a link in the text does; anywhere else the cursor goes in
      if (event.target instanceof window.Element && event.target.closest('a') !== null) return;
      event.preventDefault();
      view.dispatch({ selection: { anchor: view.posAtDOM(wrap) } });
      view.focus();
    });
    return wrap;
  }

  ignoreEvent() {
    return false;
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
      if (!touched(state, from, to)) out.push(Decoration.replace({ widget: new TableWidget(state.doc.sliceString(from, to)), block: true }).range(from, to));
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
export const livePreview = [trackFocus, inlinePreview, tables];
