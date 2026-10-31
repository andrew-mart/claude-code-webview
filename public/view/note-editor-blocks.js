// @ts-check
// A note edited as Notion edits a page — Milkdown's Crepe (its bundle, public/lib/milkdown): blocks with a handle to drag
// them by and "/" to make one, a toolbar over the words selected, tables edited in place, code blocks coloured. What is
// saved is markdown, written anew from the blocks: a note typed into is saved as Milkdown writes it — its lists' marks,
// its escapes; a note only read is not saved. A link opens on Ctrl+click. Its source is the other editor's
// (note-editor-cm.js): this one has no source of its own.
import { blockEdit, codeMirror, CrepeBuilder, cursor, editorViewCtx, linkTooltip, listItem, placeholder, replaceAll, table, toolbar } from '../lib/milkdown/crepe.js';

/**
 * @typedef {import('./note-editor.js').MountOptions} MountOptions
 * @typedef {import('./note-editor.js').MountedEditor} MountedEditor
 */

// Crepe's own styles, once: the viewer's colours over them (style.css: .milkdown)
const styles = document.createElement('link');
styles.rel = 'stylesheet';
styles.href = new URL('../lib/milkdown/crepe.css', import.meta.url).href;
document.head.prepend(styles);

/**
 * The note's editor in host, its markdown as blocks.
 * @param {HTMLElement} host
 * @param {MountOptions} options
 * @returns {Promise<MountedEditor>}
 */
export async function mountBlocksEditor(host, { text, placeholder: words, onChange, onBlur, onOpen }) {
  const crepe = new CrepeBuilder({ root: host, defaultValue: text })
    .addFeature(listItem)
    .addFeature(linkTooltip)
    .addFeature(cursor)
    .addFeature(blockEdit)
    .addFeature(toolbar)
    .addFeature(table)
    .addFeature(codeMirror)
    .addFeature(placeholder, { text: words, mode: 'doc' });
  /** @returns {import('@milkdown/kit/prose/view').EditorView} */
  const view = () => crepe.editor.action((ctx) => ctx.get(editorViewCtx));
  crepe.on((listen) => {
    // only what is typed is saved: the markdown Milkdown writes of a note only read — or of a note come again — differs
    // from what the note says, and would be saved in its place
    listen.markdownUpdated((_ctx, markdown, before) => {
      if (markdown !== before && view().hasFocus()) onChange(markdown);
    });
    listen.blur(() => onBlur());
  });
  await crepe.create();
  // a link Ctrl+clicked opens what it names; a plain click puts the cursor in it
  host.addEventListener(
    'mousedown',
    (event) => {
      if (!(event.ctrlKey || event.metaKey) || !(event.target instanceof window.Element)) return;
      const link = event.target.closest('a[href]');
      const href = link?.getAttribute('href');
      if (href === undefined || href === null) return;
      event.preventDefault();
      event.stopPropagation();
      onOpen({ href });
    },
    true,
  );
  return {
    text: () => crepe.getMarkdown(),
    replace: (next) => crepe.editor.action(replaceAll(next)),
    focus: () => view().focus(),
    hasFocus: () => view().hasFocus(),
    destroy: () => void crepe.destroy(),
  };
}
