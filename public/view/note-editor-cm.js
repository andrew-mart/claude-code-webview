// @ts-check
// A note edited in CodeMirror: as it reads, its marks giving way where the cursor is (live-preview.js) — or as its
// markdown is typed, its source. Lists go on with Enter, as markdown has them; code blocks are coloured by the language
// their first line names; a link — or a file's path — opens on Ctrl+click. Colours are the viewer's own, by its theme.
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { HighlightStyle, LanguageDescription, syntaxHighlighting } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { drawSelection, EditorView, keymap, placeholder as placeholderText } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { languageOfFence } from '../model/code-language.js';
import { languageSupport } from './language-support.js';
import { livePreview } from './live-preview.js';

/**
 * @typedef {import('./note-editor.js').MountOptions} MountOptions
 * @typedef {import('./note-editor.js').MountedEditor} MountedEditor
 * @typedef {import('../model/code-language.js').CodeLanguage} CodeLanguage
 */

/** The colours of code in a note's code blocks — the viewer's, as its highlighted code has them. */
const codeColours = [
  { tag: [tags.keyword, tags.controlKeyword, tags.moduleKeyword, tags.operatorKeyword, tags.definitionKeyword, tags.modifier], color: 'var(--hl-keyword)' },
  { tag: [tags.string, tags.special(tags.string), tags.regexp, tags.character], color: 'var(--hl-string)' },
  { tag: [tags.comment, tags.lineComment, tags.blockComment, tags.docComment], color: 'var(--hl-comment)', fontStyle: 'italic' },
  { tag: [tags.number, tags.bool, tags.null, tags.atom, tags.propertyName, tags.attributeName], color: 'var(--hl-number)' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName), tags.className, tags.definition(tags.typeName)], color: 'var(--hl-title)' },
  { tag: [tags.typeName, tags.standard(tags.variableName), tags.self, tags.namespace], color: 'var(--hl-type)' },
  { tag: [tags.tagName, tags.angleBracket], color: 'var(--hl-tag)' },
];

/** A note as it reads: emphasis as emphasis, a heading's size from its line (style.css: .cm-lp-h1…). */
const previewColours = HighlightStyle.define([
  ...codeColours,
  { tag: tags.heading, fontWeight: '650' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strong, fontWeight: '650' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: [tags.processingInstruction, tags.contentSeparator, tags.labelName, tags.url], color: 'var(--text-3)' },
]);

/** A note's source: its marks in a quieter colour, what they mark as it reads. */
const sourceColours = HighlightStyle.define([
  ...codeColours,
  { tag: tags.heading, fontWeight: '650', color: 'var(--hl-title)' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strong, fontWeight: '650' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: tags.link, color: 'var(--accent)' },
  { tag: [tags.processingInstruction, tags.contentSeparator, tags.labelName, tags.url, tags.quote, tags.escape], color: 'var(--text-3)' },
]);

/** The languages a code block may be in, made once: each loads its package when a block of it first shows. */
/** @type {Map<CodeLanguage, LanguageDescription>} */
const descriptions = new Map();

/**
 * The language a code block's first line names, to colour it by.
 * @param {string} info
 * @returns {LanguageDescription | null} — none: plain text
 */
function codeLanguage(info) {
  const language = languageOfFence(info);
  if (language === undefined) return null;
  const known = descriptions.get(language);
  if (known !== undefined) return known;
  const description = LanguageDescription.of({ name: language, load: () => languageSupport(language) });
  descriptions.set(language, description);
  return description;
}

/**
 * The note's editor in host.
 * @param {HTMLElement} host
 * @param {MountOptions} options
 * @returns {Promise<MountedEditor>}
 */
export async function mountNoteEditor(host, { text, shown, placeholder, onChange, onBlur, onOpen }) {
  const view = new EditorView({
    parent: host,
    state: EditorState.create({
      doc: text,
      extensions: [
        markdown({ base: markdownLanguage, codeLanguages: codeLanguage }),
        history(),
        drawSelection(),
        EditorView.lineWrapping,
        placeholderText(placeholder),
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        syntaxHighlighting(shown === 'preview' ? previewColours : sourceColours),
        ...(shown === 'preview' ? [livePreview] : []),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) onChange(update.state.sliceDoc());
          if (update.focusChanged && !update.view.hasFocus) onBlur();
        }),
        // a link Ctrl+clicked opens what it names; a plain click puts the cursor in it, to edit it
        EditorView.domEventHandlers({
          mousedown: (event) => {
            if (!(event.ctrlKey || event.metaKey) || !(event.target instanceof window.Element)) return false;
            const link = event.target.closest('[data-href], [data-path]');
            if (!(link instanceof window.HTMLElement)) return false;
            event.preventDefault();
            const { href, path, line } = link.dataset;
            if (path !== undefined) onOpen({ path, line: line === undefined ? undefined : Number(line) });
            else if (href !== undefined) onOpen({ href });
            return true;
          },
        }),
      ],
    }),
  });
  return {
    text: () => view.state.sliceDoc(),
    replace: (next) => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: next } }),
    focus: () => view.focus(),
    hasFocus: () => view.hasFocus,
    destroy: () => view.destroy(),
  };
}
