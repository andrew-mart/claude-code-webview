// @ts-check
// CodeMirror in the file panel: a file's text with its lines numbered and coloured by its language — loaded when a file
// of it opens — brackets matched and closed, folding, completion from the words around, find and replace, undo. The
// file's line breaks stay as they were: a file of CRLF lines is saved with CRLF lines. Colours are the viewer's own, by
// its light or dark theme.
import { closeBrackets, closeBracketsKeymap, completionKeymap, autocompletion } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab, redo, undo } from '@codemirror/commands';
import { bracketMatching, foldGutter, foldKeymap, HighlightStyle, indentOnInput, syntaxHighlighting } from '@codemirror/language';
import { highlightSelectionMatches, openSearchPanel, searchKeymap } from '@codemirror/search';
import { EditorSelection, EditorState } from '@codemirror/state';
import { crosshairCursor, drawSelection, dropCursor, EditorView, highlightActiveLine, highlightActiveLineGutter, highlightSpecialChars, keymap, lineNumbers, rectangularSelection } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { languageOfPath } from '../model/code-language.js';
import { languageSupport } from './language-support.js';

/**
 * @typedef {import('./file-editor.js').CodeEditor} CodeEditor
 * @typedef {import('./file-editor.js').EditorOptions} EditorOptions
 */

/** The viewer's code colours — the ones its highlighted code blocks have — by tag. */
const viewerHighlight = HighlightStyle.define([
  { tag: [tags.keyword, tags.controlKeyword, tags.moduleKeyword, tags.operatorKeyword, tags.definitionKeyword, tags.modifier], color: 'var(--hl-keyword)' },
  { tag: [tags.string, tags.special(tags.string), tags.regexp, tags.character], color: 'var(--hl-string)' },
  { tag: [tags.comment, tags.lineComment, tags.blockComment, tags.docComment], color: 'var(--hl-comment)', fontStyle: 'italic' },
  { tag: [tags.number, tags.bool, tags.null, tags.atom, tags.propertyName, tags.attributeName], color: 'var(--hl-number)' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName), tags.heading, tags.className, tags.definition(tags.typeName)], color: 'var(--hl-title)' },
  { tag: [tags.typeName, tags.standard(tags.variableName), tags.self, tags.namespace], color: 'var(--hl-type)' },
  { tag: [tags.tagName, tags.angleBracket], color: 'var(--hl-tag)' },
  { tag: tags.inserted, backgroundColor: 'var(--diff-add)' },
  { tag: tags.deleted, backgroundColor: 'var(--diff-del)' },
  { tag: tags.strong, fontWeight: 'bold' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.link, textDecoration: 'underline' },
  { tag: tags.invalid, color: 'var(--danger)' },
]);

/** The editor in the viewer's colours: they follow its theme, light or dark, by its CSS variables. */
const viewerTheme = EditorView.theme({
  '&': { height: '100%', backgroundColor: 'var(--bg-code)', color: 'var(--text)', fontSize: '13px' },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.55' },
  '.cm-content': { caretColor: 'var(--text)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--text)' },
  '.cm-gutters': { backgroundColor: 'var(--bg-code-bar)', color: 'var(--text-4)', borderRight: '1px solid var(--border)' },
  '.cm-activeLine': { backgroundColor: 'var(--bg-hover)' },
  '.cm-activeLineGutter': { backgroundColor: 'var(--bg-selected)', color: 'var(--text-2)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: 'color-mix(in srgb, var(--accent) 28%, transparent)' },
  '.cm-selectionMatch': { backgroundColor: 'color-mix(in srgb, var(--accent) 14%, transparent)' },
  '&.cm-focused .cm-matchingBracket': { backgroundColor: 'color-mix(in srgb, var(--accent) 22%, transparent)', outline: 'none' },
  '.cm-searchMatch': { backgroundColor: 'color-mix(in srgb, var(--warning) 25%, transparent)' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'color-mix(in srgb, var(--accent) 35%, transparent)' },
  '.cm-panels': { backgroundColor: 'var(--bg-elev)', color: 'var(--text)', borderTop: '1px solid var(--border)' },
  '.cm-panels input, .cm-panels button': { fontSize: '14px' },
  '.cm-tooltip': { backgroundColor: 'var(--bg-elev)', color: 'var(--text)', border: '1px solid var(--border-strong)' },
  '.cm-tooltip-autocomplete ul li[aria-selected]': { backgroundColor: 'var(--bg-selected)', color: 'var(--text)' },
  '.cm-foldPlaceholder': { backgroundColor: 'var(--bg-bubble)', border: 'none', color: 'var(--text-3)' },
});

/**
 * @param {HTMLElement} host
 * @param {EditorOptions} options
 * @returns {Promise<CodeEditor>}
 */
export async function createCodeEditor(host, { text, path, line, onChange, onSave }) {
  const language = languageOfPath(path);
  const extensions = [
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightSpecialChars(),
    history(),
    foldGutter(),
    drawSelection(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    indentOnInput(),
    syntaxHighlighting(viewerHighlight),
    bracketMatching(),
    closeBrackets(),
    autocompletion(),
    rectangularSelection(),
    crosshairCursor(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    EditorView.lineWrapping,
    keymap.of([{ key: 'Mod-s', preventDefault: true, run: () => (onSave(), true) }, ...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, ...foldKeymap, ...completionKeymap, indentWithTab]),
    // a file of CRLF lines keeps them: the editor joins its lines with what split them
    ...(text.includes('\r\n') ? [EditorState.lineSeparator.of('\r\n')] : []),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) onChange();
    }),
    viewerTheme,
    ...(language === undefined ? [] : [await languageSupport(language)]),
  ];
  const view = new EditorView({ parent: host, state: EditorState.create({ doc: text, extensions }) });
  if (line !== undefined && line >= 1 && line <= view.state.doc.lines) {
    const at = view.state.doc.line(line).from;
    view.dispatch({ selection: EditorSelection.cursor(at), effects: EditorView.scrollIntoView(at, { y: 'center' }) });
  }
  return {
    // joined with the file's own line breaks: the document's toString joins with LF always
    text: () => view.state.sliceDoc(),
    replace: (next) => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: next } }),
    wordAtCursor: () => {
      const { from, to, head } = view.state.selection.main;
      // what is selected, on one line; else the word the cursor is in
      const selected = from === to ? undefined : view.state.sliceDoc(from, to).trim();
      if (selected !== undefined && selected !== '' && !selected.includes('\n')) return selected;
      const word = view.state.wordAt(head);
      return word === null ? undefined : view.state.sliceDoc(word.from, word.to);
    },
    search: () => void openSearchPanel(view),
    undo: () => void undo(view),
    redo: () => void redo(view),
    focus: () => view.focus(),
    dispose: () => view.destroy(),
  };
}
